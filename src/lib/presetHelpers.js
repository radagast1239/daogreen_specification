import { uid } from "../store/helpers.js";
import { emptyFarmSectionsState as buildFarmSectionsState } from "./farmSectionsConfig.js";
import { normalizeStellageParams } from "./stellagePresetParams.js";
import { resolveStellagePhoto } from "./stellageCatalogConfig.js";

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
    params: normalizeStellageParams({ ...(draft.params || {}), photoUrl: draft.photoUrl || draft.params?.photoUrl }),
    items: (draft.items || [])
      .filter((ln) => ln.included && ln.name?.trim())
      .map(({ id, qty, ...rest }) => rest),
    note: draft.tech || "",
  };
}

export function draftFromStellagePreset(preset, instanceName, index, stellageModuleMeta = {}) {
  const params = normalizeStellageParams(preset.params);
  return {
    id: uid("st"),
    presetId: preset.id,
    name: instanceName || preset.name || `Стеллаж ${index}`,
    count: params.defaultCount,
    params,
    photoUrl: resolveStellagePhoto(stellageModuleMeta, preset.moduleId, params.photoUrl),
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
