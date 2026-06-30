/**
 * Привязка объектов к сетке, стенам, краям и центрам соседей.
 */

import { planHasDrawnWalls, wallSegments } from "./wallGeometry.js";
import { isRackKind } from "./rackProperties.js";

const SNAP_STICKY_RELEASE = 1.65;

export function snapDistanceMm(zoom, snapDistancePx = 10) {
  return snapDistancePx / Math.max(zoom, 0.05);
}

function collectSnapLines({
  items,
  walls,
  room,
  obj,
  snapObjects,
  snapWalls,
  innerBounds,
}) {
  const V = [];
  const H = [];

  if (innerBounds) {
    V.push(innerBounds.l, innerBounds.r);
    H.push(innerBounds.t, innerBounds.b);
  }

  if (room && snapWalls && !planHasDrawnWalls(walls)) {
    const t = room.wallThk / 2;
    V.push(t, room.w - t);
    H.push(t, room.h - t);
  }

  if (snapWalls && planHasDrawnWalls(walls)) {
    wallSegments(walls).forEach((seg) => {
      const half = (seg.thk || 100) / 2;
      const a = seg.a;
      const b = seg.b;
      if (Math.abs(b.x - a.x) < 2) {
        V.push(a.x - half, a.x + half);
      } else if (Math.abs(b.y - a.y) < 2) {
        H.push(a.y - half, a.y + half);
      } else {
        V.push(a.x, b.x);
        H.push(a.y, b.y);
      }
    });
  } else if (snapWalls) {
    walls.forEach((w) => {
      if (!w.pts?.length) return;
      w.pts.forEach((p) => {
        V.push(p.x);
        H.push(p.y);
      });
      for (let i = 1; i < w.pts.length; i++) {
        const a = w.pts[i - 1];
        const b = w.pts[i];
        if (Math.abs(b.x - a.x) < 1) V.push(b.x);
        if (Math.abs(b.y - a.y) < 1) H.push(b.y);
        V.push((a.x + b.x) / 2);
        H.push((a.y + b.y) / 2);
      }
    });
  }

  if (snapObjects) {
    items.forEach((it) => {
      if (it.id === obj.id) return;
      // Стеллажи выравниваются отдельно (snapRackNeighbor), иначе центры/края конфликтуют.
      if (isRackKind(obj.kind) && isRackKind(it.kind)) return;
      V.push(it.x, it.x + it.w / 2, it.x + it.w);
      H.push(it.y, it.y + it.h / 2, it.y + it.h);
    });
  }

  return { V, H };
}

function bestSnap(lines, edges, thr) {
  let best = null;
  edges.forEach((e) => {
    lines.forEach((L) => {
      const d = Math.abs(e.val - L);
      if (d < thr && (!best || d < best.d)) {
        best = { d, off: L - e.val, at: L, edge: e.edge };
      }
    });
  });
  return best;
}

export function snapObjectPosition({
  obj,
  x,
  y,
  items = [],
  walls = [],
  room = null,
  zoom = 0.1,
  snapOn = true,
  snapGrid = true,
  snapObjects = true,
  snapWalls = true,
  snapGuides = true,
  snapDistancePx = 10,
  innerBounds = null,
  gridSnap = (v) => v,
  sticky = null,
}) {
  if (!snapOn) {
    return { x: gridSnap(x), y: gridSnap(y), guides: [] };
  }

  const thr = snapDistanceMm(zoom, snapDistancePx);
  const releaseThr = thr * SNAP_STICKY_RELEASE;
  if (sticky?.atX != null && Math.abs(x - sticky.atX) <= releaseThr) {
    x = sticky.x;
  }
  if (sticky?.atY != null && Math.abs(y - sticky.atY) <= releaseThr) {
    y = sticky.y;
  }
  const { V, H } = collectSnapLines({
    items,
    walls,
    room,
    obj,
    snapObjects,
    snapWalls,
    innerBounds,
  });

  const guides = [];
  const vb = bestSnap(V, [
    { val: x, edge: "left" },
    { val: x + obj.w / 2, edge: "centerX" },
    { val: x + obj.w, edge: "right" },
  ], thr);
  const hb = bestSnap(H, [
    { val: y, edge: "top" },
    { val: y + obj.h / 2, edge: "centerY" },
    { val: y + obj.h, edge: "bottom" },
  ], thr);

  let nx = x;
  let ny = y;

  if (vb) {
    nx = x + vb.off;
    if (sticky) {
      sticky.x = nx;
      sticky.atX = x;
    }
    if (snapGuides) {
      guides.push({
        type: "V",
        at: vb.at,
        y0: Math.max(0, y - 120),
        y1: Math.min(room?.h ?? y + obj.h + 240, y + obj.h + 120),
      });
    }
  } else if (snapGrid) {
    nx = gridSnap(x);
    if (sticky) {
      sticky.x = null;
      sticky.atX = null;
    }
  }

  if (hb) {
    ny = y + hb.off;
    if (sticky) {
      sticky.y = ny;
      sticky.atY = y;
    }
    if (snapGuides) {
      guides.push({
        type: "H",
        at: hb.at,
        x0: Math.max(0, x - 120),
        x1: Math.min(room?.w ?? x + obj.w + 240, x + obj.w + 120),
      });
    }
  } else if (snapGrid) {
    ny = gridSnap(y);
    if (sticky) {
      sticky.y = null;
      sticky.atY = null;
    }
  }

  return { x: nx, y: ny, guides };
}

/** Shift: движение только по доминирующей оси от начала drag. */
export function constrainAxisDelta(dx, dy, shiftHeld) {
  if (!shiftHeld) return { dx, dy };
  if (Math.abs(dx) >= Math.abs(dy)) return { dx, dy: 0 };
  return { dx: 0, dy };
}

/** Shift: фиксация точки на одной оси относительно origin. */
export function constrainAxisPoint(origin, point, shiftHeld) {
  if (!shiftHeld || !origin) return point;
  const dx = Math.abs(point.x - origin.x);
  const dy = Math.abs(point.y - origin.y);
  if (dx >= dy) return { x: point.x, y: origin.y };
  return { x: origin.x, y: point.y };
}
