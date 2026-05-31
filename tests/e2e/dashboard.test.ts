import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { createApiHandler } from "../../src/api.ts";
import Database from "../../src/db.ts";
import type { QueryFilters } from "../../src/types.ts";

const DASHBOARD_PORT = 18788;
const BASE_URL = `http://localhost:${DASHBOARD_PORT}`;

const INLINE_HTML_PREFIX = "<!DOCTYPE html>\n<html lang=\"en\">";

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

describe("dashboard e2e", () => {
  let server: ReturnType<typeof Bun.serve>;
  let db: Database;

  beforeAll(() => {
    db = new Database(":memory:");

    db.insertMetrics({
      timestamp: new Date().toISOString(),
      subscription: "test-sub",
      model: "openai/gpt-4o",
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      latencyMs: 200,
      status: 200,
      stream: false,
      project: "web",
      agent: "coder",
      estimatedCost: 0.00075,
    });

    const apiHandler = createApiHandler(makeApiDb(db));

    server = Bun.serve({
      port: DASHBOARD_PORT,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname.startsWith("/api/")) return apiHandler(req);
        return new Response(INLINE_HTML_PREFIX, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    });
  });

  afterAll(() => {
    server.stop();
    db.close();
  });

  test("serves inline HTML dashboard at /", async () => {
    const res = await fetch(`${BASE_URL}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("<!DOCTYPE html>");
    expect(body).toContain("<html");
  });

  test("GET /api/health returns uptime and recordCount through dashboard server", async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.uptime).toBe("number");
    expect(body.recordCount).toBe(1);
  });

  test("GET /api/overview returns data through dashboard server", async () => {
    const res = await fetch(`${BASE_URL}/api/overview?dateRange=all`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.totalRequests).toBe(1);
    expect(body.totalTokens).toBe(150);
  });

  test("CORS headers present on API responses through dashboard", async () => {
    const res = await fetch(`${BASE_URL}/api/overview?dateRange=all`, { headers: { origin: "http://localhost:3000" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });

  test("OPTIONS preflight returns CORS headers through dashboard", async () => {
    const res = await fetch(`${BASE_URL}/api/health`, { method: "OPTIONS", headers: { origin: "http://localhost:3000" } });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
  });

  test("dashboard HTML page returns valid HTML", async () => {
    const res = await fetch(`${BASE_URL}/`);
    const body = await res.text();
    expect(body).toContain("<!DOCTYPE html>");
    expect(res.headers.get("content-type")).toContain("text/html");
  });
});
