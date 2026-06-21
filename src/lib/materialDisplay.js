import { isProfilePipeName, profilePipeSubtitle } from "../../shared/profilePipeCuts.js";
import {
  isBreakerName,
  breakerSpecsSubtitle,
  resolveBreakerSpecs,
  formatBreakerSpecsLabel,
} from "../../shared/breakerSpecs.js";

export { profilePipeSubtitle, isProfilePipeName, resolvePipeCuts, formatPipeCutsLabel } from "../../shared/profilePipeCuts.js";
export {
  breakerSpecsSubtitle,
  isBreakerName,
  resolveBreakerSpecs,
  formatBreakerSpecsLabel,
} from "../../shared/breakerSpecs.js";

/** Подпись под позицией: отрезки трубы или автоматы */
export function materialSpecSubtitle(matOrLine) {
  const pipe = profilePipeSubtitle(matOrLine);
  if (pipe) return pipe;
  return breakerSpecsSubtitle(matOrLine);
}

export function hasStructuredSpecEditor(name) {
  return isProfilePipeName(name) || isBreakerName(name);
}
