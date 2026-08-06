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
  isOpenPurchaseStatus,
  isPurchaseSpendCommitted,
  isPurchaseProgressCompleted,
  PURCHASE_STATUS,
} from "./purchaseStatusRules.js";

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
 * Whether an item belongs to the purchase accounting pool.
 * Client-visible + purchasable + qty > 0; not_fit always excluded.
 */
export function isPurchasePoolItem(item, options = {}) {
  const contributeCheck = options.contributeCheck === true;
  if (contributeCheck && !lineContributesToSum(item)) return false;
  if (!lineVisibleToClient(item)) return false;
  if (!isPurchasableLineType(resolveItemType(item))) return false;
  if (normalizePurchaseStatus(item) === PURCHASE_STATUS.NOT_FIT) return false;
  const qty = safeFiniteNumber(item?.qty, 0) ?? 0;
  if (!(qty > 0)) return false;
  return true;
}

/**
 * Canonical purchase summary — single source for client UI, admin list, API.
 *
 * spent = Σ committedGross for ordered/bought/delivered
 * remaining = Σ plannedGross for OPEN_PURCHASE only (never open − spent)
 * progress = count(PROGRESS_COMPLETED) / purchasePoolCount
 * have: progress completed, excluded from spent and remaining
 *
 * @param {object[]} items
 * @param {{ contributeCheck?: boolean }} [options]
 */
export function calculatePurchaseSummary(items, options = {}) {
  const list = Array.isArray(items) ? items : [];
  const pool = list.filter((it) => isPurchasePoolItem(it, options));

  let completedCount = 0;
  let openCount = 0;
  let plannedGross = 0;
  let spentGross = 0;
  let remainingGross = 0;
  let orderedGross = 0;
  let boughtGross = 0;
  let deliveredGross = 0;
  let haveGross = 0;
  let orderedCount = 0;
  let boughtCount = 0;
  let deliveredCount = 0;
  let haveCount = 0;

  for (const item of pool) {
    const status = normalizePurchaseStatus(item);
    const planned = computeLineMoney(item, { priceMode: "planned", contributeCheck: false }).gross;
    const committed = computeLineMoney(item, { priceMode: "actual", contributeCheck: false }).gross;
    plannedGross += planned;

    if (isPurchaseProgressCompleted(status)) completedCount += 1;
    if (isOpenPurchaseStatus(status)) {
      openCount += 1;
      remainingGross += planned;
    }
    if (isPurchaseSpendCommitted(status)) {
      spentGross += committed;
    }

    if (status === PURCHASE_STATUS.ORDERED) {
      orderedCount += 1;
      orderedGross += committed;
    } else if (status === PURCHASE_STATUS.BOUGHT) {
      boughtCount += 1;
      boughtGross += committed;
    } else if (status === PURCHASE_STATUS.DELIVERED) {
      deliveredCount += 1;
      deliveredGross += committed;
    } else if (status === PURCHASE_STATUS.HAVE) {
      haveCount += 1;
      haveGross += planned;
    }
  }

  const purchasePoolCount = pool.length;
  const progressPercent = purchasePoolCount
    ? Math.round((completedCount / purchasePoolCount) * 100)
    : 0;

  return {
    purchasePoolCount,
    completedCount,
    openCount,
    progressPercent,
    plannedGross,
    spentGross,
    remainingGross,
    orderedGross,
    boughtGross,
    deliveredGross,
    haveGross,
    orderedCount,
    boughtCount,
    deliveredCount,
    haveCount,
  };
}

/**
 * Aggregate purchase summaries across projects without mixing currencies.
 * @param {{ currency?: string, currencyCode?: string, items?: object[] }[]} projects
 */
export function aggregatePurchaseSummariesByCurrency(projects, options = {}) {
  const buckets = new Map();
  for (const project of projects || []) {
    const code = String(project?.currencyCode || project?.currency || "₽").trim() || "₽";
    const summary = calculatePurchaseSummary(project?.items || [], options);
    if (!buckets.has(code)) {
      buckets.set(code, {
        currency: code,
        purchasePoolCount: 0,
        completedCount: 0,
        spentGross: 0,
        remainingGross: 0,
        plannedGross: 0,
        projectCount: 0,
      });
    }
    const b = buckets.get(code);
    b.projectCount += 1;
    b.purchasePoolCount += summary.purchasePoolCount;
    b.completedCount += summary.completedCount;
    b.spentGross += summary.spentGross;
    b.remainingGross += summary.remainingGross;
    b.plannedGross += summary.plannedGross;
  }
  const list = [...buckets.values()];
  return {
    currencies: list,
    /** Single total only when every project shares one currency; otherwise null (fail-closed). */
    unified: list.length === 1 ? list[0] : null,
  };
}

/**
 * Aggregate money for a list of items.
 * purchasedTotal / remainingTotal follow calculatePurchaseSummary:
 * - purchased (spent): ordered/bought/delivered via actual gross
 * - remaining: planned gross of OPEN_PURCHASE only (not open − spent)
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

  const purchase = calculatePurchaseSummary(list, {
    contributeCheck: options.contributeCheck === true,
  });

  return {
    lines,
    netTotal,
    vatTotal,
    grossTotal,
    purchasedTotal: purchase.spentGross,
    remainingTotal: purchase.remainingGross,
    openObligationGross: purchase.remainingGross,
    doneCount: purchase.completedCount,
    purchaseCount: purchase.purchasePoolCount,
  };
}
