import { FRAME_BOM_MATERIALS } from "./frameBomMaterialMap.js";
import { normalizePipeCuts, pipeCutsClientNote } from "./profilePipeCuts.js";

export const FRAME_BOM_SOURCE = "frame_bom";
export const FRAME_BOM_ADMIN_SOURCE_LABEL = "Из схемы стеллажа";

export function isFrameBomLine(item) {
  return (item?.source || item?.sourceType || item?.source_type) === FRAME_BOM_SOURCE;
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
 * True when item is frame_bom belonging to the given rack scope (moduleRackKey).
 * drawingId is NOT part of the match — same rack replaces all prior BOM versions.
 *
 * @param {object} item
 * @param {string} moduleRackKey
 */
export function isFrameBomItemForRack(item, moduleRackKey) {
  const rack = String(moduleRackKey || "").trim();
  if (!rack) return false;
  if (!isFrameBomLine(item)) return false;

  const itemRack = resolveFrameBomItemModuleRackKey(item);
  if (itemRack && itemRack === rack) return true;

  const sk = item?.sourceKey || item?.source_key || "";
  if (sourceKeyMatchesModuleRack(sk, rack)) return true;

  const obj = parseSourceObjectIds(item?.sourceObjectIds ?? item?.source_object_ids);
  const stellageId = String(obj.stellageId || obj.stellage_id || "").trim();
  if (stellageId && rack === `stellage:${stellageId}`) return true;

  return false;
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
    sourceObjectIds: {
      frameDrawingId: options.drawingId || "",
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

  const kept = existing.filter((it) => !isFrameBomItemForRack(it, moduleRackKey));
  const removedCount = existing.length - kept.length;

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

    added.push(frameBomDraftToProjectItem(enrichedLine, options, sourceRackPrefix, sortOrder));
    sortOrder += 1;
  }

  return {
    items: [...kept, ...added],
    removedCount,
    addedCount: added.length,
    keptCount: kept.length,
    sourceRackPrefix,
    rackScopeKey: moduleRackKey,
    warnings,
    blocked: false,
    missingMaterialIds: [],
  };
}

/**
 * Frame BOM lines already merged into a saved project for one rack.
 *
 * @param {object[]} items
 * @param {string} moduleRackKey
 */
export function frameBomItemsForModuleRack(items, moduleRackKey) {
  const rackKey = String(moduleRackKey || "").trim();
  if (!rackKey) return [];
  return (items || []).filter((it) => isFrameBomItemForRack(it, rackKey));
}
