import { dist, near, clonePoint } from "./point.js";

export function polyLength(pts) {
  let l = 0;
  for (let i = 1; i < (pts?.length || 0); i++) {
    l += dist(pts[i - 1], pts[i]);
  }
  return l;
}

export function polylineSegments(pts) {
  const segs = [];
  for (let i = 1; i < (pts?.length || 0); i++) {
    segs.push({ a: pts[i - 1], b: pts[i], index: i - 1 });
  }
  return segs;
}

/** Убрать дублирующиеся подряд идущие вершины. */
export function simplifyPolyline(pts, minDist = 5) {
  if (!pts?.length) return [];
  const out = [clonePoint(pts[0])];
  for (let i = 1; i < pts.length; i++) {
    if (!near(pts[i], out[out.length - 1], minDist)) {
      out.push(clonePoint(pts[i]));
    }
  }
  return out;
}

/** Замкнуть полилинию, если концы близко. */
export function closePolylineIfNear(pts, thr = 200) {
  if (pts.length < 3) return pts;
  const f = pts[0];
  const l = pts[pts.length - 1];
  if (near(f, l, thr)) return pts.slice(0, -1);
  return pts;
}
