import { resolvePlanWalls } from "../../wallNetwork.js";
import { isDoorKind, isOpeningKind } from "../../doorTypes.js";
import { isRackKind } from "../../rackProperties.js";
import { formatDimensionValue } from "./display.js";
import { wallGeometryMap } from "../../buildWallGeometry.js";
import { pointInPolygon } from "../walls/wallOps.js";
import { detectRooms } from "../rooms/detectRooms.js";
import { buildRenderedContours } from "../walls/renderedContours.js";
import { generateContourDimensions } from "./contourDimensions.js";
import { finalizeAutoDimensions } from "./finalizeAutoDimensions.js";
import {
  FACE_REF_KINDS,
  buildWallFaceReferences,
  resolveRoomFacingReference,
  applyJoinedQuadToReference,
  anchorsOnCenterline,
} from "../walls/wallFaceReferences.js";
import {
  openChainExteriorOffsetForWall,
  openChainExteriorFaceSpan,
} from "../walls/selectedWallPhysicalSpans.js";

const EXTERNAL_OFFSET_1 = 300;
const EXTERNAL_OFFSET_2 = 600;
const MIN_PIER_MM = 40;
const MIN_WALL_DIM_MM = 100;
const ALIGN_THR_MM = 120;
const MIN_AUTO_EXTERIOR_MM = 300;
// Deterministic Fit-scale readability floor: the N longest room-facing
// wall_length dimensions are promoted to the same priority tier as
// external_overall so a complex plan always shows a few primary segment
// dimensions on Fit, not just the outer bounding box (or nothing).
// LIVE3: promote enough wall_length labels that free-standing / L-shape walls
// remain readable at normal editing zoom. Does not add new records — only
// style.importance — so accepted metrology inventory count is unchanged.
const MAX_IMPORTANT_WALL_LENGTH_DIMS = 48;

/** Open multi-arm junction (T / degree-4 cross) with no closed room/envelope. */
function hasOpenMultiArmJunction(plan, walls) {
  const deg = new Map();
  for (const w of walls || []) {
    if (!w?.a || !w?.b) continue;
    deg.set(w.a, (deg.get(w.a) || 0) + 1);
    deg.set(w.b, (deg.get(w.b) || 0) + 1);
  }
  for (const d of deg.values()) {
    if (d >= 3) return true;
  }
  // Also treat four arms meeting via coincident endpoints without shared id
  // (legacy fixtures) as open junction when ≥3 walls share an endpoint XY.
  const byXy = new Map();
  const nodes = plan?.nodes || {};
  for (const w of walls || []) {
    for (const nid of [w.a, w.b]) {
      const n = nodes[nid];
      if (!n || !Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
      const key = `${Math.round(n.x)}:${Math.round(n.y)}`;
      if (!byXy.has(key)) byXy.set(key, new Set());
      byXy.get(key).add(w.id);
    }
  }
  for (const ids of byXy.values()) {
    if (ids.size >= 3) return true;
  }
  return false;
}

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
  referenceKind = null,
  reference = null,
  invalid = false,
  invalidReason = null,
  measurementValue = null,
}) {
  const span = Number.isFinite(measurementValue) && measurementValue > 0
    ? measurementValue
    : Math.hypot((p2?.x || 0) - (p1?.x || 0), (p2?.y || 0) - (p1?.y || 0));
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
    invalid: !!invalid,
    invalidReason: invalidReason || null,
    auto: true,
    kind,
    style,
    referenceKind: referenceKind || null,
    reference: reference || null,
    measurementValue: span,
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
// A connected wall group is "closed" (has a well-defined exterior envelope)
// when it has no dangling/open wall end -- i.e. every node touched by a
// wall endpoint is touched by at least 2. Nodes with valence > 2 are
// perfectly normal T-junctions (a partition wall welded into an outer
// wall, split into two segments at that point) and must NOT disqualify the
// group: only valence === 1 (a wall end that joins nothing) means the
// group is actually open and has no real building envelope.
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
  return valence.size > 0 && [...valence.values()].every((v) => v >= 2);
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
      referenceKind: FACE_REF_KINDS.JOINED_OUTER_FACE,
      style: { importance: "important" },
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
      referenceKind: FACE_REF_KINDS.JOINED_OUTER_FACE,
      style: { importance: "important" },
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
        referenceKind: FACE_REF_KINDS.JOINED_ROOM_FACE,
        style: { importance: "important" },
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
        referenceKind: FACE_REF_KINDS.JOINED_ROOM_FACE,
        style: { importance: "important" },
      }));
    }
  });
  return out;
}

function generatePerWallDimensions(walls, room, displayMode, roomPolygons = [], roomIds = [], plan = null) {
  const out = [];
  if (!walls?.length) return out;
  const planForOpen = plan || { walls, nodes: room?._nodes || {}, room };

  // Suppress wall_length only for a wall that forms a complete boundary of
  // at least one detected (axis-aligned) room cell — its length is already
  // covered by that cell's internal_clear dimension. A wall belonging to a
  // "complex_closed_loop" (any closed loop containing a diagonal) is no
  // longer blanket-suppressed here: detectRectCells only ever finds
  // axis-aligned cells, so a diagonal-containing loop has no cell to cover
  // its segments' lengths, and every segment (horizontal, vertical, or
  // diagonal) still needs its own room-facing, face-anchored dimension —
  // exactly what the loop below already produces per wall.
  const cells = detectRectCells(walls);
  const { hSegs: bAxisH, vSegs: bAxisV } = buildAxisSegs(walls);
  const suppressedWallIds = collectFullCellBoundaryWallIds(cells, bAxisH, bAxisV);

  const b = wallPointsBounds(walls, room);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const geom = wallGeometryMap(walls, room);
  // LIVE4.1: open-chain face/lane lookup is O(walls) — cache once per wallId.
  const openFaceByWall = new Map();
  const openFaceFor = (wallId) => {
    if (openFaceByWall.has(wallId)) return openFaceByWall.get(wallId);
    const v = openChainExteriorFaceSpan(planForOpen, wallId);
    openFaceByWall.set(wallId, v);
    return v;
  };

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

      // Gather this wall's slab sub-quads (T-junction expansion may split a
      // 2-point wall into several quads; a multi-segment polyline uses just
      // this segment's own quad). Each quad is [outerA, outerB, innerB, innerA]
      // — already mitered/joined against neighboring walls by buildWallGeometry.
      const quads = [];
      if (wall.pts.length === 2) {
        for (const p of geom?.polygons || []) {
          if (p.wallId === wall.id) quads.push(p.quad);
        }
      } else {
        const quad = geom?.quads?.get(`${wall.id}-${i - 1}`);
        if (quad) quads.push(quad);
      }

      // Decide ONCE per wall segment whether the "inner" or "outer" face is
      // the one actually facing into a real detected room — geometrically
      // verified via point-in-polygon against the room's true polygon,
      // never a whole-plan bounding-box heuristic (that broke diagonal
      // walls in irregular rooms). Falls back to "inner" when no room
      // polygon data is supplied, matching prior behaviour. The same
      // choice is applied to every T-junction sub-quad so a wall never
      // mixes faces along its own length.
      let chosenFace = "inner";
      // LIVE4.1: open L / open chain — measure the physical exterior face
      // (farther from chain centroid), not nearest-room inner face.
      const openFace = openFaceFor(wall.id);
      if (openFace?.reason === "open_chain" && openFace.chosenFace) {
        chosenFace = openFace.chosenFace;
      } else if (roomPolygons?.length && quads.length) {
        const [outerA, outerB, innerB, innerA] = quads[0];
        const innerMid = { x: (innerA.x + innerB.x) / 2, y: (innerA.y + innerB.y) / 2 };
        const outerMid = { x: (outerA.x + outerB.x) / 2, y: (outerA.y + outerB.y) / 2 };
        const innerInRoom = roomPolygons.some((poly) => pointInPolygon(innerMid, poly));
        const outerInRoom = roomPolygons.some((poly) => pointInPolygon(outerMid, poly));
        if (outerInRoom && !innerInRoom) chosenFace = "outer";
        else if (innerInRoom && !outerInRoom) chosenFace = "inner";
        else {
          // Both or neither inside a centreline room poly. "inner"/"outer" labels
          // flip when wallSegmentOffsetSide uses the fixed canvas centre under
          // plan translation (Phase 2F1-M2). Pick the face mid closer to the
          // nearest room centroid — label-invariant for a simultaneous flip.
          let bestD = Infinity;
          let bestFace = "inner";
          for (const poly of roomPolygons) {
            const n = poly.length || 1;
            const c = {
              x: poly.reduce((s, p) => s + p.x, 0) / n,
              y: poly.reduce((s, p) => s + p.y, 0) / n,
            };
            for (const [face, mid] of [["inner", innerMid], ["outer", outerMid]]) {
              const d = Math.hypot(c.x - mid.x, c.y - mid.y);
              if (d < bestD) { bestD = d; bestFace = face; }
            }
          }
          chosenFace = bestFace;
        }
      }

      // Find which sub-quad's chosen-face corner sits at each end of the
      // wall (by projecting onto the wall axis) and use THAT corner
      // directly as the dimension endpoint — it is already the correctly
      // mitered/joined face point, never re-derived from the centerline.
      let minEntry = null;
      let maxEntry = null;
      for (const quad of quads) {
        const [outerA, outerB, innerB, innerA] = quad;
        const faceA = chosenFace === "outer" ? outerA : innerA;
        const faceB = chosenFace === "outer" ? outerB : innerB;
        for (const pt of [faceA, faceB]) {
          const t = (pt.x - aCL.x) * ux + (pt.y - aCL.y) * uy;
          if (!minEntry || t < minEntry.t) minEntry = { t, pt };
          if (!maxEntry || t > maxEntry.t) maxEntry = { t, pt };
        }
      }

      let p1, p2, visibleLen, referenceKind = FACE_REF_KINDS.JOINED_ROOM_FACE, reference = null;
      if (minEntry && maxEntry) {
        visibleLen = maxEntry.t - minEntry.t;
        if (visibleLen < MIN_AUTO_EXTERIOR_MM) continue;
        p1 = minEntry.pt;
        p2 = maxEntry.pt;
        reference = {
          wallId: wall.id,
          kind: referenceKind,
          side: chosenFace,
          start: p1,
          end: p2,
          joinedStart: p1,
          joinedEnd: p2,
        };
      } else {
        // No silent centerline fallback — use semantic face refs or skip as invalid.
        const faceBundle = buildWallFaceReferences(wall, room);
        if (!faceBundle) continue;
        let roomRef = null;
        if (roomPolygons?.length) {
          for (let ri = 0; ri < roomPolygons.length; ri++) {
            const resolved = resolveRoomFacingReference(
              wall,
              roomPolygons[ri],
              roomIds?.[ri] || null,
              room,
            );
            if (resolved.ok) {
              roomRef = resolved.reference;
              break;
            }
          }
        }
        const faceRef = roomRef || {
          ...faceBundle.faceA,
          kind: FACE_REF_KINDS.ROOM_FACE,
        };
        const joined = applyJoinedQuadToReference(faceRef, quads, chosenFace === "outer");
        p1 = joined.joinedStart;
        p2 = joined.joinedEnd;
        visibleLen = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        if (visibleLen < MIN_AUTO_EXTERIOR_MM) continue;
        referenceKind = joined.kind || FACE_REF_KINDS.ROOM_FACE;
        reference = joined;
        if (anchorsOnCenterline(p1, p2, faceBundle.centerline, 4)) {
          // Refuse to emit a centerline-anchored visual wall dimension.
          continue;
        }
      }

      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      // Room-facing wall_length dimensions must render INSIDE the room they
      // describe (see acceptance contract) — never decided by "which side is
      // closer to the whole-plan bounding-box center", which can point
      // outward (through the wall, into the exterior gap toward
      // external_overall) for any wall not near the plan's overall center,
      // e.g. every wall of a shape whose bbox center falls outside a notch
      // or a non-convex room. Prefer an explicit point-in-polygon probe
      // against the SAME room polygon set used for chosenFace above.
      let offset;
      if (roomPolygons?.length) {
        const candidateIn = { x: midX + nx * 150, y: midY + ny * 150 };
        const candidateOut = { x: midX - nx * 150, y: midY - ny * 150 };
        const inIsInside = roomPolygons.some((poly) => pointInPolygon(candidateIn, poly));
        const outIsInside = roomPolygons.some((poly) => pointInPolygon(candidateOut, poly));
        if (inIsInside && !outIsInside) offset = 150;
        else if (outIsInside && !inIsInside) offset = -150;
      }
      // LIVE4: open chains (free L etc.) must wrap the OUTSIDE of the elbow
      // even when unrelated closed rooms exist elsewhere on the plan. Prefer
      // that before the "nearest room" pull which aimed labels into the L.
      // LIVE4.1: reuse openFace computed above (lane + exterior face).
      if (offset == null && openFace?.reason === "open_chain" && openFace.offsetMm != null) {
        offset = openFace.offsetMm;
      } else if (offset == null) {
        const open = openChainExteriorOffsetForWall(planForOpen, wall.id);
        if (open?.reason === "open_chain" && open.offsetMm != null) {
          offset = open.offsetMm;
        }
      }
      if (offset == null && roomPolygons?.length) {
        // PHASE 2E FOLLOW-UP — neither candidate is inside a room, but rooms
        // DO exist (e.g. notch cut-off). Prefer the side facing the nearest
        // room. Closed-room walls already resolved via containment above.
        let ref = null;
        let bestD = Infinity;
        for (const poly of roomPolygons) {
          const n = poly.length || 1;
          const c = {
            x: poly.reduce((s, p) => s + p.x, 0) / n,
            y: poly.reduce((s, p) => s + p.y, 0) / n,
          };
          const d = Math.hypot(c.x - midX, c.y - midY);
          if (d < bestD) { bestD = d; ref = c; }
        }
        if (ref) {
          const dot = (ref.x - midX) * nx + (ref.y - midY) * ny;
          offset = dot > 0 ? 150 : -150;   // toward the room, i.e. readable side
        }
      }
      if (offset == null) {
        // Free-standing / unknown: bbox-center heuristic (prior behaviour).
        const dot = (cx - midX) * nx + (cy - midY) * ny;
        offset = dot > 0 ? -150 : 150;
      }

      out.push(createAutoLinearDimension({
        id: `auto-wall-len-${wall.id}-${i}`,
        p1,
        p2,
        offset,
        kind: "wall_length",
        labelOverride: formatDimensionValue(visibleLen, displayMode),
        referenceKind,
        reference,
        measurementValue: visibleLen,
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
  // Exterior overall + local exterior edges must never collapse (same span at
  // bbox extreme). wall_length stays per-wall.
  if (dim.kind === "wall_length" || dim.kind === "external_overall" || dim.kind === "external_segment") {
    return null;
  }
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
  room_edge_clear: 2,
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
      || dim.kind === "internal_clear" || dim.kind === "room_edge_clear"
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
  // dim.orientation is only a "which delta is bigger" label (see
  // createAutoLinearDimension), NOT a guarantee the segment is truly axis
  // -aligned -- a genuinely diagonal wall_length can still be labeled
  // "horizontal" if its dx happens to exceed its dy. Verify actual
  // co-linearity before treating it as coverable by an external_overall
  // span, otherwise a diagonal wall can be wrongly stripped as "redundant".
  const dx = Math.abs(dim.p2.x - dim.p1.x);
  const dy = Math.abs(dim.p2.y - dim.p1.y);
  if (dim.orientation === "horizontal" && dy <= ALIGN_THR_MM) {
    return { axis: "h", lo: Math.min(dim.p1.x, dim.p2.x), hi: Math.max(dim.p1.x, dim.p2.x) };
  }
  if (dim.orientation === "vertical" && dx <= ALIGN_THR_MM) {
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
// room_edge_clear is the RemPlanner room-face label set; suppress wall_length
// only when it measures the same quantized endpoints as an existing room edge
// (not by coarse axis-span equality — that wiped notch wall_length).
// Never emit wall-thickness labels.
function removeWallLengthCoveredBySpans(dims) {
  const overallSpans = dims
    .filter((d) => d.kind === "external_overall")
    .map((d) => axisSpan(d))
    .filter(Boolean);
  const roomEdgeKeys = new Set(
    dims
      .filter((d) => d.kind === "room_edge_clear" || d.kind === "internal_clear")
      .map((d) => {
        const a = d.p1;
        const b = d.p2;
        if (!a || !b) return null;
        const x0 = Math.round(Math.min(a.x, b.x));
        const y0 = Math.round(Math.min(a.y, b.y));
        const x1 = Math.round(Math.max(a.x, b.x));
        const y1 = Math.round(Math.max(a.y, b.y));
        return `${x0}:${y0}:${x1}:${y1}`;
      })
      .filter(Boolean),
  );
  return dims.filter((d) => {
    if (isLikelyThicknessDim(d)) return false;
    if (d.kind !== "wall_length") return true;
    const a = d.p1;
    const b = d.p2;
    if (a && b) {
      const x0 = Math.round(Math.min(a.x, b.x));
      const y0 = Math.round(Math.min(a.y, b.y));
      const x1 = Math.round(Math.max(a.x, b.x));
      const y1 = Math.round(Math.max(a.y, b.y));
      if (roomEdgeKeys.has(`${x0}:${y0}:${x1}:${y1}`)) return false;
    }
    const span = axisSpan(d);
    if (!span) return true; // diagonal — keep unless exact room-edge match above
    return !overallSpans.some((os) => spansNearlyEqual(span, os));
  });
}

function isLikelyThicknessDim(dim) {
  if (!dim?.p1 || !dim?.p2) return false;
  const len = Number.isFinite(dim.measurementValue)
    ? dim.measurementValue
    : Math.hypot(dim.p2.x - dim.p1.x, dim.p2.y - dim.p1.y);
  return len > 0 && len <= 250 && (dim.kind === "wall_thickness" || dim.reference?.axis === "thickness");
}

// A handful of the longest surviving room-facing wall_length dimensions are
// the ones a user actually reads at a glance on Fit — promote them (same
// "important" tier as external_overall/internal_clear) so the Fit-scale
// LOD/collision pass doesn't have to choose between showing nothing and
// showing everything. Runs LAST, on the final post-suppression/post-dedupe
// set, so a wall whose length is redundant with an external_overall span
// (already removed by removeWallLengthCoveredBySpans) can never "waste" a
// promotion slot on a dimension that won't even be rendered. Short/secondary
// segments are intentionally left at the default tier and may still be
// hidden by collision, per the required LOD priority order.
function promoteLongestWallLengthDims(dims) {
  const wallLen = dims
    .filter((d) => d.kind === "wall_length")
    .map((d) => ({ dim: d, len: Math.hypot(d.p2.x - d.p1.x, d.p2.y - d.p1.y) }))
    .sort((a, b) => b.len - a.len)
    .slice(0, MAX_IMPORTANT_WALL_LENGTH_DIMS);
  for (const { dim } of wallLen) dim.style = { ...dim.style, importance: "important" };
  return dims;
}

/** Walls incident to a degree≥3 node (T / open cross) — no centreline wall_length. */
function wallIdsOnOpenJunction(walls) {
  const deg = new Map();
  for (const w of walls || []) {
    if (!w?.a || !w?.b) continue;
    deg.set(w.a, (deg.get(w.a) || 0) + 1);
    deg.set(w.b, (deg.get(w.b) || 0) + 1);
  }
  const ids = new Set();
  for (const w of walls || []) {
    if ((deg.get(w.a) || 0) >= 3 || (deg.get(w.b) || 0) >= 3) ids.add(w.id);
  }
  return ids;
}

function wallIdFromWallLengthDim(dim) {
  if (dim?.wallId) return dim.wallId;
  if (dim?.reference?.wallId) return dim.reference.wallId;
  const id = String(dim?.id || "");
  const m = id.match(/^auto-wall-len-(.+)-\d+$/);
  return m ? m[1] : null;
}

export function generateWallDimensions(plan, opts = {}) {
  const displayMode = opts.dimensionDisplayMode || "remplanner_cm";
  const walls = resolvePlanWalls(plan);
  let roomPolygons = [];
  let roomIds = [];
  let detectedRooms = [];
  try {
    detectedRooms = detectRooms(plan);
    roomPolygons = detectedRooms.map((r) => r.polygon).filter((p) => p?.length >= 3);
    roomIds = detectedRooms.map((r) => r.id || null);
  } catch {
    detectedRooms = [];
    roomPolygons = [];
    roomIds = [];
  }
  // External overall + per-room clear spans come from the SAME contour the
  // renderer draws (see renderedContours.js). The previous sources — a
  // centreline bounding box per closed loop, and a rect-cell grid with a
  // fallback thickness — produced external dimensions on inner partitions and
  // left whole rooms without a width or height.
  const contours = buildRenderedContours(plan, { rooms: detectedRooms });
  const contourDims = generateContourDimensions(contours);
  const dimensions = [
    ...contourDims.dims,
    ...generatePerWallDimensions(walls, plan?.room || {}, displayMode, roomPolygons, roomIds, plan),
    ...generateOpeningAndPierDimensions(plan, displayMode),
  ];
  const rack = generateRackAisles(plan, displayMode);
  const merged = promoteLongestWallLengthDims(
    removeWallLengthCoveredBySpans(dedupeDimensions([...dimensions, ...rack.dims])),
  );
  // Even when other rooms/envelopes exist, suppress centreline wall_length on
  // open multi-arm junctions (degree≥3) — T / open cross policy.
  const openJunctionWallIds = wallIdsOnOpenJunction(walls);
  const gated = openJunctionWallIds.size
    ? merged.filter((d) => {
      if (d.kind !== "wall_length") return true;
      const wid = wallIdFromWallLengthDim(d);
      return !(wid && openJunctionWallIds.has(wid));
    })
    : merged;
  const all = finalizeAutoDimensions(gated, {
    displayMode,
    hasRoomContours: (contours.roomContours || []).length > 0,
    hasEnvelopes: (contours.envelopes || []).length > 0,
    suppressOpenJunctionWallLength: (
      (contours.roomContours || []).length === 0
      && (contours.envelopes || []).length === 0
      && hasOpenMultiArmJunction(plan, walls)
    ),
    contours,
  });
  return {
    dimensions: all,
    validationWarnings: rack.warnings,
    contourDiagnostics: contourDims.diagnostics,
    contours,
  };
}
