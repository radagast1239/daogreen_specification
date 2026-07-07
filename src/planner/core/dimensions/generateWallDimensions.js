import { resolvePlanWalls } from "../../wallNetwork.js";
import { isDoorKind, isOpeningKind } from "../../doorTypes.js";
import { isRackKind } from "../../rackProperties.js";
import { formatDimensionValue } from "./display.js";
import { wallGeometryMap } from "../../buildWallGeometry.js";

const EXTERNAL_OFFSET_1 = 300;
const EXTERNAL_OFFSET_2 = 600;
const MIN_PIER_MM = 40;
const MIN_WALL_DIM_MM = 100;
const ALIGN_THR_MM = 120;
const MIN_AUTO_EXTERIOR_MM = 300;

export const MIN_SERVICE_AISLE_MM = 700;
export const MIN_MAIN_AISLE_MM = 900;
export const MIN_CART_AISLE_MM = 1000;

function uniqSorted(values = [], tol = 1) {
  const out = [];
  [...values].sort((a, b) => a - b).forEach((v) => {
    const last = out[out.length - 1];
    if (last == null || Math.abs(v - last) > tol) out.push(v);
  });
  return out;
}

function createAutoLinearDimension({
  id,
  p1,
  p2,
  offset = 120,
  orientation = null,
  kind = "auto",
  labelOverride = null,
  style = null,
  attachedTo = null,
}) {
  return {
    id,
    type: "dimension",
    mode: "linear",
    p1: { x: p1.x, y: p1.y },
    p2: { x: p2.x, y: p2.y },
    offset,
    orientation: orientation || (Math.abs((p2.x || 0) - (p1.x || 0)) >= Math.abs((p2.y || 0) - (p1.y || 0)) ? "horizontal" : "vertical"),
    attachedTo,
    labelOverride,
    locked: true,
    invalid: false,
    auto: true,
    kind,
    style,
  };
}

function wallPointsBounds(walls, room) {
  const pts = [];
  (walls || []).forEach((w) => (w.pts || []).forEach((p) => pts.push(p)));
  if (!pts.length) {
    return { minX: 0, minY: 0, maxX: room?.w || 0, maxY: room?.h || 0 };
  }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function repThk(walls) {
  const thks = (walls || []).filter((w) => w.thk > 0).map((w) => w.thk);
  if (!thks.length) return 100;
  const sorted = [...thks].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function allRectilinear(walls) {
  return (walls || []).every((w) => {
    const pts = w.pts || [];
    for (let i = 1; i < pts.length; i++) {
      const adx = Math.abs(pts[i].x - pts[i - 1].x);
      const ady = Math.abs(pts[i].y - pts[i - 1].y);
      if (adx > 1 && ady > 1) return false;
    }
    return true;
  });
}

// Round to nearest 5mm grid for endpoint coincidence checks
function endptKey(pt) {
  return `${Math.round(pt.x / 5)},${Math.round(pt.y / 5)}`;
}

// Group walls into connected components by shared endpoints (corner joints).
// T-junction stems (endpoint on body of another wall) form their own group.
function groupWallsByConnectivity(walls) {
  if (!walls?.length) return [];
  const n = walls.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(i) {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  }
  function union(a, b) {
    a = find(a); b = find(b);
    if (a !== b) parent[a] = b;
  }
  const epMap = new Map();
  walls.forEach((wall, idx) => {
    const pts = wall.pts || [];
    if (!pts.length) return;
    [pts[0], pts[pts.length - 1]].forEach((pt) => {
      const k = endptKey(pt);
      if (!epMap.has(k)) epMap.set(k, []);
      epMap.get(k).push(idx);
    });
  });
  epMap.forEach((idxs) => {
    for (let i = 1; i < idxs.length; i++) union(idxs[0], idxs[i]);
  });
  const groups = new Map();
  walls.forEach((wall, idx) => {
    const root = find(idx);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(wall);
  });
  return [...groups.values()];
}

// Returns true if all wall endpoints have valence exactly 2 — i.e. a closed loop.
function isClosedLoop(walls) {
  if (!walls?.length) return false;
  const valence = new Map();
  walls.forEach((wall) => {
    const pts = wall.pts || [];
    if (!pts.length) return;
    [pts[0], pts[pts.length - 1]].forEach((pt) => {
      const k = endptKey(pt);
      valence.set(k, (valence.get(k) || 0) + 1);
    });
  });
  return valence.size > 0 && [...valence.values()].every((v) => v === 2);
}

function classifyWallGroup(walls) {
  if (!walls?.length) return "open_or_standalone";
  if (!isClosedLoop(walls)) return "open_or_standalone";
  const axisAligned = walls.every((w) => {
    const pts = w.pts || [];
    for (let i = 1; i < pts.length; i++) {
      const adx = Math.abs(pts[i].x - pts[i - 1].x);
      const ady = Math.abs(pts[i].y - pts[i - 1].y);
      if (adx > CELL_AXIS_TOL && ady > CELL_AXIS_TOL) return false;
    }
    return true;
  });
  if (!axisAligned) return "complex_closed_loop";
  const corners = new Set();
  walls.forEach((w) => {
    const pts = w.pts || [];
    if (pts.length) {
      corners.add(endptKey(pts[0]));
      corners.add(endptKey(pts[pts.length - 1]));
    }
  });
  if (corners.size === 4) return "simple_rect_closed_loop";
  const cells = detectRectCells(walls);
  if (!cells.length) return "complex_closed_loop";
  const b = wallPointsBounds(walls, {});
  const bboxArea = (b.maxX - b.minX) * (b.maxY - b.minY);
  if (bboxArea <= 0) return "complex_closed_loop";
  let cellArea = 0;
  cells.forEach((c) => { cellArea += (c.x1 - c.x0) * (c.y1 - c.y0); });
  return cellArea / bboxArea > 0.95 ? "rect_cell_grid" : "complex_closed_loop";
}

function collectExteriorAxisCuts(walls, axis, edgeValue) {
  const cuts = [];
  (walls || []).forEach((w) => {
    const pts = w.pts || [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (axis === "x") {
        if (Math.abs(a.y - edgeValue) <= ALIGN_THR_MM && Math.abs(b.y - edgeValue) <= ALIGN_THR_MM) {
          cuts.push(a.x, b.x);
        }
      } else if (Math.abs(a.x - edgeValue) <= ALIGN_THR_MM && Math.abs(b.x - edgeValue) <= ALIGN_THR_MM) {
        cuts.push(a.y, b.y);
      }
    }
  });
  return uniqSorted(cuts, 5);
}

// Generate exterior dimensions for one connected group of walls.
// Only generates external_overall when the group forms a closed loop.
function generateExteriorDimensionsForGroup(groupWalls, room, gid) {
  const out = [];
  if (!isClosedLoop(groupWalls)) return out;

  const b = wallPointsBounds(groupWalls, room);
  const totalW = b.maxX - b.minX;
  const totalH = b.maxY - b.minY;
  const thk = repThk(groupWalls);
  const half = thk / 2;

  if (totalW >= MIN_AUTO_EXTERIOR_MM) {
    out.push(createAutoLinearDimension({
      id: `auto-ext-h-overall-${gid}`,
      p1: { x: b.minX - half, y: b.minY - half },
      p2: { x: b.maxX + half, y: b.minY - half },
      offset: -EXTERNAL_OFFSET_2,
      orientation: "horizontal",
      kind: "external_overall",
    }));
  }
  if (totalH >= MIN_AUTO_EXTERIOR_MM) {
    out.push(createAutoLinearDimension({
      id: `auto-ext-v-overall-${gid}`,
      p1: { x: b.minX - half, y: b.minY - half },
      p2: { x: b.minX - half, y: b.maxY + half },
      offset: EXTERNAL_OFFSET_2,
      orientation: "vertical",
      kind: "external_overall",
    }));
  }

  return out;
}

function generateExteriorDimensions(walls, room) {
  const groups = groupWallsByConnectivity(walls);
  const out = [];
  groups.forEach((group, i) => out.push(...generateExteriorDimensionsForGroup(group, room, i)));
  return out;
}

// Shared constants for axis-segment classification and cell detection.
const CELL_GRID = 5;       // mm: coordinate snap grid
const CELL_AXIS_TOL = 5;   // mm: max axis deviation to classify a segment as H or V
const CELL_COVER_TOL = 50; // mm: coverage tolerance for fp drift / near-miss endpoints
const snapCell = (v) => Math.round(v / CELL_GRID) * CELL_GRID;

// Classify every wall segment into horizontal or vertical axis-aligned segments.
// Diagonals are ignored. Each entry carries thk, thicknessSide and wallId.
function buildAxisSegs(walls) {
  const hSegs = []; // {y, x0, x1, thk, thicknessSide, wallId}
  const vSegs = []; // {x, y0, y1, thk, thicknessSide, wallId}
  (walls || []).forEach((w) => {
    const pts = w.pts || [];
    const thk = w.thk || 100;
    const thicknessSide = w.thicknessSide || "center";
    const wallId = w.id;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const adx = Math.abs(b.x - a.x);
      const ady = Math.abs(b.y - a.y);
      if (ady <= CELL_AXIS_TOL && adx > CELL_AXIS_TOL) {
        hSegs.push({ y: snapCell((a.y + b.y) / 2), x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), thk, thicknessSide, wallId });
      } else if (adx <= CELL_AXIS_TOL && ady > CELL_AXIS_TOL) {
        vSegs.push({ x: snapCell((a.x + b.x) / 2), y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y), thk, thicknessSide, wallId });
      }
    }
  });
  return { hSegs, vSegs };
}

// Inward distance from wall axis to inner face, matching wallFaceDistances() convention:
//   "center" → thk/2 on each side (default)
//   "in"     → axis = outer face, inner face is thk inward (e.g. interior partition drawn on outer edge)
//   "out"    → axis = inner face, outer face is thk outward (e.g. curtain wall drawn on inner edge)
function innerFaceDist(thk, thicknessSide) {
  if (thicknessSide === "in") return thk;
  if (thicknessSide === "out") return 0;
  return thk / 2;
}

// For each detected cell, find the covering segment on each of the 4 sides and collect its wallId.
// The returned Set contains IDs of all walls that form a complete boundary of at least one room cell.
// These walls should NOT emit wall_length (the room's internal_clear covers them).
function collectFullCellBoundaryWallIds(cells, hSegs, vSegs) {
  const ids = new Set();
  const findH = (y, x0, x1) => hSegs.find(
    (s) => Math.abs(s.y - y) <= CELL_COVER_TOL && s.x0 <= x0 + CELL_COVER_TOL && s.x1 >= x1 - CELL_COVER_TOL
  );
  const findV = (x, y0, y1) => vSegs.find(
    (s) => Math.abs(s.x - x) <= CELL_COVER_TOL && s.y0 <= y0 + CELL_COVER_TOL && s.y1 >= y1 - CELL_COVER_TOL
  );
  cells.forEach(({ x0, y0, x1, y1 }) => {
    const t = findH(y0, x0, x1); if (t?.wallId != null) ids.add(t.wallId);
    const b = findH(y1, x0, x1); if (b?.wallId != null) ids.add(b.wallId);
    const l = findV(x0, y0, y1); if (l?.wallId != null) ids.add(l.wallId);
    const r = findV(x1, y0, y1); if (r?.wallId != null) ids.add(r.wallId);
  });
  return ids;
}

// Detect rectangular room cells formed by the wall network.
// Diagonal segments are skipped. Works by snapping coordinates to a 5mm grid,
// then finding grid cells whose 4 sides are covered by axis-aligned wall segments.
// A single long wall can cover multiple adjacent cell edges (T-junction support).
function detectRectCells(walls) {
  const { hSegs, vSegs } = buildAxisSegs(walls);
  if (!hSegs.length || !vSegs.length) return [];

  // Build coordinate grid by snapping all segment endpoints
  const xSet = new Set();
  const ySet = new Set();
  hSegs.forEach((s) => {
    ySet.add(snapCell(s.y));
    xSet.add(snapCell(s.x0));
    xSet.add(snapCell(s.x1));
  });
  vSegs.forEach((s) => {
    xSet.add(snapCell(s.x));
    ySet.add(snapCell(s.y0));
    ySet.add(snapCell(s.y1));
  });
  const xs = [...xSet].sort((a, b) => a - b);
  const ys = [...ySet].sort((a, b) => a - b);

  // Coverage: true if ANY segment on this axis covers the full [lo, hi] interval.
  // A long segment (e.g. x0=0..x1=8000) satisfies a sub-interval (e.g. x0=0..x1=4000).
  const hasH = (y, x0, x1) =>
    hSegs.some((s) => Math.abs(s.y - y) <= CELL_COVER_TOL && s.x0 <= x0 + CELL_COVER_TOL && s.x1 >= x1 - CELL_COVER_TOL);
  const hasV = (x, y0, y1) =>
    vSegs.some((s) => Math.abs(s.x - x) <= CELL_COVER_TOL && s.y0 <= y0 + CELL_COVER_TOL && s.y1 >= y1 - CELL_COVER_TOL);

  const cells = [];
  const seen = new Set();
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      const x0 = xs[i], x1 = xs[i + 1], y0 = ys[j], y1 = ys[j + 1];
      if (x1 - x0 < MIN_AUTO_EXTERIOR_MM) continue;
      if (y1 - y0 < MIN_AUTO_EXTERIOR_MM) continue;
      if (hasH(y0, x0, x1) && hasH(y1, x0, x1) && hasV(x0, y0, y1) && hasV(x1, y0, y1)) {
        const key = `${snapCell(x0)},${snapCell(y0)},${snapCell(x1)},${snapCell(y1)}`;
        if (!seen.has(key)) {
          seen.add(key);
          cells.push({ x0, y0, x1, y1 });
        }
      }
    }
  }
  return cells;
}

// Compute the inner-face rectangle for a detected room cell.
// Finds the covering wall segment on each of the 4 sides and uses innerFaceDist
// (which respects thicknessSide) to offset the cell boundary inward to the face.
// Returns { innerLeft, innerRight, innerTop, innerBot, width, height }.
export function resolveCellInnerRect(cell, hSegs, vSegs, fallbackThk) {
  const { x0, y0, x1, y1 } = cell;

  const fH = (y, xa, xb) => hSegs.find(
    (s) => Math.abs(s.y - y) <= CELL_COVER_TOL && s.x0 <= xa + CELL_COVER_TOL && s.x1 >= xb - CELL_COVER_TOL
  );
  const fV = (x, ya, yb) => vSegs.find(
    (s) => Math.abs(s.x - x) <= CELL_COVER_TOL && s.y0 <= ya + CELL_COVER_TOL && s.y1 >= yb - CELL_COVER_TOL
  );

  const segTop   = fH(y0, x0, x1);
  const segBot   = fH(y1, x0, x1);
  const segLeft  = fV(x0, y0, y1);
  const segRight = fV(x1, y0, y1);

  const innerLeft  = x0 + innerFaceDist(segLeft?.thk   ?? fallbackThk, segLeft?.thicknessSide   ?? "center");
  const innerRight = x1 - innerFaceDist(segRight?.thk  ?? fallbackThk, segRight?.thicknessSide  ?? "center");
  const innerTop   = y0 + innerFaceDist(segTop?.thk    ?? fallbackThk, segTop?.thicknessSide    ?? "center");
  const innerBot   = y1 - innerFaceDist(segBot?.thk    ?? fallbackThk, segBot?.thicknessSide    ?? "center");

  return {
    innerLeft,
    innerRight,
    innerTop,
    innerBot,
    width:  innerRight - innerLeft,
    height: innerBot   - innerTop,
  };
}

// Generate internal_clear dims measured from inner wall faces, not centerlines.
function generateInternalClearForCells(walls) {
  const groups = groupWallsByConnectivity(walls);
  const complexIds = new Set();
  groups.forEach((g) => {
    if (classifyWallGroup(g) === "complex_closed_loop") {
      g.forEach((w) => { if (w?.id != null) complexIds.add(w.id); });
    }
  });
  const eligible = complexIds.size > 0 ? walls.filter((w) => !complexIds.has(w.id)) : walls;
  const cells = detectRectCells(eligible);
  if (!cells.length) return [];
  const { hSegs, vSegs } = buildAxisSegs(eligible);
  const fallbackThk = repThk(eligible);
  const out = [];
  cells.forEach((cell, idx) => {
    const { innerLeft, innerRight, innerTop, innerBot, width, height } =
      resolveCellInnerRect(cell, hSegs, vSegs, fallbackThk);
    if (width >= MIN_AUTO_EXTERIOR_MM) {
      out.push(createAutoLinearDimension({
        id: `auto-cell-h-clear-${idx}`,
        p1: { x: innerLeft,  y: innerTop },
        p2: { x: innerRight, y: innerTop },
        offset: EXTERNAL_OFFSET_1,
        orientation: "horizontal",
        kind: "internal_clear",
      }));
    }
    if (height >= MIN_AUTO_EXTERIOR_MM) {
      out.push(createAutoLinearDimension({
        id: `auto-cell-v-clear-${idx}`,
        p1: { x: innerLeft, y: innerTop },
        p2: { x: innerLeft, y: innerBot },
        offset: -EXTERNAL_OFFSET_1,
        orientation: "vertical",
        kind: "internal_clear",
      }));
    }
  });
  return out;
}

function generatePerWallDimensions(walls, room, displayMode) {
  const out = [];
  if (!walls?.length) return out;

  // Suppress wall_length for any wall that forms a complete boundary of at least one
  // detected room cell — covers both outer perimeter walls and full-span partitions.
  const cells = detectRectCells(walls);
  const { hSegs: bAxisH, vSegs: bAxisV } = buildAxisSegs(walls);
  const suppressedWallIds = collectFullCellBoundaryWallIds(cells, bAxisH, bAxisV);

  const groups = groupWallsByConnectivity(walls);
  groups.forEach((g) => {
    if (classifyWallGroup(g) === "complex_closed_loop") {
      g.forEach((w) => { if (w?.id != null) suppressedWallIds.add(w.id); });
    }
  });

  const b = wallPointsBounds(walls, room);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const geom = wallGeometryMap(walls, room);

  (walls || []).forEach((wall) => {
    if (!wall?.pts || wall.pts.length < 2) return;
    if (suppressedWallIds.has(wall.id)) return;
    for (let i = 1; i < wall.pts.length; i++) {
      const aCL = wall.pts[i - 1];
      const bCL = wall.pts[i];
      const clLen = Math.hypot(bCL.x - aCL.x, bCL.y - aCL.y);
      if (clLen < MIN_AUTO_EXTERIOR_MM) continue;

      const ux = (bCL.x - aCL.x) / clLen;
      const uy = (bCL.y - aCL.y) / clLen;
      // Левый перпендикуляр (same convention as SegDim)
      const nx = -uy;
      const ny = ux;

      // Collect quad corners from visible wall body (miter-corrected slab geometry).
      // For 2-point walls: gather ALL sub-quads (handles T-junction expansion on host walls).
      // For multi-segment polylines: use the specific segment quad.
      const quadCorners = [];
      if (wall.pts.length === 2) {
        for (const p of geom?.polygons || []) {
          if (p.wallId === wall.id) quadCorners.push(...p.quad);
        }
      } else {
        const quad = geom?.quads?.get(`${wall.id}-${i - 1}`);
        if (quad) quadCorners.push(...quad);
      }

      let p1, p2, visibleLen;
      if (quadCorners.length >= 4) {
        // Project all slab corners onto wall axis to find actual visible extent
        const projs = quadCorners.map((pt) => (pt.x - aCL.x) * ux + (pt.y - aCL.y) * uy);
        const minT = Math.min(...projs);
        const maxT = Math.max(...projs);
        visibleLen = maxT - minT;
        if (visibleLen < MIN_AUTO_EXTERIOR_MM) continue;
        p1 = { x: aCL.x + ux * minT, y: aCL.y + uy * minT };
        p2 = { x: aCL.x + ux * maxT, y: aCL.y + uy * maxT };
      } else {
        // No quad available: fall back to centerline endpoints
        p1 = { x: aCL.x, y: aCL.y };
        p2 = { x: bCL.x, y: bCL.y };
        visibleLen = clLen;
      }

      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      const dot = (cx - midX) * nx + (cy - midY) * ny;
      // 150mm outside miter corner — clears wall body and stays legible
      const offset = dot > 0 ? -150 : 150;

      out.push(createAutoLinearDimension({
        id: `auto-wall-len-${wall.id}-${i}`,
        p1,
        p2,
        offset,
        kind: "wall_length",
        labelOverride: formatDimensionValue(visibleLen, displayMode),
      }));
    }
  });
  return out;
}


function collectOpeningIntervalsOnWall(items, wall) {
  if (!wall?.pts || wall.pts.length < 2) return [];
  const out = [];
  const a = wall.pts[0];
  const b = wall.pts[wall.pts.length - 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;

  (items || []).forEach((it) => {
    if (!isDoorKind(it.kind) && !isOpeningKind(it.kind)) return;
    if (!it.wallId || it.wallId !== wall.id) return;
    const c = { x: it.x + it.w / 2, y: it.y + it.h / 2 };
    const t = (c.x - a.x) * ux + (c.y - a.y) * uy;
    const openingLen = Math.max(100, Math.min(Math.max(it.w, it.h), len));
    out.push({
      item: it,
      t0: Math.max(0, t - openingLen / 2),
      t1: Math.min(len, t + openingLen / 2),
      len: openingLen,
    });
  });
  return out.sort((x, y) => x.t0 - y.t0);
}

function projectWallT(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function generateOpeningAndPierDimensions(plan, displayMode) {
  const walls = resolvePlanWalls(plan);
  const out = [];
  walls.forEach((wall) => {
    if (!wall?.pts || wall.pts.length < 2) return;
    const a = wall.pts[0];
    const b = wall.pts[wall.pts.length - 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const intervals = collectOpeningIntervalsOnWall(plan.items, wall);
    if (!intervals.length) return;
    intervals.forEach((iv, i) => {
      const p1 = projectWallT(a, b, iv.t0 / len);
      const p2 = projectWallT(a, b, iv.t1 / len);
      out.push(createAutoLinearDimension({
        id: `auto-opening-${wall.id}-${iv.item.id}-${i}`,
        p1,
        p2,
        offset: 180,
        kind: "opening",
        labelOverride: formatDimensionValue(iv.len, displayMode),
        style: { importance: "important" },
        attachedTo: { type: "item", id: iv.item.id },
      }));
    });

    const cuts = uniqSorted([0, ...intervals.flatMap((iv) => [iv.t0, iv.t1]), len], 5);
    for (let i = 1; i < cuts.length; i++) {
      const t0 = cuts[i - 1];
      const t1 = cuts[i];
      const span = t1 - t0;
      if (span < MIN_PIER_MM) continue;
      const overlapsOpening = intervals.some((iv) => t0 >= iv.t0 - 1 && t1 <= iv.t1 + 1);
      if (overlapsOpening) continue;
      const p1 = projectWallT(a, b, t0 / len);
      const p2 = projectWallT(a, b, t1 / len);
      out.push(createAutoLinearDimension({
        id: `auto-pier-${wall.id}-${i}`,
        p1,
        p2,
        offset: 240,
        kind: "pier",
        labelOverride: formatDimensionValue(span, displayMode),
      }));
    }
  });
  return out;
}

function rackItems(items = []) {
  return items.filter((it) => it.category === "rack" || it.layer === "racks" || isRackKind(it.kind));
}

function overlapSpan(a0, a1, b0, b1) {
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

function rackAisleType(rackA, rackB) {
  const t = rackA?.aisleType || rackB?.aisleType || "service";
  if (t === "cart") return { key: "cart", minMm: MIN_CART_AISLE_MM };
  if (t === "main") return { key: "main", minMm: MIN_MAIN_AISLE_MM };
  return { key: "service", minMm: MIN_SERVICE_AISLE_MM };
}

function generateRackAisles(plan, displayMode) {
  const racks = rackItems(plan?.items || []);
  const dims = [];
  const warnings = [];
  for (let i = 0; i < racks.length; i++) {
    for (let j = i + 1; j < racks.length; j++) {
      const a = racks[i];
      const b = racks[j];
      const ovY = overlapSpan(a.y, a.y + a.h, b.y, b.y + b.h);
      const ovX = overlapSpan(a.x, a.x + a.w, b.x, b.x + b.w);
      let gap = 0;
      let p1;
      let p2;
      let orientation;
      if (ovY > 100) {
        gap = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
        if (gap > 0) {
          const y = Math.max(a.y, b.y) + ovY / 2;
          if (a.x < b.x) {
            p1 = { x: a.x + a.w, y };
            p2 = { x: b.x, y };
          } else {
            p1 = { x: b.x + b.w, y };
            p2 = { x: a.x, y };
          }
          orientation = "horizontal";
        }
      } else if (ovX > 100) {
        gap = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
        if (gap > 0) {
          const x = Math.max(a.x, b.x) + ovX / 2;
          if (a.y < b.y) {
            p1 = { x, y: a.y + a.h };
            p2 = { x, y: b.y };
          } else {
            p1 = { x, y: b.y + b.h };
            p2 = { x, y: a.y };
          }
          orientation = "vertical";
        }
      }
      if (!gap || !p1 || !p2 || gap > 5000) continue;
      const aisle = rackAisleType(a, b);
      const tooSmall = gap < aisle.minMm;
      const style = tooSmall
        ? { importance: "error" }
        : aisle.minMm > MIN_SERVICE_AISLE_MM
          ? { importance: "important" }
          : { importance: "normal" };

      dims.push(createAutoLinearDimension({
        id: `auto-aisle-${a.id}-${b.id}`,
        p1,
        p2,
        offset: 120,
        orientation,
        kind: "rack_aisle",
        style,
        labelOverride: formatDimensionValue(gap, displayMode),
        attachedTo: { type: "rack_pair", ids: [a.id, b.id], aisleType: aisle.key },
      }));

      if (tooSmall) {
        warnings.push({
          id: `aisle-${a.id}-${b.id}`,
          severity: "warning",
          objectIds: [a.id, b.id],
          text: `Проход ${Math.round(gap)} мм меньше нормы ${aisle.minMm} мм`,
          source: "dimensions",
        });
      }
    }
  }
  return { dims, warnings };
}

function spanLengthMm(p1, p2) {
  return Math.hypot((p2?.x || 0) - (p1?.x || 0), (p2?.y || 0) - (p1?.y || 0));
}

function spanDedupeKey(dim) {
  // wall_length dims are per-wall and must never be deduplicated against each other
  if (dim.kind === "wall_length") return null;
  if (dim.orientation !== "horizontal" && dim.orientation !== "vertical") return null;
  const len = Math.round(spanLengthMm(dim.p1, dim.p2));
  if (dim.orientation === "horizontal") {
    const x0 = Math.round(Math.min(dim.p1.x, dim.p2.x));
    const x1 = Math.round(Math.max(dim.p1.x, dim.p2.x));
    // Include Y so dims for different rooms at the same horizontal span survive dedup
    const y = Math.round((dim.p1.y + dim.p2.y) / 2);
    return `h:${y}:${x0}:${x1}:${len}`;
  }
  const y0 = Math.round(Math.min(dim.p1.y, dim.p2.y));
  const y1 = Math.round(Math.max(dim.p1.y, dim.p2.y));
  // Include X so dims for different rooms at the same vertical span survive dedup
  const x = Math.round((dim.p1.x + dim.p2.x) / 2);
  return `v:${x}:${y0}:${y1}:${len}`;
}

const DIM_KIND_PRIORITY = {
  opening: 5,
  pier: 4,
  wall_length: 3,
  external_segment: 3,
  room_width: 3,
  room_height: 3,
  internal_clear: 2,
  rack_aisle: 2,
  external_overall: 1,
};

function dedupeDimensions(dims) {
  const seen = new Map();
  const out = [];
  for (const dim of dims || []) {
    if (dim.mode === "annotation" || dim.style?.textOnly) {
      out.push(dim);
      continue;
    }
    const len = spanLengthMm(dim.p1, dim.p2);
    const isWallSpan = dim.kind === "external_segment" || dim.kind === "external_overall"
      || dim.kind === "internal_clear"
      || dim.kind === "room_width" || dim.kind === "room_height" || dim.kind === "pier";
    if (isWallSpan && len > 0 && len < MIN_WALL_DIM_MM) continue;
    const key = spanDedupeKey(dim);
    if (!key) {
      out.push(dim);
      continue;
    }
    const prev = seen.get(key);
    if (prev) {
      const prevPri = DIM_KIND_PRIORITY[prev.kind] ?? 0;
      const nextPri = DIM_KIND_PRIORITY[dim.kind] ?? 0;
      if (nextPri > prevPri) {
        const idx = out.indexOf(prev);
        if (idx >= 0) out[idx] = dim;
        seen.set(key, dim);
      }
      continue;
    }
    seen.set(key, dim);
    out.push(dim);
  }
  return out;
}

// Returns the projected {axis, lo, hi} span of a horizontal/vertical dim. Null for diagonals.
function axisSpan(dim) {
  if (!dim?.p1 || !dim?.p2) return null;
  if (dim.orientation === "horizontal") {
    return { axis: "h", lo: Math.min(dim.p1.x, dim.p2.x), hi: Math.max(dim.p1.x, dim.p2.x) };
  }
  if (dim.orientation === "vertical") {
    return { axis: "v", lo: Math.min(dim.p1.y, dim.p2.y), hi: Math.max(dim.p1.y, dim.p2.y) };
  }
  return null;
}

// Returns true when spans a and b cover nearly the same range (within tol mm on each side).
function spansNearlyEqual(a, b, tol = 200) {
  if (!a || !b || a.axis !== b.axis) return false;
  return Math.abs(a.lo - b.lo) <= tol && Math.abs(a.hi - b.hi) <= tol;
}

// Remove wall_length dims whose span is already covered by external_overall.
// Only external_overall is used as reference — internal_clear is a room interior dim and
// should not suppress partition wall_length that spans a sub-room.
// Keeps diagonal wall_length (axisSpan returns null) and short/partial partitions.
function removeWallLengthCoveredBySpans(dims) {
  const overallSpans = dims
    .filter((d) => d.kind === "external_overall")
    .map((d) => axisSpan(d))
    .filter(Boolean);
  if (!overallSpans.length) return dims;
  return dims.filter((d) => {
    if (d.kind !== "wall_length") return true;
    const span = axisSpan(d);
    if (!span) return true; // diagonal — always keep
    return !overallSpans.some((os) => spansNearlyEqual(span, os));
  });
}

export function generateWallDimensions(plan, opts = {}) {
  const displayMode = opts.dimensionDisplayMode || "remplanner_cm";
  const walls = resolvePlanWalls(plan);
  const dimensions = [
    ...generateExteriorDimensions(walls, plan?.room || {}),
    ...generateInternalClearForCells(walls),
    ...generatePerWallDimensions(walls, plan?.room || {}, displayMode),
    ...generateOpeningAndPierDimensions(plan, displayMode),
  ];
  const rack = generateRackAisles(plan, displayMode);
  const all = removeWallLengthCoveredBySpans(dedupeDimensions([...dimensions, ...rack.dims]));
  return {
    dimensions: all,
    validationWarnings: rack.warnings,
  };
}
