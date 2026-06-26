import type {
  QueryFilters,
  OverviewStats,
  ModelBreakdown,
  SubscriptionBreakdown,
  ProjectBreakdown,
  AgentBreakdown,
  TimelinePoint,
  HourlyHeatmap,
  TopConsumer,
  DashboardData,
  FilterOptions,
  TaskDetail,
  TaskFilters,
} from "./types";

function buildQuery(filters: QueryFilters): string {
  const params = new URLSearchParams();
  params.set("dateRange", filters.dateRange);
  if (filters.customRange) {
    params.set("from", filters.customRange.from);
    params.set("to", filters.customRange.to);
  }
  if (filters.models?.length) params.set("models", filters.models.join(","));
  if (filters.subscriptions?.length)
    params.set("subscriptions", filters.subscriptions.join(","));
  if (filters.projects?.length)
    params.set("projects", filters.projects.join(","));
  if (filters.agents?.length)
    params.set("agents", filters.agents.join(","));
  if (filters.status) params.set("status", filters.status);
  return params.toString();
}

async function fetchApi<T>(path: string, filters: QueryFilters): Promise<T> {
  const qs = buildQuery(filters);
  const url = `/api${path}${qs ? "?" + qs : ""}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${path} failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function buildTaskQuery(filters: TaskFilters): string {
  const params = new URLSearchParams();
  params.set("dateRange", filters.dateRange);
  if (filters.model) params.set("model", filters.model);
  if (filters.agent) params.set("agent", filters.agent);
  if (filters.status) params.set("status", filters.status);
  return params.toString();
}

export function fetchOverview(filters: QueryFilters): Promise<OverviewStats> {
  return fetchApi<OverviewStats>("/overview", filters);
}

export function fetchModelBreakdown(
  filters: QueryFilters
): Promise<ModelBreakdown[]> {
  return fetchApi<ModelBreakdown[]>("/models", filters);
}

export function fetchSubscriptionBreakdown(
  filters: QueryFilters
): Promise<SubscriptionBreakdown[]> {
  return fetchApi<SubscriptionBreakdown[]>("/subscriptions", filters);
}

export function fetchProjectBreakdown(
  filters: QueryFilters
): Promise<ProjectBreakdown[]> {
  return fetchApi<ProjectBreakdown[]>("/projects", filters);
}

export function fetchAgentBreakdown(
  filters: QueryFilters
): Promise<AgentBreakdown[]> {
  return fetchApi<AgentBreakdown[]>("/agents", filters);
}

export async function fetchTasks(filters: TaskFilters): Promise<TaskDetail[]> {
  const qs = buildTaskQuery(filters);
  const res = await fetch(`/api/tasks${qs ? "?" + qs : ""}`);
  if (!res.ok) {
    throw new Error(`tasks failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export function fetchTimeline(
  filters: QueryFilters
): Promise<TimelinePoint[]> {
  return fetchApi<TimelinePoint[]>("/timeline", filters);
}

export function fetchHeatmap(
  filters: QueryFilters
): Promise<HourlyHeatmap[]> {
  return fetchApi<HourlyHeatmap[]>("/heatmap", filters);
}

export function fetchTopConsumers(
  filters: QueryFilters,
  limit = 10
): Promise<TopConsumer[]> {
  const qs = buildQuery(filters);
  const lim = `limit=${limit}`;
  const full = qs ? `${qs}&${lim}` : lim;
  return fetchApi<TopConsumer[]>(`/top-consumers?${full}`, filters);
}

export function fetchFull(filters: QueryFilters): Promise<DashboardData> {
  return fetchApi<DashboardData>("/full", filters);
}

export async function fetchFilters(): Promise<FilterOptions> {
  const res = await fetch("/api/filters");
  if (!res.ok) throw new Error("Failed to fetch filter options");
  return res.json();
}

export interface ProxyConfigState {
  mode: string;
  primary: string;
  keys: { label: string; caps: { window: number; budget: number; threshold?: number }[] }[];
}

export async function fetchProxyConfig(): Promise<ProxyConfigState> {
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error(`config failed: ${res.status}`);
  return res.json();
}

export async function updateProxyConfig(body: { mode?: string; primary?: string }): Promise<void> {
  const res = await fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`config update failed: ${res.status}`);
}
