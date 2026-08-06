/**
 * PHASE 2F1-LIVE4.2 — THE selected-wall dimension presentation solver.
 *
 * One wall-local solver for every wall role and every orientation. Semantic
 * physical-face selection happens upstream (selectedWallPhysicalSpans, M2) and
 * is never touched here; this file only decides WHERE a face's value is drawn.
 *
 * Local frame (never screen x/y):
 *   u = tangent along the wall in its CANONICAL direction (+x, then +y)
 *   v = left normal of u
 * Only the caller's final SVG emit converts back to screen space.
 */
import {
  nearWallLaneOffsetMm,
  NEAR_LANE_PREFERRED_PX,
  NEAR_LANE_MIN_PX,
  NEAR_LANE_MAX_PX,
  INTERACTION_OCCUPANCY_PX,
  VISUAL_KNOCKOUT_MARGIN_PX,
  TEXT_KNOCKOUT_PAD_PX,
  visibleCentreKnockoutRadiusPx,
  visualKnockoutIntervalsAlongDimPx,
} from "../viewport/gripScale.js";
// ONE definition of the canonical undirected wall direction, shared with the
// M2 face-resolution tie-breaks. Never re-derive it locally.
import { canonicalDirSign } from "../walls/selectedWallPhysicalSpans.js";

export {
  nearWallLaneOffsetMm,
  NEAR_LANE_PREFERRED_PX,
  NEAR_LANE_MIN_PX,
  NEAR_LANE_MAX_PX,
  INTERACTION_OCCUPANCY_PX,
  VISUAL_KNOCKOUT_MARGIN_PX,
  TEXT_KNOCKOUT_PAD_PX,
  visibleCentreKnockoutRadiusPx,
  visualKnockoutIntervalsAlongDimPx,
  canonicalDirSign,
};

/**
 * Canonical physical-face identities. These are wall-local, not visual:
 * on a horizontal wall V_NEG reads as "upper", on a vertical wall as "left".
 */
export const CANONICAL_FACE = Object.freeze({
  V_NEG: "v-",
  V_POS: "v+",
});

/**
 * Deterministic preferred text position per canonical face, measured along the
 * canonical +u direction. The two faces must never share a default t, and the
 * pair must stay clear of the centre control at t = 0.5.
 */
export const PREFERRED_FACE_T = Object.freeze({
  [CANONICAL_FACE.V_NEG]: 0.35,
  [CANONICAL_FACE.V_POS]: 0.65,
});

/** Bounded nearby search, in canonical-t units, tried in this fixed order. */
const SEARCH_OFFSETS_T = Object.freeze([0, 0.08, -0.08, 0.16, -0.16, 0.24, -0.24]);
const T_MIN = 0.12;
const T_MAX = 0.88;
/**
 * Hysteresis band. A retained position is given up only when the preferred one
 * is clear by this margin; a preferred position is given up only when it is
 * genuinely intersected. Between the two the last valid placement is kept, so
 * placement cannot oscillate around a threshold during a zoom sweep.
 */
const HYSTERESIS_T = 0.02;
/** Exact ties must not be decided by floating-point residue (cf. M2). */
const TIE_EPS = 1e-9;
/**
 * Occupancy and text footprints are screen-sized, so in span-relative units
 * they GROW without bound as the view zooms out: at z = 0.03 the centre control
 * alone covers ±0.26 of an 8 m wall and the label another ±0.18. Left unclamped
 * that made the preferred position "collide" only while zoomed out, and the
 * solver walked the text toward the wall ends and back again as the user
 * zoomed — the label-jumping this phase exists to remove.
 *
 * An obstacle that blankets this much of the span is not something a placement
 * can dodge; it is a level-of-detail condition, and LOD already owns it. Clamped
 * so that PREFERRED_FACE_T (±0.15 from the centre control) is provably clear of
 * a lone centre control at EVERY zoom: 0.07 + 0.045 = 0.115 < 0.15. Placement
 * therefore only ever moves for a real, additional obstacle.
 */
const OCC_MAX_HALF_T = 0.07;
const LABEL_MAX_HALF_T = 0.045;

function dist(a, b) {
  return Math.hypot((b?.x || 0) - (a?.x || 0), (b?.y || 0) - (a?.y || 0));
}

const isPt = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);

/**
 * Wall-local frame in the canonical direction.
 * `reversed` tells callers whether the wall's STORED a→b runs against +u.
 */
export function canonicalWallFrame(a, b) {
  if (!isPt(a) || !isPt(b)) return null;
  const sign = canonicalDirSign(a, b);
  const origin = sign > 0 ? a : b;
  const target = sign > 0 ? b : a;
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return null;
  return {
    origin: { x: origin.x, y: origin.y },
    len,
    ux: dx / len,
    uy: dy / len,
    vx: -dy / len,
    vy: dx / len,
    reversed: sign < 0,
  };
}

/** World point → wall-local { u (normalized 0..1 along the wall), v (mm) }. */
export function wallLocalPoint(frame, p) {
  if (!frame || !isPt(p)) return null;
  const dx = p.x - frame.origin.x;
  const dy = p.y - frame.origin.y;
  return {
    u: (dx * frame.ux + dy * frame.uy) / frame.len,
    v: dx * frame.vx + dy * frame.vy,
  };
}

/**
 * LIVE4.2 — superseded by solveSelectedWallDimPresentation for every label that
 * solver places. It remains the FALLBACK on the render path: when the solver
 * returns no placement for a face/primary label, wallLiveMeasurementOverlay
 * still calls this to pick t (see that file's labelT branch).
 *
 * Do not treat it as the primary chooser. Its known weaknesses are why the
 * solver exists: it gives both physical faces the same preferred t, it cannot
 * reach its own midpoint branch while the centre control occupies the midpoint,
 * and it decides 0.25-vs-0.75 by floating-point residue on rotated spans
 * (measured: 8 switches over a 40-step zoom sweep on a 45° wall).
 */
export function chooseLabelTAlongWall({
  a,
  b,
  zoom = 1,
  occupyWorld = null,
  clearPx = 28,
} = {}) {
  if (!a || !b) return 0.5;
  const z = Math.max(Number(zoom) || 1, 1e-6);
  const candidates = [0.25, 0.5, 0.75];
  if (!occupyWorld || !Number.isFinite(occupyWorld.x)) return 0.5;

  let bestT = 0.5;
  let bestScore = -Infinity;
  for (const t of candidates) {
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const dPx = Math.hypot(p.x - occupyWorld.x, p.y - occupyWorld.y) * z;
    const score = t === 0.5
      ? (dPx >= clearPx ? 1000 + dPx : dPx)
      : dPx;
    if (score > bestScore) {
      bestScore = score;
      bestT = t;
    }
  }
  return bestT;
}

/**
 * LIVE4.5 — visual knockout only. Interaction / hit radii must not be passed as
 * clusterRadiusPx; use visibleCentreKnockoutRadiusPx() or the lane-aware
 * visualIntervalsPx path instead.
 *
 * Parametric knockout intervals along dimA→dimB for visible controls + text.
 * Returns sorted merged [{t0,t1}] in [0,1].
 */
export function buildDimLineKnockouts({
  dimA,
  dimB,
  zoom = 1,
  labelT = 0.5,
  labelHalfPx = TEXT_KNOCKOUT_PAD_PX + 18,
  clusterWorld = null,
  /** @deprecated Prefer visualClearPx / visualIntervalsPx — never pass hit ≥32 here. */
  clusterRadiusPx = null,
  visualClearPx = null,
  /** Optional precomputed along-line intervals in screen px, relative to cluster. */
  visualIntervalsPx = null,
  lanePx = null,
} = {}) {
  if (!dimA || !dimB) return [];
  const z = Math.max(Number(zoom) || 1, 1e-6);
  const len = dist(dimA, dimB) || 1;
  const ux = (dimB.x - dimA.x) / len;
  const uy = (dimB.y - dimA.y) / len;
  const gaps = [];

  const pushTGap = (tCenter, halfPx) => {
    if (!Number.isFinite(tCenter)) return;
    if (tCenter < -0.05 || tCenter > 1.05) return;
    const halfT = (halfPx / z) / len;
    gaps.push({
      t0: Math.max(0, tCenter - halfT),
      t1: Math.min(1, tCenter + halfT),
    });
  };

  const hasCluster = clusterWorld && Number.isFinite(clusterWorld.x);
  const clusterT = hasCluster
    ? ((clusterWorld.x - dimA.x) * ux + (clusterWorld.y - dimA.y) * uy) / len
    : 0.5;

  if (hasCluster) {
    let intervals = Array.isArray(visualIntervalsPx) ? visualIntervalsPx : null;
    if (!intervals && Number.isFinite(lanePx)) {
      intervals = visualKnockoutIntervalsAlongDimPx({ zoom: z, lanePx });
    }
    if (intervals && intervals.length) {
      for (const iv of intervals) {
        // iv is screen-px along tangent relative to cluster centre.
        const t0 = clusterT + (iv.t0 / z) / len;
        const t1 = clusterT + (iv.t1 / z) / len;
        gaps.push({
          t0: Math.max(0, Math.min(t0, t1)),
          t1: Math.min(1, Math.max(t0, t1)),
        });
      }
    } else {
      const visualR = Number.isFinite(visualClearPx)
        ? visualClearPx
        : (Number.isFinite(clusterRadiusPx)
          ? clusterRadiusPx
          : visibleCentreKnockoutRadiusPx(z));
      pushTGap(clusterT, visualR);
    }
  }

  const labelHalfT = (labelHalfPx / z) / len;
  gaps.push({
    t0: Math.max(0, labelT - labelHalfT),
    t1: Math.min(1, labelT + labelHalfT),
  });

  gaps.sort((g0, g1) => g0.t0 - g1.t0);
  const merged = [];
  for (const g of gaps) {
    if (!merged.length || g.t0 > merged[merged.length - 1].t1 + 0.01) {
      merged.push({ ...g });
    } else {
      merged[merged.length - 1].t1 = Math.max(merged[merged.length - 1].t1, g.t1);
    }
  }
  return merged;
}

/** Visible line segments after knockouts (world points). */
export function dimLineSegmentsFromKnockouts(dimA, dimB, knockouts = []) {
  if (!dimA || !dimB) return [];
  const len = dist(dimA, dimB);
  if (!(len > 0)) return [];
  const pt = (t) => ({
    x: dimA.x + (dimB.x - dimA.x) * t,
    y: dimA.y + (dimB.y - dimA.y) * t,
  });
  if (!knockouts.length) return [{ a: dimA, b: dimB }];

  const segs = [];
  let cursor = 0;
  for (const g of knockouts) {
    if (g.t0 > cursor + 0.01) {
      segs.push({ a: pt(cursor), b: pt(g.t0) });
    }
    cursor = Math.max(cursor, g.t1);
  }
  if (cursor < 0.99) segs.push({ a: pt(cursor), b: dimB });
  return segs;
}

/* ------------------------------------------------------------------ *
 * THE unified wall-local presentation solver
 * ------------------------------------------------------------------ */

/** Occupancy interval, in the span's own t units, for one control point. */
function occupancyIntervalT(occ, span, zoom) {
  const pt = occ?.point || occ;
  if (!isPt(pt)) return null;
  const len = dist(span.a, span.b);
  if (!(len > 0)) return null;
  const ux = (span.b.x - span.a.x) / len;
  const uy = (span.b.y - span.a.y) / len;
  const t = ((pt.x - span.a.x) * ux + (pt.y - span.a.y) * uy) / len;
  // Placement dodge uses interaction occupancy (≥ hit target). Visual knockout
  // reads visualClearPx separately and must ignore this radius.
  const clearPx = Number.isFinite(occ?.clearPx)
    ? occ.clearPx
    : INTERACTION_OCCUPANCY_PX;
  const halfT = Math.min(
    OCC_MAX_HALF_T,
    (clearPx / Math.max(Number(zoom) || 1, 1e-6)) / len,
  );
  return { t, halfT };
}

/**
 * Signed clearance of candidate t from every occupancy interval, in t units.
 * ≥ 0 means the candidate is outside all of them.
 */
function clearanceAt(tCandidate, intervals, labelHalfT) {
  let worst = Infinity;
  for (const iv of intervals) {
    const gap = Math.abs(tCandidate - iv.t) - (iv.halfT + labelHalfT);
    if (gap < worst) worst = gap;
  }
  return worst;
}

/**
 * Layout for one selected wall's physical-face dimensions.
 *
 * Same solver for exterior / interior / shared / free / open-chain / T /
 * diagonal walls and for every orientation. Everything is decided in the
 * canonical wall-local frame, so a rotated or reversed copy of a wall gets an
 * identical wall-local answer.
 *
 * @param {object} args
 * @param {Array<{id:string,a:object,b:object,faceKey?:string}>} args.faces
 *        Physical face spans already resolved upstream. Never re-measured here.
 * @param {object} args.wallA  Wall centreline endpoint (stored order).
 * @param {object} args.wallB  Wall centreline endpoint (stored order).
 * @param {number} args.zoom
 * @param {number} args.laneMm Near-wall lane offset, world mm.
 * @param {Array}  args.occupancy [{ point, clearPx }] — active controls.
 * @param {object|null} args.previous State returned by the previous frame.
 * @returns {{ byId: object, faces: Array, state: object, frame: object|null }}
 */
export function solveSelectedWallDimPresentation({
  faces = [],
  wallA = null,
  wallB = null,
  zoom = 1,
  laneMm = null,
  occupancy = [],
  previous = null,
} = {}) {
  const z = Math.max(Number(zoom) || 1, 1e-6);
  const lane = Number.isFinite(laneMm) && laneMm > 0 ? laneMm : nearWallLaneOffsetMm(z);
  const frame = canonicalWallFrame(wallA, wallB);
  const empty = { byId: {}, faces: [], state: { faces: {} }, frame };
  if (!frame || !faces.length) return empty;

  const wallMid = {
    x: (wallA.x + wallB.x) / 2,
    y: (wallA.y + wallB.y) / 2,
  };
  const prevFaces = previous?.faces || {};
  const out = [];
  const byId = {};
  const nextState = { faces: {} };

  for (const face of faces) {
    if (!face || !isPt(face.a) || !isPt(face.b)) continue;
    const spanLen = dist(face.a, face.b);
    if (!(spanLen > 0)) continue;

    // --- canonical face identity (survives endpoint reversal / reorder) ---
    const faceMid = { x: (face.a.x + face.b.x) / 2, y: (face.a.y + face.b.y) / 2 };
    const local = wallLocalPoint(frame, faceMid);
    const wallMidLocal = wallLocalPoint(frame, wallMid);
    const vOffset = local.v - wallMidLocal.v;
    // An exact tie means a zero-thickness/degenerate face; fall back to the
    // upstream face key rather than to floating-point residue.
    const canonicalFace = Math.abs(vOffset) <= TIE_EPS
      ? (face.faceKey === "B" ? CANONICAL_FACE.V_NEG : CANONICAL_FACE.V_POS)
      : (vOffset < 0 ? CANONICAL_FACE.V_NEG : CANONICAL_FACE.V_POS);

    // --- lane: push the dim line OUTWARD along this face's own normal ---
    // SegDim builds its normal from the span's stored a→b as
    //   n = (-dy/len, dx/len) * offsetSide
    // so offsetSide must be the sign that carries the line away from the wall.
    const sdx = (face.b.x - face.a.x) / spanLen;
    const sdy = (face.b.y - face.a.y) / spanLen;
    const spanLeft = { x: -sdy, y: sdx };
    const outward = { x: faceMid.x - wallMid.x, y: faceMid.y - wallMid.y };
    const outwardDot = outward.x * spanLeft.x + outward.y * spanLeft.y;
    const offsetSide = Math.abs(outwardDot) <= TIE_EPS
      ? (canonicalFace === CANONICAL_FACE.V_POS ? 1 : -1)
      : (outwardDot > 0 ? 1 : -1);

    // --- preferred position, expressed in CANONICAL u then mapped to the span ---
    // The face span always runs along the wall's stored a→b; when that is the
    // reversed direction the canonical t must be mirrored so the label keeps
    // the same physical end of the wall.
    const preferredCanonicalT = PREFERRED_FACE_T[canonicalFace];
    const toSpanT = (tCanon) => (frame.reversed ? 1 - tCanon : tCanon);

    // --- collision model in this span's own t units ---
    const intervals = [];
    for (const occ of occupancy || []) {
      const iv = occupancyIntervalT(occ, face, z);
      if (iv && iv.t >= -0.5 && iv.t <= 1.5) intervals.push(iv);
    }
    // Text half-width along the line, in t units (screen-clamped font).
    // Placement dodge keeps a slightly wider footprint than the painted text
    // knockout so labels stay clear of grips; paint uses TEXT_KNOCKOUT_PAD_PX.
    const labelHalfT = Math.min(LABEL_MAX_HALF_T, (28 / z) / spanLen);

    const candidates = SEARCH_OFFSETS_T.map((d) => {
      const tCanon = Math.min(T_MAX, Math.max(T_MIN, preferredCanonicalT + d));
      return { d, tCanon, tSpan: toSpanT(tCanon) };
    });
    const preferred = candidates[0];
    const preferredGap = clearanceAt(preferred.tSpan, intervals, labelHalfT);

    const prev = prevFaces[face.id] || null;
    const prevStillValid = prev
      && prev.canonicalFace === canonicalFace
      && candidates.some((c) => Math.abs(c.tCanon - prev.canonicalT) <= TIE_EPS)
      && clearanceAt(toSpanT(prev.canonicalT), intervals, labelHalfT) >= 0;

    let chosen = preferred;
    let reason = "preferred";
    if (preferredGap >= HYSTERESIS_T) {
      // Clear by the full margin — always come home to the deterministic spot.
      chosen = preferred;
      reason = "preferred";
    } else if (prevStillValid) {
      // Inside the hysteresis band, or genuinely blocked: retain the last valid
      // placement instead of re-running the search on every wheel frame.
      chosen = candidates.find((c) => Math.abs(c.tCanon - prev.canonicalT) <= TIE_EPS);
      reason = "retained";
    } else if (preferredGap >= 0) {
      chosen = preferred;
      reason = "preferred";
    } else {
      // Genuinely intersected: first collision-free offset in fixed order.
      // No largest-free-interval search — that is what made placement jump.
      const hit = candidates.find((c) => clearanceAt(c.tSpan, intervals, labelHalfT) >= 0);
      chosen = hit || preferred;
      reason = hit ? "shifted" : "preferred_blocked";
    }

    const dimA = {
      x: face.a.x + spanLeft.x * offsetSide * lane,
      y: face.a.y + spanLeft.y * offsetSide * lane,
    };
    const dimB = {
      x: face.b.x + spanLeft.x * offsetSide * lane,
      y: face.b.y + spanLeft.y * offsetSide * lane,
    };
    // Signed screen-px offset of this dim line from the wall mid, in the same
    // wall-local +v frame as visibleNudgeControlDisksPx (includes face thk/2).
    const dimMid = {
      x: (dimA.x + dimB.x) / 2,
      y: (dimA.y + dimB.y) / 2,
    };
    const dimLocal = wallLocalPoint(frame, dimMid);
    const lanePxSigned = (dimLocal.v - wallMidLocal.v) * z;
    const visualR = Number.isFinite(occupancy?.[0]?.visualClearPx)
      ? occupancy[0].visualClearPx
      : visibleCentreKnockoutRadiusPx(z);
    const knockouts = buildDimLineKnockouts({
      dimA,
      dimB,
      zoom: z,
      labelT: chosen.tSpan,
      labelHalfPx: TEXT_KNOCKOUT_PAD_PX + 18,
      clusterWorld: occupancy?.[0]?.point || occupancy?.[0] || null,
      visualClearPx: visualR,
      lanePx: lanePxSigned,
    });
    const entry = {
      id: face.id,
      faceKey: face.faceKey ?? null,
      canonicalFace,
      canonicalT: chosen.tCanon,
      labelT: chosen.tSpan,
      offsetSide,
      laneMm: lane,
      lanePx: lane * z,
      visualClearPx: visualR,
      reason,
      preferredGap,
      dimA,
      dimB,
      knockouts,
      segments: dimLineSegmentsFromKnockouts(dimA, dimB, knockouts),
      labelPos: {
        x: dimA.x + (dimB.x - dimA.x) * chosen.tSpan,
        y: dimA.y + (dimB.y - dimA.y) * chosen.tSpan,
      },
    };
    out.push(entry);
    byId[face.id] = entry;
    nextState.faces[face.id] = {
      canonicalFace,
      canonicalT: chosen.tCanon,
      offsetSide,
    };
  }

  return { byId, faces: out, state: nextState, frame };
}

/**
 * Full layout for ONE selected face dimension.
 * Thin wrapper over solveSelectedWallDimPresentation — there is exactly one
 * presentation solver, and this is not a second implementation of it.
 */
export function layoutSelectedFaceDimension({
  a,
  b,
  zoom = 1,
  offsetSide = -1,
  midWorld = null,
  wallA = null,
  wallB = null,
  faceKey = null,
  previous = null,
} = {}) {
  const offsetMm = nearWallLaneOffsetMm(zoom);
  if (!isPt(a) || !isPt(b)) {
    return {
      offsetMm, offsetSide: offsetSide >= 0 ? 1 : -1,
      dimA: null, dimB: null, labelT: 0.5, labelPos: null,
      knockouts: [], segments: [], lanePx: offsetMm * Math.max(Number(zoom) || 1, 1e-6),
    };
  }
  // Without an explicit centreline, derive one from the face span and the
  // requested side so the wrapper keeps its historical meaning.
  const len = dist(a, b) || 1;
  const leftX = -(b.y - a.y) / len;
  const leftY = (b.x - a.x) / len;
  const side = offsetSide >= 0 ? 1 : -1;
  const cA = wallA || { x: a.x - leftX * side * 1, y: a.y - leftY * side * 1 };
  const cB = wallB || { x: b.x - leftX * side * 1, y: b.y - leftY * side * 1 };

  const solved = solveSelectedWallDimPresentation({
    faces: [{ id: "face", a, b, faceKey }],
    wallA: cA,
    wallB: cB,
    zoom,
    laneMm: offsetMm,
    occupancy: midWorld ? [{
      point: midWorld,
      clearPx: INTERACTION_OCCUPANCY_PX,
      visualClearPx: visibleCentreKnockoutRadiusPx(zoom),
    }] : [],
    previous,
  });
  const e = solved.byId.face;
  if (!e) {
    return {
      offsetMm, offsetSide: side, dimA: null, dimB: null, labelT: 0.5,
      labelPos: null, knockouts: [], segments: [],
      lanePx: offsetMm * Math.max(Number(zoom) || 1, 1e-6),
    };
  }
  return {
    offsetMm,
    offsetSide: e.offsetSide,
    dimA: e.dimA,
    dimB: e.dimB,
    labelT: e.labelT,
    canonicalFace: e.canonicalFace,
    labelPos: e.labelPos,
    knockouts: e.knockouts,
    segments: e.segments,
    lanePx: e.lanePx,
    state: solved.state,
  };
}
