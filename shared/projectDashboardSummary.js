/** Сводка штаба проекта: метрики готовности, закупки, фильтры — pure helper. */

import { resolveClientSection, isMiscCategory, subsectionsForSection, isSubsectionValid } from "./clientSections.js";
import {
  lineVisibleToClient,
  resolveItemType,
  isPurchasableLineType,
  isCoolingSpecItem,
} from "./itemTypes.js";
import { lineGross } from "./moneyCalc.js";
import {
  computeReadinessStats,
  runPrePublishCheck,
  isOnReviewItem,
  isProblematicItem,
} from "./projectReadiness.js";
import { matchSpecLineFilter } from "./specLineFilters.js";
import {
  normalizePurchaseStatus,
  PURCHASE_STATUS,
  shouldCountInPurchaseBudget,
  isPurchaseStatusCompleted,
} from "./purchaseStatusRules.js";
import { isFrameBomLine } from "./frameBomProjectItems.js";

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

function clientSubsectionForCheck(it) {
  const resolved = resolveClientSection(it);
  return {
    section: resolved.section,
    subsection: (it.clientSubsection || resolved.subsection || "").trim(),
  };
}

function hasNoClientSection(it) {
  if (isCoolingSpecItem(it)) return false;
  return isMiscCategory(it);
}

function hasNoClientSubsection(it) {
  if (isCoolingSpecItem(it)) return false;
  if (isMiscCategory(it)) return false;
  const { section, subsection } = clientSubsectionForCheck(it);
  const subs = subsectionsForSection(section);
  if (!section || !subs.length) return false;
  return !subsection || !isSubsectionValid(section, subsection);
}

function emptyPurchaseStatusCounts() {
  return Object.fromEntries(Object.values(PURCHASE_STATUS).map((id) => [id, 0]));
}

function buildPreSendMessages(summary) {
  const rows = [];
  const push = (key, text, filter, severity) => {
    rows.push({ key, text, filter, severity });
  };

  if (summary.noPrice > 0) {
    push("no_price", `Есть позиции без цены: ${summary.noPrice}`, "no_price", "critical");
  }
  if (summary.noLink > 0) {
    push("no_link", `Есть позиции без ссылки: ${summary.noLink}`, "no_link", "warning");
  }
  if (summary.noPhoto > 0) {
    push("no_photo", `Есть позиции без фото: ${summary.noPhoto}`, "no_photo", "warning");
  }
  if (summary.noSupplier > 0) {
    push("no_supplier", `Есть позиции без поставщика: ${summary.noSupplier}`, "no_supplier", "warning");
  }
  if (summary.purchaseStatusCounts[PURCHASE_STATUS.NEED_HELP] > 0) {
    push(
      "need_help",
      `Есть позиции со статусом «Нужна помощь»: ${summary.purchaseStatusCounts[PURCHASE_STATUS.NEED_HELP]}`,
      "need_help",
      "warning"
    );
  }
  if (summary.purchaseStatusCounts[PURCHASE_STATUS.REPLACEMENT_CHECK] > 0) {
    push(
      "replacement_check",
      `Есть позиции «Замена на проверке»: ${summary.purchaseStatusCounts[PURCHASE_STATUS.REPLACEMENT_CHECK]}`,
      "replacement_check",
      "warning"
    );
  }
  if (summary.purchaseStatusCounts[PURCHASE_STATUS.NOT_FIT] > 0) {
    push(
      "not_fit",
      `Есть позиции «Не подходит»: ${summary.purchaseStatusCounts[PURCHASE_STATUS.NOT_FIT]}`,
      "not_fit",
      "critical"
    );
  }
  if (summary.noClientSection > 0) {
    push(
      "no_client_section",
      `Есть позиции без клиентского раздела: ${summary.noClientSection}`,
      "no_client_section",
      "critical"
    );
  }
  if (summary.noClientSubsection > 0) {
    push(
      "no_client_subsection",
      `Есть позиции без клиентского подраздела: ${summary.noClientSubsection}`,
      "no_client_subsection",
      "critical"
    );
  }
  if (summary.hiddenFromClientItems > 0) {
    push(
      "client_hidden",
      `Скрыто от клиента: ${summary.hiddenFromClientItems}`,
      "client_hidden",
      "warning"
    );
  }

  return rows;
}

/**
 * @param {object[]} items
 * @param {{ publishCheck?: object, publishConfig?: object }} [options]
 */
export function buildProjectDashboardSummary(items, options = {}) {
  const pool = purchasablePool(items);
  const clientPool = clientPurchasePool(items);
  const stats = computeReadinessStats(items);

  const purchaseStatusCounts = emptyPurchaseStatusCounts();
  let bomItems = 0;
  let noClientSection = 0;
  let noClientSubsection = 0;

  for (const it of pool) {
    const ps = normalizePurchaseStatus(it);
    purchaseStatusCounts[ps] = (purchaseStatusCounts[ps] || 0) + 1;
    if (isFrameBomLine(it)) bomItems += 1;
    if (hasNoClientSection(it)) noClientSection += 1;
    if (hasNoClientSubsection(it)) noClientSubsection += 1;
  }

  const check =
    options.publishCheck ||
    runPrePublishCheck(items, options.publishConfig || {});

  let totalKnown = 0;
  let remainingToBuyKnown = 0;
  let alreadyBoughtKnown = 0;
  let alreadyHaveKnown = 0;

  for (const it of pool) {
    const price = Number(it.price);
    if (price > 0) {
      const gross = lineGross(it);
      totalKnown += gross;
      if (shouldCountInPurchaseBudget(it)) {
        remainingToBuyKnown += gross;
      }
      const ps = normalizePurchaseStatus(it);
      if (ps === PURCHASE_STATUS.BOUGHT || ps === PURCHASE_STATUS.DELIVERED) {
        alreadyBoughtKnown += gross;
      }
      if (ps === PURCHASE_STATUS.HAVE) {
        alreadyHaveKnown += gross;
      }
    }
  }

  const summary = {
    totalItems: pool.length,
    includedItems: pool.length,
    clientVisibleItems: clientPool.length,
    hiddenFromClientItems: stats.hiddenFromClient,
    bomItems,
    manualItems: pool.length - bomItems,
    noPrice: stats.withoutPrice,
    noPhoto: stats.withoutPhoto,
    noLink: stats.withoutLink,
    noSupplier: stats.withoutSupplier,
    noClientSection,
    noClientSubsection,
    purchaseStatusCounts,
    needHelp: purchaseStatusCounts[PURCHASE_STATUS.NEED_HELP] || 0,
    replacementCheck: purchaseStatusCounts[PURCHASE_STATUS.REPLACEMENT_CHECK] || 0,
    notFit: purchaseStatusCounts[PURCHASE_STATUS.NOT_FIT] || 0,
    onReview: pool.filter(isOnReviewItem).length,
    problematic: pool.filter(isProblematicItem).length,
    readiness: {
      blockers: check.critical?.length || 0,
      warnings: check.warnings?.length || 0,
      ready: check.status === "ok",
      score: stats.readinessPercent,
      status: check.status || "blocked",
      statusLabel: check.statusLabel || "",
    },
    budget: {
      totalKnown,
      missingPriceCount: stats.withoutPrice,
      remainingToBuyKnown,
      alreadyBoughtKnown,
      alreadyHaveKnown,
    },
  };

  summary.preSendMessages = buildPreSendMessages(summary);
  return summary;
}

/** Быстрые фильтры штаба / SpecEditor (админка). */
export const PROJECT_DASHBOARD_FILTERS = [
  { id: "", label: "Все" },
  { id: "client_visible", label: "Клиенту" },
  { id: "client_hidden", label: "Скрытые" },
  { id: "no_price", label: "Без цены" },
  { id: "no_photo", label: "Без фото" },
  { id: "no_link", label: "Без ссылки" },
  { id: "no_supplier", label: "Без поставщика" },
  { id: "need_help", label: "Нужна помощь" },
  { id: "replacement_check", label: "Замена на проверке" },
  { id: "not_fit", label: "Не подходит" },
  { id: "not_bought", label: "Не куплено" },
  { id: "ordered", label: "Заказано" },
  { id: "purchase_closed", label: "Куплено/доставлено" },
  { id: "frame_bom", label: "Из схемы стеллажа" },
  { id: "no_client_section", label: "Без раздела" },
  { id: "problems", label: "Проблемные" },
];

/** Фильтры блока «Клиентская выдача». */
export const CLIENT_DELIVERY_FILTERS = [
  { id: "client_visible", label: "Все клиентские" },
  { id: "client_hidden", label: "Скрытые" },
  { id: "no_price", label: "Без цены" },
  { id: "no_link", label: "Без ссылки" },
  { id: "no_supplier", label: "Без поставщика" },
  { id: "frame_bom", label: "Из схемы каркаса" },
  { id: "not_bought", label: "Не куплено" },
  { id: "ordered", label: "Заказано" },
  { id: "purchase_closed", label: "Куплено/доставлено" },
  { id: "need_help", label: "Нужна помощь" },
  { id: "not_fit", label: "Не подходит" },
  { id: "replacement_check", label: "Замена на проверке" },
];

export function filterProjectItems(items, filterId) {
  if (!filterId) return items || [];
  return (items || []).filter((it) => matchSpecLineFilter(it, filterId, "project"));
}

export function metricTone(count, { warnFrom = 1, badFrom = 1 } = {}) {
  if (!count) return "neutral";
  if (count >= badFrom) return "bad";
  if (count >= warnFrom) return "warn";
  return "neutral";
}

/** Человекочитаемая подпись активного фильтра таблицы. */
export function resolveDashboardFilterLabel(filterId) {
  if (!filterId) return "Все позиции";
  const row =
    CLIENT_DELIVERY_FILTERS.find((f) => f.id === filterId) ||
    PROJECT_DASHBOARD_FILTERS.find((f) => f.id === filterId);
  return row?.label || filterId;
}

/** Короткий бейдж в шапке штаба (без дубля полного текста карточки). */
export function shortPublishHeadline(status, { blockers = 0, warnings = 0 } = {}) {
  if (status === "ok") return "Готово";
  if (status === "warnings") {
    return warnings > 0 ? `Предупреждения: ${warnings}` : "Есть предупреждения";
  }
  if (status === "blocked") {
    return blockers > 0 ? `Блокеры: ${blockers}` : "Есть блокеры";
  }
  return "Проверка";
}

/** Охлаждение не блокирует публикацию — только informational/warning. */
export function isCoolingPublishBlocker() {
  return false;
}
