function safePoint(p) {
  return { x: Number(p?.x) || 0, y: Number(p?.y) || 0 };
}

function pointOnSegment(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function dimensionOrientation(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.abs(dx) >= Math.abs(dy) ? "horizontal" : "vertical";
}

export function dimensionOffsetFromPoint(p1, p2, offsetPoint) {
  const a = safePoint(p1);
  const b = safePoint(p2);
  const c = safePoint(offsetPoint);
  const len = distance(a, b) || 1;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  return (c.x - a.x) * nx + (c.y - a.y) * ny;
}

export function dimensionLabelPoint(dim) {
  const p1 = safePoint(dim?.p1);
  const p2 = safePoint(dim?.p2);
  const offset = Number(dim?.offset) || 0;
  const len = distance(p1, p2) || 1;
  const nx = -(p2.y - p1.y) / len;
  const ny = (p2.x - p1.x) / len;
  return {
    x: (p1.x + p2.x) / 2 + nx * offset,
    y: (p1.y + p2.y) / 2 + ny * offset,
  };
}

export function normalizeLinearDimension(raw = {}, index = 0) {
  const p1 = safePoint(raw.p1);
  const p2 = safePoint(raw.p2);
  const orientation = raw.orientation || dimensionOrientation(p1, p2);
  return {
    id: raw.id || `dim-${index + 1}`,
    type: "dimension",
    mode: raw.mode || "linear",
    p1,
    p2,
    offset: Number.isFinite(raw.offset) ? raw.offset : 120,
    orientation,
    attachedTo: raw.attachedTo || null,
    labelOverride: raw.labelOverride ?? null,
    locked: raw.locked === true,
    invalid: raw.invalid === true,
    auto: raw.auto === true,
    kind: raw.kind || "manual",
    style: raw.style || null,
  };
}

export function normalizeDimensions(list = []) {
  return (list || []).map((dim, i) => normalizeLinearDimension(dim, i));
}

function resolveAttachedItemDimension(dim, item) {
  if (!item || !dim?.attachedTo) return { ...dim, invalid: true };
  const at = dim.attachedTo;
  if (at.mode === "bbox-width") {
    return {
      ...dim,
      p1: { x: item.x, y: item.y },
      p2: { x: item.x + item.w, y: item.y },
      orientation: "horizontal",
      invalid: false,
    };
  }
  if (at.mode === "bbox-height") {
    return {
      ...dim,
      p1: { x: item.x, y: item.y },
      p2: { x: item.x, y: item.y + item.h },
      orientation: "vertical",
      invalid: false,
    };
  }
  return { ...dim, invalid: false };
}

function resolveAttachedWallDimension(dim, wall) {
  if (!wall || !wall.pts || wall.pts.length < 2 || !dim?.attachedTo) {
    return { ...dim, invalid: true };
  }
  const at = dim.attachedTo;
  const segIdx = Number.isInteger(at.segIndex) ? at.segIndex : 0;
  const a = wall.pts[segIdx];
  const b = wall.pts[segIdx + 1];
  if (!a || !b) return { ...dim, invalid: true };
  if (Number.isFinite(at.t0) && Number.isFinite(at.t1)) {
    return {
      ...dim,
      p1: pointOnSegment(a, b, at.t0),
      p2: pointOnSegment(a, b, at.t1),
      orientation: dimensionOrientation(a, b),
      invalid: false,
    };
  }
  return { ...dim, invalid: false };
}

export function resolveAttachedDimension(dim, plan) {
  if (!dim?.attachedTo) return { ...dim, invalid: false };
  const at = dim.attachedTo;
  if (at.type === "item") {
    const item = (plan?.items || []).find((it) => it.id === (at.id || at.itemId));
    return resolveAttachedItemDimension(dim, item);
  }
  if (at.type === "wall") {
    const wall = (plan?.walls || []).find((w) => w.id === (at.id || at.wallId));
    return resolveAttachedWallDimension(dim, wall);
  }
  return { ...dim, invalid: true };
}
