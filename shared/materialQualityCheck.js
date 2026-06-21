import { resolveClientSection, isSubsectionValid, getClientSectionLabel } from "./clientSections.js";
import { resolveMaterialModules } from "./materialModules.js";

export const QUALITY_CHECK_SECTIONS = [
  { id: "noClientSection", label: "Без клиентского раздела" },
  { id: "noClientSubsection", label: "Без подраздела клиента" },
  { id: "needsReviewCategory", label: "Категория «Требует разбора»" },
  { id: "archivedModules", label: "Архивные / неактивные модули" },
  { id: "urlInName", label: "URL в названии" },
  { id: "priceZero", label: "Цена 0" },
  { id: "noUnit", label: "Без единицы" },
  { id: "noSupplier", label: "Без поставщика" },
  { id: "duplicateCandidates", label: "Потенциальные дубли (название + ед.)" },
  { id: "subsectionMismatch", label: "Подраздел не соответствует разделу" },
];

function normName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/×/g, "x")
    .replace(/\s+/g, " ");
}

function hasUrlInName(name) {
  return /https?:\/\/|www\./i.test(String(name || ""));
}

function materialRow(m, activeModuleNames) {
  const mods = resolveMaterialModules(m);
  const resolved = resolveClientSection(m);
  return {
    id: m.id,
    name: m.name,
    unit: m.unit,
    category: m.category,
    basePrice: m.basePrice,
    supplier: m.supplier,
    modules: mods.join(", "),
    clientSection: resolved.section,
    clientSectionLabel: resolved.label || getClientSectionLabel(resolved.section),
    clientSubsection: m.clientSubsection || resolved.subsection || "",
    archivedModules: mods.filter((mod) => mod && !activeModuleNames.has(mod)).join(", "),
  };
}

export function analyzeMaterialsQuality(materials, { activeModuleNames = [] } = {}) {
  const activeSet = new Set(activeModuleNames);
  const activeOnly = (materials || []).filter((m) => m.status !== "archived");
  const sections = Object.fromEntries(QUALITY_CHECK_SECTIONS.map((s) => [s.id, []]));

  const byNameUnit = new Map();

  for (const m of activeOnly) {
    const row = materialRow(m, activeSet);
    const resolved = resolveClientSection(m);
    const explicitSection = (m.clientSection || "").trim();
    const section = explicitSection || resolved.section;

    if (!section || section === "requires_review") {
      sections.noClientSection.push(row);
    }

    const subsection = (m.clientSubsection || resolved.subsection || "").trim();
    if (section && section !== "requires_review" && !subsection) {
      sections.noClientSubsection.push(row);
    }

    if ((m.category || "").trim() === "Требует разбора") {
      sections.needsReviewCategory.push(row);
    }

    const archived = resolveMaterialModules(m).filter((mod) => mod && !activeSet.has(mod));
    if (archived.length) {
      sections.archivedModules.push({ ...row, archivedModules: archived.join(", ") });
    }

    if (hasUrlInName(m.name)) sections.urlInName.push(row);
    if (!Number(m.basePrice)) sections.priceZero.push(row);
    if (!(m.unit || "").trim()) sections.noUnit.push(row);
    if (!(m.supplier || "").trim()) sections.noSupplier.push(row);

    if (section && subsection && !isSubsectionValid(section, subsection)) {
      sections.subsectionMismatch.push(row);
    }

    const key = `${normName(m.name)}|${(m.unit || "").trim().toLowerCase()}`;
    if (!byNameUnit.has(key)) byNameUnit.set(key, []);
    byNameUnit.get(key).push(m);
  }

  for (const [, list] of byNameUnit) {
    if (list.length < 2) continue;
    const row = materialRow(list[0], activeSet);
    sections.duplicateCandidates.push({
      ...row,
      duplicateCount: list.length,
      duplicateIds: list.map((x) => x.id).join(", "),
      duplicateNames: list.map((x) => x.name).join(" · "),
    });
  }

  const summary = QUALITY_CHECK_SECTIONS.map(({ id, label }) => ({
    id,
    label,
    count: sections[id].length,
  }));

  return { sections, summary, totalMaterials: activeOnly.length };
}

export function qualityReportRows(report) {
  const rows = [];
  for (const { id, label } of QUALITY_CHECK_SECTIONS) {
    for (const item of report.sections[id] || []) {
      rows.push({
        Проблема: label,
        ID: item.id,
        Наименование: item.name,
        Ед: item.unit,
        Категория: item.category,
        Цена: item.basePrice,
        Поставщик: item.supplier,
        "Раздел клиента": item.clientSectionLabel || item.clientSection,
        "Подраздел клиента": item.clientSubsection,
        Модули: item.modules,
        "Архивные модули": item.archivedModules || "",
        "Кол-во дублей": item.duplicateCount || "",
        "ID дублей": item.duplicateIds || "",
      });
    }
  }
  return rows;
}

export function qualitySummaryRows(report) {
  return report.summary.map((s) => ({
    Проверка: s.label,
    "Кол-во": s.count,
  }));
}
