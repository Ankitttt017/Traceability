import React, { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ChevronLeft, ChevronRight, Database } from "lucide-react";
import PageSkeleton from "../../components/PageSkeleton";

const StatusChip = ({ status }) => {
  const normalized = String(status || "").trim().toUpperCase();
  const base = "inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-bold border transition-all";
  
  if (normalized === "PASSED" || normalized === "OK") {
    return <span className={`${base} bg-[rgba(34,197,94,0.1)] text-[rgb(34,197,94)] border-[rgba(34,197,94,0.2)] shadow-sm shadow-[rgba(34,197,94,0.05)]`}>
      <span className="w-1.5 h-1.5 rounded-full bg-[rgb(34,197,94)]" />
      {normalized === "PASSED" ? "Passed" : "OK"}
    </span>;
  }
  if (normalized === "FAILED" || normalized === "NG") {
    return <span className={`${base} bg-[rgba(239,68,68,0.1)] text-[rgb(239,68,68)] border-[rgba(239,68,68,0.2)] shadow-sm shadow-[rgba(239,68,68,0.05)]`}>
      <span className="w-1.5 h-1.5 rounded-full bg-[rgb(239,68,68)]" />
      {normalized === "FAILED" ? "Failed" : "NG"}
    </span>;
  }
  if (normalized === "IN_PROGRESS") {
    return <span className={`${base} bg-[rgba(249,115,22,0.1)] text-[rgb(249,115,22)] border-[rgba(249,115,22,0.2)] shadow-sm shadow-[rgba(249,115,22,0.05)]`}>
      <span className="w-1.5 h-1.5 rounded-full bg-[rgb(249,115,22)] animate-pulse" />
      In Progress
    </span>;
  }
  return <span className={`${base} bg-[rgba(148,163,184,0.08)] text-[rgb(148,163,184)] border-[rgba(148,163,184,0.15)]`}>-</span>;
};

const DashCell = () => {
  return <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-bold border bg-[rgba(148,163,184,0.05)] text-[rgb(148,163,184)] border-[rgba(148,163,184,0.1)]">-</span>;
};

const ShotStatusChip = ({ value }) => {
  const normalized = String(value || "").trim().toUpperCase();
  const base = "inline-flex items-center gap-1 px-3 py-1 rounded-full text-[10px] font-bold border transition-all";
  
  if (normalized === "OK" || normalized === "1") {
    return <span className={`${base} bg-[rgba(34,197,94,0.1)] text-[rgb(34,197,94)] border-[rgba(34,197,94,0.2)]`}>OK</span>;
  }
  if (normalized.includes("WARM")) {
    return <span className={`${base} bg-[rgba(250,185,91,0.12)] text-[rgb(250,185,91)] border-[rgba(250,185,91,0.2)]`}>WARM UP</span>;
  }
  if (normalized.includes("OFF") || normalized === "5") {
    return <span className={`${base} bg-[rgba(239,68,68,0.1)] text-[rgb(239,68,68)] border-[rgba(239,68,68,0.2)]`}>OFF SHOT</span>;
  }
  return <span className={`${base} bg-[rgba(148,163,184,0.08)] text-[rgb(148,163,184)] border-[rgba(148,163,184,0.15)]`}>{normalized || "-"}</span>;
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
    `px-4 py-1.5 text-xs font-bold rounded-lg border transition-all ${
      disabled
        ? "cursor-not-allowed border-[rgba(var(--pk-bdr),0.1)] bg-[rgba(var(--pk-bdr),0.05)] text-[rgba(var(--pk-txt-muted),0.5)]"
        : "border-[rgba(var(--pk-steel),0.2)] bg-[rgba(var(--pk-steel),0.05)] text-[rgb(var(--pk-steel))] hover:bg-[rgba(var(--pk-steel),0.12)] hover:border-[rgba(var(--pk-steel),0.35)] active:scale-95 transition-all"
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
      <div className="bg-[rgb(var(--pk-bg-card))] border border-[rgba(var(--pk-bdr),var(--pk-bop))] rounded-xl p-20 flex flex-col items-center justify-center space-y-4 text-center">
        <div className="p-4 bg-[rgba(var(--pk-bdr),0.05)] rounded-full border border-[rgba(var(--pk-bdr),0.08)]">
          <Database size={32} className="text-[rgba(var(--pk-txt-muted),0.3)]" />
        </div>
        <div>
          <p className="text-sm font-bold text-[rgb(var(--pk-txt-pri))]">No report records found</p>
          <p className="text-xs text-[rgb(var(--pk-txt-muted))] mt-1.5">Update filters and try again</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[rgb(var(--pk-bg-card))] border border-[rgba(var(--pk-bdr),var(--pk-bop))] rounded-xl shadow-sm shadow-[rgba(var(--pk-navy),0.04)] overflow-hidden transition-all">
      <div className="h-1 w-full bg-gradient-to-r from-[rgb(var(--pk-navy))] via-[rgb(var(--pk-steel))] to-[rgb(var(--pk-amber))]" />
      
      <div className="relative">
        <button
          type="button"
          onClick={() => slideTable(-1)}
          className="absolute left-3 top-1/2 z-20 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-[rgba(var(--pk-bdr),0.15)] bg-[rgba(var(--pk-bg-card),0.95)] text-[rgb(var(--pk-txt-sec))] shadow-lg shadow-[rgba(var(--pk-navy),0.08)] backdrop-blur hover:bg-[rgb(var(--pk-navy))] hover:text-[rgb(var(--pk-linen))] transition-all md:flex"
          aria-label="Scroll report table left"
        >
          <ChevronLeft size={18} />
        </button>
        
        <button
          type="button"
          onClick={() => slideTable(1)}
          className="absolute right-3 top-1/2 z-20 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-[rgba(var(--pk-bdr),0.15)] bg-[rgba(var(--pk-bg-card),0.95)] text-[rgb(var(--pk-txt-sec))] shadow-lg shadow-[rgba(var(--pk-navy),0.08)] backdrop-blur hover:bg-[rgb(var(--pk-navy))] hover:text-[rgb(var(--pk-linen))] transition-all md:flex"
          aria-label="Scroll report table right"
        >
          <ChevronRight size={18} />
        </button>
        
        <div ref={tableScrollRef} className="overflow-auto max-h-[70vh] scroll-smooth" style={{ scrollbarWidth: "thin" }}>
          <table className="w-max min-w-full border-collapse text-[12px]">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-[rgba(var(--pk-bdr),0.15)] backdrop-blur" style={{ background: "linear-gradient(135deg, rgb(16,37,77), rgb(26,58,124), rgb(45,94,167))" }}>
                {columns.map((column) => (
                  <th key={column.key} className="px-4 py-3.5 text-[10px] font-black text-white uppercase tracking-wider whitespace-nowrap text-center">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(var(--pk-bdr),0.04)]">
              {pagedRows.map((row, idx) => (
                <tr key={`${row.traceabilityPartId || row.customerCode || row.barcode || "row"}-${idx}`} 
                    className={`${idx % 2 === 0 ? "bg-transparent" : "bg-[rgba(var(--pk-bdr),0.02)]"} hover:bg-[rgba(var(--pk-steel),0.04)] transition-colors group`}>
                  {columns.map((column) => {
                    const value = row[column.key];
                    const isEmptyValue = value === null || value === undefined || value === "";
                    const text = isEmptyValue ? (column.blankIfEmpty ? "" : "-") : String(value);
                    
                    if (column.renderLeakOperation) {
                      const machineName = String(value?.machineName || "").trim();
                      const status = String(value?.status || "").trim().toUpperCase() || "-";
                      if (!machineName || status === "-") {
                        return (
                          <td key={column.key} className="px-4 py-3 text-center whitespace-nowrap">
                            <DashCell />
                          </td>
                        );
                      }
                      return (
                        <td key={column.key} className="px-4 py-3 text-center whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            <span className="text-[11px] font-semibold text-[rgb(var(--pk-txt-pri))]">{machineName}</span>
                            <StatusChip status={status} />
                          </div>
                        </td>
                      );
                    }
                    
                    if (column.renderAsText) {
                      if (text === "-") {
                        return (
                          <td key={column.key} className="px-4 py-3 text-center whitespace-nowrap">
                            <DashCell />
                          </td>
                        );
                      }
                      return (
                        <td
                          key={column.key}
                          className="px-4 py-3 text-[11px] text-[rgb(var(--pk-txt-pri))] text-center font-medium whitespace-nowrap"
                        >
                          {text}
                        </td>
                      );
                    }
                    
                    if (isStatusLike(column.key)) {
                      return (
                        <td key={column.key} className="px-4 py-3 text-center whitespace-nowrap">
                          <StatusChip status={text} />
                        </td>
                      );
                    }
                    
                    if (column.key === "plc_shot_status") {
                      return (
                        <td key={column.key} className="px-4 py-3 text-center whitespace-nowrap">
                          <ShotStatusChip value={text} />
                        </td>
                      );
                    }
                    
                    if (column.key === "ngReason") {
                      const reasonText = value === null || value === undefined ? "" : String(value);
                      return (
                        <td key={column.key} className="px-4 py-3 text-[11px] text-[rgb(239,68,68)]/80 min-w-[220px] max-w-[420px] text-left whitespace-normal break-words leading-relaxed" title={reasonText || undefined}>
                          {reasonText || "-"}
                        </td>
                      );
                    }
                    
                    if (column.key.startsWith("rejection")) {
                      return (
                        <td
                          key={column.key}
                          className="px-4 py-3 text-[11px] text-[rgb(var(--pk-txt-pri))] text-center font-medium min-w-[120px] max-w-[220px] whitespace-normal break-words leading-relaxed"
                          title={text !== "-" ? text : undefined}
                        >
                          {text}
                        </td>
                      );
                    }
                    
                    if (column.key.startsWith("leak_") && text === "-") {
                      return (
                        <td key={column.key} className="px-4 py-3 text-center whitespace-nowrap">
                          <DashCell />
                        </td>
                      );
                    }
                    
                    return (
                      <td
                        key={column.key}
                        className={`px-4 py-3 text-[11px] text-[rgb(var(--pk-txt-pri))] text-center font-medium ${column.key.startsWith("plc_") ? "max-w-[220px] truncate" : "whitespace-nowrap"}`}
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
      
      <div className="px-6 py-3.5 bg-[rgba(var(--pk-bdr),0.02)] border-t border-[rgba(var(--pk-bdr),0.06)] flex items-center justify-between flex-wrap gap-3">
        {disablePagination ? (
          <span className="text-[11px] font-bold text-[rgb(var(--pk-txt-muted))]">
            Showing {rangeStart}-{rangeEnd} of {totalRows} filtered records
          </span>
        ) : (
          <>
            <div className="flex items-center gap-2 text-[11px] text-[rgb(var(--pk-txt-muted))]">
              <span className="font-semibold">Rows/page</span>
              <select
                value={effectivePageSize}
                onChange={(e) => changePageSize(e.target.value)}
                className="bg-[rgb(var(--pk-bg-input))] border border-[rgba(var(--pk-bdr),0.15)] rounded-lg px-2 py-1 text-[rgb(var(--pk-txt-pri))] font-semibold outline-none focus:border-[rgba(var(--pk-steel),0.3)]"
              >
                {pageSizeOptions.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            
            <div className="flex items-center gap-2">
              <button 
                onClick={() => goToPage(currentPage - 1)} 
                disabled={currentPage <= 1 || loading} 
                className={pageButtonClass(currentPage <= 1 || loading)}
              >
                Previous
              </button>
              
              <span className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-[rgb(var(--pk-navy))] to-[rgb(var(--pk-steel))] text-[rgb(var(--pk-linen))] text-xs font-bold shadow-md shadow-[rgba(var(--pk-navy),0.15)]">
                Page {currentPage} / {totalPages}
              </span>
              
              <span className="hidden sm:inline text-[11px] text-[rgb(var(--pk-txt-muted))] font-medium">
                {rangeStart}–{rangeEnd} of {totalRows}
              </span>
              
              <button 
                onClick={() => goToPage(currentPage + 1)} 
                disabled={currentPage >= totalPages || loading} 
                className={pageButtonClass(currentPage >= totalPages || loading)}
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ReportTable;