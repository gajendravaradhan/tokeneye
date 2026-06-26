import { Database as BunDatabase } from "bun:sqlite";
import type {
  AgentBreakdown,
  DateRange,
  HourlyHeatmap,
  MetricsRecord,
  ModelBreakdown,
  OverviewStats,
  ProjectBreakdown,
  QueryFilters,
  SubscriptionBreakdown,
  TaskDetail,
  TimelinePoint,
  TopConsumer,
} from "./types.ts";

// ── Row shape returned by SQLite (snake_case) ──
interface MetricsRow {
  id: number;
  timestamp: string;
  subscription: string;
  provider: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  latency_ms: number;
  status: number;
  stream: number;
  project: string | null;
  agent: string | null;
  estimated_cost: number | null;
  cache_hit_tokens: number | null;
  cache_write_tokens: number | null;
  error: string | null;
}

const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  subscription TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'opencode-go',
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL,
  status INTEGER NOT NULL,
  stream INTEGER NOT NULL DEFAULT 0,
  project TEXT,
  agent TEXT,
  estimated_cost REAL,
  cache_hit_tokens INTEGER DEFAULT 0,
  cache_write_tokens INTEGER DEFAULT 0,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_metrics_model ON metrics(model);
CREATE INDEX IF NOT EXISTS idx_metrics_subscription ON metrics(subscription);
CREATE INDEX IF NOT EXISTS idx_metrics_project ON metrics(project);
CREATE INDEX IF NOT EXISTS idx_metrics_agent ON metrics(agent);
CREATE INDEX IF NOT EXISTS idx_metrics_provider ON metrics(provider);
`;

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const MIGRATIONS = [
  `ALTER TABLE metrics ADD COLUMN provider TEXT NOT NULL DEFAULT 'opencode-go'`,
  `CREATE INDEX IF NOT EXISTS idx_metrics_budget ON metrics(subscription, timestamp)`,
];

export default class Database {
  private db: BunDatabase;

  constructor(path: string) {
    this.db = new BunDatabase(path, { create: true });
    this.db.run("PRAGMA journal_mode=WAL");
    this.db.run("PRAGMA foreign_keys=ON");
    this.db.run(SCHEMA);
    this.runMigrations();
  }

  private runMigrations(): void {
    for (const sql of MIGRATIONS) {
      try { this.db.run(sql); } catch { /* column may already exist */ }
    }
  }

  // ── CRUD ──

  insertMetrics(record: MetricsRecord): number {
    const stmt = this.db.prepare(/* sql */ `
      INSERT INTO metrics
        (timestamp, subscription, provider, model, prompt_tokens, completion_tokens,
         total_tokens, latency_ms, status, stream, project, agent,
         estimated_cost, cache_hit_tokens, cache_write_tokens, error)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
    `);
    const result = stmt.run(
      record.timestamp,
      record.subscription,
      record.provider ?? "opencode-go",
      record.model,
      record.promptTokens,
      record.completionTokens,
      record.totalTokens,
      record.latencyMs,
      record.status,
      record.stream ? 1 : 0,
      record.project ?? null,
      record.agent ?? null,
      record.estimatedCost ?? null,
      record.cacheHitTokens ?? null,
      record.cacheWriteTokens ?? null,
      record.error ?? null,
    );
    return Number(result.lastInsertRowid);
  }

  queryMetrics(filters: QueryFilters): MetricsRecord[] {
    const { clause, params } = this.buildWhereClause(filters);
    const rows = this.db
      .query(`SELECT * FROM metrics ${clause} ORDER BY timestamp DESC`)
      .all(...params) as MetricsRow[];
    return rows.map((r) => this.mapRow(r));
  }

  // ── Aggregates ──

  getRollingWindowCost(subscription: string, windowMs: number): number {
    const cutoff = new Date(Date.now() - windowMs).toISOString();
    const row = this.db
      .query(
        `SELECT COALESCE(SUM(estimated_cost), 0) AS total_cost
         FROM metrics
         WHERE subscription = ? AND timestamp >= ? AND status >= 200 AND status < 300`,
      )
      .get(subscription, cutoff) as { total_cost: number } | null;
    return row?.total_cost ?? 0;
  }

  getOverview(filters: QueryFilters): OverviewStats {
    const { clause, params } = this.buildWhereClause(filters);
    const row = this.db
      .query(
        `SELECT
          COUNT(*)            AS total_requests,
          COALESCE(SUM(total_tokens), 0)      AS total_tokens,
          COALESCE(SUM(prompt_tokens), 0)     AS total_prompt_tokens,
          COALESCE(SUM(completion_tokens), 0) AS total_completion_tokens,
          COALESCE(SUM(estimated_cost), 0)    AS total_cost,
          COALESCE(AVG(latency_ms), 0)        AS avg_latency_ms,
          COALESCE(
            COUNT(CASE WHEN status >= 200 AND status < 400 THEN 1 END) * 100.0 /
            NULLIF(COUNT(*), 0), 0
          )                                    AS success_rate,
          COUNT(DISTINCT model)               AS active_models,
          COUNT(DISTINCT subscription)        AS active_subscriptions
        FROM metrics ${clause}`,
      )
      .get(...params) as {
      total_requests: number;
      total_tokens: number;
      total_prompt_tokens: number;
      total_completion_tokens: number;
      total_cost: number;
      avg_latency_ms: number;
      success_rate: number;
      active_models: number;
      active_subscriptions: number;
    } | null;

    return {
      totalRequests: row?.total_requests ?? 0,
      totalTokens: row?.total_tokens ?? 0,
      totalPromptTokens: row?.total_prompt_tokens ?? 0,
      totalCompletionTokens: row?.total_completion_tokens ?? 0,
      totalCost: row?.total_cost ?? 0,
      avgLatencyMs: Math.round((row?.avg_latency_ms ?? 0) * 100) / 100,
      successRate: Math.round((row?.success_rate ?? 0) * 100) / 100,
      activeModels: row?.active_models ?? 0,
      activeSubscriptions: row?.active_subscriptions ?? 0,
    };
  }

  getModelBreakdown(filters: QueryFilters): ModelBreakdown[] {
    const { clause, params } = this.buildWhereClause(filters);
    const rows = this.db
      .query(
        `SELECT
          model,
          COUNT(*)                                    AS requests,
          COALESCE(SUM(total_tokens), 0)              AS total_tokens,
          COALESCE(SUM(prompt_tokens), 0)             AS prompt_tokens,
          COALESCE(SUM(completion_tokens), 0)         AS completion_tokens,
          COALESCE(SUM(estimated_cost), 0)            AS cost,
          COALESCE(AVG(latency_ms), 0)               AS avg_latency_ms
        FROM metrics ${clause}
        GROUP BY model
        ORDER BY total_tokens DESC`,
      )
      .all(...params) as {
      model: string;
      requests: number;
      total_tokens: number;
      prompt_tokens: number;
      completion_tokens: number;
      cost: number;
      avg_latency_ms: number;
    }[];

    const grandTotal = rows.reduce((sum, r) => sum + r.total_tokens, 0);

    return rows.map((r) => ({
      model: r.model,
      requests: r.requests,
      totalTokens: r.total_tokens,
      promptTokens: r.prompt_tokens,
      completionTokens: r.completion_tokens,
      cost: r.cost,
      avgLatencyMs: Math.round(r.avg_latency_ms * 100) / 100,
      percentage:
        grandTotal > 0
          ? Math.round((r.total_tokens / grandTotal) * 10000) / 100
          : 0,
    }));
  }

  getSubscriptionBreakdown(filters: QueryFilters): SubscriptionBreakdown[] {
    const { clause, params } = this.buildWhereClause(filters);
    const rows = this.db
      .query(
        `SELECT
          subscription,
          COALESCE(provider, 'opencode-go')            AS provider,
          COUNT(*)                                    AS requests,
          COALESCE(SUM(total_tokens), 0)              AS total_tokens,
          COALESCE(SUM(estimated_cost), 0)            AS cost,
          COALESCE(
            COUNT(CASE WHEN status >= 200 AND status < 400 THEN 1 END) * 100.0 /
            NULLIF(COUNT(*), 0), 0
          )                                           AS success_rate,
          GROUP_CONCAT(DISTINCT model)                AS model_list
        FROM metrics ${clause}
        GROUP BY subscription
        ORDER BY total_tokens DESC`,
      )
      .all(...params) as {
      subscription: string;
      provider: string;
      requests: number;
      total_tokens: number;
      cost: number;
      success_rate: number;
      model_list: string | null;
    }[];

    return rows.map((r) => ({
      subscription: r.subscription,
      provider: r.provider,
      requests: r.requests,
      totalTokens: r.total_tokens,
      cost: r.cost,
      successRate: Math.round((r.success_rate ?? 0) * 100) / 100,
      models: r.model_list ? r.model_list.split(",") : [],
    }));
  }

  getProjectBreakdown(filters: QueryFilters): ProjectBreakdown[] {
    const { clause, params } = this.buildWhereClause(filters);
    const rows = this.db
      .query(
        `SELECT
          COALESCE(project, 'unknown')                AS project,
          model,
          COUNT(*)                                    AS requests,
          COALESCE(SUM(total_tokens), 0)              AS total_tokens,
          COALESCE(SUM(estimated_cost), 0)            AS cost
        FROM metrics ${clause}
        GROUP BY project, model
        ORDER BY project, total_tokens DESC`,
      )
      .all(...params) as {
      project: string;
      model: string;
      requests: number;
      total_tokens: number;
      cost: number;
    }[];

    const grouped = new Map<string, ProjectBreakdown>();

    for (const r of rows) {
      let entry = grouped.get(r.project);
      if (!entry) {
        entry = {
          project: r.project,
          requests: 0,
          totalTokens: 0,
          cost: 0,
          models: [],
        };
        grouped.set(r.project, entry);
      }
      entry.requests += r.requests;
      entry.totalTokens += r.total_tokens;
      entry.cost += r.cost;
      entry.models.push({
        model: r.model,
        requests: r.requests,
        totalTokens: r.total_tokens,
        promptTokens: 0,
        completionTokens: 0,
        cost: r.cost,
        avgLatencyMs: 0,
        percentage: 0,
      });
    }

    for (const entry of grouped.values()) {
      const projectTotal = entry.totalTokens;
      for (const m of entry.models) {
        m.percentage =
          projectTotal > 0
            ? Math.round((m.totalTokens / projectTotal) * 10000) / 100
            : 0;
      }
    }

    return [...grouped.values()].sort((a, b) => b.totalTokens - a.totalTokens);
  }

  getAgentBreakdown(filters: QueryFilters): AgentBreakdown[] {
    const { clause, params } = this.buildWhereClause(filters);
    const rows = this.db
      .query(
        `SELECT
          COALESCE(agent, 'unknown')                  AS agent,
          COUNT(*)                                    AS requests,
          COALESCE(SUM(total_tokens), 0)              AS total_tokens,
          COALESCE(SUM(estimated_cost), 0)            AS cost
        FROM metrics ${clause}
        GROUP BY agent
        ORDER BY total_tokens DESC`,
      )
      .all(...params) as {
      agent: string;
      requests: number;
      total_tokens: number;
      cost: number;
    }[];

    const agentTopModels = this.db
      .query(
        `SELECT agent, model, COUNT(*) AS cnt
         FROM metrics ${clause}
         GROUP BY agent, model`,
      )
      .all(...params) as { agent: string | null; model: string; cnt: number }[];

    const topMap = new Map<string, string>();
    const agentMax = new Map<string, number>();

    for (const r of agentTopModels) {
      const key = r.agent ?? "unknown";
      const prev = agentMax.get(key) ?? 0;
      if (r.cnt > prev) {
        agentMax.set(key, r.cnt);
        topMap.set(key, r.model);
      }
    }

    return rows.map((r) => ({
      agent: r.agent,
      requests: r.requests,
      totalTokens: r.total_tokens,
      cost: r.cost,
      topModel: topMap.get(r.agent) ?? "unknown",
    }));
  }

  getTasks(filters: QueryFilters): TaskDetail[] {
    const { clause, params } = this.buildWhereClause(filters);
    const rows = this.db
      .query(
        `SELECT
          id,
          timestamp,
          model,
          COALESCE(agent, 'unknown') AS agent,
          subscription,
          prompt_tokens,
          completion_tokens,
          total_tokens,
          latency_ms,
          status,
          COALESCE(project, 'unknown') AS project,
          error
        FROM metrics ${clause}
        ORDER BY timestamp DESC
        LIMIT 500`,
      )
      .all(...params) as TaskDetail[];

    return rows;
  }

  getTimeline(filters: QueryFilters): TimelinePoint[] {
    const { clause, params } = this.buildWhereClause(filters);
    const grouping = this.timelineGrouping(filters.dateRange);
    const rows = this.db
      .query(
        `SELECT
          strftime('${grouping}', timestamp)          AS bucket,
          COALESCE(SUM(total_tokens), 0)              AS tokens,
          COALESCE(SUM(estimated_cost), 0)           AS cost,
          COUNT(*)                                    AS requests
        FROM metrics ${clause}
        GROUP BY bucket
        ORDER BY bucket`,
      )
      .all(...params) as {
      bucket: string | null;
      tokens: number;
      cost: number;
      requests: number;
    }[];

    return rows
      .filter((r) => r.bucket !== null)
      .map((r) => ({
        timestamp: r.bucket!,
        tokens: r.tokens,
        cost: r.cost,
        requests: r.requests,
      }));
  }

  getHeatmap(filters: QueryFilters): HourlyHeatmap[] {
    const { clause, params } = this.buildWhereClause(filters);
    const rows = this.db
      .query(
        `SELECT
          CAST(strftime('%H', timestamp) AS INTEGER) AS hour,
          strftime('%w', timestamp)                   AS day_num,
          COALESCE(SUM(total_tokens), 0)              AS tokens,
          COUNT(*)                                    AS requests
        FROM metrics ${clause}
        GROUP BY hour, day_num
        ORDER BY day_num, hour`,
      )
      .all(...params) as {
      hour: number;
      day_num: string;
      tokens: number;
      requests: number;
    }[];

    return rows.map((r) => ({
      hour: r.hour,
      day: DAY_NAMES[Number(r.day_num)] ?? "Sun",
      tokens: r.tokens,
      requests: r.requests,
    }));
  }

  getTopConsumers(filters: QueryFilters, limit: number): TopConsumer[] {
    const { clause, params } = this.buildWhereClause(filters);
    const baseParams = [...params, ...params, ...params, ...params, limit];
    const rows = this.db
      .query(
        `SELECT name, type, tokens, cost, requests FROM (
          SELECT model AS name, 'model' AS type,
                 SUM(total_tokens) AS tokens,
                 SUM(estimated_cost) AS cost,
                 COUNT(*) AS requests
          FROM metrics ${clause}
          GROUP BY model
          UNION ALL
          SELECT COALESCE(agent, 'unknown') AS name, 'agent' AS type,
                 SUM(total_tokens) AS tokens,
                 SUM(estimated_cost) AS cost,
                 COUNT(*) AS requests
          FROM metrics ${clause}
          GROUP BY agent
          UNION ALL
          SELECT COALESCE(project, 'unknown') AS name, 'project' AS type,
                 SUM(total_tokens) AS tokens,
                 SUM(estimated_cost) AS cost,
                 COUNT(*) AS requests
          FROM metrics ${clause}
          GROUP BY project
          UNION ALL
          SELECT subscription AS name, 'subscription' AS type,
                 SUM(total_tokens) AS tokens,
                 SUM(estimated_cost) AS cost,
                 COUNT(*) AS requests
          FROM metrics ${clause}
          GROUP BY subscription
        )
        ORDER BY tokens DESC
        LIMIT ?`,
      )
      .all(...baseParams) as {
      name: string;
      type: "model" | "agent" | "project" | "subscription";
      tokens: number;
      cost: number;
      requests: number;
    }[];

    return rows.map((r) => ({
      name: r.name,
      type: r.type,
      tokens: r.tokens,
      cost: r.cost,
      requests: r.requests,
      trend: "stable",
    }));
  }

  getDistinctValues(column: string): string[] {
    const allowed = new Set([
      "model",
      "subscription",
      "provider",
      "project",
      "agent",
    ]);
    if (!allowed.has(column)) {
      throw new Error(`getDistinctValues: invalid column "${column}"`);
    }
    const rows = this.db
      .query(
        `SELECT DISTINCT ${column} FROM metrics WHERE ${column} IS NOT NULL ORDER BY ${column}`,
      )
      .all() as Record<string, string>[];
    return rows.map((r) => r[column]!);
  }

  recordCount(): number {
    const row = this.db.query("SELECT COUNT(*) AS cnt FROM metrics").get() as {
      cnt: number;
    } | null;
    return row?.cnt ?? 0;
  }

  getFilterOptions(): {
    models: string[];
    subscriptions: string[];
    providers: string[];
    projects: string[];
    agents: string[];
  } {
    return {
      models: this.getDistinctValues("model"),
      subscriptions: this.getDistinctValues("subscription"),
      providers: this.getDistinctValues("provider"),
      projects: this.getDistinctValues("project"),
      agents: this.getDistinctValues("agent"),
    };
  }

  getProviderBreakdown(filters: QueryFilters): { provider: string; requests: number; totalTokens: number; cost: number }[] {
    const { clause, params } = this.buildWhereClause(filters);
    const rows = this.db
      .query(`SELECT provider, COUNT(*) as requests, COALESCE(SUM(total_tokens),0) as total_tokens, COALESCE(SUM(estimated_cost),0) as cost FROM metrics ${clause} GROUP BY provider ORDER BY total_tokens DESC`)
      .all(...params) as { provider: string; requests: number; total_tokens: number; cost: number }[];
    return rows.map((r) => ({
      provider: r.provider,
      requests: r.requests,
      totalTokens: r.total_tokens,
      cost: r.cost,
    }));
  }

  close(): void {
    this.db.close();
  }

  // ── Internal helpers ──

  private mapRow(row: MetricsRow): MetricsRecord {
    return {
      id: row.id,
      timestamp: row.timestamp,
      subscription: row.subscription,
      provider: row.provider,
      model: row.model,
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      totalTokens: row.total_tokens,
      latencyMs: row.latency_ms,
      status: row.status,
      stream: row.stream === 1,
      project: row.project ?? undefined,
      agent: row.agent ?? undefined,
      estimatedCost: row.estimated_cost ?? undefined,
      cacheHitTokens: row.cache_hit_tokens ?? undefined,
      cacheWriteTokens: row.cache_write_tokens ?? undefined,
      error: row.error ?? undefined,
    };
  }

  private buildWhereClause(filters: QueryFilters): {
    clause: string;
    params: (string | number)[];
  } {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    const now = new Date();

    // Date range
    switch (filters.dateRange) {
      case "session":
      case "hour": {
        const t = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
        clauses.push("timestamp >= ?");
        params.push(t);
        break;
      }
      case "day": {
        const t = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
        ).toISOString();
        clauses.push("timestamp >= ?");
        params.push(t);
        break;
      }
      case "week": {
        const t = new Date(
          now.getTime() - 7 * 24 * 60 * 60 * 1000,
        ).toISOString();
        clauses.push("timestamp >= ?");
        params.push(t);
        break;
      }
      case "month": {
        const t = new Date(
          now.getTime() - 30 * 24 * 60 * 60 * 1000,
        ).toISOString();
        clauses.push("timestamp >= ?");
        params.push(t);
        break;
      }
      case "year": {
        const t = new Date(
          now.getTime() - 365 * 24 * 60 * 60 * 1000,
        ).toISOString();
        clauses.push("timestamp >= ?");
        params.push(t);
        break;
      }
      case "custom": {
        if (!filters.customRange)
          throw new Error("custom date range required");
        clauses.push("timestamp >= ? AND timestamp <= ?");
        params.push(filters.customRange.from, filters.customRange.to);
        break;
      }
      case "all":
        break;
    }

    // Dimension filters
    const addInFilter = (column: string, values?: string[]) => {
      if (!values || values.length === 0) return;
      if ((column === "agent" || column === "project") && values.includes("unknown")) {
        const concrete = values.filter((value) => value !== "unknown");
        if (concrete.length > 0) {
          clauses.push(`(${column} IN (${concrete.map(() => "?").join(",")}) OR ${column} IS NULL)`);
          params.push(...concrete);
        } else {
          clauses.push(`${column} IS NULL`);
        }
        return;
      }
      clauses.push(`${column} IN (${values.map(() => "?").join(",")})`);
      params.push(...values);
    };

    addInFilter("model", filters.models);
    addInFilter("subscription", filters.subscriptions);
    addInFilter("provider", filters.providers);
    addInFilter("project", filters.projects);
    addInFilter("agent", filters.agents);

    // Status
    if (filters.status === "success") {
      clauses.push("status >= 200 AND status < 400");
    } else if (filters.status === "error") {
      clauses.push("status >= 400");
    }

    const where =
      clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return { clause: where, params };
  }

  private timelineGrouping(dateRange: DateRange): string {
    switch (dateRange) {
      case "session":
      case "hour":
        return "%Y-%m-%dT%H:%M";
      case "day":
        return "%Y-%m-%dT%H:00";
      case "week":
      case "month":
      case "custom":
        return "%Y-%m-%d";
      case "year":
        return "%Y-%W";
      case "all":
        return "%Y-%m";
    }
  }
}
