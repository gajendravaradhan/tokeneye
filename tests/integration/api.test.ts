import { test, expect, describe, afterAll } from "bun:test";
import { createApiHandler } from "../../src/api.ts";
import Database from "../../src/db.ts";
import type { QueryFilters } from "../../src/types.ts";

function jsonBody(res: Response) {
  return res.text().then((t) => JSON.parse(t));
}

function makeApiDb(db: Database) {
  return {
    getOverview: (f: QueryFilters) => db.getOverview(f),
    getModelBreakdown: (f: QueryFilters) => db.getModelBreakdown(f),
    getSubscriptionBreakdown: (f: QueryFilters) => db.getSubscriptionBreakdown(f),
    getProjectBreakdown: (f: QueryFilters) => db.getProjectBreakdown(f),
    getAgentBreakdown: (f: QueryFilters) => db.getAgentBreakdown(f),
    getTimeline: (f: QueryFilters) => db.getTimeline(f),
    getHeatmap: (f: QueryFilters) => db.getHeatmap(f),
    getTopConsumers: (f: QueryFilters, limit: number) => db.getTopConsumers(f, limit),
    getFilterOptions: () => ({
      models: db.getDistinctValues("model"),
      subscriptions: db.getDistinctValues("subscription"),
      projects: db.getDistinctValues("project"),
      agents: db.getDistinctValues("agent"),
    }),
    recordCount: () => db.recordCount(),
  };
}

function seedMetrics(db: Database) {
  const now = new Date();
  const hour = (offset: number) => new Date(now.getTime() - offset * 3600_000).toISOString();

  const records = [
    {
      timestamp: hour(0), subscription: "sub-a", model: "openai/gpt-4o",
      promptTokens: 100, completionTokens: 50, totalTokens: 150,
      latencyMs: 200, status: 200, stream: false, project: "web", agent: "coder",
      estimatedCost: 0.00075,
    },
    {
      timestamp: hour(1), subscription: "sub-a", model: "openai/gpt-4o",
      promptTokens: 200, completionTokens: 100, totalTokens: 300,
      latencyMs: 300, status: 200, stream: false, project: "web", agent: "coder",
      estimatedCost: 0.0015,
    },
    {
      timestamp: hour(2), subscription: "sub-b", model: "anthropic/claude-sonnet-4-6",
      promptTokens: 500, completionTokens: 300, totalTokens: 800,
      latencyMs: 500, status: 200, stream: true, project: "mobile", agent: "reviewer",
      estimatedCost: 0.006,
    },
    {
      timestamp: hour(3), subscription: "sub-b", model: "anthropic/claude-sonnet-4-6",
      promptTokens: 100, completionTokens: 200, totalTokens: 300,
      latencyMs: 400, status: 429, stream: false, project: "mobile", agent: "reviewer",
      estimatedCost: 0,
    },
    {
      timestamp: hour(4), subscription: "sub-a", model: "deepseek/deepseek-v4-pro",
      promptTokens: 1000, completionTokens: 0, totalTokens: 1000,
      latencyMs: 100, status: 200, stream: false, project: "web", agent: "builder",
      estimatedCost: 0.00174,
    },
  ];

  for (const r of records) {
    db.insertMetrics(r);
  }
}

describe("API handler", () => {
  const db = new Database(":memory:");
  seedMetrics(db);
  const handler = createApiHandler(makeApiDb(db));

  afterAll(() => {
    db.close();
  });

  test("OPTIONS returns CORS headers", () => {
    const req = new Request("http://localhost/api/health", { method: "OPTIONS", headers: { origin: "http://localhost:3000" } });
    const res = handler(req);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
    expect(res.headers.get("access-control-allow-headers")).toContain("Content-Type");
  });

  test("GET /api/health returns uptime and recordCount", async () => {
    const req = new Request("http://localhost/api/health", { headers: { origin: "http://localhost:3000" } });
    const res = handler(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");

    const body = await jsonBody(res);
    expect(body.ok).toBe(true);
    expect(typeof body.uptime).toBe("number");
    expect(body.recordCount).toBe(5);
  });

  test("GET /api/overview returns correct aggregates", async () => {
    const req = new Request("http://localhost/api/overview?dateRange=all");
    const res = handler(req);
    expect(res.status).toBe(200);

    const body = await jsonBody(res);
    expect(body.totalRequests).toBe(5);
    expect(body.totalTokens).toBe(150 + 300 + 800 + 300 + 1000);
    expect(body.activeModels).toBe(3);
    expect(body.activeSubscriptions).toBe(2);
    expect(body.totalCost).toBeGreaterThan(0);
    expect(body.avgLatencyMs).toBeGreaterThan(0);
    expect(body.successRate).toBeGreaterThan(0);
  });

  test("GET /api/models returns model breakdown sorted by tokens", async () => {
    const req = new Request("http://localhost/api/models?dateRange=all");
    const res = handler(req);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as any[];
    expect(body.length).toBe(3);
    expect(body[0].model).toBe("anthropic/claude-sonnet-4-6");
    expect(body[0].totalTokens).toBe(1100);
    expect(body[1].model).toBe("deepseek/deepseek-v4-pro");
    expect(body[2].model).toBe("openai/gpt-4o");

    for (const m of body) {
      expect(typeof m.requests).toBe("number");
      expect(typeof m.cost).toBe("number");
      expect(typeof m.percentage).toBe("number");
      expect(typeof m.avgLatencyMs).toBe("number");
    }

    const totalPct = body.reduce((sum: number, m: any) => sum + m.percentage, 0);
    expect(totalPct).toBeCloseTo(100, 0);
  });

  test("GET /api/subscriptions returns subscription breakdown", async () => {
    const req = new Request("http://localhost/api/subscriptions?dateRange=all");
    const res = handler(req);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as any[];
    expect(body.length).toBe(2);

    const subA = body.find((s: any) => s.subscription === "sub-a")!;
    expect(subA.requests).toBe(3);
    expect(subA.totalTokens).toBe(1450);
    expect(Array.isArray(subA.models)).toBe(true);
    expect(subA.models.length).toBe(2);

    const subB = body.find((s: any) => s.subscription === "sub-b")!;
    expect(subB.requests).toBe(2);
    expect(subB.totalTokens).toBe(1100);

    for (const s of body) {
      expect(typeof s.cost).toBe("number");
      expect(typeof s.successRate).toBe("number");
    }
  });

  test("GET /api/timeline returns time-bucketed data", async () => {
    const req = new Request("http://localhost/api/timeline?dateRange=all");
    const res = handler(req);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as any[];
    expect(body.length).toBeGreaterThanOrEqual(1);

    for (const p of body) {
      expect(typeof p.timestamp).toBe("string");
      expect(typeof p.tokens).toBe("number");
      expect(typeof p.cost).toBe("number");
      expect(typeof p.requests).toBe("number");
    }
  });

  test("GET /api/heatmap returns hour/day data", async () => {
    const req = new Request("http://localhost/api/heatmap?dateRange=all");
    const res = handler(req);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as any[];
    expect(body.length).toBeGreaterThanOrEqual(1);

    for (const h of body) {
      expect(typeof h.hour).toBe("number");
      expect(h.hour).toBeGreaterThanOrEqual(0);
      expect(h.hour).toBeLessThanOrEqual(23);
      expect(typeof h.day).toBe("string");
      expect(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]).toContain(h.day);
      expect(typeof h.tokens).toBe("number");
      expect(typeof h.requests).toBe("number");
    }
  });

  test("GET /api/top-consumers returns limited results", async () => {
    const req = new Request("http://localhost/api/top-consumers?dateRange=all&limit=3");
    const res = handler(req);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as any[];
    expect(body.length).toBeLessThanOrEqual(3);

    for (const c of body) {
      expect(typeof c.name).toBe("string");
      expect(["model", "agent", "project", "subscription"]).toContain(c.type);
      expect(typeof c.tokens).toBe("number");
      expect(typeof c.cost).toBe("number");
      expect(["up", "down", "stable"]).toContain(c.trend);
    }
  });

  test("GET /api/full returns complete DashboardData", async () => {
    const req = new Request("http://localhost/api/full?dateRange=all&limit=5");
    const res = handler(req);
    expect(res.status).toBe(200);

    const body = await jsonBody(res);
    expect(body.overview).toBeTruthy();
    expect(Array.isArray(body.modelBreakdown)).toBe(true);
    expect(Array.isArray(body.subscriptionBreakdown)).toBe(true);
    expect(Array.isArray(body.projectBreakdown)).toBe(true);
    expect(Array.isArray(body.agentBreakdown)).toBe(true);
    expect(Array.isArray(body.timeline)).toBe(true);
    expect(Array.isArray(body.heatmap)).toBe(true);
    expect(Array.isArray(body.topConsumers)).toBe(true);
    expect(body.filters).toBeTruthy();
    expect(body.filters.dateRange).toBe("all");
  });

  test("GET /api/filters returns distinct values", async () => {
    const req = new Request("http://localhost/api/filters");
    const res = handler(req);
    expect(res.status).toBe(200);

    const body = await jsonBody(res);
    expect(Array.isArray(body.models)).toBe(true);
    expect(body.models).toContain("openai/gpt-4o");
    expect(body.models).toContain("anthropic/claude-sonnet-4-6");
    expect(body.models).toContain("deepseek/deepseek-v4-pro");
    expect(Array.isArray(body.subscriptions)).toBe(true);
    expect(body.subscriptions).toContain("sub-a");
    expect(body.subscriptions).toContain("sub-b");
    expect(Array.isArray(body.projects)).toBe(true);
    expect(Array.isArray(body.agents)).toBe(true);
  });

  test("GET /api/projects returns project breakdown", async () => {
    const req = new Request("http://localhost/api/projects?dateRange=all");
    const res = handler(req);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as any[];
    expect(body.length).toBeGreaterThanOrEqual(1);

    for (const p of body) {
      expect(typeof p.project).toBe("string");
      expect(typeof p.totalTokens).toBe("number");
      expect(Array.isArray(p.models)).toBe(true);
    }
  });

  test("GET /api/agents returns agent breakdown", async () => {
    const req = new Request("http://localhost/api/agents?dateRange=all");
    const res = handler(req);
    expect(res.status).toBe(200);

    const body = (await jsonBody(res)) as any[];
    expect(body.length).toBeGreaterThanOrEqual(1);

    for (const a of body) {
      expect(typeof a.agent).toBe("string");
      expect(typeof a.totalTokens).toBe("number");
      expect(typeof a.topModel).toBe("string");
    }
  });

  test("filters by status via query param", async () => {
    const req = new Request("http://localhost/api/overview?dateRange=all&status=success");
    const res = handler(req);
    expect(res.status).toBe(200);

    const body = await jsonBody(res);
    expect(body.totalRequests).toBe(4);
  });

  test("filters by models via query param", async () => {
    const req = new Request(
      "http://localhost/api/overview?dateRange=all&models=openai/gpt-4o,deepseek/deepseek-v4-pro",
    );
    const res = handler(req);
    expect(res.status).toBe(200);

    const body = await jsonBody(res);
    expect(body.totalRequests).toBe(3);
    expect(body.totalTokens).toBe(1450);
  });

  test("filters by subscriptions via query param", async () => {
    const req = new Request("http://localhost/api/overview?dateRange=all&subscriptions=sub-b");
    const res = handler(req);
    expect(res.status).toBe(200);

    const body = await jsonBody(res);
    expect(body.totalRequests).toBe(2);
  });

  test("returns 404 for unknown routes", async () => {
    const req = new Request("http://localhost/api/unknown");
    const res = handler(req);
    expect(res.status).toBe(404);

    const body = await jsonBody(res);
    expect(body.error).toBe("Not found");
  });

  test("CORS headers on error responses", () => {
    const req = new Request("http://localhost/api/unknown", {
      headers: { origin: "http://localhost:3000" },
    });
    const res = handler(req);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });
});

describe("API security", () => {
  const db = new Database(":memory:");
  seedMetrics(db);
  const handler = createApiHandler(makeApiDb(db));

  afterAll(() => {
    db.close();
  });

  test("rate limiting returns 429 after 300 requests", () => {
    const limiterDb = new Database(":memory:");
    const limiterHandler = createApiHandler(makeApiDb(limiterDb));

    for (let i = 0; i < 300; i++) {
      const req = new Request(`http://localhost/api/health?t=${i}`);
      const res = limiterHandler(req);
      expect(res.status).not.toBe(429);
    }

    const blockedReq = new Request("http://localhost/api/health");
    const blockedRes = limiterHandler(blockedReq);
    expect(blockedRes.status).toBe(429);

    limiterDb.close();
  });

  test("invalid dateRange returns error", async () => {
    const req = new Request("http://localhost/api/overview?dateRange=notreal");
    const res = handler(req);
    expect(res.status).toBe(500);
    const body = await jsonBody(res);
    expect(body.error).toContain("Invalid dateRange");
  });

  test("invalid status returns error", async () => {
    const req = new Request("http://localhost/api/overview?dateRange=all&status=unknown");
    const res = handler(req);
    expect(res.status).toBe(500);
    const body = await jsonBody(res);
    expect(body.error).toContain("Invalid status");
  });

  test("response includes security headers", () => {
    const req = new Request("http://localhost/api/health");
    const res = handler(req);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toContain("default-src");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  test("CORS origin matches request origin not wildcard", () => {
    const req = new Request("http://localhost/api/health", {
      headers: { Origin: "http://localhost:8788" },
    });
    const res = handler(req);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:8788");
  });

  test("error responses sanitize key-like patterns", async () => {
    const req = new Request("http://localhost/api/overview?dateRange=sk-mysecretkey12345");
    const res = handler(req);
    expect(res.status).toBe(500);
    const body = await jsonBody(res);
    expect(body.error).not.toContain("sk-mysecretkey12345");
    expect(body.error).toContain("sk-***");
  });
});
