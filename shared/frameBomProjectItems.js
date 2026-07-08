import { FRAME_BOM_MATERIALS } from "./frameBomMaterialMap.js";
import { normalizePipeCuts, pipeCutsClientNote } from "./profilePipeCuts.js";

export const FRAME_BOM_SOURCE = "frame_bom";

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
 * @param {object} item
 * @param {string} rackPrefix
 */
export function isFrameBomItemForRack(item, rackPrefix) {
  if (!rackPrefix) return false;
  const source = item?.source || item?.source_type;
  if (source !== FRAME_BOM_SOURCE) return false;
  const key = String(item?.sourceKey || item?.source_key || "");
  return key === rackPrefix || key.startsWith(`${rackPrefix}:`);
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
  const clientNote = pipeCuts.length ? pipeCutsClientNote(pipeCuts) || techNote : techNote;
  const section = String(options.rackLabel || options.moduleRackKey || "").trim();
  const included = options.included !== false;
  const visibleToClient = options.visibleToClient !== false;

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
    category: "Каркас и крепёж",
    pipeCuts,
    techNote,
    clientNote,
    comment: clientNote,
    source: FRAME_BOM_SOURCE,
    sourceType: FRAME_BOM_SOURCE,
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
    itemType: "material",
    itemRole: "purchase",
    status: "not_bought",
    sortOrder,
    price: 0,
    vatRate: 0,
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
 * }} options
 */
export function mergeFrameBomIntoProjectItems(existingItems, purchaseDraft, options = {}) {
  const warnings = [];
  const existing = Array.isArray(existingItems) ? existingItems : [];
  const draft = Array.isArray(purchaseDraft) ? purchaseDraft : [];

  const { prefix: sourceRackPrefix, warnings: prefixWarnings } = buildFrameBomSourceRackPrefix(options);
  warnings.push(...prefixWarnings);

  if (!String(options.moduleRackKey || "").trim()) {
    warnings.push("moduleRackKey is required for frame BOM merge");
    return {
      items: [...existing],
      removedCount: 0,
      addedCount: 0,
      keptCount: existing.length,
      sourceRackPrefix,
      warnings,
    };
  }

  const kept = existing.filter((it) => !isFrameBomItemForRack(it, sourceRackPrefix));
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

    added.push(frameBomDraftToProjectItem(line, options, sourceRackPrefix, sortOrder));
    sortOrder += 1;
  }

  return {
    items: [...kept, ...added],
    removedCount,
    addedCount: added.length,
    keptCount: kept.length,
    sourceRackPrefix,
    warnings,
  };
}
