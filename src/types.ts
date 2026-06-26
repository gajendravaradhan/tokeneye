/** Core types for tokeneye — model usage analytics for OpenCode Zen subscriptions */

// ── API Key / Subscription ──
export interface KeyEntry {
  label: string;
  key: string;
  /** Optional rolling budget caps for budget-aware failover. */
  caps?: CapConfig[];
}

/** Rolling budget cap for a subscription key. */
export interface CapConfig {
  /** Rolling window in milliseconds (e.g. 5*60*60*1000 = 5h). */
  window: number;
  /** Max spend in USD within the rolling window. */
  budget: number;
  /** Exhaustion threshold (0-1). Key is exhausted when spent/budget >= threshold. Default 0.99. */
  threshold?: number;
}

/** Result of a budget check on a key. */
export interface KeyCapStatus {
  label: string;
  exhausted: boolean;
  remainingBudget: number;
  details: {
    window: number;
    budget: number;
    spent: number;
    remaining: number;
    percentage: number;
  }[];
}

/** Per-provider configuration */
export interface ProviderConfig {
  upstream: string;
  basePath: string;
  /** When false, forward the full path (including basePath) to upstream. Default: true (strip). */
  stripBasePath?: boolean;
  mode: ProxyMode;
  primary: string;
  failover_status: number[];
  keys: KeyEntry[];
}

export type ProxyMode = "failover" | "balance";

export interface ProxyConfig {
  /** Multi-provider map (new format) */
  providers?: Record<string, ProviderConfig>;
  /** Flattened fields — used when providers is absent (old format) or as defaults */
  upstream: string;
  port: number;
  host: string;
  mode: ProxyMode;
  primary: string;
  failover_status: number[];
  keys: KeyEntry[];
  /** Dashboard port (default: 8788) */
  dashboardPort?: number;
  /** SQLite DB path (default: ~/.config/tokeneye/metrics.db) */
  dbPath?: string;
}

// ── Model Cost Catalog ──
export interface ModelCost {
  /** USD per 1M input tokens */
  input: number;
  /** USD per 1M output tokens */
  output: number;
  /** USD per 1M cache read tokens */
  cache_read: number;
  /** USD per 1M cache write tokens (optional) */
  cache_write?: number;
}

export type ModelCatalog = Record<string, ModelCost>;

// ── Request metadata (captured from incoming request) ──
export interface RequestMeta {
  /** The model being called, e.g. "deepseek/deepseek-v4-pro" */
  model: string;
  /** Stream mode? */
  stream: boolean;
  /** Approximate input token count from request (if available) */
  estimatedInputTokens?: number;
  /** Project context extracted from headers or body */
  project?: string;
  /** Agent/category making the call */
  agent?: string;
}

// ── Metrics Record (stored in SQLite) ──
export interface MetricsRecord {
  id?: number;
  /** ISO-8601 timestamp */
  timestamp: string;
  /** Subscription key label that served this request */
  subscription: string;
  /** Provider name (e.g. "opencode-go", "anthropic", "openai") */
  provider?: string;
  /** Model ID from response, e.g. "deepseek/deepseek-v4-pro" */
  model: string;
  /** Prompt tokens consumed */
  promptTokens: number;
  /** Completion tokens consumed */
  completionTokens: number;
  /** Total tokens */
  totalTokens: number;
  /** Request latency in ms */
  latencyMs: number;
  /** HTTP status code */
  status: number;
  /** Whether streaming was used */
  stream: boolean;
  /** Project context (from header or auto-detected) */
  project?: string;
  /** Agent/category (from request or auto-detected) */
  agent?: string;
  /** Estimated cost in USD (calculated at insert time) */
  estimatedCost?: number;
  /** Cache hit tokens (if provider reports them) */
  cacheHitTokens?: number;
  /** Cache write tokens */
  cacheWriteTokens?: number;
  /** Error message if request failed */
  error?: string;
}

// ── Aggregation Types ──
export type DateRange =
  | "session"
  | "hour"
  | "day"
  | "week"
  | "month"
  | "year"
  | "all"
  | "custom";

export interface CustomDateRange {
  from: string; // ISO-8601
  to: string; // ISO-8601
}

export interface QueryFilters {
  dateRange: DateRange;
  customRange?: CustomDateRange;
  models?: string[];
  subscriptions?: string[];
  providers?: string[];
  projects?: string[];
  agents?: string[];
  status?: "success" | "error" | "all";
}

// ── API Response Types ──
export interface OverviewStats {
  totalRequests: number;
  totalTokens: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCost: number;
  avgLatencyMs: number;
  successRate: number;
  activeModels: number;
  activeSubscriptions: number;
}

export interface ModelBreakdown {
  model: string;
  requests: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  avgLatencyMs: number;
  percentage: number; // % of total tokens
}

export interface SubscriptionBreakdown {
  subscription: string;
  provider?: string;
  requests: number;
  totalTokens: number;
  cost: number;
  successRate: number;
  models: string[];
}

export interface ProjectBreakdown {
  project: string;
  requests: number;
  totalTokens: number;
  cost: number;
  models: ModelBreakdown[];
}

export interface AgentBreakdown {
  agent: string;
  requests: number;
  totalTokens: number;
  cost: number;
  topModel: string;
}

export interface TaskDetail {
  id: number;
  timestamp: string;
  model: string;
  agent: string;
  subscription: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  latency_ms: number;
  status: number;
  project: string;
  error: string | null;
}

export interface TimelinePoint {
  timestamp: string;
  tokens: number;
  cost: number;
  requests: number;
}

export interface HourlyHeatmap {
  hour: number; // 0-23
  day: string; // "Mon"-"Sun"
  tokens: number;
  requests: number;
}

export interface TopConsumer {
  name: string;
  type: "model" | "agent" | "project" | "subscription" | "provider";
  tokens: number;
  cost: number;
  requests: number;
  trend: "up" | "down" | "stable";
}

export interface DashboardData {
  overview: OverviewStats;
  modelBreakdown: ModelBreakdown[];
  subscriptionBreakdown: SubscriptionBreakdown[];
  projectBreakdown: ProjectBreakdown[];
  agentBreakdown: AgentBreakdown[];
  timeline: TimelinePoint[];
  heatmap: HourlyHeatmap[];
  topConsumers: TopConsumer[];
  filters: QueryFilters;
  dateRangeBounds?: {
    from: string;
    to: string;
  };
}

// ── Dashboard API Endpoints ──
export interface ApiEndpoints {
  "/api/overview": { query: QueryFilters; response: OverviewStats };
  "/api/models": { query: QueryFilters; response: ModelBreakdown[] };
  "/api/subscriptions": { query: QueryFilters; response: SubscriptionBreakdown[] };
  "/api/projects": { query: QueryFilters; response: ProjectBreakdown[] };
  "/api/agents": { query: QueryFilters; response: AgentBreakdown[] };
  "/api/tasks": { query: QueryFilters; response: TaskDetail[] };
  "/api/timeline": { query: QueryFilters; response: TimelinePoint[] };
  "/api/heatmap": { query: QueryFilters; response: HourlyHeatmap[] };
  "/api/top-consumers": { query: QueryFilters & { limit?: number }; response: TopConsumer[] };
  "/api/full": { query: QueryFilters; response: DashboardData };
  "/api/health": { query: never; response: { ok: boolean; uptime: number; recordCount: number } };
}
