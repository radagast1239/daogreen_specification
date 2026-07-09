/** Статистика закупки для клиентского dashboard */

import { lineContributesToSum, lineVisibleToClient } from "./itemTypes.js";
import {
  normalizePurchaseStatus,
  PURCHASE_STATUS,
  isClosedPurchaseStatusId,
} from "./purchaseStatusRules.js";

const CLOSED_PURCHASE = new Set([
  PURCHASE_STATUS.BOUGHT,
  PURCHASE_STATUS.DELIVERED,
  PURCHASE_STATUS.HAVE,
]);

const ORDERED_PURCHASE = new Set([PURCHASE_STATUS.ORDERED, PURCHASE_STATUS.SEARCHING]);

function lineGross(it) {
  const net = (Number(it.qty) || 0) * (Number(it.price) || 0);
  return net + net * ((Number(it.vatRate) || 0) / 100);
}

function factSum(it) {
  const price = it.actualPrice != null ? Number(it.actualPrice) : Number(it.price) || 0;
  return (Number(it.qty) || 0) * price;
}

function pool(items) {
  return (items || []).filter((it) => lineVisibleToClient(it) && lineContributesToSum(it));
}

function purchaseStatus(it) {
  return normalizePurchaseStatus(it);
}

export function clientPurchaseDashboard(items) {
  const list = pool(items);
  let boughtCount = 0;
  let orderedCount = 0;
  let needHelpCount = 0;
  let replacementCount = 0;
  let boughtSum = 0;
  let totalSum = 0;

  for (const it of list) {
    const ps = purchaseStatus(it);
    totalSum += lineGross(it);
    if (CLOSED_PURCHASE.has(ps)) {
      boughtCount++;
      boughtSum += factSum(it);
    } else if (ORDERED_PURCHASE.has(ps)) {
      orderedCount++;
    }
    if (ps === PURCHASE_STATUS.NEED_HELP) needHelpCount++;
    if (ps === PURCHASE_STATUS.REPLACEMENT_CHECK) replacementCount++;
  }

  const remainingCount = list.length - boughtCount;
  const remainingSum = Math.max(0, totalSum - boughtSum);

  return {
    totalCount: list.length,
    boughtCount,
    orderedCount,
    needHelpCount,
    replacementCount,
    remainingCount,
    totalSum,
    boughtSum,
    remainingSum,
    progress: list.length ? Math.round((boughtCount / list.length) * 100) : 0,
  };
}

/** Карточка закупки для админского штаба проекта. */
export function buildAdminPurchaseProgress(items) {
  const list = pool(items);
  let orderedCount = 0;
  let boughtDeliveredCount = 0;
  let haveCount = 0;
  let closedCount = 0;

  for (const it of list) {
    const ps = purchaseStatus(it);
    if (ps === PURCHASE_STATUS.ORDERED || ps === PURCHASE_STATUS.SEARCHING) {
      orderedCount += 1;
    }
    if (ps === PURCHASE_STATUS.BOUGHT || ps === PURCHASE_STATUS.DELIVERED) {
      boughtDeliveredCount += 1;
      closedCount += 1;
    } else if (ps === PURCHASE_STATUS.HAVE) {
      haveCount += 1;
      closedCount += 1;
    }
  }

  const totalCount = list.length;
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
  for (const it of pool(items)) {
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
    row.totalCount++;
    row.totalSum += lineGross(it);
    if (CLOSED_PURCHASE.has(ps)) {
      row.boughtCount++;
      row.boughtSum += factSum(it);
    } else if (ORDERED_PURCHASE.has(ps)) {
      row.orderedCount++;
      row.remainingCount++;
    } else {
      row.remainingCount++;
    }
    if (ps === PURCHASE_STATUS.NEED_HELP) row.needHelpCount++;
  }
  for (const row of map.values()) {
    row.remainingSum = Math.max(0, row.totalSum - row.boughtSum);
  }
  return [...map.values()].sort((a, b) => b.totalSum - a.totalSum);
}
