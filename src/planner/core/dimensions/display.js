export const DIMENSION_DISPLAY_MODES = ["mm", "cm", "m", "remplanner_cm"];
export const DEFAULT_DIMENSION_DISPLAY_MODE = "remplanner_cm";

export function normalizeDimensionDisplayMode(mode) {
  return DIMENSION_DISPLAY_MODES.includes(mode) ? mode : DEFAULT_DIMENSION_DISPLAY_MODE;
}

function formatMeters(mm) {
  const sign = mm < 0 ? "-" : "";
  return `${sign}${(Math.abs(mm) / 1000).toFixed(2)} м`;
}

export function formatDimensionValue(mm, mode = DEFAULT_DIMENSION_DISPLAY_MODE, opts = {}) {
  const normalized = normalizeDimensionDisplayMode(mode);
  const rounded = Math.round(mm);
  if (normalized === "mm") return `${rounded.toLocaleString("ru-RU")} мм`;
  if (normalized === "cm") return `${Math.round(mm / 10).toLocaleString("ru-RU")} см`;
  if (normalized === "m") return formatMeters(mm);

  // RemPlanner-like display:
  // - room chains can stay unit-less centimeters: "250", "368", ...
  // - generic dimensions: up to 999 mm in mm, otherwise in meters.
  if (opts.roomChain) return `${Math.round(mm / 10)}`;
  if (Math.abs(mm) <= 999) return `${rounded.toLocaleString("ru-RU")} мм`;
  return formatMeters(mm);
}
