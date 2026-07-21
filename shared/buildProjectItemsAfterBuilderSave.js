/**
 * Safe merge of builder-generated items with existing project items.
 * Builder may update only proven builder-owned lines; never drops spec/manual/ambiguous rows.
 */

import {
  classifyProjectItemOwnership,
  builderProjectItemLogicalKey,
  itemBelongsToActiveStellage,
  PROJECT_ITEM_OWNERSHIP,
  PROJECT_OWNED_FIELD_KEYS,
  projectItemHasAdminActivity,
} from "./projectItemOwnership.js";
import { copyCatalogSnapshotFromMaterial } from "./materialCatalogSnapshot.js";
import { isFrameBomLine, resolveBuilderPrefixedStellageId } from "./frameBomProjectItems.js";

function buildContext(builderContext = {}, existingItems = []) {
  const farmSectionNames = builderContext.farmSectionNames;
  const activeStellageIds = builderContext.activeStellageIds;
  let resolvedActive;
  if (activeStellageIds instanceof Set) {
    resolvedActive = activeStellageIds;
  } else if (Array.isArray(activeStellageIds)) {
    resolvedActive = new Set(activeStellageIds);
  } else if (activeStellageIds == null) {
    resolvedActive = undefined;
  } else {
    resolvedActive = new Set();
  }
  return {
    ...builderContext,
    existingItems,
    farmSectionNames:
      farmSectionNames instanceof Set
        ? farmSectionNames
        : new Set(Array.isArray(farmSectionNames) ? farmSectionNames : []),
    activeStellageIds: resolvedActive,
  };
}

/**
 * Fields the builder wizard may rewrite on matched generated lines.
 * Client visibility, purchase state, supplier, titles, and notes stay admin-owned.
 */
const BUILDER_REWRITE_FIELD_KEYS = new Set([
  "qty",
  "includedInProject",
  "enabled",
  "pipeCuts",
  "breakerSpecs",
  "flowSpecs",
  "splitSpecs",
  "subcategory",
  "farmGroup",
  "roomId",
  "sortOrder",
]);

/**
 * Catalog/geometry from generated; purchase / notes stay from existing project item.
 * Prevents wizard regenerate from wiping status/actualPrice/clientNote.
 * Persistent project_items.id is never rewritten.
 */
function mergeProjectOwnedFields(existing, generated) {
  const merged = { ...existing };
  for (const [key, val] of Object.entries(generated || {})) {
    if (key === "id") continue;
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
  // Exact persistent identity — never adopt a new generated id for an existing row.
  merged.id = existing.id;
  // SpecEditor title override stays on this row.
  if (existing.nameOverridden || existing.name_overridden) {
    merged.name = existing.name;
    merged.nameOverridden = true;
    merged.name_overridden = true;
  }
  // Project-local commercial overrides stay on this row (never borrow from a peer).
  if (existing.priceOverridden || (existing.price != null && generated?.price != null && Number(existing.price) !== Number(generated.price))) {
    // Prefer explicit override flag; also keep DB price when it differs from regenerated catalog.
    if (existing.priceOverridden || existing.price != null) {
      merged.price = existing.price;
      if (existing.priceOverridden) merged.priceOverridden = true;
    }
  }
  if (existing.linkOverridden) {
    merged.link = existing.link;
    merged.linkOverridden = true;
  }
  if (existing.linkAltOverridden) {
    merged.linkAlt = existing.linkAlt;
    merged.linkAltOverridden = true;
  }
  if (existing.supplier != null && String(existing.supplier).trim() !== "") {
    merged.supplier = existing.supplier;
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

function sectionMaterialGroupKey(item) {
  const materialId = String(item?.materialId || "").trim();
  const section = String(item?.section || item?.module || "").trim();
  if (!materialId || !section) return "";
  return `${section}::${materialId}`;
}

function sortByStableId(a, b) {
  return String(a?.id || "").localeCompare(String(b?.id || ""));
}

/**
 * Match existing → generated with one-to-one claims.
 * Priority: exact id → logical key → unique section+materialId → deterministic zip of remaining group.
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
  if (classifyProjectItemOwnership(existing, ctx) !== PROJECT_ITEM_OWNERSHIP.BUILDER) {
    return null;
  }
  const candidates = generated.filter((g) => claimable(g) && sameBuilderSectionMaterial(existing, g));
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) return null;

  // Ambiguous group: pair remaining existing peers with remaining candidates by sorted id.
  // Caller must process existing in stable order for this to stay deterministic.
  const groupKey = sectionMaterialGroupKey(existing);
  const peerExistingIds = (ctx._pendingBuilderByGroup?.get(groupKey) || [])
    .filter((id) => id === existing.id || !ctx._claimedExistingIds?.has(id));
  const rank = peerExistingIds.indexOf(existing.id);
  if (rank < 0) return null;
  const sortedCandidates = [...candidates].sort(sortByStableId);
  return sortedCandidates[rank] || null;
}

/**
 * Build map: section::materialId → existing builder item ids (sorted) for deterministic pairing.
 */
function buildPendingBuilderGroups(existing, ctx) {
  const map = new Map();
  for (const ex of existing) {
    if (classifyProjectItemOwnership(ex, ctx) !== PROJECT_ITEM_OWNERSHIP.BUILDER) continue;
    const gk = sectionMaterialGroupKey(ex);
    if (!gk) continue;
    if (!map.has(gk)) map.set(gk, []);
    map.get(gk).push(ex.id);
  }
  for (const [gk, ids] of map) {
    ids.sort((a, b) => String(a).localeCompare(String(b)));
    map.set(gk, ids);
  }
  return map;
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
  ctx._pendingBuilderByGroup = buildPendingBuilderGroups(existing, ctx);
  ctx._claimedExistingIds = new Set();

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

  // Process builder-owned existing in stable id order so ambiguous zip pairing is deterministic.
  const orderedExisting = [...existing].sort((a, b) => {
    const oa = classifyProjectItemOwnership(a, ctx);
    const ob = classifyProjectItemOwnership(b, ctx);
    if (oa === PROJECT_ITEM_OWNERSHIP.BUILDER && ob === PROJECT_ITEM_OWNERSHIP.BUILDER) {
      return sortByStableId(a, b);
    }
    return 0;
  });

  for (const ex of orderedExisting) {
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
      if (
        ctx.activeStellageIds instanceof Set
        && !itemBelongsToActiveStellage(ex, ctx.activeStellageIds)
      ) {
        removedBuilderIds.push(ex.id);
        continue;
      }
      const gen = findGeneratedMatch(ex, { byId, byKey }, generated, ctx, usedGenerated);
      const row = gen ? mergeFrameOwnedItem(ex, gen) : ex;
      items.push(row);
      resultIds.add(ex.id);
      if (gen) {
        usedGenerated.add(gen);
        ctx._claimedExistingIds.add(ex.id);
        updatedBuilderIds.push(ex.id);
        if (gen.id) matchedGeneratedIds.add(gen.id);
      }
      continue;
    }

    // BUILDER-owned: drop composition lines whose rack was deleted.
    // Do not apply the same-section peer preserve exception for inactive racks.
    const orphanStId = resolveBuilderPrefixedStellageId(ex);
    if (
      orphanStId
      && ctx.activeStellageIds instanceof Set
      && !ctx.activeStellageIds.has(orphanStId)
    ) {
      removedBuilderIds.push(ex.id);
      continue;
    }

    const gen = findGeneratedMatch(ex, { byId, byKey }, generated, ctx, usedGenerated);
    if (gen) {
      usedGenerated.add(gen);
      ctx._claimedExistingIds.add(ex.id);
      items.push(mergeBuilderOwnedItem(ex, gen));
      resultIds.add(ex.id);
      updatedBuilderIds.push(ex.id);
      if (gen.id) matchedGeneratedIds.add(gen.id);
    } else {
      // No match: preserve existing rather than dropping when generated still has
      // same-section material peers (extra duplicate left over after pairing),
      // or when the row carries SpecEditor / procurement activity.
      const peers = generated.filter((g) => sameBuilderSectionMaterial(ex, g));
      if (peers.length > 0 || projectItemHasAdminActivity(ex)) {
        items.push(ex);
        resultIds.add(ex.id);
      } else {
        removedBuilderIds.push(ex.id);
      }
    }
  }

  for (const gen of generated) {
    if (usedGenerated.has(gen) || resultIds.has(gen.id) || matchedGeneratedIds.has(gen.id)) continue;
    const key = builderProjectItemLogicalKey(gen);
    // Exact identity only — never treat same materialId+section as a duplicate of an existing row.
    const dup = existing.some(
      (ex) => ex.id === gen.id || (key && builderProjectItemLogicalKey(ex) === key),
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
        // Intentional drop: frame lines for deleted / inactive racks.
        if (
          ownership === PROJECT_ITEM_OWNERSHIP.FRAME
          && ctx.activeStellageIds instanceof Set
          && !itemBelongsToActiveStellage(ex, ctx.activeStellageIds)
        ) {
          continue;
        }
        invariantErrors.push(`Lost ${ownership} item: ${ex.id} (${ex.name || "?"})`);
      }
    }
  }

  for (const ex of existing) {
    if (isFrameBomLine(ex) && !resultIds.has(ex.id)) {
      // Lost frame BOM is OK when the line's rack is no longer active.
      if (
        ctx.activeStellageIds instanceof Set
        && !itemBelongsToActiveStellage(ex, ctx.activeStellageIds)
      ) {
        continue;
      }
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
        if (
          ownership === PROJECT_ITEM_OWNERSHIP.FRAME
          && ctx.activeStellageIds instanceof Set
          && !itemBelongsToActiveStellage(lost, ctx.activeStellageIds)
        ) {
          continue;
        }
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
