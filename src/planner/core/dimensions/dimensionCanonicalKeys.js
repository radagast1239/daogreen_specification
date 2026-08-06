/**
 * PHASE 2F1 — canonical dimension identity.
 *
 * Generated auto-dimension IDs must not depend on wall/room array index,
 * iteration order, wall endpoint orientation, or incidental polygon start
 * vertex. Keys are built from semantic kind + quantized world-space anchors.
 *
 * Pure: no React, no plan mutation.
 */

const Q = 1; // mm quantization for identity (integer millimetres)

export function quantizeMm(v, step = Q) {
  if (!Number.isFinite(v)) return 0;
  const s = step > 0 ? step : Q;
  return Math.round(v / s) * s;
}

export function canonicalizeEndpoints(a, b) {
  if (!a || !b) return { a: a || { x: 0, y: 0 }, b: b || { x: 0, y: 0 } };
  const ax = quantizeMm(a.x);
  const ay = quantizeMm(a.y);
  const bx = quantizeMm(b.x);
  const by = quantizeMm(b.y);
  // Lexicographic order so reversed wall orientation yields the same key.
  if (ax < bx || (ax === bx && ay < by)) {
    return { a: { x: ax, y: ay }, b: { x: bx, y: by } };
  }
  return { a: { x: bx, y: by }, b: { x: ax, y: ay } };
}

export function envelopeStableKey(env) {
  const bb = env?.bbox;
  if (!bb || !Number.isFinite(bb.x0) || !Number.isFinite(bb.y0)) {
    return "env:unknown";
  }
  return `env:${quantizeMm(bb.x0)}:${quantizeMm(bb.y0)}:${quantizeMm(bb.w)}:${quantizeMm(bb.h)}`;
}

export function roomStableKey(rc) {
  if (rc?.roomId) return `room:${rc.roomId}`;
  if (rc?.regionId) return `region:${rc.regionId}`;
  const c = rc?.centroid;
  if (c && Number.isFinite(c.x) && Number.isFinite(c.y)) {
    return `anon:${quantizeMm(c.x)}:${quantizeMm(c.y)}`;
  }
  return "anon:unknown";
}

/**
 * Stable auto-dimension id from semantic category + world anchors.
 * @param {"external_overall"|"external_segment"|"internal_clear"|"room_edge_clear"|"wall_length"} kind
 */
export function buildDimensionGenerationKey({
  kind,
  orientation,
  axis,
  p1,
  p2,
  envelopeKey,
  roomKey,
  wallId,
  sourceWallIds,
} = {}) {
  const ends = canonicalizeEndpoints(p1, p2);
  const ori = orientation || "horizontal";
  const ax = axis || "";
  if (kind === "external_overall") {
    return `auto:ext-ov:${envelopeKey || "env"}:${ori}`;
  }
  if (kind === "external_segment") {
    return `auto:ext-seg:${ori}:${ends.a.x}:${ends.a.y}:${ends.b.x}:${ends.b.y}`;
  }
  if (kind === "internal_clear") {
    const slot = ax === "height" || ori === "vertical" ? "h" : "w";
    return `auto:int-clear:${roomKey || "room"}:${slot}`;
  }
  if (kind === "room_edge_clear") {
    return `auto:room-edge:${roomKey || "room"}:${ends.a.x}:${ends.a.y}:${ends.b.x}:${ends.b.y}`;
  }
  if (kind === "wall_length") {
    const wid = wallId || (Array.isArray(sourceWallIds) ? sourceWallIds.slice().sort().join("+") : "wall");
    return `auto:wall-len:${wid}:${ends.a.x}:${ends.a.y}:${ends.b.x}:${ends.b.y}`;
  }
  return `auto:${kind || "dim"}:${ori}:${ends.a.x}:${ends.a.y}:${ends.b.x}:${ends.b.y}`;
}

export function dimensionMeasuredValueMm(dim) {
  if (!dim) return NaN;
  if (Number.isFinite(dim.measurementValue)) return dim.measurementValue;
  if (dim.p1 && dim.p2) {
    return Math.hypot(dim.p2.x - dim.p1.x, dim.p2.y - dim.p1.y);
  }
  return NaN;
}

/** Sorted key-set fingerprint for Undo/Redo / reload assertions. */
export function dimensionKeySet(dims = []) {
  return (dims || [])
    .filter((d) => d && d.auto === true)
    .map((d) => d.generationKey || d.id)
    .filter(Boolean)
    .sort()
    .join("|");
}
