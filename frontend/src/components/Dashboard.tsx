import { useState, useCallback } from "react";
import type { DashboardData, QueryFilters } from "../types";
import Filters from "./Filters";
import Overview from "./Overview";
import ModelBreakdownTable from "./ModelBreakdown";
import SubscriptionUsage from "./SubscriptionUsage";
import Timeline from "./Timeline";
import Heatmap from "./Heatmap";
import TopConsumers from "./TopConsumers";
import ProjectBreakdownTable from "./ProjectBreakdown";
import AgentBreakdownTable from "./AgentBreakdown";
import CostSummary from "./CostSummary";
import ExportButton from "./ExportButton";

interface Props {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
  filters: QueryFilters;
  onFiltersChange: (f: QueryFilters) => void;
  onRefresh: () => void;
}

type View =
  | "overview"
  | "models"
  | "subscriptions"
  | "projects"
  | "agents"
  | "timeline"
  | "heatmap"
  | "top"
  | "cost";

const NAV: { key: View; label: string; icon: string }[] = [
  { key: "overview", label: "Overview", icon: "📊" },
  { key: "models", label: "Models", icon: "🧠" },
  { key: "subscriptions", label: "Subscriptions", icon: "🔑" },
  { key: "projects", label: "Projects", icon: "📁" },
  { key: "agents", label: "Agents", icon: "🤖" },
  { key: "timeline", label: "Timeline", icon: "📈" },
  { key: "heatmap", label: "Heatmap", icon: "🔥" },
  { key: "top", label: "Top Consumers", icon: "🏆" },
  { key: "cost", label: "Cost", icon: "💰" },
];

export default function Dashboard({
  data,
  loading,
  error,
  filters,
  onFiltersChange,
  onRefresh,
}: Props) {
  const [view, setView] = useState<View>(() => {
    const hash = window.location.hash.replace("#", "") as View;
    return NAV.find((n) => n.key === hash) ? hash : "overview";
  });
  const [dark, setDark] = useState(() => !document.documentElement.classList.contains("light"));

  function navigate(v: View) {
    setView(v);
    window.location.hash = v;
  }

  const toggleTheme = useCallback(() => {
    setDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("light", !next);
      return next;
    });
  }, []);

  function handleModelClick(model: string) {
    onFiltersChange({
      ...filters,
      models: [model],
    });
    navigate("models");
  }

  const now = new Date().toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const hasData = !loading && !error && data;
  const exportData = data ? (data as unknown as Record<string, unknown>) : {};

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          👁 <span>TokenEye</span>
        </div>
        <nav className="sidebar-nav">
          {NAV.map((item) => (
            <a
              key={item.key}
              href={`#${item.key}`}
              className={view === item.key ? "active" : ""}
              onClick={(e) => {
                e.preventDefault();
                navigate(item.key);
              }}
            >
              {item.icon} <span>{item.label}</span>
            </a>
          ))}
        </nav>
      </aside>

      <main className="main-content">
        <div className="top-bar">
          <h1>TokenEye Dashboard</h1>
          <div className="top-bar-right">
            <span style={{ fontSize: "0.85rem", color: "var(--text-dim)" }}>{now}</span>
            <button className="btn btn-sm" onClick={onRefresh} title="Refresh">
              🔄 Refresh
            </button>
            <ExportButton data={exportData} />
            <button className="theme-toggle" onClick={toggleTheme} title="Toggle theme">
              {dark ? "☀" : "🌙"}
            </button>
          </div>
        </div>

        <Filters filters={filters} onChange={onFiltersChange} />

        {error && <div className="error-block">{error}</div>}

        {view === "overview" && (
          <>
            <Overview stats={data?.overview || null} />
            {loading && <div className="loading"><div className="spinner" /> Loading overview...</div>}
            {hasData && (
              <div className="dashboard-grid">
                <div className="card">
                  <div className="card-header">
                    <h3>Model Breakdown</h3>
                    <button className="btn btn-sm" onClick={() => navigate("models")}>
                      View All →
                    </button>
                  </div>
                  <ModelBreakdownTable
                    data={data!.modelBreakdown.slice(0, 5)}
                    loading={false}
                    onModelClick={handleModelClick}
                  />
                </div>
                <div className="card">
                  <div className="card-header">
                    <h3>Subscription Usage</h3>
                    <button className="btn btn-sm" onClick={() => navigate("subscriptions")}>
                      View All →
                    </button>
                  </div>
                  <SubscriptionUsage
                    data={data!.subscriptionBreakdown.slice(0, 5)}
                    loading={false}
                  />
                </div>
                <div className="card col-span">
                  <div className="card-header">
                    <h3>Token Timeline</h3>
                    <button className="btn btn-sm" onClick={() => navigate("timeline")}>
                      Full Timeline →
                    </button>
                  </div>
                  <Timeline
                    data={data!.timeline}
                    loading={false}
                    dateRange={filters.dateRange}
                  />
                </div>
                <div className="card">
                  <div className="card-header">
                    <h3>Top Consumers</h3>
                  </div>
                  <TopConsumers data={data!.topConsumers.slice(0, 5)} loading={false} />
                </div>
                <div className="card">
                  <div className="card-header">
                    <h3>Activity Heatmap</h3>
                    <button className="btn btn-sm" onClick={() => navigate("heatmap")}>
                      Full View →
                    </button>
                  </div>
                  <Heatmap data={data!.heatmap} loading={false} />
                </div>
              </div>
            )}
          </>
        )}

        {view === "models" && (
          <div className="card">
            <div className="card-header">
              <h3>Model Usage Breakdown</h3>
              <small>{data?.modelBreakdown.length || 0} models</small>
            </div>
            <ModelBreakdownTable
              data={data?.modelBreakdown || []}
              loading={loading}
              onModelClick={handleModelClick}
            />
          </div>
        )}

        {view === "subscriptions" && (
          <div className="card">
            <div className="card-header">
              <h3>Subscription Usage</h3>
              <small>{data?.subscriptionBreakdown.length || 0} subscriptions</small>
            </div>
            <SubscriptionUsage
              data={data?.subscriptionBreakdown || []}
              loading={loading}
            />
          </div>
        )}

        {view === "projects" && (
          <div className="card">
            <div className="card-header">
              <h3>Project Breakdown</h3>
              <small>{data?.projectBreakdown.length || 0} projects</small>
            </div>
            <ProjectBreakdownTable
              data={data?.projectBreakdown || []}
              loading={loading}
            />
          </div>
        )}

        {view === "agents" && (
          <div className="card">
            <div className="card-header">
              <h3>Agent Breakdown</h3>
              <small>{data?.agentBreakdown.length || 0} agents</small>
            </div>
            <AgentBreakdownTable
              data={data?.agentBreakdown || []}
              loading={loading}
            />
          </div>
        )}

        {view === "timeline" && (
          <div className="card">
            <div className="card-header">
              <h3>Timeline</h3>
              <small>Tokens & Cost over time</small>
            </div>
            <Timeline
              data={data?.timeline || []}
              loading={loading}
              dateRange={filters.dateRange}
            />
          </div>
        )}

        {view === "heatmap" && (
          <div className="card">
            <div className="card-header">
              <h3>Activity Heatmap</h3>
              <small>24h × 7 day token intensity</small>
            </div>
            <Heatmap data={data?.heatmap || []} loading={loading} />
          </div>
        )}

        {view === "top" && (
          <div className="card">
            <div className="card-header">
              <h3>Top Consumers</h3>
              <small>Ranked by token consumption</small>
            </div>
            <TopConsumers data={data?.topConsumers || []} loading={loading} />
          </div>
        )}

        {view === "cost" && (
          <div className="card">
            <div className="card-header">
              <h3>Cost Summary</h3>
              <small>Total: ${data?.overview.totalCost.toFixed(4) || "0.0000"}</small>
            </div>
            <CostSummary
              modelBreakdown={data?.modelBreakdown || []}
              subscriptionBreakdown={data?.subscriptionBreakdown || []}
              totalCost={data?.overview.totalCost || 0}
              loading={loading}
            />
          </div>
        )}
      </main>
    </div>
  );
}
