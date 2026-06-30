/** Базовые единицы и округление координат (без React). */

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const snap = (v, step, on = true) => (on ? Math.round(v / step) * step : Math.round(v));

export function polyLength(pts) {
  let l = 0;
  for (let i = 1; i < (pts?.length || 0); i++) {
    l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return l;
}

export function roundMm(v, roundTo = 1) {
  const r = roundTo > 0 ? roundTo : 1;
  return Math.round(v / r) * r;
}
