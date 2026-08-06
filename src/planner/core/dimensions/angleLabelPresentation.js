/**
 * PHASE 2F2.3–2F2.6 — angle annotation presentation (screen-space).
 *
 * Semantics stay in cornerAngleDimensions / angleMagnetSnap.
 * 2F2.4: zoom-responsive scale, longer LOD + hysteresis, translucent label chip.
 * 2F2.5: slightly larger/bolder type + stronger chip; paint order is overlay DOM.
 * 2F2.6: complete-label micro bump + slightly thicker arcs (no °-only styling).
 */
import { zoomResponsiveGripRadiusPx } from "../viewport/gripScale.js";

/** Reference zoom for “normal editing” size. */
export const ANGLE_ZOOM_REF = 0.35;
/** Soft power for modest grow/shrink with camera (RemPlanner-like). */
export const ANGLE_ZOOM_GAMMA = 0.42;

/** Hide when zooming out below this (while previously visible). */
export const ANGLE_LOD_HIDE_ZOOM = 0.068;
/** Show again when zooming in above this (hysteresis vs hide). */
export const ANGLE_LOD_SHOW_ZOOM = 0.078;
/** Legacy alias — angles may remain visible below adaptiveGrid overview(0.12). */
export const ANGLE_OVERVIEW_ZOOM = ANGLE_LOD_HIDE_ZOOM;

/** PHASE 2F2.6 — complete label (digits + °) micro bump vs 2F2.5. */
export const SELECTED_FONT_REF_PX = 15.5;
export const MOVEMENT_FONT_REF_PX = 16;
export const ANGLE_FONT_MIN_SELECTED_PX = 12;
export const ANGLE_FONT_MIN_MOVEMENT_PX = 12.5;
/** Alias — selected floor (LOD readability). */
export const ANGLE_FONT_MIN_PX = ANGLE_FONT_MIN_SELECTED_PX;
export const ANGLE_FONT_MAX_SELECTED_PX = 20;
export const ANGLE_FONT_MAX_MOVEMENT_PX = 20;
/** @deprecated use ANGLE_FONT_MIN_PX — kept for 2F2.3 imports */
export const SELECTED_ANGLE_FONT_PX = SELECTED_FONT_REF_PX;
export const MOVEMENT_ANGLE_FONT_PX = MOVEMENT_FONT_REF_PX;
export const ANGLE_FONT_MAX_PX = ANGLE_FONT_MAX_SELECTED_PX;

/**
 * Complete label weight (digits, decimal, ° — one text node).
 * Prefer real weight over thicker halo.
 */
export const ANGLE_FONT_WEIGHT = 800;
export const ANGLE_FONT_WEIGHT_MIN = 750;
export const ANGLE_FONT_WEIGHT_MAX = 800;

export const SELECTED_ARC_REF_PX = 30;
export const MOVEMENT_ARC_REF_PX = 34;
export const SELECTED_ARC_MIN_PX = 22;
export const SELECTED_ARC_MAX_PX = 42;
export const MOVEMENT_ARC_MIN_PX = 26;
export const MOVEMENT_ARC_MAX_PX = 48;

/** PHASE 2F2.6 — slightly thicker arcs (+~0.5 px vs 1.5). Geometry unchanged. */
export const ANGLE_STROKE_SELECTED_PX = 2.05;
export const ANGLE_STROKE_MOVEMENT_PX = 2.2;
/** Alias — selected stroke (legacy call sites). */
export const ANGLE_STROKE_PX = ANGLE_STROKE_SELECTED_PX;
/** Compact halo — thick stroke reads as fake-bold blur on °. */
export const ANGLE_HALO_STROKE_PX = 2.2;
export const ANGLE_LABEL_GAP_PX = 9;
export const ANGLE_GRIP_CLEAR_PX = 7;
export const ANGLE_PAIR_STAGGER_PX = 5;
export const ANGLE_SHORT_SECTOR_LABEL_EXTRA_PX = 4;

/** Compact RemPlanner-style chip behind the full value (incl. °). */
export const ANGLE_CHIP_PAD_X_PX = 4;
export const ANGLE_CHIP_PAD_Y_PX = 2;
export const ANGLE_CHIP_RADIUS_PX = 3;
export const ANGLE_CHIP_FILL = "#f7faf8";
/** PHASE 2F2.5 — slightly stronger mask under black dim lines. */
export const ANGLE_CHIP_OPACITY = 0.80;
export const ANGLE_CHIP_OPACITY_MIN = 0.76;
export const ANGLE_CHIP_OPACITY_MAX = 0.84;

/**
 * Authoritative SVG paint stack (DOM order inside the world transform).
 * Later entries paint above earlier ones.
 */
export const ANGLE_SVG_PAINT_STACK = Object.freeze([
  "grid",
  "wall-fill-hatch",
  "wall-outlines",
  "linear-dimensions",
  "angle-arcs",
  "angle-chips",
  "angle-text",
  "endpoint-grips",
]);

export const ANGLE_ALONG_ARC_SHIFTS_DEG = Object.freeze([0, -8, 8, -14, 14, -20, 20]);
export const ANGLE_RADIUS_NUDGES_PX = Object.freeze([0, 4, 8, 12]);

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

export function screenPxToWorldMm(px, zoom) {
  return (Number(px) || 0) / Math.max(Number(zoom) || 1, 1e-6);
}

export function worldMmToScreenPx(mm, zoom) {
  return (Number(mm) || 0) * Math.max(Number(zoom) || 1, 1e-6);
}

/**
 * Bounded monotonic zoom curve around ANGLE_ZOOM_REF.
 * raw = ref * (zoom/ref)^gamma, then clamp.
 */
export function zoomResponsivePx(zoom, refPx, minPx, maxPx, {
  refZoom = ANGLE_ZOOM_REF,
  gamma = ANGLE_ZOOM_GAMMA,
} = {}) {
  const z = Math.max(Number(zoom) || 1e-6, 1e-6);
  const raw = refPx * ((z / refZoom) ** gamma);
  return clamp(raw, minPx, maxPx);
}

export function angleFontPx(zoomOrMode = "selected", modeArg = null) {
  // Back-compat: angleFontPx("selected") | angleFontPx(zoom, "selected")
  let zoom = ANGLE_ZOOM_REF;
  let mode = "selected";
  if (typeof zoomOrMode === "number") {
    zoom = zoomOrMode;
    mode = modeArg || "selected";
  } else if (typeof zoomOrMode === "string") {
    mode = zoomOrMode;
  }
  if (mode === "movement") {
    return zoomResponsivePx(
      zoom,
      MOVEMENT_FONT_REF_PX,
      ANGLE_FONT_MIN_MOVEMENT_PX,
      ANGLE_FONT_MAX_MOVEMENT_PX,
    );
  }
  return zoomResponsivePx(
    zoom,
    SELECTED_FONT_REF_PX,
    ANGLE_FONT_MIN_SELECTED_PX,
    ANGLE_FONT_MAX_SELECTED_PX,
  );
}

/**
 * Angle-specific LOD with show/hide hysteresis.
 * Independent of adaptiveGrid overview (0.12) so annotations stay longer.
 */
export function anglesVisibleAtZoom(zoom, { wasVisible = false } = {}) {
  const z = Number(zoom) || 0;
  if (wasVisible) {
    if (z < ANGLE_LOD_HIDE_ZOOM) return false;
  } else if (z < ANGLE_LOD_SHOW_ZOOM) {
    return false;
  }
  // Also require the scaled font to stay at/above the readable floor.
  const font = angleFontPx(z, "selected");
  return font + 1e-9 >= ANGLE_FONT_MIN_PX;
}

export function angleLod(zoom) {
  return anglesVisibleAtZoom(zoom) ? (zoom >= 0.55 ? "detail" : "normal") : "overview";
}

function clampArcWorld(zoom, thk, { refPx, minPx, maxPx }) {
  const z = Math.max(Number(zoom) || 1, 1e-6);
  const t = Number(thk) || 100;
  const targetPx = zoomResponsivePx(z, refPx, minPx, maxPx);
  let world = targetPx / z;
  const thkFloor = Math.min(t * 0.28 + 6, maxPx / z);
  world = Math.max(world, thkFloor);
  let px = world * z;
  if (px < minPx) world = minPx / z;
  if (px > maxPx) world = maxPx / z;
  return world;
}

export function selectedCornerArcRadiusMm(zoom, thk = 100) {
  return clampArcWorld(zoom, thk, {
    refPx: SELECTED_ARC_REF_PX,
    minPx: SELECTED_ARC_MIN_PX,
    maxPx: SELECTED_ARC_MAX_PX,
  });
}

export function movementCornerArcRadiusMm(zoom, thk = 100) {
  return clampArcWorld(zoom, thk, {
    refPx: MOVEMENT_ARC_REF_PX,
    minPx: MOVEMENT_ARC_MIN_PX,
    maxPx: MOVEMENT_ARC_MAX_PX,
  });
}

export function arcRadiusScreenPx(radiusMm, zoom) {
  return worldMmToScreenPx(radiusMm, zoom);
}

export function angleLabelMinRadiusMm(zoom, {
  fontPx = null,
  gripClearPx = ANGLE_GRIP_CLEAR_PX,
  mode = "selected",
} = {}) {
  const z = Math.max(Number(zoom) || 1, 1e-6);
  const fp = Number.isFinite(fontPx) ? fontPx : angleFontPx(z, mode);
  const gripPx = zoomResponsiveGripRadiusPx(z);
  const textHalfPx = fp * 0.4;
  return screenPxToWorldMm(gripPx + gripClearPx + textHalfPx, z);
}

export function angleLabelRadiusMm(arcRadiusMm, zoom, {
  mode = "selected",
  pairIndex = 0,
  sweepDeg = 90,
  fontPx = null,
} = {}) {
  const z = Math.max(Number(zoom) || 1, 1e-6);
  const fp = Number.isFinite(fontPx) ? fontPx : angleFontPx(z, mode);
  const gap = ANGLE_LABEL_GAP_PX + (sweepDeg < 50 ? ANGLE_SHORT_SECTOR_LABEL_EXTRA_PX : 0);
  const stagger = pairIndex * ANGLE_PAIR_STAGGER_PX;
  const fromArc = (Number(arcRadiusMm) || 0) + screenPxToWorldMm(gap + stagger, z);
  const minR = angleLabelMinRadiusMm(z, { fontPx: fp, mode });
  return Math.max(fromArc, minR);
}

export function angleStrokePx(mode = "selected") {
  return mode === "movement" ? ANGLE_STROKE_MOVEMENT_PX : ANGLE_STROKE_SELECTED_PX;
}

export function angleStrokeWorld(zoom, mode = "selected") {
  return screenPxToWorldMm(angleStrokePx(mode), zoom);
}

export function angleHaloStrokeWorld(zoom) {
  return screenPxToWorldMm(ANGLE_HALO_STROKE_PX, zoom);
}

export function angleGripOccupancy(vertex, zoom, mode = "selected") {
  if (!vertex || !Number.isFinite(vertex.x) || !Number.isFinite(vertex.y)) return null;
  const fp = angleFontPx(zoom, mode);
  const clearMm = angleLabelMinRadiusMm(zoom, { fontPx: fp, mode })
    - screenPxToWorldMm(fp * 0.4, zoom);
  return {
    point: { x: vertex.x, y: vertex.y },
    clearMm: Math.max(0, clearMm),
  };
}

/**
 * Estimated text box in screen px (no DOM). Monospace-ish width for "118.0°".
 */
export function estimateAngleTextSizePx(text, fontPx) {
  const t = String(text || "");
  const fp = Math.max(Number(fontPx) || SELECTED_FONT_REF_PX, 1);
  // Digits + decimal + degree — mono factor calibrated for var(--mono).
  const w = Math.max(fp * 2.2, t.length * fp * 0.62);
  const h = fp * 1.12;
  return { width: w, height: h };
}

export function angleChipLayoutPx(text, fontPx) {
  const box = estimateAngleTextSizePx(text, fontPx);
  return {
    width: box.width + ANGLE_CHIP_PAD_X_PX * 2,
    height: box.height + ANGLE_CHIP_PAD_Y_PX * 2,
    padX: ANGLE_CHIP_PAD_X_PX,
    padY: ANGLE_CHIP_PAD_Y_PX,
    rx: ANGLE_CHIP_RADIUS_PX,
    opacity: ANGLE_CHIP_OPACITY,
    fill: ANGLE_CHIP_FILL,
  };
}

/** World-mm chip rect centered on labelPos (for SVG under scale(zoom)). */
export function angleChipRectWorld(labelPos, text, fontPx, zoom) {
  if (!labelPos || !Number.isFinite(labelPos.x) || !Number.isFinite(labelPos.y)) {
    return null;
  }
  const chip = angleChipLayoutPx(text, fontPx);
  const z = Math.max(Number(zoom) || 1, 1e-6);
  const w = chip.width / z;
  const h = chip.height / z;
  return {
    x: labelPos.x - w / 2,
    y: labelPos.y - h / 2,
    width: w,
    height: h,
    rx: chip.rx / z,
    ry: chip.rx / z,
    opacity: chip.opacity,
    fill: chip.fill,
    pointerEvents: "none",
  };
}

function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * Pick label polar placement that clears visible grip + optional peer labels.
 * Never changes the sector — only mid-angle shift and radius nudge.
 */
export function resolveAngleLabelPlacement({
  vertex,
  startDeg,
  sweepDeg,
  arcRadiusMm,
  zoom,
  mode = "selected",
  pairIndex = 0,
  text = "",
  peerLabelPositions = [],
  labelShiftDeg = 0,
} = {}) {
  const z = Math.max(Number(zoom) || 1, 1e-6);
  const fontPx = angleFontPx(z, mode);
  const chip = angleChipLayoutPx(text, fontPx);
  const halfDiagPx = Math.hypot(chip.width, chip.height) * 0.5;
  const gripPx = zoomResponsiveGripRadiusPx(z);
  const minDistPx = gripPx + ANGLE_GRIP_CLEAR_PX + halfDiagPx * 0.85;
  const peerMinPx = chip.height * 0.95;

  const baseShift = Number(labelShiftDeg) || 0;
  const shortBias = !baseShift && sweepDeg < 50 ? (pairIndex % 2 === 0 ? -6 : 6) : 0;
  let best = null;

  for (const nudgePx of ANGLE_RADIUS_NUDGES_PX) {
    for (const along of ANGLE_ALONG_ARC_SHIFTS_DEG) {
      const shift = baseShift + shortBias + along;
      const mid = startDeg + sweepDeg / 2 + shift;
      const labelR = angleLabelRadiusMm(arcRadiusMm, z, {
        mode,
        pairIndex,
        sweepDeg,
        fontPx,
      }) + screenPxToWorldMm(nudgePx, z);
      const pos = {
        x: vertex.x + Math.cos((mid * Math.PI) / 180) * labelR,
        y: vertex.y + Math.sin((mid * Math.PI) / 180) * labelR,
      };
      const fromVertexPx = worldMmToScreenPx(
        Math.hypot(pos.x - vertex.x, pos.y - vertex.y),
        z,
      );
      let score = Math.abs(along) * 0.4 + nudgePx * 0.5;
      let ok = fromVertexPx >= minDistPx - 0.5;
      if (!ok) score += 200;
      for (const peer of peerLabelPositions || []) {
        if (!peer) continue;
        const dPx = worldMmToScreenPx(Math.sqrt(dist2(pos, peer)), z);
        if (dPx < peerMinPx) {
          ok = false;
          score += 120 + (peerMinPx - dPx);
        }
      }
      const candidate = {
        labelPos: pos,
        labelRadiusMm: labelR,
        labelShiftDeg: shift,
        fontPx,
        score,
        ok,
      };
      if (!best || (ok && !best.ok) || (ok === best.ok && score < best.score)) {
        best = candidate;
      }
      if (ok && score < 1) return best;
    }
  }
  return best;
}
