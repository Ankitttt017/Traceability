/* ═══════════════════════════════════════════════════════════════════════════
   Plant quality targets — the ONE place to change them.
   Used by every management view (Rejection Analysis, Dashboard …) for status colours.

   Status rule (agreed with plant management):
     green = at / better than target
     amber = worse, but within AMBER_BAND_PP percentage points of target
     red   = worse than that
   ═══════════════════════════════════════════════════════════════════════════ */
export const TARGETS = Object.freeze({
  /** Scrap % must stay at or below this. Scrap % = (NG shots + station NG) ÷ (shots − warm-up). */
  scrapPct: 2,
  /** First-pass yield must stay at or above this. FPY = final OK ÷ (final OK + all rejections). */
  fpyPct: 97,
  /** Width of the amber "close to target" band, in percentage points. */
  amberBandPp: 1,
});

/** "good" | "warn" | "bad" | "none" for a value where LOWER is better (scrap %). */
export const statusLowerBetter = (value, target, band = TARGETS.amberBandPp) => {
  const v = Number(value);
  if (value === null || value === undefined || !Number.isFinite(v)) return "none";
  if (v <= target) return "good";
  if (v <= target + band) return "warn";
  return "bad";
};

/** "good" | "warn" | "bad" | "none" for a value where HIGHER is better (FPY %). */
export const statusHigherBetter = (value, target, band = TARGETS.amberBandPp) => {
  const v = Number(value);
  if (value === null || value === undefined || !Number.isFinite(v)) return "none";
  if (v >= target) return "good";
  if (v >= target - band) return "warn";
  return "bad";
};

export const scrapStatus = (pct) => statusLowerBetter(pct, TARGETS.scrapPct);
export const fpyStatus = (pct) => statusHigherBetter(pct, TARGETS.fpyPct);
