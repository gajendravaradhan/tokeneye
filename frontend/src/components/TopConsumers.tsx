import type { TopConsumer } from "../types";

interface Props {
  data: TopConsumer[];
  loading: boolean;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function trendIcon(trend: string): string {
  if (trend === "up") return "↑";
  if (trend === "down") return "↓";
  return "stable";
}

export default function TopConsumers({ data, loading }: Props) {
  if (loading) return <div className="loading"><div className="spinner" /> Loading top consumers...</div>;
  if (!data.length) return <div className="empty-block">No consumer data available</div>;

  const maxTokens = Math.max(...data.map((d) => d.tokens), 1);

  return (
    <div>
      <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginBottom: 12, display: "flex", gap: 14 }}>
        <span>Trend:</span>
        <span className="trend-up">↑ increasing</span>
        <span className="trend-down">↓ decreasing</span>
        <span className="trend-stable">· stable</span>
      </div>
      {data.map((item, i) => (
        <div key={item.name} style={{ display: "flex", alignItems: "center", marginBottom: 12, gap: 12 }}>
          <span style={{ width: 24, textAlign: "right", fontWeight: 700, color: "var(--text-dim)", fontSize: "0.85rem" }}>
            #{i + 1}
          </span>
          <span style={{ minWidth: 160, fontSize: "0.9rem", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.name}
          </span>
          <span className={`badge badge-${item.type}`}>{item.type}</span>
          <div style={{ flex: 1, minWidth: 100 }}>
            <div className="bar-track">
              <div
                className="bar-fill"
                style={{
                  width: `${(item.tokens / maxTokens) * 100}%`,
                  backgroundColor:
                    item.trend === "up"
                      ? "var(--accent2)"
                      : item.trend === "down"
                        ? "var(--err)"
                        : "var(--accent)",
                }}
              />
            </div>
          </div>
          <span style={{ fontSize: "0.9rem", fontWeight: 600, minWidth: 100, textAlign: "right" }}>
            {fmt(item.tokens)}
          </span>
          <span style={{ fontSize: "0.85rem", color: "var(--text-dim)", minWidth: 80, textAlign: "right" }}>
            ${item.cost.toFixed(4)}
          </span>
          <span className={`trend-${item.trend}`} style={{ fontSize: item.trend === "stable" ? "0.8rem" : "1.1rem", minWidth: 52, textAlign: "center" }}>
            {trendIcon(item.trend)}
          </span>
        </div>
      ))}
    </div>
  );
}
