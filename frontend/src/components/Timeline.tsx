import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { format, parseISO } from "date-fns";
import type { TimelinePoint } from "../types";

interface Props {
  data: TimelinePoint[];
  loading: boolean;
  dateRange: string;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

export default function Timeline({ data, loading, dateRange }: Props) {
  if (loading) return <div className="loading"><div className="spinner" /> Loading timeline...</div>;
  if (!data.length) return <div className="empty-block">No timeline data available</div>;

  function formatTime(ts: string): string {
    try {
      const d = parseISO(ts);
      if (dateRange === "hour" || dateRange === "session") return format(d, "HH:mm");
      if (dateRange === "day") return format(d, "HH:mm");
      if (dateRange === "week") return format(d, "EEE dd");
      if (dateRange === "month") return format(d, "MMM dd");
      if (dateRange === "year") return format(d, "MMM yyyy");
      return format(d, "MMM dd HH:mm");
    } catch {
      return ts;
    }
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <AreaChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
        <defs>
          <linearGradient id="tokensGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--accent2)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--accent2)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="timestamp"
          tickFormatter={formatTime}
          tick={{ fill: "var(--text-dim)", fontSize: 11 }}
          minTickGap={40}
        />
        <YAxis
          yAxisId="left"
          tick={{ fill: "var(--text-dim)", fontSize: 11 }}
          tickFormatter={(v: number) => v >= 1e6 ? (v / 1e6).toFixed(1) + "M" : v >= 1e3 ? (v / 1e3).toFixed(0) + "K" : String(v)}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tick={{ fill: "var(--text-dim)", fontSize: 11 }}
          tickFormatter={(v: number) => "$" + v.toFixed(2)}
        />
        <Tooltip
          contentStyle={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 8 }}
          labelFormatter={(label: string) => formatTime(label)}
          formatter={(value: number, name: string) => [
            name === "cost" ? "$" + value.toFixed(4) : fmt(value),
            name === "tokens" ? "Tokens" : "Cost",
          ]}
        />
        <Area
          yAxisId="left"
          type="monotone"
          dataKey="tokens"
          stroke="var(--accent)"
          strokeWidth={2}
          fill="url(#tokensGrad)"
          name="tokens"
        />
        <Area
          yAxisId="right"
          type="monotone"
          dataKey="cost"
          stroke="var(--accent2)"
          strokeWidth={2}
          fill="url(#costGrad)"
          name="cost"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
