import {
  snap,
  dist,
  near as nearPt,
  clamp,
  polygonBounds,
  polygonArea,
  polygonCentroid,
  insetPolygon,
  pointInPolygon,
  pointAtLength,
  projectOnSegment,
  segmentsIntersectProper,
  segDirUnit,
  normalizeAngleDeg,
  angleDiff,
  projectPointToAngle,
} from "../geometry/index.js";
import { isDoorKind, isWallOpeningKind } from "../../doorTypes.js";
import { inwardNormal, wallFacePoint, wallFaceDistances } from "../../wallParallelGeometry.js";

const SNAP_DIST = 80;
export const NODE_LINK_THR = 85;

export { dist, polygonBounds, polygonArea, polygonCentroid, insetPolygon, pointInPolygon, pointAtLength, projectOnSegment, segmentsIntersectProper };

function near(a, b, thr = SNAP_DIST) {
  return nearPt(a, b, thr);
}

export { near };

/** Есть ли нарисованные пользователем стены (не виртуальный лист). */
export function planHasDrawnWalls(walls) {
  return (walls || []).some((w) => (w.pts?.length || 0) >= 2 || (w.a && w.b));
}

/** Рёбра a/b + plan.nodes → стены с pts для геометрии (без циклических импортов).
 * Приоритет: network (a/b + nodes) > legacy (pts).
 */
export function resolveWallPtsList(walls, nodes = {}) {
  const nodeMap = nodes || {};
  return (walls || [])
    .map((w) => {
      if (w.a && w.b && nodeMap[w.a] && nodeMap[w.b]) {
        return {
          ...w,
          pts: [
            { x: nodeMap[w.a].x, y: nodeMap[w.a].y },
            { x: nodeMap[w.b].x, y: nodeMap[w.b].y },
          ],
        };
      }
      if (w.pts?.length >= 2) return { ...w };
      return w;
    })
    .filter((w) => w.pts?.length >= 2);
}

export function roomOuterWallSegments(room) {
  const t = room.wallThk / 2;
  return [
    { a: { x: t, y: t }, b: { x: room.w - t, y: t }, wallId: "outer", thk: room.wallThk },
    { a: { x: room.w - t, y: t }, b: { x: room.w - t, y: room.h - t }, wallId: "outer", thk: room.wallThk },
    { a: { x: room.w - t, y: room.h - t }, b: { x: t, y: room.h - t }, wallId: "outer", thk: room.wallThk },
    { a: { x: t, y: room.h - t }, b: { x: t, y: t }, wallId: "outer", thk: room.wallThk },
  ];
}

function roomOuterSnapPoints(room) {
  const t = room.wallThk / 2;
  return [
    { x: t, y: t }, { x: room.w - t, y: t },
    { x: room.w - t, y: room.h - t }, { x: t, y: room.h - t },
    { x: room.w / 2, y: t }, { x: room.w / 2, y: room.h - t },
    { x: t, y: room.h / 2 }, { x: room.w - t, y: room.h / 2 },
  ];
}

/** Рабочая область плана: по нарисованным стенам/помещениям, не по дефолтному листу 12×8 м. */
export function planWorkingBounds(plan) {
  const room = plan?.room || {};
  const walls = resolveWallPtsList(plan?.walls, plan?.nodes);
  const t = (room.wallThk || 200) / 2;
  const pad = 2000;

  if (planHasDrawnWalls(walls)) {
    const b = wallEndpointBounds(walls);
    if (b && b.w >= 200 && b.h >= 200) {
      return { l: b.x + t, t: b.y + t, r: b.x + b.w - t, b: b.y + b.h - t };
    }
  }

  const zones = plan?.zones || [];
  if (zones.length > 0) {
    const pts = [];
    zones.forEach((z) => {
      if (z.polygon?.length >= 3) z.polygon.forEach((p) => pts.push(p));
      else if (z.w != null && z.h != null) {
        pts.push({ x: z.x, y: z.y }, { x: z.x + z.w, y: z.y + z.h });
      }
    });
    if (pts.length >= 2) {
      const b = polygonBounds(pts);
      return { l: b.x, t: b.y, r: b.x + b.w, b: b.y + b.h };
    }
  }

  return {
    l: t,
    t: t,
    r: (room.w || 12000) - t,
    b: (room.h || 8000) - t,
  };
}

/** Все узлы стен (концы сегментов). */
export function collectWallNodes(walls, room = null) {
  const nodes = [];
  (walls || []).forEach((w) => (w.pts || []).forEach((p) => nodes.push({ ...p, wallId: w.id })));
  if (room && !planHasDrawnWalls(walls)) {
    const t = room.wallThk / 2;
    nodes.push(
      { x: t, y: t }, { x: room.w - t, y: t },
      { x: room.w - t, y: room.h - t }, { x: t, y: room.h - t },
    );
  }
  return nodes;
}

/** Магнит к узлам стен и сетке. */
export function snapWallPoint(pt, walls, room, zoom, snapOn, gridStep = 50) {
  const thr = SNAP_DIST / Math.max(zoom, 0.05);
  let best = null;
  const trySnap = (target, kind = "node") => {
    const d = dist(pt, target);
    if (d <= thr && (!best || d < best.d)) best = { x: target.x, y: target.y, d, kind };
  };

  if (snapOn) {
    walls.forEach((w) => (w.pts || []).forEach((p) => trySnap(p)));
    walls.forEach((w) => {
      if (!w.pts || w.pts.length < 2) return;
      for (let i = 1; i < w.pts.length; i++) {
        const proj = projectOnSegment(pt, w.pts[i - 1], w.pts[i]);
        trySnap(proj, "wall-seg");
      }
    });
    if (room && !planHasDrawnWalls(walls)) {
      roomOuterSnapPoints(room).forEach((p) => trySnap(p, "corner"));
    }
    const gx = snap(pt.x, gridStep, true);
    const gy = snap(pt.y, gridStep, true);
    trySnap({ x: gx, y: gy }, "grid");
  }

  return best ? { x: best.x, y: best.y, snapped: true, kind: best.kind } : { ...pt, snapped: false };
}

function nearestWallSegmentProj(pt, walls) {
  let best = null;
  wallSegments(walls).forEach((s) => {
    const proj = projectOnSegment(pt, s.a, s.b);
    const d = dist(pt, proj);
    if (!best || d < best.d) best = { ...s, proj, d };
  });
  return best;
}

function isPerpendicularToSegment(segAng, lineAng, toleranceDeg = 8) {
  const perpA = angleDiff(segAng + 90, lineAng);
  const perpB = angleDiff(segAng - 90, lineAng);
  return Math.min(perpA, perpB) <= toleranceDeg;
}

/**
 * Уточнение точки черчения стены: T-стык под 90°, прилипание к оси существующей стены.
 */
export function refineWallDraftSnap(from, pt, angleSnap, walls, room, zoom, {
  snapOn = true,
  toleranceDeg = 8,
  wallThk = 100,
} = {}) {
  if (!snapOn || !from || !walls?.length) {
    return { pt, fromAdjust: from, snap: null };
  }

  const thr = SNAP_DIST / Math.max(zoom, 0.05);
  const attachThr = Math.max(thr, (wallThk || 100) * 1.15);
  let outPt = { ...pt };
  let fromAdjust = { ...from };
  let snap = null;

  const nearFrom = nearestWallSegmentProj(from, walls);
  if (nearFrom && nearFrom.d <= attachThr) {
    const segAng = normalizeAngleDeg(Math.atan2(nearFrom.b.y - nearFrom.a.y, nearFrom.b.x - nearFrom.a.x) * 180 / Math.PI);
    const lineAng = normalizeAngleDeg(Math.atan2(pt.y - from.y, pt.x - from.x) * 180 / Math.PI);
    const perpA = normalizeAngleDeg(segAng + 90);
    const perpB = normalizeAngleDeg(segAng - 90);
    const perp = isPerpendicularToSegment(segAng, lineAng, toleranceDeg)
      || angleSnap?.guideType === "wall-perp"
      || angleSnap?.guideType === "perpendicular";

    if (perp) {
      fromAdjust = { x: nearFrom.proj.x, y: nearFrom.proj.y };
      const len = Math.max(Math.hypot(pt.x - from.x, pt.y - from.y), 50);
      const useAng = angleDiff(perpA, lineAng) <= angleDiff(perpB, lineAng) ? perpA : perpB;
      outPt = projectPointToAngle(fromAdjust, useAng, len);
      snap = { snapped: true, kind: "wall-t", wallId: nearFrom.wallId };
    }
  }

  const nearEnd = nearestWallSegmentProj(outPt, walls);
  if (nearEnd && nearEnd.d <= attachThr) {
    const segAng = normalizeAngleDeg(Math.atan2(nearEnd.b.y - nearEnd.a.y, nearEnd.b.x - nearEnd.a.x) * 180 / Math.PI);
    const lineAng = normalizeAngleDeg(Math.atan2(outPt.y - fromAdjust.y, outPt.x - fromAdjust.x) * 180 / Math.PI);
    if (isPerpendicularToSegment(segAng, lineAng, toleranceDeg)) {
      outPt = { x: nearEnd.proj.x, y: nearEnd.proj.y };
      snap = { snapped: true, kind: "wall-t-end", wallId: nearEnd.wallId };
    }
  }

  return { pt: outPt, fromAdjust, snap };
}

/** Вставить узел в стену, если точка лежит на сегменте (T-стык). */
export function ensureWallNodesAtPoints(walls, points, makeId, thr = NODE_LINK_THR) {
  let out = [...walls];
  (points || []).forEach((pt) => {
    for (let wi = 0; wi < out.length; wi++) {
      const w = out[wi];
      const parts = breakWallAt(w, pt);
      if (!parts) continue;
      const [w1, w2] = parts;
      w2.id = makeId();
      out = [...out.slice(0, wi), w1, w2, ...out.slice(wi + 1)];
      break;
    }
  });
  return out;
}

export function wallSegments(walls) {
  const segs = [];
  (walls || []).forEach((w) => {
    const pts = w.pts;
    if (!pts || pts.length < 2) return;
    for (let i = 1; i < pts.length; i++) {
      segs.push({ a: pts[i - 1], b: pts[i], wallId: w.id, thk: w.thk });
    }
  });
  return segs;
}

function onSegment(a, b, c) {
  return (
    Math.min(a.x, b.x) - 1 <= c.x && c.x <= Math.max(a.x, b.x) + 1 &&
    Math.min(a.y, b.y) - 1 <= c.y && c.y <= Math.max(a.y, b.y) + 1
  );
}

function endpointOnSegment(p, a, b, eps = 12) {
  if (near(p, a, eps) || near(p, b, eps)) return false;
  const cross = Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1) return false;
  return cross / len <= eps && onSegment(a, b, p);
}

/** Конец сегмента на другом сегменте (T- или L-стык) — не ошибка. */
function segmentsMeetAtJunction(s1, s2, eps = 12) {
  if (
    near(s1.a, s2.a, eps) || near(s1.a, s2.b, eps) ||
    near(s1.b, s2.a, eps) || near(s1.b, s2.b, eps)
  ) {
    return true;
  }
  return (
    endpointOnSegment(s1.a, s2.a, s2.b, eps) ||
    endpointOnSegment(s1.b, s2.a, s2.b, eps) ||
    endpointOnSegment(s2.a, s1.a, s1.b, eps) ||
    endpointOnSegment(s2.b, s1.a, s1.b, eps)
  );
}

/** Пересечение стен (не в общих концах и не T-стык). */
export function findWallIntersections(walls) {
  const segs = wallSegments(walls);
  const hits = [];
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s1 = segs[i];
      const s2 = segs[j];
      if (s1.wallId === s2.wallId) continue;
      if (segmentsMeetAtJunction(s1, s2)) continue;
      if (segmentsIntersectProper(s1.a, s1.b, s2.a, s2.b)) {
        hits.push({ id: `wx-${s1.wallId}-${s2.wallId}`, wallIds: [s1.wallId, s2.wallId] });
      }
    }
  }
  return hits;
}

/** Построить граф узлов из сегментов стен. */
function buildWallGraph(walls, thr = SNAP_DIST) {
  const nodes = [];
  const key = (p) => `${Math.round(p.x / thr)}_${Math.round(p.y / thr)}`;

  const getNode = (p) => {
    const k = key(p);
    let n = nodes.find((x) => key(x) === k);
    if (!n) { n = { x: p.x, y: p.y, key: k, edges: [] }; nodes.push(n); }
    return n;
  };

  walls.forEach((w) => {
    if (!w.pts || w.pts.length < 2) return;
    for (let i = 1; i < w.pts.length; i++) {
      const na = getNode(w.pts[i - 1]);
      const nb = getNode(w.pts[i]);
      if (!na.edges.find((e) => e.to === nb)) na.edges.push({ to: nb, wallId: w.id });
      if (!nb.edges.find((e) => e.to === na)) nb.edges.push({ to: na, wallId: w.id });
    }
  });
  return nodes;
}

/** Найти замкнутые контуры (простые циклы). */
export function findClosedLoops(walls, maxLoops = 48) {
  const nodes = buildWallGraph(walls);
  const loops = [];
  const seen = new Set();
  let steps = 0;
  const maxSteps = 8000;

  const walk = (start, cur, path, visitedEdges) => {
    if (loops.length >= maxLoops || steps++ > maxSteps) return;
    if (path.length > 2 && cur === start) {
      const sig = path.map((n) => n.key).sort().join("|");
      if (!seen.has(sig)) {
        seen.add(sig);
        loops.push(path.map((n) => ({ x: n.x, y: n.y })));
      }
      return;
    }
    if (path.length > 24) return;
    for (const e of cur.edges) {
      const eid = [cur.key, e.to.key].sort().join("-");
      if (visitedEdges.has(eid)) continue;
      visitedEdges.add(eid);
      walk(start, e.to, [...path, e.to], visitedEdges);
      visitedEdges.delete(eid);
      if (loops.length >= maxLoops || steps > maxSteps) return;
    }
  };

  for (const n of nodes) {
    walk(n, n, [n], new Set());
    if (loops.length >= maxLoops || steps > maxSteps) break;
  }
  return loops;
}

function findWallSegForEdge(a, b, walls, thr = 120) {
  let best = null;
  wallSegments(walls).forEach((s) => {
    const dFwd = dist(a, s.a) + dist(b, s.b);
    const dRev = dist(a, s.b) + dist(b, s.a);
    const d = Math.min(dFwd, dRev);
    if (d <= thr * 2 && (!best || d < best.d)) best = { seg: s, d };
  });
  return best?.seg || null;
}

function offsetEdgeInward(a, b, wall, room, fallbackInset) {
  const { nx, ny } = inwardNormal(a, b, room);
  const { inner } = wall ? wallFaceDistances(wall) : { inner: fallbackInset };
  const inset = wall ? inner : fallbackInset;
  return {
    a: { x: a.x + nx * inset, y: a.y + ny * inset },
    b: { x: b.x + nx * inset, y: b.y + ny * inset },
  };
}

/** Полигон помещения по внутренней грани стен (не по оси). */
export function innerRoomPolygonFromLoop(centerPoly, walls, room, fallbackInset = 50) {
  if (!centerPoly?.length || centerPoly.length < 3) return centerPoly;
  const n = centerPoly.length;
  const offsetEdges = [];
  for (let i = 0; i < n; i++) {
    const a = centerPoly[i];
    const b = centerPoly[(i + 1) % n];
    const seg = findWallSegForEdge(a, b, walls);
    const wall = seg ? walls.find((w) => w.id === seg.wallId) : null;
    offsetEdges.push(offsetEdgeInward(a, b, wall, room, fallbackInset));
  }
  const inner = [];
  for (let i = 0; i < n; i++) {
    const prev = offsetEdges[(i + n - 1) % n];
    const cur = offsetEdges[i];
    const d0 = segDirUnit(prev.a, prev.b);
    const d1 = segDirUnit(cur.a, cur.b);
    const cross = d0.x * d1.y - d0.y * d1.x;
    if (Math.abs(cross) < 1e-6) {
      inner.push(cur.a);
      continue;
    }
    const dx = cur.a.x - prev.a.x;
    const dy = cur.a.y - prev.a.y;
    const t = (dx * d1.y - dy * d1.x) / cross;
    inner.push({ x: prev.a.x + d0.x * t, y: prev.a.y + d0.y * t });
  }
  return inner.length >= 3 ? inner : insetPolygon(centerPoly, fallbackInset);
}

const MIN_ROOM_AREA_MM2 = 600000; // ~0.6 м²

function loopSignature(poly) {
  const c = polygonCentroid(poly);
  const a = Math.round(polygonArea(poly) / 1000);
  return `${Math.round(c.x / 50)}_${Math.round(c.y / 50)}_${a}`;
}

function wallEndpointBounds(walls) {
  const pts = [];
  (walls || []).forEach((w) => w.pts?.forEach((p) => pts.push(p)));
  if (pts.length < 3) return null;
  return polygonBounds(pts);
}

function boundsRectanglePoly(b) {
  return [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x + b.w, y: b.y + b.h },
    { x: b.x, y: b.y + b.h },
  ];
}

function onSameBoundsEdge(a, b, bnd, eps = SNAP_DIST * 1.5) {
  const rx = bnd.x + bnd.w;
  const ty = bnd.y + bnd.h;
  const onLeft = Math.abs(a.x - bnd.x) <= eps && Math.abs(b.x - bnd.x) <= eps;
  const onRight = Math.abs(a.x - rx) <= eps && Math.abs(b.x - rx) <= eps;
  const onTop = Math.abs(a.y - bnd.y) <= eps && Math.abs(b.y - bnd.y) <= eps;
  const onBottom = Math.abs(a.y - ty) <= eps && Math.abs(b.y - ty) <= eps;
  return onLeft || onRight || onTop || onBottom;
}

/** Сегмент почти горизонтален или вертикален (диагонали не считаются перегородками). */
function isAxisAlignedSegment(a, b, minRatio = 0.9) {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  const len = Math.hypot(dx, dy);
  if (len < 250) return false;
  return (dx / len >= minRatio) || (dy / len >= minRatio);
}

function hasInternalPartitionSegments(walls, bounds) {
  if (!bounds?.w || !bounds?.h) return false;
  const eps = SNAP_DIST * 1.5;
  const rx = bounds.x + bounds.w;
  const ty = bounds.y + bounds.h;
  const minLen = Math.min(bounds.w, bounds.h) * 0.35;
  for (const w of walls || []) {
    for (let i = 1; i < (w.pts?.length || 0); i++) {
      const a = w.pts[i - 1];
      const b = w.pts[i];
      if (dist(a, b) < 250) continue;
      if (onSameBoundsEdge(a, b, bounds, eps)) continue;
      if (!isAxisAlignedSegment(a, b)) continue;
      const horiz = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
      if (horiz) {
        const y = (a.y + b.y) / 2;
        if (Math.abs(y - bounds.y) <= eps || Math.abs(y - ty) <= eps) continue;
        if (Math.abs(b.x - a.x) >= minLen) return true;
      } else {
        const x = (a.x + b.x) / 2;
        if (Math.abs(x - bounds.x) <= eps || Math.abs(x - rx) <= eps) continue;
        if (Math.abs(b.y - a.y) >= minLen) return true;
      }
    }
  }
  return false;
}

/** Перегородка через всё помещение от края до края (не T-ответвление). */
function hasFullSpanningPartition(walls, bounds) {
  if (!bounds?.w || !bounds?.h) return false;
  const eps = SNAP_DIST * 1.5;
  const rx = bounds.x + bounds.w;
  const ty = bounds.y + bounds.h;
  for (const w of walls || []) {
    for (let i = 1; i < (w.pts?.length || 0); i++) {
      const a = w.pts[i - 1];
      const b = w.pts[i];
      if (dist(a, b) < 250) continue;
      if (onSameBoundsEdge(a, b, bounds, eps)) continue;
      if (!isAxisAlignedSegment(a, b)) continue;
      const horiz = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
      if (horiz) {
        const y = (a.y + b.y) / 2;
        if (Math.abs(y - bounds.y) <= eps || Math.abs(y - ty) <= eps) continue;
        const minX = Math.min(a.x, b.x);
        const maxX = Math.max(a.x, b.x);
        if (minX <= bounds.x + eps + 400 && maxX >= rx - eps - 400) return true;
      } else {
        const x = (a.x + b.x) / 2;
        if (Math.abs(x - bounds.x) <= eps || Math.abs(x - rx) <= eps) continue;
        const minY = Math.min(a.y, b.y);
        const maxY = Math.max(a.y, b.y);
        if (minY <= bounds.y + eps + 400 && maxY >= ty - eps - 400) return true;
      }
    }
  }
  return false;
}

function similarAreaLoops(meta, tol = 0.14) {
  if (meta.length < 2) return false;
  const avg = meta.reduce((s, m) => s + m.area, 0) / meta.length;
  return meta.every((m) => Math.abs(m.area - avg) / avg <= tol);
}

/** Несколько «комнат» с одинаковой площадью — артефакт графа (T-стыки, диагонали). */
function collapseSimilarAreaLoops(meta, walls) {
  if (meta.length < 2 || !similarAreaLoops(meta)) return meta;
  const bounds = wallEndpointBounds(walls);
  if (!bounds) return meta;
  const boxArea = bounds.w * bounds.h;
  const avgArea = meta.reduce((s, m) => s + m.area, 0) / meta.length;
  if (boxArea > 0 && Math.abs(avgArea - boxArea) / boxArea < 0.35 && !hasFullSpanningPartition(walls, bounds)) {
    const poly = boundsRectanglePoly(bounds);
    return [{ poly, area: polygonArea(poly), cen: polygonCentroid(poly) }];
  }
  const env = envelopeRoomFromWalls(walls);
  if (env) {
    return [{ poly: env, area: polygonArea(env), cen: polygonCentroid(env) }];
  }
  return meta;
}

/** Убрать дубликаты контуров с близким центром и площадью. */
function clusterRoomLoops(meta) {
  if (meta.length <= 1) return meta;
  const sorted = [...meta].sort((a, b) => b.area - a.area);
  const kept = [];
  for (const m of sorted) {
    const dup = kept.some((k) => {
      const dc = dist(m.cen, k.cen);
      const ar = Math.abs(m.area - k.area) / Math.max(m.area, k.area, 1);
      return (dc < 1200 && ar < 0.12) || (dc < 650 && ar < 0.28);
    });
    if (!dup) kept.push(m);
  }
  return kept;
}

/** Убрать мелкие «ячейки» графа внутри одного помещения (не настоящие вложенные комнаты). */
function filterContainedRoomLoops(meta) {
  if (meta.length <= 1) return meta;
  const sorted = [...meta].sort((a, b) => b.area - a.area);
  const kept = [];
  for (const m of sorted) {
    const container = kept.find((k) => k.area > m.area && pointInPolygon(m.cen, k.poly));
    if (!container) {
      kept.push(m);
      continue;
    }
    const ratio = m.area / container.area;
    const similarInside = sorted.filter((other) => {
      if (other === m || other.area >= m.area) return false;
      if (!pointInPolygon(other.cen, container.poly)) return false;
      const ar = Math.abs(other.area - m.area) / Math.max(m.area, 1);
      return ar < 0.2;
    }).length;
    const duplicateCenter = dist(m.cen, container.cen) < 900 && ratio > 0.68;
    const gridArtifact = ratio < 0.08 || (ratio < 0.34 && similarInside >= 1) || duplicateCenter;
    if (!gridArtifact) kept.push(m);
  }
  return kept;
}

/** Вложенная комната (прямоугольник внутри контура), а не ячейка T-стыка. */
function isLikelyNestedRoom(inner, outer) {
  const ratio = inner.area / Math.max(outer.area, 1);
  if (ratio < 0.035 || ratio > 0.55) return false;
  const ib = polygonBounds(inner.poly);
  const ob = polygonBounds(outer.poly);
  const insetL = ib.x - ob.x;
  const insetT = ib.y - ob.y;
  const insetR = (ob.x + ob.w) - (ib.x + ib.w);
  const insetB = (ob.y + ob.h) - (ib.y + ib.h);
  return insetL > 400 && insetT > 400 && insetR > 400 && insetB > 400;
}

/** Несколько ячеек графа внутри одного помещения (T-стыки) → одно помещение. */
function mergeAdjacentFaceLoops(meta, walls) {
  if (meta.length <= 1) return meta;
  const bounds = wallEndpointBounds(walls);
  const boundsArea = bounds ? bounds.w * bounds.h : 0;
  let sorted = [...meta].sort((a, b) => b.area - a.area);

  if (boundsArea > 0) {
    sorted = sorted.filter((m) => Math.abs(m.area - boundsArea) / boundsArea > 0.08);
  }
  if (sorted.length <= 1) return meta;

  let changed = true;
  while (changed && sorted.length > 1) {
    changed = false;
    const outer = sorted[0];
    const inside = sorted.slice(1).filter((m) => pointInPolygon(m.cen, outer.poly));
    if (!inside.length) break;
    if (inside.some((m) => isLikelyNestedRoom(m, outer))) break;
    const sumInside = inside.reduce((s, m) => s + m.area, 0);
    if (sumInside / outer.area < 0.22) break;
    const outside = sorted.slice(1).filter((m) => !pointInPolygon(m.cen, outer.poly));
    sorted = [outer, ...outside];
    changed = true;
  }
  return sorted;
}

function envelopeRoomFromWalls(walls) {
  const bounds = wallEndpointBounds(walls);
  if (!bounds || bounds.w < 500 || bounds.h < 500) return null;
  if (hasFullSpanningPartition(walls, bounds)) return null;
  const poly = boundsRectanglePoly(bounds);
  return polygonArea(poly) >= MIN_ROOM_AREA_MM2 ? poly : null;
}

/** Оставить осмысленные помещения: все замкнутые контуры, без дубликатов и сетки ячеек. */
export function filterRoomLoops(loops, walls = []) {
  const meta = loops
    .map((poly) => ({ poly, area: polygonArea(poly), cen: polygonCentroid(poly) }))
    .filter((l) => l.area >= MIN_ROOM_AREA_MM2);

  const seen = new Set();
  let uniq = meta.filter((l) => {
    const sig = loopSignature(l.poly);
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });

  uniq = clusterRoomLoops(uniq);
  uniq = collapseSimilarAreaLoops(uniq, walls);
  uniq = filterContainedRoomLoops(uniq);
  const bounds = wallEndpointBounds(walls);
  if (!hasFullSpanningPartition(walls, bounds) && uniq.length > 1 && bounds) {
    const sum = uniq.reduce((s, m) => s + m.area, 0);
    const boxArea = bounds.w * bounds.h;
    if (boxArea > 0 && sum / boxArea > 0.42 && sum / boxArea < 1.08) {
      const env = envelopeRoomFromWalls(walls);
      if (env) return [env];
    }
    uniq = mergeAdjacentFaceLoops(uniq, walls);
  }

  // Несколько «комнат» без перегородок через всё помещение — артефакт графа, одно помещение.
  if (uniq.length > 1) {
    const env = envelopeRoomFromWalls(walls);
    const hasNested = uniq.some((inner, i) => uniq.some((outer, j) => (
      i !== j && outer.area > inner.area && isLikelyNestedRoom(inner, outer)
    )));
    if (env && !hasFullSpanningPartition(walls, wallEndpointBounds(walls)) && !hasNested) {
      return [env];
    }
  }

  if (uniq.length > 1 && similarAreaLoops(uniq)) {
    const bounds = wallEndpointBounds(walls);
    if (bounds) {
      const sum = uniq.reduce((s, m) => s + m.area, 0);
      const boxArea = bounds.w * bounds.h;
      if (boxArea > 0 && Math.abs(sum - boxArea) / boxArea < 0.2 && !hasInternalPartitionSegments(walls, bounds)) {
        return [boundsRectanglePoly(bounds)];
      }
    }
  }

  if (uniq.length > 1 && similarAreaLoops(uniq)) {
    const env = envelopeRoomFromWalls(walls);
    if (env) return [env];
  }

  if (uniq.length > 8 && !hasInternalPartitionSegments(walls, wallEndpointBounds(walls))) {
    const env = envelopeRoomFromWalls(walls);
    if (env) return [env];
  }

  return uniq.sort((a, b) => b.area - a.area).map((l) => l.poly);
}

/** Соседние точки стены в других стенах (для miter-углов). */
export function wallPointNeighbors(walls, wallId, ptIdx, thr = NODE_LINK_THR) {
  const wall = walls.find((w) => w.id === wallId);
  if (!wall?.pts?.[ptIdx]) return [];
  return wallPointNeighborsAt(walls, wall.pts[ptIdx], wallId, thr, ptIdx);
}

/** Все направления от вершины pt (по координатам, не только по индексу). */
export function wallPointNeighborsAt(walls, pt, excludeWallId = null, thr = NODE_LINK_THR, excludePtIdx = null) {
  if (!pt) return [];
  const out = [];
  for (const w of walls || []) {
    if (!w?.pts?.length) continue;
    for (let i = 0; i < w.pts.length; i++) {
      if (!near(w.pts[i], pt, thr)) continue;
      if (w.id === excludeWallId && excludePtIdx != null && i === excludePtIdx) {
        /* skip self */
      }
      if (i > 0 && dist(w.pts[i - 1], pt) > 1) out.push(w.pts[i - 1]);
      if (i < w.pts.length - 1 && dist(w.pts[i + 1], pt) > 1) out.push(w.pts[i + 1]);
    }
  }
  const uniq = [];
  for (const q of out) {
    if (!uniq.some((u) => dist(u, q) < 2)) uniq.push(q);
  }
  return uniq;
}

export function wallMiterPrev(walls, wall, segStartIdx, thr = NODE_LINK_THR) {
  if (segStartIdx > 0) return wall.pts[segStartIdx - 1];
  const a = wall.pts[segStartIdx];
  const b = wall.pts[segStartIdx + 1];
  let nbs = wallPointNeighbors(walls, wall.id, segStartIdx, thr);
  if (!nbs.length) {
    nbs = wallPointNeighborsAt(walls, a, wall.id, thr, segStartIdx).filter((q) => dist(q, b) > 1);
  }
  return bestMiterNeighbor(a, b, nbs);
}

export function wallMiterNext(walls, wall, segEndIdx, thr = NODE_LINK_THR) {
  if (segEndIdx < wall.pts.length - 1) return wall.pts[segEndIdx + 1];
  const a = wall.pts[segEndIdx - 1];
  const b = wall.pts[segEndIdx];
  let nbs = wallPointNeighbors(walls, wall.id, segEndIdx, thr);
  if (!nbs.length) {
    nbs = wallPointNeighborsAt(walls, b, wall.id, thr, segEndIdx).filter((q) => dist(q, a) > 1);
  }
  return bestMiterNeighbor(b, a, nbs);
}

/** Автопомещения из замкнутых перегородок. */
export function syncZonesFromWalls(plan) {
  const wallsForRooms = weldWallNodes(resolveWallPtsList(plan.walls, plan.nodes));
  const loops = filterRoomLoops(findClosedLoops(wallsForRooms), wallsForRooms);
  const prevAuto = (plan.zones || []).filter((z) => z.auto);
  const avgThk = wallsForRooms.length
    ? wallsForRooms.reduce((s, w) => s + (w.thk || 100), 0) / wallsForRooms.length
    : 100;

  let auto = loops.map((poly, i) => {
    const innerPoly = innerRoomPolygonFromLoop(poly, wallsForRooms, plan.room, avgThk * 0.5);
    const b = polygonBounds(innerPoly);
    const cen = polygonCentroid(innerPoly);
    const prev = prevAuto.find((z) => {
      const zc = z.polygon?.length >= 3 ? polygonCentroid(z.polygon) : { x: z.x + z.w / 2, y: z.y + z.h / 2 };
      return dist(cen, zc) < 500;
    });
    return {
      prevId: prev?.id || null,
      ...b,
      name: prev?.name || `Помещение ${i + 1}`,
      height: prev?.height || plan.room?.height || 3000,
      polygon: innerPoly,
      flow: prev?.flow || "neutral",
      purpose: prev?.purpose || "",
      zoneColor: prev?.zoneColor,
      locked: prev?.locked,
      showName: prev?.showName,
      showArea: prev?.showArea,
      showHeight: prev?.showHeight,
      hideFill: prev?.hideFill,
      contoursOnly: prev?.contoursOnly,
      auto: true,
    };
  });

  if (auto.length > 1) {
    const kept = [];
    for (const z of auto) {
      const zc = z.polygon?.length >= 3 ? polygonCentroid(z.polygon) : { x: z.x + z.w / 2, y: z.y + z.h / 2 };
      const za = polygonArea(z.polygon || []);
      const dup = kept.some((k) => {
        const kc = k.polygon?.length >= 3 ? polygonCentroid(k.polygon) : { x: k.x + k.w / 2, y: k.y + k.h / 2 };
        const ka = polygonArea(k.polygon || []);
        return dist(zc, kc) < 1400 && Math.abs(za - ka) / Math.max(ka, 1) < 0.18;
      });
      if (!dup) kept.push(z);
    }
    auto = kept;
  }

  return { auto };
}

export function pointInZone(p, zone) {
  if (zone.polygon?.length >= 3) return pointInPolygon(p, zone.polygon);
  return p.x >= zone.x && p.x <= zone.x + zone.w && p.y >= zone.y && p.y <= zone.y + zone.h;
}

export function itemInAnyZone(item, zones) {
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  return zones.some((z) => pointInZone({ x: cx, y: cy }, z));
}

/** Ближайший сегмент стены к точке. */
export function nearestWallSegment(pt, walls, room, maxDist = 200) {
  const segs = wallSegments(walls.filter((w) => w.role !== "outer"));
  if (room && !planHasDrawnWalls(walls)) {
    segs.push(...roomOuterWallSegments(room));
  }

  let best = null;
  segs.forEach((s) => {
    const proj = projectOnSegment(pt, s.a, s.b);
    const d = dist(pt, proj);
    if (d <= maxDist && (!best || d < best.d)) {
      const angle = Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x) * 180 / Math.PI;
      const horiz = Math.abs(s.b.x - s.a.x) >= Math.abs(s.b.y - s.a.y);
      best = { ...s, proj, d, angle, horiz };
    }
  });
  return best;
}

/** Клик по стене: узел, середина сегмента или вся стена. */
export function wallInteractionAt(wall, mm, zoom = 0.1) {
  if (!wall?.pts?.length) return { kind: "wall" };
  const nodeThr = 320 / Math.max(zoom, 0.05);
  let bestNode = null;
  let bestD = nodeThr;
  wall.pts.forEach((p, i) => {
    const d = dist(mm, p);
    if (d < bestD) {
      bestD = d;
      bestNode = i;
    }
  });
  if (bestNode != null) return { kind: "node", idx: bestNode };

  if (wall.pts.length === 2) {
    const a = wall.pts[0];
    const b = wall.pts[1];
    const proj = projectOnSegment(mm, a, b);
    const hitW = Math.max(wall.thk || 100, 100);
    if (dist(mm, proj) <= hitW) {
      const segLen = dist(a, b) || 1;
      const t = dist(a, proj) / segLen;
      if (t >= 0.12 && t <= 0.88) return { kind: "segment" };
    }
  }
  return { kind: "wall" };
}

function bestMiterNeighbor(a, b, nbs) {
  if (!nbs?.length) return null;
  const seg = segDirUnit(a, b);
  let best = null;
  let bestScore = -1;
  for (const q of nbs) {
    if (dist(q, a) < 1) continue;
    const dir = segDirUnit(a, q);
    const dot = Math.abs(seg.x * dir.x + seg.y * dir.y);
    const score = 1 - dot;
    if (score > bestScore) {
      bestScore = score;
      best = q;
    }
  }
  return best;
}

/** Двери/окна — в толще стены по оси; раковины, розетки и т.п. — на внутренней грани. */
function embedsInWallAxis(item) {
  return isWallOpeningKind(item?.kind);
}

/** Разместить настенный объект на ближайшей стене. */
export function placeOnWall(item, pt, walls, room, maxDist = 350) {
  const seg = nearestWallSegment({ x: pt.x + item.w / 2, y: pt.y + item.h / 2 }, walls, room, maxDist);
  if (!seg) return null;

  const { proj, horiz } = seg;
  const wall = walls.find((w) => w.id === seg.wallId) || { thk: seg.thk || 100, thicknessSide: "center" };
  let x;
  let y;
  let angle = 0;

  if (embedsInWallAxis(item)) {
    if (horiz) {
      y = proj.y - item.h / 2;
      x = clampAlong(proj.x - item.w / 2, item.w, seg.a.x, seg.b.x);
      angle = seg.b.x >= seg.a.x ? 0 : 180;
    } else {
      x = proj.x - item.w / 2;
      y = clampAlong(proj.y - item.h / 2, item.h, seg.a.y, seg.b.y);
      angle = seg.b.y >= seg.a.y ? 90 : 270;
    }
  } else {
    const innerFace = wallFacePoint(proj, seg.a, seg.b, "inner", wall, room);
    const { nx, ny } = inwardNormal(seg.a, seg.b, room);
    const depth = horiz ? item.h : item.w;
    const cx = innerFace.x + nx * (depth / 2);
    const cy = innerFace.y + ny * (depth / 2);
    if (horiz) {
      x = clampAlong(cx - item.w / 2, item.w, seg.a.x, seg.b.x);
      y = cy - item.h / 2;
      angle = seg.b.x >= seg.a.x ? 0 : 180;
    } else {
      x = cx - item.w / 2;
      y = clampAlong(cy - item.h / 2, item.h, seg.a.y, seg.b.y);
      angle = seg.b.y >= seg.a.y ? 90 : 270;
    }
  }

  return {
    x,
    y,
    angle,
    wallSeg: seg,
    wallId: seg.wallId,
    onWall: true,
  };
}

function clampAlong(pos, size, a, b) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return Math.max(lo, Math.min(pos, hi - size));
}

/** Сварить координаты с существующими узлами стен. */
export function snapPointsToWallNodes(walls, points, thr = NODE_LINK_THR) {
  return (points || []).map((p) => {
    for (const w of walls || []) {
      for (const pt of w.pts || []) {
        if (near(p, pt, thr)) return { x: pt.x, y: pt.y };
      }
    }
    return { x: p.x, y: p.y };
  });
}

/** Разорвать стену в точке клика — две стены с общим узлом. */
export function breakWallAt(wall, clickPt) {
  if (!wall?.pts || wall.pts.length < 2) return null;
  let bestI = 1;
  let bestPt = projectOnSegment(clickPt, wall.pts[0], wall.pts[1]);
  let bestD = dist(clickPt, bestPt);
  for (let i = 2; i < wall.pts.length; i++) {
    const proj = projectOnSegment(clickPt, wall.pts[i - 1], wall.pts[i]);
    const d = dist(clickPt, proj);
    if (d < bestD) {
      bestD = d;
      bestI = i;
      bestPt = proj;
    }
  }
  if (bestD > (wall.thk || 100) * 4) return null;
  const splitPt = { x: bestPt.x, y: bestPt.y };
  const pts1 = [...wall.pts.slice(0, bestI), splitPt];
  const pts2 = [splitPt, ...wall.pts.slice(bestI)];
  if (pts1.length < 2 || pts2.length < 2) return null;
  return [
    { ...wall, pts: pts1 },
    { ...wall, pts: pts2, id: null },
  ];
}

/** Сдвинуть узел и потянуть совпадающие узлы соседних стен. */
export function applyWallNodeMove(walls, wallId, nodeIdx, newPt, thr = NODE_LINK_THR) {
  const wall = walls.find((w) => w.id === wallId);
  if (!wall?.pts?.[nodeIdx]) return walls;
  const oldPt = wall.pts[nodeIdx];
  return walls.map((w) => ({
    ...w,
    pts: w.pts.map((p) => (dist(p, oldPt) <= thr ? { x: newPt.x, y: newPt.y } : p)),
  }));
}

/** Обновить позиции дверей/окон на стене после её изменения. */
export function refreshWallMountedItems(items, walls, room, wallId = null) {
  return items.map((it) => {
    const onWall = it.wall || isDoorKind(it.kind) || isWallOpeningKind(it.kind);
    if (!onWall) return it;
    if (wallId && it.wallId !== wallId && it.wallId != null) return it;
    const cx = it.x + it.w / 2;
    const cy = it.y + it.h / 2;
    const placed = placeOnWall(it, { x: cx, y: cy }, walls, room, 400);
    if (!placed) return it;
    return {
      ...it,
      x: placed.x,
      y: placed.y,
      angle: placed.angle ?? it.angle,
      wallId: placed.wallId,
      wallSeg: placed.wallSeg ? { a: placed.wallSeg.a, b: placed.wallSeg.b } : it.wallSeg,
    };
  });
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

function segmentContainsCollinear(inner, outer, eps = 12) {
  if (!sameLine(inner.a, inner.b, outer.a, outer.b, eps)) return false;
  const horiz = Math.abs(outer.b.x - outer.a.x) >= Math.abs(outer.b.y - outer.a.y);
  const i0 = horiz ? inner.a.x : inner.a.y;
  const i1 = horiz ? inner.b.x : inner.b.y;
  const o0 = horiz ? outer.a.x : outer.a.y;
  const o1 = horiz ? outer.b.x : outer.b.y;
  const ilo = Math.min(i0, i1);
  const ihi = Math.max(i0, i1);
  const olo = Math.min(o0, o1);
  const ohi = Math.max(o0, o1);
  return ilo >= olo - eps && ihi <= ohi + eps;
}

/** Наложение коллинеарных сегментов разных стен. */
export function findWallOverlaps(walls) {
  const segs = wallSegments(walls);
  const hits = [];
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s1 = segs[i];
      const s2 = segs[j];
      if (s1.wallId === s2.wallId) continue;
      if (segmentsMeetAtJunction(s1, s2)) continue;
      if (!sameLine(s1.a, s1.b, s2.a, s2.b)) continue;
      if (segmentContainsCollinear(s1, s2) || segmentContainsCollinear(s2, s1)) continue;
      const horiz = Math.abs(s1.b.x - s1.a.x) >= Math.abs(s1.b.y - s1.a.y);
      const ok = horiz
        ? overlap1D(s1.a.x, s1.b.x, s2.a.x, s2.b.x)
        : overlap1D(s1.a.y, s1.b.y, s2.a.y, s2.b.y);
      if (ok) hits.push({ id: `wo-${s1.wallId}-${s2.wallId}`, wallIds: [s1.wallId, s2.wallId] });
    }
  }
  return hits;
}

function segHitsRect(a, b, rx, ry, rw, rh) {
  const edges = [
    [{ x: rx, y: ry }, { x: rx + rw, y: ry }],
    [{ x: rx + rw, y: ry }, { x: rx + rw, y: ry + rh }],
    [{ x: rx + rw, y: ry + rh }, { x: rx, y: ry + rh }],
    [{ x: rx, y: ry + rh }, { x: rx, y: ry }],
  ];
  return edges.some(([e1, e2]) => segmentsIntersectProper(a, b, e1, e2));
}

/** Стена проходит поверх напольной мебели/оборудования. */
export function findWallsOverItems(walls, items) {
  const hits = [];
  (walls || []).forEach((w) => {
    if (!w.pts || w.pts.length < 2) return;
    for (let i = 1; i < w.pts.length; i++) {
      const a = w.pts[i - 1];
      const b = w.pts[i];
      items.forEach((it) => {
        if (it.wall || isDoorKind(it.kind) || isWallOpeningKind(it.kind)) return;
        if (it.layer === "room") return;
        if (segHitsRect(a, b, it.x, it.y, it.w, it.h)) {
          hits.push({ id: `wov-${w.id}-${it.id}`, wallIds: [w.id], objectIds: [it.id] });
        }
      });
    }
  });
  return hits;
}

/** Сварить близкие узлы стен в одну точку. */
export function weldWallNodes(walls, thr = NODE_LINK_THR) {
  if (!walls?.length) return walls;
  const clusters = [];

  const clusterFor = (p) => {
    let c = clusters.find((cl) => dist(cl.center, p) <= thr);
    if (!c) {
      c = { center: { x: p.x, y: p.y }, n: 1 };
      clusters.push(c);
    } else {
      c.center = {
        x: (c.center.x * c.n + p.x) / (c.n + 1),
        y: (c.center.y * c.n + p.y) / (c.n + 1),
      };
      c.n += 1;
    }
    return c.center;
  };

  walls.forEach((w) => (w.pts || []).forEach((p) => clusterFor(p)));

  return walls.map((w) => ({
    ...w,
    pts: (w.pts || []).map((p) => {
      const c = clusters.find((cl) => dist(cl.center, p) <= thr);
      return c ? { x: c.center.x, y: c.center.y } : { ...p };
    }),
  }));
}

/** Объединить стену с соседней по общему узлу. */
export function tryMergeWall(walls, wallId) {
  const w = walls.find((x) => x.id === wallId);
  if (!w || w.pts.length < 2) return null;

  for (const other of walls) {
    if (other.id === wallId) continue;
    const tries = [
      { a: w.pts[w.pts.length - 1], b: other.pts[0], pts: [...w.pts, ...other.pts.slice(1)] },
      { a: w.pts[w.pts.length - 1], b: other.pts[other.pts.length - 1], pts: [...w.pts, ...[...other.pts].reverse().slice(1)] },
      { a: w.pts[0], b: other.pts[other.pts.length - 1], pts: [...other.pts, ...w.pts.slice(1)] },
      { a: w.pts[0], b: other.pts[0], pts: [...[...other.pts].reverse(), ...w.pts.slice(1)] },
    ];
    for (const t of tries) {
      if (near(t.a, t.b, NODE_LINK_THR)) {
        return {
          walls: walls
            .filter((x) => x.id !== other.id)
            .map((x) => (x.id === wallId ? { ...w, pts: t.pts } : x)),
          mergedId: wallId,
        };
      }
    }
  }
  return null;
}

/** Выровнять сегмент стены строго по горизонтали или вертикали. */
export function straightenWall(wall, mode = "h") {
  if (!wall?.pts || wall.pts.length < 2) return wall;
  const pts = wall.pts.map((p) => ({ ...p }));
  const a = pts[pts.length - 2];
  const b = pts[pts.length - 1];
  if (mode === "h") pts[pts.length - 1] = { x: b.x, y: a.y };
  else pts[pts.length - 1] = { x: a.x, y: b.y };
  return { ...wall, pts };
}

/** Задать точную длину последнего сегмента стены. */
export function setWallSegmentLength(wall, lenMm) {
  if (!wall?.pts || wall.pts.length < 2 || lenMm < 100) return wall;
  return setWallSegmentLengthAt(wall, wall.pts.length - 2, lenMm);
}

/** Задать точную длину сегмента wall.pts[i] → wall.pts[i+1]. */
export function setWallSegmentLengthAt(wall, segIndex, lenMm) {
  if (!wall?.pts || wall.pts.length < 2 || lenMm < 100) return wall;
  if (segIndex < 0 || segIndex >= wall.pts.length - 1) return wall;
  const pts = wall.pts.map((p) => ({ ...p }));
  const a = pts[segIndex];
  const b = pts[segIndex + 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d < 1) return wall;
  pts[segIndex + 1] = { x: a.x + (dx / d) * lenMm, y: a.y + (dy / d) * lenMm };
  return { ...wall, pts };
}

/** Длина сегмента стены по индексу узла (сегмент до или после узла). */
export function wallSegmentLengthAt(wall, nodeIdx) {
  if (!wall?.pts || wall.pts.length < 2 || nodeIdx == null) return 0;
  const seg = nodeIdx > 0 ? nodeIdx - 1 : 0;
  if (seg >= wall.pts.length - 1) return 0;
  const a = wall.pts[seg];
  const b = wall.pts[seg + 1];
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Индекс сегмента для редактирования длины по выбранному узлу. */
export function wallSegmentIndexForNode(wall, nodeIdx) {
  if (!wall?.pts || wall.pts.length < 2 || nodeIdx == null) return Math.max(0, (wall?.pts?.length || 2) - 2);
  if (nodeIdx <= 0) return 0;
  if (nodeIdx >= wall.pts.length - 1) return wall.pts.length - 2;
  return nodeIdx - 1;
}

/** Выровнять стену параллельно соседней по общему узлу. */
export function alignWallToNeighbor(walls, wallId) {
  const w = walls.find((x) => x.id === wallId);
  if (!w || w.pts.length < 2) return null;

  for (const other of walls) {
    if (other.id === wallId || other.pts.length < 2) continue;
    for (const pt of [w.pts[0], w.pts[w.pts.length - 1]]) {
      for (let i = 1; i < other.pts.length; i++) {
        const oa = other.pts[i - 1];
        const ob = other.pts[i];
        if (!near(pt, oa, NODE_LINK_THR) && !near(pt, ob, NODE_LINK_THR)) continue;
        const odx = ob.x - oa.x;
        const ody = ob.y - oa.y;
        const len = Math.hypot(odx, ody);
        if (len < 1) continue;
        const endIdx = near(pt, w.pts[0], NODE_LINK_THR) ? 1 : w.pts.length - 1;
        const startIdx = endIdx === 1 ? 0 : w.pts.length - 2;
        const segLen = dist(w.pts[startIdx], w.pts[endIdx]);
        const pts = w.pts.map((p) => ({ ...p }));
        pts[endIdx] = {
          x: pts[startIdx].x + (odx / len) * segLen,
          y: pts[startIdx].y + (ody / len) * segLen,
        };
        return walls.map((x) => (x.id === wallId ? { ...w, pts } : x));
      }
    }
  }
  return null;
}

/** Ближайший узел графа или конец стены в радиусе магнита (~12 px). */
export function nearestNode(pt, nodes = {}, walls = [], zoom = 1, snapPx = 12) {
  const thr = snapPx / Math.max(zoom, 0.05);
  let best = null;
  const tryPt = (target, kind = "node", id = null) => {
    const d = dist(pt, target);
    if (d <= thr && (!best || d < best.d)) best = { x: target.x, y: target.y, d, kind, id };
  };
  Object.entries(nodes || {}).forEach(([id, n]) => tryPt(n, "node", id));
  (walls || []).forEach((w) => {
    (w.pts || []).forEach((p, i) => tryPt(p, "wall-end", `${w.id}-${i}`));
    if (w.pts?.length >= 2) {
      for (let i = 1; i < w.pts.length; i++) {
        const proj = projectOnSegment(pt, w.pts[i - 1], w.pts[i]);
        tryPt(proj, "wall-seg", w.id);
      }
    }
  });
  return best;
}

function isHorizontalSeg(a, b, tol = 0.05) {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return Math.abs((b.y - a.y) / len) <= tol;
}

function isVerticalSeg(a, b, tol = 0.05) {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return Math.abs((b.x - a.x) / len) <= tol;
}

/** Зелёные направляющие: горизонталь/вертикаль, продолжения осей стен, узлы. */
export function alignmentGuides(nodes = {}, walls = [], point, room = null, from = null) {
  const guides = [];
  const pad = 50000;
  const seen = new Set();
  const addH = (y, x0, x1, source) => {
    const key = `H_${Math.round(y)}_${source}`;
    if (seen.has(key)) return;
    seen.add(key);
    guides.push({ type: "H", at: y, x0, x1, source });
  };
  const addV = (x, y0, y1, source) => {
    const key = `V_${Math.round(x)}_${source}`;
    if (seen.has(key)) return;
    seen.add(key);
    guides.push({ type: "V", at: x, y0, y1, source });
  };

  if (from) {
    addH(from.y, from.x - pad, from.x + pad, "from");
    addV(from.x, from.y - pad, from.y + pad, "from");
  }

  wallSegments(walls).forEach((s) => {
    if (isHorizontalSeg(s.a, s.b)) {
      addH(s.a.y, Math.min(s.a.x, s.b.x) - pad, Math.max(s.a.x, s.b.x) + pad, "wall");
    } else if (isVerticalSeg(s.a, s.b)) {
      addV(s.a.x, Math.min(s.a.y, s.b.y) - pad, Math.max(s.a.y, s.b.y) + pad, "wall");
    }
  });

  Object.values(nodes || {}).forEach((n) => {
    addH(n.y, n.x - pad, n.x + pad, "node");
    addV(n.x, n.y - pad, n.y + pad, "node");
  });

  if (room?.w && room?.h) {
    addH(room.h / 2, 0, room.w, "room-center");
    addV(room.w / 2, 0, room.h, "room-center");
  }

  if (point && from && snapOnAxis(from, point)) {
    if (Math.abs(from.y - point.y) < Math.abs(from.x - point.x)) {
      addH(from.y, Math.min(from.x, point.x), Math.max(from.x, point.x), "align");
    } else {
      addV(from.x, Math.min(from.y, point.y), Math.max(from.y, point.y), "align");
    }
  }

  return guides;
}

function snapOnAxis(from, pt, tol = 80) {
  return Math.abs(from.x - pt.x) <= tol || Math.abs(from.y - pt.y) <= tol;
}

/** Углы между смежными стенами в узле (градусы). */
export function angleAt(nodePt, walls = [], thr = NODE_LINK_THR) {
  const dirs = [];
  wallSegments(walls).forEach((s) => {
    if (near(s.a, nodePt, thr)) {
      dirs.push(normalizeAngleDeg(Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x) * 180 / Math.PI));
    }
    if (near(s.b, nodePt, thr)) {
      dirs.push(normalizeAngleDeg(Math.atan2(s.a.y - s.b.y, s.a.x - s.b.x) * 180 / Math.PI));
    }
  });
  const uniq = [...new Set(dirs.map((d) => Math.round(d)))];
  const angles = [];
  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) {
      let diff = Math.abs(uniq[i] - uniq[j]);
      if (diff > 180) diff = 360 - diff;
      angles.push(Math.round(diff * 10) / 10);
    }
  }
  return angles.sort((a, b) => a - b);
}

/** Площадь формируемого контура при черчении цепочки (м²). */
export function draftChainArea(chainPts, cursor = null) {
  if (!chainPts?.length) return null;
  const pts = cursor ? [...chainPts, cursor] : chainPts;
  if (pts.length < 3) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (Math.hypot(first.x - last.x, first.y - last.y) > 200) return null;
  const poly = pts.slice(0, -1).length >= 3 ? pts.slice(0, -1) : pts;
  if (poly.length < 3) return null;
  const area = polygonArea(poly);
  return area >= MIN_ROOM_AREA_MM2 ? area / 1e6 : null;
}

