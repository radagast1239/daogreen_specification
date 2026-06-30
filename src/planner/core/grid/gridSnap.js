import { snapPoint, roundMm } from "../geometry/math.js";
import { GRID_DEFAULT_SNAP_STEP } from "./gridSettings.js";

export function snapToGrid(point, step = GRID_DEFAULT_SNAP_STEP, enabled = true) {
  if (!enabled) return { ...point };
  return snapPoint(point, step, true);
}

/** Alt: только округление до 1 мм без магнита. */
export function snapAltRound(point, roundTo = 1) {
  return {
    x: roundMm(point.x, roundTo),
    y: roundMm(point.y, roundTo),
  };
}

export function gridSnapCandidate(point, step, enabled) {
  if (!enabled) return null;
  const snapped = snapToGrid(point, step, true);
  const d = Math.hypot(snapped.x - point.x, snapped.y - point.y);
  return { point: snapped, distance: d, step };
}
