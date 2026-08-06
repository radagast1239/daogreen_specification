/**
 * Phase 2 — fullscreen Planner workspace shell helpers (layout only).
 * Inspector open/close is UI state — never persisted into plan JSON.
 */

export const PLANNER_TOOL_RAIL_WIDTH = 80;
export const PLANNER_TOOL_RAIL_WIDTH_COMPACT = 72;

/** CAD workspace routes (not hub / frame constructor). */
export function isPlannerWorkspacePath(pathname = "") {
  const path = String(pathname || "");
  return /\/project\/[^/]+\/plan\/?$/.test(path) || /\/planner\/draft\/[^/]+\/?$/.test(path);
}

/**
 * @returns {'desktop'|'mid'|'narrow'}
 * desktop ≥1440, mid 1280–1439, narrow ≤1279
 */
export function getPlannerInspectorBreakpoint(viewportWidth) {
  const w = Number(viewportWidth) || 0;
  if (w >= 1440) return "desktop";
  if (w >= 1280) return "mid";
  return "narrow";
}

export function getPlannerInspectorWidthPx(breakpoint) {
  if (breakpoint === "desktop") return 328;
  if (breakpoint === "mid") return 288;
  return 320;
}

/** Docked inspector consumes canvas width; overlay does not. */
export function getPlannerInspectorMode(breakpoint) {
  return breakpoint === "narrow" ? "overlay" : "dock";
}

export function getDefaultInspectorOpen(breakpoint) {
  return breakpoint !== "narrow";
}

/**
 * Estimate available canvas width from layout chrome (not zoom).
 * Fullscreen planner → appNavWidth = 0 when app sidebar is overlay-hidden.
 */
export function estimatePlannerCanvasWidth({
  viewportWidth,
  appNavWidth = 0,
  railWidth = PLANNER_TOOL_RAIL_WIDTH,
  inspectorOpen = true,
  inspectorMode = "dock",
  inspectorWidth,
  breakpoint,
} = {}) {
  const bp = breakpoint || getPlannerInspectorBreakpoint(viewportWidth);
  const mode = inspectorMode || getPlannerInspectorMode(bp);
  const inspW = inspectorWidth ?? getPlannerInspectorWidthPx(bp);
  const docked = inspectorOpen && mode === "dock" ? inspW : 0;
  return Math.max(0, Math.floor(Number(viewportWidth) || 0) - Math.max(0, appNavWidth) - Math.max(0, railWidth) - docked);
}

/** Canvas width targets from the phase-2 brief. */
export function meetsPlannerCanvasWidthTarget({
  viewportWidth,
  inspectorOpen,
  appNavWidth = 0,
  railWidth = PLANNER_TOOL_RAIL_WIDTH,
} = {}) {
  const bp = getPlannerInspectorBreakpoint(viewportWidth);
  const width = estimatePlannerCanvasWidth({
    viewportWidth,
    appNavWidth,
    railWidth: viewportWidth <= 1280 ? PLANNER_TOOL_RAIL_WIDTH_COMPACT : railWidth,
    inspectorOpen,
    breakpoint: bp,
  });
  if (viewportWidth >= 1920 && inspectorOpen) return { ok: width >= 1250, width, target: 1250 };
  if (viewportWidth >= 1440 && inspectorOpen) return { ok: width >= 850, width, target: 850 };
  if (viewportWidth >= 1280 && !inspectorOpen) return { ok: width >= 850, width, target: 850 };
  return { ok: true, width, target: null };
}
