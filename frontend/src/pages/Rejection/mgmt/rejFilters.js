/* ═══════════════════════════════════════════════════════════════════════════
   Page filters of Rejection Analysis.

   Server filters (sent with every rejection request — buildRejectionFilterContext accepts them):
     machineName   ProductionReports.machine_name = the machine of the part's latest scan
     dieName       ProductionReports.die_name
   Rejection filters (Category / Reason / Zone) narrow the NG records on the page, here in the browser:
     • the API's `reason` filter only matches operator entries ("Reason: …") — sensor rejects such as
       "Pressure Leakage Fail (OP150)" return 0 and "Blow Hole" returns 94 of the 247 the Pareto counts
     • the API's quality-gate counts ignore category / reason / zone
     so filtering the records here keeps every chart consistent with the Pareto. OK parts are never filtered by
     them (they have no category, reason or zone).
   Not available in the rejection APIs: plant, line (no lineName in the rejection filter context), part
   (partName drops the customer-QR-only parts — a third of OPK12), shift (removed from the header by request).
   ═══════════════════════════════════════════════════════════════════════════ */
import { CATEGORY_ORDER } from "../../../components/mgmt/mgmtTheme";
import { cleanZoneCode, parseRowDefect } from "../rejectionConstants";

export const SERVER_FILTERS = ["machineName", "dieName"];
export const REJ_FILTERS = ["category", "reason", "zone"];
export const EMPTY_FILTERS = { machineName: "", dieName: "", category: "", reason: "", zone: "" };

/** Zone key of a parsed defect: "E" for "ZONE-E", "LEAK" for leak-test (sensor) rejects, "" when not recorded. */
export const zoneKeyOf = (p) => {
  if (!p) return "";
  if (p.sensorReject) return "LEAK";
  return cleanZoneCode(p.zone) || "";
};
export const zoneKeyLabel = (k) => (k === "LEAK" ? "Leak test (no location)" : k === "" ? "Not recorded" : `Zone ${k}`);

const parsedOf = (r) => r._parsed || parseRowDefect(r);
const catOf = (r) => {
  const c = r._cat || parsedOf(r).category;
  return CATEGORY_ORDER.includes(c) ? c : "OTHER";
};
const reasonOf = (r) => r._reason || parsedOf(r).reason || "Not recorded";

export const hasRejFilter = (f) => REJ_FILTERS.some((k) => !!f?.[k]);

/** true when an NG record matches the Category / Reason / Zone filters. */
export function matchesRejFilter(r, f) {
  if (!hasRejFilter(f)) return true;
  if (f.category && catOf(r) !== f.category) return false;
  if (f.reason && reasonOf(r) !== f.reason) return false;
  if (f.zone && zoneKeyOf(parsedOf(r)) !== f.zone) return false;
  return true;
}

/** Text of the active rejection filters, e.g. "CR · Blow Hole · Zone E". */
export const rejFilterText = (f) => [f.category, f.reason, f.zone ? zoneKeyLabel(f.zone) : ""].filter(Boolean).join(" · ");

/**
 * Dropdown options from the NG records (enriched, unfiltered) — cascading: reasons of the selected category,
 * zones of the selected category + reason. Before the records arrive the Pareto API lists are used.
 * → { categories, reasons, zones: [{ value, label, count }] }
 */
export function rejFilterOptions({ enriched, pareto, filters }) {
  const count = (list, keyFn) => {
    const m = new Map();
    list.forEach((r) => { const k = keyFn(r); m.set(k, (m.get(k) || 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  if (Array.isArray(enriched)) {
    const inCat = filters.category ? enriched.filter((r) => catOf(r) === filters.category) : enriched;
    const inReason = filters.reason ? inCat.filter((r) => reasonOf(r) === filters.reason) : inCat;
    return {
      ready: true,
      categories: count(enriched, catOf).map(([value, n]) => ({ value, label: value === "OTHER" ? "Not classified" : value, count: n })),
      reasons: count(inCat, reasonOf).map(([value, n]) => ({ value, label: value, count: n })),
      zones: count(inReason, (r) => zoneKeyOf(parsedOf(r))).map(([value, n]) => ({ value, label: zoneKeyLabel(value), count: n })),
    };
  }
  const cats = Array.isArray(pareto?.categoryPareto) ? pareto.categoryPareto : [];
  const reasons = Array.isArray(pareto?.pareto) ? pareto.pareto : [];
  return {
    ready: false,
    categories: cats.map((c) => ({ value: c.category, label: c.category, count: c.count })),
    reasons: reasons.map((r) => ({ value: r.reason, label: r.reason, count: r.count })),
    zones: [],
  };
}

/** Process rows (Root Cause / SPC): OK and in-process rows stay, NG rows must match the rejection filters. */
export function filterProcessRows(rows, f, isNg) {
  if (!hasRejFilter(f) || !Array.isArray(rows)) return rows;
  return rows.filter((r) => !isNg(r) || matchesRejFilter(r, f));
}
