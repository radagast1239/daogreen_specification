/** Блок 14 — состояния и настройки размерных линий. */

export const DIM_COLORS = {
  active: "#116355",
  normal: "#8f9a94",
  warning: "#d08a22",
  error: "#a5371f",
};

export const DEFAULT_PASSAGE_WARN_MM = 700;
export const DEFAULT_PASSAGE_ERROR_MM = 600;

export function resolveDimState({ state, active, distanceMm, warnMm, errorMm } = {}) {
  if (state && DIM_COLORS[state]) return state;
  if (distanceMm != null) {
    const err = errorMm ?? DEFAULT_PASSAGE_ERROR_MM;
    const warn = warnMm ?? DEFAULT_PASSAGE_WARN_MM;
    if (distanceMm < err) return "error";
    if (distanceMm < warn) return "warning";
  }
  if (active) return "active";
  return "normal";
}

export function dimStroke(opts = {}) {
  return DIM_COLORS[resolveDimState(opts)] || DIM_COLORS.normal;
}
