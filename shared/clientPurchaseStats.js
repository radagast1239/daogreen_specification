/** Статистика закупки для клиентского dashboard */

import { lineContributesToSum, lineVisibleToClient } from "./itemTypes.js";

const BOUGHT = new Set(["bought", "delivered", "have"]);
const ORDERED = new Set(["ordered", "searching"]);

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

export function clientPurchaseDashboard(items) {
  const list = pool(items);
  let boughtCount = 0;
  let orderedCount = 0;
  let needHelpCount = 0;
  let replacementCount = 0;
  let boughtSum = 0;
  let totalSum = 0;

  for (const it of list) {
    totalSum += lineGross(it);
    if (BOUGHT.has(it.status)) {
      boughtCount++;
      boughtSum += factSum(it);
    } else if (ORDERED.has(it.status)) {
      orderedCount++;
    }
    if (it.status === "need_help") needHelpCount++;
    if (it.status === "replacement_check") replacementCount++;
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
    row.totalCount++;
    row.totalSum += lineGross(it);
    if (BOUGHT.has(it.status)) {
      row.boughtCount++;
      row.boughtSum += factSum(it);
    } else if (ORDERED.has(it.status)) {
      row.orderedCount++;
      row.remainingCount++;
    } else {
      row.remainingCount++;
    }
    if (it.status === "need_help") row.needHelpCount++;
  }
  for (const row of map.values()) {
    row.remainingSum = Math.max(0, row.totalSum - row.boughtSum);
  }
  return [...map.values()].sort((a, b) => b.totalSum - a.totalSum);
}
