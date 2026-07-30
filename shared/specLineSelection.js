/** Canonical selection id for spec table rows — must match checkbox keys in SpecTab. */

export function getSpecLineSelectionId(item) {
  if (!item) return null;
  const id = item.id;
  if (id == null || id === "") return null;
  return String(id);
}

/** @param {object[]} items project items
 *  @param {string[]} ids selection ids from checklist/panel */
export function buildModuleSelectionFromIds(items, ids) {
  const idSet = new Set((ids || []).map((id) => String(id)).filter(Boolean));
  const byModule = {};
  for (const it of items || []) {
    const selId = getSpecLineSelectionId(it);
    if (!selId || !idSet.has(selId)) continue;
    const module = it.module ?? "";
    if (!byModule[module]) byModule[module] = new Set();
    byModule[module].add(selId);
  }
  return byModule;
}

export function normalizeSpecSelectionIds(ids) {
  return [...new Set((ids || []).map((id) => String(id)).filter(Boolean))];
}
