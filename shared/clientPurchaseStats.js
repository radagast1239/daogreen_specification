/** Статистика закупки для клиентского dashboard */

import {
  normalizePurchaseStatus,
  PURCHASE_STATUS,
  isClosedPurchaseStatusId,
  isPurchaseProgressCompleted,
  isPurchaseSpendCommitted,
  isOpenPurchaseStatus,
} from "./purchaseStatusRules.js";
import { calculatePurchaseSummary, isPurchasePoolItem } from "./moneyCalc.js";
import { lineVisibleToClient, lineContributesToSum } from "./itemTypes.js";

function pool(items) {
  // Attention chips historically used contribute+visible; money/progress use purchase pool.
  return (items || []).filter((it) => lineVisibleToClient(it) && lineContributesToSum(it));
}

function purchaseStatus(it) {
  return normalizePurchaseStatus(it);
}

export function clientPurchaseDashboard(items) {
  const summary = calculatePurchaseSummary(items || []);
  const list = pool(items);
  let needHelpCount = 0;
  let replacementCount = 0;
  let searchingCount = 0;
  for (const it of list) {
    const ps = purchaseStatus(it);
    if (ps === PURCHASE_STATUS.NEED_HELP) needHelpCount++;
    if (ps === PURCHASE_STATUS.REPLACEMENT_CHECK) replacementCount++;
    if (ps === PURCHASE_STATUS.SEARCHING) searchingCount++;
  }

  // boughtCount/boughtSum = progress-completed / spent (includes ordered; excludes have from spent)
  return {
    totalCount: summary.purchasePoolCount,
    boughtCount: summary.completedCount,
    orderedCount: summary.orderedCount + searchingCount,
    needHelpCount,
    replacementCount,
    remainingCount: summary.openCount,
    totalSum: summary.plannedGross,
    boughtSum: summary.spentGross,
    remainingSum: summary.remainingGross,
    progress: summary.progressPercent,
    orderedGross: summary.orderedGross,
    boughtGross: summary.boughtGross,
    deliveredGross: summary.deliveredGross,
    haveCount: summary.haveCount,
  };
}

/** Карточка закупки для админского штаба проекта. */
export function buildAdminPurchaseProgress(items) {
  const summary = calculatePurchaseSummary(items || []);
  const orderedCount = summary.orderedCount;
  const boughtDeliveredCount = summary.boughtCount + summary.deliveredCount;
  const haveCount = summary.haveCount;
  const closedCount = summary.completedCount;
  const totalCount = summary.purchasePoolCount;
  const detail = `заказано: ${orderedCount} · куплено/доставлено: ${boughtDeliveredCount}`;

  return {
    totalCount,
    closedCount,
    orderedCount,
    boughtDeliveredCount,
    haveCount,
    show: totalCount > 0,
    headline: `${closedCount} из ${totalCount} закрыто`,
    title: "Закупка",
    detail,
    /** @deprecated legacy alias */
    isClosed: (it) => isClosedPurchaseStatusId(it),
  };
}

export function supplierPurchaseProgress(items) {
  const map = new Map();
  for (const it of (items || []).filter((i) => isPurchasePoolItem(i))) {
    const supplier = (it.supplier || "").trim() || "— без поставщика —";
    if (!map.has(supplier)) {
      map.set(supplier, {
        supplier,
        totalCount: 0,
        boughtCount: 0,
        orderedCount: 0,
        needHelpCount: 0,
        remainingCount: 0,
        totalSum: 0,
        boughtSum: 0,
        remainingSum: 0,
      });
    }
    const row = map.get(supplier);
    const ps = purchaseStatus(it);
    const lineSummary = calculatePurchaseSummary([it]);
    const planned = lineSummary.plannedGross;
    row.totalCount++;
    row.totalSum += planned;
    if (isPurchaseProgressCompleted(ps)) {
      row.boughtCount++;
    }
    if (isPurchaseSpendCommitted(ps)) {
      row.boughtSum += lineSummary.spentGross;
    }
    if (ps === PURCHASE_STATUS.ORDERED || ps === PURCHASE_STATUS.SEARCHING) {
      row.orderedCount++;
    }
    if (isOpenPurchaseStatus(ps)) {
      row.remainingCount++;
      row.remainingSum += lineSummary.remainingGross;
    }
    if (ps === PURCHASE_STATUS.NEED_HELP) row.needHelpCount++;
  }
  return [...map.values()].sort((a, b) => b.totalSum - a.totalSum);
}
