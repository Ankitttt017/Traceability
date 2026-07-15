import React, { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ChevronLeft, ChevronRight } from "lucide-react";
import PageSkeleton from "../../components/PageSkeleton";

const StatusChip = ({ status }) => {
  const normalized = String(status || "").trim().toUpperCase();
  const base = "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border";
  if (normalized === "PASSED" || normalized === "OK") return <span className={`${base} bg-emerald-500/10 text-emerald-600 border-emerald-500/30`}>{normalized === "PASSED" ? "Passed" : "OK"}</span>;
  if (normalized === "FAILED" || normalized === "NG") return <span className={`${base} bg-red-500/10 text-red-600 border-red-500/30`}>{normalized === "FAILED" ? "Failed" : "NG"}</span>;
  if (normalized === "IN_PROGRESS") return <span className={`${base} bg-orange-500/10 text-orange-600 border-orange-500/30`}>In Progress</span>;
  return <span className={`${base} bg-slate-500/10 text-slate-600 border-slate-500/30`}>-</span>;
};

const DashCell = () => {
  const base = "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border";
  return <span className={`${base} bg-slate-500/10 text-slate-600 border-slate-500/30`}>-</span>;
};

const ShotStatusChip = ({ value }) => {
  const normalized = String(value || "").trim().toUpperCase();
  const base = "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border";
  if (normalized === "OK" || normalized === "1") return <span className={`${base} bg-emerald-500/10 text-emerald-600 border-emerald-500/30`}>OK</span>;
  if (normalized.includes("WARM")) return <span className={`${base} bg-red-500/10 text-red-600 border-red-500/30`}>WARM UP SHOT (NG)</span>;
  if (normalized.includes("OFF") || normalized === "5") return <span className={`${base} bg-red-500/10 text-red-600 border-red-500/30`}>OFF SHOT</span>;
  return <span className={`${base} bg-slate-500/10 text-slate-600 border-slate-500/30`}>{normalized || "-"}</span>;
};

const isStatusLike = (key) => key === "overallStatus" || key.startsWith("station_");

const ReportTable = ({
  rows = [],
  columns = [],
  loading,
  progress = 0,
  pagination = null,
  onPageChange,
  onPageSizeChange,
  disablePagination = false,
  defaultPageSize = 500,
  pageSizeOptions = [500, 1000, 2000],
}) => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const tableScrollRef = useRef(null);
  const serverPaged = !disablePagination && Boolean(pagination && typeof onPageChange === "function");
  const effectivePageSize = serverPaged ? Number(pagination.pageSize || 50) : pageSize;
  const totalRows = disablePagination ? Number(pagination?.totalRows || rows.length || 0) : (serverPaged ? Number(pagination.totalRows || rows.length || 0) : rows.length);
  const totalPages = serverPaged
    ? Math.max(1, Number(pagination.totalPages || Math.ceil(totalRows / effectivePageSize) || 1))
    : disablePagination
    ? 1
    : Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = serverPaged ? Number(pagination.page || 1) : Math.min(page, totalPages);
  const pagedRows = useMemo(() => {
    if (disablePagination) return rows;
    if (serverPaged) return rows;
    const start = (currentPage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, currentPage, pageSize, serverPaged, disablePagination]);

  useEffect(() => {
    setPage(1);
  }, [rows]);
  const rangeStart = disablePagination ? (totalRows > 0 ? 1 : 0) : (totalRows > 0 ? ((currentPage - 1) * effectivePageSize) + 1 : 0);
  const rangeEnd = disablePagination ? pagedRows.length : (totalRows > 0 ? Math.min(totalRows, rangeStart + pagedRows.length - 1) : 0);
  const pageButtonClass = (disabled) =>
    `px-3 py-1.5 text-xs font-bold border rounded-md transition-all ${
      disabled
        ? "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
        : "border-primary bg-primary text-on-primary shadow-sm hover:brightness-110 active:scale-95"
    }`;
  const goToPage = (nextPage) => {
    const bounded = Math.min(totalPages, Math.max(1, nextPage));
    if (serverPaged) onPageChange(bounded);
    else setPage(bounded);
  };
  const changePageSize = (nextSize) => {
    const safeSize = Number(nextSize) || 25;
    if (serverPaged && typeof onPageSizeChange === "function") onPageSizeChange(safeSize);
    else {
      setPageSize(safeSize);
      setPage(1);
    }
  };
  const slideTable = (direction) => {
    const node = tableScrollRef.current;
    if (!node) return;
    const amount = Math.max(320, Math.floor(node.clientWidth * 0.75));
    node.scrollBy({ left: direction * amount, behavior: "smooth" });
  };

  if (loading) {
    return <PageSkeleton rows={7} columns={6} progress={progress} title="Report" />;
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
      <div className="h-1 w-full bg-gradient-to-r from-primary via-slate-400 to-emerald-500" />
      <div className="relative">
        <button
          type="button"
          onClick={() => slideTable(-1)}
          className="absolute left-2 top-1/2 z-20 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-bg-card/95 text-text-main shadow-lg backdrop-blur hover:bg-primary hover:text-on-primary md:flex"
          aria-label="Scroll report table left"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          type="button"
          onClick={() => slideTable(1)}
          className="absolute right-2 top-1/2 z-20 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-bg-card/95 text-text-main shadow-lg backdrop-blur hover:bg-primary hover:text-on-primary md:flex"
          aria-label="Scroll report table right"
        >
          <ChevronRight size={18} />
        </button>
      <div ref={tableScrollRef} className="overflow-auto max-h-[70vh] scroll-smooth" style={{ scrollbarWidth: "thin" }}>
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
              <tr key={`${row.traceabilityPartId || row.customerCode || row.barcode || "row"}-${idx}`} className={`${idx % 2 === 0 ? "bg-transparent" : "bg-white/[0.02]"} hover:bg-primary/5 transition-colors group`}>
                {columns.map((column) => {
                  const value = row[column.key];
                  const isEmptyValue = value === null || value === undefined || value === "";
                  const text = isEmptyValue ? (column.blankIfEmpty ? "" : "-") : String(value);
                  if (column.renderLeakOperation) {
                    const machineName = String(value?.machineName || "").trim();
                    const status = String(value?.status || "").trim().toUpperCase() || "-";
                    if (!machineName || status === "-") {
                      return (
                        <td key={column.key} className="px-3 py-3 text-center whitespace-nowrap">
                          <DashCell />
                        </td>
                      );
                    }
                    return (
                      <td key={column.key} className="px-3 py-3 text-center whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <span className="text-[11px] font-semibold text-[#111827]">{machineName}</span>
                          <StatusChip status={status} />
                        </div>
                      </td>
                    );
                  }
                  if (column.renderAsText) {
                    if (text === "-") {
                      return (
                        <td key={column.key} className="px-3 py-3 text-center whitespace-nowrap">
                          <DashCell />
                        </td>
                      );
                    }
                    return (
                      <td
                        key={column.key}
                        className="px-3 py-3 text-[11px] text-[#111827] text-center font-medium whitespace-nowrap"
                      >
                        {text}
                      </td>
                    );
                  }
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
                    const reasonText = value === null || value === undefined ? "" : String(value);
                    return (
                      <td key={column.key} className="px-3 py-3 text-[11px] text-red-600/90 min-w-[220px] max-w-[420px] text-left whitespace-normal break-words leading-relaxed" title={reasonText || undefined}>
                        {reasonText || "-"}
                      </td>
                    );
                  }
                  if (column.key.startsWith("rejection")) {
                    return (
                      <td
                        key={column.key}
                        className="px-3 py-3 text-[11px] text-[#111827] text-center font-medium min-w-[120px] max-w-[220px] whitespace-normal break-words leading-relaxed"
                        title={text !== "-" ? text : undefined}
                      >
                        {text}
                      </td>
                    );
                  }
                  if (column.key.startsWith("leak_") && text === "-") {
                    return (
                      <td key={column.key} className="px-3 py-3 text-center whitespace-nowrap">
                        <DashCell />
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
      </div>
      <div className="px-6 py-3 bg-bg-dark/20 border-t border-border flex items-center justify-between flex-wrap gap-3">
        {disablePagination ? (
          <span className="text-[11px] font-bold text-text-muted">
            Showing {rangeStart}-{rangeEnd} of {totalRows} filtered records
          </span>
        ) : (
          <>
            <div className="flex items-center gap-2 text-[11px] text-text-muted">
              <span>Rows/page</span>
              <select
                value={effectivePageSize}
                onChange={(e) => changePageSize(e.target.value)}
                className="bg-bg-dark border border-border rounded px-2 py-1 text-text-main"
              >
                {pageSizeOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1 || loading} className={pageButtonClass(currentPage <= 1 || loading)}>Prev</button>
              <span className="px-3 py-1 rounded bg-primary text-on-primary text-xs font-bold">Page {currentPage}/{totalPages}</span>
              <span className="hidden sm:inline text-[11px] text-text-muted">
                Showing {rangeStart}-{rangeEnd} of {totalRows}
              </span>
              <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages || loading} className={pageButtonClass(currentPage >= totalPages || loading)}>Next</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ReportTable;
