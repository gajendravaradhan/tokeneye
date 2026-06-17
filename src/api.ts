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
import {
  sanitizeErrorMessage,
  applySecurityHeaders,
  getAllowedOrigin,
  RateLimiter,
  validateQueryParam,
} from "./security.ts";

export interface Database {
  getOverview(filters: QueryFilters): OverviewStats;
  getModelBreakdown(filters: QueryFilters): ModelBreakdown[];
  getSubscriptionBreakdown(filters: QueryFilters): SubscriptionBreakdown[];
  getProjectBreakdown(filters: QueryFilters): ProjectBreakdown[];
  getAgentBreakdown(filters: QueryFilters): AgentBreakdown[];
  getTimeline(filters: QueryFilters): TimelinePoint[];
  getHeatmap(filters: QueryFilters): HourlyHeatmap[];
  getTopConsumers(filters: QueryFilters, limit: number): TopConsumer[];
  getProviderBreakdown(filters: QueryFilters): { provider: string; requests: number; totalTokens: number; cost: number }[];
  getFilterOptions(): {
    models: string[];
    subscriptions: string[];
    projects: string[];
    agents: string[];
  };
  recordCount(): number;
}

const VALID_DATE_RANGES = new Set(["session", "hour", "day", "week", "month", "year", "all", "custom"]);
const VALID_STATUS = new Set(["all", "success", "error"]);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/;

function json(body: unknown, status: number, corsOrigin: string | null): Response {
  const h = new Headers();
  h.set("Content-Type", "application/json");
  applySecurityHeaders(h, corsOrigin);
  return new Response(JSON.stringify(body), { status, headers: h });
}

function parseArrayParam(value: string | null): string[] | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length > 50) throw new Error("Too many filter values (max 50)");
  for (const p of parts) {
    if (p.length > 200) throw new Error("Filter value too long");
  }
  return parts;
}

function parseFilters(url: URL): QueryFilters {
  const dateRange = validateQueryParam(url.searchParams.get("dateRange")) || "day";
  if (!VALID_DATE_RANGES.has(dateRange)) throw new Error(`Invalid dateRange: ${dateRange}`);

  const customFrom = validateQueryParam(url.searchParams.get("customFrom"));
  const customTo = validateQueryParam(url.searchParams.get("customTo"));
  const models = parseArrayParam(url.searchParams.get("models"));
  const subscriptions = parseArrayParam(url.searchParams.get("subscriptions"));
  const projects = parseArrayParam(url.searchParams.get("projects"));
  const agents = parseArrayParam(url.searchParams.get("agents"));
  const providers = parseArrayParam(url.searchParams.get("providers"));
  const status = validateQueryParam(url.searchParams.get("status")) || "all";
  if (!VALID_STATUS.has(status)) throw new Error(`Invalid status: ${status}`);

  const filters: QueryFilters = { dateRange: dateRange as QueryFilters["dateRange"] };

  if (dateRange === "custom" && customFrom && customTo) {
    if (!ISO_DATE_RE.test(customFrom) || !ISO_DATE_RE.test(customTo)) {
      throw new Error("customFrom and customTo must be ISO-8601 dates");
    }
    filters.customRange = { from: customFrom, to: customTo };
  }
  if (models) filters.models = models;
  if (subscriptions) filters.subscriptions = subscriptions;
  if (projects) filters.projects = projects;
  if (agents) filters.agents = agents;
  if (providers) filters.providers = providers;
  if (status) filters.status = status as QueryFilters["status"];

  return filters;
}

function createRouter(db: Database, startTime: number, rateLimiter: RateLimiter) {
  return function handler(req: Request): Response {
    const url = new URL(req.url);
    const requestOrigin = req.headers.get("origin");
    const corsOrigin = getAllowedOrigin(requestOrigin);

    if (req.method === "OPTIONS") {
      const h = new Headers();
      applySecurityHeaders(h, corsOrigin);
      if (corsOrigin) {
        h.set("Access-Control-Allow-Methods", "GET, OPTIONS");
        h.set("Access-Control-Allow-Headers", "Content-Type");
        h.set("Access-Control-Max-Age", "86400");
      }
      return new Response(null, { status: 204, headers: h });
    }

    const clientIp = req.headers.get("x-forwarded-for") || "127.0.0.1";
    if (!rateLimiter.allow(clientIp)) {
      return json({ error: "Too many requests" }, 429, corsOrigin);
    }

    const path = url.pathname;

    try {
      switch (path) {
        case "/api/health": {
          return json({
            ok: true,
            uptime: Math.floor((Date.now() - startTime) / 1000),
            recordCount: db.recordCount(),
          }, 200, corsOrigin);
        }

        case "/api/overview": {
          return json(db.getOverview(parseFilters(url)), 200, corsOrigin);
        }

        case "/api/models": {
          return json(db.getModelBreakdown(parseFilters(url)), 200, corsOrigin);
        }

        case "/api/subscriptions": {
          return json(db.getSubscriptionBreakdown(parseFilters(url)), 200, corsOrigin);
        }

        case "/api/providers": {
          return json(db.getProviderBreakdown(parseFilters(url)), 200, corsOrigin);
        }

        case "/api/projects": {
          return json(db.getProjectBreakdown(parseFilters(url)), 200, corsOrigin);
        }

        case "/api/agents": {
          return json(db.getAgentBreakdown(parseFilters(url)), 200, corsOrigin);
        }

        case "/api/timeline": {
          return json(db.getTimeline(parseFilters(url)), 200, corsOrigin);
        }

        case "/api/heatmap": {
          return json(db.getHeatmap(parseFilters(url)), 200, corsOrigin);
        }

        case "/api/top-consumers": {
          const filters = parseFilters(url);
          const limit = Math.min(
            Math.max(parseInt(url.searchParams.get("limit") || "10", 10) || 10, 1),
            100,
          );
          return json(db.getTopConsumers(filters, limit), 200, corsOrigin);
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
          return json(data, 200, corsOrigin);
        }

        case "/api/filters": {
          return json(db.getFilterOptions(), 200, corsOrigin);
        }

        default:
          return json({ error: "Not found" }, 404, corsOrigin);
      }
    } catch (err) {
      const message = sanitizeErrorMessage(err);
      return json({ error: message }, 500, corsOrigin);
    }
  };
}

export function createApiHandler(
  db: Database,
): (req: Request) => Response {
  const rateLimiter = new RateLimiter();
  setInterval(() => rateLimiter.cleanup(), 60_000);
  return createRouter(db, Date.now(), rateLimiter);
}

export async function createApiHandlerFromPath(
  dbPath?: string,
): Promise<(req: Request) => Response> {
  const { default: DbClass } = await import("./db.ts");
  const db = new DbClass(dbPath ?? ":memory:");
  return createApiHandler(db);
}
