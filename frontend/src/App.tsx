import { useState, useEffect, useCallback, useRef, startTransition } from "react";
import type { QueryFilters, DashboardData } from "./types";
import { fetchFull } from "./api";
import Dashboard from "./components/Dashboard";

const DEFAULT_FILTERS: QueryFilters = { dateRange: "day" };

const REFRESH_INTERVAL_MS = 60_000;

export default function App() {
  const [filters, setFilters] = useState<QueryFilters>(DEFAULT_FILTERS);
  const [data, setData] = useState<DashboardData | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;

  const load = useCallback(async (f: QueryFilters) => {
    setError(null);
    if (dataRef.current === null) {
      setInitialLoading(true);
    } else {
      setRefreshing(true);
    }
    try {
      const result = await fetchFull(f);
      startTransition(() => {
        setData(result);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard data");
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(filters);
  }, [filters, load]);

  useEffect(() => {
    const interval = setInterval(() => {
      load(filters);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [filters, load]);

  function handleFiltersChange(f: QueryFilters) {
    setFilters(f);
  }

  function handleRefresh() {
    load(filters);
  }

  return (
    <Dashboard
      data={data}
      loading={initialLoading}
      refreshing={refreshing}
      error={error}
      filters={filters}
      onFiltersChange={handleFiltersChange}
      onRefresh={handleRefresh}
    />
  );
}
