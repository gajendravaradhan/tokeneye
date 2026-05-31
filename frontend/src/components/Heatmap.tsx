import { useState } from "react";
import type { HourlyHeatmap } from "../types";

interface Props {
  data: HourlyHeatmap[];
  loading: boolean;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const HEAT_COLORS = [
  "var(--heat0)",
  "var(--heat1)",
  "var(--heat2)",
  "var(--heat3)",
  "#7ee787",
];

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export default function Heatmap({ data, loading }: Props) {
  const [hovered, setHovered] = useState<{ day: string; hour: number; tokens: number; requests: number } | null>(null);

  if (loading) return <div className="loading"><div className="spinner" /> Loading heatmap...</div>;
  if (!data.length) return <div className="empty-block">No heatmap data available</div>;

  const maxTokens = Math.max(...data.map((d) => d.tokens), 1);

  function getBucket(tokens: number): number {
    if (tokens === 0) return 0;
    const pct = tokens / maxTokens;
    if (pct < 0.2) return 1;
    if (pct < 0.4) return 2;
    if (pct < 0.7) return 3;
    return 4;
  }

  function lookup(day: string, hour: number): HourlyHeatmap | undefined {
    return data.find((d) => d.day === day && d.hour === hour);
  }

  return (
    <div>
      <div className="heatmap-grid">
        <div />
        {HOURS.map((h) => (
          <div key={h} className="heatmap-header">
            {h.toString().padStart(2, "0")}
          </div>
        ))}
        {DAYS.map((day) => (
          <>
            <div key={`label-${day}`} className="heatmap-label">
              {day}
            </div>
            {HOURS.map((hour) => {
              const cell = lookup(day, hour);
              const tokens = cell?.tokens || 0;
              const bucket = getBucket(tokens);
              return (
                <div
                  key={`${day}-${hour}`}
                  className="heatmap-cell"
                  style={{ backgroundColor: HEAT_COLORS[bucket] }}
                  onMouseEnter={() =>
                    setHovered({
                      day,
                      hour,
                      tokens,
                      requests: cell?.requests || 0,
                    })
                  }
                  onMouseLeave={() => setHovered(null)}
                >
                  {hovered?.day === day && hovered?.hour === hour && (
                    <div className="heatmap-tooltip">
                      <strong>
                        {day} {hour.toString().padStart(2, "0")}:00
                      </strong>
                      <br />
                      {fmt(tokens)} tokens
                      <br />
                      {fmt(hovered.requests)} requests
                    </div>
                  )}
                </div>
              );
            })}
          </>
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
        <span style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>Less</span>
        {HEAT_COLORS.map((c, i) => (
          <div key={i} style={{ width: 14, height: 14, backgroundColor: c, borderRadius: 3 }} />
        ))}
        <span style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>More</span>
      </div>
    </div>
  );
}
