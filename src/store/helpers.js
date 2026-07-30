import {
  projectBudgetItems,
  clientPurchaseItems,
} from "../lib/itemHelpers.js";
import { lineVisibleToClient } from "../../shared/itemTypes.js";
import {
  normalizePurchaseStatus,
  isPurchaseStatusCompleted,
} from "../../shared/purchaseStatusRules.js";
import {
  computeItemsMoney,
  computeLineMoney,
  formatMoneyAmount,
  lineActualGross,
} from "../../shared/moneyCalc.js";

import { uid as makeUid } from "../lib/ids.js";

export const uid = makeUid;

export const money = (n, currency = "₽") => formatMoneyAmount(n, currency);

export const num = (n) => {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
};

/**
 * Клиентское форматирование количества.
 * Для штучных единиц («шт.») округляем вверх — не показываем «10.10 шт.».
 * Для остальных единиц убираем хвостовые нули (10.10 → «10,1», 10.00 → «10»).
 */
export const formatQty = (qty, unit) => {
  const v = Number(qty) || 0;
  const u = String(unit || "").trim().toLowerCase();
  const isPieces = u === "" || u.startsWith("шт") || u.startsWith("компл") || u.startsWith("pcs");
  if (isPieces) return String(Math.ceil(Math.round(v * 1000) / 1000));
  const r = Math.round(v * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r).replace(".", ",");
};

export function projectTotals(project) {
  const budgetAgg = computeItemsMoney(projectBudgetItems(project), { priceMode: "planned" });
  const budgetNet = budgetAgg.netTotal;
  const vatAmount = budgetAgg.vatTotal;
  const budget = budgetAgg.grossTotal;
  const purchasePool = clientPurchaseItems(project);
  const purchaseAgg = computeItemsMoney(purchasePool, {
    priceMode: "planned",
    contributeCheck: false,
  });
  const spent = purchaseAgg.purchasedTotal;
  const remaining = purchaseAgg.remainingTotal;
  const doneCount = purchasePool.filter((i) => isPurchaseStatusCompleted(i)).length;
  const total = purchasePool.length;
  const progress = total ? Math.round((doneCount / total) * 100) : 0;
  const overrun = Math.max(spent - budget, 0);
  let economy = 0;
  for (const i of purchasePool) {
    const s = normalizePurchaseStatus(i);
    if (s !== "bought" && s !== "delivered" && s !== "have") continue;
    const planned = computeLineMoney(i, { priceMode: "planned", contributeCheck: false }).gross;
    const actual = lineActualGross(i);
    if (actual < planned) economy += planned - actual;
  }
  return { budgetNet, vatAmount, budget, spent, remaining, overrun, economy, progress, total, doneCount };
}

export function projectStats(project) {
  const items = project.items || [];
  return {
    total: items.length,
    approved: items.filter((i) => lineVisibleToClient(i)).length,
    hidden: items.filter((i) => i.includedInProject !== false && i.enabled !== false && !lineVisibleToClient(i)).length,
    disabled: items.filter((i) => i.includedInProject === false || i.enabled === false || (Number(i.qty) || 0) === 0).length,
    noPrice: items.filter((i) => !i.price).length,
    noLink: items.filter((i) => !i.link).length,
    noImage: items.filter((i) => !i.imageUrl && !i.photoUrl).length,
    noSupplier: items.filter((i) => !i.supplier).length,
  };
}

export function groupBy(items, key) {
  const map = new Map();
  for (const it of items) {
    const k = it[key] || "Прочее";
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(it);
  }
  return [...map.entries()];
}

import { buildClientPurchaseMergedRows as buildMergedRowsShared } from "../../shared/clientPurchaseMerged.js";

/** Склеенные клиентские строки закупки (единая точка для UI / PDF / Excel). */
export function buildClientPurchaseMergedRows(items, options = {}) {
  return buildMergedRowsShared(items || [], options);
}

export function mergedPurchaseRows(items, options = {}) {
  return buildClientPurchaseMergedRows(items, options);
}

/** Склеенные строки для клиентского UI / Excel / PDF */
export function mergedItemsForClient(project, items) {
  const pool = items ?? clientPurchaseItems(project);
  return mergedPurchaseRows(pool, {
    stellageConfigs: project?.stellageConfigs || project?.stellageCounts || [],
  });
}

export function mergedPurchaseList(project) {
  return mergedItemsForClient(project);
}
