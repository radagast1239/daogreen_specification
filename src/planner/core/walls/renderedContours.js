/**
 * Single source of truth for the VISIBLE wall-mass contours.
 *
 * Both the renderer and the automatic dimension generator must measure the same
 * geometry the user sees. Previously they did not: wallRender built the unified
 * mass via buildWallMassGeometry, while the dimension generator derived its own
 * offset faces from centreline bounding boxes and a representative thickness.
 * That is why a dimension could be tagged joinedOuterFace while its anchor sat
 * 100mm off the drawn face, why every closed loop (including free-standing inner
 * rectangles) produced its own "external" overall, and why the facade was cut up
 * by internal partitions.
 *
 * This module wraps exactly the renderer's pipeline
 * (wallGeometryMap -> buildWallMassGeometry) and adds the classification the
 * dimension generator needs: a nesting tree over the loops, which outer loops
 * are real building envelopes (depth 0), and which visible hole loop belongs to
 * which detected room.
 *
 * Nothing here re-offsets, re-miters or re-derives geometry. Every vertex
 * returned is a vertex the renderer draws.
 */
import { wallGeometryMap } from "../../buildWallGeometry.js";
import { buildWallMassGeometry } from "./wallMass.js";
import { weldWallNodes } from "./wallOps.js";
import { resolvePlanWalls } from "../../wallNetwork.js";
import { detectRooms } from "../rooms/detectRooms.js";

export const CONTOUR_EPS_MM = 1.5;

export const CONTOUR_DIAGNOSTICS = Object.freeze({
  MISSING_RENDERED_CONTOUR: "MISSING_RENDERED_CONTOUR",
  ROOM_CONTOUR_UNMATCHED: "ROOM_CONTOUR_UNMATCHED",
  NO_OPPOSITE_FACE_PAIR: "NO_OPPOSITE_FACE_PAIR",
  AMBIGUOUS_ROOM_SIDE: "AMBIGUOUS_ROOM_SIDE",
  INVALID_EXTERNAL_ENVELOPE: "INVALID_EXTERNAL_ENVELOPE",
  TOPOLOGY_REGION_MISMATCH: "TOPOLOGY_REGION_MISMATCH",
  NO_INTERNAL_DIMENSION_LANE: "NO_INTERNAL_DIMENSION_LANE",
  AMBIGUOUS_PRIMARY_ROOM_SPAN: "AMBIGUOUS_PRIMARY_ROOM_SPAN",
  EXTERIOR_LOOP_DUPLICATE: "EXTERIOR_LOOP_DUPLICATE",
  EXTERIOR_NO_BBOX: "EXTERIOR_NO_BBOX",
  EXTERIOR_SEG_REJECTED: "EXTERIOR_SEG_REJECTED",
  EXTERIOR_SEG_KEEP_NON_RECT: "EXTERIOR_SEG_KEEP_NON_RECT",
  EXTERIOR_SEG_SUPPRESSED_RECT_DUPE: "EXTERIOR_SEG_SUPPRESSED_RECT_DUPE",
  NON_RECTANGULAR_ROOM_SKIP_CLEAR: "NON_RECTANGULAR_ROOM_SKIP_CLEAR",
  ROOM_EDGE_MIDPOINT_OUTSIDE: "ROOM_EDGE_MIDPOINT_OUTSIDE",
  // PHASE 2F1 — an overall may only be a physical exterior face to physical
  // exterior face distance; a bbox extent of an irregular contour is not one.
  EXTERIOR_OVERALL_NO_PHYSICAL_FACE_PAIR: "EXTERIOR_OVERALL_NO_PHYSICAL_FACE_PAIR",
  ROOM_BOUNDING_BOX_SEMANTICS_REJECTED: "ROOM_BOUNDING_BOX_SEMANTICS_REJECTED",
});

/**
 * Stable fingerprint of a visible region, used to name regions that have no
 * topology room behind them. Deliberately geometric, so it survives wall-array
 * reordering and re-renders.
 */
export function regionFingerprint(bbox) {
  return [
    Math.round(bbox.x0), Math.round(bbox.y0),
    Math.round(bbox.x1), Math.round(bbox.y1),
  ].join(":");
}

/**
 * Do two axis-aligned wall centrelines cross without sharing a node?
 * That is the shape which makes detectRooms report one room where the drawn mass
 * plainly encloses several, so it is reported rather than silently absorbed.
 */
export function findUnnodedCrossings(walls = []) {
  const out = [];
  const seg = (w) => (w.pts?.length >= 2 ? [w.pts[0], w.pts[w.pts.length - 1]] : null);
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const A = seg(walls[i]);
      const B = seg(walls[j]);
      if (!A || !B) continue;
      if (walls[i].a === walls[j].a || walls[i].a === walls[j].b
        || walls[i].b === walls[j].a || walls[i].b === walls[j].b) continue; // shares a node
      const hit = properIntersection(A[0], A[1], B[0], B[1]);
      if (hit) out.push({ wallIds: [walls[i].id, walls[j].id], at: hit });
    }
  }
  return out;
}

function properIntersection(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / den;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / den;
  const EPS = 1e-6;
  // strictly interior to BOTH segments -> a real crossing, not a shared endpoint
  if (t <= EPS || t >= 1 - EPS || u <= EPS || u >= 1 - EPS) return null;
  return { x: p1.x + d1x * t, y: p1.y + d1y * t };
}

/**
 * Reconcile topology rooms against visible regions.
 *
 * Rendered regions decide visible geometry; topology rooms own identity, name,
 * metadata, area and persistence. When the counts disagree the mismatch is
 * surfaced, never papered over: a region with no room behind it must not be
 * dressed up with an invented roomId.
 */
export function reconcileRegionsWithRooms(regions = [], rooms = [], walls = []) {
  const matched = [];
  // Track claimed rooms by INDEX, not by id: detectRooms can return rooms whose
  // id is undefined, and a Set keyed on that let the first undefined block every
  // later room, so one room appeared to swallow all four regions.
  const usedRoomIdx = new Set();
  const unmatchedRegions = [];
  const roomIdAt = (r, i) => r?.id
    // Same scheme detectRooms uses internally, so an id-less detected room still
    // gets a stable identity derived from its own geometry (not an invented one).
    || `rm@${regionFingerprint(loopBBox(r?.polygon || []))}#${i}`;

  for (const region of regions) {
    const probe = interiorProbe(region.loop);
    const regionArea = Math.abs(polygonSignedArea(region.loop));
    // Room polygons reach wall centrelines and therefore overlap slightly, so a
    // probe can fall inside more than one. Prefer the room whose area is closest
    // to the region's: a first-match would let one room swallow every region.
    let room = null;
    let roomIdx = -1;
    let bestDelta = Infinity;
    (rooms || []).forEach((r, i) => {
      const poly = r?.polygon || [];
      if (poly.length < 3 || usedRoomIdx.has(i)) return;
      if (!pointInLoop(probe, poly)) return;
      const delta = Math.abs(Math.abs(polygonSignedArea(poly)) - regionArea);
      if (delta < bestDelta) { bestDelta = delta; room = r; roomIdx = i; }
    });
    if (room) {
      usedRoomIdx.add(roomIdx);
      matched.push({
        regionId: region.id,
        roomId: roomIdAt(room, roomIdx),
        fingerprint: regionFingerprint(region.bbox),
      });
    } else {
      unmatchedRegions.push({
        regionId: region.id,
        fingerprint: regionFingerprint(region.bbox),
        bbox: region.bbox,
      });
    }
  }
  const unmatchedRooms = (rooms || [])
    .map((r, i) => (usedRoomIdx.has(i) ? null : roomIdAt(r, i)))
    .filter(Boolean);

  const crossings = findUnnodedCrossings(walls);
  const diagnostics = [];
  if (unmatchedRegions.length || unmatchedRooms.length) {
    diagnostics.push({
      code: CONTOUR_DIAGNOSTICS.TOPOLOGY_REGION_MISMATCH,
      detectedRoomCount: (rooms || []).length,
      renderedRegionCount: regions.length,
      unmatchedRoomIds: unmatchedRooms,
      unmatchedRegionFingerprints: unmatchedRegions.map((r) => r.fingerprint),
      geometricCrossingCount: crossings.length,
      missingTopologyNodes: crossings.map((c) => c.at),
      affectedWallIds: [...new Set(crossings.flatMap((c) => c.wallIds))],
    });
  }
  return { matched, unmatchedRooms, unmatchedRegions, crossings, diagnostics };
}

/* ------------------------------------------------------------------ geometry */

export function polygonSignedArea(loop = []) {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % loop.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function loopBBox(loop = []) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of loop) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

export function pointInLoop(pt, loop = []) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const xi = loop[i].x, yi = loop[i].y, xj = loop[j].x, yj = loop[j].y;
    if (((yi > pt.y) !== (yj > pt.y))
      && (pt.x < ((xj - xi) * (pt.y - yi)) / ((yj - yi) || 1e-9) + xi)) inside = !inside;
  }
  return inside;
}

export function distPointToSegment(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const L2 = vx * vx + vy * vy;
  if (L2 < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
}

/* --------------------------------------------------------- shared safety helpers */

/**
 * Does the closed segment [a,b] stay inside `polygon` for its whole length?
 *
 * Deterministic, no randomness: samples every ~`stepMm`, always including both
 * endpoints. A point exactly on the polygon boundary is NOT treated as a safe
 * interior sample — dimension baselines must clear the boundary, not merely
 * touch it, per the "no partial exit" contract for internal baselines.
 */
export function sampleSegmentInsidePolygon(a, b, polygon, { stepMm = 20, epsilon = 0.5 } = {}) {
  if (!polygon || polygon.length < 3) return false;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(len / stepMm));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const atEndpoint = i === 0 || i === steps;
    const onBoundary = epsilon > 0 && distanceToLoopBoundary(p, polygon) < epsilon;
    // A dimension's baseline endpoint legitimately sits ON the room face its
    // extension line runs to — allow that unconditionally there. Standard
    // ray-casting point-in-polygon is also ASYMMETRIC on the boundary itself
    // (a point exactly on the polygon's "far" edge from the cast ray tests as
    // outside, one on the "near" edge tests as inside), so checking
    // pointInLoop first at an endpoint would reject some legitimate faces
    // depending on which side of the room they're on.
    if (atEndpoint && onBoundary) continue;
    if (!pointInLoop(p, polygon)) return false;
    // a NON-endpoint sample must not merely graze the boundary either
    if (onBoundary) return false;
  }
  return true;
}

function distanceToLoopBoundary(p, loop) {
  let best = Infinity;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const d = distPointToSegment(p, loop[j], loop[i]);
    if (d < best) best = d;
  }
  return best;
}

/** Does [a,b] pass through the interior of any of the given solid polygons? */
export function segmentIntersectsWallMass(a, b, fillPolygons = [], { stepMm = 20 } = {}) {
  if (!fillPolygons.length) return false;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(len / stepMm));
  const skip = Math.min(0.02, 2 / (len || 1)); // ignore only a hair at the endpoints
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (t < skip || t > 1 - skip) continue;
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    for (const poly of fillPolygons) if (pointInLoop(p, poly)) return true;
  }
  return false;
}

/** Alias kept distinct from segmentIntersectsWallMass: islands are also fill
 * polygons (free-standing wall bodies inside a room), but naming the check
 * separately documents intent at call sites per the required helper surface. */
export function segmentIntersectsIslands(a, b, islandPolygons = [], opts) {
  return segmentIntersectsWallMass(a, b, islandPolygons, opts);
}

/** Total length of [a,b] that lies OUTSIDE `polygon` (0 = fully inside). */
export function segmentInteriorLengthInPolygon(a, b, polygon, { stepMm = 20 } = {}) {
  if (!polygon || polygon.length < 3) return Math.hypot(b.x - a.x, b.y - a.y);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-6) return 0;
  const steps = Math.max(1, Math.ceil(len / stepMm));
  let outsideSteps = 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    if (!pointInLoop(p, polygon)) outsideSteps += 1;
  }
  return (outsideSteps / steps) * len;
}

/** Is `pt` within `epsilon` of a rendered boundary segment in this contour result? */
export function pointOnRenderedContour(pt, contours, epsilon = CONTOUR_EPS_MM) {
  let best = Infinity;
  for (const c of contours?.components || []) {
    for (const s of c.boundarySegments || []) {
      const d = distPointToSegment(pt, s.a, s.b);
      if (d < best) best = d;
    }
  }
  return best <= epsilon;
}

function containsBox(outer, inner, pad = 1) {
  if (!outer || !inner) return false;
  return outer.x0 - pad <= inner.x0 && outer.y0 - pad <= inner.y0
    && outer.x1 + pad >= inner.x1 && outer.y1 + pad >= inner.y1
    && (outer.w * outer.h) > (inner.w * inner.h);
}

function loopCentroid(loop = []) {
  let x = 0, y = 0;
  for (const p of loop) { x += p.x; y += p.y; }
  return { x: x / (loop.length || 1), y: y / (loop.length || 1) };
}

/** A representative interior point of a loop (centroid, else an edge-offset probe). */
function interiorProbe(loop) {
  const c = loopCentroid(loop);
  if (pointInLoop(c, loop)) return c;
  const bb = loopBBox(loop);
  for (let i = 1; i < 12; i++) {
    const p = { x: bb.x0 + (bb.w * i) / 12, y: bb.y0 + bb.h / 2 };
    if (pointInLoop(p, loop)) return p;
  }
  return c;
}

/**
 * Merge the mass's undirected boundary edges into maximal straight faces.
 *
 * boundaryEdges is the authoritative rendered set — wallRender strokes exactly
 * these. The stitched outerLoops/holeLoops are NOT usable as a measuring source:
 * stitchLoops traces bounded planar faces and deliberately drops the unbounded
 * one, so a building's OUTER face never appears there (a plain 8x6m rectangle
 * yields only its inner 7900x5900 loop). Measuring from edges avoids that
 * entirely and keeps every vertex identical to what is drawn.
 */
export function mergeCollinearEdges(edges = [], idPrefix = "s") {
  const LINE_Q = 4;
  // Edges are grouped by DIRECTION, then clustered by how close their lines are
  // TO EACH OTHER.
  //
  // The offset (dx*y - dy*x) is a line's perpendicular distance from the world
  // ORIGIN, so bucketing it absolutely made the grouping depend on where the
  // building sits: translating an identical plan re-bucketed edges and changed
  // the merged segment count (metrology gate, §11 off-origin case). Under a
  // translation every offset in one direction group shifts by the same amount,
  // so offset DIFFERENCES — and therefore proximity clustering — are invariant.
  const byDirection = new Map();
  for (const e of edges) {
    const dxr = e.b.x - e.a.x, dyr = e.b.y - e.a.y;
    const len = Math.hypot(dxr, dyr);
    if (len < 1e-6) continue;
    let dx = dxr / len, dy = dyr / len;
    if (dx < -1e-9 || (Math.abs(dx) < 1e-9 && dy < 0)) { dx = -dx; dy = -dy; }
    const dirKey = `${Math.round(dx * 1e4)}_${Math.round(dy * 1e4)}`;
    if (!byDirection.has(dirKey)) byDirection.set(dirKey, []);
    byDirection.get(dirKey).push({ e, dx, dy, offset: dx * e.a.y - dy * e.a.x });
  }
  const lines = new Map();
  let lineSeq = 0;
  for (const [dirKey, items] of byDirection) {
    items.sort((p, q) => p.offset - q.offset);
    let currentKey = null;
    let currentOffset = null;
    for (const it of items) {
      if (currentKey == null || Math.abs(it.offset - currentOffset) > LINE_Q) {
        currentKey = `${dirKey}_${lineSeq++}`;
        currentOffset = it.offset;
        lines.set(currentKey, {
          dx: it.dx, dy: it.dy, anchor: { x: it.e.a.x, y: it.e.a.y }, spans: [],
        });
      }
      const L = lines.get(currentKey);
      const ta = L.dx * (it.e.a.x - L.anchor.x) + L.dy * (it.e.a.y - L.anchor.y);
      const tb = L.dx * (it.e.b.x - L.anchor.x) + L.dy * (it.e.b.y - L.anchor.y);
      L.spans.push([Math.min(ta, tb), Math.max(ta, tb)]);
    }
  }
  const out = [];
  let i = 0;
  for (const L of lines.values()) {
    L.spans.sort((p, q) => p[0] - q[0]);
    let cur = null;
    const flush = () => {
      if (!cur) return;
      const a = { x: L.anchor.x + L.dx * cur[0], y: L.anchor.y + L.dy * cur[0] };
      const b = { x: L.anchor.x + L.dx * cur[1], y: L.anchor.y + L.dy * cur[1] };
      out.push(makeSegment(a, b, `${idPrefix}#${i++}`));
      cur = null;
    };
    for (const s of L.spans) {
      if (!cur) { cur = [...s]; continue; }
      if (s[0] <= cur[1] + 0.5) cur[1] = Math.max(cur[1], s[1]);
      else { flush(); cur = [...s]; }
    }
    flush();
  }
  return out;
}

function makeSegment(a, b, id) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = Math.hypot(dx, dy) || 1;
  const axis = Math.abs(dx) > Math.abs(dy)
    ? (Math.abs(dy) / L < 0.02 ? "horizontal" : "diagonal")
    : (Math.abs(dx) / L < 0.02 ? "vertical" : "diagonal");
  return {
    id,
    a: { x: a.x, y: a.y },
    b: { x: b.x, y: b.y },
    len: L,
    axis,
    dir: { x: dx / L, y: dy / L },
    normal: { x: -dy / L, y: dx / L },
    mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
  };
}

/**
 * Split a closed loop into segments, merging consecutive collinear ones so a
 * straight face that the stitcher emitted in pieces is measured as one face.
 */
export function loopToSegments(loop = [], idPrefix = "s", angleTolDeg = 0.75) {
  if (loop.length < 2) return [];
  const raw = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    raw.push({ a: { ...a }, b: { ...b }, len });
  }
  if (!raw.length) return [];
  const tol = (angleTolDeg * Math.PI) / 180;
  const dirOf = (s) => Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x);
  const merged = [];
  for (const s of raw) {
    const prev = merged[merged.length - 1];
    if (prev) {
      let d = Math.abs(dirOf(prev) - dirOf(s));
      while (d > Math.PI) d = Math.abs(d - 2 * Math.PI);
      const touching = Math.hypot(prev.b.x - s.a.x, prev.b.y - s.a.y) < 1e-6;
      if (touching && d <= tol) {
        prev.b = { ...s.b };
        prev.len = Math.hypot(prev.b.x - prev.a.x, prev.b.y - prev.a.y);
        continue;
      }
    }
    merged.push({ a: { ...s.a }, b: { ...s.b }, len: s.len });
  }
  // the loop wraps: last and first may also be collinear
  if (merged.length > 2) {
    const first = merged[0], last = merged[merged.length - 1];
    let d = Math.abs(dirOf(first) - dirOf(last));
    while (d > Math.PI) d = Math.abs(d - 2 * Math.PI);
    if (Math.hypot(last.b.x - first.a.x, last.b.y - first.a.y) < 1e-6 && d <= tol) {
      first.a = { ...last.a };
      first.len = Math.hypot(first.b.x - first.a.x, first.b.y - first.a.y);
      merged.pop();
    }
  }
  return merged.map((s, i) => {
    const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
    const L = Math.hypot(dx, dy) || 1;
    const axis = Math.abs(dx) > Math.abs(dy)
      ? (Math.abs(dy) / L < 0.02 ? "horizontal" : "diagonal")
      : (Math.abs(dx) / L < 0.02 ? "vertical" : "diagonal");
    return {
      id: `${idPrefix}#${i}`,
      a: s.a,
      b: s.b,
      len: s.len,
      axis,
      dir: { x: dx / L, y: dy / L },
      normal: { x: -dy / L, y: dx / L },
      mid: { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 },
    };
  });
}

const ROOM_FACE_PROBE_MM = 10;
const ROOM_FACE_MIN_MM = 150;

/**
 * The sub-spans of a rendered face that look into `poly`.
 *
 * Side is decided by stepping off the face along its own normal and testing the
 * room polygon — inward normal + point-in-polygon, never wall a->b direction,
 * walls[] order or bbox proximity. Endpoints are refined by bisection so the
 * returned face ends exactly where the room does.
 */
export function clipSegmentToRoom(seg, poly, fills = [], probe = ROOM_FACE_PROBE_MM) {
  const at = (t) => ({ x: seg.a.x + (seg.b.x - seg.a.x) * t, y: seg.a.y + (seg.b.y - seg.a.y) * t });
  const inAnyFill = (p) => fills.some((q) => pointInLoop(p, q));
  // A face looks into a room only if the point just off it is open room space.
  // detectRooms' polygons reach the partition CENTRELINE, so polygon containment
  // alone would also accept the partition's far face (giving a room 4000 instead
  // of 3900). Requiring the probe point to be outside every wall body picks the
  // face that genuinely bounds this room.
  const openInRoom = (p) => pointInLoop(p, poly) && !inAnyFill(p);
  const sideAt = (t) => {
    const p = at(t);
    const plus = openInRoom({ x: p.x + seg.normal.x * probe, y: p.y + seg.normal.y * probe });
    const minus = openInRoom({ x: p.x - seg.normal.x * probe, y: p.y - seg.normal.y * probe });
    if (plus === minus) return 0;
    return plus ? 1 : -1;
  };
  const steps = Math.max(8, Math.min(400, Math.ceil(seg.len / 25)));
  const samples = [];
  for (let i = 0; i <= steps; i++) samples.push({ t: i / steps, s: sideAt(i / steps) });

  // refine a transition between two sample points
  const edgeT = (t0, t1, want) => {
    let lo = t0, hi = t1;
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (sideAt(mid) === want) lo = mid; else hi = mid;
    }
    return lo;
  };

  const out = [];
  let i = 0;
  let n = 0;
  while (i <= steps) {
    const side = samples[i].s;
    if (side === 0) { i += 1; continue; }
    let j = i;
    while (j + 1 <= steps && samples[j + 1].s === side) j += 1;
    // extend the run outward to the true boundary
    let t0 = samples[i].t;
    let t1 = samples[j].t;
    if (i > 0) t0 = edgeT(samples[i].t, samples[i - 1].t, side);
    if (j < steps) t1 = edgeT(samples[j].t, samples[j + 1].t, side);
    const a = at(Math.min(t0, t1));
    const b = at(Math.max(t0, t1));
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len >= ROOM_FACE_MIN_MM) {
      const sub = makeSegment(a, b, `${seg.id}/r${n++}`);
      out.push({
        ...sub,
        parentSegmentId: seg.id,
        componentId: seg.componentId,
        roomSide: side > 0 ? "normal+" : "normal-",
        inwardNormal: side > 0 ? { ...seg.normal } : { x: -seg.normal.x, y: -seg.normal.y },
      });
    }
    i = j + 1;
  }
  return out;
}

/* -------------------------------------------------------------- main builder */

/**
 * @param {object} plan
 * @param {{rooms?: Array}} [opts] pass already-detected rooms to avoid re-running detection
 */
export function buildRenderedContours(plan, opts = {}) {
  const diagnostics = [];
  const resolved = resolvePlanWalls(plan);
  const walls = weldWallNodes(resolved);
  if (!walls.length) {
    return { components: [], envelopes: [], roomContours: [], loops: [], diagnostics, walls: [] };
  }

  // EXACTLY the renderer's pipeline — see wallRender.jsx WallMassLayer.
  const geom = wallGeometryMap(walls, plan?.room || null);
  const masses = buildWallMassGeometry(geom.polygons, geom.expandedWalls || walls);
  if (!masses.length) {
    diagnostics.push({ code: CONTOUR_DIAGNOSTICS.MISSING_RENDERED_CONTOUR, detail: "no wall mass" });
    return { components: [], envelopes: [], roomContours: [], loops: [], diagnostics, walls };
  }

  // ---- flatten every loop, keep provenance
  const loops = [];
  masses.forEach((mass, ci) => {
    (mass.outerLoops || []).forEach((loop, li) => loops.push({
      id: `c${ci}o${li}`, componentIndex: ci, role: "outer", loop,
      area: Math.abs(polygonSignedArea(loop)), bbox: loopBBox(loop), probe: interiorProbe(loop),
    }));
    (mass.holeLoops || []).forEach((loop, li) => loops.push({
      id: `c${ci}h${li}`, componentIndex: ci, role: "hole", loop,
      area: Math.abs(polygonSignedArea(loop)), bbox: loopBBox(loop), probe: interiorProbe(loop),
    }));
  });

  // ---- nesting depth across ALL loops (a room inside a wall island inside a
  // room must not be mistaken for a building envelope)
  for (const l of loops) {
    let depth = 0;
    for (const o of loops) {
      if (o === l) continue;
      if (o.area > l.area && pointInLoop(l.probe, o.loop)) depth += 1;
    }
    l.nestingDepth = depth;
  }

  // ---- components: measured from the rendered boundary edges
  const components = masses.map((mass, ci) => {
    const mine = loops.filter((l) => l.componentIndex === ci);
    const edges = mass.boundaryEdges || [];
    const boundarySegments = mergeCollinearEdges(edges, `c${ci}`)
      .map((s) => ({ ...s, componentId: `comp${ci}` }));
    const pts = edges.flatMap((e) => [e.a, e.b]);
    return {
      id: `comp${ci}`,
      index: ci,
      wallIds: mass.sourceWallIds || [],
      outerLoops: mine.filter((l) => l.role === "outer"),
      holeLoops: mine.filter((l) => l.role === "hole"),
      boundarySegments,
      boundaryEdges: edges,
      fillPolygons: mass.fillPolygons || [],
      bbox: pts.length ? loopBBox(pts) : null,
      holeCount: mass.holeCount,
    };
  });

  /**
   * Nesting at COMPONENT level: a component whose extent sits inside another
   * component's extent is an interior island (a rectangle drawn inside a room),
   * never a building. Only outermost components are envelopes, so inner
   * rectangles cannot produce external overall dimensions. Two genuinely
   * separate buildings are both outermost and each keeps its own pair.
   */
  const withBox = components.filter((c) => c.bbox);
  for (const c of withBox) {
    c.nestingDepth = withBox.filter((o) => o !== c && containsBox(o.bbox, c.bbox)).length;
  }
  const envelopes = withBox
    // A building envelope must actually enclose space. An isolated open wall (or
    // an L of two walls) is outermost but encloses nothing, and must not receive
    // overall dimensions.
    .filter((c) => c.nestingDepth === 0 && (c.holeCount || 0) >= 1)
    .sort((a, b) => (b.bbox.w * b.bbox.h) - (a.bbox.w * a.bbox.h))
    .map((c) => ({
      id: `${c.id}-env`,
      componentId: c.id,
      loop: c.boundarySegments.map((s) => s.a),
      bbox: c.bbox,
      // Only the faces that actually lie on the extremes of the drawn envelope.
      segments: c.boundarySegments,
    }));
  if (!envelopes.length) {
    diagnostics.push({
      code: CONTOUR_DIAGNOSTICS.INVALID_EXTERNAL_ENVELOPE,
      detail: "no outermost wall-mass component",
    });
  }

  // ---- room -> visible contour
  let rooms = opts.rooms;
  if (!Array.isArray(rooms)) {
    try { rooms = detectRooms(plan); } catch { rooms = []; }
  }
  const allFills = components.flatMap((c) => c.fillPolygons || []);

  /**
   * Room contours come from the mass's HOLE loops, not from detectRooms polygons.
   *
   * Two reasons, both load-bearing:
   *  - a hole loop is the exact drawn inner contour (a 3900x2400 clear cell sits
   *    at 50,50 — precisely the inner faces), whereas detectRooms polygons reach
   *    the partition CENTRELINE and so cannot decide which side of a partition
   *    bounds the room;
   *  - hole loops exist from the rendered geometry alone. detectRooms needs wall
   *    topology, so on a plan whose partitions CROSS without a shared node it
   *    reports one room where the mass plainly encloses four, and every one of
   *    those rooms silently lost its width and height.
   *
   * A detected room id is attached when one matches, so dimensions stay tied to
   * room identity wherever identity exists.
   */
  // An interior region is any stitched loop strictly inside its component's drawn
  // extent. Do NOT rely on the outer/hole label alone: for a plain ring
  // stitchLoops can still emit ambiguous roles, and some clear cells are only
  // recoverable via bbox nesting. Dedupe by geometry relative to the component
  // bbox (not absolute world rounds) so opposite windings / translations do not
  // invent a phantom room (Phase 2F1-M2).
  const compById = new Map(components.map((c) => [c.index, c]));
  const seenRegion = new Set();
  const uniqueHoles = [];
  for (const l of loops) {
    const comp = compById.get(l.componentIndex);
    if (!comp?.bbox) continue;
    const inside = containsBox(comp.bbox, l.bbox, 2);
    if (!inside) continue; // this loop IS the outer boundary
    // Outer mass loops — and equal-area opposite windings mislabeled as
    // "hole" — hug the component bbox (inset ≈ 0). Under large translation FP
    // can make that twin look 1–2mm inside containsBox and become a phantom
    // room (Phase 2F1-M2). Real clear cells are inset by ~wall thickness.
    const inset = Math.min(
      l.bbox.x0 - comp.bbox.x0,
      l.bbox.y0 - comp.bbox.y0,
      comp.bbox.x1 - l.bbox.x1,
      comp.bbox.y1 - l.bbox.y1,
    );
    if (inset < 10) continue;
    // Scope by component: identical clear cells in different masses share the
    // same relative bbox and must not collapse into one global key.
    const key = [
      l.componentIndex,
      Math.round(l.bbox.x0 - comp.bbox.x0),
      Math.round(l.bbox.y0 - comp.bbox.y0),
      Math.round(l.bbox.x1 - comp.bbox.x0),
      Math.round(l.bbox.y1 - comp.bbox.y0),
    ].join("|");
    if (seenRegion.has(key)) continue;
    seenRegion.add(key);
    uniqueHoles.push(l);
  }

  // A room is a MINIMAL enclosed region. Stitching can also return a loop that
  // spans the whole interior of a subdivided building; measuring that as well
  // would add a phantom "room" the size of the envelope on top of the real ones.
  const minimalHoles = uniqueHoles.filter((h) => !uniqueHoles.some(
    (o) => o !== h && o.area < h.area && pointInLoop(o.probe, h.loop),
  ));

  const roomContours = [];
  minimalHoles.forEach((hole, hi) => {
    const segments = loopToSegments(hole.loop, hole.id).map((s) => ({
      ...s,
      loopId: hole.id,
      componentId: `comp${hole.componentIndex}`,
      // The loop bounds open space, so "into the room" is simply the side the
      // interior probe lies on.
      roomSide: pointInLoop(
        { x: s.mid.x + s.normal.x * ROOM_FACE_PROBE_MM, y: s.mid.y + s.normal.y * ROOM_FACE_PROBE_MM },
        hole.loop,
      ) ? "normal+" : "normal-",
    }));
    if (segments.length < 4) {
      diagnostics.push({
        code: CONTOUR_DIAGNOSTICS.MISSING_RENDERED_CONTOUR,
        loopId: hole.id,
        detail: "hole loop has too few faces to measure",
      });
      return;
    }
    roomContours.push({
      // Identity is attached below, from the single reconciliation pass. No
      // invented identity: a visible region with no topology room behind it keeps
      // roomId null, so its measurement can never be presented as a fully-fledged
      // room dimension.
      roomId: null,
      regionId: hole.id,
      fingerprint: regionFingerprint(hole.bbox),
      anonymous: true,
      detectedRoomId: null,
      roomPolygon: hole.loop,
      roomArea: hole.area,
      componentId: `comp${hole.componentIndex}`,
      loopId: hole.id,
      loop: hole.loop,
      bbox: hole.bbox,
      nestingDepth: hole.nestingDepth,
      segments,
      centroid: hole.probe,
    });
  });

  // Visible regions vs topology rooms: surface any disagreement instead of
  // letting the extra regions look like real rooms.
  const reconciliation = reconcileRegionsWithRooms(
    roomContours.map((rc) => ({ id: rc.regionId, loop: rc.loop, bbox: rc.bbox })),
    rooms || [],
    walls,
  );
  diagnostics.push(...reconciliation.diagnostics);

  // Single source of identity: only regions the reconciliation actually matched
  // receive a roomId.
  const idByRegion = new Map(reconciliation.matched.map((m) => [m.regionId, m.roomId]));
  for (const rc of roomContours) {
    const roomId = idByRegion.get(rc.regionId) ?? null;
    rc.roomId = roomId;
    rc.detectedRoomId = roomId;
    rc.anonymous = roomId == null;
  }

  return {
    components, envelopes, roomContours, loops, diagnostics, walls,
    reconciliation,
    detectedRoomCount: (rooms || []).length,
    renderedRegionCount: roomContours.length,
  };
}

/** Nearest rendered boundary segment to a point, across the whole result. */
export function nearestRenderedSegment(pt, contours) {
  let best = null;
  for (const comp of contours.components || []) {
    for (const s of comp.boundarySegments) {
      const d = distPointToSegment(pt, s.a, s.b);
      if (!best || d < best.distance) best = { segment: s, distance: d };
    }
  }
  return best;
}

/** True when the anchor sits on a drawn face (not merely near some offset line). */
export function anchorOnRenderedContour(pt, contours, eps = CONTOUR_EPS_MM) {
  const hit = nearestRenderedSegment(pt, contours);
  return !!hit && hit.distance <= eps;
}
