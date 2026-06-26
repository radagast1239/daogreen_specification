/** Импорт позиций из другого проекта — фильтры и preview */

import { resolveClientSection } from "./clientSections.js";
import { purchaseMergeKey, findPurchaseDuplicateGroups } from "./purchaseMerge.js";
import { projectItemMatchKey } from "./projectItemKey.js";
import { lineVisibleToClient } from "./itemTypes.js";

export const IMPORT_KIND_LABELS = {
  section: "Раздел",
  pump_room: "Насосная",
  climate: "Климат",
  electrical: "Электрика",
  selected: "Выбранные строки",
  template: "Шаблон",
};

const PUMP_SECTIONS = new Set(["pumps", "tanks", "water_prep"]);
const ELECTRIC_SECTIONS = new Set(["electrics", "lighting", "automation"]);

export function matchesImportKind(it, kind, { module, itemIds } = {}) {
  if (!it) return false;
  if (kind === "selected") {
    const ids = new Set(itemIds || []);
    return ids.has(it.id);
  }
  if (kind === "section") {
    return (it.module || "").trim() === (module || "").trim();
  }
  const { section } = resolveClientSection(it);
  const cat = (it.category || "").trim();
  if (kind === "pump_room") {
    return (
      PUMP_SECTIONS.has(section) ||
      /насос|бак|водоподгот/i.test(it.module || "") ||
      /насос|бак|водоподгот/i.test(cat)
    );
  }
  if (kind === "climate") {
    return section === "climate" || /климат|вентил/i.test(cat) || /климат|вентил/i.test(it.module || "");
  }
  if (kind === "electrical") {
    return (
      ELECTRIC_SECTIONS.has(section) ||
      /электр/i.test(cat) ||
      /электр/i.test(it.module || "")
    );
  }
  return false;
}

export function selectItemsForImport(sourceItems, { kind, module, itemIds } = {}) {
  return (sourceItems || []).filter((it) => matchesImportKind(it, kind, { module, itemIds }));
}

function indexByMatchKey(items) {
  const map = new Map();
  for (const it of items || []) {
    const key = projectItemMatchKey(it);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(it);
  }
  return map;
}

export function buildImportPreview({ sourceItems, targetItems, kind, module, itemIds, targetModule }) {
  const toImport = selectItemsForImport(sourceItems, { kind, module, itemIds });
  const targetIndex = indexByMatchKey(targetItems);
  const destModule = targetModule || module || "";

  const added = [];
  const alreadyExists = [];
  const possibleDuplicates = [];
  const willMergeInPurchase = [];

  const importGroups = findPurchaseDuplicateGroups(
    toImport.filter((it) => lineVisibleToClient(it) || it.includedInProject !== false)
  );
  const mergeKeysInImport = new Set(
    importGroups.flatMap((g) => g.map((it) => purchaseMergeKey(it)))
  );

  for (const it of toImport) {
    const matchKey = projectItemMatchKey(it);
    const existing = targetIndex.get(matchKey) || [];
    const row = {
      itemId: it.id,
      name: it.name,
      module: it.module,
      qty: it.qty,
      price: it.price,
      matchKey,
      targetModule: destModule || it.module,
    };

    if (existing.length) {
      alreadyExists.push({ ...row, existing: existing.map((e) => ({ id: e.id, name: e.name, module: e.module })) });
    } else {
      added.push(row);
    }

    if (mergeKeysInImport.has(purchaseMergeKey(it))) {
      willMergeInPurchase.push(row);
    }
  }

  for (const group of importGroups) {
    if (group.length > 1) {
      possibleDuplicates.push({
        mergeKey: purchaseMergeKey(group[0]),
        items: group.map((it) => ({ id: it.id, name: it.name, module: it.module, qty: it.qty })),
      });
    }
  }

  return {
    kind,
    kindLabel: IMPORT_KIND_LABELS[kind] || kind,
    module: module || "",
    targetModule: destModule,
    counts: {
      toImport: toImport.length,
      added: added.length,
      alreadyExists: alreadyExists.length,
      possibleDuplicates: possibleDuplicates.length,
      willMergeInPurchase: willMergeInPurchase.length,
    },
    toImport,
    added,
    alreadyExists,
    possibleDuplicates,
    willMergeInPurchase,
  };
}
