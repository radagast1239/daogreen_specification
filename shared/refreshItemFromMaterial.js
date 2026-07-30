import { REFRESH_FROM_MATERIAL_FIELDS } from "./itemTypes.js";

const FIELD_PATCHERS = {
  name: (mat) => ({ name: mat.name || "", nameOverridden: false }),
  price: (mat) => ({ price: Number(mat.basePrice) || 0, priceOverridden: false }),
  link: (mat) => ({ link: mat.link || "", linkAlt: mat.linkAlt || "" }),
  supplier: (mat) => ({ supplier: mat.supplier || "" }),
  photo: (mat) => {
    const img = mat.imageUrl || mat.photoUrl || "";
    return { imageUrl: img, photoUrl: img };
  },
  clientSection: (mat) => ({
    clientSection: mat.clientSection || "",
    clientSubsection: mat.clientSubsection || "",
  }),
};

export function resolveRefreshFields(fields) {
  if (!fields?.length || fields.includes("all")) return [...REFRESH_FROM_MATERIAL_FIELDS];
  return fields.filter((f) => REFRESH_FROM_MATERIAL_FIELDS.includes(f));
}

export function patchFromMaterial(mat, fields) {
  const patch = {};
  const allowed = new Set(REFRESH_FROM_MATERIAL_FIELDS);
  for (const f of fields) {
    if (!allowed.has(f)) continue;
    const fn = FIELD_PATCHERS[f];
    if (fn) Object.assign(patch, fn(mat));
  }
  return patch;
}

/** @param {object} item @param {object|null} material @param {string[]} fields */
export function buildRefreshPatchForItem(item, material, fields) {
  if (!item?.materialId || !material) return null;
  const matPatch = patchFromMaterial(material, resolveRefreshFields(fields));
  return Object.keys(matPatch).length ? matPatch : null;
}

function valuesEqual(key, before, after) {
  if (key === "price" || key === "qty" || key === "vatRate") {
    return (Number(before) || 0) === (Number(after) || 0);
  }
  if (key === "nameOverridden" || key === "priceOverridden" || key === "name_overridden") {
    return !!before === !!after;
  }
  return String(before ?? "") === String(after ?? "");
}

/** Compare item vs material patch; returns user-facing field keys that differ. */
export function diffRefreshPatch(item, patch) {
  const changedFields = [];
  for (const [key, value] of Object.entries(patch || {})) {
    if (key === "name_overridden") continue;
    if (key === "photoUrl" && "imageUrl" in patch) continue;
    if (key === "linkAlt" && patch.link !== undefined && valuesEqual("linkAlt", item?.linkAlt, value)) continue;
    if (key === "clientSubsection" && patch.clientSection !== undefined && valuesEqual("clientSubsection", item?.clientSubsection, value)) {
      continue;
    }
    const before = item?.[key];
    if (!valuesEqual(key, before, value)) {
      if (key === "imageUrl" || key === "photoUrl") {
        if (!changedFields.includes("photo")) changedFields.push("photo");
      } else if (key === "clientSection" || key === "clientSubsection") {
        if (!changedFields.includes("clientSection")) changedFields.push("clientSection");
      } else if (!changedFields.includes(key)) {
        changedFields.push(key);
      }
    }
  }
  return changedFields;
}

export function formatCatalogRefreshToast(changedFields = []) {
  const hasName = changedFields.includes("name") || changedFields.includes("nameOverridden");
  const hasPrice = changedFields.includes("price") || changedFields.includes("priceOverridden");
  if (hasName && hasPrice) return "Обновлены название и цена из базы";
  if (hasPrice) return "Обновлена цена из базы";
  if (hasName) return "Обновлено название из базы";
  if (changedFields.length) return "Обновлено из базы";
  return "Позиция уже соответствует базе";
}
