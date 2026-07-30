/**
 * Material Changes Review — project-level catalog drift with actions.
 * Diff detection reuses catalog snapshot + Reports R2 classifyMaterialDrift.
 */

import {
  buildProjectCatalogUpdateDiff,
  diffItemCatalogSnapshot,
  CATALOG_SNAPSHOT_FIELD_KEYS,
} from "./materialCatalogSnapshot.js";
import { classifyMaterialDrift } from "./projectReportsR2.js";
import { REFRESH_FROM_MATERIAL_FIELDS } from "./itemTypes.js";

export const MATERIAL_REVIEW_STATUS = Object.freeze({
  needs_review: "needs_review",
  project_override: "project_override",
  applied_from_catalog: "applied_from_catalog",
});

export const MATERIAL_REVIEW_STATUS_LABELS = Object.freeze({
  needs_review: "Требует проверки",
  project_override: "Изменено в проекте",
  applied_from_catalog: "Уже применяется из базы",
});

export const MATERIAL_REVIEW_FILTERS = Object.freeze([
  { id: "all", label: "Все" },
  { id: "needs_review", label: "Требуют проверки" },
  { id: "project_override", label: "Изменено в проекте" },
  { id: "price", label: "Цена" },
  { id: "name", label: "Название" },
  { id: "link", label: "Ссылка" },
  { id: "other", label: "Другие поля" },
]);

const FIELD_GROUP = {
  name: "name",
  price: "price",
  link: "link",
  linkAlt: "link",
  supplier: "supplier",
};

const REFRESHABLE = new Set(REFRESH_FROM_MATERIAL_FIELDS);
const SNAPSHOT = new Set(CATALOG_SNAPSHOT_FIELD_KEYS);

function isNameOverridden(it) {
  return !!(it?.nameOverridden || it?.name_overridden);
}

function isPriceOverridden(it) {
  return !!(it?.priceOverridden || it?.price_overridden);
}

function isLinkOverridden(it) {
  return !!(it?.linkOverridden || it?.link_overridden);
}

function retainedSet(item, retainedByItem = {}) {
  const fromItem = Array.isArray(item?.retainedCatalogFields) ? item.retainedCatalogFields : [];
  const fromProject = Array.isArray(retainedByItem?.[item?.id]) ? retainedByItem[item.id] : [];
  return new Set([...fromItem, ...fromProject].map(String));
}

function fieldGroup(field) {
  if (FIELD_GROUP[field]) return FIELD_GROUP[field];
  if (field === "imageUrl" || field === "photoUrl") return "other";
  return "other";
}

function isFieldRetained(field, item, retained) {
  if (field === "name" && isNameOverridden(item)) return true;
  if (field === "price" && isPriceOverridden(item)) return true;
  if ((field === "link" || field === "linkAlt") && isLinkOverridden(item)) return true;
  if (retained.has(field)) return true;
  if (field === "photoUrl" && retained.has("imageUrl")) return true;
  if (field === "imageUrl" && retained.has("photoUrl")) return true;
  if (field === "clientSubsection" && retained.has("clientSection")) return true;
  return false;
}

/** Supplier always comes from catalog — informational only. */
export function isSupplierInformationalField(field) {
  return field === "supplier";
}

export function canUpdateReviewField(field) {
  if (isSupplierInformationalField(field)) return false;
  if (REFRESHABLE.has(field)) return true;
  if (field === "imageUrl" || field === "photoUrl") return true;
  if (field === "linkAlt") return true;
  if (field === "clientSubsection") return true;
  return SNAPSHOT.has(field);
}

/** Map UI/snapshot field keys → refreshItemsFromMaterial field ids. */
export function mapFieldsToRefreshPayload(fields = []) {
  const out = new Set();
  for (const f of fields) {
    if (f === "supplier") continue;
    if (f === "name" || f === "price" || f === "link" || f === "clientSection") out.add(f);
    else if (f === "linkAlt") out.add("link");
    else if (f === "imageUrl" || f === "photoUrl" || f === "photo") out.add("photo");
    else if (f === "clientSubsection") out.add("clientSection");
  }
  return [...out];
}

/** Snapshot keys for applyProjectCatalogUpdates (non-refresh extras). */
export function mapFieldsToCatalogApply(fields = []) {
  return fields.filter((f) => {
    if (isSupplierInformationalField(f)) return false;
    if (f === "name" || f === "price" || f === "link" || f === "supplier") return false;
    if (f === "imageUrl" || f === "photoUrl") return true;
    return SNAPSHOT.has(f);
  });
}

export function classifyFieldDiff(diff, item, retainedByItem = {}) {
  const field = diff.field;
  const retained = retainedSet(item, retainedByItem);
  if (isSupplierInformationalField(field)) {
    return {
      ...diff,
      group: "supplier",
      status: MATERIAL_REVIEW_STATUS.applied_from_catalog,
      statusLabel: MATERIAL_REVIEW_STATUS_LABELS.applied_from_catalog,
      canUpdate: false,
      infoText: "Поставщик изменён в базе и уже применяется",
    };
  }
  if (isFieldRetained(field, item, retained)) {
    return {
      ...diff,
      group: fieldGroup(field),
      status: MATERIAL_REVIEW_STATUS.project_override,
      statusLabel: MATERIAL_REVIEW_STATUS_LABELS.project_override,
      canUpdate: canUpdateReviewField(field),
      infoText: "",
    };
  }
  return {
    ...diff,
    group: fieldGroup(field),
    status: MATERIAL_REVIEW_STATUS.needs_review,
    statusLabel: MATERIAL_REVIEW_STATUS_LABELS.needs_review,
    canUpdate: canUpdateReviewField(field),
    infoText: "",
  };
}

function resolveRowStatus(fieldDiffs) {
  if (fieldDiffs.some((d) => d.status === MATERIAL_REVIEW_STATUS.needs_review)) {
    return MATERIAL_REVIEW_STATUS.needs_review;
  }
  if (fieldDiffs.some((d) => d.status === MATERIAL_REVIEW_STATUS.project_override)) {
    return MATERIAL_REVIEW_STATUS.project_override;
  }
  return MATERIAL_REVIEW_STATUS.applied_from_catalog;
}

function summarizeGroups(rows) {
  const counts = { price: 0, name: 0, link: 0, supplier: 0, other: 0 };
  for (const row of rows) {
    const seen = new Set();
    for (const d of row.fieldDiffs || []) {
      const g = d.group === "supplier" ? "supplier" : fieldGroup(d.field);
      if (seen.has(g)) continue;
      seen.add(g);
      if (counts[g] != null) counts[g] += 1;
      else counts.other += 1;
    }
  }
  return counts;
}

/**
 * @param {object[]} items
 * @param {object[]} materials
 * @param {{ retainedByItem?: Record<string, string[]> }} [options]
 */
export function buildMaterialChangesReview(items = [], materials = [], options = {}) {
  const retainedByItem = options.retainedByItem || {};
  const catalog = buildProjectCatalogUpdateDiff(items || [], materials || []);
  const matById = new Map((materials || []).map((m) => [m.id, m]));
  const itemById = new Map((items || []).map((it) => [it.id, it]));
  const rows = [];

  for (const ch of catalog.changes || []) {
    const item = itemById.get(ch.itemId);
    if (!item?.materialId) continue;
    const mat = matById.get(item.materialId) || null;
    const rawDiffs = (ch.diffs || []).filter((d) => {
      if (d.field === "photoUrl" && (ch.diffs || []).some((x) => x.field === "imageUrl")) return false;
      return true;
    });
    const fieldDiffs = rawDiffs.map((d) => classifyFieldDiff(d, item, retainedByItem));
    if (!fieldDiffs.length) continue;
    const status = resolveRowStatus(fieldDiffs);
    const drift = classifyMaterialDrift(item, mat);
    rows.push({
      itemId: item.id,
      materialId: item.materialId,
      itemName: item.name || mat?.name || "—",
      materialName: mat?.name || "— материал не найден —",
      module: item.module || item.section || "",
      fieldDiffs,
      status,
      statusLabel: MATERIAL_REVIEW_STATUS_LABELS[status],
      driftTypeIds: drift?.typeIds || [],
      hasUpdatableFields: fieldDiffs.some((d) => d.canUpdate && d.status === MATERIAL_REVIEW_STATUS.needs_review),
      hasProjectOverrides: fieldDiffs.some((d) => d.status === MATERIAL_REVIEW_STATUS.project_override),
    });
  }

  rows.sort((a, b) => {
    const rank = {
      [MATERIAL_REVIEW_STATUS.needs_review]: 0,
      [MATERIAL_REVIEW_STATUS.project_override]: 1,
      [MATERIAL_REVIEW_STATUS.applied_from_catalog]: 2,
    };
    return (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.itemName.localeCompare(b.itemName, "ru");
  });

  const groups = summarizeGroups(rows);
  return {
    rows,
    count: rows.length,
    changedItemCount: rows.length,
    summary: {
      prices: groups.price,
      names: groups.name,
      links: groups.link,
      suppliers: groups.supplier,
      other: groups.other,
      needsReview: rows.filter((r) => r.status === MATERIAL_REVIEW_STATUS.needs_review).length,
      projectOverride: rows.filter((r) => r.status === MATERIAL_REVIEW_STATUS.project_override).length,
      appliedFromCatalog: rows.filter((r) => r.status === MATERIAL_REVIEW_STATUS.applied_from_catalog).length,
    },
  };
}

export function filterMaterialChangesReview(rows, filterId = "all") {
  const id = String(filterId || "all");
  return (rows || []).filter((row) => {
    if (id === "all") return true;
    if (id === "needs_review") return row.status === MATERIAL_REVIEW_STATUS.needs_review;
    if (id === "project_override") return row.status === MATERIAL_REVIEW_STATUS.project_override;
    if (id === "price" || id === "name" || id === "link") {
      return (row.fieldDiffs || []).some((d) => d.group === id);
    }
    if (id === "other") {
      return (row.fieldDiffs || []).some((d) => d.group === "other" || d.group === "supplier");
    }
    return true;
  });
}

/** Patch for «Оставить значения проекта» — flags + retainedCatalogFields. */
export function buildKeepProjectValuesPatch(item, fields = [], retainedByItem = {}) {
  const retained = retainedSet(item, retainedByItem);
  const nextRetained = new Set(retained);
  const patch = {};
  for (const field of fields) {
    if (isSupplierInformationalField(field)) continue;
    if (field === "name") {
      patch.nameOverridden = true;
      continue;
    }
    if (field === "price") {
      patch.priceOverridden = true;
      nextRetained.add("price");
      continue;
    }
    if (field === "link" || field === "linkAlt") {
      patch.linkOverridden = true;
      nextRetained.add(field);
      continue;
    }
    nextRetained.add(field === "photoUrl" ? "imageUrl" : field);
  }
  patch.retainedCatalogFields = [...nextRetained];
  return patch;
}

export function mergeRetainedByItem(prev = {}, itemId, fields = []) {
  const cur = new Set(Array.isArray(prev[itemId]) ? prev[itemId] : []);
  for (const f of fields) {
    if (isSupplierInformationalField(f)) continue;
    cur.add(f === "photoUrl" ? "imageUrl" : f);
  }
  return { ...prev, [itemId]: [...cur] };
}

export function clearRetainedFields(prev = {}, itemId, fields = null) {
  if (!prev[itemId]) return { ...prev };
  if (!fields) {
    const next = { ...prev };
    delete next[itemId];
    return next;
  }
  const drop = new Set(fields.map((f) => (f === "photoUrl" ? "imageUrl" : f)));
  const left = (prev[itemId] || []).filter((f) => !drop.has(f));
  const next = { ...prev };
  if (left.length) next[itemId] = left;
  else delete next[itemId];
  return next;
}

/**
 * Ids eligible for bulk catalog update.
 * @param {object[]} rows
 * @param {{ includeProjectOverrides?: boolean, selectedIds?: string[]|null }} [opts]
 */
export function selectBulkUpdateItemIds(rows, opts = {}) {
  const includeOverrides = !!opts.includeProjectOverrides;
  const selected = opts.selectedIds ? new Set(opts.selectedIds) : null;
  return (rows || [])
    .filter((row) => {
      if (selected && !selected.has(row.itemId)) return false;
      if (row.status === MATERIAL_REVIEW_STATUS.applied_from_catalog && !row.hasUpdatableFields) return false;
      if (row.status === MATERIAL_REVIEW_STATUS.project_override && !includeOverrides) return false;
      return (row.fieldDiffs || []).some((d) => d.canUpdate);
    })
    .map((row) => row.itemId);
}

export function formatMaterialReviewToast({
  updated = 0,
  alreadyCurrent = 0,
  keptProject = 0,
  failed = 0,
  skippedOverrides = 0,
} = {}) {
  const parts = [];
  parts.push(`Обновлено: ${Number(updated) || 0}`);
  if (alreadyCurrent) parts.push(`Уже актуальны: ${alreadyCurrent}`);
  if (keptProject) parts.push(`Оставлены проектные значения: ${keptProject}`);
  if (skippedOverrides) parts.push(`Пропущено (изменены в проекте): ${skippedOverrides}`);
  if (failed) parts.push(`Не удалось: ${failed}`);
  return parts.join(" · ");
}

/** Diff one item vs material (for tests / field pickers). */
export function listItemFieldDiffs(item, material, retainedByItem = {}) {
  if (!item?.materialId || !material) return [];
  return diffItemCatalogSnapshot(item, material).map((d) => classifyFieldDiff(d, item, retainedByItem));
}

/** Default drawer filter on open. */
export const MATERIAL_REVIEW_DEFAULT_FILTER = "needs_review";

const DIFF_PRIORITY = {
  price: 0,
  name: 1,
  link: 2,
  linkAlt: 3,
  unit: 4,
  supplier: 5,
};

/** Sort real diffs: price/name/link first. */
export function prioritizeFieldDiffs(diffs = []) {
  return [...(diffs || [])].sort((a, b) => {
    const pa = DIFF_PRIORITY[a.field] ?? 40;
    const pb = DIFF_PRIORITY[b.field] ?? 40;
    return pa - pb || String(a.label || "").localeCompare(String(b.label || ""), "ru");
  });
}

function formatDiffValue(field, value) {
  if (value == null || value === "") return "—";
  if (field === "price" || field === "vatRate") {
    const n = Number(value) || 0;
    return `${n.toLocaleString("ru-RU")} ₽`;
  }
  return String(value);
}

/** Compact one-line: «Цена: 680 → 1000». */
export function formatCompactDiffLine(diff) {
  if (!diff) return "";
  if (diff.infoText) return diff.infoText;
  const label = diff.label || diff.field || "Поле";
  const before = formatDiffValue(diff.field, diff.before);
  const after = formatDiffValue(diff.field, diff.after);
  return `${label}: ${before} → ${after}`;
}

/**
 * Split diffs into preview (1–2) and rest for «Ещё N».
 * @param {object[]} diffs
 * @param {number} [previewLimit=2]
 */
export function splitDiffsForPreview(diffs = [], previewLimit = 2) {
  const sorted = prioritizeFieldDiffs(diffs);
  const limit = Math.max(1, Number(previewLimit) || 2);
  return {
    preview: sorted.slice(0, limit),
    rest: sorted.slice(limit),
    total: sorted.length,
  };
}

export function countReviewRowsByStatus(rows = []) {
  const out = {
    needs_review: 0,
    project_override: 0,
    applied_from_catalog: 0,
    all: (rows || []).length,
  };
  for (const row of rows || []) {
    if (out[row.status] != null) out[row.status] += 1;
  }
  return out;
}
