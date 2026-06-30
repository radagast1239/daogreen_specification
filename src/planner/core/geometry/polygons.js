import { polygonCentroid } from "./bounds.js";

/** Полигоны: попадание точки, inset, точка на расстоянии. */

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x; const yi = poly[i].y;
    const xj = poly[j].x; const yj = poly[j].y;
    if (((yi > p.y) !== (yj > p.y)) && (p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

export function insetPolygon(poly, insetMm) {
  if (!poly?.length || poly.length < 3 || insetMm <= 0) return poly;
  const cen = polygonCentroid(poly);
  return poly.map((p) => {
    const dx = p.x - cen.x;
    const dy = p.y - cen.y;
    const d = Math.hypot(dx, dy) || 1;
    const move = Math.min(insetMm, d * 0.38);
    return { x: p.x - (dx / d) * move, y: p.y - (dy / d) * move };
  });
}

/** Точка на расстоянии len от from в направлении to (ортогонально если axis). */
export function pointAtLength(from, to, len, axis = null) {
  let dx = to.x - from.x;
  let dy = to.y - from.y;
  if (axis === "h") { dy = 0; dx = dx >= 0 ? 1 : -1; }
  else if (axis === "v") { dx = 0; dy = dy >= 0 ? 1 : -1; }
  const d = Math.hypot(dx, dy);
  if (d < 1) return { x: from.x + len, y: from.y };
  return { x: from.x + (dx / d) * len, y: from.y + (dy / d) * len };
}
