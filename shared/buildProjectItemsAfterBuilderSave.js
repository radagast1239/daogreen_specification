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

/** Fields the builder wizard is allowed to rewrite on re-save. */
const BUILDER_REWRITE_FIELD_KEYS = new Set([
  "qty",
  "includedInProject",
  "enabled",
  "visibleToClient",
  "visible",
  "approved",
  "pipeCuts",
  "breakerSpecs",
  "flowSpecs",
  "splitSpecs",
  "subcategory",
  "farmGroup",
  "roomId",
  "responsible",
  "sortOrder",
]);

/**
 * Catalog/geometry from generated; purchase / notes stay from existing project item.
 * Prevents wizard regenerate from wiping status/actualPrice/clientNote.
 */
function mergeProjectOwnedFields(existing, generated) {
  const merged = { ...existing };
  for (const [key, val] of Object.entries(generated || {})) {
    if (PROJECT_OWNED_FIELD_KEYS.includes(key) && !BUILDER_REWRITE_FIELD_KEYS.has(key)) {
      continue;
    }
    if (val !== undefined) merged[key] = val;
  }
  for (const key of BUILDER_REWRITE_FIELD_KEYS) {
    if (generated?.[key] !== undefined) merged[key] = generated[key];
  }
  if (generated?.included !== undefined && generated.includedInProject === undefined) {
    merged.includedInProject = generated.included !== false;
  }
  if (existing.purchaseStatus !== undefined && merged.purchaseStatus === undefined) {
    merged.purchaseStatus = existing.purchaseStatus;
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

function sameBuilderSectionMaterial(a, b) {
  if (!a?.materialId || !b?.materialId) return false;
  if (String(a.materialId) !== String(b.materialId)) return false;
  const secA = String(a.section || a.module || "").trim();
  const secB = String(b.section || b.module || "").trim();
  return Boolean(secA) && secA === secB;
}

/**
 * One-to-one match: never return a generated row already claimed in `usedGenerated`.
 * @param {Set<object>} usedGenerated — identity set of claimed generated items
 */
function findGeneratedMatch(existing, { byId, byKey }, generated = [], ctx = {}, usedGenerated = new Set()) {
  const claimable = (g) => g && !usedGenerated.has(g);

  if (existing?.id && byId.has(existing.id)) {
    const g = byId.get(existing.id);
    if (claimable(g)) return g;
  }
  const key = builderProjectItemLogicalKey(existing);
  if (key && byKey.has(key)) {
    const g = byKey.get(key);
    if (claimable(g)) return g;
  }
  // Builder farm/stellage re-save: line ids often change; match section+materialId once.
  if (classifyProjectItemOwnership(existing, ctx) === PROJECT_ITEM_OWNERSHIP.BUILDER) {
    return generated.find((g) => claimable(g) && sameBuilderSectionMaterial(existing, g)) || null;
  }
  return null;
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
  const matchedGeneratedIds = new Set();
  /** Claimed generated row objects — enforces one-to-one section+material fallback. */
  const usedGenerated = new Set();

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
      const gen = findGeneratedMatch(ex, { byId, byKey }, generated, ctx, usedGenerated);
      const row = gen ? mergeFrameOwnedItem(ex, gen) : ex;
      items.push(row);
      resultIds.add(ex.id);
      if (gen) {
        usedGenerated.add(gen);
        updatedBuilderIds.push(ex.id);
        if (gen.id) matchedGeneratedIds.add(gen.id);
      }
      continue;
    }

    const gen = findGeneratedMatch(ex, { byId, byKey }, generated, ctx, usedGenerated);
    if (gen) {
      usedGenerated.add(gen);
      items.push(mergeBuilderOwnedItem(ex, gen));
      resultIds.add(ex.id);
      updatedBuilderIds.push(ex.id);
      if (gen.id) matchedGeneratedIds.add(gen.id);
    } else {
      removedBuilderIds.push(ex.id);
    }
  }

  for (const gen of generated) {
    if (usedGenerated.has(gen) || resultIds.has(gen.id) || matchedGeneratedIds.has(gen.id)) continue;
    const key = builderProjectItemLogicalKey(gen);
    const dup = existing.some(
      (ex) =>
        ex.id === gen.id ||
        builderProjectItemLogicalKey(ex) === key ||
        (classifyProjectItemOwnership(ex, ctx) === PROJECT_ITEM_OWNERSHIP.BUILDER &&
          sameBuilderSectionMaterial(ex, gen) &&
          resultIds.has(ex.id)),
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
