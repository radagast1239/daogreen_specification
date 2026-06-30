/**
 * Расширенные привязки планировщика (этап 6).
 */
import { snap } from "./catalog.js";
import { snapWallPoint, nearestWallSegment } from "./wallGeometry.js";
import { nearestItemAttach } from "./lineProperties.js";
import { isRackKind } from "./rackProperties.js";

const LINE_ATTACH_DIST = 240;
const TRASS_SNAP_DIST = 180;
const RACK_SNAP_RELEASE_MUL = 1.55;

function rackRect(it, x, y) {
  return { x, y, w: it.w, h: it.h };
}

function rectsOverlap(a, b, gap = 2) {
  return !(
    a.x + a.w + gap <= b.x ||
    b.x + b.w + gap <= a.x ||
    a.y + a.h + gap <= b.y ||
    b.y + b.h + gap <= a.y
  );
}

function rackOverlapsOthers(it, x, y, items, excludeId, ignoreIds = []) {
  const ignore = new Set([excludeId, ...ignoreIds].filter(Boolean));
  const r = rackRect(it, x, y);
  return items.some((o) => {
    if (ignore.has(o.id)) return false;
    if (!isRackKind(o.kind)) return false;
    return rectsOverlap(r, rackRect(o, o.x, o.y));
  });
}

function rackGuideSpan(axis, at, it, other, x, y) {
  if (axis === "x") {
    return {
      type: "V",
      at,
      y0: Math.min(y, other.y, it.y) - 40,
      y1: Math.max(y + it.h, other.y + other.h, it.y + it.h) + 40,
    };
  }
  return {
    type: "H",
    at,
    x0: Math.min(x, other.x, it.x) - 40,
    x1: Math.max(x + it.w, other.x + other.w, it.x + it.w) + 40,
  };
}

function considerRackSnap(bucket, axis, val, d, priority, it, other, x, y) {
  if (!bucket || priority < bucket.priority || (priority === bucket.priority && d < bucket.d)) {
    return {
      val,
      d,
      priority,
      guide: rackGuideSpan(axis, val, it, other, x, y),
      partnerId: other?.id || null,
    };
  }
  return bucket;
}

function resolveRackAxis(axis, raw, best, thr, sticky) {
  const stickyKey = axis === "x" ? "x" : "y";
  const stickyAtKey = axis === "x" ? "atX" : "atY";
  const releaseThr = thr * RACK_SNAP_RELEASE_MUL;

  if (best && best.d <= thr) {
    if (sticky) {
      sticky[stickyKey] = best.val;
      sticky[stickyAtKey] = best.val;
    }
    return { val: best.val, snapped: true, guide: best.guide };
  }

  if (sticky?.[stickyAtKey] != null) {
    if (Math.abs(raw - sticky[stickyAtKey]) <= releaseThr) {
      return { val: sticky[stickyKey], snapped: true, guide: null };
    }
    sticky[stickyKey] = null;
    sticky[stickyAtKey] = null;
  }

  return { val: raw, snapped: false, guide: null };
}

export function snapLineDraftPoint(pt, {
  items = [],
  walls = [],
  room = null,
  lines = [],
  zoom = 0.1,
  snapOn = true,
  snapGrid = true,
  snapWalls = true,
  snapObjects = true,
  snapStep = 50,
}) {
  if (!snapOn) return { x: pt.x, y: pt.y, snapped: false };

  const thr = LINE_ATTACH_DIST / Math.max(zoom, 0.05);
  let best = null;
  const tryBest = (candidate, kind, meta = {}) => {
    const d = Math.hypot(candidate.x - pt.x, candidate.y - pt.y);
    if (d <= thr && (!best || d < best.d)) {
      best = { x: candidate.x, y: candidate.y, d, kind, snapped: true, ...meta };
    }
  };

  if (snapObjects) {
    const attach = nearestItemAttach(pt, items, thr);
    if (attach) {
      tryBest(attach.pt, attach.portType ? "port" : "object", {
        itemId: attach.itemId,
        portIndex: attach.portIndex,
        portType: attach.portType,
      });
    }
  }

  if (snapWalls) {
    const seg = nearestWallSegment(pt, walls, room, thr);
    if (seg?.proj) tryBest(seg.proj, "wall");
    const wallSnap = snapWallPoint(pt, walls, room, zoom, true, snapStep);
    if (wallSnap.snapped) tryBest({ x: wallSnap.x, y: wallSnap.y }, wallSnap.kind || "wall-node");
  }

  lines.forEach((ln) => {
    (ln.pts || []).forEach((p, idx) => {
      tryBest(p, "trass", { lineId: ln.id, lineNodeIdx: idx });
    });
  });

  if (best) return best;

  if (snapGrid) {
    return {
      x: snap(pt.x, snapStep, true),
      y: snap(pt.y, snapStep, true),
      snapped: false,
      kind: "grid",
    };
  }
  return { x: pt.x, y: pt.y, snapped: false };
}

/**
 * Выравнивание стеллажа к соседнему (ряд / вплотную).
 * Использует «липкость» (sticky), чтобы убрать дрожание на границе зоны захвата.
 */
export function snapRackNeighbor(it, x, y, items, thr = 120, sticky = null) {
  if (!isRackKind(it.kind)) {
    return { x, y, guides: [], snappedX: false, snappedY: false };
  }

  const xBuckets = [];
  const yBuckets = [];

  items.forEach((other) => {
    if (other.id === it.id || !isRackKind(other.kind)) return;

    const xCandidates = [
      { val: other.x + other.w, d: Math.abs(x - (other.x + other.w)), priority: 0, partnerId: other.id },
      { val: other.x - it.w, d: Math.abs(x - (other.x - it.w)), priority: 0, partnerId: other.id },
      { val: other.x, d: Math.abs(x - other.x), priority: 1, partnerId: other.id },
      { val: other.x + other.w - it.w, d: Math.abs(x - (other.x + other.w - it.w)), priority: 1, partnerId: other.id },
    ];
    xCandidates.forEach(({ val, d, priority, partnerId }) => {
      if (rackOverlapsOthers(it, val, y, items, it.id, [partnerId])) return;
      const bucket = considerRackSnap(null, "x", val, d, priority, it, other, x, y);
      if (bucket) xBuckets.push(bucket);
    });

    const yCandidates = [
      { val: other.y + other.h, d: Math.abs(y - (other.y + other.h)), priority: 0, partnerId: other.id },
      { val: other.y - it.h, d: Math.abs(y - (other.y - it.h)), priority: 0, partnerId: other.id },
      { val: other.y, d: Math.abs(y - other.y), priority: 1, partnerId: other.id },
      { val: other.y + other.h - it.h, d: Math.abs(y - (other.y + other.h - it.h)), priority: 1, partnerId: other.id },
    ];
    yCandidates.forEach(({ val, d, priority, partnerId }) => {
      if (rackOverlapsOthers(it, x, val, items, it.id, [partnerId])) return;
      const bucket = considerRackSnap(null, "y", val, d, priority, it, other, x, y);
      if (bucket) yBuckets.push(bucket);
    });
  });

  let bestX = null;
  let bestY = null;
  for (const b of xBuckets) {
    bestX = considerRackSnap(bestX, "x", b.val, b.d, b.priority, it, items.find((o) => o.id === b.partnerId), x, y);
  }
  for (const b of yBuckets) {
    bestY = considerRackSnap(bestY, "y", b.val, b.d, b.priority, it, items.find((o) => o.id === b.partnerId), x, y);
  }

  const rx = resolveRackAxis("x", x, bestX, thr, sticky);
  const ry = resolveRackAxis("y", y, bestY, thr, sticky);
  const fx = rx.val;
  const fy = ry.val;
  const ignore = [bestX?.partnerId, bestY?.partnerId].filter(Boolean);
  if ((rx.snapped || ry.snapped) && rackOverlapsOthers(it, fx, fy, items, it.id, ignore)) {
    return { x, y, guides: [], snappedX: false, snappedY: false };
  }
  const guides = [rx.guide, ry.guide].filter(Boolean);

  return {
    x: fx,
    y: fy,
    guides,
    snappedX: rx.snapped,
    snappedY: ry.snapped,
  };
}

export { TRASS_SNAP_DIST };
