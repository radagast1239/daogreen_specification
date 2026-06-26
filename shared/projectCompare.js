/** Сравнение двух проектов по materialId и purchaseKey */

import { projectItemMatchKey } from "./projectItemKey.js";

const TRACK_FIELDS = [
  { key: "qty", label: "Количество", type: "number" },
  { key: "price", label: "Цена", type: "number" },
  { key: "link", label: "Ссылка", type: "string" },
  { key: "supplier", label: "Поставщик", type: "string" },
  { key: "clientSection", label: "Раздел клиента", type: "string", alt: "category" },
  { key: "clientSubsection", label: "Подраздел клиента", type: "string", alt: "subcategory" },
];

function fieldValue(it, field) {
  if (field.alt && it[field.key] == null && it[field.alt] != null) return it[field.alt];
  return it[field.key];
}

function valuesEqual(a, b, type) {
  if (type === "number") return (Number(a) || 0) === (Number(b) || 0);
  return String(a ?? "").trim() === String(b ?? "").trim();
}

function itemSummary(it) {
  return {
    id: it.id,
    name: it.name,
    module: it.module,
    materialId: it.materialId || "",
    purchaseKey: it.purchaseKey || it.purchase_key || "",
    matchKey: projectItemMatchKey(it),
  };
}

/**
 * @param baseItems — текущий проект
 * @param otherItems — прошлый проект для сравнения
 */
export function compareProjectItems(baseItems, otherItems) {
  const baseMap = new Map();
  const otherMap = new Map();

  for (const it of baseItems || []) baseMap.set(projectItemMatchKey(it), it);
  for (const it of otherItems || []) otherMap.set(projectItemMatchKey(it), it);

  const added = [];
  const removed = [];
  const changed = [];

  for (const [key, it] of baseMap) {
    if (!otherMap.has(key)) {
      added.push(itemSummary(it));
    } else {
      const prev = otherMap.get(key);
      const diffs = [];
      for (const field of TRACK_FIELDS) {
        const a = fieldValue(it, field);
        const b = fieldValue(prev, field);
        if (!valuesEqual(a, b, field.type)) {
          diffs.push({
            field: field.key,
            label: field.label,
            before: b,
            after: a,
          });
        }
      }
      if (diffs.length) {
        changed.push({
          ...itemSummary(it),
          otherId: prev.id,
          otherName: prev.name,
          diffs,
        });
      }
    }
  }

  for (const [key, it] of otherMap) {
    if (!baseMap.has(key)) removed.push(itemSummary(it));
  }

  return {
    added,
    removed,
    changed,
    counts: {
      added: added.length,
      removed: removed.length,
      changed: changed.length,
      baseTotal: baseMap.size,
      otherTotal: otherMap.size,
    },
  };
}
