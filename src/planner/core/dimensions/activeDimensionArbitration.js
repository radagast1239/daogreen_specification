/**
 * PHASE 2F1-LIVE3 / LIVE4.3 — one visible dimension representation per active
 * physical span.
 *
 * Pure helpers: filter finalized dims while live/editor/edit-preview owns the
 * span. LIVE4.3 extends suppression from wall_length-only to any finalized
 * background kind (external_segment, room_edge_clear, …) that semantically
 * overlaps the selected live physical-face spans or shares wall lineage.
 */
import { canonicalizeEndpoints, quantizeMm } from "./dimensionCanonicalKeys.js";

const ANCHOR_TOL_MM = 2;
const OVERLAP_PAD_MM = 80;
const MIN_OVERLAP_RATIO = 0.35;

/** Finalized kinds that the selected-live overlay may replace. */
const REPLACEABLE_KINDS = new Set([
  "wall_length",
  "external_segment",
  "room_edge_clear",
  "internal_clear",
]);

export function physicalSpanKey(a, b, {
  kind = "wall_length",
  wallId = null,
  role = "length",
} = {}) {
  if (!a || !b) return null;
  const ends = canonicalizeEndpoints(a, b);
  const dx = Math.abs(ends.b.x - ends.a.x);
  const dy = Math.abs(ends.b.y - ends.a.y);
  const axis = dy <= ANCHOR_TOL_MM ? "h" : (dx <= ANCHOR_TOL_MM ? "v" : "d");
  const wid = wallId ? String(wallId) : "-";
  return `${kind}|${role}|${axis}|${ends.a.x}:${ends.a.y}|${ends.b.x}:${ends.b.y}|${wid}`;
}

export function dimensionPhysicalSpanKey(dim) {
  if (!dim?.p1 || !dim?.p2) return null;
  return physicalSpanKey(dim.p1, dim.p2, {
    kind: dim.kind || "wall_length",
    wallId: dim.wallId || dim.reference?.wallId || null,
    role: dim.semantic || dim.kind || "length",
  });
}

function wallIdOfDim(dim) {
  if (dim?.wallId) return String(dim.wallId);
  if (dim?.reference?.wallId) return String(dim.reference.wallId);
  const ids = dim?.sourceWallIds || dim?.reference?.sourceWallIds;
  if (Array.isArray(ids) && ids[0]) return String(ids[0]);
  const id = String(dim?.id || "");
  const m = id.match(/^auto-wall-len-(.+)-\d+$/);
  return m ? m[1] : null;
}

function sourceWallIdsOfDim(dim) {
  const out = new Set();
  const primary = wallIdOfDim(dim);
  if (primary) out.add(primary);
  const ids = dim?.sourceWallIds || dim?.reference?.sourceWallIds;
  if (Array.isArray(ids)) {
    for (const id of ids) {
      if (id != null) out.add(String(id));
    }
  }
  return out;
}

function anchorsNear(a, b, tol = ANCHOR_TOL_MM) {
  if (!a || !b) return false;
  return Math.hypot(a.x - b.x, a.y - b.y) <= tol;
}

function sameSpan(dim, span) {
  if (!dim?.p1 || !dim?.p2 || !span?.a || !span?.b) return false;
  const dEnds = canonicalizeEndpoints(dim.p1, dim.p2);
  const sEnds = canonicalizeEndpoints(span.a, span.b);
  return anchorsNear(dEnds.a, sEnds.a) && anchorsNear(dEnds.b, sEnds.b);
}

function axisOf(a, b) {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (dy <= ANCHOR_TOL_MM && dx > ANCHOR_TOL_MM) return "h";
  if (dx <= ANCHOR_TOL_MM && dy > ANCHOR_TOL_MM) return "v";
  return "d";
}

/**
 * Material overlap of two collinear-ish spans on the same axis.
 * Uses projected 1D overlap / min(lengths) — not display-text matching.
 */
export function spansMateriallyOverlap(a1, a2, b1, b2, {
  padMm = OVERLAP_PAD_MM,
  minRatio = MIN_OVERLAP_RATIO,
} = {}) {
  if (!a1 || !a2 || !b1 || !b2) return false;
  const axisA = axisOf(a1, a2);
  const axisB = axisOf(b1, b2);
  if (axisA === "d" || axisB === "d" || axisA !== axisB) {
    // Diagonal / mismatched: fall back to endpoint proximity only.
    return false;
  }
  if (axisA === "h") {
    const a0 = Math.min(a1.x, a2.x) - padMm;
    const a1x = Math.max(a1.x, a2.x) + padMm;
    const b0 = Math.min(b1.x, b2.x);
    const b1x = Math.max(b1.x, b2.x);
    const midY = (a1.y + a2.y) / 2;
    const midYb = (b1.y + b2.y) / 2;
    if (Math.abs(midY - midYb) > padMm + 40) return false;
    const overlap = Math.max(0, Math.min(a1x, b1x) - Math.max(a0, b0));
    const shorter = Math.max(1, Math.min(a1x - a0, b1x - b0));
    return overlap / shorter >= minRatio;
  }
  const a0 = Math.min(a1.y, a2.y) - padMm;
  const a1y = Math.max(a1.y, a2.y) + padMm;
  const b0 = Math.min(b1.y, b2.y);
  const b1y = Math.max(b1.y, b2.y);
  const midX = (a1.x + a2.x) / 2;
  const midXb = (b1.x + b2.x) / 2;
  if (Math.abs(midX - midXb) > padMm + 40) return false;
  const overlap = Math.max(0, Math.min(a1y, b1y) - Math.max(a0, b0));
  const shorter = Math.max(1, Math.min(a1y - a0, b1y - b0));
  return overlap / shorter >= minRatio;
}

function isReplaceableDim(dim) {
  if (!dim) return false;
  if (REPLACEABLE_KINDS.has(dim.kind)) return true;
  if (typeof dim.id === "string" && dim.id.startsWith("auto-wall-len-")) return true;
  return false;
}

/**
 * Suppress finalized dimensions that collide with the active interactive span.
 * Does NOT remove external_overall of a different non-overlapping span, nor
 * unrelated neighboring walls.
 *
 * LIVE4.3 interaction fields:
 *   wallIds        — selected logical lineage (all highlighted segments)
 *   liveFaceSpans  — [{a,b}, …] physical face spans of the live overlay
 */
export function filterDimensionsForActiveInteraction(dimensions = [], interaction = {}) {
  const {
    mode = null, // "draw" | "select_editor" | "edit_hold" | null
    wallId = null,
    wallIds = null,
    span = null, // { a, b }
    liveFaceSpans = null,
    hideAllFinalized = false,
  } = interaction || {};

  if (!Array.isArray(dimensions) || !dimensions.length) return dimensions || [];
  if (hideAllFinalized || mode === "draw") return [];

  const lineage = new Set(
    (Array.isArray(wallIds) && wallIds.length
      ? wallIds
      : (wallId ? [wallId] : [])
    ).map((id) => String(id)),
  );
  const faceSpans = Array.isArray(liveFaceSpans) && liveFaceSpans.length
    ? liveFaceSpans.filter((s) => s?.a && s?.b)
    : (span?.a && span?.b ? [span] : []);

  if (!lineage.size && !faceSpans.length) return dimensions;

  return dimensions.filter((dim) => {
    if (!dim || dim.visible === false) return false;
    if (!isReplaceableDim(dim)) return true;

    const sources = sourceWallIdsOfDim(dim);
    for (const id of sources) {
      if (lineage.has(id)) return false;
    }

    if (dim.p1 && dim.p2) {
      for (const s of faceSpans) {
        if (sameSpan(dim, s)) return false;
        if (spansMateriallyOverlap(dim.p1, dim.p2, s.a, s.b)) return false;
      }
    }
    return true;
  });
}

/**
 * Screen-space: push dimension label offset so it clears a handle rect.
 * Returns adjusted offsetSide multiplier hint / label nudge in world mm.
 */
export function dodgeDimensionAwayFromHandle({
  dimMid,
  handleWorld,
  zoom = 1,
  currentOffsetMm = 140,
  minClearPx = 22,
} = {}) {
  if (!dimMid || !handleWorld || !(zoom > 0)) {
    return { offsetMm: currentOffsetMm, nudgeWorld: { x: 0, y: 0 }, collided: false };
  }
  const dx = (dimMid.x - handleWorld.x) * zoom;
  const dy = (dimMid.y - handleWorld.y) * zoom;
  const distPx = Math.hypot(dx, dy);
  if (distPx >= minClearPx) {
    return { offsetMm: currentOffsetMm, nudgeWorld: { x: 0, y: 0 }, collided: false };
  }
  // Increase parallel offset so label/line clears the grip / arrow cluster.
  const extraPx = minClearPx - distPx + 8;
  const extraMm = extraPx / zoom;
  return {
    offsetMm: currentOffsetMm + extraMm,
    nudgeWorld: { x: 0, y: 0 },
    collided: true,
  };
}

/**
 * LIVE4: dodge against a full occupancy set (centre grip, arrows, endpoints,
 * float editor hotspot). One calculation — callers should invoke once per frame.
 */
export function dodgeDimensionAwayFromOccupancy({
  dimMid,
  occupancy = [],
  zoom = 1,
  currentOffsetMm = 180,
  minClearPx = 28,
} = {}) {
  let offsetMm = currentOffsetMm;
  let collided = false;
  for (const item of occupancy) {
    const pt = item?.point || item;
    if (!pt || !Number.isFinite(pt.x)) continue;
    const clear = Number.isFinite(item.clearPx) ? item.clearPx : minClearPx;
    const hit = dodgeDimensionAwayFromHandle({
      dimMid,
      handleWorld: pt,
      zoom,
      currentOffsetMm: offsetMm,
      minClearPx: clear,
    });
    if (hit.collided) {
      collided = true;
      offsetMm = hit.offsetMm;
    }
  }
  return { offsetMm, collided };
}

export function countVisibleLengthLabels(texts = []) {
  return (texts || []).filter((t) => /^\d+([.,]\d+)?\s*м$/.test(String(t).trim())).length;
}

void quantizeMm;
