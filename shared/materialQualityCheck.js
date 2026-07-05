import { resolveClientSection, isSubsectionValid, getClientSectionLabel } from "./clientSections.js";
import { resolveMaterialModules } from "./materialModules.js";
import { isCoolingSpecItem } from "./itemTypes.js";
import { structuredClientNote } from "./structuredClientNote.js";
import { isProfilePipeName, resolvePipeCuts } from "./profilePipeCuts.js";
import { isRatedAmpsName, resolveBreakerSpecs } from "./breakerSpecs.js";
import { isFlowSpecName, resolveFlowSpecs } from "./flowSpecs.js";
import { isSplitSystemName, resolveSplitSpecs } from "./splitSpecs.js";

export const MAX_MATERIAL_NAME_LENGTH = 100;

/** @typedef {"critical"|"warning"|"info"} IssueSeverity */

/** @type {Record<string, { severity: IssueSeverity, label: string, hint: string, filter?: string }>} */
export const MATERIAL_ISSUE_DEFS = {
  no_photo: {
    severity: "warning",
    label: "Нет фото",
    hint: "Добавьте фото, чтобы клиент понимал, что покупать.",
    filter: "no_photo",
  },
  no_link: {
    severity: "warning",
    label: "Нет ссылки",
    hint: "Ссылка не указана. Это нормально, если товар закупается офлайн или ссылка не передаётся клиенту.",
    filter: "no_link",
  },
  no_supplier: {
    severity: "critical",
    label: "Нет поставщика",
    hint: "Укажите поставщика — иначе закупка будет неясной.",
    filter: "no_supplier",
  },
  no_price: {
    severity: "critical",
    label: "Нет цены или цена 0",
    hint: "Укажите цену — в спецификации будет 0 ₽.",
    filter: "no_price",
  },
  no_unit: {
    severity: "critical",
    label: "Нет единицы измерения",
    hint: "Укажите единицу (шт., м, кг и т.д.).",
    filter: "no_unit",
  },
  no_client_section: {
    severity: "critical",
    label: "Нет раздела клиента",
    hint: "Позиция может попасть не туда в PDF/Excel.",
    filter: "no_client_section",
  },
  no_client_subsection: {
    severity: "critical",
    label: "Нет подраздела клиента",
    hint: "Укажите подраздел — иначе позиция окажется в общем списке раздела.",
    filter: "no_client_section",
  },
  no_responsible: {
    severity: "info",
    label: "Не указан ответственный",
    hint: "Выберите роль — так проще распределить закупку.",
    filter: "no_responsible",
  },
  general_responsible: {
    severity: "info",
    label: "Общее / не назначено явно",
    hint: "Роль «Общий» — нормальный сброс. При необходимости назначьте сантехника, электрика и т.д.",
    filter: "general_responsible",
  },
  no_client_note: {
    severity: "warning",
    label: "Нет пояснения для клиента",
    hint: "Добавьте короткое пояснение — клиенту будет понятнее, что покупать.",
  },
  long_name: {
    severity: "warning",
    label: "Слишком длинное название",
    hint: "Сократите название — длинные строки плохо читаются в PDF/Excel.",
  },
  url_in_name: {
    severity: "warning",
    label: "В названии есть ссылка",
    hint: "Вынесите ссылку в поле «Ссылка», а в названии оставьте короткое имя.",
  },
  junk_in_name: {
    severity: "warning",
    label: "В названии есть артикул или мусор",
    hint: "Проверьте название — артикул лучше хранить отдельно, тестовые имена удалите.",
  },
  duplicate_name_unit: {
    severity: "warning",
    label: "Возможный дубль (название + ед.)",
    hint: "Проверьте, не повторяется ли материал.",
    filter: "duplicates",
  },
  duplicate_purchase_key: {
    severity: "warning",
    label: "Возможный дубль (purchaseKey)",
    hint: "Проверьте, не повторяется ли материал с тем же purchaseKey.",
    filter: "duplicates",
  },
  not_client_ready: {
    severity: "critical",
    label: "Показывается клиенту, но не готов",
    hint: "Исправьте критичные поля — материал попадёт в клиентскую спецификацию.",
    filter: "critical",
  },
  no_alt_link: {
    severity: "info",
    label: "Нет альтернативной ссылки",
    hint: "Добавьте запасную ссылку на случай, если основная перестанет работать.",
  },
  needs_review_category: {
    severity: "warning",
    label: "Категория «Требует разбора»",
    hint: "Разберите материал и укажите нормальную категорию и клиентский раздел.",
  },
  archived_modules: {
    severity: "warning",
    label: "Архивные / неактивные модули",
    hint: "Материал привязан к неактивному модулю — проверьте актуальность.",
  },
  subsection_mismatch: {
    severity: "critical",
    label: "Подраздел не соответствует разделу",
    hint: "Выберите подраздел из списка для выбранного клиентского раздела.",
  },
};

/** Быстрые фильтры для UI */
export const QUALITY_QUICK_FILTERS = [
  { id: "all", label: "Все проблемы" },
  { id: "critical", label: "Критичные" },
  { id: "no_photo", label: "Без фото" },
  { id: "no_link", label: "Без ссылки" },
  { id: "no_supplier", label: "Без поставщика" },
  { id: "no_price", label: "Без цены" },
  { id: "no_client_section", label: "Без раздела клиента" },
  { id: "general_responsible", label: "Общее / не назначено явно" },
  { id: "duplicates", label: "Возможные дубли" },
];

/** Legacy-список секций для экспорта и совместимости */
export const QUALITY_CHECK_SECTIONS = [
  { id: "noPhoto", label: "Без фото", warning: true, issueId: "no_photo" },
  { id: "noLink", label: "Без ссылки", warning: true, issueId: "no_link" },
  { id: "noClientSection", label: "Без клиентского раздела", issueId: "no_client_section" },
  { id: "noClientSubsection", label: "Без подраздела клиента", issueId: "no_client_subsection" },
  { id: "needsReviewCategory", label: "Категория «Требует разбора»", warning: true, issueId: "needs_review_category" },
  { id: "archivedModules", label: "Архивные / неактивные модули", warning: true, issueId: "archived_modules" },
  { id: "urlInName", label: "URL в названии", warning: true, issueId: "url_in_name" },
  { id: "junkInName", label: "Артикул / мусор в названии", warning: true, issueId: "junk_in_name" },
  { id: "longName", label: "Слишком длинное название", warning: true, issueId: "long_name" },
  { id: "priceZero", label: "Цена 0", issueId: "no_price" },
  { id: "noUnit", label: "Без единицы", issueId: "no_unit" },
  { id: "noSupplier", label: "Без поставщика", issueId: "no_supplier" },
  { id: "noResponsible", label: "Не указан ответственный", info: true, issueId: "no_responsible" },
  { id: "generalResponsible", label: "Общее / не назначено явно", info: true, issueId: "general_responsible" },
  { id: "noClientNote", label: "Без пояснения для клиента", warning: true, issueId: "no_client_note" },
  { id: "noAltLink", label: "Без альтернативной ссылки", info: true, issueId: "no_alt_link" },
  { id: "duplicateCandidates", label: "Потенциальные дубли (название + ед.)", warning: true, issueId: "duplicate_name_unit" },
  { id: "duplicatePurchaseKey", label: "Потенциальные дубли (purchaseKey)", warning: true, issueId: "duplicate_purchase_key" },
  { id: "notClientReady", label: "Показывается клиенту, но не готов", issueId: "not_client_ready" },
  { id: "subsectionMismatch", label: "Подраздел не соответствует разделу", issueId: "subsection_mismatch" },
];

const JUNK_NAME_RE =
  /арт\.?\s*[:#]?\s*[\w-]+|sku\s*[:#]?\s*[\w-]+|тест|test|xxx|удал|чернов|temp\b|tmp\b|asdf|12345|мусор|old_/i;

function normName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/×/g, "x")
    .replace(/\s+/g, " ");
}

function normPurchaseKey(key) {
  return String(key || "")
    .trim()
    .toLowerCase();
}

function hasUrlInName(name) {
  return /https?:\/\/|www\./i.test(String(name || ""));
}

function hasJunkInName(name) {
  const s = String(name || "").trim();
  if (!s) return false;
  if (hasUrlInName(s)) return false;
  return JUNK_NAME_RE.test(s);
}

function hasPhoto(m) {
  return !!(m.photoUrl || m.imageUrl);
}

/** empty | general | assigned */
export function resolveMaterialResponsibleState(m) {
  const raw = m?.responsible;
  if (raw == null || String(raw).trim() === "") return "empty";
  const r = String(raw).trim().toLowerCase();
  if (r === "none") return "empty";
  if (r === "general") return "general";
  return "assigned";
}

/** Сплит-системы и авто-спеки: цена может уточняться */
export function isPriceOptionalMaterial(m) {
  if (isCoolingSpecItem(m)) return true;
  const name = m?.name || "";
  if (isProfilePipeName(name) && resolvePipeCuts(m).length) return true;
  if (isRatedAmpsName(name) && resolveBreakerSpecs(m).length) return true;
  if (isFlowSpecName(name) && resolveFlowSpecs(m).length) return true;
  if (isSplitSystemName(name) && resolveSplitSpecs(m).length) return true;
  return false;
}

export function materialShownToClientByDefault(m) {
  if (m.status === "archived") return false;
  if (m.clientVisibleDefault === false) return false;
  return true;
}

export function issueDef(issueId) {
  return MATERIAL_ISSUE_DEFS[issueId] || { severity: "warning", label: issueId, hint: "" };
}

export function makeIssue(issueId, extra = {}) {
  const def = issueDef(issueId);
  return {
    id: issueId,
    severity: def.severity,
    label: def.label,
    hint: def.hint,
    ...extra,
  };
}

export function materialRow(m, activeModuleNames) {
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
    purchaseKey: m.purchaseKey || "",
  };
}

/** Базовые проверки одного материала (без дублей между материалами) */
export function collectBaseMaterialIssues(m, activeSet) {
  const issues = [];
  const resolved = resolveClientSection(m);
  const explicitSection = (m.clientSection || "").trim();
  const section = explicitSection || resolved.section;
  const subsection = (m.clientSubsection || resolved.subsection || "").trim();

  if (!section || section === "requires_review") {
    issues.push(makeIssue("no_client_section"));
  }

  if (section && section !== "requires_review" && !subsection) {
    issues.push(makeIssue("no_client_subsection"));
  }

  if ((m.category || "").trim() === "Требует разбора") {
    issues.push(makeIssue("needs_review_category"));
  }

  const archived = resolveMaterialModules(m).filter((mod) => mod && !activeSet.has(mod));
  if (archived.length) {
    issues.push(makeIssue("archived_modules", { archivedModules: archived.join(", ") }));
  }

  if (hasUrlInName(m.name)) issues.push(makeIssue("url_in_name"));
  if (hasJunkInName(m.name)) issues.push(makeIssue("junk_in_name"));
  if ((m.name || "").trim().length > MAX_MATERIAL_NAME_LENGTH) issues.push(makeIssue("long_name"));

  if (!isPriceOptionalMaterial(m) && !Number(m.basePrice)) {
    issues.push(makeIssue("no_price"));
  }

  if (!(m.unit || "").trim()) issues.push(makeIssue("no_unit"));
  if (!(m.supplier || "").trim()) issues.push(makeIssue("no_supplier"));
  if (!hasPhoto(m)) issues.push(makeIssue("no_photo"));
  if (!(m.link || "").trim()) issues.push(makeIssue("no_link"));

  const responsibleState = resolveMaterialResponsibleState(m);
  if (responsibleState === "empty") issues.push(makeIssue("no_responsible"));
  else if (responsibleState === "general") issues.push(makeIssue("general_responsible"));

  const note = structuredClientNote(m);
  if (!(note || "").trim()) issues.push(makeIssue("no_client_note"));

  if ((m.link || "").trim() && !(m.linkAlt || "").trim()) {
    issues.push(makeIssue("no_alt_link"));
  }

  if (section && subsection && !isSubsectionValid(section, subsection)) {
    issues.push(makeIssue("subsection_mismatch"));
  }

  return issues;
}

function hasCriticalSeverity(issues) {
  return issues.some((i) => i.severity === "critical");
}

/** Критичные проблемы, блокирующие клиентскую выдачу (no_link — только рекомендация) */
function issuesBlockingClientReady(issues) {
  return issues.filter(
    (i) => i.id !== "not_client_ready" && i.id !== "no_link" && i.severity === "critical"
  );
}

function pushSectionRow(sections, sectionId, row) {
  if (!sections[sectionId]) sections[sectionId] = [];
  sections[sectionId].push(row);
}

function rowFromEntry(entry, extra = {}) {
  return { ...entry.row, ...extra };
}

export function analyzeMaterialsQuality(materials, { activeModuleNames = [] } = {}) {
  const activeSet = new Set(activeModuleNames);
  const activeOnly = (materials || []).filter((m) => m.status !== "archived");
  const sections = Object.fromEntries(QUALITY_CHECK_SECTIONS.map((s) => [s.id, []]));
  const byNameUnit = new Map();
  const byPurchaseKey = new Map();

  const entries = [];

  for (const m of activeOnly) {
    const row = materialRow(m, activeSet);
    const issues = collectBaseMaterialIssues(m, activeSet);

    const nameUnitKey = `${normName(m.name)}|${(m.unit || "").trim().toLowerCase()}`;
    if (!byNameUnit.has(nameUnitKey)) byNameUnit.set(nameUnitKey, []);
    byNameUnit.get(nameUnitKey).push(m);

    const pk = normPurchaseKey(m.purchaseKey);
    if (pk) {
      if (!byPurchaseKey.has(pk)) byPurchaseKey.set(pk, []);
      byPurchaseKey.get(pk).push(m);
    }

    entries.push({ material: m, row, issues });
  }

  for (const [, list] of byNameUnit) {
    if (list.length < 2) continue;
    const dupIds = list.map((x) => x.id);
    for (const entry of entries) {
      if (!dupIds.includes(entry.material.id)) continue;
      entry.issues.push(
        makeIssue("duplicate_name_unit", {
          duplicateCount: list.length,
          duplicateIds: dupIds.join(", "),
        })
      );
    }
  }

  for (const [, list] of byPurchaseKey) {
    if (list.length < 2) continue;
    const dupIds = list.map((x) => x.id);
    for (const entry of entries) {
      if (!dupIds.includes(entry.material.id)) continue;
      entry.issues.push(
        makeIssue("duplicate_purchase_key", {
          duplicateCount: list.length,
          duplicateIds: dupIds.join(", "),
          purchaseKey: entry.material.purchaseKey || "",
        })
      );
    }
  }

  let readyCount = 0;
  let criticalMaterials = 0;
  let warningMaterials = 0;
  let infoMaterials = 0;
  let criticalIssueCount = 0;
  let warningIssueCount = 0;
  let infoIssueCount = 0;

  for (const entry of entries) {
    const baseCritical = issuesBlockingClientReady(entry.issues).length > 0;

    if (materialShownToClientByDefault(entry.material) && baseCritical) {
      entry.issues.push(makeIssue("not_client_ready"));
    }

    const sevSet = new Set(entry.issues.map((i) => i.severity));
    if (issuesBlockingClientReady(entry.issues).length === 0) readyCount += 1;
    if (sevSet.has("critical")) criticalMaterials += 1;
    if (sevSet.has("warning")) warningMaterials += 1;
    if (sevSet.has("info")) infoMaterials += 1;

    for (const issue of entry.issues) {
      if (issue.severity === "critical") criticalIssueCount += 1;
      else if (issue.severity === "warning") warningIssueCount += 1;
      else infoIssueCount += 1;

      const sec = QUALITY_CHECK_SECTIONS.find((s) => s.issueId === issue.id);
      if (!sec) continue;
      const extra =
        issue.id === "duplicate_name_unit" || issue.id === "duplicate_purchase_key"
          ? {
              duplicateCount: issue.duplicateCount,
              duplicateIds: issue.duplicateIds,
              purchaseKey: issue.purchaseKey || entry.row.purchaseKey,
            }
          : issue.id === "archived_modules"
            ? { archivedModules: issue.archivedModules }
            : {};
      pushSectionRow(sections, sec.id, rowFromEntry(entry, extra));
    }
  }

  const summary = QUALITY_CHECK_SECTIONS.map(({ id, label }) => ({
    id,
    label,
    count: sections[id].length,
  }));

  const problematicEntries = entries.filter((e) => e.issues.length > 0);

  return {
    sections,
    summary,
    totalMaterials: activeOnly.length,
    readyCount,
    criticalMaterials,
    warningMaterials,
    infoMaterials,
    criticalIssueCount,
    warningIssueCount,
    infoIssueCount,
    entries,
    problematicEntries,
  };
}

export function matchQualityFilter(entry, filterId) {
  if (!filterId || filterId === "all") return entry.issues.length > 0;
  if (filterId === "critical") {
    return entry.issues.some((i) => i.severity === "critical");
  }
  if (filterId === "duplicates") {
    return entry.issues.some(
      (i) => i.id === "duplicate_name_unit" || i.id === "duplicate_purchase_key"
    );
  }
  if (filterId === "general_responsible") {
    return entry.issues.some((i) => i.id === "general_responsible");
  }
  if (filterId === "no_responsible") {
    return entry.issues.some((i) => i.id === "no_responsible");
  }
  const def = MATERIAL_ISSUE_DEFS[filterId];
  if (def?.filter === filterId) {
    return entry.issues.some((i) => i.id === filterId);
  }
  return entry.issues.some((i) => i.id === filterId);
}

export function qualityReportRows(report) {
  const rows = [];
  for (const entry of report.problematicEntries || []) {
    for (const issue of entry.issues) {
      rows.push({
        Проблема: issue.label,
        Уровень: issue.severity,
        Подсказка: issue.hint,
        ID: entry.row.id,
        Наименование: entry.row.name,
        Ед: entry.row.unit,
        Категория: entry.row.category,
        Цена: entry.row.basePrice,
        Поставщик: entry.row.supplier,
        "Раздел клиента": entry.row.clientSectionLabel || entry.row.clientSection,
        "Подраздел клиента": entry.row.clientSubsection,
        Модули: entry.row.modules,
        purchaseKey: entry.row.purchaseKey || "",
        "Кол-во дублей": issue.duplicateCount || "",
        "ID дублей": issue.duplicateIds || "",
      });
    }
  }
  return rows;
}

export function qualitySummaryRows(report) {
  return (report.summary || []).map((s) => ({
    Проверка: s.label,
    "Кол-во": s.count,
  }));
}
