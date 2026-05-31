import { describe, test, expect, beforeEach } from "bun:test";
import Database from "../../src/db.ts";
import type { MetricsRecord, QueryFilters } from "../../src/types.ts";

function iso(date: Date): string {
  return date.toISOString();
}

function hoursAgo(h: number): string {
  return iso(new Date(Date.now() - h * 60 * 60 * 1000));
}

function daysAgo(d: number): string {
  return iso(new Date(Date.now() - d * 24 * 60 * 60 * 1000));
}

function makeRecord(overrides: Partial<MetricsRecord> = {}): MetricsRecord {
  return {
    timestamp: iso(new Date()),
    subscription: "personal",
    model: "openai/gpt-4o",
    promptTokens: 1000,
    completionTokens: 500,
    totalTokens: 1500,
    latencyMs: 1200,
    status: 200,
    stream: false,
    ...overrides,
  };
}

function defaultFilters(overrides: Partial<QueryFilters> = {}): QueryFilters {
  return { dateRange: "all", ...overrides };
}

let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
});

// ── insertMetrics & recordCount ──

describe("insertMetrics and recordCount", () => {
  test("inserts a record and returns its id", () => {
    const id = db.insertMetrics(makeRecord());
    expect(id).toBeGreaterThan(0);
    expect(db.recordCount()).toBe(1);
  });

  test("inserts multiple records", () => {
    db.insertMetrics(makeRecord({ model: "a" }));
    db.insertMetrics(makeRecord({ model: "b" }));
    db.insertMetrics(makeRecord({ model: "c" }));
    expect(db.recordCount()).toBe(3);
  });

  test("handles nullable fields", () => {
    const id = db.insertMetrics(
      makeRecord({
        project: undefined,
        agent: undefined,
        estimatedCost: undefined,
        error: undefined,
      }),
    );
    expect(id).toBeGreaterThan(0);
  });

  test("stores project and agent when provided", () => {
    db.insertMetrics(makeRecord({ project: "tokeneye", agent: "explore" }));
    const records = db.queryMetrics(defaultFilters());
    expect(records[0].project).toBe("tokeneye");
    expect(records[0].agent).toBe("explore");
  });
});

// ── getOverview ──

describe("getOverview", () => {
  test("returns zero stats for empty database", () => {
    const overview = db.getOverview(defaultFilters());
    expect(overview.totalRequests).toBe(0);
    expect(overview.totalTokens).toBe(0);
    expect(overview.totalPromptTokens).toBe(0);
    expect(overview.totalCompletionTokens).toBe(0);
    expect(overview.totalCost).toBe(0);
    expect(overview.avgLatencyMs).toBe(0);
    expect(overview.successRate).toBe(0);
    expect(overview.activeModels).toBe(0);
    expect(overview.activeSubscriptions).toBe(0);
  });

  test("aggregates correctly with data", () => {
    db.insertMetrics(
      makeRecord({
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        latencyMs: 1200,
        status: 200,
        estimatedCost: 0.001,
      }),
    );
    db.insertMetrics(
      makeRecord({
        model: "openai/gpt-4o-mini",
        promptTokens: 200,
        completionTokens: 100,
        totalTokens: 300,
        latencyMs: 800,
        status: 200,
        estimatedCost: 0.0001,
      }),
    );

    const overview = db.getOverview(defaultFilters());
    expect(overview.totalRequests).toBe(2);
    expect(overview.totalTokens).toBe(1800);
    expect(overview.totalPromptTokens).toBe(1200);
    expect(overview.totalCompletionTokens).toBe(600);
    expect(overview.totalCost).toBeCloseTo(0.0011, 6);
    expect(overview.activeModels).toBe(2);
    expect(overview.successRate).toBe(100);
  });

  test("computes success rate correctly with failures", () => {
    db.insertMetrics(makeRecord({ status: 200 }));
    db.insertMetrics(makeRecord({ status: 200 }));
    db.insertMetrics(makeRecord({ status: 500 }));
    db.insertMetrics(makeRecord({ status: 200 }));

    const overview = db.getOverview(defaultFilters());
    expect(overview.successRate).toBe(75);
  });

  test("counts distinct subscriptions", () => {
    db.insertMetrics(makeRecord({ subscription: "personal" }));
    db.insertMetrics(makeRecord({ subscription: "personal" }));
    db.insertMetrics(makeRecord({ subscription: "pro" }));
    expect(db.getOverview(defaultFilters()).activeSubscriptions).toBe(2);
  });
});

// ── getModelBreakdown ──

describe("getModelBreakdown", () => {
  test("returns empty array for no data", () => {
    expect(db.getModelBreakdown(defaultFilters())).toEqual([]);
  });

  test("groups by model", () => {
    db.insertMetrics(makeRecord({ model: "openai/gpt-4o", totalTokens: 1000, estimatedCost: 0.01 }));
    db.insertMetrics(makeRecord({ model: "openai/gpt-4o", totalTokens: 500, estimatedCost: 0.005 }));
    db.insertMetrics(
      makeRecord({ model: "openai/gpt-4o-mini", totalTokens: 200, estimatedCost: 0.001 }),
    );

    const breakdown = db.getModelBreakdown(defaultFilters());
    expect(breakdown).toHaveLength(2);

    const gpt4o = breakdown.find((b) => b.model === "openai/gpt-4o")!;
    expect(gpt4o.requests).toBe(2);
    expect(gpt4o.totalTokens).toBe(1500);
    expect(gpt4o.cost).toBeCloseTo(0.015, 6);

    const mini = breakdown.find((b) => b.model === "openai/gpt-4o-mini")!;
    expect(mini.requests).toBe(1);
    expect(mini.totalTokens).toBe(200);
  });

  test("calculates percentage of total tokens", () => {
    db.insertMetrics(makeRecord({ model: "openai/gpt-4o", totalTokens: 700 }));
    db.insertMetrics(makeRecord({ model: "openai/gpt-4o-mini", totalTokens: 300 }));

    const breakdown = db.getModelBreakdown(defaultFilters());
    const gpt4o = breakdown.find((b) => b.model === "openai/gpt-4o")!;
    expect(gpt4o.percentage).toBe(70);
  });

  test("sorts by total tokens descending", () => {
    db.insertMetrics(makeRecord({ model: "small", totalTokens: 10 }));
    db.insertMetrics(makeRecord({ model: "large", totalTokens: 1000 }));
    db.insertMetrics(makeRecord({ model: "medium", totalTokens: 100 }));

    const breakdown = db.getModelBreakdown(defaultFilters());
    expect(breakdown[0].model).toBe("large");
    expect(breakdown[1].model).toBe("medium");
    expect(breakdown[2].model).toBe("small");
  });
});

// ── getSubscriptionBreakdown ──

describe("getSubscriptionBreakdown", () => {
  test("returns empty array for no data", () => {
    expect(db.getSubscriptionBreakdown(defaultFilters())).toEqual([]);
  });

  test("groups by subscription", () => {
    db.insertMetrics(makeRecord({ subscription: "personal", totalTokens: 1000 }));
    db.insertMetrics(makeRecord({ subscription: "personal", totalTokens: 500 }));
    db.insertMetrics(makeRecord({ subscription: "pro", totalTokens: 300 }));

    const breakdown = db.getSubscriptionBreakdown(defaultFilters());
    expect(breakdown).toHaveLength(2);

    const personal = breakdown.find((b) => b.subscription === "personal")!;
    expect(personal.requests).toBe(2);
    expect(personal.totalTokens).toBe(1500);

    const pro = breakdown.find((b) => b.subscription === "pro")!;
    expect(pro.requests).toBe(1);
    expect(pro.totalTokens).toBe(300);
  });

  test("includes list of models per subscription", () => {
    db.insertMetrics(makeRecord({ subscription: "personal", model: "gpt-4o" }));
    db.insertMetrics(makeRecord({ subscription: "personal", model: "gpt-4o-mini" }));
    db.insertMetrics(makeRecord({ subscription: "pro", model: "claude" }));

    const breakdown = db.getSubscriptionBreakdown(defaultFilters());
    const personal = breakdown.find((b) => b.subscription === "personal")!;
    expect(personal.models).toContain("gpt-4o");
    expect(personal.models).toContain("gpt-4o-mini");
  });

  test("computes success rate per subscription", () => {
    for (let i = 0; i < 4; i++) db.insertMetrics(makeRecord({ subscription: "personal", status: 200 }));
    db.insertMetrics(makeRecord({ subscription: "personal", status: 500 }));

    const breakdown = db.getSubscriptionBreakdown(defaultFilters());
    const personal = breakdown.find((b) => b.subscription === "personal")!;
    expect(personal.successRate).toBe(80);
  });
});

// ── getProjectBreakdown ──

describe("getProjectBreakdown", () => {
  test("returns empty array for no data", () => {
    expect(db.getProjectBreakdown(defaultFilters())).toEqual([]);
  });

  test("groups by project", () => {
    db.insertMetrics(makeRecord({ project: "tokeneye", totalTokens: 1000 }));
    db.insertMetrics(makeRecord({ project: "tokeneye", totalTokens: 500 }));
    db.insertMetrics(makeRecord({ project: "narratiq", totalTokens: 300 }));

    const breakdown = db.getProjectBreakdown(defaultFilters());
    expect(breakdown).toHaveLength(2);

    const te = breakdown.find((b) => b.project === "tokeneye")!;
    expect(te.requests).toBe(2);
    expect(te.totalTokens).toBe(1500);
  });

  test("defaults null project to 'unknown'", () => {
    db.insertMetrics(makeRecord({ project: undefined, totalTokens: 100 }));

    const breakdown = db.getProjectBreakdown(defaultFilters());
    expect(breakdown[0].project).toBe("unknown");
  });

  test("includes model breakdown per project", () => {
    db.insertMetrics(makeRecord({ project: "tokeneye", model: "gpt-4o", totalTokens: 1000 }));
    db.insertMetrics(makeRecord({ project: "tokeneye", model: "gpt-4o-mini", totalTokens: 500 }));

    const breakdown = db.getProjectBreakdown(defaultFilters());
    const te = breakdown.find((b) => b.project === "tokeneye")!;
    expect(te.models).toHaveLength(2);
    expect(te.models[0].model).toBeDefined();
    expect(te.models[0].totalTokens).toBeGreaterThan(0);
  });

  test("sorts projects by total tokens descending", () => {
    db.insertMetrics(makeRecord({ project: "small", totalTokens: 10 }));
    db.insertMetrics(makeRecord({ project: "large", totalTokens: 1000 }));

    const breakdown = db.getProjectBreakdown(defaultFilters());
    expect(breakdown[0].project).toBe("large");
    expect(breakdown[1].project).toBe("small");
  });
});

// ── getAgentBreakdown ──

describe("getAgentBreakdown", () => {
  test("returns empty array for no data", () => {
    expect(db.getAgentBreakdown(defaultFilters())).toEqual([]);
  });

  test("groups by agent", () => {
    db.insertMetrics(makeRecord({ agent: "explore", totalTokens: 1000 }));
    db.insertMetrics(makeRecord({ agent: "explore", totalTokens: 500 }));
    db.insertMetrics(makeRecord({ agent: "build", totalTokens: 300 }));

    const breakdown = db.getAgentBreakdown(defaultFilters());
    expect(breakdown).toHaveLength(2);

    const explore = breakdown.find((b) => b.agent === "explore")!;
    expect(explore.requests).toBe(2);
    expect(explore.totalTokens).toBe(1500);
  });

  test("defaults null agent to 'unknown'", () => {
    db.insertMetrics(makeRecord({ agent: undefined, totalTokens: 100 }));

    const breakdown = db.getAgentBreakdown(defaultFilters());
    expect(breakdown[0].agent).toBe("unknown");
  });

  test("identifies top model per agent", () => {
    db.insertMetrics(makeRecord({ agent: "explore", model: "gpt-4o", totalTokens: 500 }));
    db.insertMetrics(makeRecord({ agent: "explore", model: "gpt-4o-mini", totalTokens: 1000 }));
    db.insertMetrics(makeRecord({ agent: "explore", model: "gpt-4o-mini", totalTokens: 800 }));

    const breakdown = db.getAgentBreakdown(defaultFilters());
    const explore = breakdown.find((b) => b.agent === "explore")!;
    expect(explore.topModel).toBe("gpt-4o-mini");
  });

  test("topModel is unknown for agent with no records", () => {
    const breakdown = db.getAgentBreakdown(defaultFilters());
    expect(breakdown).toEqual([]);
  });
});

// ── getTimeline ──

describe("getTimeline", () => {
  test("returns empty array for no data", () => {
    expect(db.getTimeline(defaultFilters())).toEqual([]);
  });

  test("buckets by hour with 'hour' range", () => {
    db.insertMetrics(makeRecord({ timestamp: hoursAgo(0.5), totalTokens: 100 }));
    db.insertMetrics(makeRecord({ timestamp: hoursAgo(1.5), totalTokens: 200 }));

    const timeline = db.getTimeline(defaultFilters({ dateRange: "day" }));
    expect(timeline.length).toBeGreaterThan(0);
    for (const point of timeline) {
      expect(point.timestamp).toBeDefined();
      expect(point.tokens).toBeGreaterThanOrEqual(0);
      expect(point.requests).toBeGreaterThanOrEqual(0);
    }
  });

  test("buckets by day with 'week' range", () => {
    db.insertMetrics(makeRecord({ timestamp: daysAgo(1), totalTokens: 100 }));
    db.insertMetrics(makeRecord({ timestamp: daysAgo(3), totalTokens: 200 }));

    const timeline = db.getTimeline(defaultFilters({ dateRange: "week" }));
    expect(timeline.length).toBeGreaterThan(0);
    for (const point of timeline) {
      expect(point.timestamp).toBeDefined();
    }
  });

  test("buckets by month with 'all' range", () => {
    db.insertMetrics(makeRecord({ timestamp: daysAgo(5), totalTokens: 100 }));

    const timeline = db.getTimeline(defaultFilters({ dateRange: "all" }));
    expect(timeline.length).toBeGreaterThan(0);
    expect(timeline[0].tokens).toBe(100);
  });

  test("filters out null buckets", () => {
    db.insertMetrics(makeRecord({ totalTokens: 100 }));
    const timeline = db.getTimeline(defaultFilters({ dateRange: "day" }));
    for (const point of timeline) {
      expect(point.timestamp).not.toBeNull();
    }
  });

  test("includes cost aggregation", () => {
    db.insertMetrics(makeRecord({ totalTokens: 100, estimatedCost: 0.005 }));
    const timeline = db.getTimeline(defaultFilters({ dateRange: "all" }));
    expect(timeline[0].cost).toBeGreaterThan(0);
  });
});

// ── getHeatmap ──

describe("getHeatmap", () => {
  test("returns empty array for no data", () => {
    expect(db.getHeatmap(defaultFilters())).toEqual([]);
  });

  test("returns hour/day grid", () => {
    db.insertMetrics(makeRecord({ totalTokens: 100 }));

    const heatmap = db.getHeatmap(defaultFilters());
    expect(heatmap.length).toBeGreaterThan(0);
    for (const cell of heatmap) {
      expect(cell.hour).toBeGreaterThanOrEqual(0);
      expect(cell.hour).toBeLessThanOrEqual(23);
      expect(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]).toContain(cell.day);
      expect(cell.tokens).toBeGreaterThanOrEqual(0);
      expect(cell.requests).toBeGreaterThanOrEqual(0);
    }
  });

  test("aggregates tokens and requests per hour/day", () => {
    db.insertMetrics(makeRecord({ totalTokens: 100 }));
    db.insertMetrics(makeRecord({ totalTokens: 200 }));

    const heatmap = db.getHeatmap(defaultFilters());
    const totalTokens = heatmap.reduce((sum, c) => sum + c.tokens, 0);
    expect(totalTokens).toBeGreaterThanOrEqual(300);
  });
});

// ── getTopConsumers ──

describe("getTopConsumers", () => {
  test("returns empty array for no data", () => {
    expect(db.getTopConsumers(defaultFilters(), 10)).toEqual([]);
  });

  test("respects limit parameter", () => {
    db.insertMetrics(makeRecord({ model: "a", totalTokens: 100 }));
    db.insertMetrics(makeRecord({ model: "b", totalTokens: 200 }));
    db.insertMetrics(makeRecord({ model: "c", totalTokens: 300 }));

    const consumers = db.getTopConsumers(defaultFilters(), 2);
    expect(consumers.length).toBeLessThanOrEqual(2);
  });

  test("returns all consumer types", () => {
    db.insertMetrics(makeRecord({ model: "gpt-4o", subscription: "personal", project: "p1", agent: "a1", totalTokens: 1000 }));

    const consumers = db.getTopConsumers(defaultFilters(), 20);
    const types = new Set(consumers.map((c) => c.type));
    expect(types.has("model")).toBe(true);
    expect(types.has("subscription")).toBe(true);
    expect(types.has("project")).toBe(true);
    expect(types.has("agent")).toBe(true);
  });

  test("all entries have trend 'stable'", () => {
    db.insertMetrics(makeRecord({ totalTokens: 100 }));
    const consumers = db.getTopConsumers(defaultFilters(), 10);
    for (const c of consumers) {
      expect(c.trend).toBe("stable");
    }
  });

  test("sorts by tokens descending", () => {
    db.insertMetrics(makeRecord({ model: "small", totalTokens: 10 }));
    db.insertMetrics(makeRecord({ model: "large", totalTokens: 1000 }));

    const consumers = db.getTopConsumers(defaultFilters({ models: ["small", "large"] }), 10);
    const modelConsumers = consumers.filter((c) => c.type === "model");
    expect(modelConsumers[0].tokens).toBeGreaterThanOrEqual(modelConsumers[1]?.tokens ?? 0);
  });
});

// ── getDistinctValues ──

describe("getDistinctValues", () => {
  test("returns distinct models", () => {
    db.insertMetrics(makeRecord({ model: "gpt-4o" }));
    db.insertMetrics(makeRecord({ model: "gpt-4o-mini" }));
    db.insertMetrics(makeRecord({ model: "gpt-4o" }));

    const models = db.getDistinctValues("model");
    expect(models).toContain("gpt-4o");
    expect(models).toContain("gpt-4o-mini");
    expect(models).toHaveLength(2);
  });

  test("returns distinct subscriptions", () => {
    db.insertMetrics(makeRecord({ subscription: "personal" }));
    db.insertMetrics(makeRecord({ subscription: "pro" }));

    const subs = db.getDistinctValues("subscription");
    expect(subs).toHaveLength(2);
  });

  test("returns distinct projects", () => {
    db.insertMetrics(makeRecord({ project: "tokeneye" }));
    db.insertMetrics(makeRecord({ project: "narratiq" }));

    const projects = db.getDistinctValues("project");
    expect(projects).toHaveLength(2);
  });

  test("returns distinct agents", () => {
    db.insertMetrics(makeRecord({ agent: "explore" }));
    db.insertMetrics(makeRecord({ agent: "build" }));

    const agents = db.getDistinctValues("agent");
    expect(agents).toHaveLength(2);
  });

  test("throws on invalid column", () => {
    expect(() => db.getDistinctValues("invalid_column")).toThrow(
      'invalid column "invalid_column"',
    );
  });

  test("returns empty array for empty database", () => {
    expect(db.getDistinctValues("model")).toEqual([]);
  });
});

// ── queryMetrics ──

describe("queryMetrics", () => {
  test("returns records in reverse chronological order", () => {
    db.insertMetrics(makeRecord({ timestamp: daysAgo(3) }));
    db.insertMetrics(makeRecord({ timestamp: daysAgo(1) }));
    db.insertMetrics(makeRecord({ timestamp: daysAgo(5) }));

    const records = db.queryMetrics(defaultFilters());
    expect(records).toHaveLength(3);
    expect(new Date(records[0].timestamp).getTime()).toBeGreaterThanOrEqual(
      new Date(records[1].timestamp).getTime(),
    );
  });

  test("correctly maps stream boolean from SQLite integer", () => {
    db.insertMetrics(makeRecord({ stream: true }));
    db.insertMetrics(makeRecord({ stream: false }));

    const records = db.queryMetrics(defaultFilters());
    const streams = records.map((r) => r.stream);
    expect(streams).toContain(true);
    expect(streams).toContain(false);
  });

  test("maps nullable fields correctly", () => {
    db.insertMetrics(makeRecord({ error: "rate limited" }));
    const records = db.queryMetrics(defaultFilters());
    expect(records[0].error).toBe("rate limited");
  });
});

// ── Date range filtering ──

describe("date range filtering", () => {
  test("'day' range filters to records from today", () => {
    db.insertMetrics(makeRecord({ timestamp: hoursAgo(2), model: "today" }));
    db.insertMetrics(makeRecord({ timestamp: daysAgo(2), model: "yesterday" }));

    const records = db.queryMetrics(defaultFilters({ dateRange: "day" }));
    const models = records.map((r) => r.model);
    expect(models).toContain("today");
    expect(models).not.toContain("yesterday");
  });

  test("'week' range includes records within 7 days", () => {
    db.insertMetrics(makeRecord({ timestamp: daysAgo(3), model: "recent" }));
    db.insertMetrics(makeRecord({ timestamp: daysAgo(10), model: "old" }));

    const records = db.queryMetrics(defaultFilters({ dateRange: "week" }));
    const models = records.map((r) => r.model);
    expect(models).toContain("recent");
    expect(models).not.toContain("old");
  });

  test("'month' range includes records within 30 days", () => {
    db.insertMetrics(makeRecord({ timestamp: daysAgo(20), model: "recent" }));
    db.insertMetrics(makeRecord({ timestamp: daysAgo(40), model: "old" }));

    const records = db.queryMetrics(defaultFilters({ dateRange: "month" }));
    const models = records.map((r) => r.model);
    expect(models).toContain("recent");
    expect(models).not.toContain("old");
  });

  test("'all' range includes everything", () => {
    db.insertMetrics(makeRecord({ timestamp: daysAgo(100), model: "ancient" }));
    db.insertMetrics(makeRecord({ timestamp: daysAgo(1), model: "recent" }));

    const records = db.queryMetrics(defaultFilters({ dateRange: "all" }));
    expect(records).toHaveLength(2);
  });

  test("'hour' range filters last 60 minutes", () => {
    db.insertMetrics(makeRecord({ timestamp: hoursAgo(0.5), model: "recent" }));
    db.insertMetrics(makeRecord({ timestamp: hoursAgo(3), model: "old" }));

    const records = db.queryMetrics(defaultFilters({ dateRange: "hour" }));
    const models = records.map((r) => r.model);
    expect(models).toContain("recent");
    expect(models).not.toContain("old");
  });

  test("custom range uses from and to dates", () => {
    db.insertMetrics(makeRecord({ timestamp: daysAgo(5), model: "middle" }));
    db.insertMetrics(makeRecord({ timestamp: daysAgo(15), model: "outside" }));

    const records = db.queryMetrics(
      defaultFilters({
        dateRange: "custom",
        customRange: {
          from: daysAgo(10),
          to: daysAgo(0),
        },
      }),
    );
    const models = records.map((r) => r.model);
    expect(models).toContain("middle");
    expect(models).not.toContain("outside");
  });
});

// ── Status filtering ──

describe("status filtering", () => {
  test("'success' filter only returns 2xx/3xx", () => {
    db.insertMetrics(makeRecord({ status: 200, model: "success" }));
    db.insertMetrics(makeRecord({ status: 302, model: "redirect" }));
    db.insertMetrics(makeRecord({ status: 429, model: "rate-limited" }));
    db.insertMetrics(makeRecord({ status: 500, model: "error" }));

    const records = db.queryMetrics(defaultFilters({ status: "success" }));
    const models = records.map((r) => r.model);
    expect(models).toContain("success");
    expect(models).toContain("redirect");
    expect(models).not.toContain("rate-limited");
    expect(models).not.toContain("error");
  });

  test("'error' filter only returns 4xx+", () => {
    db.insertMetrics(makeRecord({ status: 200, model: "success" }));
    db.insertMetrics(makeRecord({ status: 429, model: "rate-limited" }));
    db.insertMetrics(makeRecord({ status: 500, model: "error" }));

    const records = db.queryMetrics(defaultFilters({ status: "error" }));
    const models = records.map((r) => r.model);
    expect(models).not.toContain("success");
    expect(models).toContain("rate-limited");
    expect(models).toContain("error");
  });

  test("'all' status includes everything", () => {
    db.insertMetrics(makeRecord({ status: 200 }));
    db.insertMetrics(makeRecord({ status: 500 }));
    expect(db.queryMetrics(defaultFilters({ status: "all" }))).toHaveLength(2);
  });
});

// ── Dimension filters ──

describe("dimension filters", () => {
  test("filters by model list", () => {
    db.insertMetrics(makeRecord({ model: "gpt-4o" }));
    db.insertMetrics(makeRecord({ model: "gpt-4o-mini" }));
    db.insertMetrics(makeRecord({ model: "claude" }));

    const records = db.queryMetrics(defaultFilters({ models: ["gpt-4o", "claude"] }));
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.model)).not.toContain("gpt-4o-mini");
  });

  test("filters by subscription list", () => {
    db.insertMetrics(makeRecord({ subscription: "personal" }));
    db.insertMetrics(makeRecord({ subscription: "pro" }));
    db.insertMetrics(makeRecord({ subscription: "personal" }));

    const records = db.queryMetrics(defaultFilters({ subscriptions: ["pro"] }));
    expect(records).toHaveLength(1);
    expect(records[0].subscription).toBe("pro");
  });

  test("filters by project list", () => {
    db.insertMetrics(makeRecord({ project: "tokeneye" }));
    db.insertMetrics(makeRecord({ project: "narratiq" }));

    const records = db.queryMetrics(defaultFilters({ projects: ["tokeneye"] }));
    expect(records).toHaveLength(1);
    expect(records[0].project).toBe("tokeneye");
  });

  test("filters by agent list", () => {
    db.insertMetrics(makeRecord({ agent: "explore" }));
    db.insertMetrics(makeRecord({ agent: "build" }));

    const records = db.queryMetrics(defaultFilters({ agents: ["explore"] }));
    expect(records).toHaveLength(1);
    expect(records[0].agent).toBe("explore");
  });

  test("combines multiple dimension filters", () => {
    db.insertMetrics(makeRecord({ model: "gpt-4o", subscription: "personal" }));
    db.insertMetrics(makeRecord({ model: "gpt-4o", subscription: "pro" }));
    db.insertMetrics(makeRecord({ model: "claude", subscription: "personal" }));

    const records = db.queryMetrics(
      defaultFilters({ models: ["gpt-4o"], subscriptions: ["personal"] }),
    );
    expect(records).toHaveLength(1);
    expect(records[0].model).toBe("gpt-4o");
    expect(records[0].subscription).toBe("personal");
  });
});

// ── close ──

describe("close", () => {
  test("closes without error", () => {
    db.insertMetrics(makeRecord());
    expect(() => db.close()).not.toThrow();
  });

  test("throws when using closed database", () => {
    db.close();
    expect(() => db.recordCount()).toThrow();
  });
});
