import { describe, it, expect } from "vitest";
import {
  calculatePurchaseSummary,
  aggregatePurchaseSummariesByCurrency,
  computeLineMoney,
} from "../shared/moneyCalc.js";
import { projectTotals as frontendTotals } from "../src/store/helpers.js";
import { projectTotals as backendTotals } from "../backend/src/services/buildItems.js";
import { clientPurchaseDashboard } from "../shared/clientPurchaseStats.js";
import {
  PURCHASE_STATUS,
  PROGRESS_COMPLETED_STATUSES,
  SPEND_COMMITTED_STATUSES,
  OPEN_PURCHASE_STATUSES,
  isClosedPurchaseStatusId,
} from "../shared/purchaseStatusRules.js";

function item(overrides = {}) {
  return {
    id: overrides.id || "it_1",
    name: overrides.name || "Item",
    qty: 1,
    price: 100,
    vatRate: 0,
    status: "not_bought",
    actualPrice: null,
    visibleToClient: true,
    approved: true,
    enabled: true,
    includedInProject: true,
    itemType: "material",
    ...overrides,
  };
}

function parity(items) {
  const fe = frontendTotals({ currency: "₽", items });
  const be = backendTotals(items);
  const dash = clientPurchaseDashboard(items);
  const sum = calculatePurchaseSummary(items);
  return { fe, be, dash, sum };
}

describe("canonical purchase status groups", () => {
  it("exposes PROGRESS / SPEND / OPEN groups", () => {
    expect(PROGRESS_COMPLETED_STATUSES).toEqual([
      "ordered",
      "bought",
      "delivered",
      "have",
    ]);
    expect(SPEND_COMMITTED_STATUSES).toEqual(["ordered", "bought", "delivered"]);
    expect(OPEN_PURCHASE_STATUSES).toEqual([
      "not_bought",
      "searching",
      "need_help",
      "replacement_check",
    ]);
  });
});

describe("have semantics (preserve production behavior)", () => {
  it("not_bought → have: progress up, remaining down, spent unchanged", () => {
    const open = [item({ id: "a", qty: 2, price: 500, status: "not_bought" })];
    const before = calculatePurchaseSummary(open);
    expect(before.spentGross).toBe(0);
    expect(before.remainingGross).toBe(1000);
    expect(before.progressPercent).toBe(0);

    const afterHave = calculatePurchaseSummary([
      item({ id: "a", qty: 2, price: 500, status: "have" }),
    ]);
    expect(afterHave.spentGross).toBe(0);
    expect(afterHave.remainingGross).toBe(0);
    expect(afterHave.completedCount).toBe(1);
    expect(afterHave.progressPercent).toBe(100);
    expect(afterHave.haveCount).toBe(1);
    expect(isClosedPurchaseStatusId("have")).toBe(true);
  });

  it("have → not_bought: progress down, remaining restored, spent unchanged", () => {
    const have = [item({ id: "a", qty: 2, price: 500, status: "have" })];
    const mid = calculatePurchaseSummary(have);
    expect(mid.spentGross).toBe(0);
    expect(mid.remainingGross).toBe(0);

    const back = calculatePurchaseSummary([
      item({ id: "a", qty: 2, price: 500, status: "not_bought" }),
    ]);
    expect(back.spentGross).toBe(0);
    expect(back.remainingGross).toBe(1000);
    expect(back.progressPercent).toBe(0);
  });

  it("have stays in closed UI group and out of spent", () => {
    const items = [
      item({ id: "a", status: "have", price: 500, qty: 1 }),
      item({ id: "b", status: "bought", price: 200, qty: 1, actualPrice: 200 }),
    ];
    const { fe, be, dash, sum } = parity(items);
    expect(sum.spentGross).toBe(200);
    expect(sum.remainingGross).toBe(0);
    expect(sum.completedCount).toBe(2);
    expect(fe.spent).toBe(be.spent);
    expect(fe.progress).toBe(be.progress);
    expect(dash.boughtSum).toBe(200);
    expect(dash.boughtCount).toBe(2);
  });
});

describe("ordered / bought / remaining formulas", () => {
  it("1. not_bought → ordered: spent+3200, progress up, remaining drops line", () => {
    const beforeItems = [item({ id: "a", qty: 4, price: 800, status: "not_bought" })];
    const afterItems = [item({ id: "a", qty: 4, price: 800, status: "ordered" })];
    const before = parity(beforeItems);
    const after = parity(afterItems);
    expect(before.sum.spentGross).toBe(0);
    expect(before.sum.remainingGross).toBe(3200);
    expect(after.sum.spentGross).toBe(3200);
    expect(after.sum.remainingGross).toBe(0);
    expect(after.sum.progressPercent).toBe(100);
    expect(after.fe.spent).toBe(after.be.spent);
    expect(after.fe.progress).toBe(after.be.progress);
    expect(after.dash.boughtSum).toBe(3200);
  });

  it("2. ordered → bought: spent does not double; progress stays", () => {
    const ordered = [item({ id: "a", qty: 4, price: 800, status: "ordered", actualPrice: 800 })];
    const bought = [item({ id: "a", qty: 4, price: 800, status: "bought", actualPrice: 800 })];
    const o = calculatePurchaseSummary(ordered);
    const b = calculatePurchaseSummary(bought);
    expect(o.spentGross).toBe(3200);
    expect(b.spentGross).toBe(3200);
    expect(o.progressPercent).toBe(100);
    expect(b.progressPercent).toBe(100);
  });

  it("3. bought → not_bought: spent back, remaining restored", () => {
    const bought = [item({ id: "a", qty: 4, price: 800, status: "bought", actualPrice: 800 })];
    const open = [item({ id: "a", qty: 4, price: 800, status: "not_bought" })];
    expect(calculatePurchaseSummary(bought).spentGross).toBe(3200);
    const back = calculatePurchaseSummary(open);
    expect(back.spentGross).toBe(0);
    expect(back.remainingGross).toBe(3200);
  });

  it("4. actualPrice for ordered/bought", () => {
    const items = [
      item({ id: "a", qty: 4, price: 800, actualPrice: 50, status: "ordered" }),
    ];
    expect(calculatePurchaseSummary(items).spentGross).toBe(200);
    expect(calculatePurchaseSummary([
      item({ id: "a", qty: 4, price: 800, actualPrice: 50, status: "bought" }),
    ]).spentGross).toBe(200);
  });

  it("5. VAT parity frontend/backend", () => {
    const items = [item({ id: "a", qty: 2, price: 100, vatRate: 20, status: "bought", actualPrice: 100 })];
    expect(computeLineMoney(items[0], { priceMode: "actual", contributeCheck: false }).gross).toBe(240);
    const { fe, be, sum } = parity(items);
    expect(sum.spentGross).toBe(240);
    expect(fe.spent).toBe(240);
    expect(be.spent).toBe(240);
  });

  it("7. not_fit excluded from pool/spent/remaining", () => {
    const items = [
      item({ id: "a", status: "not_fit", price: 999, qty: 3 }),
      item({ id: "b", status: "not_bought", price: 100, qty: 1 }),
    ];
    const sum = calculatePurchaseSummary(items);
    expect(sum.purchasePoolCount).toBe(1);
    expect(sum.spentGross).toBe(0);
    expect(sum.remainingGross).toBe(100);
  });

  it("8. qty 0/null: zero money, no NaN", () => {
    const items = [
      item({ id: "a", qty: 0, price: 100, status: "bought", actualPrice: 100 }),
      item({ id: "b", qty: null, price: 100, status: "ordered" }),
      item({ id: "c", qty: 2, price: 50, status: "not_bought" }),
    ];
    const sum = calculatePurchaseSummary(items);
    expect(sum.purchasePoolCount).toBe(1);
    expect(sum.spentGross).toBe(0);
    expect(sum.remainingGross).toBe(100);
    expect(Number.isFinite(sum.spentGross)).toBe(true);
  });

  it("9. actualPrice = 0 uses nullish fallback (not ||)", () => {
    const items = [
      item({ id: "a", qty: 4, price: 800, actualPrice: 0, status: "bought" }),
    ];
    expect(calculatePurchaseSummary(items).spentGross).toBe(0);
    expect(
      computeLineMoney(items[0], { priceMode: "actual", contributeCheck: false }).unitPrice,
    ).toBe(0);
  });

  it("10. mixed currencies: buckets, no unified sum", () => {
    const agg = aggregatePurchaseSummariesByCurrency([
      {
        currencyCode: "RUB",
        currency: "₽",
        items: [item({ id: "a", status: "bought", qty: 1, price: 100, actualPrice: 100 })],
      },
      {
        currencyCode: "USD",
        currency: "$",
        items: [item({ id: "b", status: "bought", qty: 1, price: 50, actualPrice: 50 })],
      },
    ]);
    expect(agg.unified).toBeNull();
    expect(agg.currencies).toHaveLength(2);
    const rub = agg.currencies.find((c) => c.currency === "RUB");
    const usd = agg.currencies.find((c) => c.currency === "USD");
    expect(rub.spentGross).toBe(100);
    expect(usd.spentGross).toBe(50);
  });

  it("remaining is open planned, never open − spent", () => {
    const items = [
      item({ id: "a", status: "not_bought", price: 1000, qty: 1 }),
      item({ id: "b", status: "have", price: 500, qty: 1 }),
      item({ id: "c", status: "bought", price: 200, qty: 1, actualPrice: 200 }),
    ];
    const { fe, be, sum } = parity(items);
    expect(sum.remainingGross).toBe(1000);
    expect(fe.remaining).toBe(1000);
    expect(be.remaining).toBe(1000);
    expect(sum.spentGross).toBe(200);
  });

  it("frontend / backend / dashboard parity on mixed statuses", () => {
    const items = [
      item({ id: "o", status: "ordered", qty: 2, price: 100, actualPrice: 90 }),
      item({ id: "b", status: "bought", qty: 1, price: 50, actualPrice: 50 }),
      item({ id: "h", status: "have", qty: 1, price: 40 }),
      item({ id: "n", status: "not_bought", qty: 3, price: 10 }),
    ];
    const { fe, be, dash, sum } = parity(items);
    expect(sum.spentGross).toBe(180 + 50);
    expect(sum.remainingGross).toBe(30);
    expect(sum.completedCount).toBe(3);
    expect(fe.spent).toBe(be.spent);
    expect(fe.remaining).toBe(be.remaining);
    expect(fe.progress).toBe(be.progress);
    expect(dash.boughtSum).toBe(fe.spent);
    expect(dash.remainingSum).toBe(fe.remaining);
    expect(dash.progress).toBe(fe.progress);
  });
});
