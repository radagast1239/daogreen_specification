import { uid } from "../store/helpers.js";
import { emptyFarmSectionsState as buildFarmSectionsState } from "./farmSectionsConfig.js";

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

export function emptyFarmSectionsState(sections, catalogs, materials) {
  return buildFarmSectionsState(sections, catalogs, materials);
}

export function applyFarmPreset(linesState, sectionId, preset) {
  return {
    ...linesState,
    [sectionId]: cloneBuilderLines(preset.items),
  };
}
