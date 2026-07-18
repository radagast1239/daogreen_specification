/** Ключи сопоставления позиций между проектами */

import { purchaseMergeKey } from "./purchaseMerge.js";

/**
 * Exact persistent identity for a project line.
 * Prefer immutable project_items.id; otherwise a deterministic composite.
 */
export function projectItemIdentityKey(it) {
  const id = String(it?.id || "").trim();
  if (id) return `id:${id}`;

  const rack =
    String(it?.moduleRackKey || it?.module_rack_key || "").trim() ||
    String(it?.stellageId || it?.rackId || "").trim();
  const section = String(it?.section || it?.module || "").trim();
  const subsection = String(it?.clientSubsection || it?.subcategory || "").trim();
  const source = String(it?.source || it?.sourceType || "").trim();
  const sourceKey = String(it?.sourceKey || it?.source_key || "").trim();
  const materialId = String(it?.materialId || it?.material_id || "").trim();
  const name = String(it?.name || "").trim();
  return [
    "cmp",
    rack || "-",
    section || "-",
    subsection || "-",
    source || "-",
    sourceKey || "-",
    materialId || name || "-",
  ].join("::");
}

/**
 * Semantic material match — intentionally material-centric (not row identity).
 * Prefer when comparing catalog/material equality across projects.
 */
export function projectItemMaterialMatchKey(it) {
  const materialId = (it?.materialId || it?.material_id || "").trim();
  const purchaseKey = (it?.purchaseKey || it?.purchase_key || "").trim();
  if (materialId && purchaseKey) return `mat:${materialId}|pk:${purchaseKey}`;
  if (materialId) return `mat:${materialId}`;
  return `merge:${purchaseMergeKey(it)}`;
}

/**
 * @deprecated Prefer projectItemIdentityKey (row) or projectItemMaterialMatchKey (material).
 * Kept as alias of material match for legacy callers; new code should choose explicitly.
 */
export function projectItemMatchKey(it) {
  return projectItemMaterialMatchKey(it);
}

/**
 * Row-aware compare/import key: id first, else rack/section/source/sourceKey/material.
 * Distinguishes two lines with the same materialId in different racks/sections/sources.
 */
export function projectItemCompareKey(it) {
  const id = String(it?.id || "").trim();
  if (id) return `id:${id}`;
  const rack =
    String(it?.moduleRackKey || it?.module_rack_key || "").trim() ||
    String(it?.stellageId || it?.rackId || "").trim();
  const section = String(it?.section || it?.module || "").trim();
  const subsection = String(it?.clientSubsection || it?.subcategory || "").trim();
  const source = String(it?.source || it?.sourceType || "").trim();
  const sourceKey = String(it?.sourceKey || it?.source_key || "").trim();
  const materialId = String(it?.materialId || it?.material_id || "").trim();
  const purchaseKey = String(it?.purchaseKey || it?.purchase_key || "").trim();
  const name = String(it?.name || "").trim();
  return [
    "row",
    rack || "-",
    section || "-",
    subsection || "-",
    source || "-",
    sourceKey || "-",
    materialId || name || "-",
    purchaseKey || "-",
  ].join("::");
}
