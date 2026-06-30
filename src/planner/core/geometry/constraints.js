import { snap } from "./units.js";

const SNAP_ANGLES = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI, -Math.PI / 4, -Math.PI / 2, (-3 * Math.PI) / 4];

/** Привязка точки к горизонтали/вертикали относительно предыдущей (как в CAD). */
export function orthogonalPoint(from, to, step = 50, snapOn = true) {
  const s = (v) => snap(v, step, snapOn);
  if (!from) return { x: s(to.x), y: s(to.y) };
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  if (dx >= dy) return { x: s(to.x), y: s(from.y) };
  return { x: s(from.x), y: s(to.y) };
}

/** Shift: ограничение 0° / 45° / 90° от предыдущей точки. */
export function constrainedOrthoPoint(from, to, step = 50, snapOn = true) {
  const s = (v) => snap(v, step, snapOn);
  if (!from) return { x: s(to.x), y: s(to.y) };
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return { x: s(from.x), y: s(from.y) };
  const ang = Math.atan2(dy, dx);
  let best = SNAP_ANGLES[0];
  let bestDiff = Infinity;
  SNAP_ANGLES.forEach((a) => {
    let diff = Math.abs(ang - a);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    if (diff < bestDiff) {
      bestDiff = diff;
      best = a;
    }
  });
  return { x: s(from.x + Math.cos(best) * len), y: s(from.y + Math.sin(best) * len) };
}
