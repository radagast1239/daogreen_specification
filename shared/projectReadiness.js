/** Готовность проекта, предпроверка публикации, режимы просмотра */

import { isMiscCategory, resolveClientSection, subsectionsForSection, isSubsectionValid } from "./clientSections.js";
import { findPurchaseDuplicateGroups } from "./purchaseMerge.js";
import {
  lineContributesToSum,
  lineVisibleToClient,
  resolveItemType,
  isPurchasableLineType,
} from "./itemTypes.js";
import { validateItemsForPublish, ISSUE_LABELS, parsePublishRulesSettings } from "./publishRules.js";

export const READINESS_ISSUE_LABELS = {
  ...ISSUE_LABELS,
  no_client_section: "Нет клиентского раздела",
  no_client_subsection: "Нет клиентского подраздела",
  hidden_from_client: "Скрыто от клиента",
  purchase_duplicate: "Дубль в закупке",
  zero_price: "Цена = 0",
  on_review: "На проверке",
  problematic: "Проблемная позиция",
};

/** Критические — блокируют публикацию */
export const CRITICAL_ISSUES = new Set([
  "no_qty",
  "no_price",
  "zero_price",
  "no_photo",
  "no_supplier",
  "not_approved",
  "misc_category",
  "no_client_section",
  "no_client_subsection",
  "min_client_items",
]);

/** Предупреждения — публикация возможна */
export const WARNING_ISSUES = new Set([
  "no_link",
  "hidden_from_client",
  "purchase_duplicate",
  "on_review",
  "problematic",
]);

const PROBLEMATIC_STATUSES = new Set(["need_help", "not_fit"]);
const ON_REVIEW_STATUSES = new Set(["replacement_check"]);

function hasPhoto(it) {
  return !!(it?.photoUrl || it?.imageUrl);
}

function purchasablePool(items) {
  return (items || []).filter((it) => {
    if (it.includedInProject === false) return false;
    return isPurchasableLineType(resolveItemType(it));
  });
}

function clientPurchasePool(items) {
  return purchasablePool(items).filter((it) => lineVisibleToClient(it));
}

export function isOnReviewItem(it) {
  return !!it?.needsApproval || ON_REVIEW_STATUSES.has(it?.status);
}

export function isProblematicItem(it) {
  return PROBLEMATIC_STATUSES.has(it?.status);
}

export function filterItemsForViewMode(items, mode = "designer") {
  if (mode !== "client") return items || [];
  return (items || []).filter((it) => {
    const t = resolveItemType(it);
    if (t === "internal_note" || t === "subtotal") return false;
    if (it.includedInProject === false) return false;
    if (!lineVisibleToClient(it)) return false;
    return true;
  });
}

export function computeReadinessStats(items) {
  const pool = purchasablePool(items);
  const clientPool = clientPurchasePool(items);
  const dupGroups = findPurchaseDuplicateGroups(clientPool);
  const duplicateItemCount = dupGroups.reduce((n, g) => n + g.length, 0);

  const withoutPrice = pool.filter((it) => !(Number(it.price) > 0)).length;
  const withoutLink = pool.filter((it) => !(it.link || "").trim()).length;
  const withoutPhoto = pool.filter((it) => !hasPhoto(it)).length;
  const withoutSupplier = pool.filter((it) => !(it.supplier || "").trim()).length;
  const hiddenFromClient = pool.filter((it) => !lineVisibleToClient(it)).length;
  const onReview = pool.filter(isOnReviewItem).length;
  const problematic = pool.filter(isProblematicItem).length;

  const shownToClient = clientPool.length;
  const positionsInProject = pool.length;

  let readinessPercent = 100;
  if (positionsInProject > 0) {
    const issueItems = new Set();
    for (const it of clientPool) {
      if (!(Number(it.price) > 0)) issueItems.add(it.id);
      if (!(Number(it.qty) > 0)) issueItems.add(it.id);
      if (!hasPhoto(it)) issueItems.add(it.id);
      if (isMiscCategory(it)) issueItems.add(it.id);
      const { section, subsection } = clientSubsectionForCheck(it);
      const subs = subsectionsForSection(section);
      if (section && subs.length > 0 && (!subsection || !isSubsectionValid(section, subsection))) {
        issueItems.add(it.id);
      }
    }
    const ready = Math.max(0, shownToClient - issueItems.size);
    readinessPercent = shownToClient
      ? Math.round((ready / shownToClient) * 100)
      : Math.round(((positionsInProject - withoutPrice) / positionsInProject) * 100);
  }

  return {
    readinessPercent,
    positionsInProject,
    shownToClient,
    withoutPrice,
    withoutLink,
    withoutPhoto,
    withoutSupplier,
    purchaseDuplicates: dupGroups.length,
    purchaseDuplicateItems: duplicateItemCount,
    problematic,
    onReview,
    hiddenFromClient,
  };
}

function clientSubsectionForCheck(it) {
  const resolved = resolveClientSection(it);
  return {
    section: resolved.section,
    subsection: (it.clientSubsection || resolved.subsection || "").trim(),
  };
}

function extraChecksForItem(it, rules) {
  const problems = [];
  const t = resolveItemType(it);

  if (isPurchasableLineType(t) && it.includedInProject !== false && !lineVisibleToClient(it)) {
    problems.push("hidden_from_client");
  }

  if (isMiscCategory(it)) {
    problems.push("no_client_section");
  }

  const { section, subsection } = clientSubsectionForCheck(it);
  const subs = subsectionsForSection(section);
  if (section && subs.length > 0) {
    if (!subsection || !isSubsectionValid(section, subsection)) {
      problems.push("no_client_subsection");
    }
  }

  if (Number(it.price) === 0 && rules.requirePrice) {
    if (!problems.includes("no_price")) problems.push("zero_price");
  }

  if (isOnReviewItem(it)) problems.push("on_review");
  if (isProblematicItem(it)) problems.push("problematic");

  return problems;
}

function problemRow(it, issue) {
  return {
    itemId: it?.id || null,
    name: it?.name || "",
    module: it?.module || "",
    issue,
    label: READINESS_ISSUE_LABELS[issue] || issue,
    severity: CRITICAL_ISSUES.has(issue) ? "critical" : "warning",
  };
}

/** Для проверки публикации: подтянуть клиентские поля из материала, если в позиции пусто */
export function enrichItemForPublishCheck(item, material) {
  if (!item) return item;
  const patch = {};
  const matResolved = material ? resolveClientSection(material) : null;

  if (!(item.clientSection || "").trim()) {
    const fromMat = (material?.clientSection || "").trim() || matResolved?.section || "";
    if (fromMat) patch.clientSection = fromMat;
  }

  if (!(item.clientSubsection || "").trim()) {
    const fromMat =
      (material?.clientSubsection || "").trim() || matResolved?.subsection || "";
    if (fromMat) patch.clientSubsection = fromMat;
  }

  return Object.keys(patch).length ? { ...item, ...patch } : item;
}

export function enrichItemsForPublishCheck(items, materialById) {
  const map = materialById || new Map();
  return (items || []).map((it) => enrichItemForPublishCheck(it, it?.materialId ? map.get(it.materialId) : null));
}

/** Расширенная проверка перед публикацией */
export function runPrePublishCheck(items, config) {
  const cfg = config?.rules != null ? config : parsePublishRulesSettings(config || {});
  const base = validateItemsForPublish(items, cfg);

  const clientPool = clientPurchasePool(items);
  const dupGroups = findPurchaseDuplicateGroups(clientPool);
  const extra = [];

  for (const it of clientPool) {
    for (const issue of extraChecksForItem(it, base.rules)) {
      extra.push(problemRow(it, issue));
    }
  }

  for (const group of dupGroups) {
    for (const it of group) {
      extra.push(problemRow(it, "purchase_duplicate"));
    }
  }

  const allProblems = [...(base.problems || [])];
  const seen = new Set(allProblems.map((p) => `${p.itemId}|${p.issue}`));

  for (const p of extra) {
    const key = `${p.itemId}|${p.issue}`;
    if (seen.has(key)) continue;
    seen.add(key);
    allProblems.push(p);
  }

  const normalized = allProblems.map((p) => {
    const issue = p.issue;
    let severity = p.severity;
    if (!severity) {
      if (issue === "no_link") severity = "warning";
      else if (CRITICAL_ISSUES.has(issue)) severity = "critical";
      else if (WARNING_ISSUES.has(issue)) severity = "warning";
      else severity = base.rules?.requireLink && issue === "no_link" ? "warning" : "critical";
    }
    return {
      ...p,
      severity,
      label: p.label || READINESS_ISSUE_LABELS[issue] || issue,
    };
  });

  const critical = normalized.filter((p) => p.severity === "critical");
  const warnings = normalized.filter((p) => p.severity === "warning");

  let status = "ok";
  if (critical.length) status = "blocked";
  else if (warnings.length) status = "warnings";

  const byIssue = {};
  for (const p of normalized) {
    byIssue[p.issue] = (byIssue[p.issue] || 0) + 1;
  }

  return {
    ok: status === "ok",
    status,
    statusLabel:
      status === "ok"
        ? "Можно публиковать"
        : status === "warnings"
          ? "Можно публиковать с предупреждениями"
          : "Нельзя публиковать",
    critical,
    warnings,
    problems: normalized,
    counts: {
      ...base.counts,
      issueCount: normalized.length,
      criticalCount: critical.length,
      warningCount: warnings.length,
      byIssue,
    },
    rules: base.rules,
    allowForcePublish: base.allowForcePublish,
    readiness: computeReadinessStats(items),
  };
}
