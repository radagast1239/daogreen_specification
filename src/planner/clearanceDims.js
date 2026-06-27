import { isDoorKind, isOpeningKind } from "./doorTypes.js";
import { segmentParam, lerpPt } from "./doorGeometry.js";
import { wallSegments, dist, nearestWallSegment } from "./wallGeometry.js";

const MIN_CLEAR = 40;
const MAX_RAY = 200000;

export function isWallMountedItem(it) {
  return !!it?.wall || isDoorKind(it?.kind) || isOpeningKind(it?.kind);
}

export function collectPlanWallSegments(plan) {
  const segs = wallSegments(plan.walls || []);
  const room = plan.room;
  if (room) {
    const t = room.wallThk / 2;
    segs.push(
      { a: { x: t, y: t }, b: { x: room.w - t, y: t }, wallId: "outer" },
      { a: { x: room.w - t, y: t }, b: { x: room.w - t, y: room.h - t }, wallId: "outer" },
      { a: { x: room.w - t, y: room.h - t }, b: { x: t, y: room.h - t }, wallId: "outer" },
      { a: { x: t, y: room.h - t }, b: { x: t, y: t }, wallId: "outer" },
    );
  }
  return segs;
}

/** Пересечение луча ro + t·rd (t > 0) с отрезком ab. */
function raySegmentHit(ro, rd, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const denom = rd.x * dy - rd.y * dx;
  if (Math.abs(denom) < 1e-9) return null;
  const t = ((a.x - ro.x) * dy - (a.y - ro.y) * dx) / denom;
  const u = ((a.x - ro.x) * rd.y - (a.y - ro.y) * rd.x) / denom;
  if (t > 2 && u >= -0.001 && u <= 1.001) return t;
  return null;
}

/** Расстояние по лучу до AABB (центр объекта). */
function rayRectHit(ro, rd, rect) {
  const invX = rd.x !== 0 ? 1 / rd.x : Infinity;
  const invY = rd.y !== 0 ? 1 / rd.y : Infinity;
  let t1 = (rect.x - ro.x) * invX;
  let t2 = (rect.x + rect.w - ro.x) * invX;
  let t3 = (rect.y - ro.y) * invY;
  let t4 = (rect.y + rect.h - ro.y) * invY;
  const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4));
  const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4));
  if (tmax < 0 || tmin > tmax) return null;
  const hit = tmin > 2 ? tmin : (tmax > 2 ? tmax : null);
  return hit != null && hit < MAX_RAY ? hit : null;
}

function itemCorners(it) {
  const cx = it.x + it.w / 2;
  const cy = it.y + it.h / 2;
  const pts = [
    { x: it.x, y: it.y },
    { x: it.x + it.w, y: it.y },
    { x: it.x + it.w, y: it.y + it.h },
    { x: it.x, y: it.y + it.h },
  ];
  const ang = it.angle || 0;
  if (!ang) return pts;
  const rad = (ang * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return pts.map((p) => ({
    x: cx + (p.x - cx) * cos - (p.y - cy) * sin,
    y: cy + (p.x - cx) * sin + (p.y - cy) * cos,
  }));
}

function itemAABB(it) {
  const c = itemCorners(it);
  const xs = c.map((p) => p.x);
  const ys = c.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

function axisProbes(it) {
  const c = itemCorners(it);
  const minX = Math.min(...c.map((p) => p.x));
  const maxX = Math.max(...c.map((p) => p.x));
  const minY = Math.min(...c.map((p) => p.y));
  const maxY = Math.max(...c.map((p) => p.y));
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  return [
    { a: { x: minX, y: midY }, rd: { x: -1, y: 0 } },
    { a: { x: maxX, y: midY }, rd: { x: 1, y: 0 } },
    { a: { x: midX, y: minY }, rd: { x: 0, y: -1 } },
    { a: { x: midX, y: maxY }, rd: { x: 0, y: 1 } },
  ];
}

/** Проекция ширины проёма (локальная ось w) на сегмент стены. */
function spanOnSegment(it, a, b) {
  const cx = it.x + it.w / 2;
  const cy = it.y + it.h / 2;
  const rad = ((it.angle || 0) * Math.PI) / 180;
  const hw = it.w / 2;
  const p1 = { x: cx - Math.cos(rad) * hw, y: cy - Math.sin(rad) * hw };
  const p2 = { x: cx + Math.cos(rad) * hw, y: cy + Math.sin(rad) * hw };
  const t0 = segmentParam(p1, a, b);
  const t1 = segmentParam(p2, a, b);
  return { tLeft: Math.min(t0, t1), tRight: Math.max(t0, t1) };
}

function offsetForDir(dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) return dy >= 0 ? -1 : 1;
  return dx >= 0 ? -1 : 1;
}

/** Расстояния от объекта до стен/препятствий по 4 сторонам. */
export function computeFloorClearances(it, plan) {
  if (it.angle && it.angle % 90 !== 0) return [];
  const segs = collectPlanWallSegments(plan);
  const items = plan.items || [];
  const probes = axisProbes(it);

  return probes.map(({ a, rd }) => {
    let best = MAX_RAY;
    segs.forEach((s) => {
      const t = raySegmentHit(a, rd, s.a, s.b);
      if (t != null && t < best) best = t;
    });
    items.forEach((other) => {
      if (other.id === it.id || isWallMountedItem(other) || other.layer === "room") return;
      const t = rayRectHit(a, rd, itemAABB(other));
      if (t != null && t < best) best = t;
    });
    if (best >= MAX_RAY || best < MIN_CLEAR) return null;
    const b = { x: a.x + rd.x * best, y: a.y + rd.y * best };
    return { a, b, dist: best, offsetSide: offsetForDir(rd.x, rd.y) };
  }).filter(Boolean);
}

function wallSegmentForItem(it, plan) {
  if (it.wallSeg?.a && it.wallSeg?.b) {
    return { a: it.wallSeg.a, b: it.wallSeg.b, wallId: it.wallId };
  }
  const cx = it.x + it.w/2;
  const cy = it.y + it.h/2;
  const hit = nearestWallSegment({ x: cx, y: cy }, plan.walls || [], plan.room, 250);
  if (!hit) return null;
  return { a: hit.a, b: hit.b, wallId: hit.wallId };
}

/** Расстояния вдоль стены до угла / соседнего проёма (двери, окна). */
export function computeWallMountedClearances(it, plan) {
  const seg = wallSegmentForItem(it, plan);
  if (!seg) return [];
  const { a, b } = seg;
  const len = dist(a, b);
  if (len < 1) return [];

  const { tLeft, tRight } = spanOnSegment(it, a, b);

  let boundL = 0;
  let boundR = 1;

  (plan.items || []).forEach((other) => {
    if (other.id === it.id || !isWallMountedItem(other)) return;
    const oc = { x: other.x + other.w / 2, y: other.y + other.h / 2 };
    const ot = segmentParam(oc, a, b);
    if (ot < -0.12 || ot > 1.12) return;
    const proj = lerpPt(a, b, ot);
    if (dist(oc, proj) > other.h / 2 + 100) return;
    const { tLeft: ol, tRight: or } = spanOnSegment(other, a, b);
    if (or <= tLeft + 0.002) boundL = Math.max(boundL, or);
    if (ol >= tRight - 0.002) boundR = Math.min(boundR, ol);
  });

  const side = wallSegmentOffsetSide(a, b, plan.room);
  const out = [];
  const leftDist = (tLeft - boundL) * len;
  const rightDist = (boundR - tRight) * len;
  if (leftDist >= MIN_CLEAR) {
    out.push({
      a: lerpPt(a, b, boundL),
      b: lerpPt(a, b, tLeft),
      dist: leftDist,
      offsetSide: side,
    });
  }
  if (rightDist >= MIN_CLEAR) {
    out.push({
      a: lerpPt(a, b, tRight),
      b: lerpPt(a, b, boundR),
      dist: rightDist,
      offsetSide: side,
    });
  }
  return out;
}

function wallSegmentOffsetSide(a, b, room) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const ln = Math.hypot(dx, dy) || 1;
  const nx = -dy / ln;
  const ny = dx / ln;
  const rcx = room?.w ? room.w / 2 : mx;
  const rcy = room?.h ? room.h / 2 : my;
  const dot = (rcx - mx) * nx + (rcy - my) * ny;
  return dot > 0 ? 1 : -1;
}

export function computeClearances(it, plan) {
  if (isWallMountedItem(it)) return computeWallMountedClearances(it, plan);
  return computeFloorClearances(it, plan);
}
