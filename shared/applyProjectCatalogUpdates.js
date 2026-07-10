import { applyCatalogDiffToItem } from "./materialCatalogSnapshot.js";

function findMaterial(materials, materialId) {
  return (materials || []).find((m) => (m.id || m.materialId) === materialId) || null;
}

/**
 * Apply catalog updates to project items (pure).
 * @param {object[]} items
 * @param {object[]} materials
 * @param {object} [options]
 * @param {string[]} [options.itemIds] — subset; default all changed
 * @param {string[]} [options.fields] — catalog fields to update
 */
export function applyProjectCatalogUpdates(items = [], materials = [], options = {}) {
  const ids = options.itemIds?.length ? new Set(options.itemIds) : null;
  const fields = options.fields;
  const updated = [];
  const skipped = [];

  const nextItems = (items || []).map((item) => {
    if (ids && !ids.has(item.id)) return item;
    const materialId = String(item.materialId || "").trim();
    if (!materialId) {
      skipped.push({ itemId: item.id, reason: "no_material" });
      return item;
    }
    const mat = findMaterial(materials, materialId);
    if (!mat) {
      skipped.push({ itemId: item.id, reason: "material_missing" });
      return item;
    }
    const patched = applyCatalogDiffToItem(item, mat, fields);
    if (JSON.stringify(patched) !== JSON.stringify(item)) {
      updated.push({ id: item.id, before: item, after: patched });
      return patched;
    }
    skipped.push({ itemId: item.id, reason: "no_changes" });
    return item;
  });

  return { items: nextItems, updated, skipped };
}

/**
 * @param {object} item
 */
export function validateProjectItemHasMaterial(item) {
  const materialId = String(item?.materialId || "").trim();
  const itemType = item?.itemType || item?.item_type || "material";
  const nonMaterial = ["note", "video", "internal_note", "subtotal"].includes(itemType);
  if (nonMaterial) return { ok: true };
  if (!materialId && item?.name?.trim()) {
    return {
      ok: false,
      code: "MISSING_MATERIAL_ID",
      message: "Товарная позиция должна быть привязана к материалу из общей базы",
    };
  }
  return { ok: true };
}
