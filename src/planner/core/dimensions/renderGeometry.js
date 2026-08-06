const TAU = Math.PI * 2;
const EPS = 1e-9;

const finitePoint = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const copyPoint = (p) => ({ x: p.x, y: p.y });
const add = (p, v, scale = 1) => ({ x: p.x + v.x * scale, y: p.y + v.y * scale });
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const normalizedAngle = (a) => ((a % TAU) + TAU) % TAU;
const lineDistance = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 <= EPS) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return distance(p, { x: a.x + dx * t, y: a.y + dy * t });
};

/**
 * PHASE 2F1 — hybrid zoom contract:
 *   anchors/offsets stay in world mm (attached to walls);
 *   visual primitives use screen-space clamps so labels never explode at high zoom
 *   and stay readable at medium zoom.
 *
 * screenPx = clamp(worldMm * zoom, minPx, maxPx)
 * worldMmForDraw = screenPx / zoom
 */
export const DIM_SCREEN_CLAMP = Object.freeze({
  fontSizePx: { min: 9, max: 14 },
  strokeWidthPx: { min: 0.75, max: 1.75 },
  tickSizePx: { min: 6, max: 12 },
  labelPaddingXPx: { min: 4, max: 7 },
  labelPaddingYPx: { min: 2, max: 4 },
  cornerRadiusPx: { min: 3, max: 5 },
  borderPx: { min: 0.75, max: 1.25 },
  extensionGapPx: { min: 3, max: 8 },
  extensionOvershootPx: { min: 4, max: 10 },
  labelGapPx: { min: 4, max: 10 },
  hitSlopPx: { min: 8, max: 14 },
  /** Text halo (stroke behind glyphs), screen-bounded. */
  textHaloPx: { min: 2.5, max: 4.5 },
});

export function clampScreenPx(worldMm, zoom, minPx, maxPx) {
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const screen = (Number(worldMm) || 0) * z;
  const lo = Number.isFinite(minPx) ? minPx : 0;
  const hi = Number.isFinite(maxPx) ? maxPx : screen;
  const clamped = Math.min(hi, Math.max(lo, screen));
  return { screenPx: clamped, worldMm: clamped / z, zoom: z };
}

/**
 * One zoom-aware label-metrics object — font + halo (no card padding box).
 * All screen values share the same clamp pass; world units are screenPx / zoom.
 */
export function resolveLabelMetrics(style = {}, zoom = 1, labelText = "") {
  const base = normalizeDimensionStyle(style);
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const font = clampScreenPx(base.fontSizeMm, z, DIM_SCREEN_CLAMP.fontSizePx.min, DIM_SCREEN_CLAMP.fontSizePx.max);
  const halo = clampScreenPx(
    font.screenPx * 0.28,
    z,
    DIM_SCREEN_CLAMP.textHaloPx.min,
    DIM_SCREEN_CLAMP.textHaloPx.max,
  );
  // Halo is derived from font; pad/card sizes are no longer used for paint.
  const padX = { screenPx: 0, worldMm: 0 };
  const padY = { screenPx: 0, worldMm: 0 };
  const chars = String(labelText ?? "").length;
  const widthPx = Math.max(font.screenPx * 2.2, chars * font.screenPx * 0.62);
  const heightPx = font.screenPx;
  const lineHeightPx = font.screenPx;
  return {
    fontPx: font.screenPx,
    horizontalPaddingPx: padX.screenPx,
    verticalPaddingPx: padY.screenPx,
    lineHeightPx,
    cornerRadiusPx: 0,
    borderPx: 0,
    haloPx: halo.screenPx,
    widthPx,
    heightPx,
    fontMm: font.worldMm,
    horizontalPaddingMm: 0,
    verticalPaddingMm: 0,
    lineHeightMm: lineHeightPx / z,
    cornerRadiusMm: 0,
    borderMm: 0,
    haloMm: halo.worldMm,
    widthMm: widthPx / z,
    heightMm: heightPx / z,
    zoom: z,
  };
}

export function resolveDimensionScreenStyle(style = {}, zoom = 1, labelText = "") {
  const base = normalizeDimensionStyle(style);
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const apply = (worldMm, clamp) => clampScreenPx(worldMm, z, clamp.min, clamp.max).worldMm;
  const metrics = resolveLabelMetrics(base, z, labelText);
  return {
    ...base,
    fontSizeMm: metrics.fontMm,
    strokeWidthMm: apply(base.strokeWidthMm, DIM_SCREEN_CLAMP.strokeWidthPx),
    tickSizeMm: apply(base.tickSizeMm, DIM_SCREEN_CLAMP.tickSizePx),
    labelPaddingXMm: metrics.horizontalPaddingMm,
    labelPaddingYMm: metrics.verticalPaddingMm,
    extensionGapMm: apply(base.extensionGapMm, DIM_SCREEN_CLAMP.extensionGapPx),
    extensionOvershootMm: apply(base.extensionOvershootMm, DIM_SCREEN_CLAMP.extensionOvershootPx),
    labelGapMm: apply(base.labelGapMm, DIM_SCREEN_CLAMP.labelGapPx),
    hitSlopMm: apply(base.hitSlopMm, DIM_SCREEN_CLAMP.hitSlopPx),
    fontSizePx: metrics.fontPx,
    strokeWidthPx: clampScreenPx(base.strokeWidthMm, z, DIM_SCREEN_CLAMP.strokeWidthPx.min, DIM_SCREEN_CLAMP.strokeWidthPx.max).screenPx,
    tickSizePx: clampScreenPx(base.tickSizeMm, z, DIM_SCREEN_CLAMP.tickSizePx.min, DIM_SCREEN_CLAMP.tickSizePx.max).screenPx,
    labelPaddingXPx: metrics.horizontalPaddingPx,
    labelPaddingYPx: metrics.verticalPaddingPx,
    labelMetrics: metrics,
  };
}

export const DEFAULT_DIMENSION_STYLE = Object.freeze({
  offset: 120,
  // Preferred world-mm at zoom≈1; actual draw size is screen-clamped.
  extensionGapMm: 30,
  extensionOvershootMm: 40,
  tickSizeMm: 50,
  strokeWidthMm: 12,
  hitSlopMm: 80,
  fontSizeMm: 140,
  labelPaddingXMm: 50,
  labelPaddingYMm: 30,
  labelGapMm: 40,
  shortThresholdMm: 400,
  // Legacy px fields kept for callers; overridden by screen-clamp path.
  extensionGapPx: 6,
  extensionOvershootPx: 8,
  tickSizePx: 8,
  strokeWidthPx: 1.25,
  hitSlopPx: 9,
  fontSizePx: 11,
  labelPaddingXPx: 7,
  labelPaddingYPx: 4,
  labelGapPx: 5,
  shortThresholdPx: 44,
  angleRadius: 160,
  arcSegments: 32,
});

export function normalizeDimensionStyle(style = {}) {
  const out = { ...DEFAULT_DIMENSION_STYLE };
  for (const key of Object.keys(out)) {
    const value = style?.[key];
    if (Number.isFinite(value)) out[key] = value;
  }
  out.offset = Number.isFinite(style?.offset) ? style.offset : out.offset;
  out.arcSegments = Math.max(1, Math.min(256, Math.round(out.arcSegments)));
  out.color = typeof style?.color === "string" ? style.color : "#8f9a94";
  out.textColor = typeof style?.textColor === "string" ? style.textColor : "#111111";
  out.dasharray = style?.dasharray ?? null;
  return out;
}

function invalidGeometry(type, code = "DIMENSION_GEOMETRY_INVALID") {
  return { type, valid: false, code };
}

function readableAngle(angle) {
  let value = angle * 180 / Math.PI;
  if (value > 90 || value < -90) value += 180;
  return value;
}

export function computeLinearDimensionGeometry(input = {}) {
  const p1 = input.p1 || input.a;
  const p2 = input.p2 || input.b;
  if (!finitePoint(p1) || !finitePoint(p2)) return invalidGeometry("linear");
  const length = distance(p1, p2);
  if (length <= EPS) return invalidGeometry("linear", "DIMENSION_ZERO_LENGTH");
  const zoom = Number.isFinite(input.zoom) && input.zoom > 0 ? input.zoom : 1;
  const style = resolveDimensionScreenStyle(
    { ...input.style, offset: input.offset ?? input.style?.offset },
    zoom,
    input.label || "",
  );
  const unit = { x: (p2.x - p1.x) / length, y: (p2.y - p1.y) / length };
  const normal = { x: -unit.y, y: unit.x };
  // Lane offset stays fixed in model millimetres — no screen min/max on geometry.
  const offset = Number.isFinite(input.offset) ? input.offset : style.offset;
  const dimA = add(p1, normal, offset);
  const dimB = add(p2, normal, offset);
  const gap = style.extensionGapMm;
  const overshoot = style.extensionOvershootMm;
  const tick = style.tickSizeMm / 2;
  const tickDir = { x: (unit.x + normal.x) / Math.SQRT2, y: (unit.y + normal.y) / Math.SQRT2 };
  const extensionLines = [p1, p2].map((anchor) => ({
    a: add(anchor, normal, Math.sign(offset || 1) * gap),
    b: add(anchor, normal, offset + Math.sign(offset || 1) * overshoot),
  }));
  const ticks = [dimA, dimB].map((center) => ({ a: add(center, tickDir, -tick), b: add(center, tickDir, tick) }));
  const short = length < style.shortThresholdMm;
  // Label always centres on the dimension-line midpoint (CAD knockout).
  const baseLabel = { x: (dimA.x + dimB.x) / 2, y: (dimA.y + dimB.y) / 2 };
  return {
    type: input.mode === "diagonal" ? "diagonal" : "linear",
    valid: true,
    anchors: [copyPoint(p1), copyPoint(p2)],
    length,
    angle: Math.atan2(unit.y, unit.x),
    textAngleDeg: readableAngle(Math.atan2(unit.y, unit.x)),
    unit,
    normal,
    offset,
    dimensionLine: { a: dimA, b: dimB },
    extensionLines,
    ticks,
    labelBase: baseLabel,
    short,
    style,
    zoom,
  };
}

function canonicalMinorArc(a1, a2) {
  const first = normalizedAngle(a1), second = normalizedAngle(a2);
  const ccw = normalizedAngle(second - first);
  if (ccw <= Math.PI + EPS) return { startAngle: first, sweepAngle: Math.min(Math.PI, ccw) };
  return { startAngle: second, sweepAngle: Math.min(Math.PI, TAU - ccw) };
}

export function computeAngleArcGeometry(input = {}) {
  const vertex = input.vertex;
  const ray1 = input.ray1 || input.rayPoint1;
  const ray2 = input.ray2 || input.rayPoint2;
  if (!finitePoint(vertex) || !finitePoint(ray1) || !finitePoint(ray2)) return invalidGeometry("angle");
  const len1 = distance(vertex, ray1), len2 = distance(vertex, ray2);
  if (len1 <= EPS || len2 <= EPS) return invalidGeometry("angle", "DIMENSION_ZERO_LENGTH_RAY");
  const style = normalizeDimensionStyle(input.style);
  const radius = Number.isFinite(input.radius) && input.radius >= 0 ? input.radius : style.angleRadius;
  const a1 = Math.atan2(ray1.y - vertex.y, ray1.x - vertex.x);
  const a2 = Math.atan2(ray2.y - vertex.y, ray2.x - vertex.x);
  const { startAngle, sweepAngle } = canonicalMinorArc(a1, a2);
  const degrees = Math.max(0, Math.min(180, sweepAngle * 180 / Math.PI));
  const pointAt = (angle) => ({ x: vertex.x + Math.cos(angle) * radius, y: vertex.y + Math.sin(angle) * radius });
  const points = Array.from({ length: style.arcSegments + 1 }, (_, i) => pointAt(startAngle + sweepAngle * i / style.arcSegments));
  const endAngle = startAngle + sweepAngle;
  const bisectorAngle = startAngle + sweepAngle / 2;
  return {
    type: "angle", valid: true, vertex: copyPoint(vertex), radius, angle: degrees,
    startAngle, endAngle, sweepAngle, start: pointAt(startAngle), end: pointAt(endAngle), points,
    rays: [{ a: copyPoint(vertex), b: copyPoint(ray1) }, { a: copyPoint(vertex), b: copyPoint(ray2) }],
    labelBase: pointAt(bisectorAngle), bisectorAngle, style,
  };
}

function wallSegments(walls = []) {
  const out = [];
  for (const wall of walls || []) {
    const pts = wall?.pts || [];
    for (let i = 1; i < pts.length; i++) if (finitePoint(pts[i - 1]) && finitePoint(pts[i])) out.push([pts[i - 1], pts[i]]);
  }
  return out;
}

export function computeDimensionLabelPosition(geometry, options = {}) {
  if (!geometry?.valid || !finitePoint(geometry.dimensionLine?.a) || !finitePoint(geometry.dimensionLine?.b)) {
    if (!geometry?.valid || !finitePoint(geometry.labelBase)) {
      return { valid: false, code: "DIMENSION_LABEL_INVALID" };
    }
  }
  const zoom = Number.isFinite(options.zoom) && options.zoom > 0
    ? options.zoom
    : (Number.isFinite(geometry.zoom) && geometry.zoom > 0 ? geometry.zoom : 1);
  const text = String(options.label ?? "");
  const style = resolveDimensionScreenStyle({ ...geometry.style, ...options.style }, zoom, text);
  const metrics = style.labelMetrics || resolveLabelMetrics(style, zoom, text);
  const width = metrics.widthMm;
  const height = metrics.heightMm;
  // Label centre is always the dimension-line midpoint (or along-line shift only).
  const line = geometry.dimensionLine;
  const mid = line && finitePoint(line.a) && finitePoint(line.b)
    ? { x: (line.a.x + line.b.x) / 2, y: (line.a.y + line.b.y) / 2 }
    : copyPoint(geometry.labelBase);
  const along = Number.isFinite(options.alongDisplacementMm) ? options.alongDisplacementMm : 0;
  const unit = geometry.unit || { x: 1, y: 0 };
  const position = {
    x: mid.x + unit.x * along,
    y: mid.y + unit.y * along,
  };
  return {
    valid: true,
    position,
    width,
    height,
    rotationDeg: geometry.textAngleDeg || 0,
    shifted: Math.abs(along) > 1e-9,
    alongDisplacementMm: along,
    lineMidpoint: mid,
  };
}

function arcDistance(pointValue, geometry) {
  const radial = distance(pointValue, geometry.vertex);
  const angle = normalizedAngle(Math.atan2(pointValue.y - geometry.vertex.y, pointValue.x - geometry.vertex.x));
  const delta = normalizedAngle(angle - geometry.startAngle);
  if (delta <= geometry.sweepAngle + EPS) return Math.abs(radial - geometry.radius);
  return Math.min(distance(pointValue, geometry.start), distance(pointValue, geometry.end));
}

export function hitTestDimension(geometry, pointValue, options = {}) {
  if (!geometry?.valid || !finitePoint(pointValue)) return { hit: false, distance: Infinity };
  const zoom = Number.isFinite(options.zoom) && options.zoom > 0 ? options.zoom : 1;
  const style = normalizeDimensionStyle({ ...geometry.style, ...options.style });
  // Hit slop stays screen-constant (like endpoint grips), independent of the
  // world-mm label/stroke clamp used for visual primitives.
  const hitSlopPx = Number.isFinite(options.hitSlopPx)
    ? options.hitSlopPx
    : (Number.isFinite(options.hitSlopMm)
      ? options.hitSlopMm * zoom
      : (style.hitSlopPx || 9));
  const tolerance = hitSlopPx / zoom;
  let d = Infinity, part = null;
  if (geometry.type === "angle") {
    d = arcDistance(pointValue, geometry); part = "arc";
  } else {
    d = lineDistance(pointValue, geometry.dimensionLine.a, geometry.dimensionLine.b); part = "dimension-line";
    geometry.extensionLines.forEach((line) => { const candidate = lineDistance(pointValue, line.a, line.b); if (candidate < d) { d = candidate; part = "extension-line"; } });
  }
  return { hit: d <= tolerance, distance: d, screenDistancePx: d * zoom, part };
}
