/** Trailing moving average (window n); null until the window is full or when it holds no value. */
export const movingAverage = (vals, n = 7) => vals.map((_, i) => {
  const win = vals.slice(Math.max(0, i - n + 1), i + 1).filter((v) => v != null && Number.isFinite(v));
  return i >= Math.min(n, vals.length) - 1 && win.length ? Number((win.reduce((a, v) => a + v, 0) / win.length).toFixed(2)) : null;
});

/** Rejection % = NG ÷ (OK + NG) of each bucket (null when nothing finished). */
export const ratePct = (ng, ok) => ng.map((v, i) => { const d = (Number(v) || 0) + (Number(ok[i]) || 0); return d > 0 ? Number((((Number(v) || 0) / d) * 100).toFixed(2)) : null; });
