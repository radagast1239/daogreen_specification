/**
 * Прилипание концов линейки: контур материала → узлы/грани стен → сетка.
 */
import { snap } from "./catalog.js";
import { isDoorKind, isOpeningKind } from "./doorTypes.js";
import { collectWallNodes, dist, planHasDrawnWalls, snapWallPoint, wallSegments } from "./wallGeometry.js";

const SNAP_PX = 12;

export function snapDistanceMm(zoom, px = SNAP_PX) {
  return px / Math.max(zoom, 0.05);
}

function pointInRect(p, it) {
  return p.x >= it.x && p.x <= it.x + it.w && p.y >= it.y && p.y <= it.y + it.h;
}

function rotatePoint(p, cx, cy, deg) {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - cx;
  const dy = p.y - cy;
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

function unrotatePoint(p, cx, cy, deg) {
  return rotatePoint(p, cx, cy, -deg);
}

function snapRectContour(p, it) {
  const cx = it.x + it.w / 2;
  const cy = it.y + it.h / 2;
  const ang = it.angle || 0;
  const local = unrotatePoint(p, cx, cy, ang);
  const lx = local.x - it.x;
  const ly = local.y - it.y;

  const onX = lx >= -1 && lx <= it.w + 1;
  const onY = ly >= -1 && ly <= it.h + 1;
  if (!onX || !onY) {
    if (pointInRect(local, it)) {
      const dL = lx;
      const dR = it.w - lx;
      const dT = ly;
      const dB = it.h - ly;
      const min = Math.min(dL, dR, dT, dB);
      let snapLocal;
      if (min === dL) snapLocal = { x: it.x, y: local.y };
      else if (min === dR) snapLocal = { x: it.x + it.w, y: local.y };
      else if (min === dT) snapLocal = { x: local.x, y: it.y };
      else snapLocal = { x: local.x, y: it.y + it.h };
      return rotatePoint(snapLocal, cx, cy, ang);
    }
    return null;
  }

  const dL = lx;
  const dR = it.w - lx;
  const dT = ly;
  const dB = it.h - ly;
  const min = Math.min(dL, dR, dT, dB);
  let snapLocal;
  if (min === dL) snapLocal = { x: it.x, y: Math.max(it.y, Math.min(it.y + it.h, local.y)) };
  else if (min === dR) snapLocal = { x: it.x + it.w, y: Math.max(it.y, Math.min(it.y + it.h, local.y)) };
  else if (min === dT) snapLocal = { x: Math.max(it.x, Math.min(it.x + it.w, local.x)), y: it.y };
  else snapLocal = { x: Math.max(it.x, Math.min(it.x + it.w, local.x)), y: it.y + it.h };

  const corners = [
    { x: it.x, y: it.y },
    { x: it.x + it.w, y: it.y },
    { x: it.x + it.w, y: it.y + it.h },
    { x: it.x, y: it.y + it.h },
  ].map((c) => rotatePoint(c, cx, cy, ang));

  let best = rotatePoint(snapLocal, cx, cy, ang);
  let bestD = dist(p, best);
  corners.forEach((c) => {
    const d = dist(p, c);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  });
  return best;
}

function snapRoundContour(p, it) {
  const cx = it.x + it.w / 2;
  const cy = it.y + it.h / 2;
  const r = Math.min(it.w, it.h) / 2;
  const dx = p.x - cx;
  const dy = p.y - cy;
  const d = Math.hypot(dx, dy) || 1;
  return { x: cx + (dx / d) * r, y: cy + (dy / d) * r };
}

function isRoundItem(it) {
  return it.shape === "round" || it.kind === "tank_round" || (it.w > 0 && Math.abs(it.w - it.h) < 2 && it.kind?.includes("round"));
}

function snapItemContour(p, items, thr) {
  let best = null;
  (items || []).forEach((it) => {
    if (isDoorKind(it.kind) || isOpeningKind(it.kind)) return;
    const cx = it.x + it.w / 2;
    const cy = it.y + it.h / 2;
    const ang = it.angle || 0;
    const local = unrotatePoint(p, cx, cy, ang);
    const inside = local.x >= it.x && local.x <= it.x + it.w && local.y >= it.y && local.y <= it.h + it.h * 0.01;
    const nearBox = local.x >= it.x - thr && local.x <= it.x + it.w + thr
      && local.y >= it.y - thr && local.y <= it.y + it.h + thr;
    if (!inside && !nearBox) return;

    const target = isRoundItem(it) ? snapRoundContour(p, it) : snapRectContour(p, it);
    if (!target) return;
    const d = dist(p, target);
    if (d <= thr && (!best || d < best.d)) {
      best = { x: target.x, y: target.y, d, kind: "contour", itemId: it.id };
    }
  });
  return best;
}

function snapWallNodesAndEdges(p, walls, room, thr) {
  let best = null;
  const tryPt = (target, kind) => {
    const d = dist(p, target);
    if (d <= thr && (!best || d < best.d)) best = { x: target.x, y: target.y, d, kind };
  };

  collectWallNodes(walls, room).forEach((n) => tryPt(n, "node"));
  wallSegments(walls).forEach((seg) => {
    const dx = seg.b.x - seg.a.x;
    const dy = seg.b.y - seg.a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1) return;
    const t = Math.max(0, Math.min(1, ((p.x - seg.a.x) * dx + (p.y - seg.a.y) * dy) / len2));
    tryPt({ x: seg.a.x + dx * t, y: seg.a.y + dy * t }, "wall");
  });
  return best;
}

/**
 * Приоритет: контур материала → узлы/грани стен → сетка.
 */
export function snapRulerPoint(p, {
  items = [],
  walls = [],
  room = null,
  zoom = 0.1,
  snapOn = true,
  altOff = false,
  gridSnap = true,
  snapStep = 50,
} = {}) {
  if (altOff || !snapOn) {
    return { x: p.x, y: p.y, snapped: false };
  }

  const thr = snapDistanceMm(zoom);
  const contour = snapItemContour(p, items, thr);
  if (contour) {
    return { x: contour.x, y: contour.y, snapped: true, kind: contour.kind, itemId: contour.itemId };
  }

  const wallSnap = snapWallNodesAndEdges(p, walls, room, thr);
  if (wallSnap) {
    return { x: wallSnap.x, y: wallSnap.y, snapped: true, kind: wallSnap.kind };
  }

  if (planHasDrawnWalls(walls)) {
    const s = snapWallPoint(p, walls, room, zoom, true, snapStep);
    if (s.snapped) return { ...s, snapped: true };
  }

  if (gridSnap) {
    return { x: snap(p.x, snapStep, true), y: snap(p.y, snapStep, true), snapped: true, kind: "grid" };
  }

  return { x: p.x, y: p.y, snapped: false };
}

/** @deprecated alias */
export const snapToContour = snapRulerPoint;
