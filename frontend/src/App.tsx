import { useState, useEffect, useCallback } from "react";
import type { QueryFilters, DashboardData } from "./types";
import { fetchFull } from "./api";
import Dashboard from "./components/Dashboard";

const DEFAULT_FILTERS: QueryFilters = { dateRange: "day" };

const REFRESH_INTERVAL_MS = 30_000;

export default function App() {
  const [filters, setFilters] = useState<QueryFilters>(DEFAULT_FILTERS);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (f: QueryFilters) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchFull(f);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard data");
    } finally {
      setLoading(false);
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
      loading={loading}
      error={error}
      filters={filters}
      onFiltersChange={handleFiltersChange}
      onRefresh={handleRefresh}
    />
  );
}
