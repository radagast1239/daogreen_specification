/** Reports R2 — publication diffs + material drift (pure, read-only). */

import {
  resolveEffectiveSupplier,
  isPurchasableLineType,
  resolveItemType,
  lineContributesToSum,
} from "./itemTypes.js";
import {
  getProjectStatusLabel,
  normalizeProjectStatus,
  isProjectStatusActiveLifecycle,
} from "./projectStatus.js";
import { publishedPlannedTotal } from "./publishedPurchaseTotals.js";
import { detectUnpublishedChanges } from "./projectPublishedRelease.js";

export const REPORT_PUBLICATION_TABS = Object.freeze([
  { id: "publications", label: "Публикации" },
  { id: "material-drift", label: "Изменения базы" },
]);

export const REPORT_TABS_ALL = Object.freeze([
  { id: "overview", label: "Сводка" },
  { id: "issues", label: "Проблемы" },
  { id: "purchases", label: "Закупка" },
  ...REPORT_PUBLICATION_TABS,
  { id: "sections", label: "По разделам" },
  { id: "rooms", label: "По помещениям" },
]);

export const MATERIAL_DRIFT_TYPES = Object.freeze([
  { id: "manual_price", label: "Ручная цена" },
  { id: "name_override", label: "Название изменено в проекте" },
  { id: "catalog_price_diff", label: "Цена базы отличается от проектной" },
  { id: "catalog_name_diff", label: "Название базы отличается от проектного" },
  { id: "supplier_changed", label: "Поставщик материала изменился" },
  { id: "lost_material", label: "Потеряна связь с материалом" },
  { id: "matches_base", label: "Соответствует базе" },
]);

function lineGross(it) {
  const net = (Number(it.qty) || 0) * (Number(it.price) || 0);
  return net + net * ((Number(it.vatRate) || 0) / 100);
}

function workingBudget(project) {
  return (project?.items || [])
    .filter((it) => lineContributesToSum(it))
    .reduce((s, it) => s + lineGross(it), 0);
}

function materialById(materials) {
  const map = new Map();
  for (const m of materials || []) map.set(m.id, m);
  return map;
}

function isActiveReportProject(project) {
  return isProjectStatusActiveLifecycle(project?.status);
}

function isNameOverridden(it) {
  return !!(it?.nameOverridden || it?.name_overridden);
}

function isPriceOverridden(it) {
  return !!(it?.priceOverridden || it?.price_overridden);
}

function purchasable(it) {
  if (it?.includedInProject === false || it?.enabled === false) return false;
  return isPurchasableLineType(resolveItemType(it));
}

function driftLabel(typeId) {
  return MATERIAL_DRIFT_TYPES.find((t) => t.id === typeId)?.label || typeId;
}

function buildProjectSpecOpenPath(projectId, itemId = "") {
  const id = String(projectId || "").trim();
  if (!id) return "/";
  const params = new URLSearchParams();
  params.set("view", "spec");
  const item = String(itemId || "").trim();
  if (item) params.set("item", item);
  return `/project/${encodeURIComponent(id)}?${params.toString()}`;
}

function resolveItemSupplier(it, materialsIndex) {
  const mat = it?.materialId ? materialsIndex.get(it.materialId) : null;
  return String(resolveEffectiveSupplier(it, mat) || "").trim();
}

/** Client path only when published release exists and token is present. */
export function buildClientReportOpenPath(project) {
  const token = String(project?.clientToken || "").trim();
  if (!token || !project?.publishedRelease) return "";
  return `/client/p/${encodeURIComponent(token)}`;
}

export function parseReportTabAll(raw) {
  const id = String(raw || "").trim();
  if (REPORT_TABS_ALL.some((t) => t.id === id)) return id;
  return "overview";
}

function publicationDiffCounts(project) {
  const summary = project?.unpublishedSummary;
  if (summary && typeof summary === "object") {
    return {
      addedCount: Number(summary.addedCount) || 0,
      removedCount: Number(summary.removedCount) || 0,
      changedCount: Number(summary.changedCount) || 0,
      hasChanges: !!summary.hasChanges || !!project.hasUnpublishedChanges,
    };
  }
  if (!project?.publishedRelease || !Array.isArray(project.publishedSnapshotItems)) {
    return { addedCount: 0, removedCount: 0, changedCount: 0, hasChanges: false };
  }
  const diff = detectUnpublishedChanges(project.items || [], project.publishedSnapshotItems);
  return {
    addedCount: Number(diff.addedCount) || 0,
    removedCount: Number(diff.removedCount) || 0,
    changedCount: Number(diff.changedCount) || 0,
    hasChanges: !!diff.hasChanges,
  };
}

export function buildReportsPublications(projects = []) {
  const rows = (projects || []).filter(isActiveReportProject).map((p) => {
    const hasPublished = !!p.publishedRelease;
    const workingTotal = Math.round(workingBudget(p) * 100) / 100;
    let publishedTotal = null;
    if (hasPublished && Array.isArray(p.publishedSnapshotItems)) {
      publishedTotal = Math.round(publishedPlannedTotal(p.publishedSnapshotItems) * 100) / 100;
    }
    const diff = publicationDiffCounts(p);
    const hasChanges = hasPublished ? !!diff.hasChanges || !!p.hasUnpublishedChanges : false;
    const delta =
      hasPublished && publishedTotal != null
        ? Math.round((workingTotal - publishedTotal) * 100) / 100
        : null;
    const syncStatus = !hasPublished ? "unpublished" : hasChanges ? "changes" : "current";
    const clientPath = buildClientReportOpenPath(p);
    return {
      projectId: p.id,
      name: p.name || "Проект",
      client: p.client || "—",
      status: normalizeProjectStatus(p.status),
      statusLabel: getProjectStatusLabel(p.status),
      workingTotal,
      publishedTotal,
      delta,
      publishedVersion: p.publishedRelease?.versionNumber || null,
      publishedAt: p.publishedRelease?.publishedAt || p.publishedRelease?.createdAt || "",
      workingRevision: Number(p.revision) || null,
      publishedRevision: p.publishedRelease?.revision != null ? Number(p.publishedRelease.revision) : null,
      hasPublished,
      hasUnpublishedChanges: hasChanges,
      syncStatus,
      syncBadge:
        syncStatus === "unpublished"
          ? "Не опубликован"
          : syncStatus === "changes"
            ? "Есть изменения"
            : "Актуально",
      addedCount: hasPublished ? diff.addedCount : 0,
      removedCount: hasPublished ? diff.removedCount : 0,
      changedCount: hasPublished ? diff.changedCount : 0,
      openPath: buildProjectSpecOpenPath(p.id),
      clientPath,
      hasClientLink: !!clientPath,
    };
  });

  rows.sort((a, b) => {
    const rank = { changes: 0, unpublished: 1, current: 2 };
    return (rank[a.syncStatus] ?? 9) - (rank[b.syncStatus] ?? 9) || a.name.localeCompare(b.name, "ru");
  });

  return {
    rows,
    emptyAllCurrent: rows.length > 0 && rows.every((r) => r.syncStatus === "current"),
  };
}

export function filterReportPublications(
  rows,
  { projectId = "", published = "", sync = "", q = "" } = {}
) {
  const query = String(q || "").trim().toLowerCase();
  return (rows || []).filter((row) => {
    if (projectId && row.projectId !== projectId) return false;
    if (published === "yes" && !row.hasPublished) return false;
    if (published === "no" && row.hasPublished) return false;
    if (sync === "changes" && row.syncStatus !== "changes") return false;
    if (sync === "current" && row.syncStatus !== "current") return false;
    if (sync === "unpublished" && row.syncStatus !== "unpublished") return false;
    if (!query) return true;
    const hay = `${row.name} ${row.client} ${row.statusLabel} ${row.syncBadge}`.toLowerCase();
    return hay.includes(query);
  });
}

export function classifyMaterialDrift(item, material) {
  if (!item?.materialId) return null;
  if (!material) {
    return {
      typeIds: ["lost_material"],
      primaryTypeId: "lost_material",
      matchesBase: false,
    };
  }
  const typeIds = [];
  const projectPrice = Number(item.price) || 0;
  const basePrice = Number(material.basePrice) || 0;
  const projectName = String(item.name || "").trim();
  const baseName = String(material.name || "").trim();
  const storedSupplier = String(item.supplier || "").trim();
  const catalogSupplier = String(material.supplier || "").trim();

  if (isPriceOverridden(item)) typeIds.push("manual_price");
  if (isNameOverridden(item)) typeIds.push("name_override");
  if (projectPrice !== basePrice) typeIds.push("catalog_price_diff");
  if (projectName !== baseName) typeIds.push("catalog_name_diff");
  if (storedSupplier && catalogSupplier && storedSupplier !== catalogSupplier) {
    typeIds.push("supplier_changed");
  }

  const unique = [...new Set(typeIds)];
  if (!unique.length) {
    return {
      typeIds: ["matches_base"],
      primaryTypeId: "matches_base",
      matchesBase: true,
    };
  }
  return {
    typeIds: unique,
    primaryTypeId: unique[0],
    matchesBase: false,
  };
}

export function buildReportsMaterialDrift(projects = [], materials = []) {
  const materialsIndex = materialById(materials);
  const rows = [];
  for (const p of (projects || []).filter(isActiveReportProject)) {
    for (const raw of p.items || []) {
      if (!purchasable(raw)) continue;
      if (!raw.materialId) continue;
      const mat = materialsIndex.get(raw.materialId) || null;
      const classified = classifyMaterialDrift(raw, mat);
      if (!classified) continue;
      const supplier =
        resolveItemSupplier(raw, materialsIndex) || (mat ? String(mat.supplier || "").trim() : "");
      rows.push({
        id: `${p.id}:${raw.id}:${classified.primaryTypeId}`,
        projectId: p.id,
        projectName: p.name || "Проект",
        itemId: raw.id,
        itemName: raw.name || "—",
        materialId: raw.materialId,
        materialName: mat?.name || "— материал не найден —",
        projectPrice: Number(raw.price) || 0,
        basePrice: mat ? Number(mat.basePrice) || 0 : null,
        supplier: supplier || "—",
        typeId: classified.primaryTypeId,
        typeIds: classified.typeIds,
        typeLabel: driftLabel(classified.primaryTypeId),
        matchesBase: classified.matchesBase,
        openPath: buildProjectSpecOpenPath(p.id, raw.id),
      });
    }
  }
  rows.sort((a, b) => {
    if (a.matchesBase !== b.matchesBase) return a.matchesBase ? 1 : -1;
    return (
      a.projectName.localeCompare(b.projectName, "ru") || a.itemName.localeCompare(b.itemName, "ru")
    );
  });
  return { rows };
}

export function filterReportMaterialDrift(
  rows,
  { projectId = "", typeId = "", supplier = "", q = "", onlyDiffs = true } = {}
) {
  const query = String(q || "").trim().toLowerCase();
  return (rows || []).filter((row) => {
    if (onlyDiffs && row.matchesBase) return false;
    if (projectId && row.projectId !== projectId) return false;
    if (typeId && !(row.typeIds || []).includes(typeId) && row.typeId !== typeId) return false;
    if (supplier && row.supplier !== supplier) return false;
    if (!query) return true;
    const hay =
      `${row.projectName} ${row.itemName} ${row.materialName} ${row.supplier} ${row.typeLabel}`.toLowerCase();
    return hay.includes(query);
  });
}

export function buildReportsR2(projects = [], materials = []) {
  return {
    publications: buildReportsPublications(projects),
    materialDrift: buildReportsMaterialDrift(projects, materials),
  };
}
