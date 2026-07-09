/** Чеклист «Подготовка к отправке» — pure helper поверх dashboard/readiness/filters. */

import { buildProjectDashboardSummary } from "./projectDashboardSummary.js";
import { buildClientPurchaseSummary } from "./clientPurchaseSummary.js";
import {
  lineVisibleToClient,
  isPurchasableLineType,
  resolveItemType,
} from "./itemTypes.js";
import { matchSpecLineFilter } from "./specLineFilters.js";
import { isOnReviewItem } from "./projectReadiness.js";
import { normalizePurchaseStatus, PURCHASE_STATUS } from "./purchaseStatusRules.js";
import { isFrameBomLine } from "./frameBomProjectItems.js";

export const PRE_SEND_PROBLEM_GROUP_KEYS = [
  "no_price",
  "no_link",
  "no_supplier",
  "hidden_from_client",
  "needs_review",
  "need_help",
  "replacement_check",
  "not_fit",
];

const GROUP_DEFS = [
  {
    key: "no_price",
    label: "Без цены",
    filterKey: "no_price",
    severity: "blocker",
    selectable: true,
    actionHint: "Укажите цену или обновите из базы",
  },
  {
    key: "no_link",
    label: "Без ссылки",
    filterKey: "no_link",
    severity: "warning",
    selectable: true,
    actionHint: "Добавьте ссылку на товар",
  },
  {
    key: "no_supplier",
    label: "Без поставщика",
    filterKey: "no_supplier",
    severity: "blocker",
    selectable: true,
    actionHint: "Укажите поставщика",
  },
  {
    key: "hidden_from_client",
    label: "Скрыто от клиента",
    filterKey: "client_hidden",
    severity: "warning",
    selectable: true,
    actionHint: "Покажите клиенту или оставьте скрытым осознанно",
  },
  {
    key: "needs_review",
    label: "На проверке",
    filterKey: "needs_review",
    severity: "warning",
    selectable: true,
    actionHint: "Завершите проверку позиции",
  },
  {
    key: "need_help",
    label: "Нужна помощь",
    filterKey: "need_help",
    severity: "warning",
    selectable: true,
    actionHint: "Нужна помощь по закупке",
  },
  {
    key: "replacement_check",
    label: "Замена на проверке",
    filterKey: "replacement_check",
    severity: "warning",
    selectable: true,
    actionHint: "Подтвердите или отклоните замену",
  },
  {
    key: "not_fit",
    label: "Не подходит",
    filterKey: "not_fit",
    severity: "blocker",
    selectable: true,
    actionHint: "Замените или исключите позицию",
  },
  {
    key: "frame_bom",
    label: "Из схемы каркаса",
    filterKey: "frame_bom",
    severity: "neutral",
    selectable: true,
    actionHint: "Позиции из схемы каркаса",
  },
  {
    key: "client_ready",
    label: "Готово клиенту",
    filterKey: "client_visible",
    severity: "ok",
    selectable: false,
    actionHint: "Видимые клиенту позиции без блокеров",
  },
];

function purchasablePool(items) {
  return (items || []).filter((it) => {
    if (it.includedInProject === false || it.enabled === false) return false;
    return isPurchasableLineType(resolveItemType(it));
  });
}

function idsForFilter(items, filterKey) {
  return items.filter((it) => matchSpecLineFilter(it, filterKey, "project")).map((it) => it.id);
}

function isClientReadyItem(it, problemIdSet) {
  if (!lineVisibleToClient(it)) return false;
  if (problemIdSet.has(it.id)) return false;
  return true;
}

/**
 * @param {object[]} items
 * @param {object[]} [materials]
 * @param {{ publishCheck?: object }} [options]
 */
export function buildProjectPreSendChecklist(items, materials = [], options = {}) {
  const pool = purchasablePool(items);
  const dashboard = buildProjectDashboardSummary(items, options);
  const clientSummary = buildClientPurchaseSummary(items, materials);

  const problemBuckets = new Map();
  for (const key of PRE_SEND_PROBLEM_GROUP_KEYS) {
    const def = GROUP_DEFS.find((g) => g.key === key);
    problemBuckets.set(key, idsForFilter(pool, def.filterKey));
  }

  const allProblemIds = [];
  const seenProblem = new Set();
  for (const key of PRE_SEND_PROBLEM_GROUP_KEYS) {
    for (const id of problemBuckets.get(key) || []) {
      if (seenProblem.has(id)) continue;
      seenProblem.add(id);
      allProblemIds.push(id);
    }
  }

  const blockerIds = new Set();
  const warningIds = new Set();

  for (const def of GROUP_DEFS) {
    if (def.severity === "blocker") {
      for (const id of idsForFilter(pool, def.filterKey)) blockerIds.add(id);
    } else if (def.severity === "warning") {
      for (const id of idsForFilter(pool, def.filterKey)) warningIds.add(id);
    }
  }

  for (const id of blockerIds) warningIds.delete(id);

  const clientReadyIds = pool
    .filter((it) => isClientReadyItem(it, seenProblem))
    .map((it) => it.id);

  const groups = GROUP_DEFS.map((def) => {
    let itemIds;
    if (def.key === "client_ready") {
      itemIds = clientReadyIds;
    } else if (def.key === "frame_bom") {
      itemIds = pool.filter((it) => isFrameBomLine(it)).map((it) => it.id);
    } else {
      itemIds = problemBuckets.get(def.key) || idsForFilter(pool, def.filterKey);
    }
    return {
      key: def.key,
      label: def.label,
      count: itemIds.length,
      severity: def.severity,
      filterKey: def.filterKey,
      selectable: def.selectable,
      actionHint: def.actionHint,
      itemIds,
    };
  });

  const blockers = blockerIds.size;
  const warnings = warningIds.size;

  let status = "ready";
  let tone = "ok";
  let statusTitle = "Готово к отправке";
  let statusDetail = "";

  if (blockers > 0) {
    status = "not_ready";
    tone = "bad";
    statusTitle = "Не готово к отправке";
    statusDetail = `Есть блокеры: ${blockers}`;
  } else if (warnings > 0) {
    status = "warning";
    tone = "warn";
    statusTitle = "Можно отправлять с предупреждениями";
    statusDetail = `Предупреждения: ${warnings}`;
  }

  return {
    status,
    tone,
    statusTitle,
    statusDetail,
    blockers,
    warnings,
    groups,
    selectedProblemIds: allProblemIds,
    allProblemIds,
    readiness: dashboard.readiness,
    clientVisibleCount: clientSummary.totalClientItems,
    onReviewCount: pool.filter(isOnReviewItem).length,
    needHelpCount: pool.filter(
      (it) => normalizePurchaseStatus(it) === PURCHASE_STATUS.NEED_HELP
    ).length,
    replacementCheckCount: pool.filter(
      (it) => normalizePurchaseStatus(it) === PURCHASE_STATUS.REPLACEMENT_CHECK
    ).length,
    notFitCount: pool.filter(
      (it) => normalizePurchaseStatus(it) === PURCHASE_STATUS.NOT_FIT
    ).length,
  };
}

export function selectPreSendGroupIds(checklist, groupKey) {
  const group = checklist?.groups?.find((g) => g.key === groupKey);
  return group?.itemIds ? [...group.itemIds] : [];
}

export function selectAllPreSendProblemIds(checklist) {
  return checklist?.allProblemIds ? [...checklist.allProblemIds] : [];
}
