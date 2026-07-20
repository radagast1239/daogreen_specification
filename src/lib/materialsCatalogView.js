import {
  analyzeMaterialsQuality,
  matchQualityFilter,
  materialShownToClientByDefault,
} from "../../shared/materialQualityCheck.js";

export const CATALOG_QUICK_FILTERS = [
  { id: "all", label: "Все" },
  { id: "needs_review", label: "Требуют проверки" },
  { id: "no_photo", label: "Без фото" },
  { id: "no_supplier", label: "Без поставщика" },
  { id: "hidden_client", label: "Скрыты от клиента" },
];

export const CATALOG_SORT_OPTIONS = [
  { id: "name", label: "По названию" },
  { id: "category", label: "По категории" },
  { id: "price", label: "По цене" },
];

export const CATALOG_COLUMN_PRESETS = [
  { id: "main", label: "Основное" },
  { id: "purchase", label: "Закупка" },
  { id: "client", label: "Клиент" },
  { id: "all", label: "Все поля" },
];

/** Which secondary columns to show for a frontend-only preset. */
export function catalogColumnVisibility(preset = "main") {
  switch (preset) {
    case "purchase":
      return { link: true, supplier: true, state: true };
    case "client":
      return { link: false, supplier: true, state: true };
    case "all":
      return { link: true, supplier: true, state: true };
    default:
      return { link: false, supplier: true, state: true };
  }
}

export function catalogHasActiveFilters({ q = "", category = "", quick = "all" } = {}) {
  if (String(q || "").trim()) return true;
  if (category) return true;
  if (quick && quick !== "all") return true;
  return false;
}

/**
 * Map quality report entries by material id.
 * Uses full `entries` from analyzeMaterialsQuality (all materials).
 */
export function buildQualityEntryMap(materials, modules = []) {
  const activeModuleNames = (modules || [])
    .filter((m) => m.active !== false)
    .map((m) => m.name)
    .filter(Boolean);
  const report = analyzeMaterialsQuality(materials || [], { activeModuleNames });
  const map = new Map();
  for (const entry of report.entries || []) {
    map.set(entry.material.id, entry);
  }
  return { report, entriesById: map };
}

/** Manual «На проверку» flag — category + clientSection set by bulk/row actions. */
export function materialInManualReview(material) {
  const cat = (material?.category || "").trim();
  const sec = (material?.clientSection || "").trim();
  return cat === "Требует разбора" || sec === "requires_review";
}

export function matchCatalogQuickFilter(entry, material, quickId) {
  if (!quickId || quickId === "all") return true;
  if (quickId === "hidden_client") return !materialShownToClientByDefault(material);
  if (quickId === "needs_review") {
    return materialInManualReview(material);
  }
  if (!entry) return false;
  return matchQualityFilter(entry, quickId);
}

export function filterMaterialsCatalog(
  materials,
  { q = "", category = "", quick = "all", entriesById = new Map() } = {}
) {
  const ql = String(q || "")
    .trim()
    .toLowerCase();
  return (materials || []).filter((m) => {
    if (ql && !String(m.name || "")
      .toLowerCase()
      .includes(ql)) {
      return false;
    }
    if (category && m.category !== category) return false;
    if (quick && quick !== "all") {
      const entry = entriesById.get(m.id) || { issues: [], material: m, row: m };
      if (!matchCatalogQuickFilter(entry, m, quick)) return false;
    }
    return true;
  });
}

export function sortMaterialsCatalog(list, sort = "name") {
  const arr = [...(list || [])];
  if (sort === "category") {
    return arr.sort(
      (a, b) =>
        String(a.category || "").localeCompare(String(b.category || ""), "ru") ||
        String(a.name || "").localeCompare(String(b.name || ""), "ru")
    );
  }
  if (sort === "price") {
    return arr.sort((a, b) => (Number(b.basePrice) || 0) - (Number(a.basePrice) || 0));
  }
  return arr.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ru"));
}

/**
 * Empty-state for catalog. cta: "create" | "reset" | null
 */
export function materialsEmptyMessage({ sourceCount = 0, visibleCount = 0, hasFilters = false } = {}) {
  if (sourceCount === 0) {
    return { title: "Пока нет материалов", hint: "Добавьте первую позицию в базу.", cta: "create" };
  }
  if (visibleCount === 0 && hasFilters) {
    return { title: "Материалы не найдены", hint: "Измените или сбросьте фильтры.", cta: "reset" };
  }
  return null;
}

/** Compact status chips from existing quality issues / visibility — no new status model. */
export function materialCatalogStatusChips(entry, material) {
  const chips = [];
  const issues = entry?.issues || [];
  if (issues.some((i) => i.id === "needs_review_category")) {
    chips.push({ id: "review", label: "Требует проверки", kind: "amber" });
  }
  if (issues.some((i) => i.id === "no_photo")) {
    chips.push({ id: "photo", label: "Нет фото", kind: "neutral" });
  }
  if (!materialShownToClientByDefault(material)) {
    chips.push({ id: "hidden", label: "Скрыто от клиента", kind: "neutral" });
  }
  if (issues.some((i) => i.id === "no_supplier")) {
    chips.push({ id: "supplier", label: "Нет поставщика", kind: "amber" });
  }
  if (!chips.length) {
    chips.push({ id: "ready", label: "Готово", kind: "ok" });
  }
  return chips;
}

export function materialHasPhoto(m) {
  return !!(m?.photoUrl || m?.imageUrl);
}

export function materialPriceMissing(m) {
  const n = Number(m?.basePrice);
  return !Number.isFinite(n) || n <= 0;
}
