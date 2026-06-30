import { dist } from "./point.js";
import { vecUnit } from "./vector.js";

function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function onSegment(a, b, c) {
  return (
    Math.min(a.x, b.x) - 1 <= c.x && c.x <= Math.max(a.x, b.x) + 1 &&
    Math.min(a.y, b.y) - 1 <= c.y && c.y <= Math.max(a.y, b.y) + 1
  );
}

export function projectOnSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1) return { ...a };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

export function segmentLength(a, b) {
  return dist(a, b);
}

export function segmentsIntersectProper(a, b, c, d) {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (d1 === 0 && onSegment(c, d, a)) return true;
  if (d2 === 0 && onSegment(c, d, b)) return true;
  if (d3 === 0 && onSegment(a, b, c)) return true;
  if (d4 === 0 && onSegment(a, b, d)) return true;
  return false;
}

export function segmentIntersectionPoint(a, b, c, d) {
  if (!segmentsIntersectProper(a, b, c, d)) return null;
  const denom = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / denom;
  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
}

function sameLine(a, b, c, d, eps = 8) {
  const cross1 = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const cross2 = Math.abs((b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x));
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return len > 1 && cross1 / len < eps && cross2 / len < eps;
}

function overlap1D(a1, a2, b1, b2) {
  const lo = Math.max(Math.min(a1, a2), Math.min(b1, b2));
  const hi = Math.min(Math.max(a1, a2), Math.max(b1, b2));
  return hi - lo > 40;
}

/** Коллинеарное наложение двух сегментов (длина перекрытия > 0). */
export function collinearOverlap(a, b, c, d, eps = 12) {
  if (!sameLine(a, b, c, d, eps)) return null;
  const horiz = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  if (horiz) {
    if (!overlap1D(a.x, b.x, c.x, d.x)) return null;
    const lo = Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
    const hi = Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x));
    return { lo, hi, len: hi - lo, axis: "x", y: (a.y + b.y) / 2 };
  }
  if (!overlap1D(a.y, b.y, c.y, d.y)) return null;
  const lo = Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
  const hi = Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y));
  return { lo, hi, len: hi - lo, axis: "y", x: (a.x + b.x) / 2 };
}

export function segDirUnit(a, b) {
  return vecUnit(a, b);
}
