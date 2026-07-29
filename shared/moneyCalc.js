/**
 * Canonical money helpers for specification totals and exports.
 *
 * Rules (match existing project semantics — do not invent new VAT math):
 * - Internal ops keep full JS Number precision; do not round each step.
 * - Display / final money uses Math.round (same as legacy money()).
 * - lineNet = qty * unitPrice; vatAmount = net * (vatRate/100); gross = net + vatAmount.
 * - Non-contributing lines (lineContributesToSum) yield zeros with contributes:false.
 */

import { lineContributesToSum, lineVisibleToClient, isPurchasableLineType, resolveItemType } from "./itemTypes.js";
import {
  normalizePurchaseStatus,
  shouldCountInPurchaseBudget,
  isPurchaseStatusCompleted,
} from "./purchaseStatusRules.js";

const DONE_SPENT = new Set(["bought", "delivered"]);

/**
 * Parse a numeric value; never returns NaN/Infinity.
 * @param {*} v
 * @param {number|null} [fallback=null] — used when missing/invalid
 * @returns {number|null}
 */
export function safeFiniteNumber(v, fallback = null) {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

/**
 * Display/final money: Math.round with finite guard (matches legacy money()).
 * @param {*} n
 * @returns {number}
 */
export function roundMoney(n) {
  const v = safeFiniteNumber(n, 0);
  return Math.round(v ?? 0);
}

function resolveCurrencySymbolArg(currencyOrSymbol) {
  if (currencyOrSymbol && typeof currencyOrSymbol === "object") {
    const fromObj = currencyOrSymbol.currencySymbol;
    if (fromObj != null && fromObj !== "") return String(fromObj);
    // Prefer code/meta over hard-coded RUB when symbol field is missing.
    try {
      // Lazy import avoided: normalize via shared helper when available on object.
      const code = currencyOrSymbol.currencyCode;
      if (code != null && String(code).trim()) {
        const upper = String(code).trim().toUpperCase();
        if (upper === "USD") return "$";
        if (upper === "EUR") return "€";
        if (upper === "RUB") return "₽";
        if (upper === "AED") return "AED";
        if (upper === "KZT") return "₸";
        if (upper === "INR") return "₹";
        return upper;
      }
      if (currencyOrSymbol.currency != null && currencyOrSymbol.currency !== "") {
        return String(currencyOrSymbol.currency);
      }
    } catch {
      /* ignore */
    }
    return "₽";
  }
  if (currencyOrSymbol == null || currencyOrSymbol === "") return "₽";
  return String(currencyOrSymbol);
}

/**
 * Locale money string. Currency symbol is a parameter — no hardcoded ₽ inside.
 * Accepts a symbol string or a currency descriptor `{ currencySymbol }`.
 * @param {*} n
 * @param {string|object} [currencyOrSymbol="₽"]
 * @returns {string}
 */
export function formatMoneyAmount(n, currencyOrSymbol = "₽") {
  const v = roundMoney(n);
  const cur = resolveCurrencySymbolArg(currencyOrSymbol);
  return `${v.toLocaleString("ru-RU")} ${cur}`;
}

/**
 * Excel numFmt for a currency suffix (RUB default looks like legacy '#,##0" ₽"').
 * Accepts a symbol string or a currency descriptor `{ currencySymbol }`.
 * @param {string|object} [currencyOrSymbol="₽"]
 * @returns {string}
 */
export function excelCurrencyNumFmt(currencyOrSymbol = "₽") {
  const s = resolveCurrencySymbolArg(currencyOrSymbol);
  // Escape double-quotes inside format string
  const escaped = s.replace(/"/g, '""');
  return `#,##0" ${escaped}"`;
}

function resolveUnitPrice(item, priceMode) {
  if (priceMode === "actual") {
    const actual = item?.actualPrice;
    if (actual != null && actual !== "") {
      const n = safeFiniteNumber(actual, null);
      return n == null ? 0 : n;
    }
  }
  const planned = item?.price;
  if (planned == null || planned === "") return 0;
  const n = safeFiniteNumber(planned, null);
  return n == null ? 0 : n;
}

/**
 * Per-line money breakdown.
 * @param {object} item
 * @param {{ priceMode?: "planned"|"actual", contributeCheck?: boolean }} [options]
 * @returns {{ quantity: number, unitPrice: number, net: number, vatRate: number, vatAmount: number, gross: number, contributes: boolean }}
 */
export function computeLineMoney(item, options = {}) {
  const priceMode = options.priceMode === "actual" ? "actual" : "planned";
  const contributeCheck = options.contributeCheck !== false;

  const contributes = contributeCheck ? lineContributesToSum(item) : true;
  if (!contributes) {
    return {
      quantity: 0,
      unitPrice: 0,
      net: 0,
      vatRate: 0,
      vatAmount: 0,
      gross: 0,
      contributes: false,
    };
  }

  const quantity = safeFiniteNumber(item?.qty, 0) ?? 0;
  const unitPrice = resolveUnitPrice(item, priceMode);
  const vatRate = safeFiniteNumber(item?.vatRate, 0) ?? 0;
  const net = quantity * unitPrice;
  const vatAmount = net * (vatRate / 100);
  const gross = net + vatAmount;

  return {
    quantity,
    unitPrice,
    net,
    vatRate,
    vatAmount,
    gross,
    contributes: true,
  };
}

/** Thin wrappers — same formulas as legacy itemHelpers. */
export function lineNet(it) {
  return computeLineMoney(it, { priceMode: "planned" }).net;
}

export function lineVat(it) {
  return computeLineMoney(it, { priceMode: "planned" }).vatAmount;
}

export function lineGross(it) {
  return computeLineMoney(it, { priceMode: "planned" }).gross;
}

export function lineActualGross(it) {
  return computeLineMoney(it, { priceMode: "actual" }).gross;
}

/**
 * Aggregate money for a list of items.
 * purchasedTotal / remainingTotal follow projectTotals purchase-status semantics:
 * - purchased (spent): bought/delivered via actual gross
 * - remaining: max(openObligationPlannedGross - spent, 0)
 *   where open obligation uses shouldCountInPurchaseBudget and planned gross
 *
 * @param {object[]} items
 * @param {{ priceMode?: "planned"|"actual", contributeCheck?: boolean }} [options]
 */
export function computeItemsMoney(items, options = {}) {
  const priceMode = options.priceMode === "actual" ? "actual" : "planned";
  const contributeCheck = options.contributeCheck !== false;
  const list = Array.isArray(items) ? items : [];

  const lines = list.map((item) => {
    const money = computeLineMoney(item, { priceMode, contributeCheck });
    return { item, ...money };
  });

  let netTotal = 0;
  let vatTotal = 0;
  let grossTotal = 0;
  for (const line of lines) {
    if (!line.contributes) continue;
    netTotal += line.net;
    vatTotal += line.vatAmount;
    grossTotal += line.gross;
  }

  // Purchase pools mirror projectTotals / clientPurchaseItems filters lightly:
  // visible + purchasable + contributing when contributeCheck is on.
  const purchasePool = list.filter((it) => {
    if (contributeCheck && !lineContributesToSum(it)) return false;
    if (!lineVisibleToClient(it)) return false;
    if (!isPurchasableLineType(resolveItemType(it))) return false;
    return true;
  });

  const obligationPool = purchasePool.filter((i) => shouldCountInPurchaseBudget(i));

  let purchasedTotal = 0;
  for (const i of purchasePool) {
    const s = normalizePurchaseStatus(i);
    if (!DONE_SPENT.has(s)) continue;
    purchasedTotal += computeLineMoney(i, { priceMode: "actual", contributeCheck: false }).gross;
  }

  let openObligationGross = 0;
  for (const i of obligationPool) {
    const s = normalizePurchaseStatus(i);
    if (s === "bought" || s === "delivered") continue;
    openObligationGross += computeLineMoney(i, { priceMode: "planned", contributeCheck: false }).gross;
  }

  const remainingTotal = Math.max(openObligationGross - purchasedTotal, 0);

  return {
    lines,
    netTotal,
    vatTotal,
    grossTotal,
    purchasedTotal,
    remainingTotal,
    // extras useful for UI parity with projectTotals
    openObligationGross,
    doneCount: purchasePool.filter((i) => isPurchaseStatusCompleted(i)).length,
    purchaseCount: purchasePool.length,
  };
}
