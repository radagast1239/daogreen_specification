/**
 * Automatic dimensions measured from the VISIBLE wall-mass contour.
 *
 * Replaces two sources that could not be trusted:
 *
 *  - external_overall came from wallPointsBounds (a bounding box of wall
 *    CENTRELINES) offset by a single representative thickness, emitted once per
 *    closed loop found by connectivity. On a plan with four free-standing inner
 *    rectangles that produced TEN "external" overalls — eight of them measuring
 *    inner partitions while tagged joinedOuterFace — with anchors up to 100mm
 *    off the drawn face.
 *
 *  - internal_clear came from a rect-cell grid (detectRectCells) with a
 *    fallback thickness, not from rooms, so cells and rooms did not correspond:
 *    the room enclosing inner islands got no dimensions at all.
 *
 * Everything here anchors on segments returned by buildRenderedContours, i.e.
 * the exact geometry the renderer draws. There is no centreline fallback: when a
 * face pair cannot be proven, the dimension is omitted and a diagnostic is
 * emitted instead.
 *
 * Every generated dimension carries an explicit geometry model, kept separate
 * on purpose so no consumer has to reconstruct one meaning from another:
 *
 *   witnessA / witnessB     — real points ON the rendered contour; their
 *                              distance is the measurement value.
 *   measurementValue        — the value the label shows (usually, but not
 *                              always, |witnessB - witnessA|; external overalls
 *                              use the true bbox extrema instead, since mitred
 *                              corners mean no single witness pair spans the
 *                              full extent — see generateExternalOverallFromContours).
 *   baselineStart/baselineEnd — the line the dimension is actually drawn on.
 *   extensionA / extensionB — straight stubs from each witness to the baseline.
 *   labelPoint               — where the text sits.
 *
 * p1/p2/offset are kept for backward compatibility (manual dimensions, the
 * selected-wall dimension, and the existing renderer path all use them) and are
 * set to witnessA/witnessB/the signed perpendicular offset that reproduces the
 * same baseline through that legacy formula — so old and new consumers agree.
 */
import {
  CONTOUR_DIAGNOSTICS,
  distPointToSegment,
  pointInLoop,
  sampleSegmentInsidePolygon,
  segmentIntersectsWallMass,
} from "../walls/renderedContours.js";
import { FACE_REF_KINDS } from "../walls/wallFaceReferences.js";
import {
  buildDimensionGenerationKey,
  roomStableKey,
} from "./dimensionCanonicalKeys.js";
import {
  generateExternalOverallFromContours,
  generateExternalSegmentsFromContours,
  generateExteriorChainDimensions,
  exteriorChainStackOrderOk,
  EXTERNAL_OVERALL_MARGIN_MM,
  EXTERNAL_SEGMENT_MARGIN_MM,
  EXTERNAL_OVERALL_ALONE_MARGIN_MM,
} from "./exteriorChainDimensions.js";
import { generateRoomEdgeClearFromContours } from "./roomEdgeClearDimensions.js";
import { isRectangularContour } from "./contourSemantics.js";

export {
  generateExternalOverallFromContours,
  generateExternalSegmentsFromContours,
  generateExteriorChainDimensions,
  exteriorChainStackOrderOk,
  EXTERNAL_OVERALL_MARGIN_MM,
  EXTERNAL_SEGMENT_MARGIN_MM,
  EXTERNAL_OVERALL_ALONE_MARGIN_MM,
};
export { generateRoomEdgeClearFromContours };

const MIN_DIM_MM = 200;
// Internal baselines sit off the room centre in two distinct lanes so the width
// and height lines never coincide, and neither lands on the wall mass.
const INTERNAL_LANE_MM = 250;
// Progressively smaller lane offsets tried when the default doesn't clear the
// room (e.g. a narrow room where 250mm from the witness line would cross the
// opposite wall) — still deterministic, no randomness.
const INTERNAL_LANE_FALLBACKS_MM = [180, 120, 80];
// Legacy alias — overall margin now lives in exteriorChainDimensions (700mm).
const EXTERNAL_MARGIN_MM = EXTERNAL_OVERALL_MARGIN_MM;
// Candidate positions (as a fraction of the valid overlap range) tried, AFTER
// the default near-edge position (fraction 0, matching the previous fixed
// choice), for the witness line of an internal dimension when that default
// does not clear the room: room-centroid-projected fraction, then the
// documented 25%/75% split, then two positions near either end.
const LANE_FRACTIONS = [0.25, 0.75, 0.1, 0.9, 0.5];
const DEFAULT_LANE_FRACTION = 0;
// Two candidate spans within this many mm of each other are "tied" for R8's
// ambiguity check — distinct enough face pairs at nearly the same length must
// not silently pick one.
const AMBIGUOUS_SPAN_EPS_MM = 5;

function overlapRange(a0, a1, b0, b1) {
  const lo = Math.max(Math.min(a0, a1), Math.min(b0, b1));
  const hi = Math.min(Math.max(a0, a1), Math.max(b0, b1));
  return hi > lo ? { lo, hi } : null;
}

const pointInLoom = pointInLoop;

function allFillPolygons(contours) {
  const out = [];
  for (const c of contours.components || []) out.push(...(c.fillPolygons || []));
  return out;
}

/**
 * Strict current-geometry rectangle proof for room W/H (internal_clear).
 * Trapezoids, L-shapes, oblique quads and stepped rooms must return false.
 *
 * The proof itself now lives in contourSemantics.js, next to the semantic
 * classification that depends on it, so there is exactly one definition of
 * "this contour is a rectangle" in the codebase.
 */
export function isRectangularRoomContour(rc, eps) {
  return eps == null ? isRectangularContour(rc) : isRectangularContour(rc, eps);
}

/**
 * Does the straight span between two anchors stay in open room space?
 *
 * Sampled every ~20mm (not a fixed handful of points): a coarse sweep stepped
 * clean over a 100mm partition sitting just inside an anchor, which let a room
 * be measured to the FAR face of its partition — 4000 instead of its real 3900.
 */
function spanIsClear(p1, p2, fillPolygons) {
  return !segmentIntersectsWallMass(p1, p2, fillPolygons, { stepMm: 20 });
}

function candidateAtsForOverlap(ov, otherKey, centroid) {
  const range = ov.hi - ov.lo;
  const fracs = [DEFAULT_LANE_FRACTION];
  if (range > 0 && centroid && Number.isFinite(centroid[otherKey])) {
    const cf = (centroid[otherKey] - ov.lo) / range;
    if (cf > 0.02 && cf < 0.98) fracs.push(cf);
  }
  for (const f of LANE_FRACTIONS) if (!fracs.includes(f)) fracs.push(f);
  return fracs.map((f) => ov.lo + range * f);
}

/**
 * Every geometrically valid (faceA, faceB, witness line) candidate for one
 * axis of a room contour, canonically ordered (faceA is always the smaller-
 * coordinate face) so the perpendicular direction from A->B is fixed and never
 * depends on which face happened to be scanned first.
 *
 * axis "vertical"   -> the two vertical faces bounding the room horizontally
 *                      (gives clear WIDTH, an orientation:"horizontal" dim)
 * axis "horizontal" -> the two horizontal faces bounding it vertically
 *                      (gives clear HEIGHT, an orientation:"vertical" dim)
 */
function opposingPairCandidates(segments, axis, fillPolygons, centroid) {
  const faces = segments.filter((s) => s.axis === axis && s.len >= MIN_DIM_MM);
  if (faces.length < 2) return [];
  const key = axis === "vertical" ? "x" : "y";
  const other = axis === "vertical" ? "y" : "x";
  const out = [];
  for (let i = 0; i < faces.length; i++) {
    for (let j = i + 1; j < faces.length; j++) {
      const X = faces[i], Y = faces[j];
      const swap = X.mid[key] > Y.mid[key];
      const faceA = swap ? Y : X; // canonical: smaller coordinate along `key`
      const faceB = swap ? X : Y;
      const distance = faceB.mid[key] - faceA.mid[key];
      if (distance < MIN_DIM_MM) continue;
      const ov = overlapRange(faceA.a[other], faceA.b[other], faceB.a[other], faceB.b[other]);
      if (!ov) continue;
      const ats = candidateAtsForOverlap(ov, other, centroid);
      for (const at of ats) {
        const p1 = axis === "vertical" ? { x: faceA.mid.x, y: at } : { x: at, y: faceA.mid.y };
        const p2 = axis === "vertical" ? { x: faceB.mid.x, y: at } : { x: at, y: faceB.mid.y };
        if (!spanIsClear(p1, p2, fillPolygons)) continue;
        out.push({ faceA, faceB, p1, p2, distance, at, axis });
        break; // first clear lane for this face pair is enough
      }
    }
  }
  return out;
}

/**
 * Pick the primary span among candidates: the longest proven one. If two or
 * more DIFFERENT face pairs are tied for longest within AMBIGUOUS_SPAN_EPS_MM,
 * no automatic choice is defensible — report ambiguity instead of guessing.
 */
function pickPrimarySpan(candidates) {
  if (!candidates.length) return { winner: null, ambiguous: false };
  const maxDist = Math.max(...candidates.map((c) => c.distance));
  const top = candidates.filter((c) => maxDist - c.distance <= AMBIGUOUS_SPAN_EPS_MM);
  const distinctPairs = new Set(top.map((c) => `${c.faceA.id}|${c.faceB.id}`));
  if (distinctPairs.size <= 1) return { winner: top[0], ambiguous: false };
  return { winner: null, ambiguous: true };
}

/**
 * Validated perpendicular offset for an internal witness line: try both signs
 * (and, if neither clears, progressively smaller lane distances) and keep the
 * first whose ENTIRE baseline segment lies inside the room and never touches
 * the wall mass — never a fixed sign assumed from face iteration order, which
 * previously put the baseline outside the room whenever the two faces were
 * discovered in the "wrong" order.
 */
function resolveInternalBaseline(p1, p2, roomPolygon, fillPolygons) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const lanes = [INTERNAL_LANE_MM, ...INTERNAL_LANE_FALLBACKS_MM];
  for (const lane of lanes) {
    for (const sign of [1, -1]) {
      const offset = sign * lane;
      const baselineStart = { x: p1.x + nx * offset, y: p1.y + ny * offset };
      const baselineEnd = { x: p2.x + nx * offset, y: p2.y + ny * offset };
      if (!pointInLoom({ x: (baselineStart.x + baselineEnd.x) / 2, y: (baselineStart.y + baselineEnd.y) / 2 }, roomPolygon)) continue;
      if (!sampleSegmentInsidePolygon(baselineStart, baselineEnd, roomPolygon)) continue;
      if (segmentIntersectsWallMass(baselineStart, baselineEnd, fillPolygons)) continue;
      return { ok: true, offset, baselineStart, baselineEnd, normal: { x: nx, y: ny } };
    }
  }
  return { ok: false };
}

function dimension({
  id, generationKey, p1, p2, orientation, kind, referenceKind, reference, offset, style,
  witnessA, witnessB, baselineStart, baselineEnd, extensionA, extensionB,
  labelPoint, measurementValue, roomId = null, axisOrDirection = null, sourceWallIds = [],
}) {
  return {
    id,
    generationKey: generationKey || id,
    type: "dimension",
    mode: "linear",
    p1: { x: p1.x, y: p1.y },
    p2: { x: p2.x, y: p2.y },
    offset: offset ?? 0,
    offsetSide: (offset || 0) >= 0 ? 1 : -1,
    orientation,
    attachedTo: null,
    labelOverride: null,
    locked: true,
    invalid: false,
    invalidReason: null,
    auto: true,
    kind,
    style: style || { importance: "important" },
    referenceKind,
    reference,
    roomId,
    wallId: null,
    sourceWallIds,
    axisOrDirection: axisOrDirection || orientation,
    // Explicit geometry model (see module header). Populated for every
    // contour-generated dimension; absent on legacy/manual dimensions, which
    // the renderer adapter falls back to p1/p2/offset for.
    witnessA: { x: witnessA.x, y: witnessA.y },
    witnessB: { x: witnessB.x, y: witnessB.y },
    baselineStart: { x: baselineStart.x, y: baselineStart.y },
    baselineEnd: { x: baselineEnd.x, y: baselineEnd.y },
    extensionA: [{ x: extensionA.a.x, y: extensionA.a.y }, { x: extensionA.b.x, y: extensionA.b.y }],
    extensionB: [{ x: extensionB.a.x, y: extensionB.a.y }, { x: extensionB.b.x, y: extensionB.b.y }],
    labelPoint: { x: labelPoint.x, y: labelPoint.y },
    measurementValue,
  };
}

/* External overall + segment chains: see exteriorChainDimensions.js (re-exported). */

/* --------------------------------------------------------------- internal */

/**
 * Up to one clear width + one clear height per room. For a rectangular room
 * this is always exactly one of each (the single opposing face pair). For an
 * L/U-shaped or otherwise irregular room it is at most one PROVEN primary span
 * per axis: every candidate opposing face pair is tried, the longest fully
 * validated (on-contour witnesses, whole baseline inside the room, clear of
 * the wall mass and any island) wins; a tie between genuinely different face
 * pairs omits the dimension rather than guessing, via AMBIGUOUS_PRIMARY_ROOM_SPAN.
 */
export function generateInternalClearFromContours(contours) {
  const dims = [];
  const diagnostics = [];
  const fills = allFillPolygons(contours);

  for (const rc of contours.roomContours || []) {
    const segs = rc.segments || [];
    const roomKey = roomStableKey(rc);
    if (!segs.length) {
      diagnostics.push({ code: CONTOUR_DIAGNOSTICS.MISSING_RENDERED_CONTOUR, roomId: rc.roomId });
      continue;
    }
    for (const [axisKey, orientation, dimAxisLabel] of [
      ["vertical", "horizontal", "width"],
      ["horizontal", "vertical", "height"],
    ]) {
      const candidates = opposingPairCandidates(segs, axisKey, fills, rc.centroid);
      const { winner, ambiguous } = pickPrimarySpan(candidates);
      if (ambiguous) {
        diagnostics.push({
          code: CONTOUR_DIAGNOSTICS.AMBIGUOUS_PRIMARY_ROOM_SPAN, roomId: rc.roomId, axis: dimAxisLabel,
        });
        continue;
      }
      if (!winner) {
        diagnostics.push({
          code: CONTOUR_DIAGNOSTICS.NO_OPPOSITE_FACE_PAIR, roomId: rc.roomId, axis: dimAxisLabel,
        });
        continue;
      }
      const baseline = resolveInternalBaseline(winner.p1, winner.p2, rc.roomPolygon, fills);
      if (!baseline.ok) {
        diagnostics.push({
          code: CONTOUR_DIAGNOSTICS.NO_INTERNAL_DIMENSION_LANE, roomId: rc.roomId, axis: dimAxisLabel,
        });
        continue;
      }
      const sideA = winner.faceA.roomSide ? { ambiguous: false } : { ambiguous: true };
      const sideB = winner.faceB.roomSide ? { ambiguous: false } : { ambiguous: true };
      if (sideA.ambiguous || sideB.ambiguous) {
        diagnostics.push({
          code: CONTOUR_DIAGNOSTICS.AMBIGUOUS_ROOM_SIDE, roomId: rc.roomId, axis: dimAxisLabel,
        });
        continue;
      }
      const generationKey = buildDimensionGenerationKey({
        kind: "internal_clear",
        orientation,
        axis: dimAxisLabel,
        p1: winner.p1,
        p2: winner.p2,
        roomKey,
      });
      dims.push(dimension({
        id: generationKey,
        generationKey,
        p1: winner.p1,
        p2: winner.p2,
        orientation,
        kind: "internal_clear",
        referenceKind: FACE_REF_KINDS.JOINED_ROOM_FACE,
        reference: {
          kind: FACE_REF_KINDS.JOINED_ROOM_FACE,
          roomId: rc.roomId,
          componentId: rc.componentId,
          loopId: rc.loopId,
          sourceFaceA: winner.faceA.id,
          sourceFaceB: winner.faceB.id,
          matchedContourSegmentIds: [winner.faceA.id, winner.faceB.id],
          sideA: winner.faceA.roomSide,
          sideB: winner.faceB.roomSide,
          axis: dimAxisLabel,
        },
        offset: baseline.offset,
        witnessA: winner.p1,
        witnessB: winner.p2,
        baselineStart: baseline.baselineStart,
        baselineEnd: baseline.baselineEnd,
        extensionA: { a: winner.p1, b: baseline.baselineStart },
        extensionB: { a: winner.p2, b: baseline.baselineEnd },
        labelPoint: {
          x: (baseline.baselineStart.x + baseline.baselineEnd.x) / 2,
          y: (baseline.baselineStart.y + baseline.baselineEnd.y) / 2,
        },
        measurementValue: winner.distance,
        roomId: rc.roomId || null,
        axisOrDirection: dimAxisLabel,
      }));
    }
  }
  return { dims, diagnostics };
}

/** Everything automatic that is derived from the drawn contour. */
export function generateContourDimensions(contours) {
  const ext = generateExteriorChainDimensions(contours);
  // RemPlanner contract: dimension each meaningful room-facing edge near that
  // edge. Opposing-pair internal_clear is a rectangle-only fallback when a room
  // produces no edge dims — never for trapezoid / L / oblique rooms.
  const edge = generateRoomEdgeClearFromContours(contours);
  const roomsWithEdges = new Set(
    edge.dims.map((d) => d.roomId || d.reference?.roomId).filter(Boolean),
  );
  const int = generateInternalClearFromContours(contours);
  // PHASE 2F1 blocker A: the fallback is allowed ONLY on a proven rectangle,
  // where the opposing-face span IS the perpendicular edge length. On a
  // trapezoid / L / oblique / stepped room the same span is a bounding box, and
  // a bounding box is not a room dimension however few other dimensions exist.
  const rectangularRoomIds = new Set(
    (contours.roomContours || [])
      .filter((rc) => isRectangularContour(rc))
      .map((rc) => rc.roomId || rc.regionId)
      .filter(Boolean),
  );
  const fallbackDiagnostics = [];
  const intFallback = int.dims.filter((d) => {
    const rid = d.roomId || d.reference?.roomId;
    if (!rid || roomsWithEdges.has(rid)) return false;
    if (rectangularRoomIds.has(rid)) return true;
    fallbackDiagnostics.push({
      code: CONTOUR_DIAGNOSTICS.NON_RECTANGULAR_ROOM_SKIP_CLEAR,
      roomId: rid,
      axis: d.axisOrDirection || d.orientation,
      reason: "bounding_box_span_is_not_a_room_edge",
    });
    return false;
  });
  return {
    dims: [...ext.dims, ...edge.dims, ...intFallback],
    diagnostics: [
      ...(contours.diagnostics || []),
      ...ext.diagnostics,
      ...edge.diagnostics,
      ...int.diagnostics,
      ...fallbackDiagnostics,
    ],
  };
}

/** Verification helper used by tests and the browser evidence run. */
export function auditAnchorsOnContour(dims, contours, eps = 1.5) {
  const out = [];
  for (const d of dims) {
    const ids = d.reference?.matchedContourSegmentIds || [];
    const segs = [];
    for (const c of contours.components || []) {
      for (const s of c.boundarySegments) if (ids.includes(s.id)) segs.push(s);
    }
    const nearest = (pt) => {
      let best = Infinity;
      for (const c of contours.components || []) {
        for (const s of c.boundarySegments) {
          const dd = distPointToSegment(pt, s.a, s.b);
          if (dd < best) best = dd;
        }
      }
      return best;
    };
    out.push({
      id: d.id,
      kind: d.kind,
      referenceKind: d.referenceKind,
      roomId: d.reference?.roomId ?? null,
      matchedContourSegmentIds: ids,
      p1DistanceToContour: nearest(d.p1),
      p2DistanceToContour: nearest(d.p2),
      onContour: nearest(d.p1) <= eps && nearest(d.p2) <= eps,
      matchedSegmentsFound: segs.length,
    });
  }
  return out;
}
