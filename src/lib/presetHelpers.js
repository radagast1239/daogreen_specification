import { uid } from "../store/helpers.js";
import { catalogLinesForModule } from "./projectBuilder.js";

export function cloneBuilderLines(items) {
  return (items || []).map((ln) => ({ ...ln, id: uid("ln") }));
}

export function presetPayloadFromDraft(draft, name) {
  return {
    name: name.trim(),
    presetType: "stellage",
    moduleId: draft.moduleId,
    moduleName: draft.moduleName,
    sectionId: "",
    items: (draft.items || []).map(({ id, ...rest }) => rest),
    note: draft.tech || "",
  };
}

export function presetPayloadFromFarmSection(sectionId, sectionName, moduleName, lines, name) {
  return {
    name: name.trim(),
    presetType: "farm_section",
    moduleId: "",
    moduleName: moduleName,
    sectionId,
    items: (lines || []).map(({ id, ...rest }) => rest),
  };
}

export function draftFromStellagePreset(preset, instanceName, index) {
  return {
    id: uid("st"),
    presetId: preset.id,
    name: instanceName || preset.name || `Стеллаж ${index}`,
    moduleId: preset.moduleId,
    moduleName: preset.moduleName,
    tech: preset.note || "",
    items: cloneBuilderLines(preset.items),
  };
}

export function emptyFarmSectionsState(materials, sections) {
  const map = {};
  for (const sec of sections) {
    map[sec.id] = catalogLinesForModule(materials, sec.module);
  }
  return map;
}

export function applyFarmPreset(linesState, sectionId, preset) {
  return {
    ...linesState,
    [sectionId]: cloneBuilderLines(preset.items),
  };
}
