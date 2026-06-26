/** Ключ сопоставления позиций между проектами */

import { purchaseMergeKey } from "./purchaseMerge.js";

export function projectItemMatchKey(it) {
  const materialId = (it?.materialId || it?.material_id || "").trim();
  const purchaseKey = (it?.purchaseKey || it?.purchase_key || "").trim();
  if (materialId && purchaseKey) return `mat:${materialId}|pk:${purchaseKey}`;
  if (materialId) return `mat:${materialId}`;
  return `merge:${purchaseMergeKey(it)}`;
}
