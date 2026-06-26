import { uid } from "./ids.js";
import { cloneBuilderLines } from "./builderLines.js";
import { stripCatalogLines } from "../../shared/catalogLine.js";
import { emptyFarmSectionsState as buildFarmSectionsState } from "./farmSectionsConfig.js";
import { normalizeStellageParams } from "./stellagePresetParams.js";
import { resolveStellagePhoto } from "./stellageCatalogConfig.js";

export { cloneBuilderLines };

export function duplicateStellageInstance(st) {
  return {
    ...st,
    id: uid("st"),
    name: `${st.name} (копия)`,
    params: st.params ? { ...st.params } : {},
    items: cloneBuilderLines(st.items, { freshIds: true }),
  };
}

export function presetPayloadFromDraft(draft, name) {
  return {
    name: name.trim(),
    presetType: "stellage",
    moduleId: draft.moduleId,
    moduleName: draft.moduleName,
    sectionId: "",
    params: normalizeStellageParams({ ...(draft.params || {}), photoUrl: draft.photoUrl || draft.params?.photoUrl }),
    items: stripCatalogLines(
      (draft.items || []).filter((ln) => ln.included !== false && (ln.materialId || ln.name?.trim()))
    ),
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
