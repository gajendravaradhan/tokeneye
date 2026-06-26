import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { ModelBreakdown } from "../types";

interface Props {
  data: ModelBreakdown[];
  loading: boolean;
  onModelClick?: (model: string) => void;
  onDrillDown?: (model: string) => void;
  drillEnabled?: boolean;
}

const COLORS = ["#58a6ff", "#3fb950", "#d29922", "#f85149", "#bc8cff", "#79c0ff", "#56d364", "#e3b341", "#ff7b72", "#d2a8ff", "#a5d6ff", "#7ee787"];

type SortKey = keyof ModelBreakdown;
type SortDir = "asc" | "desc";

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: decimals });
}

export default function ModelBreakdownTable({ data, loading, onModelClick, onDrillDown, drillEnabled }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("totalTokens");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sorted = [...data].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (typeof av === "number" && typeof bv === "number") {
      return sortDir === "asc" ? av - bv : bv - av;
    }
    return 0;
  });

  if (loading) return <div className="loading"><div className="spinner" /> Loading models...</div>;
  if (!data.length) return <div className="empty-block">No model data available</div>;

  const chartData = sorted.slice(0, 12).map((m) => ({ name: m.model.split("/").pop() || m.model, tokens: m.totalTokens, full: m.model }));
  const canDrillDown = Boolean(onModelClick);

  return (
    <div>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 100, right: 20, top: 5, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis type="number" tick={{ fill: "var(--text-dim)", fontSize: 11 }} />
          <YAxis type="category" dataKey="name" tick={{ fill: "var(--text-dim)", fontSize: 11 }} width={95} />
          <Tooltip
            contentStyle={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8 }}
            formatter={(value: number) => [fmt(value) + " tokens", ""]}
            labelFormatter={(label: string) => chartData.find((d) => d.name === label)?.full || label}
          />
          <Bar dataKey="tokens" radius={[0, 4, 4, 0]} cursor={canDrillDown ? "pointer" : "default"} onClick={(entry) => onModelClick?.(entry.full)}>
            {chartData.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div className="table-wrapper" style={{ marginTop: 16 }}>
        <table>
          <thead>
            <tr>
              <th onClick={() => handleSort("model")}>
                Model {sortKey === "model" && (sortDir === "asc" ? "▲" : "▼")}
              </th>
              <th className="text-right" onClick={() => handleSort("requests")}>
                Requests {sortKey === "requests" && (sortDir === "asc" ? "▲" : "▼")}
              </th>
              <th className="text-right" onClick={() => handleSort("totalTokens")}>
                Tokens {sortKey === "totalTokens" && (sortDir === "asc" ? "▲" : "▼")}
              </th>
              <th className="text-right" onClick={() => handleSort("cost")}>
                Cost {sortKey === "cost" && (sortDir === "asc" ? "▲" : "▼")}
              </th>
              <th className="text-right" onClick={() => handleSort("avgLatencyMs")}>
                Avg Latency {sortKey === "avgLatencyMs" && (sortDir === "asc" ? "▲" : "▼")}
              </th>
              <th className="text-right" onClick={() => handleSort("percentage")}>
                % of Total {sortKey === "percentage" && (sortDir === "asc" ? "▲" : "▼")}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((m, i) => (
              <tr key={m.model} style={{ cursor: canDrillDown ? "pointer" : "default" }} onClick={() => onModelClick?.(m.model)}>
                <td>
                  <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: COLORS[i % COLORS.length], display: "inline-block", marginRight: 8 }} />
                  {onDrillDown && drillEnabled ? (
                    <span
                      style={{ cursor: "pointer", color: "var(--accent)", textDecoration: "underline dotted" }}
                      onClick={(e) => { e.stopPropagation(); onDrillDown(m.model); }}
                      title="View individual requests"
                    >
                      {m.model}
                    </span>
                  ) : m.model}
                </td>
                <td className="text-right">{fmt(m.requests)}</td>
                <td className="text-right">{fmt(m.totalTokens)}</td>
                <td className="text-right">${m.cost.toFixed(4)}</td>
                <td className="text-right">{Math.round(m.avgLatencyMs)}ms</td>
                <td className="text-right">{m.percentage.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
