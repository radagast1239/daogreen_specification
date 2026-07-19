/** Reports R1 — overview / issues / purchasing (pure, read-only). */

import {
  isPurchasableLineType,
  resolveItemType,
  resolveEffectiveSupplier,
  isCoolingSpecItem,
  lineVisibleToClient,
  lineContributesToSum,
} from "./itemTypes.js";
import {
  normalizePurchaseStatus,
  PURCHASE_STATUS,
  PURCHASE_STATUS_LABELS,
  isClosedPurchaseStatusId,
  shouldCountInPurchaseBudget,
} from "./purchaseStatusRules.js";
import { getProjectStatusLabel, normalizeProjectStatus, PROJECT_STATUS, isProjectStatusActiveLifecycle } from "./projectStatus.js";
import { publishedPlannedTotal } from "./publishedPurchaseTotals.js";
import { detectUnpublishedChanges } from "./projectPublishedRelease.js";
import { buildClientImageManifest } from "./clientImageManifest.js";
import { buildClientPurchaseSummary } from "./clientPurchaseSummary.js";
import { matchSpecLineFilter } from "./specLineFilters.js";

export const REPORT_TABS = Object.freeze([
  { id: "overview", label: "Сводка" },
  { id: "issues", label: "Проблемы" },
  { id: "purchases", label: "Закупка" },
]);

export const REPORT_ISSUE_TYPES = Object.freeze([
  { id: "no_price", label: "Отсутствует цена", level: "error" },
  { id: "no_supplier", label: "Отсутствует поставщик", level: "error" },
  { id: "no_link", label: "Отсутствует ссылка", level: "warning" },
  { id: "no_photo", label: "Отсутствует фотография", level: "warning" },
  { id: "lost_material", label: "Потеряна связь с материалом", level: "error" },
  { id: "price_override", label: "Ручная цена отличается от базы", level: "warning" },
  { id: "name_override", label: "Название изменено в проекте", level: "info" },
  { id: "not_client_ready", label: "Позиция не готова для клиента", level: "error" },
]);

const ISSUE_LEVEL_LABEL = {
  error: "Ошибка",
  warning: "Предупреждение",
  info: "Информация",
};

const NO_SUPPLIER_GROUP = "Поставщик не указан";

function lineGross(it) {
  const net = (Number(it.qty) || 0) * (Number(it.price) || 0);
  return net + net * ((Number(it.vatRate) || 0) / 100);
}

function materialById(materials) {
  const map = new Map();
  for (const m of materials || []) map.set(m.id, m);
  return map;
}

function isActiveReportProject(project) {
  return isProjectStatusActiveLifecycle(project?.status);
}

function purchasableIncluded(it) {
  if (it?.includedInProject === false || it?.enabled === false) return false;
  return isPurchasableLineType(resolveItemType(it));
}

function isNameOverridden(it) {
  return !!(it?.nameOverridden || it?.name_overridden);
}

function isPriceOverridden(it) {
  return !!(it?.priceOverridden || it?.price_overridden);
}

function resolveItemSupplier(it, materialsIndex) {
  const mat = it?.materialId ? materialsIndex.get(it.materialId) : null;
  return String(resolveEffectiveSupplier(it, mat) || "").trim();
}

/** Deep-link into project specification, optionally highlighting an item. */
export function buildProjectSpecOpenPath(projectId, itemId = "") {
  const id = String(projectId || "").trim();
  if (!id) return "/";
  const params = new URLSearchParams();
  params.set("view", "spec");
  const item = String(itemId || "").trim();
  if (item) params.set("item", item);
  return `/project/${encodeURIComponent(id)}?${params.toString()}`;
}

function issueDef(typeId) {
  return REPORT_ISSUE_TYPES.find((t) => t.id === typeId) || {
    id: typeId,
    label: typeId,
    level: "info",
  };
}

function pushIssue(out, project, it, typeId, materialsIndex) {
  const def = issueDef(typeId);
  // Services/cooling: no supplier is warning (existing cooling exemption + soft service rule).
  let level = def.level;
  if (typeId === "no_supplier" && (isCoolingSpecItem(it) || /услуг|работ|монтаж|доставк/i.test(it?.name || ""))) {
    level = "warning";
  }
  out.push({
    id: `${project.id}:${it.id}:${typeId}`,
    projectId: project.id,
    projectName: project.name || "Проект",
    itemId: it.id,
    itemName: it.name || "—",
    section: it.section || it.module || "—",
    typeId,
    typeLabel: def.label,
    level,
    levelLabel: ISSUE_LEVEL_LABEL[level] || level,
    price: Number(it.price) || 0,
    supplier: resolveItemSupplier(it, materialsIndex),
    openPath: buildProjectSpecOpenPath(project.id, it.id),
  });
}

/**
 * Collect report issues for one project using existing filter/readiness rules.
 */
export function collectProjectReportIssues(project, materials = []) {
  const materialsIndex = materialById(materials);
  const out = [];
  const items = (project?.items || []).filter(purchasableIncluded);

  for (const raw of items) {
    const mat = raw.materialId ? materialsIndex.get(raw.materialId) : null;
    const it = { ...raw, supplier: resolveEffectiveSupplier(raw, mat) };

    if (matchSpecLineFilter(it, "no_price", "project") && !isCoolingSpecItem(it)) {
      pushIssue(out, project, it, "no_price", materialsIndex);
    }
    if (matchSpecLineFilter(it, "no_supplier", "project") && !isCoolingSpecItem(it)) {
      pushIssue(out, project, it, "no_supplier", materialsIndex);
    }
    if (matchSpecLineFilter(it, "no_link", "project") && !isCoolingSpecItem(it)) {
      pushIssue(out, project, it, "no_link", materialsIndex);
    }
    if (matchSpecLineFilter(it, "no_photo", "project") && !isCoolingSpecItem(it)) {
      pushIssue(out, project, it, "no_photo", materialsIndex);
    }
    if (raw.materialId && !mat) {
      pushIssue(out, project, it, "lost_material", materialsIndex);
    }
    if (mat && isPriceOverridden(it) && (Number(it.price) || 0) !== (Number(mat.basePrice) || 0)) {
      pushIssue(out, project, it, "price_override", materialsIndex);
    }
    if (mat && isNameOverridden(it) && String(it.name || "").trim() !== String(mat.name || "").trim()) {
      pushIssue(out, project, it, "name_override", materialsIndex);
    }
    if (lineVisibleToClient(it) && !isCoolingSpecItem(it)) {
      const notReady =
        matchSpecLineFilter(it, "no_price", "project") ||
        matchSpecLineFilter(it, "no_supplier", "project") ||
        matchSpecLineFilter(it, "no_client_section", "project");
      if (notReady) {
        pushIssue(out, project, it, "not_client_ready", materialsIndex);
      }
    }
  }
  return out;
}

export function filterReportIssues(issues, { projectId = "", typeId = "", level = "", q = "" } = {}) {
  const query = String(q || "").trim().toLowerCase();
  return (issues || []).filter((row) => {
    if (projectId && row.projectId !== projectId) return false;
    if (typeId && row.typeId !== typeId) return false;
    if (level && row.level !== level) return false;
    if (!query) return true;
    const hay = `${row.projectName} ${row.itemName} ${row.section} ${row.typeLabel} ${row.supplier}`.toLowerCase();
    return hay.includes(query);
  });
}

function workingBudget(project) {
  return (project?.items || [])
    .filter((it) => lineContributesToSum(it))
    .reduce((s, it) => s + lineGross(it), 0);
}

function publishedBudget(project) {
  const snap = project?.publishedSnapshotItems;
  if (!Array.isArray(snap)) return null;
  if (!project?.publishedRelease) return null;
  return publishedPlannedTotal(snap);
}

function clientReadyLabel(project, materials) {
  const summary = buildClientPurchaseSummary(project?.items || [], materials);
  const total = summary.totalClientItems || 0;
  const blockers = (summary.noPrice || 0) + (summary.noSupplier || 0);
  if (!total) return "Нет позиций";
  if (blockers > 0) return `Не готово (${blockers})`;
  if (summary.hiddenItems > 0) return `Готово · скрыто ${summary.hiddenItems}`;
  return "Готово";
}

/**
 * @param {object[]} projects — full projects with items + release fields
 * @param {object[]} materials
 */
export function buildReportsOverview(projects = [], materials = []) {
  const active = (projects || []).filter(isActiveReportProject);
  const rows = active.map((p) => {
    const issues = collectProjectReportIssues(p, materials);
    const errorCount = issues.filter((i) => i.level === "error").length;
    const publishedTotal = publishedBudget(p);
    const hasPublished = !!p.publishedRelease;
    const hasChanges = !!p.hasUnpublishedChanges;
    return {
      projectId: p.id,
      name: p.name || "Проект",
      client: p.client || "—",
      status: normalizeProjectStatus(p.status),
      statusLabel: getProjectStatusLabel(p.status),
      workingTotal: Math.round(workingBudget(p) * 100) / 100,
      publishedTotal: publishedTotal == null ? null : Math.round(publishedTotal * 100) / 100,
      publishedLabel: hasPublished
        ? publishedTotal == null
          ? "—"
          : null
        : "Не опубликован",
      readinessLabel: clientReadyLabel(p, materials),
      lastPublishedAt: p.publishedRelease?.publishedAt || p.publishedRelease?.createdAt || "",
      lastPublishedVersion: p.publishedRelease?.versionNumber || null,
      issueCount: issues.length,
      errorCount,
      hasUnpublishedChanges: hasChanges,
      needsAttention: errorCount > 0 || hasChanges || normalizeProjectStatus(p.status) === PROJECT_STATUS.ON_REVIEW,
      openPath: buildProjectSpecOpenPath(p.id),
    };
  });

  const needsAttention = rows.filter((r) => r.needsAttention).length;
  const unpublished = rows.filter((r) => r.publishedTotal == null && r.publishedLabel === "Не опубликован").length;
  const withChanges = rows.filter((r) => r.hasUnpublishedChanges).length;
  const workingSum = rows.reduce((s, r) => s + (Number(r.workingTotal) || 0), 0);

  let unpurchasedSum = 0;
  for (const p of active) {
    const materialsIndex = materialById(materials);
    for (const raw of p.items || []) {
      if (!purchasableIncluded(raw)) continue;
      if (!shouldCountInPurchaseBudget(raw)) continue;
      const status = normalizePurchaseStatus(raw);
      if (isClosedPurchaseStatusId(status)) continue;
      if (status === PURCHASE_STATUS.ORDERED || status === PURCHASE_STATUS.SEARCHING) continue;
      const mat = raw.materialId ? materialsIndex.get(raw.materialId) : null;
      const it = { ...raw, supplier: resolveEffectiveSupplier(raw, mat) };
      unpurchasedSum += lineGross(it);
    }
  }

  return {
    cards: {
      activeProjects: rows.length,
      needsAttention,
      unpublished,
      withChanges,
      activeTotal: Math.round(workingSum * 100) / 100,
      unpurchasedTotal: Math.round(unpurchasedSum * 100) / 100,
    },
    projects: rows,
  };
}

export function buildReportsIssues(projects = [], materials = []) {
  const active = (projects || []).filter(isActiveReportProject);
  const issues = [];
  for (const p of active) {
    issues.push(...collectProjectReportIssues(p, materials));
  }
  issues.sort((a, b) => {
    const lv = { error: 0, warning: 1, info: 2 };
    return (lv[a.level] ?? 9) - (lv[b.level] ?? 9) || a.projectName.localeCompare(b.projectName, "ru");
  });
  return { issues, total: issues.length };
}

export function buildReportsPurchases(projects = [], materials = []) {
  const materialsIndex = materialById(materials);
  const active = (projects || []).filter(isActiveReportProject);
  const rows = [];

  for (const p of active) {
    for (const raw of p.items || []) {
      if (!purchasableIncluded(raw)) continue;
      const mat = raw.materialId ? materialsIndex.get(raw.materialId) : null;
      const supplier = resolveItemSupplier(raw, materialsIndex) || NO_SUPPLIER_GROUP;
      const status = normalizePurchaseStatus(raw);
      const qty = Number(raw.qty) || 0;
      const price = Number(raw.price) || 0;
      const sum = lineGross(raw);
      rows.push({
        id: `${p.id}:${raw.id}`,
        projectId: p.id,
        projectName: p.name || "Проект",
        itemId: raw.id,
        itemName: raw.name || "—",
        unit: raw.unit || "шт.",
        qty,
        price,
        sum: Math.round(sum * 100) / 100,
        status,
        statusLabel: PURCHASE_STATUS_LABELS[status] || status,
        supplier,
        link: String(raw.link || "").trim(),
        openPath: buildProjectSpecOpenPath(p.id, raw.id),
      });
    }
  }

  const totals = {
    totalSum: 0,
    notOrderedSum: 0,
    orderedSum: 0,
    receivedSum: 0,
    supplierCount: 0,
  };
  const suppliers = new Set();
  for (const r of rows) {
    totals.totalSum += r.sum;
    if (r.supplier && r.supplier !== NO_SUPPLIER_GROUP) suppliers.add(r.supplier);
    const s = r.status;
    if (s === PURCHASE_STATUS.ORDERED || s === PURCHASE_STATUS.SEARCHING) totals.orderedSum += r.sum;
    else if (
      s === PURCHASE_STATUS.BOUGHT ||
      s === PURCHASE_STATUS.DELIVERED ||
      s === PURCHASE_STATUS.HAVE
    ) {
      totals.receivedSum += r.sum;
    } else {
      totals.notOrderedSum += r.sum;
    }
  }
  totals.supplierCount = suppliers.size;
  totals.totalSum = Math.round(totals.totalSum * 100) / 100;
  totals.notOrderedSum = Math.round(totals.notOrderedSum * 100) / 100;
  totals.orderedSum = Math.round(totals.orderedSum * 100) / 100;
  totals.receivedSum = Math.round(totals.receivedSum * 100) / 100;

  return { rows, totals };
}

export function groupPurchasesBySupplier(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const key = row.supplier || NO_SUPPLIER_GROUP;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  const groups = [...map.entries()].map(([supplier, items]) => ({
    supplier,
    items,
    sum: Math.round(items.reduce((s, i) => s + (Number(i.sum) || 0), 0) * 100) / 100,
  }));
  groups.sort((a, b) => {
    if (a.supplier === NO_SUPPLIER_GROUP) return 1;
    if (b.supplier === NO_SUPPLIER_GROUP) return -1;
    return a.supplier.localeCompare(b.supplier, "ru");
  });
  return groups;
}

export function filterReportPurchases(rows, { projectId = "", supplier = "", status = "", q = "" } = {}) {
  const query = String(q || "").trim().toLowerCase();
  return (rows || []).filter((row) => {
    if (projectId && row.projectId !== projectId) return false;
    if (supplier && row.supplier !== supplier) return false;
    if (status && row.status !== status) return false;
    if (!query) return true;
    const hay = `${row.projectName} ${row.itemName} ${row.supplier} ${row.statusLabel}`.toLowerCase();
    return hay.includes(query);
  });
}

export function parseReportTab(raw) {
  const id = String(raw || "").trim();
  if (REPORT_TABS.some((t) => t.id === id)) return id;
  return "overview";
}

export function buildReportsR1(projects = [], materials = []) {
  return {
    overview: buildReportsOverview(projects, materials),
    issues: buildReportsIssues(projects, materials),
    purchases: buildReportsPurchases(projects, materials),
  };
}

/** Used by tests — detect unpublished via existing helper when snapshot items present. */
export function projectHasUnpublishedChanges(project) {
  if (typeof project?.hasUnpublishedChanges === "boolean") return project.hasUnpublishedChanges;
  if (!project?.publishedRelease || !Array.isArray(project.publishedSnapshotItems)) return false;
  return detectUnpublishedChanges(
    project.items || [],
    project.publishedSnapshotItems,
    buildClientImageManifest(project),
    { projectSchemes: [], rackImages: [] },
  ).hasChanges;
}

export { NO_SUPPLIER_GROUP, ISSUE_LEVEL_LABEL, isActiveReportProject, resolveItemSupplier };
