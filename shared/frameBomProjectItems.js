import { FRAME_BOM_MATERIALS } from "./frameBomMaterialMap.js";
import { normalizePipeCuts, pipeCutsClientNote } from "./profilePipeCuts.js";
import { normalizePurchaseStatus } from "./purchaseStatusRules.js";

export const FRAME_BOM_SOURCE = "frame_bom";
export const FRAME_BOM_ADMIN_SOURCE_LABEL = "Из схемы стеллажа";

export function isFrameBomLine(item) {
  if (!item) return false;

  const source = item.source || item.sourceType || item.source_type || "";
  if (source === FRAME_BOM_SOURCE) return true;

  if (item.fromFrameBom === true || item.frameBom === true || item.isFrameBom === true) {
    return true;
  }

  const sourceKey = String(item.sourceKey || item.source_key || "");
  if (sourceKey.startsWith("frame_bom:")) return true;

  const id = String(item.id || "");
  if (id.startsWith("it_fbom_") || id.startsWith("it_fbom:") || id.startsWith("frame_bom:")) {
    return true;
  }

  const obj = parseSourceObjectIds(item.sourceObjectIds ?? item.source_object_ids);
  if (String(obj.bomKey || item.bomKey || "").trim()) return true;
  if (String(obj.moduleRackKey || obj.module_rack_key || item.moduleRackKey || "").trim() && sourceKey) {
    return true;
  }

  const rackKey = resolveFrameBomItemModuleRackKey(item);
  const pipeCuts = normalizePipeCuts(item.pipeCuts ?? []);
  if (rackKey && pipeCuts.length > 0) return true;

  const sourceLabel = String(item.sourceLabel || item.source_label || "");
  if (
    sourceLabel === FRAME_BOM_ADMIN_SOURCE_LABEL ||
    /из схемы (?:каркаса|стеллажа)/i.test(sourceLabel)
  ) {
    return true;
  }

  const note = String(item.note || item.clientNote || "");
  if (/из схемы (?:каркаса|стеллажа)/i.test(note)) return true;

  return false;
}

/** Админский бейдж источника (без техполей frame_bom/sourceKey). */
export function resolveAdminItemSourceLabel(item) {
  return isFrameBomLine(item) ? FRAME_BOM_ADMIN_SOURCE_LABEL : "";
}

const PROFILE_TUBE_BOM_KEY = "profile_tube_20x20";
const PROFILE_TUBE_MATERIAL_ID = "m036";

/**
 * @param {{ drawingId?: string, moduleRackKey?: string }} options
 * @returns {{ prefix: string, warnings: string[] }}
 */
export function buildFrameBomSourceRackPrefix({ drawingId, moduleRackKey } = {}) {
  const rackKey = String(moduleRackKey || "").trim();
  const warnings = [];
  if (!rackKey) {
    return { prefix: "", warnings: ["moduleRackKey is required"] };
  }
  const drawingPart = String(drawingId || "").trim();
  if (!drawingPart) {
    warnings.push("Нет drawingId — BOM будет привязан только к rackKey.");
    return { prefix: `frame_bom:unsaved:${rackKey}`, warnings };
  }
  return { prefix: `frame_bom:${drawingPart}:${rackKey}`, warnings };
}

/**
 * @param {unknown} raw
 */
function parseSourceObjectIds(raw) {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof raw === "object" ? raw : {};
}

/**
 * Rack identity from a saved frame_bom project item (camelCase + snake_case).
 * @param {object} item
 */
export function resolveFrameBomItemModuleRackKey(item) {
  if (!item) return "";
  const obj = parseSourceObjectIds(item.sourceObjectIds ?? item.source_object_ids);
  const fromObj = String(obj.moduleRackKey || obj.module_rack_key || "").trim();
  if (fromObj) return fromObj;
  const rackKey = String(item.sourceRackKey || item.source_rack_key || "").trim();
  if (rackKey) return rackKey;
  const stellageId = String(obj.stellageId || obj.stellage_id || "").trim();
  if (stellageId) return `stellage:${stellageId}`;
  return "";
}

/**
 * @param {string} sourceKey
 * @param {string} moduleRackKey
 */
export function sourceKeyMatchesModuleRack(sourceKey, moduleRackKey) {
  const sk = String(sourceKey || "");
  const rack = String(moduleRackKey || "").trim();
  if (!sk.startsWith("frame_bom:") || !rack) return false;
  return sk.includes(`:${rack}:`);
}

/**
 * True when item is explicitly manual — must never be removed by BOM merge/cleanup.
 * @param {object} item
 */
export function isExplicitManualProjectItem(item) {
  if (!item) return false;
  const source = String(item.source || item.sourceType || item.source_type || "").trim();
  if (source === "manual") return true;
  return false;
}

/**
 * Resolve bomKey from a saved project item.
 * @param {object} item
 */
export function resolveFrameBomItemBomKey(item) {
  if (!item) return "";
  const obj = parseSourceObjectIds(item.sourceObjectIds ?? item.source_object_ids);
  let bomKey = String(obj.bomKey || item.bomKey || "").trim();
  if (bomKey) return bomKey;
  const sk = String(item.sourceKey || item.source_key || "");
  if (sk.startsWith("frame_bom:")) {
    const parts = sk.split(":");
    return parts[parts.length - 1] || "";
  }
  const id = String(item.id || "");
  if (id.startsWith("it_fbom_") || id.startsWith("frame_bom:")) {
    const parts = id.split(/[:_]/);
    return parts[parts.length - 1] || "";
  }
  return "";
}

/**
 * Rank for dedupe / preserve — higher wins.
 * @param {object} item
 */
export function frameBomLineRank(item) {
  if (!item) return 0;
  let rank = 0;
  const source = item.source || item.sourceType || item.source_type || "";
  if (
    source === FRAME_BOM_SOURCE ||
    item.fromFrameBom === true ||
    item.frameBom === true ||
    item.isFrameBom === true
  ) {
    rank += 100;
  }
  if (resolveFrameBomItemBomKey(item)) rank += 50;
  if (resolveFrameBomItemModuleRackKey(item)) rank += 30;
  const sk = String(item.sourceKey || item.source_key || "");
  if (sk.startsWith("frame_bom:")) rank += 15;
  if (Number(item.price) > 0) rank += 20;
  if (Number(item.actualPrice) > 0) rank += 10;
  const supplier = String(item.supplier || "").trim();
  if (supplier && supplier.toLowerCase() !== "поставщик") rank += 5;
  if (String(item.link || "").trim()) rank += 5;
  return rank;
}

/**
 * Dedupe key: same rack scope + bomKey/materialId.
 * @param {object} item
 */
export function resolveFrameBomDedupeKey(item) {
  const rack = resolveFrameBomItemModuleRackKey(item)
    || (String(item.module || item.section || "").trim()
      ? `label:${String(item.module || item.section).trim()}`
      : "")
    || "norack";
  const materialId = String(item.materialId || "").trim();
  if (materialId) return `${rack}::mat:${materialId}`;
  const bomKey = resolveFrameBomItemBomKey(item);
  if (bomKey) return `${rack}::${bomKey}`;
  return `${rack}::id:${String(item.id || "")}`;
}

/**
 * True when two BOM lines represent the same rack material cluster (legacy + canonical).
 * @param {object} a
 * @param {object} b
 */
export function frameBomItemsSameDedupeCluster(a, b) {
  if (!a || !b) return false;
  const matA = String(a.materialId || "").trim();
  const matB = String(b.materialId || "").trim();
  if (!matA || matA !== matB) return false;

  const rackA = resolveFrameBomItemModuleRackKey(a);
  const rackB = resolveFrameBomItemModuleRackKey(b);
  if (rackA && rackB && rackA === rackB) return true;

  const labelA = String(a.module || a.section || "").trim();
  const labelB = String(b.module || b.section || "").trim();
  if (labelA && labelB && labelA === labelB) return true;
  if (rackA && labelB && labelA === labelB) return true;
  if (rackB && labelA && labelA === labelB) return true;

  return resolveFrameBomDedupeKey(a) === resolveFrameBomDedupeKey(b);
}

/**
 * Keep one BOM row per rack+bomKey/materialId — prefer canonical / priced rows.
 * @param {object[]} items
 */
export function dedupeFrameBomProjectItems(items) {
  const kept = [];
  for (const item of items || []) {
    if (!isFrameBomLine(item)) continue;
    const idx = kept.findIndex((prev) => frameBomItemsSameDedupeCluster(prev, item));
    if (idx < 0) {
      kept.push(item);
    } else if (frameBomLineRank(item) > frameBomLineRank(kept[idx])) {
      kept[idx] = item;
    }
  }
  return kept;
}

/**
 * @param {object[]} items
 */
export function countDedupedFrameBomItems(items) {
  return dedupeFrameBomProjectItems(items).length;
}

/**
 * @param {object[]} items
 */
export function dedupedFrameBomLineIds(items) {
  return dedupeFrameBomProjectItems(items)
    .map((it) => it.id)
    .filter(Boolean)
    .map(String);
}

/**
 * True when item belongs to rack scope for merge/cleanup.
 * @param {object} item
 * @param {string} moduleRackKey
 * @param {object} [options]
 */
export function itemBelongsToRackMergeScope(item, moduleRackKey, options = {}) {
  const rack = String(moduleRackKey || "").trim();
  if (!rack || !item) return false;

  const itemRack = resolveFrameBomItemModuleRackKey(item);
  if (itemRack && itemRack === rack) return true;

  const sk = String(item.sourceKey || item.source_key || "");
  if (sourceKeyMatchesModuleRack(sk, rack)) return true;

  const obj = parseSourceObjectIds(item.sourceObjectIds ?? item.source_object_ids);
  const stellageId = String(obj.stellageId || obj.stellage_id || item.stellageId || "").trim();
  if (stellageId && rack === `stellage:${stellageId}`) return true;

  const optStellageId = String(options.stellageId || "").trim();
  if (optStellageId && stellageId && stellageId === optStellageId) return true;

  if (rack.startsWith("stellage:")) {
    const sid = rack.slice("stellage:".length);
    if (stellageId && stellageId === sid) return true;
  }

  const builderStId = resolveBuilderPrefixedStellageId(item);
  if (builderStId) {
    const optStellage = String(options.stellageId || "").trim();
    if (optStellage && builderStId === optStellage) return true;
    if (rack === builderStId || rack.endsWith(`:${builderStId}`) || rack.includes(`:${builderStId}:`)) {
      return true;
    }
    if (rack.startsWith("stellage:") && rack.slice("stellage:".length) === builderStId) return true;
  }

  if (rack) {
    const itemId = String(item.id || "");
    if (itemId.includes(rack) && (isFrameBomLine(item) || isBuilderSyncedFrameBomLine(item))) {
      return true;
    }
  }

  if (isFrameBomLine(item)) {
    const rackLabel = String(options.rackLabel || "").trim();
    if (rackLabel) {
      const mod = String(item.module || item.section || "").trim();
      const itemRackForLabel = resolveFrameBomItemModuleRackKey(item);
      if (mod && mod === rackLabel && (!itemRackForLabel || itemRackForLabel === rack)) {
        return true;
      }
    }
    if (sk && (sk.includes(`:${rack}:`) || sk.endsWith(`:${rack}`))) return true;
  }

  return false;
}

/**
 * Stellage id from builder-synced project_item id: st_<stellageId>__...
 * @param {object} item
 */
export function resolveBuilderPrefixedStellageId(item) {
  const id = String(item?.id || "");
  if (!id.startsWith("st_")) return "";
  const sep = id.indexOf("__");
  if (sep <= 3) return "";
  return id.slice(0, sep);
}

/**
 * ID-pattern candidate for builder-prefixed rows: st_<rack>__(ln_|it_fbom_).
 * NOT ownership by itself — ordinary plumbing/builder lines also use st_*__ln_*.
 * @param {object} item
 */
export function isBuilderSyncedFrameBomLine(item) {
  if (!item || isExplicitManualProjectItem(item)) return false;
  const id = String(item?.id || "");
  return /^st_.+__(?:ln_|it_fbom_)/.test(id);
}

/**
 * Canonical frame BOM ownership (proven markers, not bare st_*__ln_* id).
 * @param {object} item
 */
export function isCanonicalFrameBomItem(item) {
  return isCanonicalFrameBomLine(item);
}

/**
 * Proven residual twin of a canonical frame BOM row (patterns A/B only).
 * Bare st_*__ln_* without a matching canonical twin is NOT a twin.
 *
 * @param {object} item
 * @param {object[]} [canonicalItems]
 */
export function isProvenLegacyFrameBomTwin(item, canonicalItems = []) {
  if (!item || isExplicitManualProjectItem(item)) return false;
  if (isCanonicalFrameBomLine(item)) return false;
  if (!isBuilderSyncedFrameBomLine(item)) return false;

  const canons = (canonicalItems || []).filter(
    (c) => c && isCanonicalFrameBomLine(c) && !isExplicitManualProjectItem(c),
  );
  if (!canons.length) return false;

  // A: st_<rack>__it_fbom_* with exact canonical id suffix
  if (twinPrefixedExactCanonicalId(item, canons)) return true;

  // B: same material + rack/section cluster
  if (canons.some((c) => frameBomItemsSameDedupeCluster(c, item))) return true;

  // B2: same materialId + builder stellage id belongs to canonical moduleRackKey
  // (legacy builder rows often lack module/section/sourceObjectIds)
  const mid = String(item.materialId || "").trim();
  const builderStId = resolveBuilderPrefixedStellageId(item);
  if (!mid || !builderStId) return false;

  return canons.some((c) => {
    if (String(c.materialId || "").trim() !== mid) return false;
    const rack = resolveFrameBomItemModuleRackKey(c);
    if (!rack) return false;
    if (rack === `stellage:${builderStId}`) return true;
    if (rack === builderStId) return true;
    if (rack.includes(`:${builderStId}`) || rack.endsWith(`:${builderStId}`)) return true;
    if (rack.includes(builderStId)) return true;
    return false;
  });
}

/**
 * Ordinary rack/builder/catalog/manual line — must survive frame BOM refresh.
 * @param {object} item
 * @param {object[]} [canonicalItems]
 */
export function isNonFrameRackItem(item, canonicalItems = []) {
  if (!item) return false;
  if (isCanonicalFrameBomItem(item)) return false;
  if (isFrameBomLine(item)) return false;
  if (isProvenLegacyFrameBomTwin(item, canonicalItems)) return false;
  return true;
}

/**
 * Frame-owned rows for a rack merge: canonical/evidenced frame BOM + proven twins only.
 * @param {object[]} items
 * @param {string} moduleRackKey
 * @param {object} [options]
 */
export function collectFrameBomOwnedItems(items, moduleRackKey, options = {}) {
  const existing = Array.isArray(items) ? items : [];
  const opts = { ...options, allItems: existing };
  return existing.filter((it) => shouldRemoveFrameBomOnMerge(it, moduleRackKey, opts));
}

/**
 * True when item should be removed during mergeFrameBomIntoProjectItems for a rack.
 * Never removes ordinary builder/catalog lines just because id is st_*__ln_*.
 *
 * @param {object} item
 * @param {string} moduleRackKey
 * @param {object} [options] pass allItems/existingItems for proven-twin detection
 */
export function shouldRemoveFrameBomOnMerge(item, moduleRackKey, options = {}) {
  if (!item || isExplicitManualProjectItem(item)) return false;
  if (!itemBelongsToRackMergeScope(item, moduleRackKey, options)) return false;

  // Evidenced frame BOM (source/bomKey/note/flags) — including builder-prefixed with markers
  if (isFrameBomLine(item)) return true;

  const allItems = options.allItems || options.existingItems || [];
  if (!allItems.length) return false;
  const canons = allItems.filter(
    (it) => isCanonicalFrameBomLine(it) && !isExplicitManualProjectItem(it),
  );
  return isProvenLegacyFrameBomTwin(item, canons);
}

/**
 * True when item is canonical frame_bom belonging to the given rack scope (moduleRackKey).
 * drawingId is NOT part of the match — same rack replaces all prior BOM versions.
 *
 * @param {object} item
 * @param {string} moduleRackKey
 */
export function isFrameBomItemForRack(item, moduleRackKey) {
  const rack = String(moduleRackKey || "").trim();
  if (!rack) return false;

  const source = item?.source || item?.sourceType || item?.source_type || "";
  const isCanonical =
    source === FRAME_BOM_SOURCE ||
    item?.fromFrameBom === true ||
    item?.frameBom === true ||
    item?.isFrameBom === true;
  if (!isCanonical) return false;

  return itemBelongsToRackMergeScope(item, rack);
}

function mergePreservedEntry(map, key, item) {
  if (!key) return;
  const status = normalizePurchaseStatus(item);
  const next = {
    status,
    purchaseStatus: status,
    actualPrice: item.actualPrice,
    clientComment: item.clientComment,
    visibleToClient: item.visibleToClient,
    visible: item.visible,
    approved: item.approved,
    clientSection: item.clientSection,
    clientSubsection: item.clientSubsection,
    rank: frameBomLineRank(item),
  };
  const prev = map.get(key);
  if (!prev || next.rank >= prev.rank) {
    map.set(key, next);
  }
}

function frameBomItemId({ drawingId, moduleRackKey, bomKey }) {
  const scope = String(drawingId || "unsaved").replace(/[^a-zA-Z0-9:_-]/g, "_");
  const rack = String(moduleRackKey || "").replace(/[^a-zA-Z0-9:_-]/g, "_");
  return `it_fbom_${scope}_${rack}_${bomKey}`;
}

function resolvePipeCutsForDraft(draft) {
  const bomKey = draft?.key || "";
  const isProfileTube =
    bomKey === PROFILE_TUBE_BOM_KEY || draft?.materialId === PROFILE_TUBE_MATERIAL_ID;
  if (!isProfileTube) return [];
  return normalizePipeCuts(draft.pipeCuts ?? []);
}

function materialCatalogIndex(materials = []) {
  const map = new Map();
  for (const mat of materials || []) {
    const id = mat?.id || mat?.materialId;
    if (id) map.set(id, mat);
  }
  return map;
}

export function frameBomMaterialLabel(materialId) {
  const id = String(materialId || "").trim();
  if (!id) return "";
  for (const entry of Object.values(FRAME_BOM_MATERIALS)) {
    if (entry.materialId === id) return entry.name;
  }
  return id;
}

/**
 * Snapshot of catalog fields used by project/client purchase rows.
 * @param {object} mat
 */
export function materialSnapshotForFrameBom(mat) {
  if (!mat) return null;
  const img = mat.imageUrl || mat.photoUrl || "";
  return {
    materialId: mat.id || mat.materialId,
    name: mat.name || "",
    unit: mat.unit || "шт.",
    category: mat.category || "Прочее",
    subcategory: mat.subcategory || "",
    supplier: mat.supplier || "",
    link: mat.link || "",
    linkAlt: mat.linkAlt || "",
    imageUrl: img,
    photoUrl: img,
    price: Number(mat.basePrice ?? mat.price) || 0,
    vatRate: [0, 5, 20].includes(Number(mat.vatRate)) ? Number(mat.vatRate) : 0,
    clientSection: mat.clientSection || "",
    clientSubsection: mat.clientSubsection || "",
    purchaseKey: mat.purchaseKey || "",
    itemType: mat.itemType || "material",
    responsible: mat.responsible || "",
    clientNote: mat.clientNote || mat.comment || "",
    techNote: mat.techNote || "",
  };
}

/**
 * @param {object[]} purchaseDraft
 * @param {object[]} materials
 */
export function findMissingFrameBomMaterials(purchaseDraft, materials = []) {
  const index = materialCatalogIndex(materials);
  const missing = new Set();
  for (const line of purchaseDraft || []) {
    const qty = Number(line?.qty) || 0;
    if (qty <= 0) continue;
    const materialId = String(line?.materialId || "").trim();
    if (!materialId) {
      missing.add(line?.key || line?.name || "unknown");
      continue;
    }
    if (!index.has(materialId)) missing.add(materialId);
  }
  return [...missing];
}

export function formatFrameBomMissingMaterialsMessage(missingIds = []) {
  if (!missingIds.length) return "";
  const lines = missingIds.map((id) => {
    const label = frameBomMaterialLabel(id);
    return label && label !== id ? `${id} — ${label}` : String(id);
  });
  return [
    "BOM не добавлен. В базе материалов не найдены позиции:",
    ...lines,
    "Сначала добавьте эти материалы в базу через «+ новая позиция в базу».",
  ].join("\n");
}

/**
 * @param {object} draftItem
 * @param {object[]} materials
 */
export function enrichFrameBomDraftWithMaterials(draftItem, materials = []) {
  const materialId = String(draftItem?.materialId || "").trim();
  if (!materialId) {
    return { enriched: null, missing: draftItem?.key || draftItem?.name || "unknown" };
  }
  const mat = materialCatalogIndex(materials).get(materialId);
  if (!mat) {
    return { enriched: null, missing: materialId };
  }
  const base = materialSnapshotForFrameBom(mat);
  const pipeCuts = resolvePipeCutsForDraft(draftItem);
  const bomTechNote = draftItem.techNote ? String(draftItem.techNote) : "";
  const bomClientNote = pipeCuts.length
    ? pipeCutsClientNote(pipeCuts) || bomTechNote
    : bomTechNote;
  return {
    enriched: {
      ...draftItem,
      ...base,
      name: base.name,
      qty: Number(draftItem.qty) || 0,
      unit: draftItem.unit || base.unit,
      pipeCuts,
      techNote: bomTechNote || base.techNote,
      clientNote: bomClientNote || base.clientNote,
    },
    missing: null,
  };
}

/**
 * Enrich saved project item snapshot from materials catalog (for hydrate/client view).
 * @param {object} item
 * @param {object[]} materials
 */
export function enrichProjectItemFromMaterial(item, materials = []) {
  const materialId = String(item?.materialId || "").trim();
  if (!materialId) return item;
  const mat = materialCatalogIndex(materials).get(materialId);
  if (!mat) return item;
  const base = materialSnapshotForFrameBom(mat);
  const pipeCuts = item.pipeCuts?.length ? normalizePipeCuts(item.pipeCuts) : [];
  const bomClientNote = pipeCuts.length
    ? pipeCutsClientNote(pipeCuts) || item.clientNote
    : item.clientNote;
  return {
    ...item,
    ...base,
    name: base.name,
    qty: Number(item.qty) || 0,
    unit: item.unit || base.unit,
    pipeCuts: pipeCuts.length ? pipeCuts : item.pipeCuts,
    techNote: item.techNote || base.techNote,
    clientNote: bomClientNote || base.clientNote,
    comment: bomClientNote || item.comment || base.clientNote,
    price: Number(item.price) > 0 ? Number(item.price) : base.price,
    supplier: item.supplier || base.supplier,
    link: item.link || base.link,
    linkAlt: item.linkAlt || base.linkAlt,
    imageUrl: item.imageUrl || item.photoUrl || base.imageUrl,
    photoUrl: item.photoUrl || item.imageUrl || base.photoUrl,
  };
}

/**
 * @param {object} draft
 * @param {object} options
 * @param {string} rackPrefix
 * @param {number} sortOrder
 */
export function frameBomDraftToProjectItem(draft, options, rackPrefix, sortOrder) {
  const bomKey = draft.key || draft.materialId;
  const sourceKey = `${rackPrefix}:${bomKey}`;
  const pipeCuts = resolvePipeCutsForDraft(draft);
  const techNote = draft.techNote ? String(draft.techNote) : "";
  const clientNote = pipeCuts.length ? pipeCutsClientNote(pipeCuts) || techNote : (draft.clientNote || techNote);
  const section = String(options.rackLabel || options.moduleRackKey || "").trim();
  const included = options.included !== false;
  const visibleToClient = options.visibleToClient !== false;
  const img = draft.imageUrl || draft.photoUrl || "";

  return {
    id: frameBomItemId({
      drawingId: options.drawingId,
      moduleRackKey: options.moduleRackKey,
      bomKey,
    }),
    materialId: draft.materialId,
    name: draft.name || FRAME_BOM_MATERIALS[bomKey]?.name || "",
    unit: draft.unit || FRAME_BOM_MATERIALS[bomKey]?.unit || "шт.",
    qty: Number(draft.qty) || 0,
    module: section,
    section,
    category: draft.category || "Прочее",
    subcategory: draft.subcategory || "",
    supplier: draft.supplier || "",
    link: draft.link || "",
    linkAlt: draft.linkAlt || "",
    imageUrl: img,
    photoUrl: img,
    clientSection: draft.clientSection || "",
    clientSubsection: draft.clientSubsection || "",
    purchaseKey: draft.purchaseKey || "",
    pipeCuts,
    techNote,
    clientNote,
    comment: clientNote,
    source: FRAME_BOM_SOURCE,
    sourceType: FRAME_BOM_SOURCE,
    sourceLabel: FRAME_BOM_ADMIN_SOURCE_LABEL,
    sourceKey,
    bomKey,
    moduleRackKey: options.moduleRackKey || "",
    drawingId: options.drawingId || "",
    frameBom: true,
    fromFrameBom: true,
    isFrameBom: true,
    sourceObjectIds: {
      frameDrawingId: options.drawingId || "",
      drawingId: options.drawingId || "",
      moduleRackKey: options.moduleRackKey || "",
      stellageId: options.stellageId || "",
      bomKey,
      projectId: options.projectId || "",
    },
    includedInProject: included,
    visibleToClient,
    visible: visibleToClient,
    approved: visibleToClient,
    enabled: included,
    itemType: draft.itemType || "material",
    itemRole: "purchase",
    status: "not_bought",
    sortOrder,
    price: Number(draft.price) || 0,
    vatRate: Number(draft.vatRate) || 0,
    responsible: draft.responsible || "",
  };
}

/**
 * Merge frame BOM purchase draft into project items (pure, no DB/API).
 *
 * @param {object[]} existingItems
 * @param {object[]} purchaseDraft
 * @param {{
 *   projectId?: string,
 *   drawingId?: string,
 *   moduleRackKey?: string,
 *   stellageId?: string,
 *   rackLabel?: string,
 *   visibleToClient?: boolean,
 *   included?: boolean,
 *   materials?: object[],
 * }} options
 */
export function mergeFrameBomIntoProjectItems(existingItems, purchaseDraft, options = {}) {
  const warnings = [];
  const existing = Array.isArray(existingItems) ? existingItems : [];
  const draft = Array.isArray(purchaseDraft) ? purchaseDraft : [];
  const materials = options.materials || null;

  const { prefix: sourceRackPrefix, warnings: prefixWarnings } = buildFrameBomSourceRackPrefix(options);
  warnings.push(...prefixWarnings);

  const moduleRackKey = String(options.moduleRackKey || "").trim();

  if (!moduleRackKey) {
    const blockedReason = "BOM не добавлен: нет привязки к стеллажу.";
    warnings.push(blockedReason);
    return {
      items: [...existing],
      removedCount: 0,
      addedCount: 0,
      keptCount: existing.length,
      sourceRackPrefix,
      rackScopeKey: "",
      warnings,
      blocked: true,
      blockedReason,
      missingMaterialIds: [],
    };
  }

  if (materials) {
    const missingMaterialIds = findMissingFrameBomMaterials(draft, materials);
    if (missingMaterialIds.length) {
      const blockedReason = formatFrameBomMissingMaterialsMessage(missingMaterialIds);
      warnings.push(blockedReason);
      return {
        items: [...existing],
        removedCount: 0,
        addedCount: 0,
        keptCount: existing.length,
        sourceRackPrefix,
        rackScopeKey: moduleRackKey,
        warnings,
        blocked: true,
        blockedReason,
        missingMaterialIds,
      };
    }
  }

  const mergeOpts = { ...options, allItems: existing, existingItems: existing };
  const removedBomItems = existing.filter((it) =>
    shouldRemoveFrameBomOnMerge(it, moduleRackKey, mergeOpts)
  );
  const removedIds = new Set(removedBomItems.map((it) => String(it.id || "")).filter(Boolean));
  const kept = existing.filter((it) => !removedIds.has(String(it.id || "")));
  const removedCount = removedBomItems.length;

  // Invariant: non-frame rack/builder lines must never disappear on frame BOM merge
  const canons = existing.filter(
    (it) => isCanonicalFrameBomLine(it) && !isExplicitManualProjectItem(it),
  );
  const nonFrameBefore = existing.filter((it) => isNonFrameRackItem(it, canons));
  const nonFrameMissing = nonFrameBefore.filter((it) => removedIds.has(String(it.id || "")));
  if (nonFrameMissing.length) {
    const blockedReason =
      `Обновление BOM отменено: были бы удалены обычные позиции стеллажа (${nonFrameMissing.length}).`;
    warnings.push(blockedReason);
    return {
      items: [...existing],
      removedCount: 0,
      addedCount: 0,
      keptCount: existing.length,
      sourceRackPrefix,
      rackScopeKey: moduleRackKey,
      warnings,
      blocked: true,
      blockedReason,
      missingMaterialIds: [],
      invariantViolation: {
        missingNonFrameIds: nonFrameMissing.map((it) => it.id).filter(Boolean),
      },
    };
  }

  const preservedByBomKey = new Map();
  const preservedByMaterialId = new Map();
  for (const it of removedBomItems) {
    mergePreservedEntry(preservedByBomKey, resolveFrameBomItemBomKey(it), it);
    const materialId = String(it.materialId || "").trim();
    if (materialId) mergePreservedEntry(preservedByMaterialId, materialId, it);
  }

  const added = [];
  let sortOrder = kept.length;

  for (const line of draft) {
    const qty = Number(line.qty) || 0;
    if (qty <= 0) continue;

    if (!line.materialId) {
      warnings.push(`Не найден materialId для позиции ${line.key || line.name || "unknown"}`);
      continue;
    }

    let enrichedLine = line;
    if (materials) {
      const { enriched, missing } = enrichFrameBomDraftWithMaterials(line, materials);
      if (!enriched) {
        warnings.push(`Материал не найден в базе: ${missing}`);
        continue;
      }
      enrichedLine = enriched;
    }

    const item = frameBomDraftToProjectItem(enrichedLine, options, sourceRackPrefix, sortOrder);
    const bomKey = String(line.key || line.materialId || "").trim();
    const preserved =
      preservedByBomKey.get(bomKey)
      || preservedByMaterialId.get(String(line.materialId || "").trim());
    if (preserved) {
      item.status = preserved.status;
      item.purchaseStatus = preserved.purchaseStatus;
      if (preserved.actualPrice != null) item.actualPrice = preserved.actualPrice;
      if (preserved.clientComment) item.clientComment = preserved.clientComment;
      if (preserved.visibleToClient != null) {
        item.visibleToClient = preserved.visibleToClient;
        item.visible = preserved.visible ?? preserved.visibleToClient;
        item.approved = preserved.approved ?? preserved.visibleToClient;
      }
      if (preserved.clientSection) item.clientSection = preserved.clientSection;
      if (preserved.clientSubsection) item.clientSubsection = preserved.clientSubsection;
    }
    added.push(item);
    sortOrder += 1;
  }

  // After new canonical rows exist, drop proven residual twins of those materials only
  const nextCanons = [
    ...kept.filter((it) => isCanonicalFrameBomLine(it) && !isExplicitManualProjectItem(it)),
    ...added,
  ];
  const twinExtras = kept.filter((it) => isProvenLegacyFrameBomTwin(it, nextCanons));
  for (const twin of twinExtras) {
    removedBomItems.push(twin);
    removedIds.add(String(twin.id || ""));
    mergePreservedEntry(preservedByBomKey, resolveFrameBomItemBomKey(twin), twin);
    const materialId = String(twin.materialId || "").trim();
    if (materialId) mergePreservedEntry(preservedByMaterialId, materialId, twin);
  }
  // Apply newly discovered twin preserve fields onto added canonical rows
  for (const item of added) {
    const bomKey = resolveFrameBomItemBomKey(item);
    const preserved =
      preservedByBomKey.get(bomKey)
      || preservedByMaterialId.get(String(item.materialId || "").trim());
    if (!preserved) continue;
    item.status = preserved.status;
    item.purchaseStatus = preserved.purchaseStatus;
    if (preserved.actualPrice != null) item.actualPrice = preserved.actualPrice;
    if (preserved.clientComment) item.clientComment = preserved.clientComment;
    if (preserved.visibleToClient != null) {
      item.visibleToClient = preserved.visibleToClient;
      item.visible = preserved.visible ?? preserved.visibleToClient;
      item.approved = preserved.approved ?? preserved.visibleToClient;
    }
    if (preserved.clientSection) item.clientSection = preserved.clientSection;
    if (preserved.clientSubsection) item.clientSubsection = preserved.clientSubsection;
  }
  const keptFinal = kept.filter((it) => !removedIds.has(String(it.id || "")));

  // Re-check invariant against original non-frame set
  const nonFrameStillMissing = nonFrameBefore.filter((it) => removedIds.has(String(it.id || "")));
  if (nonFrameStillMissing.length) {
    const blockedReason =
      `Обновление BOM отменено: были бы удалены обычные позиции стеллажа (${nonFrameStillMissing.length}).`;
    warnings.push(blockedReason);
    return {
      items: [...existing],
      removedCount: 0,
      addedCount: 0,
      keptCount: existing.length,
      sourceRackPrefix,
      rackScopeKey: moduleRackKey,
      warnings,
      blocked: true,
      blockedReason,
      missingMaterialIds: [],
      invariantViolation: {
        missingNonFrameIds: nonFrameStillMissing.map((it) => it.id).filter(Boolean),
      },
    };
  }

  return {
    items: [...keptFinal, ...added],
    removedCount: removedBomItems.length,
    addedCount: added.length,
    keptCount: keptFinal.length,
    sourceRackPrefix,
    rackScopeKey: moduleRackKey,
    warnings,
    blocked: false,
    missingMaterialIds: [],
  };
}

/**
 * Frame BOM lines already merged into a saved project for one rack (deduped view).
 *
 * @param {object[]} items
 * @param {string} moduleRackKey
 * @param {object} [options]
 */
export function frameBomItemsForModuleRack(items, moduleRackKey, options = {}) {
  const rackKey = String(moduleRackKey || "").trim();
  if (!rackKey) return [];
  // Only evidenced frame BOM — never treat bare st_*__ln_* builder lines as frame BOM
  const candidates = (items || []).filter(
    (it) => isFrameBomLine(it) && itemBelongsToRackMergeScope(it, rackKey, options),
  );
  return dedupeFrameBomProjectItems(candidates);
}

/**
 * Build repair plan for explicit "Обновить BOM" in saved specification.
 *
 * @param {object[]} existingItems
 * @param {object[]} purchaseDraft
 * @param {object} options
 */
export function buildFrameBomRepairPlan(existingItems, purchaseDraft, options = {}) {
  const repairOpts = { ...options, explicitRepair: true };
  const existing = Array.isArray(existingItems) ? existingItems : [];
  const canons = existing.filter(
    (it) => isCanonicalFrameBomLine(it) && !isExplicitManualProjectItem(it),
  );
  const mergeResult = mergeFrameBomIntoProjectItems(existing, purchaseDraft, repairOpts);

  if (mergeResult.blocked) {
    return {
      blocked: true,
      blockedReason: mergeResult.blockedReason,
      missingMaterialIds: mergeResult.missingMaterialIds || [],
      warnings: mergeResult.warnings || [],
      cleanedItems: [...existing],
      removeItemIds: [],
      upsertItems: [],
      preservedItems: existing.filter((it) => isNonFrameRackItem(it, canons)),
      frameBomCount: collectFrameBomOwnedItems(existing, options.moduleRackKey, options)
        .filter((it) => isFrameBomLine(it)).length,
      safeDuplicateCount: 0,
      preservedOtherCount: existing.filter((it) => isNonFrameRackItem(it, canons)).length,
      debug: { mergeResult },
    };
  }

  const cleanedIds = new Set(
    mergeResult.items.map((it) => String(it.id || "")).filter(Boolean),
  );

  const ownedBefore = collectFrameBomOwnedItems(existing, options.moduleRackKey, options);
  const ownedIds = new Set(ownedBefore.map((it) => String(it.id || "")).filter(Boolean));

  // Also treat post-merge proven twins of new canons as owned (for DELETE list)
  const cleanedCanons = mergeResult.items.filter(
    (it) => isCanonicalFrameBomLine(it) && !isExplicitManualProjectItem(it),
  );
  for (const it of existing) {
    if (isProvenLegacyFrameBomTwin(it, cleanedCanons)) {
      ownedIds.add(String(it.id || ""));
    }
  }

  const removeItemIds = existing
    .filter((it) => {
      const id = String(it.id || "");
      if (!id || cleanedIds.has(id)) return false;
      if (isExplicitManualProjectItem(it)) return false;
      return ownedIds.has(id) || isFrameBomLine(it) || isProvenLegacyFrameBomTwin(it, cleanedCanons);
    })
    .map((it) => it.id);

  // Invariant: every non-frame id before must remain after
  const nonFrameBefore = existing.filter((it) => isNonFrameRackItem(it, canons));
  const missingNonFrame = nonFrameBefore.filter((it) => !cleanedIds.has(String(it.id || "")));
  if (missingNonFrame.length) {
    return {
      blocked: true,
      blockedReason:
        `Обновление BOM отменено: были бы удалены обычные позиции стеллажа (${missingNonFrame.length}).`,
      missingMaterialIds: [],
      warnings: mergeResult.warnings || [],
      cleanedItems: [...existing],
      removeItemIds: [],
      upsertItems: [],
      preservedItems: nonFrameBefore,
      frameBomCount: ownedBefore.filter((it) => isFrameBomLine(it)).length,
      safeDuplicateCount: ownedBefore.filter((it) => isProvenLegacyFrameBomTwin(it, canons)).length,
      preservedOtherCount: nonFrameBefore.length,
      debug: {
        mergeResult,
        invariantViolation: {
          missingNonFrameIds: missingNonFrame.map((it) => it.id).filter(Boolean),
        },
      },
    };
  }

  const existingById = new Map(existing.map((it) => [it.id, it]));
  const upsertItems = mergeResult.items.filter((it) => {
    if (!isFrameBomLine(it)) return false;
    const prev = existingById.get(it.id);
    return !prev || prev.qty !== it.qty || prev.price !== it.price || prev.supplier !== it.supplier;
  });

  const preservedItems = mergeResult.items.filter((it) => isNonFrameRackItem(it, canons));
  const safeDuplicateCount = ownedBefore.filter((it) =>
    isProvenLegacyFrameBomTwin(it, canons),
  ).length;
  const frameBomCount = ownedBefore.filter((it) => isFrameBomLine(it)).length;

  return {
    blocked: false,
    blockedReason: "",
    missingMaterialIds: [],
    cleanedItems: mergeResult.items,
    removeItemIds: [...new Set(removeItemIds)],
    upsertItems,
    preservedItems,
    frameBomCount,
    safeDuplicateCount,
    preservedOtherCount: preservedItems.length,
    warnings: mergeResult.warnings || [],
    debug: {
      removedCount: mergeResult.removedCount,
      addedCount: mergeResult.addedCount,
      keptCount: mergeResult.keptCount,
      mergeResult,
    },
  };
}

/**
 * Frame/BOM lines in rack merge scope (canonical + proven residual twins only).
 *
 * @param {object[]} items
 * @param {object} [options]
 */
export function rackFrameBomScopeItems(items, options = {}) {
  const moduleRackKey = String(options.moduleRackKey || "").trim();
  if (!moduleRackKey) return [];
  const list = items || [];
  const canons = list.filter(
    (it) => isCanonicalFrameBomLine(it) && !isExplicitManualProjectItem(it),
  );
  return list.filter((it) => {
    if (isExplicitManualProjectItem(it)) return false;
    if (!itemBelongsToRackMergeScope(it, moduleRackKey, options)) return false;
    if (isFrameBomLine(it)) return true;
    return isProvenLegacyFrameBomTwin(it, canons);
  });
}

/**
 * @param {object[]} items
 * @param {object} [options]
 */
export function hasFrameBomRowsForRack(items, options = {}) {
  return rackFrameBomScopeItems(items, options).some((it) => isFrameBomLine(it));
}

/**
 * Safe residual twins only — never treat ordinary st_*__ln_* builder lines as legacy.
 *
 * @param {object[]} items
 * @param {object} [options]
 */
export function hasLegacyFrameBomRowsForRack(items, options = {}) {
  const moduleRackKey = String(options.moduleRackKey || "").trim();
  const plan = buildResidualFrameBomTwinRepairPlan(items || [], { quiet: true });
  if (!plan.removeItemIds.length) return false;
  if (!moduleRackKey) return true;
  const removeSet = new Set(plan.removeItemIds.map(String));
  return (items || []).some(
    (it) =>
      removeSet.has(String(it.id || ""))
      && itemBelongsToRackMergeScope(it, moduleRackKey, options),
  );
}

/**
 * @param {object[]} items
 * @param {object} [options]
 */
export function hasRepairableFrameBomForRack(items, options = {}) {
  return hasLegacyFrameBomRowsForRack(items, options) || hasFrameBomRowsForRack(items, options);
}

/**
 * Dedupe-only repair when full BOM rebuild is unavailable.
 *
 * @param {object[]} existingItems
 * @param {object} [options]
 */
export function buildLegacyFrameBomDedupePlan(existingItems, options = {}) {
  const existing = Array.isArray(existingItems) ? existingItems : [];
  const canons = existing.filter(
    (it) => isCanonicalFrameBomLine(it) && !isExplicitManualProjectItem(it),
  );
  const moduleRackKey = String(options.moduleRackKey || "").trim();
  if (!moduleRackKey) {
    return {
      blocked: true,
      blockedReason: "Нет привязки к стеллажу (moduleRackKey).",
      cleanedItems: [...existing],
      removeItemIds: [],
      upsertItems: [],
      preservedItems: existing.filter((it) => isNonFrameRackItem(it, canons)),
      frameBomCount: 0,
      safeDuplicateCount: 0,
      preservedOtherCount: existing.filter((it) => isNonFrameRackItem(it, canons)).length,
      warnings: [],
      debug: { mode: "legacy_dedupe" },
    };
  }

  const inScope = rackFrameBomScopeItems(existing, options);
  const winners = dedupeFrameBomProjectItems(inScope);
  const winnerIds = new Set(winners.map((it) => String(it.id || "")).filter(Boolean));
  const removeItemIds = inScope
    .filter((it) => {
      const id = String(it.id || "");
      return id && !winnerIds.has(id);
    })
    .map((it) => it.id);

  if (!removeItemIds.length) {
    return {
      blocked: true,
      blockedReason: "Нечего обновлять — дубли BOM для этого стеллажа не найдены.",
      cleanedItems: [...existing],
      removeItemIds: [],
      upsertItems: [],
      preservedItems: existing.filter((it) => isNonFrameRackItem(it, canons)),
      frameBomCount: inScope.filter((it) => isFrameBomLine(it)).length,
      safeDuplicateCount: 0,
      preservedOtherCount: existing.filter((it) => isNonFrameRackItem(it, canons)).length,
      warnings: [],
      debug: { mode: "legacy_dedupe", inScopeCount: inScope.length },
    };
  }

  const removeSet = new Set(removeItemIds.map(String));
  const cleanedItems = existing.filter((it) => !removeSet.has(String(it.id || "")));

  return {
    blocked: false,
    blockedReason: "",
    cleanedItems,
    removeItemIds: [...new Set(removeItemIds)],
    upsertItems: [],
    preservedItems: cleanedItems.filter((it) => isNonFrameRackItem(it, canons)),
    frameBomCount: inScope.filter((it) => isFrameBomLine(it) && !removeSet.has(String(it.id || ""))).length
      + winners.filter((it) => isFrameBomLine(it)).length,
    safeDuplicateCount: removeItemIds.length,
    preservedOtherCount: cleanedItems.filter((it) => isNonFrameRackItem(it, canons)).length,
    warnings: [],
    debug: {
      mode: "legacy_dedupe",
      inScopeCount: inScope.length,
      removedCount: removeItemIds.length,
    },
  };
}

/**
 * Canonical frame_bom row (not builder-prefixed twin).
 * @param {object} item
 */
export function isCanonicalFrameBomLine(item) {
  return isFrameBomLine(item) && !isBuilderSyncedFrameBomLine(item);
}

/**
 * True when twin id is st_<rack>__it_fbom_... and a matching canonical it_fbom id exists.
 * @param {object} twin
 * @param {object[]} existing
 */
function twinPrefixedExactCanonicalId(twin, existing = []) {
  const id = String(twin?.id || "");
  const sep = id.indexOf("__");
  if (sep < 0) return "";
  const suffix = id.slice(sep + 2);
  if (!suffix.startsWith("it_fbom_")) return "";
  const hit = (existing || []).find((it) => String(it?.id || "") === suffix);
  return hit ? suffix : "";
}

/**
 * Project-wide residual twin cleanup (no purchaseDraft / moduleRackKey required).
 * Removes only proven builder twins when a canonical frame_bom row exists.
 * Does NOT touch ordinary st_*__ln_* plumbing/builder lines or manual rows.
 *
 * Patterns:
 * - A: st_<rack>__it_fbom_* + it_fbom_*
 * - B: st_<rack>__ln_* + it_fbom_* only with proven same material/section/rack cluster
 *
 * @param {object[]} existingItems
 * @param {object} [options]
 */
export function buildResidualFrameBomTwinRepairPlan(existingItems = [], options = {}) {
  const existing = Array.isArray(existingItems) ? existingItems : [];
  const canons = existing.filter(
    (it) => isCanonicalFrameBomLine(it) && !isExplicitManualProjectItem(it),
  );
  const candidates = existing.filter(
    (it) => isBuilderSyncedFrameBomLine(it) && !isExplicitManualProjectItem(it),
  );

  const removeItemIds = [];
  const duplicateGroups = [];
  const skippedAmbiguousGroups = [];

  for (const twin of candidates) {
    if (!isProvenLegacyFrameBomTwin(twin, canons)) {
      skippedAmbiguousGroups.push({
        twinId: twin.id,
        materialId: twin.materialId || "",
        reason: "no_canonical_bom_cluster",
      });
      continue;
    }
    const exactCanonId = twinPrefixedExactCanonicalId(twin, existing);
    const clusterCanons = canons.filter((c) => frameBomItemsSameDedupeCluster(c, twin));
    removeItemIds.push(twin.id);
    duplicateGroups.push({
      kind: exactCanonId ? "exact_prefixed" : "legacy_catalog",
      twinId: twin.id,
      materialId: twin.materialId || "",
      keptIds: exactCanonId
        ? [exactCanonId]
        : clusterCanons.map((c) => c.id).filter(Boolean),
    });
  }

  const removeSet = new Set(removeItemIds.map(String));
  const cleanedItems = existing.filter((it) => !removeSet.has(String(it.id || "")));

  if (!removeItemIds.length) {
    return {
      blocked: true,
      blockedReason: options.quiet
        ? ""
        : "Безопасных дублей BOM (builder twin) не найдено.",
      cleanedItems: [...existing],
      removeItemIds: [],
      keptItemIds: canons.map((c) => c.id).filter(Boolean),
      upsertItems: [],
      mergedUpdates: [],
      duplicateGroups: [],
      skippedAmbiguousGroups,
      preservedItems: existing.filter((it) => isNonFrameRackItem(it, canons)),
      warnings: [],
      debug: { mode: "residual_twins", twinCount: candidates.length },
    };
  }

  return {
    blocked: false,
    blockedReason: "",
    cleanedItems,
    removeItemIds: [...new Set(removeItemIds)],
    keptItemIds: canons.map((c) => c.id).filter(Boolean),
    upsertItems: [],
    mergedUpdates: [],
    duplicateGroups,
    skippedAmbiguousGroups,
    preservedItems: cleanedItems.filter((it) => isNonFrameRackItem(it, canons)),
    warnings: [],
    debug: {
      mode: "residual_twins",
      twinCount: candidates.length,
      removedCount: removeItemIds.length,
    },
  };
}

/**
 * Drop builder-synced twins when canonical BOM already present (write-path guard).
 * @param {object[]} items
 */
export function stripResidualFrameBomTwins(items = []) {
  const plan = buildResidualFrameBomTwinRepairPlan(items, { quiet: true });
  return plan.removeItemIds.length ? plan.cleanedItems : [...(items || [])];
}

/**
 * Count safe residual twins (for UI badge).
 * @param {object[]} items
 */
export function countResidualFrameBomTwins(items = []) {
  const plan = buildResidualFrameBomTwinRepairPlan(items, { quiet: true });
  return plan.removeItemIds.length;
}
