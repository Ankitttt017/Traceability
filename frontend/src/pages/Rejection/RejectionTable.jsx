import React, { useState, useRef, useMemo } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Search } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";

const StatusChip = ({ status }) => {
  const norm = String(status || "").trim().toUpperCase();
  if (!norm || norm === "-" || norm === "NULL" || norm === "UNDEFINED") return null;

  const base = "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold border transition-all";
  if (norm === "OK" || norm === "PASSED" || norm === "PASS" || norm === "GOOD") {
    return (
      <span className={`${base} bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30`}>
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        OK
      </span>
    );
  }
  if (norm === "NG" || norm === "FAILED" || norm === "FAIL" || norm === "NOK") {
    return (
      <span className={`${base} bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30`}>
        <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
        NG
      </span>
    );
  }
  if (norm === "IN_PROGRESS" || norm === "WIP") {
    return (
      <span className={`${base} bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30`}>
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
        In Progress
      </span>
    );
  }
  return <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">{norm}</span>;
};

const ShotStatusChip = ({ value }) => {
  const norm = String(value || "").trim().toUpperCase();
  if (!norm || norm === "-" || norm === "NULL" || norm === "UNDEFINED") return null;

  const base = "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold border transition-all";
  if (norm === "OK" || norm === "1" || norm === "PASS" || norm === "PASSED" || norm === "GOOD") {
    return (
      <span className={`${base} bg-emerald-50 text-emerald-700 border-emerald-300 shadow-sm`}>
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        OK
      </span>
    );
  }
  if (norm.includes("WARM") || norm === "3" || norm === "2") {
    return (
      <span className={`${base} bg-amber-50 text-amber-700 border-amber-300 shadow-sm`}>
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        WARM UP
      </span>
    );
  }
  if (norm.includes("OFF") || norm === "5" || norm === "OFFSET" || norm === "NG" || norm === "FAILED" || norm === "FAIL") {
    return (
      <span className={`${base} bg-rose-50 text-rose-700 border-rose-300 font-extrabold shadow-sm`}>
        <span className="w-1.5 h-1.5 rounded-full bg-rose-600" />
        NG
      </span>
    );
  }
  return <span className="text-[11px] font-semibold text-slate-700">{norm}</span>;
};

const STICKY_COLUMNS = {
  shot_number: { left: 0, width: 85 },
  shot_datetime: { left: 85, width: 160 },
  barcode: { left: 245, width: 175 },
  customerCode: { left: 420, width: 230 },
};
const STICKY_LAST_KEY = "customerCode";

const RejectionTable = ({
  rows = [],
  columns = [],
  loading = false,
  pagination = null,
  onPageChange,
  onPageSizeChange,
  disablePagination = false,
  maxHeight = "64vh",
  defaultPageSize = 100,
  pageSizeOptions = [50, 100, 250, 500, 1000, 2500, 5000],
}) => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [jumpPageInput, setJumpPageInput] = useState("");
  const tableScrollRef = useRef(null);

  const serverPaged = Boolean(pagination && typeof pagination.page === "number");
  const currentPage = serverPaged ? pagination.page : page;
  const effectivePageSize = serverPaged ? (pagination.pageSize || pageSize) : pageSize;
  const totalRows = serverPaged ? (pagination.total || 0) : rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / effectivePageSize));

  const pagedRows = useMemo(() => {
    if (serverPaged || disablePagination) return rows;
    const start = (currentPage - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, currentPage, pageSize, serverPaged, disablePagination]);

  const rowVirtualizer = useVirtualizer({
    count: pagedRows.length,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => 40,
    overscan: 12,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom = virtualItems.length > 0 ? rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end : 0;

  const rangeStart = totalRows > 0 ? (currentPage - 1) * effectivePageSize + 1 : 0;
  const rangeEnd = totalRows > 0 ? Math.min(totalRows, (currentPage - 1) * effectivePageSize + pagedRows.length) : 0;

  const getStickyStyle = (key, { header = false, rowIndex = 0 } = {}) => {
    const meta = STICKY_COLUMNS[key];
    if (!meta) return undefined;
    return {
      position: "sticky",
      left: meta.left,
      minWidth: meta.width,
      width: meta.width,
      maxWidth: meta.width,
      zIndex: header ? 35 : 15,
      background: header
        ? "#f1f5f9"
        : rowIndex % 2 === 0
          ? "#ffffff"
          : "#f8fafc",
      boxShadow: key === STICKY_LAST_KEY ? "4px 0 10px -2px rgba(15, 23, 42, 0.08)" : undefined,
    };
  };

  const getHeaderStyle = (column) => {
    const s = getStickyStyle(column.key, { header: true });
    const colWidth = typeof column.width === "number" ? `${column.width}px` : column.width;
    if (!colWidth) return s;
    return {
      minWidth: colWidth,
      width: colWidth,
      ...(s || {}),
    };
  };

  const getCellStyle = (column, rowIndex) => {
    const s = getStickyStyle(column.key, { rowIndex });
    const colWidth = typeof column.width === "number" ? `${column.width}px` : column.width;
    if (!colWidth) return s;
    return {
      minWidth: colWidth,
      width: colWidth,
      ...(s || {}),
    };
  };

  const goToPage = (nextPage) => {
    const bounded = Math.min(totalPages, Math.max(1, nextPage));
    if (serverPaged && typeof onPageChange === "function") onPageChange(bounded);
    else setPage(bounded);
    if (tableScrollRef.current) tableScrollRef.current.scrollTop = 0;
  };

  const changePageSize = (nextSize) => {
    const safe = Number(nextSize) || 100;
    if (serverPaged && typeof onPageSizeChange === "function") onPageSizeChange(safe);
    else {
      setPageSize(safe);
      setPage(1);
    }
    if (tableScrollRef.current) tableScrollRef.current.scrollTop = 0;
  };

  const handleJumpSubmit = (e) => {
    e.preventDefault();
    const val = parseInt(jumpPageInput, 10);
    if (Number.isFinite(val) && val >= 1 && val <= totalPages) {
      goToPage(val);
      setJumpPageInput("");
    }
  };

  const isStatusColumn = (key) => key === "overallStatus" || key.startsWith("station_");

  const cleanDisplayValue = (val) => {
    if (val === null || val === undefined || val === "" || val === "-" || val === "null" || val === "undefined") {
      return "";
    }
    return String(val);
  };

  return (
    <div className="flex flex-col w-full bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden transition-all">
      {/* Top accent bar */}
      <div className="h-1.5 w-full bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500" />

      {/* Table Container */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={tableScrollRef}
          className="overflow-auto scroll-smooth"
          style={{ maxHeight, scrollbarWidth: "thin" }}
        >
          <table className="w-max min-w-full border-collapse text-[12px]">
            <thead className="sticky top-0 z-40">
              <tr style={{ background: "#f1f5f9" }} className="border-b-2 border-slate-300 shadow-sm">
                {columns.map((column) => (
                  <th
                    key={column.key}
                    className="px-3 py-3 text-[11px] font-extrabold text-slate-800 uppercase tracking-wider whitespace-nowrap text-center border-r border-slate-200 last:border-r-0"
                    style={getHeaderStyle(column)}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {paddingTop > 0 && (
                <tr>
                  <td style={{ height: paddingTop, padding: 0 }} colSpan={columns.length} />
                </tr>
              )}

              {pagedRows.length === 0 && !loading && (
                <tr>
                  <td colSpan={columns.length} className="px-6 py-16 text-center text-slate-400 text-sm font-medium">
                    No scrap rejection records found matching the active filters
                  </td>
                </tr>
              )}

              {virtualItems.map((virtualRow) => {
                const row = pagedRows[virtualRow.index];
                if (!row) return null;
                const rowIndex = virtualRow.index;
                const isEven = rowIndex % 2 === 0;
                const rowBgClass = isEven ? "bg-white" : "bg-slate-50/70";

                return (
                  <tr
                    key={row.id || row.rowKey || `row-${rowIndex}`}
                    className={`${rowBgClass} hover:bg-blue-50/60 transition-colors border-b border-slate-100`}
                  >
                    {columns.map((column) => {
                      const value = row[column.key];
                      const text = cleanDisplayValue(value);
                      const cellStyle = getCellStyle(column, rowIndex);

                      // Shot number column
                      if (column.key === "shot_number" || column.key === "shotNumber") {
                        return (
                          <td
                            key={column.key}
                            className="px-3.5 py-2.5 text-center font-mono font-bold text-slate-800 border-r border-slate-100"
                            style={cellStyle}
                          >
                            {text ? `#${text}` : "—"}
                          </td>
                        );
                      }

                      // Shot datetime column
                      if (column.key === "shot_datetime") {
                        return (
                          <td
                            key={column.key}
                            className="px-3 py-2.5 text-center font-mono text-[11px] text-slate-600 whitespace-nowrap border-r border-slate-100"
                            style={cellStyle}
                          >
                            {text}
                          </td>
                        );
                      }

                      // Part Serial column
                      if (column.key === "barcode" || column.key === "partId") {
                        return (
                          <td
                            key={column.key}
                            className="px-3 py-2.5 text-left font-mono text-xs font-bold text-indigo-700 whitespace-nowrap select-all border-r border-slate-100"
                            style={cellStyle}
                            title={text || undefined}
                          >
                            {text}
                          </td>
                        );
                      }

                      // Customer QR column
                      if (column.key === "customerCode" || column.key === "customerQrCode") {
                        return (
                          <td
                            key={column.key}
                            className="px-3 py-2.5 text-left font-mono text-[11px] text-slate-600 whitespace-nowrap select-all border-r border-slate-200"
                            style={cellStyle}
                            title={text || undefined}
                          >
                            {text}
                          </td>
                        );
                      }

                      // Status column (OP100..OP160, Overall Status)
                      if (isStatusColumn(column.key)) {
                        return (
                          <td
                            key={column.key}
                            className="px-3 py-2.5 text-center whitespace-nowrap border-r border-slate-100"
                            style={cellStyle}
                          >
                            <StatusChip status={text} />
                          </td>
                        );
                      }

                      // Shot Status column
                      if (column.key === "shot_status" || column.key === "shotStatus" || column.key === "plc_shot_status") {
                        return (
                          <td
                            key={column.key}
                            className="px-3 py-2.5 text-center whitespace-nowrap border-r border-slate-100"
                            style={cellStyle}
                          >
                            <ShotStatusChip value={text} />
                          </td>
                        );
                      }

                      // Rejection reason (defect) column
                      if (column.key === "ngReason" || column.key === "rejection_reason" || column.key === "reason") {
                        return (
                          <td
                            key={column.key}
                            className="px-3 py-2.5 text-[11px] min-w-[170px] max-w-[340px] text-left whitespace-normal break-words leading-tight border-r border-slate-100"
                            style={cellStyle}
                            title={text || undefined}
                          >
                            {text ? (
                              <span className="inline-block px-2 py-0.5 rounded bg-rose-50 text-rose-700 font-bold border border-rose-200">
                                {text}
                              </span>
                            ) : null}
                          </td>
                        );
                      }

                      // Category column
                      if (column.key === "rejection_category" || column.key === "category") {
                        return (
                          <td
                            key={column.key}
                            className="px-3 py-2.5 text-[11px] text-center font-bold text-indigo-700 whitespace-nowrap border-r border-slate-100"
                            style={cellStyle}
                          >
                            {text ? (
                              <span className="px-2 py-0.5 rounded bg-indigo-50 border border-indigo-200">
                                {text}
                              </span>
                            ) : null}
                          </td>
                        );
                      }

                      // General parameter or text column
                      return (
                        <td
                          key={column.key}
                          className="px-3 py-2.5 text-[11px] text-slate-700 text-center font-mono font-medium whitespace-nowrap tabular-nums border-r border-slate-100"
                          style={cellStyle}
                          title={text || undefined}
                        >
                          {text}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}

              {paddingBottom > 0 && (
                <tr>
                  <td style={{ height: paddingBottom, padding: 0 }} colSpan={columns.length} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modern Executive Pagination Footer */}
      <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between flex-wrap gap-4 shrink-0">
        <div className="flex items-center gap-4 text-xs text-slate-600">
          <span className="font-semibold text-slate-800">
            Showing <strong className="text-blue-700">{rangeStart.toLocaleString()}</strong> – <strong className="text-blue-700">{rangeEnd.toLocaleString()}</strong> of <strong className="text-slate-900">{totalRows.toLocaleString()}</strong> scrap records
          </span>
          <div className="flex items-center gap-2 pl-4 border-l border-slate-300">
            <span className="text-slate-500 font-medium">Rows per page:</span>
            <select
              value={effectivePageSize}
              onChange={(e) => changePageSize(e.target.value)}
              className="px-2.5 py-1 text-xs font-bold rounded-lg border border-slate-300 bg-white text-slate-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
            >
              {pageSizeOptions.map((sz) => (
                <option key={sz} value={sz}>{sz >= 5000 ? `${sz} (All Records)` : sz}</option>
              ))}
            </select>
          </div>
        </div>

        {!disablePagination && totalPages > 1 && (
          <div className="flex items-center gap-2">
            {/* Quick jump to page */}
            <form onSubmit={handleJumpSubmit} className="flex items-center gap-1.5 mr-2">
              <span className="text-xs text-slate-500">Go to:</span>
              <input
                type="number"
                min="1"
                max={totalPages}
                placeholder="#"
                value={jumpPageInput}
                onChange={(e) => setJumpPageInput(e.target.value)}
                className="w-12 px-1.5 py-1 text-xs text-center font-bold rounded border border-slate-300 bg-white text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </form>

            <button
              type="button"
              onClick={() => goToPage(1)}
              disabled={currentPage <= 1}
              className="p-1.5 text-xs font-semibold rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-200/60 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              title="First Page"
            >
              <ChevronsLeft size={16} />
            </button>
            <button
              type="button"
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage <= 1}
              className="p-1.5 text-xs font-semibold rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-200/60 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              title="Previous Page"
            >
              <ChevronLeft size={16} />
            </button>

            <span className="px-3.5 py-1 text-xs font-bold text-slate-800 bg-white border border-slate-300 rounded-lg shadow-sm">
              Page {currentPage} of {totalPages}
            </span>

            <button
              type="button"
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage >= totalPages}
              className="p-1.5 text-xs font-semibold rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-200/60 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              title="Next Page"
            >
              <ChevronRight size={16} />
            </button>
            <button
              type="button"
              onClick={() => goToPage(totalPages)}
              disabled={currentPage >= totalPages}
              className="p-1.5 text-xs font-semibold rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-200/60 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              title="Last Page"
            >
              <ChevronsRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default RejectionTable;
