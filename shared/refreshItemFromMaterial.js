import { REFRESH_FROM_MATERIAL_FIELDS } from "./itemTypes.js";

const FIELD_PATCHERS = {
  price: (mat) => ({ price: Number(mat.basePrice) || 0 }),
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
