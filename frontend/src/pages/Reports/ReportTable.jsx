import React, { useMemo, useState } from "react";
import { Activity } from "lucide-react";

const StatusChip = ({ status }) => {
  const normalized = String(status || "").trim().toUpperCase();
  const base = "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border";
  if (normalized === "PASSED" || normalized === "OK") return <span className={`${base} bg-emerald-500/10 text-emerald-600 border-emerald-500/30`}>{normalized === "PASSED" ? "Passed" : "OK"}</span>;
  if (normalized === "FAILED" || normalized === "NG") return <span className={`${base} bg-red-500/10 text-red-600 border-red-500/30`}>{normalized === "FAILED" ? "Failed" : "NG"}</span>;
  if (normalized === "IN_PROGRESS") return <span className={`${base} bg-amber-500/10 text-amber-600 border-amber-500/30`}>In Progress</span>;
  return <span className={`${base} bg-slate-500/10 text-slate-600 border-slate-500/30`}>-</span>;
};

const ShotStatusChip = ({ value }) => {
  const normalized = String(value || "").trim().toUpperCase();
  const base = "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border";
  if (normalized === "OK" || normalized === "1") return <span className={`${base} bg-emerald-500/10 text-emerald-600 border-emerald-500/30`}>OK</span>;
  if (normalized.includes("WARM")) return <span className={`${base} bg-amber-500/10 text-amber-600 border-amber-500/30`}>WARM UP SHOT</span>;
  if (normalized.includes("OFF") || normalized === "5") return <span className={`${base} bg-red-500/10 text-red-600 border-red-500/30`}>OFF SHOT</span>;
  return <span className={`${base} bg-slate-500/10 text-slate-600 border-slate-500/30`}>{normalized || "-"}</span>;
};

const isStatusLike = (key) => key === "overallStatus" || key.startsWith("station_");

const ReportTable = ({ rows = [], columns = [], loading }) => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, currentPage, pageSize]);

  if (loading) {
    return (
      <div className="bg-bg-card border border-border rounded-xl p-20 flex flex-col items-center justify-center space-y-4">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
        <p className="text-xs font-bold text-text-muted uppercase tracking-widest">Preparing Report Dataset...</p>
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="bg-bg-card border border-border rounded-xl p-20 flex flex-col items-center justify-center space-y-4 text-center">
        <div className="p-4 bg-bg-dark rounded-full">
          <Activity size={32} className="text-text-muted/30" />
        </div>
        <div>
          <p className="text-sm font-bold text-text-main">No report records found</p>
          <p className="text-xs text-text-muted mt-1">Update filters and try again</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-bg-card border border-border rounded-xl shadow-sm overflow-hidden">
      <div className="h-1 w-full bg-gradient-to-r from-cyan-500 via-emerald-400 to-amber-400" />
      <div className="overflow-auto max-h-[70vh]" style={{ scrollbarWidth: "thin" }}>
        <table className="w-max min-w-full border-collapse text-[12px]">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-border backdrop-blur" style={{ background: "linear-gradient(90deg,#10254d,#1a3a7c,#2d5ea7)" }}>
              {columns.map((column) => (
                <th key={column.key} className="px-3 py-3 text-[10px] font-black text-white uppercase tracking-wider whitespace-nowrap text-center">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {pagedRows.map((row, idx) => (
              <tr key={`${row.barcode || "row"}-${idx}`} className={`${idx % 2 === 0 ? "bg-transparent" : "bg-white/[0.02]"} hover:bg-primary/5 transition-colors group`}>
                {columns.map((column) => {
                  const value = row[column.key];
                  const text = value === null || value === undefined || value === "" ? "�" : String(value);
                  if (isStatusLike(column.key)) {
                    return (
                      <td key={column.key} className="px-3 py-3 text-center whitespace-nowrap">
                        <StatusChip status={text} />
                      </td>
                    );
                  }
                  if (column.key === "plc_shot_status") {
                    return (
                      <td key={column.key} className="px-3 py-3 text-center whitespace-nowrap">
                        <ShotStatusChip value={text} />
                      </td>
                    );
                  }
                  if (column.key === "ngReason") {
                    return (
                      <td key={column.key} className="px-3 py-3 text-[11px] text-red-600/90 max-w-[220px] truncate text-center" title={String(text)}>
                        {text}
                      </td>
                    );
                  }
                  return (
                    <td
                      key={column.key}
                      className={`px-3 py-3 text-[11px] text-[#111827] text-center font-medium ${column.key.startsWith("plc_") ? "max-w-[220px] truncate" : "whitespace-nowrap"}`}
                      title={column.key.startsWith("plc_") ? text : undefined}
                    >
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="px-6 py-3 bg-bg-dark/20 border-t border-border flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 text-[11px] text-text-muted">
          <span>Rows/page</span>
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value) || 25); setPage(1); }}
            className="bg-bg-dark border border-border rounded px-2 py-1 text-text-main"
          >
            {[10, 25, 50, 100].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setPage(Math.max(1, currentPage - 1))} disabled={currentPage <= 1} className="px-3 py-1 text-xs border border-border rounded disabled:opacity-50">Prev</button>
          <span className="px-3 py-1 rounded bg-primary text-on-primary text-xs font-bold">Page {currentPage}/{totalPages}</span>
          <button onClick={() => setPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage >= totalPages} className="px-3 py-1 text-xs border border-border rounded disabled:opacity-50">Next</button>
        </div>
      </div>
    </div>
  );
};

export default ReportTable;
