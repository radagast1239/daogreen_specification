/**
 * Расширенные привязки планировщика (этап 6).
 */
import { snap } from "./catalog.js";
import { snapWallPoint, nearestWallSegment } from "./wallGeometry.js";
import { nearestItemAttach } from "./lineProperties.js";
import { isRackKind } from "./rackProperties.js";

const LINE_ATTACH_DIST = 240;
const TRASS_SNAP_DIST = 180;

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

/** Выравнивание стеллажа к соседнему (ряд). */
export function snapRackNeighbor(it, x, y, items, thr = 120) {
  if (!isRackKind(it.kind)) return { x, y, guides: [] };
  const guides = [];
  let nx = x;
  let ny = y;
  items.forEach((other) => {
    if (other.id === it.id || !isRackKind(other.kind)) return;
    const edges = [
      { axis: "x", val: other.x + other.w, target: x },
      { axis: "x", val: other.x - it.w, target: x },
      { axis: "y", val: other.y + other.h, target: y },
      { axis: "y", val: other.y - it.h, target: y },
    ];
    edges.forEach(({ axis, val, target }) => {
      const d = Math.abs(target - val);
      if (d <= thr) {
        if (axis === "x") {
          nx = val;
          guides.push({ type: "V", at: val, y0: Math.min(y, other.y) - 40, y1: Math.max(y + it.h, other.y + other.h) + 40 });
        } else {
          ny = val;
          guides.push({ type: "H", at: val, x0: Math.min(x, other.x) - 40, x1: Math.max(x + it.w, other.x + other.w) + 40 });
        }
      }
    });
  });
  return { x: nx, y: ny, guides };
}

export { TRASS_SNAP_DIST };
