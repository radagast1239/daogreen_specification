/** Группы состава стеллажа — узкая настройка при создании проекта */

export const STELLAGE_GROUPS = [
  { id: "karkas", label: "Каркас и крепёж", order: 1 },
  { id: "poliv", label: "Полив стеллажа", order: 2 },
  { id: "drenazh", label: "Дренаж на стеллаже", order: 3 },
  { id: "klimat", label: "Вентиляция", order: 4 },
  { id: "osveshchenie", label: "Освещение", order: 5 },
  { id: "elektrika", label: "Электрика стеллажа", order: 6 },
  { id: "emkosti", label: "Ёмкости и баки", order: 7 },
  { id: "opcii", label: "Опции (не в базовый состав)", order: 8 },
];

const GROUP_BY_ID = Object.fromEntries(STELLAGE_GROUPS.map((g) => [g.id, g]));

export function groupLabel(id) {
  return GROUP_BY_ID[id]?.label || id;
}

export function isStellageModule(mod) {
  return mod?.type === "stellage";
}

export function isStellageModuleName(moduleName) {
  return (
    moduleName?.startsWith("Стеллаж") ||
    moduleName?.includes("Рассадное")
  );
}

/** Авто-группа по названию и категории (для сида и миграции) */
export function inferCompositionGroup(mat) {
  const n = (mat.name || "").toLowerCase();
  const cat = mat.category || "";
  const qty = Number(mat.defaultQty ?? mat.default_qty) || 0;

  if (qty === 0) return "opcii";

  if (
    cat === "Каркас и крепёж" ||
    n.includes("труба профильная") ||
    n.includes("краб") ||
    n.includes("окраска профильной") ||
    (n.includes("болт") && n.includes("м6")) ||
    n.includes("гайка м6") ||
    n.includes("гровер") ||
    n.includes("саморез пресшайба")
  ) {
    return "karkas";
  }

  if (
    cat === "Климат и вентиляция" ||
    n.includes("воздуховод") ||
    (n.includes("колено") && n.includes("110"))
  ) {
    return "klimat";
  }

  if (n.includes("светильник") || (n.includes("таймер") && !n.includes("насос"))) {
    return "osveshchenie";
  }

  if (cat === "Электрика и свет") return "elektrika";

  if (n.includes("бак ") || n.includes("бак пластик") || n.includes("ёмкость") || n.includes("емкость")) {
    return "emkosti";
  }

  if (
    n.includes("канализац") ||
    n.includes("дренаж") ||
    (n.includes("110") &&
      (n.includes("труба") || n.includes("муфта") || n.includes("тройн") || n.includes("заглушка")))
  ) {
    return "drenazh";
  }

  if (cat === "Полив и сантехника") return "poliv";

  return "poliv";
}

export function materialCompositionGroup(mat) {
  if (mat.subcategory) return mat.subcategory;
  if (!isStellageModuleName(mat.module)) return "";
  return inferCompositionGroup(mat);
}

/** Группы по умолчанию — без опций с qty=0 */
export function defaultStellageGroups(groupDefs = STELLAGE_GROUPS) {
  return groupDefs.filter((g) => g.id !== "opcii").map((g) => g.id);
}

export function groupsForModule(materials, modName, groupDefs = STELLAGE_GROUPS) {
  const ids = new Set();
  for (const m of materials) {
    if (m.module !== modName) continue;
    const g = materialCompositionGroup(m);
    if (g) ids.add(g);
  }
  return groupDefs.filter((g) => ids.has(g.id));
}

export function materialsByGroup(materials, modName, groupDefs = STELLAGE_GROUPS) {
  const map = new Map();
  for (const g of groupDefs) map.set(g.id, []);
  for (const m of materials) {
    if (m.module !== modName || m.status === "archived") continue;
    const g = materialCompositionGroup(m);
    if (!g) continue;
    if (!map.has(g)) map.set(g, []);
    map.get(g).push(m);
  }
  return map;
}

export function normalizeModuleSelection(sel) {
  if (sel == null) return null;
  if (typeof sel === "number") {
    return { count: Math.max(1, sel), groups: defaultStellageGroups(), excludedMaterialIds: [] };
  }
  return {
    count: Math.max(1, Number(sel.count) || 1),
    groups: sel.groups?.length ? sel.groups : defaultStellageGroups(),
    excludedMaterialIds: sel.excludedMaterialIds || sel.excludedIds || [],
  };
}

export function materialIncludedInSelection(mat, sel) {
  const norm = normalizeModuleSelection(sel);
  if (!norm) return true;
  const g = materialCompositionGroup(mat);
  if (g && norm.groups.length && !norm.groups.includes(g)) return false;
  if (norm.excludedMaterialIds.includes(mat.id)) return false;
  return true;
}

export function selectionToApi(moduleId, sel) {
  const norm = normalizeModuleSelection(sel);
  return {
    moduleId,
    count: norm.count,
    groups: norm.groups,
    excludedMaterialIds: norm.excludedMaterialIds,
  };
}
