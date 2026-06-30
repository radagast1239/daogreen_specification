import { generateWallDimensions } from "./generateWallDimensions.js";
import { normalizeDimensions, resolveAttachedDimension } from "./model.js";

export function resolvePlanDimensions(plan, opts = {}) {
  const normalizedManual = normalizeDimensions(plan?.dimensions || [])
    .filter((d) => d.auto !== true)
    .map((d) => resolveAttachedDimension(d, plan));

  const auto = generateWallDimensions(plan, opts);
  return {
    manual: normalizedManual,
    auto: auto.dimensions || [],
    dimensions: [...normalizedManual, ...(auto.dimensions || [])],
    validationWarnings: auto.validationWarnings || [],
  };
}
