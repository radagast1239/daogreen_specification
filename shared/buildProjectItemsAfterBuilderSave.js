/**
 * Safe merge of builder-generated items with existing project items.
 * Builder may update only proven builder-owned lines; never drops spec/manual/ambiguous rows.
 */

import {
  classifyProjectItemOwnership,
  builderProjectItemLogicalKey,
  PROJECT_ITEM_OWNERSHIP,
  PROJECT_OWNED_FIELD_KEYS,
} from "./projectItemOwnership.js";
import { copyCatalogSnapshotFromMaterial } from "./materialCatalogSnapshot.js";
import { isFrameBomLine } from "./frameBomProjectItems.js";

function buildContext(builderContext = {}, existingItems = []) {
  const farmSectionNames = builderContext.farmSectionNames;
  const activeStellageIds = builderContext.activeStellageIds;
  return {
    ...builderContext,
    existingItems,
    farmSectionNames:
      farmSectionNames instanceof Set
        ? farmSectionNames
        : new Set(Array.isArray(farmSectionNames) ? farmSectionNames : []),
    activeStellageIds:
      activeStellageIds instanceof Set
        ? activeStellageIds
        : new Set(Array.isArray(activeStellageIds) ? activeStellageIds : []),
  };
}

function mergeProjectOwnedFields(existing, generated) {
  const merged = { ...existing };
  for (const key of PROJECT_OWNED_FIELD_KEYS) {
    if (generated[key] !== undefined) merged[key] = generated[key];
  }
  if (generated.included !== undefined && generated.includedInProject === undefined) {
    merged.includedInProject = generated.included !== false;
  }
  return merged;
}

function mergeBuilderOwnedItem(existing, generated) {
  return mergeProjectOwnedFields(existing, generated);
}

function mergeFrameOwnedItem(existing, generated) {
  const merged = { ...existing };
  const qty = Number(generated.qty);
  if (Number.isFinite(qty) && qty >= 0) merged.qty = qty;
  if (generated.pipeCuts?.length) merged.pipeCuts = generated.pipeCuts;
  return merged;
}

function indexGenerated(generated = []) {
  const byId = new Map();
  const byKey = new Map();
  for (const it of generated) {
    if (it?.id) byId.set(it.id, it);
    const key = builderProjectItemLogicalKey(it);
    if (key && !byKey.has(key)) byKey.set(key, it);
  }
  return { byId, byKey, keys: new Set([...byKey.keys()]) };
}

function findGeneratedMatch(existing, { byId, byKey }) {
  if (byId.has(existing.id)) return byId.get(existing.id);
  const key = builderProjectItemLogicalKey(existing);
  return key ? byKey.get(key) : null;
}

/**
 * @param {object} params
 * @param {object[]} params.existingItems
 * @param {object[]} params.generatedBuilderItems
 * @param {object} [params.builderContext]
 * @param {object[]} [params.materials]
 */
export function buildProjectItemsAfterBuilderSave({
  existingItems = [],
  generatedBuilderItems = [],
  builderContext = {},
  materials = [],
}) {
  const existing = Array.isArray(existingItems) ? existingItems : [];
  const generated = Array.isArray(generatedBuilderItems) ? generatedBuilderItems : [];
  const ctx = buildContext(builderContext, existing);
  const { byId, byKey, keys: generatedKeys } = indexGenerated(generated);

  const updatedBuilderIds = [];
  const addedBuilderIds = [];
  const removedBuilderIds = [];
  const preservedSpecIds = [];
  const preservedManualIds = [];
  const ambiguousIds = [];
  const invariantErrors = [];

  const items = [];
  const resultIds = new Set();

  for (const ex of existing) {
    const ownership = classifyProjectItemOwnership(ex, ctx);

    if (ownership === PROJECT_ITEM_OWNERSHIP.SPEC_MANUAL) {
      items.push(ex);
      resultIds.add(ex.id);
      if (ex.source === "manual") preservedManualIds.push(ex.id);
      else preservedSpecIds.push(ex.id);
      continue;
    }

    if (ownership === PROJECT_ITEM_OWNERSHIP.AMBIGUOUS) {
      items.push(ex);
      resultIds.add(ex.id);
      ambiguousIds.push(ex.id);
      continue;
    }

    if (ownership === PROJECT_ITEM_OWNERSHIP.FRAME) {
      const gen = findGeneratedMatch(ex, { byId, byKey });
      const row = gen ? mergeFrameOwnedItem(ex, gen) : ex;
      items.push(row);
      resultIds.add(ex.id);
      if (gen) updatedBuilderIds.push(ex.id);
      continue;
    }

    const gen = findGeneratedMatch(ex, { byId, byKey });
    if (gen) {
      items.push(mergeBuilderOwnedItem(ex, gen));
      resultIds.add(ex.id);
      updatedBuilderIds.push(ex.id);
    } else {
      removedBuilderIds.push(ex.id);
    }
  }

  for (const gen of generated) {
    if (resultIds.has(gen.id)) continue;
    const key = builderProjectItemLogicalKey(gen);
    const dup = existing.some(
      (ex) => ex.id === gen.id || builderProjectItemLogicalKey(ex) === key,
    );
    if (dup) continue;
    const row = gen.materialId
      ? copyCatalogSnapshotFromMaterial(gen, materials)
      : gen;
    items.push(row);
    resultIds.add(gen.id);
    addedBuilderIds.push(gen.id);
  }

  for (const ex of existing) {
    const ownership = classifyProjectItemOwnership(ex, ctx);
    if (
      ownership === PROJECT_ITEM_OWNERSHIP.SPEC_MANUAL ||
      ownership === PROJECT_ITEM_OWNERSHIP.AMBIGUOUS ||
      ownership === PROJECT_ITEM_OWNERSHIP.FRAME
    ) {
      if (!resultIds.has(ex.id)) {
        invariantErrors.push(`Lost ${ownership} item: ${ex.id} (${ex.name || "?"})`);
      }
    }
  }

  for (const ex of existing) {
    if (isFrameBomLine(ex) && !resultIds.has(ex.id)) {
      invariantErrors.push(`Lost frame BOM item: ${ex.id}`);
    }
  }

  const existingMaterialContexts = new Set(
    existing.map((it) => builderProjectItemLogicalKey(it)).filter(Boolean),
  );
  const resultMaterialContexts = new Set(
    items.map((it) => builderProjectItemLogicalKey(it)).filter(Boolean),
  );
  for (const key of existingMaterialContexts) {
    if (!resultMaterialContexts.has(key) && !generatedKeys.has(key)) {
      const lost = existing.find((it) => builderProjectItemLogicalKey(it) === key);
      const ownership = lost ? classifyProjectItemOwnership(lost, ctx) : null;
      if (
        lost &&
        (ownership === PROJECT_ITEM_OWNERSHIP.AMBIGUOUS ||
          ownership === PROJECT_ITEM_OWNERSHIP.SPEC_MANUAL ||
          ownership === PROJECT_ITEM_OWNERSHIP.FRAME)
      ) {
        invariantErrors.push(`Context collapsed: ${key}`);
      }
    }
  }

  if (invariantErrors.length) {
    return {
      items: existing,
      updatedBuilderIds: [],
      addedBuilderIds: [],
      removedBuilderIds: [],
      preservedSpecIds,
      preservedManualIds,
      ambiguousIds,
      invariantErrors,
      blocked: true,
      debug: { reason: "invariant_violation" },
    };
  }

  return {
    items,
    updatedBuilderIds,
    addedBuilderIds,
    removedBuilderIds,
    preservedSpecIds,
    preservedManualIds,
    ambiguousIds,
    invariantErrors: [],
    blocked: false,
    debug: {
      existingCount: existing.length,
      generatedCount: generated.length,
      resultCount: items.length,
    },
  };
}
