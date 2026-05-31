import { useState, useRef, useEffect } from "react";

interface ExportButtonProps {
  data: Record<string, unknown>;
  filename?: string;
  label?: string;
}

function jsonToCSV(data: Record<string, unknown>): string {
  const rows: string[] = [];
  const keys = Object.keys(data);
  for (const key of keys) {
    const val = data[key];
    if (Array.isArray(val) && val.length > 0) {
      if (rows.length === 0) {
        rows.push(Object.keys(val[0] as Record<string, unknown>).join(","));
      }
      for (const item of val) {
        rows.push(
          Object.values(item as Record<string, unknown>)
            .map((v) => (typeof v === "string" && v.includes(",") ? `"${v}"` : String(v)))
            .join(",")
        );
      }
    }
  }
  return rows.join("\n");
}

function download(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ExportButton({
  data,
  filename = "tokeneye-export",
  label = "Export",
}: ExportButtonProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="export-dropdown" ref={ref}>
      <button className="btn" onClick={() => setOpen(!open)} title="Export data">
        📥 {label}
      </button>
      {open && (
        <div className="export-menu">
          <button
            onClick={() => {
              download(jsonToCSV(data), `${filename}.csv`, "text/csv");
              setOpen(false);
            }}
          >
            📊 Export CSV
          </button>
          <button
            onClick={() => {
              download(JSON.stringify(data, null, 2), `${filename}.json`, "application/json");
              setOpen(false);
            }}
          >
            📄 Export JSON
          </button>
        </div>
      )}
    </div>
  );
}
