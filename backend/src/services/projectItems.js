import { normalizeItemFlags } from "../../../shared/itemTypes.js";
import {
  getMaterialById,
  patchFromMaterial,
  resolveRefreshFields,
} from "./refreshItemFromMaterial.js";

/** Поля, которые bulk-patch может менять. */
export const BULK_PATCH_ALLOWED_KEYS = new Set([
  "visibleToClient",
  "visible",
  "approved",
  "includedInProject",
  "enabled",
  "qty",
  "unit",
  "price",
  "actualPrice",
  "status",
  "purchaseStatus",
  "clientComment",
  "supplier",
  "link",
  "linkAlt",
  "imageUrl",
  "photoUrl",
  "clientSection",
  "clientSubsection",
  "responsible",
  "needsApproval",
  "category",
  "vatRate",
  "deliveryDays",
  "purchasePriority",
  "internalNote",
  "clientNote",
  "techNote",
  "roomId",
]);

/** Поля, которые bulk-patch не должен принимать. */
export const BULK_PATCH_PROTECTED_KEYS = new Set([
  "id",
  "materialId",
  "material_id",
  "source",
  "sourceType",
  "source_type",
  "sourceKey",
  "source_key",
  "sourceObjectIds",
  "source_object_ids",
  "projectId",
  "project_id",
  "createdAt",
  "created_at",
  "updatedAt",
  "updated_at",
  "pipeCuts",
  "pipe_cuts",
  "bomKey",
  "moduleRackKey",
]);

const BULK_PATCH_ALIASES = {
  quantity: "qty",
  includeInProject: "includedInProject",
  included: "includedInProject",
  url: "link",
  supplierId: "supplier",
  purchaseStatus: "status",
  needsReview: "needsApproval",
  reviewStatus: "status",
};

/** @param {object} body */
export function parseBulkPatchRequest(body = {}) {
  const itemIds = Array.isArray(body.itemIds)
    ? body.itemIds
    : Array.isArray(body.ids)
      ? body.ids
      : [];
  const patch = body.patch && typeof body.patch === "object"
    ? body.patch
    : body.updates && typeof body.updates === "object"
      ? body.updates
      : {};
  return { itemIds, patch };
}

/** @param {object} body */
export function parseRefreshRequest(body = {}) {
  const itemIds = Array.isArray(body.itemIds)
    ? body.itemIds
    : Array.isArray(body.ids)
      ? body.ids
      : body.itemId
        ? [body.itemId]
        : [];
  const fields = Array.isArray(body.fields) ? body.fields : [];
  return { itemIds, fields };
}

/** Нормализовать алиасы и синхронизировать visibility-поля. */
export function normalizeBulkPatchInput(rawPatch = {}) {
  const patch = {};
  for (const [key, value] of Object.entries(rawPatch || {})) {
    if (BULK_PATCH_PROTECTED_KEYS.has(key)) continue;
    const target = BULK_PATCH_ALIASES[key] || key;
    if (!BULK_PATCH_ALLOWED_KEYS.has(target)) continue;
    patch[target] = value;
  }

  if (patch.photo === undefined && rawPatch.photo != null) {
    const img = String(rawPatch.photo || "");
    patch.imageUrl = img;
    patch.photoUrl = img;
  }

  if (patch.visibleToClient === true) {
    patch.visible = true;
    patch.approved = true;
  } else if (patch.visibleToClient === false) {
    if (patch.visible === undefined) patch.visible = false;
    if (patch.approved === undefined) patch.approved = false;
  }

  if (patch.purchaseStatus != null && patch.status == null) {
    patch.status = patch.purchaseStatus;
  }

  if (patch.includeInProject != null && patch.includedInProject == null) {
    patch.includedInProject = patch.includeInProject;
  }

  return patch;
}

export function sanitizeBulkPatch(rawPatch = {}) {
  return normalizeBulkPatchInput(rawPatch);
}

/**
 * @param {string} projectId
 * @param {{ itemIds?: string[], patch?: object }} options
 * @param {{ loadProject: Function, patchItem: Function, touchProject?: Function }} deps
 */
export function bulkPatchItems(projectId, options = {}, deps) {
  const { loadProject, patchItem, touchProject } = deps;
  const { itemIds = [], patch: rawPatch = {} } = options;
  const patch = sanitizeBulkPatch(rawPatch);
  const p = loadProject(projectId);
  if (!p) return { ok: false, updated: [], skipped: [], before: [], patch };

  const ids = new Set(itemIds);
  const updated = [];
  const skipped = [];
  const before = [];
  const found = new Set();

  for (const it of p.items) {
    if (!ids.has(it.id)) continue;
    found.add(it.id);
    before.push({ ...it });
    updated.push(patchItem(projectId, it.id, patch));
  }

  for (const id of ids) {
    if (!found.has(id)) skipped.push({ itemId: id, reason: "not_found" });
  }

  if (updated.filter(Boolean).length && touchProject) touchProject(projectId);
  return {
    ok: true,
    updated: updated.filter(Boolean),
    skipped,
    before,
    patch,
  };
}

/**
 * @param {string} projectId
 * @param {{ itemIds?: string[], fields?: string[] }} options
 * @param {{ loadProject: Function, patchItem: Function, touchProject?: Function }} deps
 */
export function refreshItemsFromMaterial(projectId, options = {}, deps) {
  const { loadProject, patchItem, touchProject } = deps;
  const p = loadProject(projectId);
  if (!p) return { ok: false, updated: [], skipped: [] };

  const refreshFields = resolveRefreshFields(options.fields || []);
  const ids = options.itemIds?.length ? options.itemIds : p.items.map((i) => i.id);
  const updated = [];
  const skipped = [];

  for (const itemId of ids) {
    const item = p.items.find((i) => i.id === itemId);
    if (!item?.materialId) {
      skipped.push({ itemId, reason: "no_material" });
      continue;
    }
    const mat = getMaterialById(item.materialId);
    if (!mat) {
      skipped.push({ itemId, reason: "material_missing" });
      continue;
    }
    const matPatch = patchFromMaterial(mat, refreshFields);
    if (!Object.keys(matPatch).length) {
      skipped.push({ itemId, reason: "no_fields" });
      continue;
    }
    updated.push(patchItem(projectId, itemId, matPatch));
  }

  if (updated.filter(Boolean).length && touchProject) touchProject(projectId);
  return { ok: true, updated: updated.filter(Boolean), skipped };
}

/** Проверка, что refresh patch не трогает protected item-level поля. */
export function assertRefreshPatchSafe(patch) {
  const forbidden = [
    "visibleToClient",
    "visible",
    "approved",
    "includedInProject",
    "status",
    "purchaseStatus",
    "clientComment",
    "actualPrice",
    "pipeCuts",
    "sourceKey",
    "materialId",
    "id",
  ];
  for (const key of forbidden) {
    if (key in patch) {
      throw new Error(`refresh patch must not include ${key}`);
    }
  }
  return true;
}

/** Нормализовать item после patch (visibility reconcile). */
export function normalizePatchedItem(item, patch, material = null) {
  return normalizeItemFlags({ ...item, ...patch }, material);
}
