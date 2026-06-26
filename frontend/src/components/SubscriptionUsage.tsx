import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from "recharts";
import type { SubscriptionBreakdown } from "../types";

interface Props {
  data: SubscriptionBreakdown[];
  loading: boolean;
}

const COLORS = ["#58a6ff", "#3fb950", "#d29922", "#f85149", "#bc8cff", "#79c0ff", "#56d364", "#e3b341", "#ff7b72", "#d2a8ff"];

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function normalizeSub(name: string): string {
  const map: Record<string, string> = { default: "Anthropic", passthrough: "Passthrough", unknown: "Unknown" };
  return map[name] || name;
}

export default function SubscriptionUsage({ data, loading }: Props) {
  if (loading) return <div className="loading"><div className="spinner" /> Loading subscriptions...</div>;
  if (!data.length) return <div className="empty-block">No subscription data available</div>;

  const chartData = data.map((s) => ({ name: normalizeSub(s.subscription), value: s.totalTokens }));

  return (
    <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
      <div style={{ flex: "0 0 280px" }}>
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              dataKey="value"
              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              labelLine={false}
            >
              {chartData.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <RechartsTooltip
              contentStyle={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8 }}
              formatter={(value: number) => [fmt(value) + " tokens", ""]}
            />
            <Legend iconType="rect" />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div style={{ flex: 1, minWidth: 300 }}>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Subscription</th>
                <th className="text-right">Requests</th>
                <th className="text-right">Tokens</th>
                <th className="text-right">Cost</th>
                <th className="text-right">Success Rate</th>
                <th>Models</th>
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.subscription}>
                  <td>{normalizeSub(s.subscription)}</td>
                  <td className="text-right">{fmt(s.requests)}</td>
                  <td className="text-right">{fmt(s.totalTokens)}</td>
                  <td className="text-right">${s.cost.toFixed(4)}</td>
                  <td className="text-right">{(s.successRate * 100).toFixed(1)}%</td>
                  <td>
                    {s.models.slice(0, 3).map((m) => (
                      <span key={m} className="badge badge-model" style={{ marginRight: 4 }}>
                        {m.split("/").pop()}
                      </span>
                    ))}
                    {s.models.length > 3 && <span className="badge">+{s.models.length - 3}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
