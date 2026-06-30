export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const snap = (v, step, on = true) => (on ? Math.round(v / step) * step : Math.round(v));

export function roundMm(v, roundTo = 1) {
  const r = roundTo > 0 ? roundTo : 1;
  return Math.round(v / r) * r;
}

export function snapPoint(p, step, on = true) {
  return { x: snap(p.x, step, on), y: snap(p.y, step, on) };
}
