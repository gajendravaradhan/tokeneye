import { useState, useRef, useEffect } from "react";
import type { QueryFilters, DateRange, FilterOptions } from "../types";
import { fetchFilters } from "../api";

interface FiltersProps {
  filters: QueryFilters;
  onChange: (f: QueryFilters) => void;
  dateRangeBounds?: { from: string; to: string };
}

const DATE_RANGE_OPTIONS: { value: DateRange; label: string }[] = [
  { value: "session", label: "Session" },
  { value: "hour", label: "Hour" },
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
  { value: "all", label: "All Time" },
  { value: "custom", label: "Custom" },
];

function normalizeSub(name: string): string {
  const map: Record<string, string> = { default: "Anthropic", passthrough: "Passthrough", unknown: "Unknown" };
  return map[name] || name;
}

function fmtBound(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Filters({ filters, onChange, dateRangeBounds }: FiltersProps) {
  const [options, setOptions] = useState<FilterOptions>({ models: [], subscriptions: [], projects: [], agents: [] });
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [customPickerOpen, setCustomPickerOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchFilters()
      .then(setOptions)
      .catch(() => {});
  }, []);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
        setCustomPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function set<K extends keyof QueryFilters>(key: K, value: QueryFilters[K]) {
    const next = { ...filters };
    if (key === "dateRange" && value !== "custom") {
      delete next.customRange;
      setCustomPickerOpen(false);
    }
    if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) {
      delete next[key];
    } else {
      (next as Record<string, unknown>)[key] = value;
    }
    onChange(next);
  }

  function toggleArrayItem(key: "models" | "subscriptions" | "projects" | "agents", item: string) {
    const current = filters[key] || [];
    const next = current.includes(item) ? current.filter((x) => x !== item) : [...current, item];
    set(key, next.length > 0 ? next : undefined);
  }

  function renderMultiSelect(
    key: "models" | "subscriptions" | "projects" | "agents",
    label: string,
    icon: string
  ) {
    const selected = filters[key] || [];
    const all = options[key];
    const isOpen = openDropdown === key;
    return (
      <div className="multi-select">
        <button
          className="multi-select-trigger"
          onClick={() => setOpenDropdown(isOpen ? null : key)}
        >
          {icon} {label}
          {selected.length > 0 && <span className="count">{selected.length}</span>}
          <span style={{ fontSize: "0.7rem", marginLeft: "auto" }}>{isOpen ? "▲" : "▼"}</span>
        </button>
        {isOpen && (
          <div className="multi-select-dropdown">
            {all.length === 0 && <div style={{ padding: "12px", color: "var(--text-dim)" }}>None available</div>}
            {all.map((item) => (
              <label key={item}>
                <input
                  type="checkbox"
                  checked={selected.includes(item)}
                  onChange={() => toggleArrayItem(key, item)}
                />
                {key === "subscriptions" ? normalizeSub(item) : item}
              </label>
            ))}
          </div>
        )}
      </div>
    );
  }

  const customLabel = filters.customRange
    ? `${filters.customRange.from.slice(0, 10)} → ${filters.customRange.to.slice(0, 10)}`
    : "Select dates";

  return (
    <div className="filter-bar" ref={barRef}>
      <div>
        <label>Period</label>
        <select
          value={filters.dateRange}
          onChange={(e) => set("dateRange", e.target.value as DateRange)}
        >
          {DATE_RANGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {dateRangeBounds && filters.dateRange !== "custom" && (
          <div
            style={{
              marginTop: 6,
              padding: "4px 8px",
              background: "var(--bg-hover)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              fontSize: "0.8rem",
              color: "var(--text)",
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ color: "var(--text-dim)", marginRight: 4 }}>Showing:</span>
            {fmtBound(dateRangeBounds.from)}
            <span style={{ color: "var(--text-dim)", margin: "0 4px" }}>→</span>
            {fmtBound(dateRangeBounds.to)}
          </div>
        )}
      </div>

      {filters.dateRange === "custom" && (
        <div style={{ position: "relative" }}>
          <label>Date Range</label>
          <button
            className="btn btn-sm"
            onClick={() => setCustomPickerOpen((prev) => !prev)}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            📅 {customLabel}
            <span style={{ fontSize: "0.7rem" }}>{customPickerOpen ? "▲" : "▼"}</span>
          </button>
          {customPickerOpen && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                padding: 16,
                boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                zIndex: 20,
                minWidth: 260,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div>
                <label style={{ display: "block", marginBottom: 4, fontSize: "0.8rem", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  From
                </label>
                <input
                  type="date"
                  value={filters.customRange?.from?.slice(0, 10) || ""}
                  onChange={(e) =>
                    set("customRange", {
                      from: e.target.value + "T00:00:00Z",
                      to: filters.customRange?.to || new Date().toISOString(),
                    })
                  }
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label style={{ display: "block", marginBottom: 4, fontSize: "0.8rem", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  To
                </label>
                <input
                  type="date"
                  value={filters.customRange?.to?.slice(0, 10) || ""}
                  onChange={(e) =>
                    set("customRange", {
                      from: filters.customRange?.from || new Date().toISOString(),
                      to: e.target.value + "T23:59:59Z",
                    })
                  }
                  style={{ width: "100%" }}
                />
              </div>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setCustomPickerOpen(false)}
              >
                Apply
              </button>
            </div>
          )}
        </div>
      )}

      {renderMultiSelect("models", "Models", "🤖")}
      {renderMultiSelect("subscriptions", "Subscriptions", "🔑")}
      {renderMultiSelect("projects", "Projects", "📁")}
      {renderMultiSelect("agents", "Agents", "🤖")}
      <div>
        <label>Status</label>
        <select
          value={filters.status || "all"}
          onChange={(e) => set("status", e.target.value as "success" | "error" | "all")}
        >
          <option value="all">All</option>
          <option value="success">Success</option>
          <option value="error">Error</option>
        </select>
      </div>
      <button
        className="btn btn-sm"
        onClick={() => onChange({ dateRange: "day" })}
      >
        Clear
      </button>
    </div>
  );
}
