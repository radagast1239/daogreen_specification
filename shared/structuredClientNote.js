import {
  isProfilePipeName,
  normalizePipeCuts,
  pipeCutsClientNote,
  resolvePipeCuts,
} from "./profilePipeCuts.js";
import {
  isBreakerName,
  normalizeBreakerSpecs,
  breakerSpecsClientNote,
  resolveBreakerSpecs,
} from "./breakerSpecs.js";

/** Пояснение клиенту из структурированных полей (труба / автоматы) или текст */
export function structuredClientNote(obj) {
  const name = obj?.name || "";
  const cuts = normalizePipeCuts(obj?.pipeCuts ?? resolvePipeCuts(obj));
  if (isProfilePipeName(name) && cuts.length) return pipeCutsClientNote(cuts);
  const specs = normalizeBreakerSpecs(obj?.breakerSpecs ?? resolveBreakerSpecs(obj));
  if (isBreakerName(name) && specs.length) return breakerSpecsClientNote(specs);
  return obj?.clientNote || obj?.comment || "";
}
