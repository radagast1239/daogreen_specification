/**
 * Semantic wall face references derived from a single topology centerline.
 * Not separate topology axes — computed geometry only.
 * Kept free of legacy wallParallelGeometry imports (core boundary).
 */
import { pointInPolygon } from "../geometry/polygons.js";

export const FACE_REF_KINDS = Object.freeze({
  CENTERLINE: "centerline",
  FACE_A: "faceA",
  FACE_B: "faceB",
  ROOM_FACE: "roomFace",
  OUTER_FACE: "outerFace",
  JOINED_ROOM_FACE: "joinedRoomFace",
  JOINED_OUTER_FACE: "joinedOuterFace",
});

function ptsOf(wall) {
  if (wall?.pts?.length >= 2) return [wall.pts[0], wall.pts[wall.pts.length - 1]];
  return null;
}

/** Distances from axis to inner/outer faces (matches wallFaceDistances). */
function faceDistances(wall) {
  const thk = wall?.thk || 100;
  const side = wall?.thicknessSide || "center";
  if (side === "in") return { inner: thk, outer: 0 };
  if (side === "out") return { inner: 0, outer: thk };
  return { inner: thk / 2, outer: thk / 2 };
}

/** Left-hand normal of a→b (architectural inward when thicknessSide is center). */
function axisNormal(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { nx: -dy / len, ny: dx / len };
}

/**
 * Build raw (unjoined) face endpoints for a wall segment.
 * faceA = +left of a→b, faceB = -left (right).
 */
export function buildWallFaceReferences(wall, room = null, opts = {}) {
  const pts = ptsOf(wall);
  if (!pts) return null;
  const [a, b] = pts;
  const { inner, outer } = faceDistances(wall);
  const { nx, ny } = axisNormal(a, b);
  const revision = opts.geometryRevision ?? null;

  const centerline = {
    wallId: wall.id,
    kind: FACE_REF_KINDS.CENTERLINE,
    side: "axis",
    start: { x: a.x, y: a.y },
    end: { x: b.x, y: b.y },
    joinedStart: { x: a.x, y: a.y },
    joinedEnd: { x: b.x, y: b.y },
    normal: { nx, ny },
    roomId: null,
    geometryRevision: revision,
  };

  const faceAStart = { x: a.x + nx * inner, y: a.y + ny * inner };
  const faceAEnd = { x: b.x + nx * inner, y: b.y + ny * inner };
  const faceBStart = { x: a.x - nx * outer, y: a.y - ny * outer };
  const faceBEnd = { x: b.x - nx * outer, y: b.y - ny * outer };

  const faceA = {
    wallId: wall.id,
    kind: FACE_REF_KINDS.FACE_A,
    side: "inward",
    start: faceAStart,
    end: faceAEnd,
    joinedStart: faceAStart,
    joinedEnd: faceAEnd,
    normal: { nx, ny },
    roomId: null,
    geometryRevision: revision,
  };
  const faceB = {
    wallId: wall.id,
    kind: FACE_REF_KINDS.FACE_B,
    side: "outward",
    start: faceBStart,
    end: faceBEnd,
    joinedStart: faceBStart,
    joinedEnd: faceBEnd,
    normal: { nx: -nx, ny: -ny },
    roomId: null,
    geometryRevision: revision,
  };

  return { centerline, faceA, faceB, wallId: wall.id, roomHint: room || null };
}

/**
 * Pick the room-facing side using roomId + point-in-polygon (not bbox centroid).
 */
export function resolveRoomFacingReference(wall, roomPolygon, roomId, room = null, opts = {}) {
  const refs = buildWallFaceReferences(wall, room, opts);
  if (!refs || !roomPolygon?.length) {
    return {
      ok: false,
      reason: "missing-room-polygon",
      reference: null,
    };
  }
  const midA = {
    x: (refs.faceA.start.x + refs.faceA.end.x) / 2,
    y: (refs.faceA.start.y + refs.faceA.end.y) / 2,
  };
  const midB = {
    x: (refs.faceB.start.x + refs.faceB.end.x) / 2,
    y: (refs.faceB.start.y + refs.faceB.end.y) / 2,
  };
  const probeA = {
    x: midA.x + refs.faceA.normal.nx * 20,
    y: midA.y + refs.faceA.normal.ny * 20,
  };
  const probeB = {
    x: midB.x + refs.faceB.normal.nx * 20,
    y: midB.y + refs.faceB.normal.ny * 20,
  };
  const aIn = pointInPolygon(probeA, roomPolygon);
  const bIn = pointInPolygon(probeB, roomPolygon);
  if (aIn === bIn) {
    const midAIn = pointInPolygon(midA, roomPolygon);
    const midBIn = pointInPolygon(midB, roomPolygon);
    if (midAIn === midBIn) {
      return { ok: false, reason: "ambiguous-room-side", reference: null };
    }
    const useA = midAIn;
    const base = useA ? refs.faceA : refs.faceB;
    return {
      ok: true,
      reference: {
        ...base,
        kind: FACE_REF_KINDS.JOINED_ROOM_FACE,
        roomId: roomId || null,
      },
    };
  }
  const useA = aIn && !bIn;
  const base = useA ? refs.faceA : refs.faceB;
  return {
    ok: true,
    reference: {
      ...base,
      kind: FACE_REF_KINDS.JOINED_ROOM_FACE,
      roomId: roomId || null,
    },
  };
}

/**
 * Outer face for external overall — the side whose probe is NOT inside any room.
 */
export function resolveOuterFacingReference(wall, roomPolygons = [], room = null, opts = {}) {
  const refs = buildWallFaceReferences(wall, room, opts);
  if (!refs) return { ok: false, reason: "missing-wall", reference: null };
  if (!roomPolygons.length) {
    return {
      ok: true,
      reference: {
        ...refs.faceB,
        kind: FACE_REF_KINDS.JOINED_OUTER_FACE,
      },
    };
  }
  const midA = {
    x: (refs.faceA.start.x + refs.faceA.end.x) / 2,
    y: (refs.faceA.start.y + refs.faceA.end.y) / 2,
  };
  const midB = {
    x: (refs.faceB.start.x + refs.faceB.end.x) / 2,
    y: (refs.faceB.start.y + refs.faceB.end.y) / 2,
  };
  const probeA = {
    x: midA.x + refs.faceA.normal.nx * 40,
    y: midA.y + refs.faceA.normal.ny * 40,
  };
  const probeB = {
    x: midB.x + refs.faceB.normal.nx * 40,
    y: midB.y + refs.faceB.normal.ny * 40,
  };
  const aIn = roomPolygons.some((p) => pointInPolygon(probeA, p));
  const bIn = roomPolygons.some((p) => pointInPolygon(probeB, p));
  if (aIn && !bIn) {
    return {
      ok: true,
      reference: { ...refs.faceB, kind: FACE_REF_KINDS.JOINED_OUTER_FACE },
    };
  }
  if (bIn && !aIn) {
    return {
      ok: true,
      reference: { ...refs.faceA, kind: FACE_REF_KINDS.JOINED_OUTER_FACE },
    };
  }
  return { ok: false, reason: "ambiguous-outer-side", reference: null };
}

const QUAD_FACE_EPS_MM = 1e-6;

/**
 * Which corner pair of a quad physically belongs to `reference`.
 *
 * PHASE 2F1-M2 — a quad's "outer"/"inner" labels are assigned by
 * wallSegmentOffsetSide, which measures the wall midpoint against the FIXED
 * world point (room.w/2, room.h/2). Translating the plan across that point
 * swaps the two labels while the four corner POINTS stay identical, so
 * picking corners by the preferOuter label alone silently returns the
 * OPPOSITE physical face after translation (faceA stopped being +left).
 * Pick by perpendicular distance to the reference's own face line instead —
 * invariant under translation, wall reorder and endpoint reversal.
 * preferOuter stays the tie-break for degenerate/coincident quads.
 */
function quadFaceForReference(quad, reference, preferOuter) {
  const [outerA, outerB, innerB, innerA] = quad;
  const outerPair = { a: outerA, b: outerB, face: "outer" };
  const innerPair = { a: innerA, b: innerB, face: "inner" };
  const fallback = preferOuter ? outerPair : innerPair;
  const a = reference.start;
  const b = reference.end;
  if (!a || !b) return fallback;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return fallback;
  const nx = -dy / len;
  const ny = dx / len;
  const perpOf = (pair) => {
    if (!pair.a || !pair.b) return Infinity;
    const mx = (pair.a.x + pair.b.x) / 2;
    const my = (pair.a.y + pair.b.y) / 2;
    return Math.abs((mx - a.x) * nx + (my - a.y) * ny);
  };
  const dOuter = perpOf(outerPair);
  const dInner = perpOf(innerPair);
  if (!Number.isFinite(dOuter) || !Number.isFinite(dInner)) return fallback;
  if (Math.abs(dOuter - dInner) <= QUAD_FACE_EPS_MM) return fallback;
  return dOuter < dInner ? outerPair : innerPair;
}

/**
 * Apply joined endpoints from wallGeometry quads when available.
 * quads: array of [outerA, outerB, innerB, innerA].
 * Also reports the quad label the reference actually resolved to, so callers
 * that hand an "inner"/"outer" label onward do not re-resolve it against a
 * labelling that may have flipped (see quadFaceForReference).
 */
export function applyJoinedQuadToReference(reference, quads, preferOuter) {
  if (!reference || !quads?.length) return reference;
  let minEntry = null;
  let maxEntry = null;
  let joinedQuadFace = null;
  const aCL = reference.start;
  const bCL = reference.end;
  const clLen = Math.hypot(bCL.x - aCL.x, bCL.y - aCL.y) || 1;
  const ux = (bCL.x - aCL.x) / clLen;
  const uy = (bCL.y - aCL.y) / clLen;
  for (const quad of quads) {
    const pair = quadFaceForReference(quad, reference, preferOuter);
    if (joinedQuadFace == null) joinedQuadFace = pair.face;
    for (const pt of [pair.a, pair.b]) {
      if (!pt) continue;
      const t = (pt.x - aCL.x) * ux + (pt.y - aCL.y) * uy;
      if (!minEntry || t < minEntry.t) minEntry = { t, pt };
      if (!maxEntry || t > maxEntry.t) maxEntry = { t, pt };
    }
  }
  if (!minEntry || !maxEntry) return reference;
  return {
    ...reference,
    joinedStart: { ...minEntry.pt },
    joinedEnd: { ...maxEntry.pt },
    joinedQuadFace,
  };
}

export function referenceLength(ref) {
  if (!ref?.joinedStart || !ref?.joinedEnd) return null;
  return Math.hypot(
    ref.joinedEnd.x - ref.joinedStart.x,
    ref.joinedEnd.y - ref.joinedStart.y,
  );
}

export function distPointToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** True when dimension anchors lie on centerline within eps. */
export function anchorsOnCenterline(p1, p2, centerline, eps = 8) {
  if (!centerline?.start || !centerline?.end) return false;
  const d1 = distPointToSegment(p1, centerline.start, centerline.end);
  const d2 = distPointToSegment(p2, centerline.start, centerline.end);
  return d1 <= eps && d2 <= eps;
}
