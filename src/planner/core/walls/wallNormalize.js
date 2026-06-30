/**
 * Нормализация стен после рисования/редактирования.
 * Centerline — для расчётов; outline — для отображения (buildWallGeometry).
 */
import { near, dist } from "../geometry/point.js";
import { collinearOverlap, segmentsIntersectProper, segmentIntersectionPoint } from "../geometry/segment.js";
import { simplifyPolyline } from "../geometry/polyline.js";
import { normalizeWall, DEFAULT_MERGE_VERTEX_MM } from "./wallModel.js";
import {
  weldWallNodes, breakWallAt,
  findWallOverlaps, wallSegments, NODE_LINK_THR, projectOnSegment,
} from "./wallOps.js";

export { DEFAULT_MERGE_VERTEX_MM };
export const INTERSECTION_TOLERANCE_MM = 2;
export const COLLINEAR_TOLERANCE_DEG = 1;
export const MINIMUM_WALL_LENGTH_MM = 50;

function mergeWallVertices(walls, thr = DEFAULT_MERGE_VERTEX_MM) {
  return weldWallNodes(walls, thr);
}

function splitAtIntersections(walls, intersectionToleranceMm = INTERSECTION_TOLERANCE_MM) {
  let out = [...walls];
  const segs = wallSegments(out);
  const splits = [];

  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s1 = segs[i];
      const s2 = segs[j];
      if (s1.wallId === s2.wallId) continue;
      if (!segmentsIntersectProper(s1.a, s1.b, s2.a, s2.b)) continue;
      const ip = segmentIntersectionPoint(s1.a, s1.b, s2.a, s2.b);
      if (ip) {
        if (dist(ip, s1.a) <= intersectionToleranceMm || dist(ip, s1.b) <= intersectionToleranceMm) continue;
        if (dist(ip, s2.a) <= intersectionToleranceMm || dist(ip, s2.b) <= intersectionToleranceMm) continue;
        splits.push({ wallId: s1.wallId, pt: ip }, { wallId: s2.wallId, pt: ip });
      }
    }
  }

  for (const sp of splits) {
    const wi = out.findIndex((w) => w.id === sp.wallId);
    if (wi < 0) continue;
    const parts = breakWallAt(out[wi], sp.pt);
    if (parts) {
      const [w1, w2] = parts;
      w2.id = `${sp.wallId}_x${Math.round(sp.pt.x)}_${Math.round(sp.pt.y)}`;
      out = [...out.slice(0, wi), w1, w2, ...out.slice(wi + 1)];
    }
  }
  return out;
}

function insertTeeJoints(walls, makeId) {
  let out = [...walls];
  const allEnds = [];
  out.forEach((w) => {
    if (w.pts?.length >= 2) {
      allEnds.push({ wallId: w.id, pt: w.pts[0] }, { wallId: w.id, pt: w.pts[w.pts.length - 1] });
    }
  });
  for (const ep of allEnds) {
    for (let wi = 0; wi < out.length; wi++) {
      const w = out[wi];
      if (!w?.pts?.length || w.id === ep.wallId) continue;
      let shouldSplit = false;
      for (let i = 1; i < w.pts.length; i++) {
        const a = w.pts[i - 1];
        const b = w.pts[i];
        if (near(ep.pt, a, INTERSECTION_TOLERANCE_MM) || near(ep.pt, b, INTERSECTION_TOLERANCE_MM)) continue;
        const proj = projectOnSegment(ep.pt, a, b);
        if (dist(ep.pt, proj) <= INTERSECTION_TOLERANCE_MM) {
          shouldSplit = true;
          break;
        }
      }
      if (!shouldSplit) continue;
      const parts = breakWallAt(w, ep.pt);
      if (!parts) continue;
      const [w1, w2] = parts;
      w2.id = makeId ? makeId("wl") : `${w.id}_tee_${wi}`;
      out = [...out.slice(0, wi), w1, w2, ...out.slice(wi + 1)];
      break;
    }
  }
  return out;
}

function endpointDegree(walls, pt, thr = NODE_LINK_THR) {
  let n = 0;
  for (const w of walls) {
    if (!w.pts?.length) continue;
    if (near(w.pts[0], pt, thr) || near(w.pts[w.pts.length - 1], pt, thr)) n += 1;
  }
  return n;
}

function ang(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
}

function isCollinear(a1, a2, b1, b2, tolDeg = COLLINEAR_TOLERANCE_DEG) {
  let d = Math.abs(ang(a1, a2) - ang(b1, b2));
  if (d > 180) d = 360 - d;
  return d <= tolDeg || Math.abs(d - 180) <= tolDeg;
}

function tryMergeCollinearPair(w1, w2, walls, tolDeg = COLLINEAR_TOLERANCE_DEG) {
  const a0 = w1.pts[0];
  const a1 = w1.pts[w1.pts.length - 1];
  const b0 = w2.pts[0];
  const b1 = w2.pts[w2.pts.length - 1];
  const cases = [
    { p1: a1, p2: b0, pts: [...w1.pts, ...w2.pts.slice(1)] },
    { p1: a1, p2: b1, pts: [...w1.pts, ...[...w2.pts].reverse().slice(1)] },
    { p1: a0, p2: b1, pts: [...w2.pts, ...w1.pts.slice(1)] },
    { p1: a0, p2: b0, pts: [...[...w2.pts].reverse(), ...w1.pts.slice(1)] },
  ];

  for (const c of cases) {
    if (!near(c.p1, c.p2, NODE_LINK_THR)) continue;
    if (endpointDegree(walls, c.p1) > 2) continue;
    const p0 = c.pts[0];
    const p1m = c.pts[Math.floor((c.pts.length - 1) / 2)];
    const pN = c.pts[c.pts.length - 1];
    if (!isCollinear(p0, p1m, p1m, pN, tolDeg)) continue;
    return { ...w1, pts: c.pts };
  }
  return null;
}

function mergeCollinearChains(walls, tolDeg = COLLINEAR_TOLERANCE_DEG) {
  let out = [...walls];
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const w1 = out[i];
        const w2 = out[j];
        if (!w1?.pts?.length || !w2?.pts?.length) continue;
        const merged = tryMergeCollinearPair(w1, w2, out, tolDeg);
        if (!merged) continue;
        out = out.filter((_, idx) => idx !== j).map((w, idx) => (idx === i ? merged : w));
        changed = true;
        break;
      }
      if (changed) break;
    }
  }
  return out;
}

function removeDuplicateOverlaps(walls, angleToleranceDeg = COLLINEAR_TOLERANCE_DEG) {
  const unique = [];
  const hasSame = (a, b) => {
    if (!a?.pts?.length || !b?.pts?.length) return false;
    const a0 = a.pts[0];
    const a1 = a.pts[a.pts.length - 1];
    const b0 = b.pts[0];
    const b1 = b.pts[b.pts.length - 1];
    return (
      (near(a0, b0, INTERSECTION_TOLERANCE_MM) && near(a1, b1, INTERSECTION_TOLERANCE_MM))
      || (near(a0, b1, INTERSECTION_TOLERANCE_MM) && near(a1, b0, INTERSECTION_TOLERANCE_MM))
    );
  };
  walls.forEach((w) => {
    if (!unique.some((u) => hasSame(u, w))) unique.push(w);
  });

  const overlaps = findWallOverlaps(unique);
  if (!overlaps.length) return unique;
  const dropIds = new Set();
  overlaps.forEach((o) => {
    if (o.wallIds?.length >= 2) {
      const a = unique.find((w) => w.id === o.wallIds[0]);
      const b = unique.find((w) => w.id === o.wallIds[1]);
      if (!a?.pts?.length || !b?.pts?.length) return;
      const aa = a.pts[a.pts.length - 1];
      const ab = a.pts[0];
      const ba = b.pts[b.pts.length - 1];
      const bb = b.pts[0];
      const aAng = Math.atan2(aa.y - ab.y, aa.x - ab.x) * 180 / Math.PI;
      const bAng = Math.atan2(ba.y - bb.y, ba.x - bb.x) * 180 / Math.PI;
      let diff = Math.abs(aAng - bAng);
      if (diff > 180) diff = 360 - diff;
      if (diff <= angleToleranceDeg || Math.abs(diff - 180) <= angleToleranceDeg) {
        dropIds.add(o.wallIds[1]);
      }
    }
  });
  return unique.filter((w) => !dropIds.has(w.id));
}

function normalizePts(walls) {
  return walls.map((w) => {
    if (!w.pts?.length) return w;
    const pts = simplifyPolyline(w.pts, DEFAULT_MERGE_VERTEX_MM / 2);
    return normalizeWall({ ...w, pts });
  });
}

/**
 * Главная функция нормализации после завершения стены.
 */
export function normalizeWalls(walls, options = {}) {
  const {
    mergeMm = DEFAULT_MERGE_VERTEX_MM,
    makeId = () => `n_${Date.now()}`,
    skipIntersectSplit = false,
    intersectionToleranceMm = INTERSECTION_TOLERANCE_MM,
    collinearToleranceDeg = COLLINEAR_TOLERANCE_DEG,
  } = options;

  if (!walls?.length) return [];

  let out = normalizePts(walls);
  out = mergeWallVertices(out, mergeMm);
  out = insertTeeJoints(out, makeId);
  if (!skipIntersectSplit) out = splitAtIntersections(out, intersectionToleranceMm);
  out = mergeCollinearChains(out, collinearToleranceDeg);
  out = removeDuplicateOverlaps(out, collinearToleranceDeg);
  out = mergeWallVertices(out, mergeMm);
  return out.map((w) => normalizeWall(w));
}

/** Проверка коллинеарного наложения (для тестов). */
export function wallsCollinearOverlap(w1a, w1b, w2a, w2b) {
  return collinearOverlap(w1a, w1b, w2a, w2b);
}
