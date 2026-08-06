const REVIEW = "DIMENSION_ANCHOR_NEEDS_REVIEW";
const INVALID = "DIMENSION_ANCHOR_INVALID";

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const point = (p) => ({ x: Number(p?.x) || 0, y: Number(p?.y) || 0 });
const wallIdOf = (a) => a?.wallId ?? a?.id ?? null;
const nodeIdOf = (a) => a?.nodeId ?? a?.id ?? null;
const itemIdOf = (a) => a?.itemId ?? a?.id ?? null;
const wallEnds = (plan, wall) => {
  if (!wall) return null;
  if (wall.a && wall.b && plan?.nodes?.[wall.a] && plan?.nodes?.[wall.b]) {
    return [point(plan.nodes[wall.a]), point(plan.nodes[wall.b])];
  }
  const pts = wall.pts || [];
  return pts.length >= 2 ? [point(pts[0]), point(pts[pts.length - 1])] : null;
};
const warning = (dimensionId, code = INVALID, extra = {}) => ({ code, dimensionId, ...extra });
const result = (dimensions, changed, affectedDimensionIds = [], warnings = []) => ({
  dimensions, changed, affectedDimensionIds: [...new Set(affectedDimensionIds)], warnings,
});

export function normalizeDimensionAnchor(raw) {
  if (!raw || typeof raw !== "object") return null;
  const type = raw.type;
  if (type === "node") return { ...clone(raw), type, nodeId: nodeIdOf(raw) };
  if (type === "item") return { ...clone(raw), type, itemId: itemIdOf(raw) };
  if (type === "free" || type === "point" || type === "free_point") {
    return { ...clone(raw), type: "free", point: point(raw.point || raw) };
  }
  if (type === "wall_endpoint") return { ...clone(raw), type, wallId: wallIdOf(raw), endpoint: raw.endpoint === "b" || raw.endpoint === 1 ? "b" : "a", nodeId: raw.nodeId ?? null };
  if (type === "wall_projection") return { ...clone(raw), type, wallId: wallIdOf(raw), t: Number.isFinite(raw.t) ? raw.t : 0 };
  if (type === "wall") return { ...clone(raw), type, wallId: wallIdOf(raw), t: Number.isFinite(raw.t) ? raw.t : undefined };
  return { ...clone(raw) };
}

function legacyAnchors(dim) {
  const at = dim?.attachedTo;
  if (!at) return null;
  if (at.type === "wall" && Number.isFinite(at.t0) && Number.isFinite(at.t1)) {
    const wallId = wallIdOf(at);
    return [{ type: "wall_projection", wallId, t: at.t0 }, { type: "wall_projection", wallId, t: at.t1 }];
  }
  if (at.type === "item") return [{ type: "item", itemId: itemIdOf(at), role: at.mode || "center" }];
  return null;
}

export function normalizeDimensionModel(list = []) {
  const warnings = [];
  const affected = [];
  const dimensions = (Array.isArray(list) ? list : []).map((raw, index) => {
    const dim = clone(raw || {});
    const id = dim.id || `dim-${index + 1}`;
    const anchors = Array.isArray(dim.anchors) ? dim.anchors.map(normalizeDimensionAnchor) : legacyAnchors(dim);
    const next = {
      ...dim, id, type: "dimension", mode: dim.mode || "linear", kind: dim.kind || (dim.auto ? "auto" : "manual"),
      p1: point(dim.p1), p2: point(dim.p2), offset: Number.isFinite(dim.offset) ? dim.offset : 120,
      labelOverride: dim.labelOverride ?? null, style: dim.style ?? null, auto: dim.auto === true,
      ...(anchors ? { anchors } : {}),
    };
    if (anchors?.some((a) => !a?.type || (["wall", "wall_endpoint", "wall_projection"].includes(a.type) && !a.wallId) || (a.type === "node" && !a.nodeId))) {
      next.invalid = true; warnings.push(warning(id));
    }
    if (JSON.stringify(next) !== JSON.stringify(raw)) affected.push(id);
    return next;
  });
  return result(dimensions, affected.length > 0, affected, warnings);
}

function resolveAnchor(plan, anchor) {
  if (!anchor) return { invalid: true };
  if (anchor.type === "free") return { point: point(anchor.point), invalid: false };
  if (anchor.type === "node") {
    const p = plan?.nodes?.[nodeIdOf(anchor)];
    return p ? { point: point(p), invalid: false } : { invalid: true };
  }
  if (anchor.type === "item") {
    const item = (plan?.items || []).find((it) => it.id === itemIdOf(anchor));
    if (!item) return { invalid: true };
    return { point: { x: (Number(item.x) || 0) + (Number(item.w) || 0) / 2, y: (Number(item.y) || 0) + (Number(item.h) || 0) / 2 }, invalid: false };
  }
  if (["wall", "wall_endpoint", "wall_projection"].includes(anchor.type)) {
    const wall = (plan?.walls || []).find((w) => w.id === wallIdOf(anchor));
    const ends = wallEnds(plan, wall);
    if (!ends) return { invalid: true };
    if (anchor.type === "wall_endpoint") {
      const nid = anchor.nodeId;
      if (nid && plan?.nodes?.[nid]) return { point: point(plan.nodes[nid]), invalid: false };
      return { point: ends[anchor.endpoint === "b" ? 1 : 0], invalid: false };
    }
    const t = Number.isFinite(anchor.t) ? anchor.t : 0;
    return { point: { x: ends[0].x + (ends[1].x - ends[0].x) * t, y: ends[0].y + (ends[1].y - ends[0].y) * t }, invalid: false };
  }
  return { invalid: true };
}

function angleGeometry(points) {
  const [v, a, b] = points;
  const va = { x: a.x - v.x, y: a.y - v.y }, vb = { x: b.x - v.x, y: b.y - v.y };
  const la = Math.hypot(va.x, va.y), lb = Math.hypot(vb.x, vb.y);
  if (!la || !lb) return null;
  const cosine = Math.max(-1, Math.min(1, (va.x * vb.x + va.y * vb.y) / (la * lb)));
  const degrees = Math.acos(cosine) * 180 / Math.PI;
  return degrees > 1e-7 && degrees < 179.9999999 ? degrees : null;
}

export function resolveDimensionAnchors(plan, dimension) {
  const normalized = normalizeDimensionModel([dimension]).dimensions[0];
  if (!normalized.anchors?.length) return result([{ ...normalized, invalid: false }], false);
  const resolved = normalized.anchors.map((a) => resolveAnchor(plan, a));
  if (resolved.some((r) => r.invalid)) return result([{ ...normalized, invalid: true }], normalized.invalid !== true, [normalized.id], [warning(normalized.id)]);
  const pts = resolved.map((r) => r.point);
  let next = { ...normalized, invalid: false };
  if (normalized.mode === "angle") {
    const angle = pts.length >= 3 ? angleGeometry(pts) : null;
    if (angle == null) return result([{ ...next, invalid: true }], true, [next.id], [warning(next.id, "DIMENSION_ANGLE_INVALID")]);
    next = { ...next, angle, value: angle, vertex: pts[0], rayPoint1: pts[1], rayPoint2: pts[2] };
  } else if (pts.length >= 2) {
    next = { ...next, p1: pts[0], p2: pts[1], value: Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) };
  }
  const changed = JSON.stringify(next) !== JSON.stringify(dimension);
  return result([next], changed, changed ? [next.id] : []);
}

export function resolveDimensions(plan, dimensions = plan?.dimensions || []) {
  const out = [], affected = [], warnings = [];
  for (const dim of dimensions) {
    const r = resolveDimensionAnchors(plan, dim); out.push(...r.dimensions); affected.push(...r.affectedDimensionIds); warnings.push(...r.warnings);
  }
  return result(out, affected.length > 0, affected, warnings);
}

const anchorKey = (a) => {
  if (a.type === "node") return `node:${nodeIdOf(a)}`;
  if (a.type === "item") return `item:${itemIdOf(a)}:${a.role || ""}`;
  if (a.type === "free") return `free:${a.point.x},${a.point.y}`;
  return `${a.type}:${wallIdOf(a)}:${a.nodeId || a.endpoint || (Number.isFinite(a.t) ? a.t : "")}`;
};
export function dimensionSemanticKey(dim) {
  const anchors = (dim.anchors || legacyAnchors(dim) || []).map(normalizeDimensionAnchor).map(anchorKey).sort();
  if (!anchors.length) anchors.push(`p:${dim.p1?.x},${dim.p1?.y}`, `p:${dim.p2?.x},${dim.p2?.y}`), anchors.sort();
  return [dim.mode || "linear", dim.kind || "", dim.geometryRole || dim.role || "", dim.source || "", anchors.join("|")].join("::");
}

export function dedupeAutoDimensions(dimensions = []) {
  const seen = new Set(), out = [], affected = [];
  for (const dim of dimensions) {
    if (dim?.auto !== true) { out.push(clone(dim)); continue; }
    const key = dimensionSemanticKey(dim);
    if (seen.has(key)) affected.push(dim.id); else { seen.add(key); out.push(clone(dim)); }
  }
  return result(out, affected.length > 0, affected);
}

export function remapDimensionsAfterWallMove(plan, dimensions = plan?.dimensions || []) { return resolveDimensions(plan, dimensions); }

export function remapDimensionAfterWallSplit(dimensions = [], { oldWallId, firstWallId = oldWallId, secondWallId, splitT = 0.5, splitNodeId } = {}) {
  const out = clone(dimensions), affected = [], warnings = [];
  for (let i = 0; i < out.length; i++) {
    const dim = out[i]; if (!Array.isArray(dim.anchors)) continue;
    let review = false, changed = false;
    dim.anchors = dim.anchors.map((anchor) => {
      const a = normalizeDimensionAnchor(anchor); if (wallIdOf(a) !== oldWallId) return a;
      if (a.type === "wall_endpoint") {
        changed = true;
        if (a.endpoint === "a") return { ...a, wallId: firstWallId };
        return { ...a, wallId: secondWallId, nodeId: a.nodeId || null };
      }
      if (a.type === "wall_projection" && Number.isFinite(a.t)) {
        changed = true;
        if (Math.abs(a.t - splitT) < 1e-9 && splitNodeId) return { type: "node", nodeId: splitNodeId };
        if (a.t < splitT) return { ...a, wallId: firstWallId, t: splitT ? a.t / splitT : 0 };
        return { ...a, wallId: secondWallId, t: splitT < 1 ? (a.t - splitT) / (1 - splitT) : 0 };
      }
      review = true; return a;
    });
    if (changed || review) affected.push(dim.id);
    if (review) { dim.invalid = true; warnings.push(warning(dim.id, REVIEW, { wallId: oldWallId })); }
  }
  return result(out, affected.length > 0, affected, warnings);
}

export function invalidateDimensionsAfterWallDelete(dimensions = [], { wallIds = [], nodeIds = [] } = {}) {
  const deletedWalls = new Set(wallIds), deletedNodes = new Set(nodeIds), out = [], affected = [], warnings = [];
  for (const original of dimensions) {
    const dim = clone(original);
    const hit = (dim.anchors || []).some((a) => deletedWalls.has(wallIdOf(a)) || (a.type === "node" && deletedNodes.has(nodeIdOf(a)))) || (dim.attachedTo?.type === "wall" && deletedWalls.has(wallIdOf(dim.attachedTo)));
    if (!hit) { out.push(dim); continue; }
    affected.push(dim.id);
    if (dim.auto === true) continue;
    out.push({ ...dim, invalid: true }); warnings.push(warning(dim.id));
  }
  return result(out, affected.length > 0, affected, warnings);
}

/** Remap node / wall_endpoint.nodeId anchors from dropId → keepId, then dedupe auto duplicates. */
export function remapDimensionsAfterNodeMerge(dimensions = [], { keepId, dropId } = {}) {
  if (!keepId || !dropId || keepId === dropId) {
    return result((Array.isArray(dimensions) ? dimensions : []).map(clone), false);
  }
  const out = [];
  const affected = [];
  for (const original of dimensions) {
    const dim = clone(original);
    let changed = false;
    if (Array.isArray(dim.anchors)) {
      dim.anchors = dim.anchors.map((anchor) => {
        const a = normalizeDimensionAnchor(anchor);
        if (!a) return a;
        if (a.type === "node" && nodeIdOf(a) === dropId) {
          changed = true;
          return { ...a, nodeId: keepId };
        }
        if (a.type === "wall_endpoint" && a.nodeId === dropId) {
          changed = true;
          return { ...a, nodeId: keepId };
        }
        return a;
      });
    }
    if (changed) affected.push(dim.id);
    out.push(dim);
  }
  const deduped = dedupeAutoDimensions(out);
  const allAffected = [...new Set([...affected, ...deduped.affectedDimensionIds])];
  return result(deduped.dimensions, allAffected.length > 0, allAffected);
}

export function createWallDimension({ id, wallId, start = 0, end = 1, offset = 120, ...rest }) {
  return { id, type: "dimension", mode: "linear", kind: "manual", offset, ...rest, anchors: [{ type: "wall_projection", wallId, t: start }, { type: "wall_projection", wallId, t: end }] };
}
export function createDiagonalDimension({ id, fromNodeId, toNodeId, offset = 120, ...rest }) {
  return { id, type: "dimension", mode: "diagonal", kind: "manual", offset, ...rest, anchors: [{ type: "node", nodeId: fromNodeId }, { type: "node", nodeId: toNodeId }] };
}
export function createAngleDimension({ id, vertexNodeId, rayNodeId1, rayNodeId2, ...rest }) {
  return { id, type: "dimension", mode: "angle", kind: "manual", ...rest, anchors: [{ type: "node", nodeId: vertexNodeId }, { type: "node", nodeId: rayNodeId1 }, { type: "node", nodeId: rayNodeId2 }] };
}
