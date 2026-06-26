import { db, rowToMaterial } from "../db.js";
import { REFRESH_FROM_MATERIAL_FIELDS } from "../../../shared/itemTypes.js";

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

export function getMaterialById(materialId) {
  if (!materialId) return null;
  const row = db.prepare("SELECT * FROM materials WHERE id = ?").get(materialId);
  return rowToMaterial(row);
}

export function resolveRefreshFields(fields) {
  if (!fields?.length || fields.includes("all")) return [...REFRESH_FROM_MATERIAL_FIELDS];
  return fields.filter((f) => REFRESH_FROM_MATERIAL_FIELDS.includes(f));
}
