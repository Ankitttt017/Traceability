/**
 * Rejection category (CR / MR / CRAM) of an NG part — the same rule the Rejection Analysis page uses for its
 * category pareto and qualityGateDrillDown (traceabilityController.getRejectionPareto), so the Historical Report's
 * NG split and its Category column agree with that page:
 *
 * 1. Gate of the reject: leak test when the part has a leak-machine result / leak reject (matchedMachineName,
 *    machine ids 1773 / 1774 / 1776 in leak_data, a leak machine name, OP150 NG or a "Leak" reason); otherwise the
 *    first NG station in the order OP120, OP130, OP140, OP100, OP110, OP160 (also matched by machine name);
 *    otherwise OP120. With a quality gate selected on the Historical page the selected gate is used instead.
 * 2. Category: leak-test reject → CRAM. Else the stored category (ProductionReports.rejection_category, or the
 *    operator entry "Category: …" in Parts.interlock_reason / the NG text) normalised to CR / CRAM / MR. Else from
 *    the reason: blow hole / porosity → CRAM, gauging / machining or OP140 → MR, anything else → CR.
 */
const NG = new Set(["NG", "FAIL", "FAILED", "ENDED_NG", "COMPLETED_NG"]);
const NG_SHORT = new Set(["NG", "FAIL", "FAILED"]); // the pareto's gate CASE uses this shorter list
const up = (v) => String(v ?? "").trim().toUpperCase();

const parseTextField = (text, label) => {
  if (!text || typeof text !== "string") return "";
  const m = text.match(new RegExp(`${label}:\\s*([^|\\n]+)`, "i"));
  return m ? m[1].trim() : "";
};

const canonicalizeReason = (raw) => {
  if (!raw) return "";
  const s = String(raw).trim();
  const lower = s.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ");
  if (lower.includes("non filling") || lower.includes("nonfilling")) return "Non-Filling";
  if (lower.includes("blow hole") || lower.includes("blowhole")) return "Blow Hole";
  if (lower.includes("pin hole") || lower.includes("pinhole")) return "Pin Hole";
  if (lower.includes("cold shut") || lower.includes("coldshut")) return "Cold Shut";
  if (lower.includes("op150") || lower.includes("op 150")) return "Pressure Leakage Fail (OP150)";
  if (lower.includes("body leak")) return "Body Leak";
  if (lower.includes("leak") || lower.includes("leakage")) return "Pressure Leakage Fail (OP150)";
  if (lower.includes("dent")) return "Dent / Handling Damage";
  if (lower.includes("crack")) return "Crack";
  if (lower.includes("porosity")) return "Porosity";
  if (lower.includes("gauging") || lower.includes("dimension")) return "Gauging Out of Spec";
  if (lower.includes("laser") || lower.includes("qr")) return "Laser Mark QR Fail";
  if (lower.includes("dcm casting")) return "DCM Casting Defect";
  if (lower.includes("casting visual") || lower.includes("visual ng")) return "Casting Visual NG";
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.substr(1).toLowerCase());
};

// JSON_VALUE(leak_data, '$.x') reads a top-level object only (an array gives NULL)
const leakJson = (leakData) => {
  if (!leakData) return null;
  let v = leakData;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch (e) { void e; return null; } }
  return v && typeof v === "object" && !Array.isArray(v) ? v : null;
};

/** Gate the reject is booked on — the CASE of getRejectionPareto. */
function rejectGateOf(rep = {}) {
  const ld = leakJson(rep.leak_data);
  const leakText = typeof rep.leak_data === "string" ? rep.leak_data : (rep.leak_data ? JSON.stringify(rep.leak_data) : "");
  const matched = String(ld?.matchedMachineName || "");
  const machine = String(rep.machine_name || "");
  const st = (op) => up(rep[`${op}_status`]);
  const like = (s, re) => re.test(String(s || ""));
  if (/^Leak[- ]Test-0[123]$/i.test(matched) || /177[346]/.test(leakText) || /leak.*0[123]/i.test(machine) || /^Leak[- ]Test-0[123]$/i.test(machine)) return "LEAK";
  if (/leak/i.test(machine) || NG_SHORT.has(st("op150")) || like(rep.rejection_reason, /leak/i) || like(rep.ng_reason, /leak/i)) return "LEAK";
  if (NG_SHORT.has(st("op120")) || machine === "Casting PDi") return "OP120";
  if (NG_SHORT.has(st("op130")) || machine === "Pre Inspection") return "OP130";
  if (NG_SHORT.has(st("op140")) || machine === "Auto Guaging") return "OP140";
  if (NG_SHORT.has(st("op100")) || /DCM/i.test(machine)) return "OP100";
  if (NG_SHORT.has(st("op110")) || machine === "Laser Marking") return "OP110";
  if (NG_SHORT.has(st("op160")) || machine === "Final Inspection") return "OP160";
  return "OP120";
}

const DEFAULT_REASON = {
  LEAK: "Pressure Leak", OP150: "Pressure Leak", OP140: "Gauging Out of Spec", OP100: "DCM Casting Defect",
  OP110: "Laser Mark QR Fail", OP120: "Casting Visual NG", OP130: "Pre-Inspection Defect", OP160: "Final Inspection Reject",
};

function normalizeCategory(rawCat, gate, reason) {
  if (gate === "LEAK" || gate === "OP150" || String(reason || "").toLowerCase().includes("leak")) return "CRAM";
  const c = up(rawCat);
  if (["CR", "CASTING", "CASTING REJECTION"].includes(c)) return "CR";
  if (["CRAM", "CR-AM", "CASTING REJECTION AFTER MACHINING"].includes(c)) return "CRAM";
  if (["MR", "MACHINING", "MACHINING REJECTION"].includes(c)) return "MR";
  const r = String(reason || "").toLowerCase();
  if (r.includes("blow hole") || r.includes("porosity") || r.includes("face blow hole")) return "CRAM";
  if (r.includes("gauge") || r.includes("machin") || gate === "OP140") return "MR";
  return "CR";
}

/**
 * rep        — ProductionReports row (rejection_category, rejection_reason, ng_reason, machine_name, opXXX_status, leak_data)
 * partsEntry — Parts.interlock_reason of the part (operator entry), may be empty
 * gateHint   — selected quality gate ("OP130", "OP150" …) or empty
 * → { category: "CR" | "MR" | "CRAM", reason, gate }
 */
function ngCategoryOf(rep = {}, partsEntry = "", gateHint = "") {
  const hint = up(gateHint);
  const gate = hint ? (hint === "OP150" ? "LEAK" : hint) : rejectGateOf(rep);
  const interlock = String(partsEntry || "").trim();
  const srcText = String(rep.ng_reason || rep.rejection_reason || interlock || "");
  let reason = String(rep.rejection_reason || "").trim() || parseTextField(interlock, "Reason") || parseTextField(srcText, "Reason");
  if (!reason && interlock && !interlock.includes("|") && !interlock.includes(":")) reason = interlock;
  if (!reason || reason.toLowerCase().includes("unspecified")) reason = DEFAULT_REASON[gate] || `${gate} Defect NG`;
  reason = canonicalizeReason(reason);
  const rawCat = String(rep.rejection_category || "").trim() || parseTextField(interlock, "Category") || parseTextField(srcText, "Category");
  return { category: normalizeCategory(rawCat, gate, reason), reason, gate };
}

const emptySplit = () => ({ CR: 0, MR: 0, CRAM: 0 });

module.exports = { ngCategoryOf, rejectGateOf, normalizeCategory, canonicalizeReason, emptySplit, NG_TOKENS: NG };
