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

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function isExplicitEmptyNote(value) {
  return value === "" || (typeof value === "string" && value.trim() === "");
}

/** Пояснение клиенту из структурированных полей или текст */
export function structuredClientNote(obj) {
  if (hasOwn(obj, "clientNote") && isExplicitEmptyNote(obj.clientNote)) {
    return "";
  }

  const name = obj?.name || "";
  const cuts = normalizePipeCuts(obj?.pipeCuts ?? resolvePipeCuts(obj));
  if (isProfilePipeName(name) && cuts.length) return pipeCutsClientNote(cuts);
  const amps = normalizeBreakerSpecs(obj?.breakerSpecs ?? resolveBreakerSpecs(obj));
  if (isRatedAmpsName(name) && amps.length) return breakerSpecsClientNote(amps, name);
  const flow = normalizeFlowSpecs(obj?.flowSpecs ?? resolveFlowSpecs(obj));
  if (isFlowSpecName(name) && flow.length) return flowSpecsClientNote(flow, name);
  const split = normalizeSplitSpecs(obj?.splitSpecs ?? resolveSplitSpecs(obj));
  if (isSplitSystemName(name) && split.length) {
    // Для сплит-систем сохраняем присланную спецификацию (комната · холод кВт · BTU ·
    // потребление), если она задана; иначе — авто-заметка по типоразмерам.
    if (hasOwn(obj, "clientNote")) {
      const provided = String(obj.clientNote ?? "").trim();
      return provided || splitSpecsClientNote(split);
    }
    return splitSpecsClientNote(split);
  }
  if (hasOwn(obj, "clientNote")) {
    return obj.clientNote ?? "";
  }
  return obj?.comment || "";
}
