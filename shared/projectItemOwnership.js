/** Ownership classification for project items during builder save merge. */

import { AC_ITEM_SECTION } from "./roomAcSpec.js";
import {
  isCanonicalFrameBomLine,
  isExplicitManualProjectItem,
  isFrameBomLine,
  isProvenLegacyFrameBomTwin,
  resolveBuilderPrefixedStellageId,
} from "./frameBomProjectItems.js";

export const PROJECT_ITEM_OWNERSHIP = {
  FRAME: "frame",
  BUILDER: "builder",
  SPEC_MANUAL: "spec_manual",
  AMBIGUOUS: "ambiguous",
};

const GENERAL_FARM_SECTION = "Общая закупка на ферму";

/**
 * @param {object} item
 * @param {object} [builderContext]
 * @param {Set<string>} [builderContext.farmSectionNames]
 * @param {Set<string>} [builderContext.activeStellageIds]
 * @param {object[]} [builderContext.canonicalFrameItems]
 */
export function classifyProjectItemOwnership(item, builderContext = {}) {
  if (!item) return PROJECT_ITEM_OWNERSHIP.AMBIGUOUS;

  if (isExplicitManualProjectItem(item)) {
    return PROJECT_ITEM_OWNERSHIP.SPEC_MANUAL;
  }

  const canonicalFrameItems =
    builderContext.canonicalFrameItems ||
    (builderContext.existingItems || []).filter((it) => isCanonicalFrameBomLine(it));

  if (
    isCanonicalFrameBomLine(item) ||
    isFrameBomLine(item) ||
    isProvenLegacyFrameBomTwin(item, canonicalFrameItems)
  ) {
    return PROJECT_ITEM_OWNERSHIP.FRAME;
  }

  const section = String(item.section || item.module || "").trim();
  const farmNames = builderContext.farmSectionNames;
  if (farmNames instanceof Set && section && farmNames.has(section)) {
    return PROJECT_ITEM_OWNERSHIP.BUILDER;
  }
  if (section === GENERAL_FARM_SECTION) {
    return PROJECT_ITEM_OWNERSHIP.BUILDER;
  }

  if (item.roomId && section === AC_ITEM_SECTION) {
    return PROJECT_ITEM_OWNERSHIP.BUILDER;
  }

  const stellageId = resolveBuilderPrefixedStellageId(item);
  if (stellageId) {
    // Prefixed st_<id>__… lines are always builder-owned, even when the rack
    // was deleted (activeStellageIds no longer contains id). Orphan cleanup
    // happens in buildProjectItemsAfterBuilderSave — do not flip to AMBIGUOUS.
    return PROJECT_ITEM_OWNERSHIP.BUILDER;
  }

  if (item.source === "planner") {
    return PROJECT_ITEM_OWNERSHIP.SPEC_MANUAL;
  }

  const id = String(item.id || "");
  if (/^it_[^s]/.test(id) || (/^it_/.test(id) && !id.startsWith("st_"))) {
    return PROJECT_ITEM_OWNERSHIP.SPEC_MANUAL;
  }

  return PROJECT_ITEM_OWNERSHIP.AMBIGUOUS;
}

/**
 * Whether an item still belongs to an active stellage/rack.
 * Prefers resolveBuilderPrefixedStellageId; else moduleRackKey
 * (`moduleId:rackId` or `stellage:rackId`).
 * When activeStellageIds is a Set and ownership cannot be proven → inactive.
 * When activeStellageIds is not a Set → treat as active (no filter).
 *
 * @param {object} item
 * @param {Set<string>} [activeStellageIds]
 */
export function itemBelongsToActiveStellage(item, activeStellageIds) {
  if (!(activeStellageIds instanceof Set)) return true;

  const prefixed = resolveBuilderPrefixedStellageId(item);
  if (prefixed) return activeStellageIds.has(prefixed);

  const rack = String(
    item?.moduleRackKey
      || item?.module_rack_key
      || item?.sourceObjectIds?.moduleRackKey
      || "",
  ).trim();
  if (!rack) return false;
  if (rack.startsWith("stellage:")) {
    return activeStellageIds.has(rack.slice("stellage:".length));
  }
  const colon = rack.lastIndexOf(":");
  if (colon >= 0) {
    const rackId = rack.slice(colon + 1).trim();
    if (rackId) return activeStellageIds.has(rackId);
  }
  return false;
}

/**
 * Logical identity for builder-owned lines — NOT materialId alone.
 * @param {object} item
 */
export function builderProjectItemLogicalKey(item) {
  if (!item) return "";
  const id = String(item.id || "").trim();
  const stMatch = id.match(/^(st_[^_]+)__(.+)$/);
  if (stMatch) return `${stMatch[1]}::${stMatch[2]}`;

  if (isFrameBomLine(item)) {
    const rack =
      String(item.moduleRackKey || item.module_rack_key || "").trim() ||
      String(item.sourceKey || "").split(":")[1] ||
      "";
    const bomKey =
      String(item.bomKey || "").trim() ||
      String(item.sourceKey || "").split(":").pop() ||
      String(item.materialId || "").trim();
    return `frame::${rack}::${bomKey}::${id}`;
  }

  const roomId = String(item.roomId || "").trim();
  if (roomId) {
    return `room::${roomId}::${String(item.materialId || item.name || "").trim()}::${id}`;
  }

  const section = String(item.section || item.module || "").trim();
  const materialId = String(item.materialId || "").trim();
  const sourceKey = String(item.sourceKey || item.source_key || "").trim();
  if (sourceKey) return `src::${sourceKey}::${id}`;
  return `sec::${section}::${materialId}::${id}`;
}

/**
 * Admin / SpecEditor-owned fields — preserved from the live DB row when the
 * project builder regenerates lines. Builder may still rewrite qty / geometry
 * via BUILDER_REWRITE_FIELD_KEYS in buildProjectItemsAfterBuilderSave.
 */
export const PROJECT_OWNED_FIELD_KEYS = [
  "qty",
  "includedInProject",
  "visibleToClient",
  "visible",
  "approved",
  "showToClient",
  "clientVisible",
  "enabled",
  "status",
  "actualPrice",
  "clientComment",
  "internalNote",
  "internal_note",
  "techNote",
  "clientNote",
  "comment",
  "pipeCuts",
  "breakerSpecs",
  "flowSpecs",
  "splitSpecs",
  "responsible",
  "supplier",
  "name",
  "nameOverridden",
  "name_overridden",
  "price",
  "priceOverridden",
  "link",
  "linkOverridden",
  "linkAlt",
  "linkAltOverridden",
  "roomId",
  "purchaseKey",
  "purchaseStatus",
  "sortOrder",
  "needsApproval",
  "replacementPrice",
  "replacementComment",
  "replacementProposedAt",
  "replacementLink",
  "replacementPhotoUrl",
  "deliveryDays",
  "itemRole",
  "subcategory",
  "farmGroup",
  "clientSection",
  "clientSubsection",
];

/** True when a generated builder line carries meaningful SpecEditor / procurement activity.
 * Visibility-only hide flags are NOT enough to preserve a removed generated row forever.
 * Catalog supplier / default responsible alone also do not count (would create ghosts).
 */
export function projectItemHasAdminActivity(item) {
  if (!item || typeof item !== "object") return false;
  const status = String(item.status || "not_bought").trim();
  if (status && status !== "not_bought") return true;
  if (item.actualPrice != null && item.actualPrice !== "") return true;
  if (item.nameOverridden || item.name_overridden) return true;
  if (item.priceOverridden || item.linkOverridden || item.linkAltOverridden) return true;
  const notes = [item.clientComment, item.internalNote, item.internal_note, item.techNote, item.clientNote, item.comment];
  if (notes.some((n) => String(n || "").trim())) return true;
  if (item.replacementPrice != null || String(item.replacementComment || "").trim() || String(item.replacementLink || "").trim()) {
    return true;
  }
  if (String(item.purchaseKey || "").trim()) return true;
  if (Number(item.deliveryDays) > 0) return true;
  // SpecEditor-changed procurement fields (not catalog defaults on every generated line).
  // A non-empty supplier alone is too weak — catalog snapshot always fills it.
  // Treat explicit custom responsible only when paired with another signal above, or when
  // purchaseStatus / qty override markers exist.
  if (item.purchaseStatus != null && String(item.purchaseStatus).trim() && String(item.purchaseStatus) !== "not_bought") {
    return true;
  }
  return false;
}
