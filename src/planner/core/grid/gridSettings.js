/** Настройки и уровни сетки планировщика. */

export const GRID_MINOR_STEP = 50;
export const GRID_MEDIUM_STEP = 100;
export const GRID_MAJOR_STEP = 1000;
export const GRID_FINE_STEP = 50;
export const GRID_DEFAULT_SNAP_STEP = 50;

export const GRID_COLORS = {
  minor: "rgba(40, 50, 45, 0.02)",
  fine: "rgba(40, 50, 45, 0.018)",
  medium: "rgba(40, 50, 45, 0.032)",
  major: "rgba(40, 50, 45, 0.055)",
};

export const GRID_STROKE = { minor: 1, medium: 1, major: 1.2 };

function onStep(coord, step) {
  const r = ((coord % step) + step) % step;
  return r < 0.5 || step - r < 0.5;
}

/**
 * Уровни сетки по zoom:
 * zoom < 0.35  → major 1000
 * zoom < 0.9   → major 1000 + normal 100
 * zoom >= 0.9  → major 1000 + normal 100 + minor 50
 */
export function resolveGrid({
  showGrid = true,
  showMinorGrid = true,
  showMediumGrid = true,
  showMajorGrid = true,
  showFineGrid = true,
  zoom = 1,
}) {
  if (!showGrid) return { visible: false };

  const far = zoom < 0.35;
  const mediumZoom = zoom >= 0.35 && zoom < 0.9;
  const close = zoom >= 0.9;

  const major = showMajorGrid !== false ? GRID_MAJOR_STEP : null;
  const medium = (mediumZoom || close) && showMediumGrid !== false ? GRID_MEDIUM_STEP : null;
  const minor = close && showMinorGrid !== false ? GRID_MINOR_STEP : null;
  const fine = close && showFineGrid !== false ? GRID_FINE_STEP : null;

  if (!fine && !minor && !medium && !major) return { visible: false };

  const iterStep = (far ? major : null) || fine || minor || medium || major;
  return { visible: true, fine, minor, medium, major, iterStep };
}

export function gridLineLevel(coord, cfg) {
  if (cfg.major && onStep(coord, GRID_MAJOR_STEP)) return "major";
  if (cfg.medium && onStep(coord, GRID_MEDIUM_STEP)) return "medium";
  if (cfg.minor && onStep(coord, GRID_MINOR_STEP)) return "minor";
  if (cfg.fine && onStep(coord, GRID_FINE_STEP)) return "fine";
  return null;
}

export function buildScreenGridLines(view, width, height, display) {
  const cfg = resolveGrid({
    showGrid: display?.showGrid !== false,
    showMinorGrid: display?.showMinorGrid !== false,
    showFineGrid: display?.showFineGrid !== false,
    showMajorGrid: display?.showMajorGrid !== false,
    zoom: view?.zoom || 1,
  });
  if (!cfg.visible || width < 2 || height < 2) return [];

  const z = view?.zoom || 1;
  const panX = view?.panX || 0;
  const panY = view?.panY || 0;
  const step = cfg.iterStep;
  const toSx = (wx) => panX + wx * z;
  const toSy = (wy) => panY + wy * z;
  const worldLeft = -panX / z;
  const worldTop = -panY / z;
  const startWx = Math.floor(worldLeft / step) * step;
  const startWy = Math.floor(worldTop / step) * step;
  const pad = step * z * 2;
  const lines = [];

  for (let wx = startWx; toSx(wx) < width + pad; wx += step) {
    const sx = toSx(wx);
    if (sx < -pad) continue;
    const level = gridLineLevel(wx, cfg);
    if (!level) continue;
    lines.push({ key: `v${wx}`, x1: sx, y1: 0, x2: sx, y2: height, level });
  }
  for (let wy = startWy; toSy(wy) < height + pad; wy += step) {
    const sy = toSy(wy);
    if (sy < -pad) continue;
    const level = gridLineLevel(wy, cfg);
    if (!level) continue;
    lines.push({ key: `h${wy}`, x1: 0, y1: sy, x2: width, y2: sy, level });
  }
  return lines;
}

export function buildScreenAxes(view, width, height) {
  const panX = view?.panX || 0;
  const panY = view?.panY || 0;
  const out = [];
  if (panY >= -1 && panY <= height + 1) {
    out.push({ key: "axis-x", x1: 0, y1: panY, x2: width, y2: panY });
  }
  if (panX >= -1 && panX <= width + 1) {
    out.push({ key: "axis-y", x1: panX, y1: 0, x2: panX, y2: height });
  }
  return out;
}

export function gridViewportBounds(view, svgW, svgH, pad = 800) {
  const z = view?.zoom || 1;
  const px = view?.panX || 0;
  const py = view?.panY || 0;
  return {
    x0: -px / z - pad,
    y0: -py / z - pad,
    x1: ((svgW || 1200) - px) / z + pad,
    y1: ((svgH || 800) - py) / z + pad,
  };
}

export function isMajorGridLine(coord, majorStep) {
  return onStep(coord, majorStep || GRID_MAJOR_STEP);
}

export function snapDistanceMm(zoom, snapDistancePx = 10) {
  return snapDistancePx / Math.max(zoom, 0.05);
}

/** @deprecated aliases */
export const GRID_XL_STEP = GRID_MAJOR_STEP;
export const SNAP_STEPS = [10, 50, 100, 250, 500, 1000];
