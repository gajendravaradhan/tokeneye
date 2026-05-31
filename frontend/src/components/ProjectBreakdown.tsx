import { useState } from "react";
import type { ProjectBreakdown } from "../types";

interface Props {
  data: ProjectBreakdown[];
  loading: boolean;
}

type SortKey = "project" | "requests" | "totalTokens" | "cost";
type SortDir = "asc" | "desc";

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export default function ProjectBreakdownTable({ data, loading }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("totalTokens");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  if (loading) return <div className="loading"><div className="spinner" /> Loading projects...</div>;
  if (!data.length) return <div className="empty-block">No project data available</div>;

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function getVal(p: ProjectBreakdown, key: SortKey): number | string {
    if (key === "project") return p.project;
    return p[key] as number;
  }

  const sorted = [...data].sort((a, b) => {
    const av = getVal(a, sortKey);
    const bv = getVal(b, sortKey);
    const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
    return sortDir === "asc" ? cmp : -cmp;
  });

  function toggle(p: string) {
    const next = new Set(expanded);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    setExpanded(next);
  }

  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            <th style={{ width: 30 }} />
            <th onClick={() => handleSort("project")}>
              Project {sortKey === "project" && (sortDir === "asc" ? "▲" : "▼")}
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
            <th className="text-right">Models</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => {
            const open = expanded.has(p.project);
            return (
              <>
                <tr key={p.project} className="expand-row" onClick={() => toggle(p.project)}>
                  <td>
                    <span className={`expand-icon ${open ? "open" : ""}`}>▶</span>
                  </td>
                  <td style={{ fontWeight: 600 }}>{p.project}</td>
                  <td className="text-right">{fmt(p.requests)}</td>
                  <td className="text-right">{fmt(p.totalTokens)}</td>
                  <td className="text-right">${p.cost.toFixed(4)}</td>
                  <td className="text-right">{p.models.length}</td>
                </tr>
                {open &&
                  p.models.map((m) => (
                    <tr key={`${p.project}-${m.model}`} style={{ background: "var(--bg)" }}>
                      <td />
                      <td style={{ paddingLeft: 32 }}>
                        <span className="badge badge-model">{m.model}</span>
                      </td>
                      <td className="text-right">{fmt(m.requests)}</td>
                      <td className="text-right">{fmt(m.totalTokens)}</td>
                      <td className="text-right">${m.cost.toFixed(4)}</td>
                      <td className="text-right">{m.percentage.toFixed(1)}%</td>
                    </tr>
                  ))}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
