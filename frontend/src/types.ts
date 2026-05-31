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
  from: string;
  to: string;
}

export interface QueryFilters {
  dateRange: DateRange;
  customRange?: CustomDateRange;
  models?: string[];
  subscriptions?: string[];
  projects?: string[];
  agents?: string[];
  status?: "success" | "error" | "all";
}

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
  percentage: number;
}

export interface SubscriptionBreakdown {
  subscription: string;
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

export interface TimelinePoint {
  timestamp: string;
  tokens: number;
  cost: number;
  requests: number;
}

export interface HourlyHeatmap {
  hour: number;
  day: string;
  tokens: number;
  requests: number;
}

export interface TopConsumer {
  name: string;
  type: "model" | "agent" | "project" | "subscription";
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
}

export interface FilterOptions {
  models: string[];
  subscriptions: string[];
  projects: string[];
  agents: string[];
}
