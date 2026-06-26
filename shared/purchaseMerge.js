/** Ключи склейки строк закупки — общая логика front + back */

export function purchaseMergeKey(it) {
  const normName = (it?.name || "").trim().toLowerCase().replace(/\s+/g, " ");
  const purchaseKey = (it?.purchaseKey || it?.purchase_key || "").trim();
  if (purchaseKey) return purchaseKey;
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
