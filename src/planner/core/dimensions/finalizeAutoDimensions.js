/**
 * PHASE 2F1 — single authoritative final arbitration for automatic dimensions.
 *
 * All auto pipelines feed here. The renderer receives only finalized records.
 * Owns: semantic validation, physical-span dedupe, precedence, side/lane
 * assignment, visibility gating metadata. No second React-side dedupe.
 *
 * Pure: no React, no plan mutation.
 */
import { quantizeMm, canonicalizeEndpoints } from "./dimensionCanonicalKeys.js";
import { formatDimensionValue } from "./display.js";
import { validateDimensionAnchors } from "./dimensionFaceResolver.js";
import { CONTOUR_DIAGNOSTICS, pointInLoop, segmentIntersectsWallMass } from "../walls/renderedContours.js";
import {
  classifyContourRoles,
  classifyDimensionSemantic,
  isForbiddenRoomBoundingBox,
} from "./contourSemantics.js";
import {
  EXTERNAL_SEGMENT_MARGIN_MM,
  EXTERNAL_OVERALL_MARGIN_MM,
  EXTERNAL_OVERALL_ALONE_MARGIN_MM,
} from "./exteriorChainDimensions.js";

const MIN_RENDER_MM = 100;
const ANCHOR_Q = 2; // mm — merge overall/local with identical envelope anchors

/** Explicit lanes (semantics → placement). */
export const DIM_LANE = Object.freeze({
  ROOM_EDGE_NEAR: "ROOM_EDGE_NEAR",
  EXTERIOR_LOCAL_NEAR: "EXTERIOR_LOCAL_NEAR",
  EXTERIOR_OVERALL_FAR: "EXTERIOR_OVERALL_FAR",
  EXTERIOR_OVERALL_ALONE: "EXTERIOR_OVERALL_ALONE",
  LEGACY: "LEGACY",
});

const LANE_GAP_MM = Object.freeze({
  [DIM_LANE.ROOM_EDGE_NEAR]: EXTERNAL_SEGMENT_MARGIN_MM,
  [DIM_LANE.EXTERIOR_LOCAL_NEAR]: EXTERNAL_SEGMENT_MARGIN_MM,
  [DIM_LANE.EXTERIOR_OVERALL_FAR]: EXTERNAL_OVERALL_MARGIN_MM,
  [DIM_LANE.EXTERIOR_OVERALL_ALONE]: EXTERNAL_OVERALL_ALONE_MARGIN_MM,
  [DIM_LANE.LEGACY]: EXTERNAL_SEGMENT_MARGIN_MM,
});

/** Precedence within the same physical span (higher wins), before special rules. */
const PIPELINE_PRIORITY = {
  room_edge_clear: 100,
  external_segment: 80,
  external_overall: 70,
  internal_clear: 50,
  opening: 40,
  pier: 40,
  rack_aisle: 30,
  wall_length: 20,
};

export function dimensionMeasuredSpanMm(dim) {
  if (Number.isFinite(dim?.measurementValue) && dim.measurementValue > 0) {
    return dim.measurementValue;
  }
  if (!dim?.p1 || !dim?.p2) return 0;
  return Math.hypot(dim.p2.x - dim.p1.x, dim.p2.y - dim.p1.y);
}

export function dimensionFormattedLabel(dim, displayMode = "remplanner_cm") {
  if (dim?.labelOverride != null && String(dim.labelOverride).trim() !== "") {
    return String(dim.labelOverride).trim();
  }
  const span = dimensionMeasuredSpanMm(dim);
  if (!(span > 0)) return "";
  return formatDimensionValue(span, displayMode);
}

export function isRenderableAutoDimension(dim, displayMode = "remplanner_cm") {
  if (!dim || dim.visible === false) return false;
  if (dim.mode === "annotation") {
    return !!(dim.labelOverride && String(dim.labelOverride).trim());
  }
  if (dim.mode === "angle") {
    return Number.isFinite(dim.angle) && Number.isFinite(dim?.p1?.x);
  }
  if (!dim.p1 || !dim.p2) return false;
  if (![dim.p1.x, dim.p1.y, dim.p2.x, dim.p2.y].every(Number.isFinite)) return false;
  if (Number.isFinite(dim.measurementValue) && !(dim.measurementValue > 0)) return false;
  const span = dimensionMeasuredSpanMm(dim);
  if (!(span >= MIN_RENDER_MM)) return false;
  if (!dimensionFormattedLabel(dim, displayMode)) return false;
  if (dim.kind === "wall_thickness") return false;
  return true;
}

function sideOfBoundary(dim) {
  if (dim?.reference?.side === "outer"
    || dim?.kind === "external_overall"
    || dim?.kind === "external_segment") {
    return "outer";
  }
  if (dim?.reference?.side === "inner"
    || dim?.reference?.side === "room"
    || dim?.kind === "room_edge_clear"
    || dim?.kind === "internal_clear") {
    return "inner";
  }
  return "_";
}

function contourIdentity(dim) {
  return dim.roomId
    || dim.reference?.roomId
    || dim.reference?.envelopeId
    || dim.reference?.envelopeKey
    || "_";
}

/**
 * Canonical key for the exact physical span.
 * Kind and face-id labels are intentionally excluded so exterior_local and
 * exterior_overall that share the same envelope-edge anchors collide.
 * Distinct legs keep distinct anchors and therefore distinct keys.
 */
export function buildPhysicalSpanKey(dim) {
  if (!dim?.p1 || !dim?.p2) return null;
  const { a: p1, b: p2 } = canonicalizeEndpoints(
    { x: quantizeMm(dim.p1.x, ANCHOR_Q), y: quantizeMm(dim.p1.y, ANCHOR_Q) },
    { x: quantizeMm(dim.p2.x, ANCHOR_Q), y: quantizeMm(dim.p2.y, ANCHOR_Q) },
  );
  if (!p1 || !p2) return null;
  const span = quantizeMm(dimensionMeasuredSpanMm(dim), ANCHOR_Q);
  return [
    sideOfBoundary(dim),
    contourIdentity(dim),
    p1.x, p1.y, p2.x, p2.y,
    span,
  ].join(":");
}

export function buildSoftSemanticDedupeKey(dim) {
  if (!dim?.p1 || !dim?.p2) return null;
  const midX = Math.round(((dim.p1.x + dim.p2.x) / 2) / 50) * 50;
  const midY = Math.round(((dim.p1.y + dim.p2.y) / 2) / 50) * 50;
  const span = Math.round(dimensionMeasuredSpanMm(dim) / 50) * 50;
  const room = contourIdentity(dim);
  const dir = dim.orientation || dim.axisOrDirection || "_";
  const face = sideOfBoundary(dim) === "outer" ? "outer" : "room";
  return `${face}:${room}:${dir}:${midX}:${midY}:${span}`;
}

function priority(dim) {
  return PIPELINE_PRIORITY[dim?.kind] ?? 0;
}

/** Anchor tolerance below which two records describe one physical span. */
const SAME_SPAN_ANCHOR_MM = 2;
const SAME_SPAN_VALUE_MM = 5;

/**
 * Do these two records measure the SAME physical span?
 * Endpoint order is irrelevant, so both pairings are tried.
 */
function spansCoincide(a, b) {
  if (!a?.p1 || !a?.p2 || !b?.p1 || !b?.p2) return false;
  const d = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  const direct = Math.max(d(a.p1, b.p1), d(a.p2, b.p2));
  const swapped = Math.max(d(a.p1, b.p2), d(a.p2, b.p1));
  if (Math.min(direct, swapped) > SAME_SPAN_ANCHOR_MM) return false;
  const va = dimensionMeasuredSpanMm(a);
  const vb = dimensionMeasuredSpanMm(b);
  return Math.abs(va - vb) <= SAME_SPAN_VALUE_MM;
}

/**
 * Special arbitration: same physical anchors → prefer overall over local edge
 * (removes doubled 8.10 top/left rows). Otherwise higher pipeline priority wins.
 */
function pickWinner(a, b) {
  const kinds = new Set([a.kind, b.kind]);
  if (kinds.has("external_segment") && kinds.has("external_overall")) {
    return a.kind === "external_overall" ? a : b;
  }
  if (priority(a) !== priority(b)) return priority(a) > priority(b) ? a : b;
  return String(a.id || "").localeCompare(String(b.id || "")) <= 0 ? a : b;
}

export function normalizeAutoDimensionLabels(dims, displayMode = "remplanner_cm") {
  return (dims || []).map((dim) => {
    const span = dimensionMeasuredSpanMm(dim);
    const label = dimensionFormattedLabel({ ...dim, measurementValue: span }, displayMode);
    return {
      ...dim,
      measurementValue: span > 0 ? span : dim.measurementValue,
      labelOverride: (dim.labelOverride != null && String(dim.labelOverride).trim() !== "")
        ? dim.labelOverride
        : (label || null),
    };
  });
}

function allFillPolygons(contours) {
  const out = [];
  for (const c of contours?.components || []) out.push(...(c.fillPolygons || []));
  return out;
}

function allOuterLoops(contours) {
  const loops = [];
  for (const env of contours?.envelopes || []) {
    const comp = (contours.components || []).find((c) => c.id === env.componentId);
    for (const ol of comp?.outerLoops || []) {
      const loop = ol.loop || ol;
      if (loop?.length >= 3) loops.push(loop);
    }
  }
  return loops;
}

function roomPolygonFor(dim, contours) {
  const id = dim.roomId || dim.reference?.roomId;
  if (id) {
    const rc = (contours?.roomContours || []).find((r) => r.roomId === id);
    if (rc?.roomPolygon) return rc.roomPolygon;
    if (rc?.loop) return rc.loop;
  }
  // Fallback: largest room contour containing the midpoint.
  const mid = {
    x: ((dim.p1?.x || 0) + (dim.p2?.x || 0)) / 2,
    y: ((dim.p1?.y || 0) + (dim.p2?.y || 0)) / 2,
  };
  let best = null;
  let bestArea = 0;
  for (const rc of contours?.roomContours || []) {
    const poly = rc.roomPolygon || rc.loop;
    if (!poly || !pointInLoop(mid, poly)) continue;
    const area = Math.abs(rc.area) || poly.length;
    if (area > bestArea) { bestArea = area; best = poly; }
  }
  return best;
}

/**
 * Authoritative inside/outside: sample both normals at the midpoint; pick the
 * side that matches the semantic (room inside / exterior outside). Fail-closed
 * keeps existing offset when ambiguous (diagnostic recorded).
 */
export function classifyDimensionSide(dim, contours) {
  if (!dim?.p1 || !dim?.p2 || !contours) {
    return { ok: false, reason: "MISSING_INPUT", sign: Math.sign(dim?.offset) || 1 };
  }
  const dx = dim.p2.x - dim.p1.x;
  const dy = dim.p2.y - dim.p1.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const mid = { x: (dim.p1.x + dim.p2.x) / 2, y: (dim.p1.y + dim.p2.y) / 2 };
  const probe = 12;
  const plus = { x: mid.x + nx * probe, y: mid.y + ny * probe };
  const minus = { x: mid.x - nx * probe, y: mid.y - ny * probe };
  const fills = allFillPolygons(contours);
  const inFill = (p) => fills.some((poly) => pointInLoop(p, poly));
  const wantOuter = sideOfBoundary(dim) === "outer";

  if (wantOuter) {
    // Outer: pick the probe that is NOT in wall mass (exterior free space).
    const plusOut = !inFill(plus);
    const minusOut = !inFill(minus);
    if (plusOut === minusOut) {
      return {
        ok: false,
        reason: "AMBIGUOUS_EXTERIOR_SIDE",
        sign: Math.sign(dim.offset) || -1,
        normal: { x: nx, y: ny },
      };
    }
    return { ok: true, reason: null, sign: plusOut ? 1 : -1, normal: { x: nx, y: ny } };
  }

  const roomPoly = roomPolygonFor(dim, contours);
  if (!roomPoly) {
    return {
      ok: false,
      reason: "NO_ROOM_POLYGON",
      sign: Math.sign(dim.offset) || 1,
      normal: { x: nx, y: ny },
    };
  }
  const plusIn = pointInLoop(plus, roomPoly) && !inFill(plus);
  const minusIn = pointInLoop(minus, roomPoly) && !inFill(minus);
  if (plusIn === minusIn) {
    return {
      ok: false,
      reason: "AMBIGUOUS_ROOM_SIDE",
      sign: Math.sign(dim.offset) || 1,
      normal: { x: nx, y: ny },
    };
  }
  return {
    ok: true,
    reason: null,
    sign: plusIn ? 1 : -1,
    normal: { x: nx, y: ny },
  };
}

function assignLane(dim, peers) {
  if (dim.kind === "room_edge_clear" || dim.kind === "internal_clear") {
    return DIM_LANE.ROOM_EDGE_NEAR;
  }
  if (dim.kind === "external_segment") return DIM_LANE.EXTERIOR_LOCAL_NEAR;
  if (dim.kind === "external_overall") {
    const envId = dim.reference?.envelopeId || "_";
    const ori = dim.orientation || dim.axisOrDirection;
    const hasLocal = peers.some((p) => (
      p !== dim
      && p.kind === "external_segment"
      && (p.reference?.envelopeId || "_") === envId
      && (p.orientation || p.axisOrDirection) === ori
    ));
    return hasLocal ? DIM_LANE.EXTERIOR_OVERALL_FAR : DIM_LANE.EXTERIOR_OVERALL_ALONE;
  }
  return DIM_LANE.LEGACY;
}

/**
 * Same-side lane ladders (PHASE 2F1 layout contract).
 *
 * A narrowing room must never push an internal dimension through its wall into
 * the exterior lane: the side is locked by semantics, only the gap may shrink.
 * Exterior dimensions move farther out instead of inward for the same reason.
 */
const INTERNAL_LANE_LADDER_MM = [120, 90, 70, 50, 40, 30, 20];
const EXTERIOR_LANE_EXTRA_MM = [0, 40, 80, 120, 180];

function isInternalKind(kind) {
  return kind === "room_edge_clear" || kind === "internal_clear";
}

function isExteriorKind(kind) {
  return kind === "external_segment" || kind === "external_overall";
}

function applyLanePlacement(dim, lane, side, gapOverride = null) {
  const gap = Number.isFinite(gapOverride)
    ? gapOverride
    : (LANE_GAP_MM[lane] ?? EXTERNAL_SEGMENT_MARGIN_MM);
  // Prefer classified sign; on ambiguity keep the generator's existing sign.
  const sign = side.ok
    ? (side.sign || Math.sign(dim.offset) || 1)
    : (Math.sign(dim.offset) || side.sign || 1);
  const nx = side.normal?.x;
  const ny = side.normal?.y;
  const offset = sign * gap;
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
    return {
      ...dim,
      offset,
      offsetSide: sign,
      lane,
      renderGroup: lane,
      arbitration: {
        ...(dim.arbitration || {}),
        lane,
        sideOk: side.ok,
        sideReason: side.reason,
      },
    };
  }
  const baselineStart = {
    x: dim.p1.x + nx * offset,
    y: dim.p1.y + ny * offset,
  };
  const baselineEnd = {
    x: dim.p2.x + nx * offset,
    y: dim.p2.y + ny * offset,
  };
  return {
    ...dim,
    offset,
    offsetSide: sign,
    lane,
    renderGroup: lane,
    baselineStart,
    baselineEnd,
    labelPoint: {
      x: (baselineStart.x + baselineEnd.x) / 2,
      y: (baselineStart.y + baselineEnd.y) / 2,
    },
    witnessA: dim.witnessA || { ...dim.p1 },
    witnessB: dim.witnessB || { ...dim.p2 },
    extensionA: [dim.witnessA || dim.p1, baselineStart],
    extensionB: [dim.witnessB || dim.p2, baselineEnd],
    arbitration: {
      ...(dim.arbitration || {}),
      lane,
      laneGapMm: gap,
      sideOk: !!side.ok,
      sideReason: side.reason || null,
      physicalSpanKey: buildPhysicalSpanKey(dim),
    },
  };
}

/** Midpoint of a placed baseline (falls back to the anchor span). */
function placedMid(dim) {
  const a = dim.baselineStart || dim.p1;
  const b = dim.baselineEnd || dim.p2;
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Lock the sign to the semantic side, then walk the ladder on THAT side only.
 * Returns the first placement that satisfies the side invariant, or null.
 */
function placeOnLockedSide(dim, lane, side, fills, roomPoly, allRoomPolys) {
  const internal = isInternalKind(dim.kind);
  const baseGap = LANE_GAP_MM[lane] ?? EXTERNAL_SEGMENT_MARGIN_MM;
  const ladder = internal
    ? INTERNAL_LANE_LADDER_MM.filter((g) => g <= baseGap).concat(
      INTERNAL_LANE_LADDER_MM.filter((g) => g > baseGap),
    )
    : EXTERIOR_LANE_EXTRA_MM.map((extra) => baseGap + extra);

  // Sign that provably points to the semantic side; never re-derived per gap.
  let sign = side.ok
    ? (side.sign || Math.sign(dim.offset) || 1)
    : (Math.sign(dim.offset) || side.sign || 1);
  if (internal && roomPoly && Number.isFinite(side.normal?.x)) {
    const mid = { x: (dim.p1.x + dim.p2.x) / 2, y: (dim.p1.y + dim.p2.y) / 2 };
    const probe = 15;
    const plusIn = pointInLoop({ x: mid.x + side.normal.x * probe, y: mid.y + side.normal.y * probe }, roomPoly);
    const minusIn = pointInLoop({ x: mid.x - side.normal.x * probe, y: mid.y - side.normal.y * probe }, roomPoly);
    if (plusIn !== minusIn) sign = plusIn ? 1 : -1;
  }

  for (const gap of ladder) {
    const candidate = applyLanePlacement(dim, lane, { ...side, sign, ok: true }, gap);
    const mid = placedMid(candidate);
    if (!mid) continue;
    if (internal) {
      if (roomPoly && !pointInLoop(mid, roomPoly)) continue;
    } else if (allRoomPolys?.length && allRoomPolys.some((poly) => pointInLoop(mid, poly))) {
      continue;
    }
    if (!baselineClearsMass(candidate, fills)) continue;
    return candidate;
  }
  return null;
}

/**
 * Reject a placement whose baseline midpoint sits in wall mass.
 */
function baselineClearsMass(dim, fills) {
  if (!dim?.baselineStart || !dim?.baselineEnd || !fills?.length) return true;
  const mid = {
    x: (dim.baselineStart.x + dim.baselineEnd.x) / 2,
    y: (dim.baselineStart.y + dim.baselineEnd.y) / 2,
  };
  if (fills.some((poly) => pointInLoop(mid, poly))) return false;
  if (segmentIntersectsWallMass(dim.baselineStart, dim.baselineEnd, fills, { stepMm: 30 })) {
    return false;
  }
  return true;
}

export function finalizeAutoDimensions(dims, opts = {}) {
  const displayMode = opts.displayMode || "remplanner_cm";
  const hasRooms = !!opts.hasRoomContours;
  const hasEnvelopes = !!opts.hasEnvelopes;
  const contours = opts.contours || null;
  const diagnostics = [];

  let list = normalizeAutoDimensionLabels(dims, displayMode);

  if (!hasRooms && !hasEnvelopes) {
    list = list.filter((d) => ![
      "room_edge_clear", "internal_clear",
      "external_segment", "external_overall",
    ].includes(d.kind));
    if (opts.suppressOpenJunctionWallLength) {
      list = list.filter((d) => d.kind !== "wall_length");
    }
  }

  list = list.filter((d) => isRenderableAutoDimension(d, displayMode));

  // --- PHASE 2F1 blocker A: SEMANTIC gate (before any span arbitration) ---
  //
  // Every record is stamped with what it actually MEANS, decided from the role
  // of its contour and from how its value was obtained. ROOM_BOUNDING_BOX_*
  // is then removed from the finalized set outright — not hidden by CSS, not
  // gated on zoom — so a rectangular envelope can never be presented as a room
  // width/height, and a bbox extent can never win a physical span below.
  if (contours) {
    const roles = classifyContourRoles(contours);
    const kept = [];
    for (const dim of list) {
      const semantic = classifyDimensionSemantic(dim, contours, roles);
      if (isForbiddenRoomBoundingBox(semantic.semantic)) {
        diagnostics.push({
          code: CONTOUR_DIAGNOSTICS.ROOM_BOUNDING_BOX_SEMANTICS_REJECTED,
          id: dim.id,
          generationKey: dim.generationKey || dim.id,
          kind: dim.kind,
          semanticType: semantic.semantic,
          contourId: semantic.contourId,
          contourRole: semantic.contourRole,
          measuredValueMm: dimensionMeasuredSpanMm(dim),
          reason: semantic.reason,
        });
        continue;
      }
      kept.push({
        ...dim,
        semanticType: semantic.semantic,
        arbitration: {
          ...(dim.arbitration || {}),
          semanticType: semantic.semantic,
          contourId: semantic.contourId,
          contourRole: semantic.contourRole,
          semanticReason: semantic.reason,
        },
      });
    }
    list = kept;
  }

  // --- physical-span arbitration (one record per exact span) ---
  const bySpan = new Map();
  const rejections = [];
  for (const dim of list) {
    const key = buildPhysicalSpanKey(dim) || `id:${dim.id}`;
    const prev = bySpan.get(key);
    if (!prev) {
      bySpan.set(key, dim);
      continue;
    }
    const winner = pickWinner(prev, dim);
    const loser = winner === prev ? dim : prev;
    rejections.push({
      code: "PHYSICAL_SPAN_DEDUPED",
      kept: winner.id,
      suppressed: loser.id,
      keptKind: winner.kind,
      suppressedKind: loser.kind,
      key,
      reason: (winner.kind === "external_overall" && loser.kind === "external_segment")
        ? "local_identical_to_overall"
        : "lower_precedence",
    });
    bySpan.set(key, winner);
  }
  list = [...bySpan.values()];
  diagnostics.push(...rejections);

  // The exact-key pass above collapses records whose QUANTIZED anchors match.
  // A local edge and the overall of a square envelope can still survive it when
  // contour granularity differs (the metrology gate reproduced this by placing
  // the identical plan far from the origin). pickWinner's documented intent —
  // same physical span, prefer the overall — is therefore also applied to the
  // geometric relation, so one physical span can never show two labels.
  const overalls = list.filter((d) => d.kind === "external_overall");
  if (overalls.length) {
    const shadowed = new Set();
    for (const seg of list) {
      if (seg.kind !== "external_segment") continue;
      const twin = overalls.find((ov) => spansCoincide(seg, ov));
      if (!twin) continue;
      shadowed.add(seg);
      diagnostics.push({
        code: "PHYSICAL_SPAN_DEDUPED",
        kept: twin.id,
        suppressed: seg.id,
        keptKind: twin.kind,
        suppressedKind: seg.kind,
        reason: "local_coincides_with_overall",
      });
    }
    if (shadowed.size) list = list.filter((d) => !shadowed.has(d));
  }

  // Kill legacy wall_length / internal_clear ghosts next to face pipelines.
  //
  // The soft key includes the contour identity, and a legacy wall_length record
  // carries neither roomId nor envelopeId. So a wall_length lying exactly on an
  // external_segment's span produced two visible labels for ONE physical span —
  // found by the metrology gate on the real-mouse project. Geometric
  // coincidence is therefore checked as well as the semantic key: same anchors
  // (within 2mm), same length and parallel. Genuine inner/outer face pairs are
  // a wall thickness apart and can never collide at that tolerance.
  const FACE_KINDS = new Set(["room_edge_clear", "external_overall", "external_segment"]);
  list = list.filter((dim) => {
    if (dim.kind !== "wall_length" && dim.kind !== "internal_clear") return true;
    const soft = buildSoftSemanticDedupeKey(dim);
    let reason = null;
    const covered = list.some((other) => {
      if (other === dim || !FACE_KINDS.has(other.kind)) return false;
      if (buildSoftSemanticDedupeKey(other) === soft) {
        reason = "covered_by_canonical_face";
        return true;
      }
      if (spansCoincide(dim, other)) {
        reason = "same_physical_span_as_canonical_face";
        return true;
      }
      return false;
    });
    if (covered) {
      diagnostics.push({
        code: "LEGACY_SOFT_SUPPRESSED",
        id: dim.id,
        kind: dim.kind,
        reason,
      });
    }
    return !covered;
  });

  // Room-edge records are never dropped for being tight: lane placement below
  // keeps them on the room side (PHASE 2F1 narrow-room layout contract).

  // --- side classification + lane assignment ---
  // Authoritative inside/outside applies to face pipelines only. Legacy
  // wall_length / openings keep generator placement (accepted Phase 2E offsets).
  const FACE_PIPELINES = new Set([
    "room_edge_clear", "internal_clear", "external_segment", "external_overall",
  ]);
  const fills = allFillPolygons(contours);
  const roomPolys = (contours?.roomContours || [])
    .map((rc) => rc.roomPolygon || rc.loop)
    .filter((poly) => poly && poly.length >= 3);
  const placed = [];
  for (const dim of list) {
    if (!FACE_PIPELINES.has(dim.kind) || !contours) {
      const lane = assignLane(dim, list);
      placed.push({
        ...dim,
        lane,
        renderGroup: lane,
        arbitration: {
          ...(dim.arbitration || {}),
          lane,
          physicalSpanKey: buildPhysicalSpanKey(dim),
          sideOk: true,
          sideReason: "legacy_passthrough",
        },
      });
      continue;
    }
    const side = classifyDimensionSide(dim, contours);
    if (!side.ok) {
      diagnostics.push({
        code: "SIDE_CLASSIFICATION_AMBIGUOUS",
        id: dim.id,
        kind: dim.kind,
        reason: side.reason,
      });
    }
    const lane = assignLane(dim, list);
    const roomPoly = isInternalKind(dim.kind) ? roomPolygonFor(dim, contours) : null;
    // Side is a semantic invariant: an internal dimension may only move to a
    // tighter lane on the room side, an exterior one only farther out. A
    // narrowing room must never flip a label through the wall (PHASE 2F1).
    let next = placeOnLockedSide(dim, lane, side, fills, roomPoly, roomPolys);
    if (!next) {
      diagnostics.push({
        code: isInternalKind(dim.kind) ? "INTERNAL_LANE_FALLBACK_GENERATOR" : "EXTERIOR_LANE_FALLBACK_GENERATOR",
        id: dim.id,
        kind: dim.kind,
        reason: "no_ladder_lane_fits_on_semantic_side",
      });
      // Fail-closed on side invention: keep the generator's own validated
      // baseline (already resolved on the correct side) instead of flipping.
      next = {
        ...dim,
        lane,
        renderGroup: lane,
        arbitration: {
          ...(dim.arbitration || {}),
          lane,
          laneGapMm: Math.abs(dim.offset) || null,
          sideOk: false,
          sideReason: "GENERATOR_LANE_KEPT",
          physicalSpanKey: buildPhysicalSpanKey(dim),
        },
      };
    }
    placed.push(next);
  }
  list = placed;

  if (opts.contours && opts.collectAnchorDiagnostics) {
    const anchorDiags = [];
    for (const dim of list) {
      if (dim.kind !== "wall_length") continue;
      const v = validateDimensionAnchors(dim, opts.contours, { pipeline: dim.kind });
      if (!v.ok || v.centrelineRisk) anchorDiags.push(v);
    }
    opts.collectAnchorDiagnostics(anchorDiags);
  }

  if (opts.collectArbitrationDiagnostics) {
    opts.collectArbitrationDiagnostics(diagnostics);
  }

  // Stable order for deterministic render.
  list.sort((a, b) => {
    const pa = priority(a);
    const pb = priority(b);
    if (pb !== pa) return pb - pa;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });

  return list;
}

/** True when a dim is associated with a wall (for selection emphasis only). */
export function dimensionCoversWallId(dim, wallId) {
  if (!dim || wallId == null) return false;
  const id = String(wallId);
  if (dim.wallId != null && String(dim.wallId) === id) return true;
  const ids = dim.sourceWallIds || dim.reference?.sourceWallIds || [];
  if (ids.some((w) => String(w) === id)) return true;
  if (typeof dim.id === "string" && dim.id.includes(id)) return true;
  return false;
}
