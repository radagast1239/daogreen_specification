/** Настройки координатной сетки и магнитной привязки планировщика. */

import { DEFAULT_VISUAL, normalizeVisualPrefs } from "./plannerVisualSettings.js";
import {
  GRID_MINOR_STEP,
  GRID_MEDIUM_STEP,
  GRID_MAJOR_STEP,
  GRID_FINE_STEP,
  GRID_XL_STEP,
  SNAP_STEPS,
  GRID_COLORS,
  GRID_STROKE,
  resolveGrid,
  gridLineLevel,
  buildScreenGridLines,
  buildScreenAxes,
  gridViewportBounds,
  isMajorGridLine,
} from "./core/grid/gridSettings.js";
import {
  GRID_STEP_FAMILY,
  chooseMinorGridStepMm,
  chooseMajorGridStepMm,
  resolveAdaptiveGrid,
  adaptiveGridCssBackground,
  cursorCenteredZoomView,
  resolveViewportLod,
} from "./core/grid/adaptiveGrid.js";
import {
  DIMENSION_DISPLAY_MODES,
  DEFAULT_DIMENSION_DISPLAY_MODE,
} from "./core/dimensions/display.js";
import { roundMm } from "./core/geometry/index.js";

export {
  GRID_MINOR_STEP,
  GRID_MEDIUM_STEP,
  GRID_MAJOR_STEP,
  GRID_FINE_STEP,
  GRID_XL_STEP,
  SNAP_STEPS,
  GRID_COLORS,
  GRID_STROKE,
  resolveGrid,
  gridLineLevel,
  buildScreenGridLines,
  buildScreenAxes,
  gridViewportBounds,
  isMajorGridLine,
  GRID_STEP_FAMILY,
  chooseMinorGridStepMm,
  chooseMajorGridStepMm,
  resolveAdaptiveGrid,
  adaptiveGridCssBackground,
  cursorCenteredZoomView,
  resolveViewportLod,
};

export const SNAP_ROUND_OPTIONS = [1, 5, 10, 50];
export const ARROW_STEP_OPTIONS = [1, 5, 10, 50, 100];

export const CANVAS_BG = "#f7f8f6";

export const COORD_UNITS = [
  { id: "mm", label: "мм", factor: 1 },
  { id: "cm", label: "см", factor: 10 },
  { id: "m", label: "м", factor: 1000 },
];

/** @deprecated — оставлено для совместимости UI */
export const GRID_MODES = [
  { id: "on", label: "Вкл" },
  { id: "off", label: "Выкл" },
];

/** @deprecated */
export const GRID_STEPS = SNAP_STEPS;

export { roundMm };

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
    dimensionDisplayMode: DEFAULT_DIMENSION_DISPLAY_MODE,
    // PHASE 2F1 — hide automatic room centre labels by default.
    showZoneNames: false,
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
    arrowStepCtrlMm: 1,
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
    ...DEFAULT_VISUAL,
    ...(saved || {}),
  };

  if (saved?.showGrid === false) d.showGrid = false;
  if (saved?.gridMode === "off") d.showGrid = false;

  const step = d.snapStep ?? d.gridStep ?? 50;
  d.snapStep = SNAP_STEPS.includes(step) ? step : 50;

  if (!SNAP_ROUND_OPTIONS.includes(d.snapRoundMm)) d.snapRoundMm = 1;
  if (!COORD_UNITS.some((u) => u.id === d.coordUnit)) d.coordUnit = "mm";
  if (!DIMENSION_DISPLAY_MODES.includes(d.dimensionDisplayMode)) {
    d.dimensionDisplayMode = DEFAULT_DIMENSION_DISPLAY_MODE;
  }

  Object.assign(d, normalizeVisualPrefs(d));

  return d;
}
