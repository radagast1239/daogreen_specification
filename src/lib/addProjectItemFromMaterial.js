/**
 * Build a full project item from a catalog material (SpecEditor «＋ позиция»).
 */

import { lineFromMaterial } from "./specLineCore.js";
import { lineToProjectItem } from "./projectBuilder.js";
import { lineVisibleToClient } from "../../shared/itemTypes.js";

/** Active materials matching free-text query (name / category / supplier / notes). */
export function filterMaterialsForSpecAdd(materials, query = "") {
  const q = String(query || "").trim().toLowerCase();
  return (materials || []).filter((m) => {
    if ((m.status || "active") !== "active") return false;
    if (!q) return true;
    const hay = [
      m.name,
      m.category,
      m.subcategory,
      m.supplier,
      m.sku,
      m.article,
      m.description,
      m.techNote,
      m.clientNote,
      m.comment,
      m.link,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

/** Same material already in this module/section. */
export function findDuplicateMaterialInModule(items, materialId, module) {
  const mid = String(materialId || "").trim();
  if (!mid) return null;
  const mod = String(module || "").trim();
  return (
    (items || []).find((it) => {
      if (String(it.materialId || "") !== mid) return false;
      if (!mod) return true;
      return it.module === mod || it.section === mod;
    }) || null
  );
}

/**
 * Full project item snapshot from material defaults.
 * qty=1, included, visibility from material (or visible if no default).
 */
export function buildProjectItemFromMaterial(mat, module, { sortOrder = 0, qty = 1 } = {}) {
  if (!mat?.id) throw new Error("material required");
  const section = String(module || "").trim() || "Прочее";
  const visibleToClient = mat.clientVisibleDefault !== false;
  const line = lineFromMaterial(mat, {
    qty,
    included: true,
    includedInProject: true,
    visibleToClient,
  });
  const item = lineToProjectItem(line, section, sortOrder);
  return {
    ...item,
    qty: qty,
    includedInProject: true,
    enabled: true,
    visibleToClient,
    visible: visibleToClient,
    approved: visibleToClient,
    // Never create as internal_note — that permanently hides from client filters.
    itemType: item.itemType || "material",
  };
}

/** Regression helpers for visibility / filters. */
export function assertManualAddClientEligible(item, material = null) {
  return (
    item?.materialId &&
    item.includedInProject !== false &&
    item.itemType !== "internal_note" &&
    lineVisibleToClient(item, material)
  );
}
