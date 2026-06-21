import {
  isProfilePipeName,
  normalizePipeCuts,
  pipeCutsClientNote,
  resolvePipeCuts,
} from "./profilePipeCuts.js";
import {
  isRatedAmpsName,
  normalizeBreakerSpecs,
  breakerSpecsClientNote,
  resolveBreakerSpecs,
} from "./breakerSpecs.js";
import {
  isFlowSpecName,
  normalizeFlowSpecs,
  flowSpecsClientNote,
  resolveFlowSpecs,
} from "./flowSpecs.js";
import {
  isSplitSystemName,
  normalizeSplitSpecs,
  splitSpecsClientNote,
  resolveSplitSpecs,
} from "./splitSpecs.js";

/** Пояснение клиенту из структурированных полей или текст */
export function structuredClientNote(obj) {
  const name = obj?.name || "";
  const cuts = normalizePipeCuts(obj?.pipeCuts ?? resolvePipeCuts(obj));
  if (isProfilePipeName(name) && cuts.length) return pipeCutsClientNote(cuts);
  const amps = normalizeBreakerSpecs(obj?.breakerSpecs ?? resolveBreakerSpecs(obj));
  if (isRatedAmpsName(name) && amps.length) return breakerSpecsClientNote(amps, name);
  const flow = normalizeFlowSpecs(obj?.flowSpecs ?? resolveFlowSpecs(obj));
  if (isFlowSpecName(name) && flow.length) return flowSpecsClientNote(flow, name);
  const split = normalizeSplitSpecs(obj?.splitSpecs ?? resolveSplitSpecs(obj));
  if (isSplitSystemName(name) && split.length) return splitSpecsClientNote(split);
  return obj?.clientNote || obj?.comment || "";
}
