import { useState } from "react";
import type { AgentBreakdown } from "../types";

interface Props {
  data: AgentBreakdown[];
  loading: boolean;
}

type SortKey = "agent" | "requests" | "totalTokens" | "cost" | "topModel";
type SortDir = "asc" | "desc";

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export default function AgentBreakdownTable({ data, loading }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("totalTokens");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  if (loading) return <div className="loading"><div className="spinner" /> Loading agents...</div>;
  if (!data.length) return <div className="empty-block">No agent data available</div>;

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function getVal(a: AgentBreakdown, key: SortKey): number | string {
    if (key === "agent" || key === "topModel") return a[key] || "";
    return a[key] as number;
  }

  const sorted = [...data].sort((a, b) => {
    const av = getVal(a, sortKey);
    const bv = getVal(b, sortKey);
    const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
    return sortDir === "asc" ? cmp : -cmp;
  });

  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th onClick={() => handleSort("agent")}>
              Agent {sortKey === "agent" && (sortDir === "asc" ? "▲" : "▼")}
            </th>
            <th className="text-right" onClick={() => handleSort("requests")}>
              Requests {sortKey === "requests" && (sortDir === "asc" ? "▲" : "▼")}
            </th>
            <th className="text-right" onClick={() => handleSort("totalTokens")}>
              Total Tokens {sortKey === "totalTokens" && (sortDir === "asc" ? "▲" : "▼")}
            </th>
            <th className="text-right" onClick={() => handleSort("cost")}>
              Cost {sortKey === "cost" && (sortDir === "asc" ? "▲" : "▼")}
            </th>
            <th onClick={() => handleSort("topModel")}>
              Top Model {sortKey === "topModel" && (sortDir === "asc" ? "▲" : "▼")}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((a) => (
            <tr key={a.agent}>
              <td style={{ fontWeight: 500 }}>{a.agent}</td>
              <td className="text-right">{fmt(a.requests)}</td>
              <td className="text-right">{fmt(a.totalTokens)}</td>
              <td className="text-right">${a.cost.toFixed(4)}</td>
              <td>
                <span className="badge badge-model">{a.topModel}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
