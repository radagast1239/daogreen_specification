/** Ключи склейки строк закупки — общая логика front + back */

import { isCoolingSpecItem } from "./itemTypes.js";

function normName(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normUnit(unit) {
  return String(unit || "").trim().toLowerCase().replace(/\.+$/, "");
}

export function purchaseMergeKey(it) {
  const preset = String(it?.purchaseMergeKey || "").trim();
  if (preset) return preset;
  const purchaseKey = (it?.purchaseKey || it?.purchase_key || "").trim();
  if (purchaseKey) return purchaseKey;
  const materialId = String(it?.materialId || it?.material_id || "").trim();
  // Спецификации сплит-систем не склеиваем между разными комнатами/типоразмерами.
  if (isCoolingSpecItem(it)) {
    const room = String(it?.roomId ?? it?.room_id ?? "").trim();
    const kw = Math.round((Number(it?.coolingKw) || 0) * 100);
    return ["cooling-spec", normName(it?.name), room, kw].join("|");
  }
  if (materialId) {
    return [
      "mat",
      materialId,
      normUnit(it?.unit),
      String(it?.supplier || "").trim(),
      String(it?.link || "").trim(),
      String(it?.linkAlt || it?.link_alt || "").trim(),
    ].join("|");
  }
  return [
    normName(it?.name),
    normUnit(it?.unit),
    String(it?.supplier || "").trim(),
    String(it?.link || "").trim(),
  ].join("|");
}

/** Группы дублей среди переданных позиций (ключ → массив позиций) */
export function findPurchaseDuplicateGroups(items) {
  const map = new Map();
  for (const it of items || []) {
    const key = purchaseMergeKey(it);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(it);
  }
  return [...map.values()].filter((g) => g.length > 1);
}
