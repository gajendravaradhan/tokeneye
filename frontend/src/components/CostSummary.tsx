import { useMemo } from "react";
import type { ModelBreakdown, SubscriptionBreakdown } from "../types";

interface Props {
  modelBreakdown: ModelBreakdown[];
  subscriptionBreakdown: SubscriptionBreakdown[];
  totalCost: number;
  loading: boolean;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export default function CostSummary({ modelBreakdown, subscriptionBreakdown, totalCost, loading }: Props) {
  const projectedMonthly = useMemo(() => {
    if (!totalCost) return 0;
    return totalCost * 30;
  }, [totalCost]);

  if (loading) return <div className="loading"><div className="spinner" /> Loading cost data...</div>;
  if (!modelBreakdown.length && !subscriptionBreakdown.length)
    return <div className="empty-block">No cost data available</div>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
      <div>
        <div style={{ display: "flex", gap: 16, marginBottom: 20 }}>
          <div className="stat-card" style={{ flex: 1 }}>
            <div className="stat-card-icon">💰</div>
            <div className="stat-card-value">${totalCost.toFixed(4)}</div>
            <div className="stat-card-label">Total Cost</div>
          </div>
          <div className="stat-card" style={{ flex: 1 }}>
            <div className="stat-card-icon">📅</div>
            <div className="stat-card-value">${projectedMonthly.toFixed(2)}</div>
            <div className="stat-card-label">Projected Monthly</div>
          </div>
        </div>
        <h4 style={{ marginBottom: 10, fontSize: "0.9rem" }}>Cost by Model</h4>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Model</th>
                <th className="text-right">Tokens</th>
                <th className="text-right">Cost</th>
                <th className="text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {modelBreakdown.slice(0, 10).map((m) => (
                <tr key={m.model}>
                  <td>{m.model}</td>
                  <td className="text-right">{fmt(m.totalTokens)}</td>
                  <td className="text-right">${m.cost.toFixed(4)}</td>
                  <td className="text-right">{m.percentage.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <h4 style={{ marginBottom: 10, fontSize: "0.9rem" }}>Cost by Subscription</h4>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Subscription</th>
                <th className="text-right">Tokens</th>
                <th className="text-right">Cost</th>
                <th className="text-right">Success</th>
              </tr>
            </thead>
            <tbody>
              {subscriptionBreakdown.map((s) => (
                <tr key={s.subscription}>
                  <td>{s.subscription}</td>
                  <td className="text-right">{fmt(s.totalTokens)}</td>
                  <td className="text-right">${s.cost.toFixed(4)}</td>
                  <td className="text-right">{(s.successRate * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
