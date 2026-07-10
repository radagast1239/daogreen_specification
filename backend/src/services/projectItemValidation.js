import { resolveItemType } from "../../../shared/itemTypes.js";
import { getMaterial } from "../routes/materials.js";

const PURCHASABLE_TYPES = new Set(["material", "service", "kit"]);

/**
 * Validate project items before save (new writes).
 * Legacy rows without materialId are allowed when allowLegacyMissingMaterialId=true.
 *
 * @throws Error with code ITEM_VALIDATION
 */
export function validateProjectItemsForSave(items = [], options = {}) {
  const { allowLegacyMissingMaterialId = true } = options;
  const errors = [];

  for (let i = 0; i < (items || []).length; i++) {
    const it = items[i];
    const itemType = resolveItemType(it);
    const materialId = String(it?.materialId || it?.material_id || "").trim();
    const label = it?.name || it?.id || `#${i + 1}`;

    if (!PURCHASABLE_TYPES.has(itemType)) continue;

    if (!materialId) {
      if (allowLegacyMissingMaterialId) continue;
      errors.push(`Позиция «${label}»: для типа ${itemType} требуется materialId`);
      continue;
    }

    const mat = getMaterial(materialId);
    if (!mat) {
      errors.push(`Позиция «${label}»: материал ${materialId} не найден в базе`);
    }
  }

  if (errors.length) {
    const err = new Error(errors.join("; "));
    err.code = "ITEM_VALIDATION";
    err.details = errors;
    throw err;
  }
}

export function validateSingleProjectItem(item, options = {}) {
  validateProjectItemsForSave([item], {
    allowLegacyMissingMaterialId: options.allowLegacyMissingMaterialId ?? false,
  });
}
