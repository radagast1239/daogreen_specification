/** Архитектурные размерные линии: вынос, засечки, подпись с текстовым ореолом. */

import React from "react";
import { computeClearances, isWallMountedItem } from "./clearanceDims.js";
import { dimStroke, resolveDimState, DEFAULT_PASSAGE_WARN_MM, DEFAULT_PASSAGE_ERROR_MM } from "./dimensionProperties.js";
import { dimEffectiveK, dimEffectiveOffset, dimEffectiveOpacity } from "./plannerVisualSettings.js";
import { wallOutlineSegment } from "./core/walls/wallRender.js";
import { wallFacePoint } from "./wallParallelGeometry.js";
import { computeWallDimChains } from "./wallDimChains.js";
import {
  computeLinearDimensionGeometry,
  computeAngleArcGeometry,
  computeDimensionLabelPosition,
  hitTestDimension,
  normalizeDimensionStyle,
  resolveDimensionScreenStyle,
  resolveLabelMetrics,
} from "./core/dimensions/renderGeometry.js";
import { layoutDimensionLabels } from "./core/dimensions/dimensionLayout.js";
import { dimensionCoversWallId } from "./core/dimensions/finalizeAutoDimensions.js";
import {
  TEXT_KNOCKOUT_PAD_PX,
  visibleCentreKnockoutRadiusPx,
} from "./core/viewport/gripScale.js";

export const WALL_DIM_COLOR = "#14201b";
export const RULER_COLOR = "#e0312a";
/** Selection accent — muted brand teal; noticeable but not neon/aggressive. */
export const DIM_SELECTION_ACCENT = "#3d7a6e";
export const DIM_SELECTION_TEXT = "#2f5f55";
export { hitTestDimension, normalizeDimensionStyle };

/**
 * Associate a finalized dimension with a wall for selection emphasis only.
 * Prefer sourceWallIds / wallId; fall back to parallel physical-face proximity.
 * Never invents geometry.
 */
export function dimensionAssociatesWithWall(dim, wall, opts = {}) {
  if (!dim || !wall) return false;
  const wallId = wall.id ?? wall;
  if (dimensionCoversWallId(dim, wallId)) return true;
  const pts = wall.pts;
  if (!pts || pts.length < 2 || !dim.p1 || !dim.p2) return false;
  // Prefer face pipelines for geometric match — avoid emphasizing unrelated spans.
  if (!["room_edge_clear", "external_segment", "external_overall", "internal_clear", "wall_length"].includes(dim.kind)) {
    return false;
  }
  const wa = pts[0];
  const wb = pts[pts.length - 1];
  const wdx = wb.x - wa.x;
  const wdy = wb.y - wa.y;
  const wlen = Math.hypot(wdx, wdy) || 1;
  const ddx = dim.p2.x - dim.p1.x;
  const ddy = dim.p2.y - dim.p1.y;
  const dlen = Math.hypot(ddx, ddy) || 1;
  // Parallel within ~12°.
  const cross = Math.abs(wdx * ddy - wdy * ddx) / (wlen * dlen);
  if (cross > 0.22) return false;
  const mid = { x: (dim.p1.x + dim.p2.x) / 2, y: (dim.p1.y + dim.p2.y) / 2 };
  const t = Math.max(0, Math.min(1, ((mid.x - wa.x) * wdx + (mid.y - wa.y) * wdy) / (wlen * wlen)));
  const proj = { x: wa.x + wdx * t, y: wa.y + wdy * t };
  const dist = Math.hypot(mid.x - proj.x, mid.y - proj.y);
  const maxDist = (Number(wall.thk) || 100) / 2 + (opts.faceTolMm ?? 80);
  if (dist > maxDist) return false;
  // Require the dim midpoint to project onto the wall segment (not past ends).
  if (t <= 0.02 || t >= 0.98) {
    // Allow endpoints for short walls / end caps.
    if (wlen > 400 && (t < 0 || t > 1)) return false;
  }
  // Overlap along wall: at least 40% of the shorter span.
  const along = (p) => ((p.x - wa.x) * wdx + (p.y - wa.y) * wdy) / wlen;
  const a0 = Math.min(along(dim.p1), along(dim.p2));
  const a1 = Math.max(along(dim.p1), along(dim.p2));
  const ov = Math.min(a1, wlen) - Math.max(a0, 0);
  const need = Math.min(dlen, wlen) * 0.35;
  return ov >= need;
}

function sourceWallIdAttr(dim) {
  const ids = dim?.sourceWallIds || dim?.reference?.sourceWallIds || [];
  if (ids.length) return ids.map(String).join(",");
  if (dim?.wallId != null) return String(dim.wallId);
  return undefined;
}

/** Build render geometry for a resolved runtime dimension (linear/diagonal/angle). */
export function geometryForDimension(dim, zoom = 1) {
  if (!dim || dim.visible === false) return { valid: false, code: "DIMENSION_HIDDEN" };
  if (dim.mode === "angle") {
    const vertex = dim.vertex || dim.anchors?.find?.((a) => a?.type === "node" && a.role === "vertex");
    const ray1 = dim.rayPoint1;
    const ray2 = dim.rayPoint2;
    if (!vertex || !ray1 || !ray2) {
      if (dim.invalid) return { valid: false, code: "DIMENSION_ANCHOR_INVALID", type: "angle" };
      return { valid: false, code: "DIMENSION_GEOMETRY_INVALID", type: "angle" };
    }
    return computeAngleArcGeometry({
      vertex,
      ray1,
      ray2,
      style: dim.style,
      radius: dim.style?.angleRadius,
    });
  }
  if (!dim.p1 || !dim.p2) {
    return { valid: false, code: dim.invalid ? "DIMENSION_ANCHOR_INVALID" : "DIMENSION_GEOMETRY_INVALID", type: "linear" };
  }
  return computeLinearDimensionGeometry({
    p1: dim.p1,
    p2: dim.p2,
    offset: Number.isFinite(dim.offset) ? dim.offset : 120,
    mode: dim.mode,
    style: dim.style,
    zoom,
  });
}

/** Nearest dimension hit in screen-space (stable tie-break by id). */
export function pickDimensionHit(dimensions, point, { zoom = 1, hitSlopPx } = {}) {
  let best = null;
  for (const dim of dimensions || []) {
    if (dim?.visible === false) continue;
    const geometry = geometryForDimension(dim, zoom);
    const hit = hitTestDimension(geometry, point, { zoom, hitSlopPx });
    if (!hit.hit) continue;
    const candidate = {
      coll: "dimensions",
      id: dim.id,
      dim,
      geometry,
      part: hit.part,
      distance: hit.distance,
      screenDistancePx: hit.screenDistancePx,
    };
    if (
      !best
      || candidate.screenDistancePx < best.screenDistancePx - 1e-9
      || (Math.abs(candidate.screenDistancePx - best.screenDistancePx) <= 1e-9 && String(candidate.id) < String(best.id))
    ) {
      best = candidate;
    }
  }
  return best;
}

const EXT_GAP = 30;
const EXT_OVERSHOOT = 40;
const MIN_CLEAR_DIM = 40;
/** Preferred world-mm at zoom≈1; actual draw size is screen-clamped. */
const DIM_WORLD_STROKE = 12;
const DIM_WORLD_TICK = 50;
const DIM_WORLD_FS = 140;
const DIM_WORLD_PAD_X = 50;
const DIM_WORLD_PAD_Y = 30;

function archTick(x, y, segAngDeg, stroke, tickMm = DIM_WORLD_TICK, strokeMm = DIM_WORLD_STROKE) {
  const half = tickMm / 2;
  const rad = ((segAngDeg + 45) * Math.PI) / 180;
  const dx = Math.cos(rad) * half;
  const dy = Math.sin(rad) * half;
  return <line x1={x - dx} y1={y - dy} x2={x + dx} y2={y + dy} stroke={stroke} strokeWidth={strokeMm} />;
}

/**
 * Dimension label — text + restrained white glyph halo. No background card.
 */
function dimLabel(mx, my, textAng, label, stroke, opacity = 1, labelColor = null, metricsOrFont = null, _padXUnused = null, _padYUnused = null, opts = {}) {
  const metrics = metricsOrFont && typeof metricsOrFont === "object" && Number.isFinite(metricsOrFont.fontMm)
    ? metricsOrFont
    : {
      fontMm: Number.isFinite(metricsOrFont) ? metricsOrFont : DIM_WORLD_FS,
      haloMm: (Number.isFinite(metricsOrFont) ? metricsOrFont : DIM_WORLD_FS) * 0.22,
    };
  const fs = metrics.fontMm;
  const halo = Number.isFinite(metrics.haloMm) ? metrics.haloMm : fs * 0.22;
  const fill = labelColor || stroke;
  const weight = opts.fontWeight || (opts.emphasized ? "800" : "600");
  return (
    <g
      transform={`translate(${mx},${my}) rotate(${textAng})`}
      opacity={opacity}
      data-label-halo="1"
      data-label-card="0"
    >
      <text
        x={0}
        y={fs * 0.35}
        fontSize={fs}
        textAnchor="middle"
        fill={fill}
        stroke="#ffffff"
        strokeWidth={halo}
        strokeLinejoin="round"
        paintOrder="stroke fill"
        fontWeight={weight}
        style={{ fontFamily: "var(--mono)" }}
      >
        {label}
      </text>
    </g>
  );
}

/** Размер отрезка a→b, вынесенный на offset мм перпендикулярно. */
export function SegDim({
  a,
  b,
  label,
  k,
  display,
  offset = 110,
  offsetSide = 1,
  active = false,
  state = null,
  minLen = 40,
  color = null,
  labelColor = null,
  strokeWidthMul = 1,
  dasharray = null,
  /** LIVE4.1: parametric label position along dim line (0–1). */
  labelT = 0.5,
  /** LIVE4.1: world point for mid-cluster line knockout (grips/arrows). */
  knockoutCluster = null,
  /** LIVE4.5: visible-chrome radius in screen px (never the ≥32 hit target). */
  knockoutClusterRadiusPx = null,
}) {
  const dk = dimEffectiveK(k, display);
  const zoom = Number.isFinite(dk) && dk > 0 ? 1 / dk : 1;
  const metrics = resolveLabelMetrics({
    strokeWidthMm: DIM_WORLD_STROKE,
    tickSizeMm: DIM_WORLD_TICK,
    fontSizeMm: DIM_WORLD_FS,
    labelPaddingXMm: DIM_WORLD_PAD_X,
    labelPaddingYMm: DIM_WORLD_PAD_Y,
    extensionGapMm: EXT_GAP,
    extensionOvershootMm: EXT_OVERSHOOT,
  }, zoom, label);
  const screenStyle = resolveDimensionScreenStyle({
    strokeWidthMm: DIM_WORLD_STROKE,
    tickSizeMm: DIM_WORLD_TICK,
    fontSizeMm: DIM_WORLD_FS,
    labelPaddingXMm: DIM_WORLD_PAD_X,
    labelPaddingYMm: DIM_WORLD_PAD_Y,
    extensionGapMm: EXT_GAP,
    extensionOvershootMm: EXT_OVERSHOOT,
  }, zoom, label);
  const modelOffset = dimEffectiveOffset(offset, display);
  // Fixed world-mm offset — pixel gap shrinks naturally when zooming out.
  const effOffset = Math.abs(modelOffset);
  const opacity = dimEffectiveOpacity(display);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < minLen) return null;
  if (!label || !String(label).trim()) return null;

  const nx = (-dy / len) * offsetSide;
  const ny = (dx / len) * offsetSide;
  const dimA = { x: a.x + nx * effOffset, y: a.y + ny * effOffset };
  const dimB = { x: b.x + nx * effOffset, y: b.y + ny * effOffset };

  const segAng = (Math.atan2(dy, dx) * 180) / Math.PI;
  let textAng = segAng;
  if (textAng > 90 || textAng < -90) textAng += 180;

  const stroke = color || dimStroke({ state, active });
  const sw = screenStyle.strokeWidthMm * strokeWidthMul;
  const tLabel = Number.isFinite(labelT) ? Math.min(0.95, Math.max(0.05, labelT)) : 0.5;
  const mx = dimA.x + (dimB.x - dimA.x) * tLabel;
  const my = dimA.y + (dimB.y - dimA.y) * tLabel;

  // LIVE4.5 knockout: text bounds + compact pad; cluster uses VISIBLE chrome only.
  // Invisible ≥32 px hit targets must not enlarge the painted gap.
  const dimLen = Math.hypot(dimB.x - dimA.x, dimB.y - dimA.y) || 1;
  const ux = (dimB.x - dimA.x) / dimLen;
  const uy = (dimB.y - dimA.y) / dimLen;
  const textPadMm = TEXT_KNOCKOUT_PAD_PX / Math.max(zoom, 1e-6);
  const labelHalfMm = (metrics.widthMm || metrics.fontMm * 2) / 2
    + (metrics.haloMm || 0)
    + textPadMm;
  const gaps = [{
    t0: Math.max(0, tLabel - labelHalfMm / dimLen),
    t1: Math.min(1, tLabel + labelHalfMm / dimLen),
  }];
  if (knockoutCluster && Number.isFinite(knockoutCluster.x)) {
    const ct = ((knockoutCluster.x - dimA.x) * ux + (knockoutCluster.y - dimA.y) * uy) / dimLen;
    if (ct >= -0.05 && ct <= 1.05) {
      const visualR = Number.isFinite(knockoutClusterRadiusPx)
        ? knockoutClusterRadiusPx
        : visibleCentreKnockoutRadiusPx(zoom);
      const halfT = (visualR / Math.max(zoom, 1e-6)) / dimLen;
      gaps.push({ t0: Math.max(0, ct - halfT), t1: Math.min(1, ct + halfT) });
    }
  }
  gaps.sort((g0, g1) => g0.t0 - g1.t0);
  const merged = [];
  for (const g of gaps) {
    if (!merged.length || g.t0 > merged[merged.length - 1].t1 + 0.01) merged.push({ ...g });
    else merged[merged.length - 1].t1 = Math.max(merged[merged.length - 1].t1, g.t1);
  }
  const ptAt = (t) => ({
    x: dimA.x + (dimB.x - dimA.x) * t,
    y: dimA.y + (dimB.y - dimA.y) * t,
  });
  const lineSegs = [];
  let cursor = 0;
  for (const g of merged) {
    if (g.t0 > cursor + 0.01) lineSegs.push({ a: ptAt(cursor), b: ptAt(g.t0) });
    cursor = Math.max(cursor, g.t1);
  }
  if (cursor < 0.99) lineSegs.push({ a: ptAt(cursor), b: dimB });

  const ext = (p, sign) => {
    const ex = sign * nx;
    const ey = sign * ny;
    const gap = screenStyle.extensionGapMm * (display?.dimScale ?? 1);
    const overshoot = screenStyle.extensionOvershootMm * (display?.dimScale ?? 1);
    const p0 = { x: p.x + ex * gap, y: p.y + ey * gap };
    const p1 = {
      x: p.x + ex * (effOffset + overshoot),
      y: p.y + ey * (effOffset + overshoot),
    };
    return (
      <line
        x1={p0.x}
        y1={p0.y}
        x2={p1.x}
        y2={p1.y}
        stroke={stroke}
        strokeWidth={screenStyle.strokeWidthMm}
        opacity={0.82 * opacity}
      />
    );
  };

  return (
    <g pointerEvents="none" data-ui="dim" data-label-knockout="1" opacity={opacity}>
      {ext(a, 1)}
      {ext(b, 1)}
      {lineSegs.map((seg, i) => (
        <line
          key={`dim-seg-${i}`}
          x1={seg.a.x}
          y1={seg.a.y}
          x2={seg.b.x}
          y2={seg.b.y}
          stroke={stroke}
          strokeWidth={sw}
          strokeDasharray={dasharray || undefined}
          data-dim-line-seg={i}
        />
      ))}
      {archTick(dimA.x, dimA.y, segAng, stroke, screenStyle.tickSizeMm, screenStyle.strokeWidthMm)}
      {archTick(dimB.x, dimB.y, segAng, stroke, screenStyle.tickSizeMm, screenStyle.strokeWidthMm)}
      {dimLabel(mx, my, textAng, label, stroke, opacity, labelColor, metrics)}
    </g>
  );
}

function dimStyleFromKind(dim) {
  if (dim?.invalid || dim?.style?.importance === "error") {
    return { line: "#c7372f", text: "#c7372f", dasharray: "7 4" };
  }
  if (dim?.style?.importance === "important") {
    return { line: "#8f9a94", text: "#116355", dasharray: null };
  }
  return { line: "#8f9a94", text: "#111111", dasharray: null };
}

function dimOffsetSide(offset) {
  return (offset || 0) >= 0 ? 1 : -1;
}

function dimOffsetAbs(offset) {
  return Math.abs(offset || 0);
}

function dimHitHandlers(interactive, onSelect, onDoubleClick, dim, labelPos, onHover) {
  if (!interactive) return {};
  return {
    onPointerDown: (e) => {
      e.stopPropagation();
      onSelect?.(e, dim);
    },
    onDoubleClick: (e) => {
      e.stopPropagation();
      onDoubleClick?.(e, dim, labelPos || dim.p1);
    },
    onPointerEnter: () => onHover?.(dim.id),
    onPointerLeave: () => onHover?.(null),
    style: { cursor: "pointer" },
  };
}

export function DimensionLinearEl({
  dim, k, fmtDim, display, selected = false, hovered = false, emphasized = false, onSelect, onDoubleClick, onHover, interactive = true, zoom = 1, presentation = null,
}) {
  const geometry = geometryForDimension(dim, zoom);
  if (!geometry.valid) {
    if (!dim?.invalid) return null;
    const p = dim.p1 || dim.p2 || { x: 0, y: 0 };
    return (
      <g data-dimension={dim.id} data-invalid="1" pointerEvents="all" opacity={0.55}>
        <circle
          cx={p.x}
          cy={p.y}
          r={10 * k}
          fill="none"
          stroke="#c7372f"
          strokeWidth={1.4 * k}
          strokeDasharray={`${4 * k} ${3 * k}`}
          {...dimHitHandlers(interactive, onSelect, onDoubleClick, dim, p, onHover)}
        />
        <title>Размер требует проверки якоря</title>
      </g>
    );
  }
  const kindStyle = dimStyleFromKind(dim);
  const active = selected || emphasized;
  const stroke = active ? DIM_SELECTION_ACCENT : hovered ? "#2a8f7d" : kindStyle.line;
  const labelColor = active ? DIM_SELECTION_TEXT : hovered ? "#1a6b5c" : kindStyle.text;
  const sw = geometry.style.strokeWidthMm || DIM_WORLD_STROKE;
  const hitW = geometry.style.hitSlopMm || 80;
  const labelValueMm = Number.isFinite(dim?.measurementValue)
    ? dim.measurementValue
    : geometry.length;
  const labelText = dim.labelOverride || fmtDim(Math.round(labelValueMm));
  if (!labelText || !String(labelText).trim()) return null;
  if (!(labelValueMm > 0) && dim.mode !== "angle" && dim.mode !== "annotation") return null;
  if (presentation?.visible === false) return null;
  const metrics = geometry.style.labelMetrics
    || resolveLabelMetrics(geometry.style, zoom, labelText);
  const along = Number.isFinite(presentation?.alongDisplacementMm)
    ? presentation.alongDisplacementMm
    : 0;
  const label = computeDimensionLabelPosition(geometry, {
    label: labelText,
    zoom,
    alongDisplacementMm: along,
  });
  if (!label.valid && !presentation?.position) return null;
  // Prefer layout position only when it stays on the line (along-line contract).
  const labelPos = presentation?.position && Number.isFinite(presentation.alongDisplacementMm)
    ? presentation.position
    : (label.valid ? label.position : geometry.labelBase);
  const handlers = dimHitHandlers(interactive, onSelect, onDoubleClick, dim, labelPos, onHover);
  const opacity = dimEffectiveOpacity(display) * (dim.visible === false ? 0 : 1);
  const lineMul = active ? 1.35 : hovered ? 1.15 : 1;

  // CAD knockout: interrupt the dimension line behind the glyphs.
  const unit = geometry.unit;
  const marginMm = Math.max(metrics.haloMm || 0, metrics.fontMm * 0.15);
  const gapHalf = (metrics.widthMm || metrics.fontMm * 2) / 2 + marginMm;
  const dimA = geometry.dimensionLine.a;
  const dimB = geometry.dimensionLine.b;
  const gapA = { x: labelPos.x - unit.x * gapHalf, y: labelPos.y - unit.y * gapHalf };
  const gapB = { x: labelPos.x + unit.x * gapHalf, y: labelPos.y + unit.y * gapHalf };
  const segLen = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const drawLeft = segLen(dimA, gapA) > 1;
  const drawRight = segLen(gapB, dimB) > 1;

  return (
    <g
      data-dimension={dim.id}
      data-mode={geometry.type}
      data-dimension-selected={active ? "true" : undefined}
      data-dimension-source-wall-id={sourceWallIdAttr(dim)}
      data-dimension-semantic={dim.kind || undefined}
      data-label-knockout="1"
      data-hovered={hovered ? "1" : undefined}
      data-emphasized={emphasized ? "1" : undefined}
      pointerEvents="all"
      opacity={opacity}
    >
      {geometry.extensionLines.map((line, i) => (
        <React.Fragment key={`ext-${i}`}>
          <line x1={line.a.x} y1={line.a.y} x2={line.b.x} y2={line.b.y} stroke={stroke} strokeWidth={sw} opacity={0.82} />
          <line x1={line.a.x} y1={line.a.y} x2={line.b.x} y2={line.b.y} stroke="transparent" strokeWidth={hitW} {...handlers} />
        </React.Fragment>
      ))}
      {drawLeft && (
        <line
          x1={dimA.x}
          y1={dimA.y}
          x2={gapA.x}
          y2={gapA.y}
          stroke={stroke}
          strokeWidth={sw * lineMul}
          strokeDasharray={kindStyle.dasharray || undefined}
          data-dim-line-seg="a"
        />
      )}
      {drawRight && (
        <line
          x1={gapB.x}
          y1={gapB.y}
          x2={dimB.x}
          y2={dimB.y}
          stroke={stroke}
          strokeWidth={sw * lineMul}
          strokeDasharray={kindStyle.dasharray || undefined}
          data-dim-line-seg="b"
        />
      )}
      <line
        x1={dimA.x}
        y1={dimA.y}
        x2={dimB.x}
        y2={dimB.y}
        stroke="transparent"
        strokeWidth={hitW}
        {...handlers}
      />
      {geometry.ticks.map((tick, i) => (
        <line key={`tick-${i}`} x1={tick.a.x} y1={tick.a.y} x2={tick.b.x} y2={tick.b.y} stroke={stroke} strokeWidth={sw} />
      ))}
      <g
        {...handlers}
        onPointerDown={(e) => {
          e.stopPropagation();
          onSelect?.(e, dim);
        }}
      >
        {dimLabel(
          labelPos.x, labelPos.y, label.rotationDeg || geometry.textAngleDeg || 0,
          labelText, stroke, 1, labelColor, metrics, null, null,
          { emphasized: active, fontWeight: active ? "700" : "600" },
        )}
      </g>
      {active && (
        <line
          x1={dimA.x}
          y1={dimA.y}
          x2={dimB.x}
          y2={dimB.y}
          stroke={DIM_SELECTION_ACCENT}
          strokeWidth={sw * 1.8}
          opacity={0.12}
          pointerEvents="none"
        />
      )}
      {!active && hovered && (
        <line
          x1={dimA.x}
          y1={dimA.y}
          x2={dimB.x}
          y2={dimB.y}
          stroke="#2a8f7d"
          strokeWidth={sw * 1.5}
          opacity={0.12}
          pointerEvents="none"
        />
      )}
    </g>
  );
}

export function DimensionAngleEl({
  dim, k, fmtDim, display, selected = false, hovered = false, onSelect, onDoubleClick, onHover, interactive = true, zoom = 1, presentation = null,
}) {
  const geometry = geometryForDimension(dim, zoom);
  if (!geometry.valid) {
    if (!dim?.invalid) return null;
    const p = dim.vertex || { x: 0, y: 0 };
    return (
      <g data-dimension={dim.id} data-invalid="1" pointerEvents="all" opacity={0.55}>
        <circle cx={p.x} cy={p.y} r={12 * k} fill="none" stroke="#c7372f" strokeWidth={1.4 * k} strokeDasharray={`${4 * k} ${3 * k}`}
          {...dimHitHandlers(interactive, onSelect, onDoubleClick, dim, p, onHover)} />
        <title>Угловой размер требует проверки</title>
      </g>
    );
  }
  const kindStyle = dimStyleFromKind(dim);
  const stroke = selected ? "#116355" : hovered ? "#2a8f7d" : kindStyle.line;
  const labelColor = selected ? "#0d4f45" : hovered ? "#1a6b5c" : kindStyle.text;
  const sw = geometry.style.strokeWidthMm || DIM_WORLD_STROKE;
  const hitW = geometry.style.hitSlopMm || 80;
  const fontMm = geometry.style.fontSizeMm || DIM_WORLD_FS;
  const labelText = dim.labelOverride || `${Math.round(geometry.angle)}°`;
  const label = computeDimensionLabelPosition(geometry, { label: labelText, zoom });
  const labelPos = presentation?.position || (label.valid ? label.position : geometry.labelBase);
  const handlers = dimHitHandlers(interactive, onSelect, onDoubleClick, dim, labelPos, onHover);
  const d = geometry.points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");

  return (
    <g data-dimension={dim.id} data-mode="angle" data-hovered={hovered ? "1" : undefined} pointerEvents="all" opacity={dimEffectiveOpacity(display)}>
      {geometry.rays.map((ray, i) => (
        <line key={`ray-${i}`} x1={ray.a.x} y1={ray.a.y} x2={ray.b.x} y2={ray.b.y} stroke={stroke} strokeWidth={sw * 0.7} opacity={0.35} />
      ))}
      <path d={d} fill="none" stroke={stroke} strokeWidth={sw * (selected ? 1.35 : hovered ? 1.2 : 1)} strokeDasharray={kindStyle.dasharray || undefined} />
      <path d={d} fill="none" stroke="transparent" strokeWidth={hitW} {...handlers} />
      {label.valid && presentation?.visible !== false && (
        <g {...handlers}>
          {dimLabel(labelPos.x, labelPos.y, 0, labelText, stroke, 1, labelColor, fontMm)}
        </g>
      )}
    </g>
  );
}

export function DimensionAnnotationEl({ dim, k }) {
  if (!dim?.p1 || !dim?.labelOverride) return null;
  return (
    <g pointerEvents="none" data-ui="dim-annotation">
      <text
        x={dim.p1.x}
        y={dim.p1.y}
        textAnchor="middle"
        fontSize={11 * k}
        fill="#111"
        fontWeight="600"
        style={{ fontFamily: "var(--mono)" }}
      >
        {dim.labelOverride}
      </text>
    </g>
  );
}

export function DimensionsLayer({
  dimensions = [], k, fmtDim, display, selectedId, hoveredId, onHover, onSelect, onDoubleClick, zoom = 1, emphasizeWallId = null, emphasizeWall = null,
}) {
  if (!dimensions.length) return null;
  const wallForEmphasis = emphasizeWall
    || (emphasizeWallId && (display?.wallsForEmphasis || []).find((w) => w.id === emphasizeWallId))
    || (emphasizeWallId ? { id: emphasizeWallId } : null);
  const isEmphasized = (dim) => {
    if (!wallForEmphasis) return false;
    return dimensionAssociatesWithWall(dim, wallForEmphasis);
  };
  const presentation = layoutDimensionLabels(
    dimensions.map((dim) => {
      const geom = geometryForDimension(dim, zoom);
      const valueMm = Number.isFinite(dim.measurementValue) ? dim.measurementValue : (geom.length || 0);
      return {
        ...dim,
        selected: selectedId === dim.id || isEmphasized(dim),
        label: dim.labelOverride || (dim.mode === "angle" ? `${Math.round(dim.angle || 0)}°` : fmtDim(Math.round(valueMm))),
      };
    }),
    Object.fromEntries(dimensions.map((dim) => [dim.id, geometryForDimension(dim, zoom)])),
    { zoom, selectedId, walls: display?.wallsForLabelAvoid || [] },
  );
  const presentationById = new Map(presentation.map((entry) => [entry.id, entry]));
  return (
    <g
      data-ui="dimensions-runtime"
      data-emphasize-wall={emphasizeWallId || wallForEmphasis?.id || undefined}
    >
      {dimensions.map((dim) => {
        if (dim.visible === false) return null;
        const geom = geometryForDimension(dim, zoom);
        const valueMm = Number.isFinite(dim.measurementValue) ? dim.measurementValue : (geom.length || 0);
        const labelText = dim.labelOverride
          || (dim.mode === "angle" ? `${Math.round(dim.angle || 0)}°` : fmtDim(Math.round(valueMm)));
        if (!labelText || !String(labelText).trim()) return null;
        if (!(valueMm > 0) && dim.mode !== "angle" && dim.mode !== "annotation") return null;
        const entry = presentationById.get(dim.id);
        if (entry && entry.visible === false) return null;
        const emphasized = isEmphasized(dim);
        if (dim.mode === "annotation") {
          return <DimensionAnnotationEl key={dim.id} dim={dim} k={k} />;
        }
        if (dim.mode === "angle") {
          return (
            <DimensionAngleEl
              key={dim.id}
              dim={dim}
              k={k}
              fmtDim={fmtDim}
              display={display}
              selected={selectedId === dim.id}
              hovered={hoveredId === dim.id}
              interactive
              zoom={zoom}
              onSelect={onSelect}
              onDoubleClick={onDoubleClick}
              onHover={onHover}
              presentation={entry}
            />
          );
        }
        return (
          <DimensionLinearEl
            key={dim.id}
            dim={dim}
            k={k}
            fmtDim={fmtDim}
            display={display}
            selected={selectedId === dim.id}
            emphasized={emphasized}
            hovered={hoveredId === dim.id}
            interactive
            zoom={zoom}
            onSelect={onSelect}
            onDoubleClick={onDoubleClick}
            onHover={onHover}
            presentation={entry}
          />
        );
      })}
    </g>
  );
}

export function DimensionDraftEl({
  p1, p2, offsetPoint, k, fmtDim, display, snapPt,
}) {
  if (!p1 || !p2) return null;
  if (!offsetPoint) {
    return <RulerDraftEl a={p1} b={p2} k={k} fmtU={fmtDim} display={display} snapPt={snapPt} />;
  }
  const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const nx = -(p2.y - p1.y) / (len || 1);
  const ny = (p2.x - p1.x) / (len || 1);
  const offset = (offsetPoint.x - p1.x) * nx + (offsetPoint.y - p1.y) * ny;
  return (
    <g data-ui="dimension-draft" pointerEvents="none">
      <SegDim
        a={p1}
        b={p2}
        label={fmtDim(Math.round(len))}
        k={k}
        display={display}
        offset={Math.abs(offset)}
        offsetSide={offset >= 0 ? 1 : -1}
        color="#8f9a94"
        labelColor="#111111"
      />
      {snapPt?.snapped && (
        <circle cx={offsetPoint.x} cy={offsetPoint.y} r={5 * k} fill="none" stroke="#116355" strokeWidth={1.2 * k} />
      )}
    </g>
  );
}

/** Точки размерной линии по наружной грани стены (не по оси). */
export function wallSegDimPoints(a, b, wall, room, face = "outer") {
  if (!wall?.pts?.length) {
    return {
      a: wallFacePoint(a, a, b, face, wall || {}, room),
      b: wallFacePoint(b, a, b, face, wall || {}, room),
      face: false,
    };
  }
  const segIndex = (wall?.pts || []).findIndex((p, i) => {
    const n = wall?.pts?.[i + 1];
    if (!n) return false;
    return Math.hypot(p.x - a.x, p.y - a.y) <= 0.01 && Math.hypot(n.x - b.x, n.y - b.y) <= 0.01;
  });
  const outline = segIndex >= 0 ? wallOutlineSegment(wall, segIndex, face, room) : null;
  if (outline?.a && outline?.b) return { a: outline.a, b: outline.b, face: true };
  // Estimated face via thickness offset — not used by selection overlay (requires face:true).
  return {
    a: wallFacePoint(a, a, b, face, wall, room),
    b: wallFacePoint(b, a, b, face, wall, room),
    face: false,
  };
}

export function wallSegDimLength(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Сторона выноса размера стены — наружу от центра помещения. */
export function wallSegmentOffsetSide(a, b, room) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const rcx = room?.w ? room.w / 2 : mx;
  const rcy = room?.h ? room.h / 2 : my;
  const dot = (rcx - mx) * nx + (rcy - my) * ny;
  return dot > 0 ? 1 : -1;
}

/** Ширина и глубина прямоугольного объекта (вид сверху). */
export function RectDims({
  x, y, w, h, k, fmtU, offset = 48, active = false, state = null, display, color = null, edgeOffset = true,
}) {
  if (w < 40 && h < 40) return null;
  const st = state || (active ? "active" : "normal");
  const off = edgeOffset ? Math.min(offset, Math.min(w, h) * 0.35) : offset;
  return (
    <g data-ui="dim">
      {w >= 40 && (
        <SegDim
          a={{ x, y }}
          b={{ x: x + w, y }}
          label={fmtU(w)}
          k={k}
          display={display}
          offset={off}
          offsetSide={-1}
          state={st}
          color={color}
          minLen={30}
        />
      )}
      {h >= 40 && (
        <SegDim
          a={{ x: x + w, y: y + h }}
          b={{ x, y: y + h }}
          label={fmtU(h)}
          k={k}
          display={display}
          offset={off}
          offsetSide={-1}
          state={st}
          color={color}
          minLen={30}
        />
      )}
    </g>
  );
}

/** Габариты объекта в цвет материала (не двери/проёмы). */
export function ItemDims({ it, k, fmtU, display, show = true }) {
  if (!show || it.dimensions?.display === false) return null;
  const color = it.color || WALL_DIM_COLOR;
  const cx = it.x + it.w / 2;
  const cy = it.y + it.h / 2;
  const isRound = it.shape === "round" || it.kind === "tank_round";
  if (isRound) {
    const d = Math.min(it.w, it.h);
    return (
      <g data-ui="dim-item" transform={`translate(${cx},${cy})`}>
        <SegDim
          a={{ x: -d / 2, y: 0 }}
          b={{ x: d / 2, y: 0 }}
          label={fmtU(d)}
          k={k}
          display={display}
          offset={d * 0.35}
          offsetSide={-1}
          color={color}
          minLen={30}
        />
      </g>
    );
  }
  return (
    <g data-ui="dim-item">
      <RectDims
        x={it.x}
        y={it.y}
        w={it.w}
        h={it.h}
        k={k}
        fmtU={fmtU}
        display={display}
        color={color}
        edgeOffset
      />
    </g>
  );
}

/** Размеры отступов до стен и препятствий. */
export function ClearanceDims({
  it, plan, k, fmtU, display, warnMm = DEFAULT_PASSAGE_WARN_MM, errorMm = DEFAULT_PASSAGE_ERROR_MM,
}) {
  const lines = computeClearances(it, plan);
  if (!lines.length) return null;
  return (
    <g data-ui="dim">
      {lines.map((ln, i) => {
        const dist = Math.round(ln.dist);
        return (
          <SegDim
            key={i}
            a={ln.a}
            b={ln.b}
            label={fmtU(dist)}
            k={k}
            display={display}
            offset={90}
            offsetSide={ln.offsetSide ?? -1}
            state={resolveDimState({ distanceMm: dist, warnMm, errorMm, active: true })}
            minLen={MIN_CLEAR_DIM}
          />
        );
      })}
    </g>
  );
}

/** @deprecated use ClearanceDims */
export function WallMountedDim({ it, plan, k, fmtU }) {
  if (!isWallMountedItem(it)) return null;
  return <ClearanceDims it={it} plan={plan} k={k} fmtU={fmtU} />;
}

/** Размеры контура помещения. */
export function RoomOutlineDims({ room, k, fmtU, display }) {
  const o = dimEffectiveOffset(180, display);
  return (
    <g data-ui="dim">
      <SegDim a={{ x: 0, y: 0 }} b={{ x: room.w, y: 0 }} label={fmtU(room.w)} k={k} display={display} offset={o} offsetSide={-1} state="normal" color={WALL_DIM_COLOR} />
      <SegDim a={{ x: room.w, y: room.h }} b={{ x: 0, y: room.h }} label={fmtU(room.h)} k={k} display={display} offset={o} offsetSide={1} state="normal" color={WALL_DIM_COLOR} />
    </g>
  );
}

export function wallSegmentDimElements(wall, room, { k, fmtU, display, offset, state = "normal", keyPrefix = "" }) {
  if (!wall?.pts || wall.pts.length < 2) return { segs: [], total: 0 };
  let total = 0;
  const segs = [];
  for (let i = 1; i < wall.pts.length; i++) {
    const axisA = wall.pts[i - 1];
    const axisB = wall.pts[i];
    const facePts = wallSegDimPoints(axisA, axisB, wall, room);
    // Selection overlays require a proven joined outline, not thickness estimate.
    if (!facePts?.face) continue;
    const { a, b } = facePts;
    const len = wallSegDimLength(a, b);
    if (!(len >= 100)) continue;
    const label = fmtU(Math.round(len));
    if (!label || !String(label).trim()) continue;
    total += len;
    segs.push(
      <SegDim
        key={`${keyPrefix}${i}`}
        a={a}
        b={b}
        label={label}
        k={k}
        display={display}
        offset={dimEffectiveOffset(offset, display)}
        offsetSide={wallSegmentOffsetSide(axisA, axisB, room)}
        state={state}
        color={WALL_DIM_COLOR}
      />,
    );
  }
  return { segs, total };
}

/**
 * PHASE 2F1 — selection must NOT generate new dimension geometry.
 * Canonical auto dims already on the canvas are emphasized via DimensionsLayer
 * (emphasizeWallId). This overlay always suppresses.
 */
export function planSelectedWallDimensions(wall, room, dimensions = []) {
  const diagnostics = [{
    reason: "SELECTION_GEOMETRY_DISABLED",
    policy: "reuse_canonical_only",
    wallId: wall?.id || null,
  }];
  if (!wall?.pts || wall.pts.length < 2) {
    return {
      mode: "suppress",
      segments: [],
      rejectionReason: "NO_WALL_GEOMETRY",
      diagnostics,
    };
  }
  const wallId = wall.id;
  const hasCanonical = (dimensions || []).some((d) => {
    const ids = d.sourceWallIds || d.reference?.sourceWallIds || [];
    return d.wallId === wallId
      || ids.includes?.(wallId)
      || ids.includes?.(String(wallId))
      || (typeof d.id === "string" && d.id.includes(String(wallId)));
  });
  return {
    mode: "suppress",
    segments: [],
    rejectionReason: hasCanonical
      ? "CANONICAL_EXISTS_NO_SELECTION_OVERLAY"
      : "NO_PHYSICAL_FACE_SPAN",
    diagnostics: [
      ...diagnostics,
      { reason: hasCanonical ? "EMPHASIZE_EXISTING_ONLY" : "NO_CANONICAL_DIM" },
    ],
  };
}

/**
 * Selected-wall overlay — disabled for Phase 2F1.
 * Never paints node/centreline geometry. Selection emphasis is handled by
 * DimensionsLayer via emphasizeWallId.
 */
export function WallSelectionDims() {
  return null;
}

/** Цепочки размеров стен (чистовые/габаритные + общий габарит + толщина). */
export function WallDimChains({ walls, room, items, k, fmtU, display }) {
  const { chains, overall } = computeWallDimChains(walls, room, items, {
    showFinishing: display.showWallChainFinishing !== false,
    showGross: display.showWallChainGross !== false,
  });
  const all = [...chains, ...overall];
  if (!all.length) return null;
  return (
    <g data-ui="dim-wall-chains" pointerEvents="none">
      {all.map((seg) => (
        <SegDim
          key={seg.key}
          a={seg.a}
          b={seg.b}
          label={fmtU(Math.round(seg.len))}
          k={k}
          display={display}
          offset={seg.offset}
          offsetSide={seg.offsetSide}
          state="normal"
          color={WALL_DIM_COLOR}
          minLen={seg.kind === "thickness" ? 5 : 40}
        />
      ))}
    </g>
  );
}

/** Зафиксированная красная линейка. */
export function RulerEl({ ruler, k, fmtU, display, selected, onSel, onDel, onDragStart }) {
  if (!ruler?.a || !ruler?.b) return null;
  const len = Math.hypot(ruler.b.x - ruler.a.x, ruler.b.y - ruler.a.y);
  if (len < 1) return null;
  const handleDown = (e, end) => {
    e.stopPropagation();
    onDragStart?.(e, ruler.id, end);
  };
  return (
    <g data-ruler={ruler.id} pointerEvents="all">
      <line
        x1={ruler.a.x}
        y1={ruler.a.y}
        x2={ruler.b.x}
        y2={ruler.b.y}
        stroke="transparent"
        strokeWidth={14 * k}
        onPointerDown={(e) => {
          e.stopPropagation();
          if (e.button === 0) onDragStart?.(e, ruler.id, null);
          onSel?.(e, ruler.id);
        }}
        style={{ cursor: "move" }}
      />
      <SegDim
        a={ruler.a}
        b={ruler.b}
        label={fmtU(Math.round(len))}
        k={k}
        display={display}
        offset={0}
        offsetSide={1}
        color={RULER_COLOR}
        strokeWidthMul={1.2}
        minLen={1}
      />
      {selected && (
        <>
          <circle
            cx={ruler.a.x}
            cy={ruler.a.y}
            r={6 * k}
            fill="#fff"
            stroke={RULER_COLOR}
            strokeWidth={1.5 * k}
            onPointerDown={(e) => handleDown(e, "a")}
            style={{ cursor: "crosshair" }}
          />
          <circle
            cx={ruler.b.x}
            cy={ruler.b.y}
            r={6 * k}
            fill="#fff"
            stroke={RULER_COLOR}
            strokeWidth={1.5 * k}
            onPointerDown={(e) => handleDown(e, "b")}
            style={{ cursor: "crosshair" }}
          />
          <text
            x={ruler.b.x + 14 * k}
            y={ruler.b.y - 10 * k}
            fontSize={13 * k}
            fill="#a5371f"
            style={{ cursor: "pointer" }}
            onClick={(e) => { e.stopPropagation(); onDel?.(ruler.id); }}
          >
            ✕
          </text>
        </>
      )}
    </g>
  );
}

/** Черновик линейки при протягивании. */
export function RulerDraftEl({ a, b, k, fmtU, display, snapPt }) {
  if (!a || !b) return null;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return (
    <g data-ui="ruler-draft" pointerEvents="none">
      <SegDim
        a={a}
        b={b}
        label={fmtU(Math.round(len))}
        k={k}
        display={display}
        offset={0}
        offsetSide={1}
        color={RULER_COLOR}
        strokeWidthMul={1.2}
        minLen={1}
      />
      {snapPt?.snapped && (
        <circle cx={b.x} cy={b.y} r={5 * k} fill="none" stroke={RULER_COLOR} strokeWidth={1.2 * k} />
      )}
    </g>
  );
}
