/** Настройки координатной сетки и магнитной привязки планировщика. */

/** Фиксированные шаги визуальной сетки (мм). */
export const GRID_FINE_STEP = 50;
export const GRID_MINOR_STEP = 100;
export const GRID_MEDIUM_STEP = 250;
export const GRID_MAJOR_STEP = 500;
export const GRID_XL_STEP = 1000;

/** @deprecated — используйте GRID_MINOR_STEP */
export const GRID_MINOR_STEP_LEGACY = GRID_MINOR_STEP;

export const SNAP_STEPS = [10, 50, 100, 250, 500, 1000];
export const SNAP_ROUND_OPTIONS = [1, 5, 10, 50];
export const ARROW_STEP_OPTIONS = [1, 5, 10, 50, 100];

export const COORD_UNITS = [
  { id: "mm", label: "мм", factor: 1 },
  { id: "cm", label: "см", factor: 10 },
  { id: "m", label: "м", factor: 1000 },
];

export const GRID_COLORS = {
  fine: "rgba(40, 50, 45, 0.035)",
  minor: "rgba(40, 50, 45, 0.035)",
  medium: "rgba(40, 50, 45, 0.06)",
  major: "rgba(40, 50, 45, 0.06)",
  xl: "rgba(40, 50, 45, 0.11)",
};

export const GRID_STROKE = {
  fine: 0.75,
  minor: 1,
  medium: 1,
  major: 1.1,
  xl: 1.2,
};

/** @deprecated — оставлено для совместимости UI */
export const GRID_MODES = [
  { id: "on", label: "Вкл" },
  { id: "off", label: "Выкл" },
];

/** @deprecated */
export const GRID_STEPS = SNAP_STEPS;

function onStep(coord, step) {
  const r = ((coord % step) + step) % step;
  return r < 0.5 || step - r < 0.5;
}

/** Видимость уровней сетки с учётом zoom и настроек. */
export function resolveGrid({
  showGrid = true,
  showFineGrid = true,
  showMinorGrid = true,
  showMediumGrid = true,
  showMajorGrid = true,
  zoom = 1,
}) {
  if (!showGrid) return { visible: false };

  /* zoom < 0.25: major 1000; 0.25–0.8: medium+major; > 0.8: minor+medium+major */
  const minor = zoom > 0.8 && showFineGrid !== false ? GRID_MINOR_STEP : null;
  const medium = zoom >= 0.25 && showMediumGrid !== false ? GRID_MAJOR_STEP : null;
  const major = showMajorGrid !== false ? GRID_XL_STEP : null;
  const fine = null;
  const xl = major;

  if (!minor && !medium && !major) return { visible: false };

  const iterStep = minor || medium || major;
  return { visible: true, fine, minor, medium, major, xl, iterStep };
}

export function gridLineLevel(coord, cfg) {
  if (cfg.major && onStep(coord, GRID_XL_STEP)) return "xl";
  if (cfg.medium && onStep(coord, GRID_MAJOR_STEP)) return "medium";
  if (cfg.minor && onStep(coord, GRID_MINOR_STEP)) return "minor";
  return null;
}

/** Линии сетки в экранных пикселях — на весь холст, без смещения при pan/zoom. */
export function buildScreenGridLines(view, width, height, display) {
  const cfg = resolveGrid({
    showGrid: display?.showGrid !== false,
    showFineGrid: display?.showFineGrid !== false,
    showMinorGrid: display?.showMinorGrid !== false,
    showMediumGrid: display?.showMediumGrid !== false,
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

/** Оси X/Y в экранных координатах. */
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

/** @deprecated — используйте buildScreenGridLines */
export function gridViewportBounds(view, svgW, svgH, pad = 800) {
  const z = view?.zoom || 1;
  const px = view?.panX || 0;
  const py = view?.panY || 0;
  const w = svgW || 1200;
  const h = svgH || 800;
  return {
    x0: -px / z - pad,
    y0: -py / z - pad,
    x1: (w - px) / z + pad,
    y1: (h - py) / z + pad,
  };
}

export function roundMm(v, roundTo = 1) {
  const r = roundTo > 0 ? roundTo : 1;
  return Math.round(v / r) * r;
}

export function fmtCoordMm(mm) {
  return `${Math.round(mm).toLocaleString("ru-RU")} мм`;
}

export function fmtCoord(mm, unit = "mm") {
  const u = COORD_UNITS.find((c) => c.id === unit) || COORD_UNITS[0];
  const v = mm / u.factor;
  if (unit === "m") return `${v.toFixed(2)} м`;
  if (unit === "cm") return `${Math.round(v).toLocaleString("ru-RU")} см`;
  return `${Math.round(mm).toLocaleString("ru-RU")} мм`;
}

export function coordUnitLabel(unit = "mm") {
  return COORD_UNITS.find((c) => c.id === unit)?.label || "мм";
}

/** @deprecated */
export function isMajorGridLine(coord, majorStep) {
  return onStep(coord, majorStep || GRID_MAJOR_STEP);
}

export function normalizeDisplay(saved) {
  const d = {
    showDims: true,
    showObjectDims: true,
    showClearanceDims: true,
    dimPassageWarnMm: 700,
    dimPassageErrorMm: 600,
    showLabels: true,
    showHints: true,
    showGrid: true,
    showFineGrid: true,
    showMinorGrid: true,
    showMediumGrid: true,
    showMajorGrid: true,
    showZoneNames: true,
    showZoneAreas: true,
    showZoneFill: true,
    roomWhiteFill: true,
    zoneContoursOnly: false,
    snapOn: true,
    snapWalls: true,
    snapObjects: true,
    snapGrid: true,
    dimInactive: true,
    hideInactive: false,
    highlightActive: true,
    highlightRacks: false,
    highlightSockets: false,
    highlightFurniture: false,
    highlightErrors: true,
    showZoneFlow: true,
    showLinks: true,
    onlyInsideRooms: false,
    snapStep: 50,
    snapRoundMm: 1,
    snapAngles: true,
    angleTolerance: 5,
    snapDistancePx: 10,
    snapGuides: true,
    arrowStepMm: 10,
    arrowStepShiftMm: 100,
    arrowStepAltMm: 1,
    coordUnit: "mm",
    showAxes: false,
    pdfGridInstall: false,
    pdfGridTechnical: false,
    pdfGridMajorOnly: true,
    showDoorArcs: true,
    doorOpeningsOnly: false,
    showServiceZones: false,
    showPorts: false,
    showLineArrows: true,
    showStateIcons: true,
    labelMode: "short",
    labelHideInactive: true,
    ...(saved || {}),
  };

  if (saved?.showGrid === false) d.showGrid = false;
  if (saved?.gridMode === "off") d.showGrid = false;

  const step = d.snapStep ?? d.gridStep ?? 50;
  d.snapStep = SNAP_STEPS.includes(step) ? step : 50;
  d.gridStep = d.snapStep;

  if (!SNAP_ROUND_OPTIONS.includes(d.snapRoundMm)) d.snapRoundMm = 1;
  if (!COORD_UNITS.some((u) => u.id === d.coordUnit)) d.coordUnit = "mm";

  return d;
}
