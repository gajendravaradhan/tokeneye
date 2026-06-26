import type { OverviewStats, SubscriptionBreakdown } from "../types";

interface OverviewProps {
  stats: OverviewStats | null;
  subscriptionBreakdown?: SubscriptionBreakdown[];
}

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: decimals });
}

function fmtMs(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + "s";
  return Math.round(n) + "ms";
}

function normalizeSub(name: string): string {
  const map: Record<string, string> = { default: "Anthropic", passthrough: "Passthrough", unknown: "Unknown" };
  return map[name] || name;
}

const CARDS = [
  { key: "totalRequests", label: "Total Requests", icon: "📨", fmt: (v: number) => fmt(v) },
  { key: "totalTokens", label: "Total Tokens", icon: "🪙", fmt: (v: number) => fmt(v) },
  { key: "totalCost", label: "Total Cost", icon: "💵", fmt: (v: number) => "$" + v.toFixed(4) },
  { key: "avgLatencyMs", label: "Avg Latency", icon: "⏱", fmt: (v: number) => fmtMs(v) },
  { key: "successRate", label: "Success Rate", icon: "✅", fmt: (v: number) => v.toFixed(1) + "%" },
  { key: "activeModels", label: "Active Models", icon: "🧠", fmt: (v: number) => String(v) },
] as const;

const SUB_COLORS = ["var(--accent)", "var(--accent2)", "var(--warn)", "#bc8cff", "#ff7b72"];

export default function Overview({ stats, subscriptionBreakdown }: OverviewProps) {
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
    <>
      <div className="overview-grid">
        {CARDS.map((c) => (
          <div key={c.key} className="stat-card">
            <div className="stat-card-icon">{c.icon}</div>
            <div className="stat-card-value">{c.fmt(stats[c.key] as number)}</div>
            <div className="stat-card-label">{c.label}</div>
          </div>
        ))}
      </div>

      {subscriptionBreakdown && subscriptionBreakdown.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div
            style={{
              fontSize: "0.8rem",
              color: "var(--text-dim)",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: 12,
            }}
          >
            Per Subscription
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 16,
            }}
          >
            {subscriptionBreakdown.map((sub, i) => (
              <div
                key={sub.subscription}
                className="stat-card"
                style={{ borderLeft: `3px solid ${SUB_COLORS[i % SUB_COLORS.length]}` }}
              >
                <div
                  style={{
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    marginBottom: 12,
                    color: "var(--text)",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  🔑 {normalizeSub(sub.subscription)}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{fmt(sub.requests)}</div>
                    <div
                      style={{
                        fontSize: "0.72rem",
                        color: "var(--text-dim)",
                        textTransform: "uppercase",
                        letterSpacing: "0.4px",
                        marginTop: 2,
                      }}
                    >
                      Requests
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{fmt(sub.totalTokens)}</div>
                    <div
                      style={{
                        fontSize: "0.72rem",
                        color: "var(--text-dim)",
                        textTransform: "uppercase",
                        letterSpacing: "0.4px",
                        marginTop: 2,
                      }}
                    >
                      Tokens
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>${sub.cost.toFixed(4)}</div>
                    <div
                      style={{
                        fontSize: "0.72rem",
                        color: "var(--text-dim)",
                        textTransform: "uppercase",
                        letterSpacing: "0.4px",
                        marginTop: 2,
                      }}
                    >
                      Cost
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
