/**
 * PHASE 2F1 — explicit dimension SEMANTICS and CONTOUR ROLES.
 *
 * Blocker A came from one unstated assumption: "an envelope has a bounding box,
 * therefore it has a width and a height". The producer diagnosis
 * (room-bbox-dimension-diagnosis.txt) showed exactly that:
 *
 *   comp4-env  905.02 x 1000   — irregular quad (oblique side); the 905.02 came
 *                                from synthetic faces `comp4-env:bbox-w0/w1`,
 *                                i.e. bbox min/max, NOT a physical face pair.
 *   comp5-env  3136 x 3919.11  — same mechanism on the oblique room.
 *
 * A bbox extent of an irregular contour is not a measurement of anything the
 * user can point at on the drawing. This module makes the three semantics
 * distinct and decidable, so the final arbitration can refuse the forbidden one
 * instead of relying on CSS or zoom thresholds:
 *
 *   BUILDING_EXTERIOR_OVERALL   outermost building contour only, and only when
 *                               the value is a PROVEN physical exterior face to
 *                               physical exterior face distance.
 *   ROOM_EDGE_CLEAR             one dimension per meaningful room-facing
 *                               physical edge, parallel to that edge, measuring
 *                               that edge's actual length.
 *   ROOM_BOUNDING_BOX_*         forbidden in automatic room dimensions.
 *
 * Pure: no React, no plan mutation.
 */
import { pointInLoop } from "../walls/renderedContours.js";

/** What a contour IS, decided once, so dimension rules can depend on it. */
export const CONTOUR_ROLE = Object.freeze({
  /** Outermost closed building contour — the only overall-envelope producer. */
  BUILDING_OUTERMOST: "BUILDING_OUTERMOST",
  /** A room boundary (a minimal enclosed region of the wall mass). */
  ROOM_BOUNDARY: "ROOM_BOUNDARY",
  /** A hole nested inside another region — never a building, never a room W/H. */
  INTERNAL_HOLE: "INTERNAL_HOLE",
  /** Walls that enclose nothing (a lone wall, an L) — no envelope semantics. */
  OPEN_WALL_NETWORK: "OPEN_WALL_NETWORK",
  UNKNOWN: "UNKNOWN",
});

export const DIMENSION_SEMANTIC = Object.freeze({
  BUILDING_EXTERIOR_OVERALL: "BUILDING_EXTERIOR_OVERALL",
  EXTERIOR_EDGE: "EXTERIOR_EDGE",
  ROOM_EDGE_CLEAR: "ROOM_EDGE_CLEAR",
  ROOM_BOUNDING_BOX_WIDTH: "ROOM_BOUNDING_BOX_WIDTH",
  ROOM_BOUNDING_BOX_HEIGHT: "ROOM_BOUNDING_BOX_HEIGHT",
  WALL_LENGTH: "WALL_LENGTH",
  OTHER: "OTHER",
});

/** Semantics that must never reach the finalized automatic set. */
export const FORBIDDEN_AUTOMATIC_SEMANTICS = Object.freeze(new Set([
  DIMENSION_SEMANTIC.ROOM_BOUNDING_BOX_WIDTH,
  DIMENSION_SEMANTIC.ROOM_BOUNDING_BOX_HEIGHT,
]));

/** A synthetic face id minted from bbox extrema rather than a drawn face. */
export const SYNTHETIC_BBOX_FACE_RE = /:bbox-[wh][01]$/;

export function isSyntheticBboxFaceId(id) {
  return typeof id === "string" && SYNTHETIC_BBOX_FACE_RE.test(id);
}

const RECT_ANGLE_COS_EPS = 0.02; // ~1.15° from 90° / 0°
const RECT_COLLINEAR_EPS = 2; // mm

/**
 * Strict CURRENT-geometry rectangle proof.
 *
 * Trapezoids, L-shapes, oblique quads, triangles and stepped contours must
 * return false: for those, a bounding box says nothing about any real edge.
 * Only a proven rectangle may have its opposing-face span presented as a
 * width/height, because there the two coincide exactly.
 */
export function isRectangularContour(rc, eps = RECT_COLLINEAR_EPS) {
  const segs = (rc?.segments || []).filter((s) => s && (s.len || 0) >= 1);
  if (segs.length !== 4) return false;
  if (segs.some((s) => s.axis === "diagonal" || s.axis === "oblique")) return false;
  const axes = segs.map((s) => s.axis);
  if (axes.filter((a) => a === "horizontal").length !== 2) return false;
  if (axes.filter((a) => a === "vertical").length !== 2) return false;

  for (let i = 0; i < 4; i++) {
    const a = segs[i];
    const b = segs[(i + 1) % 4];
    const ax = (a.b?.x || 0) - (a.a?.x || 0);
    const ay = (a.b?.y || 0) - (a.a?.y || 0);
    const bx = (b.b?.x || 0) - (b.a?.x || 0);
    const by = (b.b?.y || 0) - (b.a?.y || 0);
    const la = Math.hypot(ax, ay) || 1;
    const lb = Math.hypot(bx, by) || 1;
    if (Math.abs((ax * bx + ay * by) / (la * lb)) > RECT_ANGLE_COS_EPS) return false;
  }
  const horiz = segs.filter((s) => s.axis === "horizontal");
  const vert = segs.filter((s) => s.axis === "vertical");
  if (Math.abs((horiz[0].a?.y || 0) - (horiz[0].b?.y || 0)) > eps) return false;
  if (Math.abs((horiz[1].a?.y || 0) - (horiz[1].b?.y || 0)) > eps) return false;
  if (Math.abs((vert[0].a?.x || 0) - (vert[0].b?.x || 0)) > eps) return false;
  if (Math.abs((vert[1].a?.x || 0) - (vert[1].b?.x || 0)) > eps) return false;
  const poly = rc.roomPolygon || rc.polygon || rc.loop;
  return !!(poly && poly.length >= 4);
}

/**
 * Role of every contour the dimension pipelines can reference.
 *
 * buildRenderedContours already restricts `envelopes` to outermost components
 * that actually enclose space; this states that as an explicit ROLE so the
 * dimension rules read as semantics rather than as an incidental filter, and so
 * open wall networks and nested holes get a name of their own.
 *
 * @returns {Map<string, {role:string, id:string, kind:"envelope"|"room"|"component"}>}
 */
export function classifyContourRoles(contours) {
  const roles = new Map();
  const envelopeComponentIds = new Set();
  for (const env of contours?.envelopes || []) {
    envelopeComponentIds.add(env.componentId);
    roles.set(env.id, { role: CONTOUR_ROLE.BUILDING_OUTERMOST, id: env.id, kind: "envelope" });
  }
  for (const comp of contours?.components || []) {
    if (roles.has(comp.id)) continue;
    const enclosesSpace = (comp.holeCount || 0) >= 1;
    const nested = (comp.nestingDepth || 0) > 0;
    roles.set(comp.id, {
      role: enclosesSpace
        ? (nested ? CONTOUR_ROLE.INTERNAL_HOLE : CONTOUR_ROLE.BUILDING_OUTERMOST)
        : CONTOUR_ROLE.OPEN_WALL_NETWORK,
      id: comp.id,
      kind: "component",
    });
  }
  for (const rc of contours?.roomContours || []) {
    const id = rc.loopId || rc.regionId;
    if (!id) continue;
    roles.set(id, {
      role: CONTOUR_ROLE.ROOM_BOUNDARY,
      id,
      kind: "room",
      rectangular: isRectangularContour(rc),
    });
  }
  return roles;
}

export function contourRoleOf(roles, contourId) {
  return roles?.get(contourId)?.role || CONTOUR_ROLE.UNKNOWN;
}

function envelopeOf(contours, envelopeId) {
  return (contours?.envelopes || []).find((e) => e.id === envelopeId) || null;
}

function roomContourOf(contours, dim) {
  const loopId = dim?.reference?.loopId;
  if (loopId) {
    const byLoop = (contours?.roomContours || []).find((rc) => rc.loopId === loopId);
    if (byLoop) return byLoop;
  }
  const roomId = dim?.roomId || dim?.reference?.roomId;
  if (roomId) {
    const byRoom = (contours?.roomContours || []).find((rc) => rc.roomId === roomId);
    if (byRoom) return byRoom;
  }
  const mid = {
    x: ((dim?.p1?.x || 0) + (dim?.p2?.x || 0)) / 2,
    y: ((dim?.p1?.y || 0) + (dim?.p2?.y || 0)) / 2,
  };
  return (contours?.roomContours || []).find((rc) => {
    const poly = rc.roomPolygon || rc.loop;
    return poly && pointInLoop(mid, poly);
  }) || null;
}

/**
 * The semantic a finalized record actually carries — decided from the contour
 * role and from HOW the value was obtained, never from the pipeline name alone.
 *
 * @returns {{semantic:string, contourId:string|null, contourRole:string, reason:string}}
 */
export function classifyDimensionSemantic(dim, contours, roles = null) {
  const map = roles || classifyContourRoles(contours);

  if (dim?.kind === "external_overall") {
    const envelopeId = dim.reference?.envelopeId || null;
    const role = contourRoleOf(map, envelopeId);
    if (role !== CONTOUR_ROLE.BUILDING_OUTERMOST) {
      return {
        semantic: dim.orientation === "vertical"
          ? DIMENSION_SEMANTIC.ROOM_BOUNDING_BOX_HEIGHT
          : DIMENSION_SEMANTIC.ROOM_BOUNDING_BOX_WIDTH,
        contourId: envelopeId,
        contourRole: role,
        reason: "overall_on_non_building_contour",
      };
    }
    const faceIds = dim.reference?.matchedContourSegmentIds || [];
    if (faceIds.some(isSyntheticBboxFaceId) || !faceIds.length) {
      return {
        semantic: dim.orientation === "vertical"
          ? DIMENSION_SEMANTIC.ROOM_BOUNDING_BOX_HEIGHT
          : DIMENSION_SEMANTIC.ROOM_BOUNDING_BOX_WIDTH,
        contourId: envelopeId,
        contourRole: role,
        reason: "value_from_bbox_min_max_not_physical_faces",
      };
    }
    // Anchors are real faces; the value must also BE the face-to-face distance,
    // not the envelope extent that merely happens to be nearby.
    const env = envelopeOf(contours, envelopeId);
    const anchorSpan = (dim.p1 && dim.p2)
      ? Math.hypot(dim.p2.x - dim.p1.x, dim.p2.y - dim.p1.y)
      : NaN;
    if (Number.isFinite(anchorSpan) && Number.isFinite(dim.measurementValue)
      && Math.abs(anchorSpan - dim.measurementValue) > 1) {
      return {
        semantic: dim.orientation === "vertical"
          ? DIMENSION_SEMANTIC.ROOM_BOUNDING_BOX_HEIGHT
          : DIMENSION_SEMANTIC.ROOM_BOUNDING_BOX_WIDTH,
        contourId: envelopeId,
        contourRole: role,
        reason: "measured_value_is_not_the_anchor_face_distance",
      };
    }
    return {
      semantic: DIMENSION_SEMANTIC.BUILDING_EXTERIOR_OVERALL,
      contourId: envelopeId,
      contourRole: role,
      reason: env ? "outermost_building_face_to_face" : "outermost_building",
    };
  }

  if (dim?.kind === "external_segment") {
    return {
      semantic: DIMENSION_SEMANTIC.EXTERIOR_EDGE,
      contourId: dim.reference?.envelopeId || null,
      contourRole: contourRoleOf(map, dim.reference?.envelopeId),
      reason: "physical_exterior_edge",
    };
  }

  if (dim?.kind === "room_edge_clear") {
    const rc = roomContourOf(contours, dim);
    return {
      semantic: DIMENSION_SEMANTIC.ROOM_EDGE_CLEAR,
      contourId: rc?.loopId || dim.reference?.loopId || null,
      contourRole: CONTOUR_ROLE.ROOM_BOUNDARY,
      reason: "physical_room_facing_edge",
    };
  }

  if (dim?.kind === "internal_clear") {
    // internal_clear measures between two OPPOSING faces. On a proven rectangle
    // that span IS the edge length of the perpendicular pair, so it stays a
    // legitimate clear dimension. On anything else it is a bounding box.
    const rc = roomContourOf(contours, dim);
    const rectangular = rc ? isRectangularContour(rc) : false;
    const contourId = rc?.loopId || dim.reference?.loopId || null;
    if (rectangular) {
      return {
        semantic: DIMENSION_SEMANTIC.ROOM_EDGE_CLEAR,
        contourId,
        contourRole: CONTOUR_ROLE.ROOM_BOUNDARY,
        reason: "rectangular_room_opposing_faces_equal_edge_length",
      };
    }
    return {
      semantic: dim.orientation === "vertical"
        ? DIMENSION_SEMANTIC.ROOM_BOUNDING_BOX_HEIGHT
        : DIMENSION_SEMANTIC.ROOM_BOUNDING_BOX_WIDTH,
      contourId,
      contourRole: CONTOUR_ROLE.ROOM_BOUNDARY,
      reason: rc ? "non_rectangular_room_contour" : "no_room_contour_for_span",
    };
  }

  if (dim?.kind === "wall_length") {
    return {
      semantic: DIMENSION_SEMANTIC.WALL_LENGTH,
      contourId: null,
      contourRole: CONTOUR_ROLE.UNKNOWN,
      reason: "per_wall_length",
    };
  }

  return {
    semantic: DIMENSION_SEMANTIC.OTHER,
    contourId: null,
    contourRole: CONTOUR_ROLE.UNKNOWN,
    reason: "not_a_contour_pipeline",
  };
}

export function isForbiddenRoomBoundingBox(semantic) {
  return FORBIDDEN_AUTOMATIC_SEMANTICS.has(semantic);
}
