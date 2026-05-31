import type { OverviewStats } from "../types";

interface OverviewProps {
  stats: OverviewStats | null;
}

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: decimals });
}

function fmtMs(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + "s";
  return Math.round(n) + "ms";
}

const CARDS = [
  { key: "totalRequests", label: "Total Requests", icon: "📨", fmt: (v: number) => fmt(v) },
  { key: "totalTokens", label: "Total Tokens", icon: "🪙", fmt: (v: number) => fmt(v) },
  { key: "totalCost", label: "Total Cost", icon: "💵", fmt: (v: number) => "$" + v.toFixed(4) },
  { key: "avgLatencyMs", label: "Avg Latency", icon: "⏱", fmt: (v: number) => fmtMs(v) },
  { key: "successRate", label: "Success Rate", icon: "✅", fmt: (v: number) => v.toFixed(1) + "%" },
  { key: "activeModels", label: "Active Models", icon: "🧠", fmt: (v: number) => String(v) },
] as const;

export default function Overview({ stats }: OverviewProps) {
  if (!stats)
    return (
      <div className="overview-grid">
        {CARDS.map((c) => (
          <div key={c.key} className="stat-card">
            <div className="stat-card-icon">{c.icon}</div>
            <div className="stat-card-value" style={{ color: "var(--text-dim)" }}>
              —
            </div>
            <div className="stat-card-label">{c.label}</div>
          </div>
        ))}
      </div>
    );

  return (
    <div className="overview-grid">
      {CARDS.map((c) => (
        <div key={c.key} className="stat-card">
          <div className="stat-card-icon">{c.icon}</div>
          <div className="stat-card-value">{c.fmt(stats[c.key] as number)}</div>
          <div className="stat-card-label">{c.label}</div>
        </div>
      ))}
    </div>
  );
}
