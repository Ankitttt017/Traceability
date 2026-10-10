import React, { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from "lucide-react";
import SectionCard from "../../../components/mgmt/SectionCard";
import CategoryChip from "../../../components/mgmt/CategoryChip";
import { SkeletonBlock } from "../../../components/mgmt/Skeleton";
import EmptyState from "../../../components/mgmt/EmptyState";
import { SLATE, fmtInt } from "../../../components/mgmt/mgmtTheme";
import { recordView } from "./derive";

const COLS = [
  { key: "partId", label: "Part ID" },
  { key: "qr", label: "Customer QR" },
  { key: "time", label: "Rejected at" },
  { key: "shift", label: "Shift" },
  { key: "station", label: "Station" },
  { key: "category", label: "Category" },
  { key: "reason", label: "Reason" },
  { key: "zone", label: "Location" },
  { key: "die", label: "Die" },
];

/** Searchable, sortable, paged table of NG part records (enriched rows). */
export function RecordsTable({ enriched, pageSize = 25, hideStation = false }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState({ key: "time", dir: "desc" });
  const [page, setPage] = useState(1);
  const cols = hideStation ? COLS.filter((c) => c.key !== "station") : COLS;

  const all = useMemo(() => (enriched || []).map(recordView), [enriched]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s
      ? all.filter((r) => [r.partId, r.qr, r.timeText, r.shift, r.station, r.category, r.reason, r.zone, r.view, r.die].some((v) => String(v).toLowerCase().includes(s)))
      : all.slice();
    const dir = sort.dir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      const va = sort.key === "time" ? new Date(a.time || 0).getTime() : String(a[sort.key] || "");
      const vb = sort.key === "time" ? new Date(b.time || 0).getTime() : String(b[sort.key] || "");
      return (va > vb ? 1 : va < vb ? -1 : 0) * dir;
    });
    return list;
  }, [all, q, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const cur = Math.min(page, pages);
  const shown = filtered.slice((cur - 1) * pageSize, cur * pageSize);
  const toggleSort = (key) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "time" ? "desc" : "asc" }));
    setPage(1);
  };

  if (!all.length) return <EmptyState title="No rejected parts in this period" />;
  return (
    <>
      <div className="ra-rec-tools">
        <label className="ra-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Search part ID, QR, reason…"
            aria-label="Search scrap records"
          />
        </label>
        <span style={{ fontSize: 12, color: SLATE[500] }}>{fmtInt(filtered.length)} record{filtered.length === 1 ? "" : "s"}</span>
      </div>
      <div className="mg-table-wrap">
        <table className="mg-table ra-rec-table">
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                  <button type="button" className="ra-sort" onClick={() => toggleSort(c.key)}>
                    {c.label}
                    {sort.key === c.key && (sort.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td className="strong mg-num">{r.partId}</td>
                <td className="mg-num" style={{ fontSize: 12 }}>{r.qr}</td>
                <td className="mg-num" style={{ whiteSpace: "nowrap" }}>{r.timeText}</td>
                <td>{r.shift}</td>
                {!hideStation && <td style={{ whiteSpace: "nowrap" }}>{r.station}</td>}
                <td><CategoryChip category={r.category} /></td>
                <td>{r.reason}</td>
                <td>{r.zone}{r.view && r.zone !== "—" && r.zone !== "Leak sensor" ? <div style={{ fontSize: 11, color: SLATE[500] }}>{r.view}</div> : null}</td>
                <td>{r.die}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ra-pager">
        <button type="button" onClick={() => setPage(Math.max(1, cur - 1))} disabled={cur <= 1} aria-label="Previous page"><ChevronLeft size={15} /></button>
        <span>Page {cur} of {pages}</span>
        <button type="button" onClick={() => setPage(Math.min(pages, cur + 1))} disabled={cur >= pages} aria-label="Next page"><ChevronRight size={15} /></button>
      </div>
    </>
  );
}

export default function RecordsSection({ enriched, loading, ngShots, defaultOpen = false, actions }) {
  return (
    <SectionCard
      id="ra-records"
      kicker="Detail"
      title={`Scrap records${enriched ? ` (${fmtInt(enriched.length)})` : ""}`}
      subtitle="Every part rejected at a station in the period. Search by part ID, QR, reason, station or die; click a column to sort."
      collapsible
      defaultOpen={defaultOpen}
      actions={actions}
      footer={ngShots ? <>NG shots ({fmtInt(ngShots)}) are machine rejections before tracing — they have no part ID and are not listed here.</> : null}
    >
      {loading && !enriched ? <SkeletonBlock lines={8} height={300} /> : <RecordsTable enriched={enriched} />}
    </SectionCard>
  );
}
