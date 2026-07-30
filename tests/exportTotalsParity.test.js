import { describe, it, expect } from "vitest";
import {
  computeLineMoney,
  computeItemsMoney,
  roundMoney,
  formatMoneyAmount,
  excelCurrencyNumFmt,
  lineNet,
  lineVat,
  lineGross,
  lineActualGross,
  safeFiniteNumber,
} from "../shared/moneyCalc.js";
import { isSafeExcelHyperlink, excelCellText, safeExcelHyperlinkTarget } from "../shared/excelSafeLink.js";
import { publishedPlannedTotal, actualPurchaseTotal } from "../shared/publishedPurchaseTotals.js";
import { buildClientPurchaseMergedRows } from "../shared/clientPurchaseMerged.js";
import { formatClientLineTotal } from "../shared/clientPurchaseRows.js";
import { projectTotals, money } from "../src/store/helpers.js";
import {
  buildDraftExportProject,
  buildPublishedExportProject,
  resolveAdminClientExportProject,
} from "../src/lib/exportProjectContext.js";
import { lineGross as itemHelpersGross, lineNet as itemHelpersNet } from "../src/lib/itemHelpers.js";

function baseItem(over = {}) {
  return {
    id: "i1",
    name: "Позиция",
    qty: 10,
    price: 100,
    vatRate: 20,
    unit: "шт",
    itemType: "material",
    includedInProject: true,
    enabled: true,
    visibleToClient: true,
    approved: true,
    status: "not_bought",
    ...over,
  };
}

describe("moneyCalc base (scenarios 1–8)", () => {
  it("1: 10×100 VAT20 → net 1000, vat 200, gross 1200", () => {
    const m = computeLineMoney(baseItem());
    expect(m.net).toBe(1000);
    expect(m.vatAmount).toBe(200);
    expect(m.gross).toBe(1200);
    expect(m.contributes).toBe(true);
  });

  it("2: VAT0 → gross = net", () => {
    const m = computeLineMoney(baseItem({ vatRate: 0 }));
    expect(m.net).toBe(1000);
    expect(m.vatAmount).toBe(0);
    expect(m.gross).toBe(1000);
  });

  it("3: price 0 kept, gross 0", () => {
    const m = computeLineMoney(baseItem({ price: 0 }));
    expect(m.unitPrice).toBe(0);
    expect(m.gross).toBe(0);
  });

  it("4: qty 0 → gross 0", () => {
    expect(computeLineMoney(baseItem({ qty: 0 })).gross).toBe(0);
  });

  it("5: fractional qty/price keeps precision until round", () => {
    const m = computeLineMoney(baseItem({ qty: 1.5, price: 33.33, vatRate: 20 }));
    expect(m.net).toBeCloseTo(49.995, 10);
    expect(roundMoney(m.gross)).toBe(60);
  });

  it("6: many lines with kopecks aggregate then round", () => {
    const items = Array.from({ length: 3 }, (_, i) =>
      baseItem({ id: `k${i}`, qty: 1, price: 10.4, vatRate: 0 })
    );
    const agg = computeItemsMoney(items);
    expect(agg.grossTotal).toBeCloseTo(31.2, 10);
    expect(roundMoney(agg.grossTotal)).toBe(31);
  });

  it("7: non-contributing section/subtotal zeros", () => {
    const m = computeLineMoney(baseItem({ itemType: "subtotal" }));
    expect(m.contributes).toBe(false);
    expect(m.gross).toBe(0);
  });

  it("8: purchased/remaining follow projectTotals semantics", () => {
    const items = [
      baseItem({ id: "a", status: "not_bought", price: 1000, qty: 1, vatRate: 0 }),
      baseItem({ id: "b", status: "have", price: 500, qty: 1, vatRate: 0 }),
      baseItem({ id: "c", status: "bought", price: 200, qty: 1, actualPrice: 200, vatRate: 0 }),
    ];
    const t = projectTotals({ currency: "₽", items });
    expect(t.remaining).toBe(800);
    expect(t.spent).toBe(200);
  });
});

describe("parity across layers (scenarios 9–16)", () => {
  const items = [
    baseItem({ id: "a", qty: 2, price: 100, vatRate: 20 }),
    baseItem({ id: "b", qty: 1, price: 50, vatRate: 0 }),
  ];

  it("9–10: shared helpers match itemHelpers", () => {
    for (const it of items) {
      expect(lineNet(it)).toBe(itemHelpersNet(it));
      expect(lineGross(it)).toBe(itemHelpersGross(it));
    }
  });

  it("11–12: admin projectTotals budget matches computeItemsMoney", () => {
    const t = projectTotals({ items });
    const agg = computeItemsMoney(items);
    expect(t.budgetNet).toBe(agg.netTotal);
    expect(t.vatAmount).toBe(agg.vatTotal);
    expect(t.budget).toBe(agg.grossTotal);
  });

  it("13: published totals use moneyCalc", () => {
    expect(publishedPlannedTotal(items)).toBe(roundMoney(items.reduce((s, i) => s + lineGross(i), 0)));
    const withActual = items.map((i) => ({ ...i, actualPrice: 10 }));
    expect(actualPurchaseTotal(withActual)).toBe(
      roundMoney(withActual.reduce((s, i) => s + lineActualGross(i), 0))
    );
  });

  it("14: client merged sumVat equals planned gross", () => {
    const merged = buildClientPurchaseMergedRows(items);
    const gross = roundMoney(items.reduce((s, i) => s + lineGross(i), 0));
    const mergedGross = roundMoney(merged.reduce((s, r) => s + r.sumVat, 0));
    expect(mergedGross).toBe(gross);
  });

  it("15–16: formatClientLineTotal / money() use shared rounding", () => {
    const row = buildClientPurchaseMergedRows([baseItem()])[0];
    expect(formatClientLineTotal(row)).toBe(1200);
    expect(money(1200, "₽")).toBe(formatMoneyAmount(1200, "₽"));
  });
});

describe("draft vs published export (scenarios 17–21)", () => {
  const live = {
    id: "p1",
    name: "LIVE NAME",
    client: "LIVE CLIENT",
    currency: "$",
    items: [baseItem({ id: "a", price: 999 })],
    publishedRelease: { versionNumber: 3 },
    publishedSnapshotItems: [baseItem({ id: "a", price: 100, vatRate: 20 })],
    publishedSnapshotMeta: {
      name: "PUB NAME",
      client: "PUB CLIENT",
      city: "Москва",
      currency: "₽",
      vat: true,
      stellageCounts: [{ id: "s1", count: 2 }],
      versionNumber: 3,
    },
    publishedStellageCounts: [{ id: "s1", count: 2 }],
    clientToken: "tok",
  };

  it("17–18: published export ignores live name/currency/price", () => {
    const pub = buildPublishedExportProject(live);
    expect(pub.exportKind).toBe("published");
    expect(pub.name).toBe("PUB NAME");
    expect(pub.client).toBe("PUB CLIENT");
    expect(pub.currency).toBe("₽");
    expect(pub.items[0].price).toBe(100);
    expect(pub.version).toBe(3);
  });

  it("19: draft reflects live fields", () => {
    const draft = buildDraftExportProject(live);
    expect(draft.exportKind).toBe("draft");
    expect(draft.name).toBe("LIVE NAME");
    expect(draft.currency).toBe("$");
    expect(draft.items[0].price).toBe(999);
  });

  it("20: resolveAdmin picks published when release present", () => {
    const resolved = resolveAdminClientExportProject(live);
    expect(resolved.exportKind).toBe("published");
    expect(resolved.name).toBe("PUB NAME");
  });

  it("21: new publish meta updates published export", () => {
    const next = {
      ...live,
      publishedRelease: { versionNumber: 4 },
      publishedSnapshotMeta: { ...live.publishedSnapshotMeta, name: "NEW PUB", versionNumber: 4 },
      publishedSnapshotItems: [baseItem({ id: "a", price: 200, vatRate: 0 })],
    };
    const pub = buildPublishedExportProject(next);
    expect(pub.name).toBe("NEW PUB");
    expect(pub.items[0].price).toBe(200);
    expect(pub.version).toBe(4);
  });
});

describe("admin excel gross + VAT (scenarios 22–24)", () => {
  it("22–23: line sum uses gross with VAT, no double VAT", () => {
    const it = baseItem({ qty: 10, price: 100, vatRate: 20 });
    const m = computeLineMoney(it, { priceMode: "planned" });
    expect(roundMoney(m.gross)).toBe(1200);
    expect(roundMoney(m.net + m.vatAmount)).toBe(1200);
    // not net-only
    expect(roundMoney(m.net)).toBe(1000);
  });

  it("24: row sums equal aggregate", () => {
    const items = [baseItem({ id: "a" }), baseItem({ id: "b", qty: 1, price: 50, vatRate: 0 })];
    const rows = items.map((it) => roundMoney(computeLineMoney(it).gross));
    const total = roundMoney(computeItemsMoney(items).grossTotal);
    expect(rows.reduce((s, n) => s + n, 0)).toBe(total);
  });
});

describe("excel hyperlink + formula injection (scenarios 25–32)", () => {
  it("25–26: allow http/https", () => {
    expect(isSafeExcelHyperlink("https://example.com/x")).toBe(true);
    expect(isSafeExcelHyperlink("http://example.com/x")).toBe(true);
  });

  it("27–29: reject javascript/file/data/UNC/mailto", () => {
    expect(isSafeExcelHyperlink("javascript:alert(1)")).toBe(false);
    expect(isSafeExcelHyperlink("file:///etc/passwd")).toBe(false);
    expect(isSafeExcelHyperlink("data:text/html,hi")).toBe(false);
    expect(isSafeExcelHyperlink("\\\\server\\share")).toBe(false);
    expect(isSafeExcelHyperlink("mailto:a@b.c")).toBe(false);
  });

  it("30: malformed rejected", () => {
    expect(isSafeExcelHyperlink("not a url")).toBe(false);
    expect(safeExcelHyperlinkTarget("javascript:x")).toBe(null);
  });

  it("31–32: formula injection guard", () => {
    expect(excelCellText("=CMD()")).toBe("'=CMD()");
    expect(excelCellText("+1+1")).toBe("'+1+1");
    expect(excelCellText("-1+1")).toBe("'-1+1");
    expect(excelCellText("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(excelCellText("normal")).toBe("normal");
    expect(excelCellText(42)).toBe(42);
  });
});

describe("currency passthrough (scenarios 33–35)", () => {
  it("33: formatMoneyAmount uses provided symbol", () => {
    expect(formatMoneyAmount(1000, "€")).toBe("1\u00a0000 €");
  });

  it("34: default remains ₽", () => {
    expect(formatMoneyAmount(100)).toMatch(/₽$/);
    expect(excelCurrencyNumFmt()).toBe('#,##0" ₽"');
  });

  it("35: excelCurrencyNumFmt passthrough", () => {
    expect(excelCurrencyNumFmt("$")).toBe('#,##0" $"');
  });

  it("safeFiniteNumber never yields NaN", () => {
    expect(safeFiniteNumber(NaN, null)).toBe(null);
    expect(safeFiniteNumber(Infinity, 0)).toBe(0);
    expect(safeFiniteNumber("", null)).toBe(null);
    expect(computeLineMoney(baseItem({ price: "nope" })).gross).toBe(0);
  });
});
