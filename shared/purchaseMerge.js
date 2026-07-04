/** Ключи склейки строк закупки — общая логика front + back */

import { isCoolingSpecItem } from "./itemTypes.js";

export function purchaseMergeKey(it) {
  const purchaseKey = (it?.purchaseKey || it?.purchase_key || "").trim();
  if (purchaseKey) return purchaseKey;
  const normName = (it?.name || "").trim().toLowerCase().replace(/\s+/g, " ");
  // Спецификации сплит-систем не склеиваем между разными комнатами/типоразмерами.
  if (isCoolingSpecItem(it)) {
    const room = String(it?.roomId ?? it?.room_id ?? "").trim();
    const kw = Math.round((Number(it?.coolingKw) || 0) * 100);
    return ["cooling-spec", normName, room, kw].join("|");
  }
  return [normName, (it?.unit || "").toLowerCase(), (it?.supplier || "").trim(), (it?.link || "").trim()].join("|");
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
