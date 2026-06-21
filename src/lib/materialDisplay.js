import { isProfilePipeName, profilePipeSubtitle } from "../../shared/profilePipeCuts.js";
import {
  isRatedAmpsName,
  breakerSpecsSubtitle,
  resolveBreakerSpecs,
  formatBreakerSpecsLabel,
  isBreakerName,
  isContactorName,
} from "../../shared/breakerSpecs.js";
import {
  isFlowSpecName,
  flowSpecsSubtitle,
  resolveFlowSpecs,
  formatFlowSpecsLabel,
  isExhaustFanName,
  isPumpName,
} from "../../shared/flowSpecs.js";
import {
  isSplitSystemName,
  splitSpecsSubtitle,
  resolveSplitSpecs,
  formatSplitSpecsLabel,
} from "../../shared/splitSpecs.js";

export { profilePipeSubtitle, isProfilePipeName, resolvePipeCuts, formatPipeCutsLabel } from "../../shared/profilePipeCuts.js";
export {
  breakerSpecsSubtitle,
  isBreakerName,
  isContactorName,
  isRatedAmpsName,
  resolveBreakerSpecs,
  formatBreakerSpecsLabel,
} from "../../shared/breakerSpecs.js";
export {
  flowSpecsSubtitle,
  isFlowSpecName,
  isExhaustFanName,
  isPumpName,
  resolveFlowSpecs,
  formatFlowSpecsLabel,
} from "../../shared/flowSpecs.js";
export {
  splitSpecsSubtitle,
  isSplitSystemName,
  resolveSplitSpecs,
  formatSplitSpecsLabel,
} from "../../shared/splitSpecs.js";

/** Подпись под позицией */
export function materialSpecSubtitle(matOrLine) {
  const name = matOrLine?.name || "";
  const pipe = profilePipeSubtitle(matOrLine);
  if (pipe) return pipe;
  const amps = breakerSpecsSubtitle(matOrLine);
  if (amps) return amps;
  const flow = flowSpecsSubtitle(matOrLine);
  if (flow) return flow;
  return splitSpecsSubtitle(matOrLine);
}

export function hasStructuredSpecEditor(name) {
  return (
    isProfilePipeName(name) ||
    isRatedAmpsName(name) ||
    isFlowSpecName(name) ||
    isSplitSystemName(name)
  );
}
