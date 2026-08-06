/**
 * PHASE 2F1-LIVE4 — RemPlanner-style hierarchical adaptive CAD grid.
 * Pure helpers: 1–2–5 step family, CSS background descriptors (O(1) DOM).
 */

export const GRID_STEP_FAMILY = Object.freeze([
  10, 20, 50,
  100, 200, 500,
  1000, 2000, 5000,
  10000, 20000, 50000,
  100000, 200000, 500000,
]);

const MIN_MINOR_PX = 12;
const MAX_MINOR_PX = 30;
const TARGET_MINOR_PX = 18;

/**
 * Choose minor step (mm) so screen spacing stays ~12–30 px.
 */
export function chooseMinorGridStepMm(zoom, {
  minPx = MIN_MINOR_PX,
  maxPx = MAX_MINOR_PX,
  targetPx = TARGET_MINOR_PX,
} = {}) {
  const z = Math.max(Number(zoom) || 1, 1e-6);
  let best = GRID_STEP_FAMILY[0];
  let bestErr = Infinity;
  for (const step of GRID_STEP_FAMILY) {
    const px = step * z;
    const err = Math.abs(px - targetPx);
    const inRange = px >= minPx && px <= maxPx;
    if (inRange && err < bestErr) {
      best = step;
      bestErr = err;
    } else if (!Number.isFinite(bestErr) || bestErr === Infinity) {
      if (err < bestErr) {
        best = step;
        bestErr = err;
      }
    }
  }
  // Prefer an in-range step even if slightly farther from target.
  for (const step of GRID_STEP_FAMILY) {
    const px = step * z;
    if (px >= minPx && px <= maxPx) return step;
  }
  return best;
}

/** Major = 5× or 10× minor (whichever stays on the 1–2–5 family). */
export function chooseMajorGridStepMm(minorMm) {
  const m = Number(minorMm) || 100;
  const x5 = m * 5;
  const x10 = m * 10;
  if (GRID_STEP_FAMILY.includes(x5)) return x5;
  if (GRID_STEP_FAMILY.includes(x10)) return x10;
  return x10;
}

export function resolveAdaptiveGrid(view = {}, display = {}) {
  if (display?.showGrid === false) {
    return { visible: false, minorMm: null, majorMm: null, minorPx: 0, majorPx: 0 };
  }
  const zoom = Math.max(view?.zoom || 1, 1e-6);
  const minorMm = chooseMinorGridStepMm(zoom);
  const majorMm = chooseMajorGridStepMm(minorMm);
  const showMinor = display?.showMinorGrid !== false && display?.showFineGrid !== false;
  const showMajor = display?.showMajorGrid !== false;
  const minorPx = minorMm * zoom;
  const majorPx = majorMm * zoom;
  // Fade minor when denser than minPx (extreme zoom-in still has major).
  const minorOpacity = !showMinor || minorPx < MIN_MINOR_PX * 0.85
    ? 0
    : (minorPx > MAX_MINOR_PX * 1.2 ? 0.55 : 1);
  const majorOpacity = showMajor ? 1 : 0;
  return {
    visible: showMinor || showMajor,
    minorMm,
    majorMm,
    minorPx,
    majorPx,
    minorOpacity,
    majorOpacity,
    zoom,
    panX: view?.panX || 0,
    panY: view?.panY || 0,
  };
}

/**
 * CSS background descriptor for an O(1) grid layer (no per-line DOM).
 * World origin (0,0) maps to screen (panX, panY).
 */
export function adaptiveGridCssBackground(grid) {
  if (!grid?.visible) return { backgroundImage: "none" };
  const { minorPx, majorPx, panX, panY, minorOpacity, majorOpacity } = grid;
  const posMinorX = ((panX % minorPx) + minorPx) % minorPx;
  const posMinorY = ((panY % minorPx) + minorPx) % minorPx;
  const posMajorX = ((panX % majorPx) + majorPx) % majorPx;
  const posMajorY = ((panY % majorPx) + majorPx) % majorPx;

  const minorColor = `rgba(40, 50, 45, ${0.045 * minorOpacity})`;
  const majorColor = `rgba(40, 50, 45, ${0.12 * majorOpacity})`;

  const layers = [];
  const sizes = [];
  const positions = [];

  if (majorOpacity > 0.01) {
    layers.push(
      `linear-gradient(to right, ${majorColor} 0, ${majorColor} 1px, transparent 1px)`,
      `linear-gradient(to bottom, ${majorColor} 0, ${majorColor} 1px, transparent 1px)`,
    );
    sizes.push(`${majorPx}px ${majorPx}px`, `${majorPx}px ${majorPx}px`);
    positions.push(`${posMajorX}px 0`, `0 ${posMajorY}px`);
  }
  if (minorOpacity > 0.01) {
    layers.push(
      `linear-gradient(to right, ${minorColor} 0, ${minorColor} 1px, transparent 1px)`,
      `linear-gradient(to bottom, ${minorColor} 0, ${minorColor} 1px, transparent 1px)`,
    );
    sizes.push(`${minorPx}px ${minorPx}px`, `${minorPx}px ${minorPx}px`);
    positions.push(`${posMinorX}px 0`, `0 ${posMinorY}px`);
  }

  return {
    backgroundImage: layers.join(", "),
    backgroundSize: sizes.join(", "),
    backgroundPosition: positions.join(", "),
    backgroundRepeat: "repeat",
  };
}

/**
 * Cursor-centred zoom: preserve world point under screen cursor.
 */
export function cursorCenteredZoomView(view, {
  screenX,
  screenY,
  nextZoom,
  minZoom = 0.015,
  maxZoom = 3,
} = {}) {
  const z0 = Math.max(view?.zoom || 1, 1e-6);
  const z1 = Math.min(maxZoom, Math.max(minZoom, nextZoom));
  const panX = view?.panX || 0;
  const panY = view?.panY || 0;
  const worldX = (screenX - panX) / z0;
  const worldY = (screenY - panY) / z0;
  return {
    zoom: z1,
    panX: screenX - worldX * z1,
    panY: screenY - worldY * z1,
    worldUnderCursor: { x: worldX, y: worldY },
  };
}

/** Viewport LOD from zoom (model→screen scale). */
export function resolveViewportLod(zoom) {
  const z = Number(zoom) || 1;
  if (z < 0.12) return "overview";
  if (z < 0.55) return "normal";
  return "detail";
}
