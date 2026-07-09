import { buildRefreshPatchForItem } from "../../shared/refreshItemFromMaterial.js";
import {
  applyClientVisibilityPatch,
  buildClientVisibilityPatch,
  reconcileItemClientVisibilityFlags,
} from "../../shared/itemTypes.js";

function normalizeVisibilityPatch(patch = {}) {
  if (patch.visibleToClient == null) return patch;
  return { ...buildClientVisibilityPatch(patch.visibleToClient), ...patch };
}

async function patchItemSequential(request, projectId, { itemIds = [], patch = {} } = {}) {
  const normalizedPatch = normalizeVisibilityPatch(patch);
  const updated = [];
  const skipped = [];
  for (const itemId of itemIds) {
    try {
      const item = await request(
        `/api/projects/${projectId}/items/${encodeURIComponent(itemId)}`,
        { method: "PATCH", body: normalizedPatch }
      );
      updated.push(applyClientVisibilityPatch({ ...item, ...normalizedPatch }, normalizedPatch));
    } catch (e) {
      if (e?.status === 404) {
        skipped.push({ itemId, reason: "not_found" });
        continue;
      }
      throw e;
    }
  }
  return { updated, skipped, before: [], patch, fallback: true };
}

export async function bulkPatchItemsWithFallback(request, projectId, body = {}) {
  const normalizedBody = {
    ...body,
    patch: normalizeVisibilityPatch(body.patch || {}),
  };
  try {
    return await request(`/api/projects/${projectId}/items/bulk-patch`, {
      method: "POST",
      body: normalizedBody,
    });
  } catch (e) {
    if (e?.status !== 404) throw e;
    return patchItemSequential(request, projectId, normalizedBody);
  }
}

export async function refreshItemsFromMaterialWithFallback(
  request,
  projectId,
  { itemIds = [], fields = [] } = {},
  { items = [], materials = [] } = {}
) {
  try {
    return await request(`/api/projects/${projectId}/items/refresh-from-material`, {
      method: "POST",
      body: { itemIds, fields },
    });
  } catch (e) {
    if (e?.status !== 404) throw e;
  }

  const materialById = new Map((materials || []).map((m) => [m.id, m]));
  const itemById = new Map((items || []).map((it) => [it.id, it]));
  const updated = [];
  const skipped = [];

  for (const itemId of itemIds) {
    const item = itemById.get(itemId);
    const material = item?.materialId ? materialById.get(item.materialId) : null;
    const patch = buildRefreshPatchForItem(item, material, fields);
    if (!patch) {
      skipped.push({
        itemId,
        reason: !item?.materialId ? "no_material" : !material ? "material_missing" : "no_fields",
      });
      continue;
    }
    const row = await request(`/api/projects/${projectId}/items/${encodeURIComponent(itemId)}`, {
      method: "PATCH",
      body: patch,
    });
    updated.push(reconcileItemClientVisibilityFlags(row));
  }

  return { updated, skipped, fallback: true };
}
