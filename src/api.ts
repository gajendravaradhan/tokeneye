import type {
  AgentBreakdown,
  DashboardData,
  HourlyHeatmap,
  ModelBreakdown,
  OverviewStats,
  ProjectBreakdown,
  QueryFilters,
  SubscriptionBreakdown,
  TimelinePoint,
  TopConsumer,
} from "./types.ts";

export interface Database {
  getOverview(filters: QueryFilters): OverviewStats;
  getModelBreakdown(filters: QueryFilters): ModelBreakdown[];
  getSubscriptionBreakdown(filters: QueryFilters): SubscriptionBreakdown[];
  getProjectBreakdown(filters: QueryFilters): ProjectBreakdown[];
  getAgentBreakdown(filters: QueryFilters): AgentBreakdown[];
  getTimeline(filters: QueryFilters): TimelinePoint[];
  getHeatmap(filters: QueryFilters): HourlyHeatmap[];
  getTopConsumers(filters: QueryFilters, limit: number): TopConsumer[];
  getFilterOptions(): {
    models: string[];
    subscriptions: string[];
    projects: string[];
    agents: string[];
  };
  recordCount(): number;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
  });
}

function parseArrayParam(value: string | null): string[] | undefined {
  if (!value) return undefined;
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseFilters(url: URL): QueryFilters {
  const dateRange = (url.searchParams.get("dateRange") || "day") as QueryFilters["dateRange"];
  const customFrom = url.searchParams.get("customFrom");
  const customTo = url.searchParams.get("customTo");
  const models = parseArrayParam(url.searchParams.get("models"));
  const subscriptions = parseArrayParam(url.searchParams.get("subscriptions"));
  const projects = parseArrayParam(url.searchParams.get("projects"));
  const agents = parseArrayParam(url.searchParams.get("agents"));
  const status = (url.searchParams.get("status") || "all") as QueryFilters["status"];

  const filters: QueryFilters = { dateRange };

  if (customFrom && customTo) {
    filters.customRange = { from: customFrom, to: customTo };
  }
  if (models) filters.models = models;
  if (subscriptions) filters.subscriptions = subscriptions;
  if (projects) filters.projects = projects;
  if (agents) filters.agents = agents;
  if (status) filters.status = status;

  return filters;
}

function createRouter(db: Database, startTime: number) {
  return function handler(req: Request): Response {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(req.url);
    const path = url.pathname;

    try {
      switch (path) {
        case "/api/health": {
          return json({
            ok: true,
            uptime: Math.floor((Date.now() - startTime) / 1000),
            recordCount: db.recordCount(),
          });
        }

        case "/api/overview": {
          return json(db.getOverview(parseFilters(url)));
        }

        case "/api/models": {
          return json(db.getModelBreakdown(parseFilters(url)));
        }

        case "/api/subscriptions": {
          return json(db.getSubscriptionBreakdown(parseFilters(url)));
        }

        case "/api/projects": {
          return json(db.getProjectBreakdown(parseFilters(url)));
        }

        case "/api/agents": {
          return json(db.getAgentBreakdown(parseFilters(url)));
        }

        case "/api/timeline": {
          return json(db.getTimeline(parseFilters(url)));
        }

        case "/api/heatmap": {
          return json(db.getHeatmap(parseFilters(url)));
        }

        case "/api/top-consumers": {
          const filters = parseFilters(url);
          const limit = Math.min(
            Math.max(parseInt(url.searchParams.get("limit") || "10", 10) || 10, 1),
            100,
          );
          return json(db.getTopConsumers(filters, limit));
        }

        case "/api/full": {
          const filters = parseFilters(url);
          const limit = Math.min(
            Math.max(parseInt(url.searchParams.get("limit") || "10", 10) || 10, 1),
            100,
          );

          const data: DashboardData = {
            overview: db.getOverview(filters),
            modelBreakdown: db.getModelBreakdown(filters),
            subscriptionBreakdown: db.getSubscriptionBreakdown(filters),
            projectBreakdown: db.getProjectBreakdown(filters),
            agentBreakdown: db.getAgentBreakdown(filters),
            timeline: db.getTimeline(filters),
            heatmap: db.getHeatmap(filters),
            topConsumers: db.getTopConsumers(filters, limit),
            filters,
          };
          return json(data);
        }

        case "/api/filters": {
          return json(db.getFilterOptions());
        }

        default:
          return json({ error: "Not found" }, 404);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal server error";
      return json({ error: message }, 500);
    }
  };
}

export function createApiHandler(
  db: Database,
): (req: Request) => Response {
  return createRouter(db, Date.now());
}

export async function createApiHandlerFromPath(
  dbPath?: string,
): Promise<(req: Request) => Response> {
  // @ts-expect-error db.ts may not exist yet — dynamic import at runtime
  const { Database: DbClass } = await import("./db.ts");
  const db = new DbClass(dbPath);
  return createApiHandler(db);
}
