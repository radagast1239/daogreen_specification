import { db, rowToMaterial } from "../db.js";
import {
  REFRESH_FROM_MATERIAL_FIELDS,
} from "../../../shared/itemTypes.js";
import {
  patchFromMaterial as sharedPatchFromMaterial,
  resolveRefreshFields as sharedResolveRefreshFields,
} from "../../../shared/refreshItemFromMaterial.js";

export function patchFromMaterial(mat, fields) {
  return sharedPatchFromMaterial(mat, fields);
}

export function getMaterialById(materialId) {
  if (!materialId) return null;
  const row = db.prepare("SELECT * FROM materials WHERE id = ?").get(materialId);
  return rowToMaterial(row);
}

export function resolveRefreshFields(fields) {
  return sharedResolveRefreshFields(fields);
}

export { REFRESH_FROM_MATERIAL_FIELDS };
