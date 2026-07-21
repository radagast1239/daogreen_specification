/**
 * Server-side reconciliation for project-builder saves.
 *
 * Incoming builder payloads may carry a stale SpecEditor snapshot. Admin-owned
 * item fields and project-level media/publication state must come from the live
 * DB row; the builder may only apply builder-owned geometry/qty intent.
 */

import { buildProjectItemsAfterBuilderSave } from "./buildProjectItemsAfterBuilderSave.js";
import { isDraftProject } from "./projectLifecycle.js";

/** Nested manualParams keys owned by SpecEditor / publication — never overwritten by builder. */
export const ADMIN_MANUAL_PARAM_KEYS = [
  "publishedRelease",
  "projectSchemes",
  "schemeNames",
  "floorPlanUrl",
  "floorPlanTitle",
  "schemePipesUrl",
  "schemeStellagesUrl",
  "schemeTechnicalUrl",
  "schemeElectricalUrl",
  "consumablesCartUrl",
  "farmPower",
  "coolingFarm",
];

export function isBuilderProjectSave(patch = {}) {
  if (!patch || typeof patch !== "object") return false;
  if (patch.builderSave === true || patch.saveSource === "builder") return true;
  const mode = String(patch.builderSaveMode || "").trim().toLowerCase();
  return mode === "title" || mode === "title-only" || mode === "full";
}

export function isBuilderTitleOnlySave(patch = {}) {
  const mode = String(patch.builderSaveMode || "").trim().toLowerCase();
  return mode === "title" || mode === "title-only";
}

/**
 * Preserve SpecEditor / publication nested keys from the live DB manualParams.
 * Builder may update builderWizard and geometry scalars.
 */
export function mergeManualParamsForBuilderSave(dbParams = {}, patchParams = {}) {
  const base = dbParams && typeof dbParams === "object" ? dbParams : {};
  const patch = patchParams && typeof patchParams === "object" ? patchParams : {};
  const merged = { ...base, ...patch };
  for (const key of ADMIN_MANUAL_PARAM_KEYS) {
    if (Object.prototype.hasOwnProperty.call(base, key)) {
      merged[key] = base[key];
    } else {
      delete merged[key];
    }
  }
  return merged;
}

/**
 * Builder must not silently demote SpecEditor project status, except draft→active finalize.
 */
export function resolveBuilderSaveStatus(dbProject, patchStatus) {
  const current = dbProject?.status;
  if (isDraftProject(dbProject) && patchStatus && patchStatus !== current) {
    return patchStatus;
  }
  if (current != null && current !== "") return current;
  return patchStatus != null ? patchStatus : current;
}

function activeStellageIdsFromConfigs(stellageConfigs) {
  const ids = new Set();
  for (const st of Array.isArray(stellageConfigs) ? stellageConfigs : []) {
    if (st?.id) ids.add(String(st.id));
  }
  return ids;
}

function farmSectionNamesFromItems(items = []) {
  const names = new Set();
  for (const it of items) {
    const section = String(it?.section || it?.module || "").trim();
    if (section) names.add(section);
  }
  return names;
}

/**
 * Reconcile builder-generated items against live DB items.
 * @returns {{ items: object[], blocked: boolean, invariantErrors: string[], meta: object }}
 */
export function reconcileBuilderItemsAgainstDb({
  dbItems = [],
  incomingItems = [],
  stellageConfigs = [],
  materials = [],
}) {
  const farmSectionNames = farmSectionNamesFromItems(incomingItems);
  const activeStellageIds = activeStellageIdsFromConfigs(stellageConfigs);
  const result = buildProjectItemsAfterBuilderSave({
    existingItems: dbItems,
    generatedBuilderItems: incomingItems,
    builderContext: { farmSectionNames, activeStellageIds },
    materials,
  });
  return {
    items: result.items,
    blocked: !!result.blocked,
    invariantErrors: result.invariantErrors || [],
    meta: {
      updatedBuilderIds: result.updatedBuilderIds || [],
      addedBuilderIds: result.addedBuilderIds || [],
      removedBuilderIds: result.removedBuilderIds || [],
      preservedSpecIds: result.preservedSpecIds || [],
      preservedManualIds: result.preservedManualIds || [],
    },
  };
}

/**
 * Apply builder patch on top of live DB project without wiping admin state.
 * Returns a safe patch for updateProject (items / manualParams / status adjusted).
 */
export function reconcileBuilderProjectPatch(dbProject, patch = {}, { materials = [] } = {}) {
  if (!dbProject) {
    const err = new Error("Project not found for builder reconcile");
    err.code = "NOT_FOUND";
    throw err;
  }

  if (isBuilderTitleOnlySave(patch)) {
    const name = patch.name != null ? String(patch.name) : dbProject.name;
    return {
      name,
      builderSave: true,
      builderSaveMode: "title",
      // Explicitly omit items / manualParams / status so updateProject skips them.
    };
  }

  const { expectedRevision, builderSave, saveSource, builderSaveMode, ...rest } = patch;
  const safe = { ...rest, builderSave: true };

  if (Object.prototype.hasOwnProperty.call(patch, "status") || patch.status != null) {
    safe.status = resolveBuilderSaveStatus(dbProject, patch.status);
  } else {
    safe.status = dbProject.status;
  }

  if (patch.manualParams && typeof patch.manualParams === "object") {
    safe.manualParams = mergeManualParamsForBuilderSave(dbProject.manualParams || {}, patch.manualParams);
  }

  if (Array.isArray(patch.items)) {
    const reconciled = reconcileBuilderItemsAgainstDb({
      dbItems: dbProject.items || [],
      incomingItems: patch.items,
      stellageConfigs: patch.stellageConfigs != null ? patch.stellageConfigs : dbProject.stellageConfigs,
      materials,
    });
    if (reconciled.blocked) {
      const err = new Error(reconciled.invariantErrors.join("; ") || "Builder reconcile blocked");
      err.code = "BUILDER_RECONCILE_BLOCKED";
      err.details = reconciled.invariantErrors;
      throw err;
    }
    safe.items = reconciled.items;
    safe._builderReconcileMeta = reconciled.meta;
  }

  return safe;
}
