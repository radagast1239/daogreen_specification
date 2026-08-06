/**
 * PHASE 2F1 — canonical physical-face resolver for automatic dimensions.
 *
 * Topology nodes stay on centrelines. Dimension anchors are computed on the
 * correct physical face of the rendered wall mass. Fail-closed: never silently
 * mix centreline and face semantics.
 *
 * Pure: no React, no plan mutation.
 */
import { distPointToSegment, pointInLoop } from "../walls/renderedContours.js";
import { FACE_REF_KINDS } from "../walls/wallFaceReferences.js";

const EPS = 1.5;

function finitePoint(p) {
  return p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function nearestOnSegments(point, segments = []) {
  let best = { dist: Infinity, seg: null, on: null };
  for (const seg of segments) {
    if (!seg?.a || !seg?.b) continue;
    const d = distPointToSegment(point, seg.a, seg.b);
    if (d < best.dist) {
      best = { dist: d, seg, on: seg };
    }
  }
  return best;
}

/**
 * Classify whether a world point sits on an outer face, a room face, or neither.
 * Centreline proximity alone is never accepted as a valid dimension anchor.
 */
export function classifyAnchorAgainstContours(point, contours, { roomId = null } = {}) {
  if (!finitePoint(point) || !contours) {
    return { ok: false, reason: "INVALID_POINT", onCentrelineOnly: false };
  }
  const outerSegs = [];
  for (const env of contours.envelopes || []) {
    const comp = (contours.components || []).find((c) => c.id === env.componentId);
    for (const ol of comp?.outerLoops || []) {
      const loop = ol.loop || ol;
      for (let i = 0; i < (loop?.length || 0); i++) {
        const a = loop[i];
        const b = loop[(i + 1) % loop.length];
        outerSegs.push({ a, b, id: `${env.id}:o#${i}`, role: "outer" });
      }
    }
  }
  const roomSegs = [];
  for (const rc of contours.roomContours || []) {
    if (roomId && rc.roomId !== roomId) continue;
    for (const s of rc.segments || []) {
      roomSegs.push({ a: s.a, b: s.b, id: s.id, role: "room", roomId: rc.roomId });
    }
  }

  const nearOuter = nearestOnSegments(point, outerSegs);
  const nearRoom = nearestOnSegments(point, roomSegs);

  const onOuter = nearOuter.dist <= EPS;
  const onRoom = nearRoom.dist <= EPS;
  if (onOuter && (!onRoom || nearOuter.dist <= nearRoom.dist)) {
    return {
      ok: true,
      side: "outer",
      referenceKind: FACE_REF_KINDS.JOINED_OUTER_FACE,
      faceSegmentId: nearOuter.seg?.id || null,
      distanceToFaceMm: nearOuter.dist,
      onCentrelineOnly: false,
      reason: "ON_OUTER_FACE",
    };
  }
  if (onRoom) {
    return {
      ok: true,
      side: "room",
      referenceKind: FACE_REF_KINDS.JOINED_ROOM_FACE,
      faceSegmentId: nearRoom.seg?.id || null,
      roomId: nearRoom.seg?.roomId ?? roomId,
      distanceToFaceMm: nearRoom.dist,
      onCentrelineOnly: false,
      reason: "ON_ROOM_FACE",
    };
  }
  return {
    ok: false,
    side: null,
    referenceKind: null,
    faceSegmentId: null,
    distanceToFaceMm: Math.min(nearOuter.dist, nearRoom.dist),
    onCentrelineOnly: true,
    reason: "NOT_ON_PHYSICAL_FACE",
  };
}

/**
 * Prove both anchors of a dimension sit on the expected semantic face class.
 * @param {"internal"|"external"} semantic
 */
export function auditDimensionFaceAnchors(dim, contours) {
  const expected = dim?.kind === "external_overall" || dim?.kind === "external_segment"
    ? "external"
    : "internal";
  const a = classifyAnchorAgainstContours(dim?.p1 || dim?.witnessA, contours, {
    roomId: dim?.roomId || dim?.reference?.roomId || null,
  });
  const b = classifyAnchorAgainstContours(dim?.p2 || dim?.witnessB, contours, {
    roomId: dim?.roomId || dim?.reference?.roomId || null,
  });
  const aOk = expected === "external" ? a.side === "outer" : a.side === "room";
  const bOk = expected === "external" ? b.side === "outer" : b.side === "room";
  return {
    id: dim?.id,
    kind: dim?.kind,
    expected,
    anchorA: a,
    anchorB: b,
    ok: !!(aOk && bOk && a.ok && b.ok),
    mixesOuterAndInner: (a.side === "outer" && b.side === "room")
      || (a.side === "room" && b.side === "outer"),
    centrelineRisk: !!(a.onCentrelineOnly || b.onCentrelineOnly),
  };
}

/** True when measured span is wall thickness (both faces of the same wall body). */
export function isWallThicknessDimension(dim, { maxMm = 250 } = {}) {
  if (!dim?.p1 || !dim?.p2) return false;
  const len = Number.isFinite(dim.measurementValue)
    ? dim.measurementValue
    : Math.hypot(dim.p2.x - dim.p1.x, dim.p2.y - dim.p1.y);
  if (!(len > 0) || len > maxMm) return false;
  // Thickness spans are short and nearly perpendicular to a long wall — heuristic only;
  // callers also ban kinds that measure across a single wall body.
  return dim.kind === "wall_thickness"
    || dim.reference?.axis === "thickness"
    || dim.style?.thickness === true;
}

export function pointInsideAnyRoom(point, contours) {
  if (!finitePoint(point)) return false;
  for (const rc of contours.roomContours || []) {
    if (rc.roomPolygon && pointInLoop(point, rc.roomPolygon)) return true;
  }
  return false;
}

/**
 * Final face-anchor gate. Centreline-only anchors suppress the entire dimension.
 */
export function validateDimensionAnchors(dim, contours, { pipeline = null } = {}) {
  const base = {
    pipeline: pipeline || dim?.kind || "unknown",
    id: dim?.id || null,
    ok: false,
    reason: null,
    anchorA: null,
    anchorB: null,
    nearestCenterlineDistMm: null,
    nearestFaceDistMm: null,
    chosenFaceIds: [],
  };
  if (!dim?.p1 || !dim?.p2 || !contours) {
    return { ...base, reason: "MISSING_INPUT" };
  }
  const audit = auditDimensionFaceAnchors(dim, contours);
  const nearestFace = Math.min(
    audit.anchorA?.distanceToFaceMm ?? Infinity,
    audit.anchorB?.distanceToFaceMm ?? Infinity,
  );
  const result = {
    ...base,
    ok: audit.ok && !audit.centrelineRisk && !audit.mixesOuterAndInner,
    reason: audit.ok
      ? (audit.centrelineRisk ? "CENTRELINE_ONLY" : (audit.mixesOuterAndInner ? "MIXED_FACES" : null))
      : (audit.anchorA?.reason || audit.anchorB?.reason || "NOT_ON_PHYSICAL_FACE"),
    anchorA: audit.anchorA,
    anchorB: audit.anchorB,
    nearestFaceDistMm: Number.isFinite(nearestFace) ? nearestFace : null,
    chosenFaceIds: [
      audit.anchorA?.faceSegmentId,
      audit.anchorB?.faceSegmentId,
    ].filter(Boolean),
    centrelineRisk: audit.centrelineRisk,
  };
  if (audit.centrelineRisk) result.reason = "CENTRELINE_ONLY";
  if (result.ok) result.reason = null;
  return result;
}
