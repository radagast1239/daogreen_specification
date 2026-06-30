import { rectsIntersect } from "./selectionHelpers.js";
import { structuralBlocksPlacement } from "./structuralTypes.js";

function segDir(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

function perp(d) {
  return { x: -d.y, y: d.x };
}

/** Прямоугольник вдоль отрезка a→b с заданной шириной (центр по линии). */
export function structuralSegmentRect(a, b, width) {
  const d = segDir(a, b);
  const n = perp(d);
  const hw = (width || 200) / 2;
  return {
    x: Math.min(a.x, b.x) - hw,
    y: Math.min(a.y, b.y) - hw,
    w: Math.abs(b.x - a.x) + width,
    h: Math.abs(b.y - a.y) + width,
    polygon: [
      { x: a.x + n.x * hw, y: a.y + n.y * hw },
      { x: b.x + n.x * hw, y: b.y + n.y * hw },
      { x: b.x - n.x * hw, y: b.y - n.y * hw },
      { x: a.x - n.x * hw, y: a.y - n.y * hw },
    ],
  };
}

export function structuralColumnRect(center, width) {
  const w = width || 400;
  return {
    x: center.x - w / 2,
    y: center.y - w / 2,
    w,
    h: w,
    polygon: [
      { x: center.x - w / 2, y: center.y - w / 2 },
      { x: center.x + w / 2, y: center.y - w / 2 },
      { x: center.x + w / 2, y: center.y + w / 2 },
      { x: center.x - w / 2, y: center.y + w / 2 },
    ],
  };
}

export function structuralFootprint(s) {
  if (!s) return null;
  if (s.kind === "column" && s.center) {
    return structuralColumnRect(s.center, s.width);
  }
  if (s.a && s.b) {
    return structuralSegmentRect(s.a, s.b, s.width);
  }
  return null;
}

export function itemRect(it) {
  return { x: it.x, y: it.y, w: it.w, h: it.h };
}

export function itemHitsStructural(item, structural) {
  if (!item || !structural || !structuralBlocksPlacement(structural)) return false;
  const fp = structuralFootprint(structural);
  if (!fp) return false;
  return rectsIntersect(itemRect(item), fp);
}

export function itemHitsAnyStructural(item, structurals = []) {
  return structurals.some((s) => itemHitsStructural(item, s));
}

export function hitTestStructural(mm, s, tol = 120) {
  const fp = structuralFootprint(s);
  if (!fp?.polygon) return false;
  const minX = Math.min(...fp.polygon.map((p) => p.x)) - tol;
  const maxX = Math.max(...fp.polygon.map((p) => p.x)) + tol;
  const minY = Math.min(...fp.polygon.map((p) => p.y)) - tol;
  const maxY = Math.max(...fp.polygon.map((p) => p.y)) + tol;
  return mm.x >= minX && mm.x <= maxX && mm.y >= minY && mm.y <= maxY;
}

export function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  return Math.hypot(p.x - px, p.y - py);
}

export function nearestStructural(mm, structurals, tol = 140) {
  let best = null;
  (structurals || []).forEach((s) => {
    if (s.kind === "column" && s.center) {
      const d = Math.hypot(mm.x - s.center.x, mm.y - s.center.y);
      if (d <= tol + (s.width || 400) / 2 && (!best || d < best.d)) best = { s, d };
      return;
    }
    if (s.a && s.b) {
      const d = distToSegment(mm, s.a, s.b);
      if (d <= tol + (s.width || 200) / 2 && (!best || d < best.d)) best = { s, d };
    }
  });
  return best?.s || null;
}
