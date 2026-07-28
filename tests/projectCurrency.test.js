import { describe, it, expect } from "vitest";
import {
  PROJECT_CURRENCY_PRESETS,
  DEFAULT_PROJECT_CURRENCY,
  normalizeProjectCurrency,
  applyCurrencyToProjectFields,
  validateProjectCurrencyInput,
  resolveMoneyDisplaySymbol,
  formatMoneyForPdf,
  pdfCurrencySuffix,
  isPdfSymbolGlyphSafe,
  isExcelNumFmtSafeSymbol,
  currencyFieldsForApi,
  resolveCurrencyPersistFromBody,
  defaultCurrencyPersist,
} from "../shared/projectCurrency.js";
import {
  formatMoneyAmount,
  excelCurrencyNumFmt,
  computeLineMoney,
  roundMoney,
} from "../shared/moneyCalc.js";
import { buildReleaseSnapshotPayload } from "../shared/projectPublishedRelease.js";
import {
  buildDraftExportProject,
  buildPublishedExportProject,
} from "../src/lib/exportProjectContext.js";

describe("projectCurrency presets (1–6)", () => {
  it("1: has six presets", () => {
    expect(PROJECT_CURRENCY_PRESETS).toHaveLength(6);
  });

  it("2: default is RUB", () => {
    expect(DEFAULT_PROJECT_CURRENCY.code).toBe("RUB");
    expect(DEFAULT_PROJECT_CURRENCY.symbol).toBe("₽");
  });

  it("3: USD preset", () => {
    const p = PROJECT_CURRENCY_PRESETS.find((x) => x.code === "USD");
    expect(p.symbol).toBe("$");
  });

  it("4: EUR preset", () => {
    expect(PROJECT_CURRENCY_PRESETS.find((x) => x.code === "EUR").symbol).toBe("€");
  });

  it("5: AED / KZT / INR present", () => {
    expect(PROJECT_CURRENCY_PRESETS.map((p) => p.code)).toEqual(
      expect.arrayContaining(["AED", "KZT", "INR"]),
    );
  });

  it("6: normalize empty → RUB", () => {
    const d = normalizeProjectCurrency({});
    expect(d).toMatchObject({
      currencyCode: "RUB",
      currencySymbol: "₽",
      currencyCustom: false,
    });
  });
});

describe("projectCurrency custom (7–14)", () => {
  it("7: valid custom accepted", () => {
    const d = validateProjectCurrencyInput({
      currencyCustom: true,
      currencyCode: "gel",
      currencySymbol: "₾",
      currencyName: "Лари",
    });
    expect(d.currencyCode).toBe("GEL");
    expect(d.currencyCustom).toBe(true);
  });

  it("8: custom code too long rejected", () => {
    try {
      validateProjectCurrencyInput({
        currencyCustom: true,
        currencyCode: "ABCDEFGHIJK",
        currencySymbol: "X",
        currencyName: "X",
      });
      expect.fail("should throw");
    } catch (e) {
      expect(e.code).toBe("PROJECT_CURRENCY_INVALID");
    }
  });

  it("9: custom code with invalid chars rejected", () => {
    expect(() =>
      validateProjectCurrencyInput({
        currencyCustom: true,
        currencyCode: "US$",
        currencySymbol: "X",
        currencyName: "X",
      }),
    ).toThrow();
  });

  it("10: custom symbol HTML rejected", () => {
    expect(() =>
      validateProjectCurrencyInput({
        currencyCustom: true,
        currencyCode: "XXX",
        currencySymbol: "<b>x</b>",
        currencyName: "X",
      }),
    ).toThrow();
  });

  it("11: custom name newline rejected", () => {
    expect(() =>
      validateProjectCurrencyInput({
        currencyCustom: true,
        currencyCode: "XXX",
        currencySymbol: "X",
        currencyName: "Bad\nName",
      }),
    ).toThrow();
  });

  it("12: preset whitelist only for non-custom", () => {
    expect(() =>
      validateProjectCurrencyInput({ currencyCode: "BTC", currencyCustom: false }),
    ).toThrow();
  });

  it("13: applyCurrencyToProjectFields writes symbol + meta", () => {
    const applied = applyCurrencyToProjectFields({
      currencyCode: "USD",
      currencySymbol: "$",
      currencyName: "Доллар США",
      currencyCustom: false,
    });
    expect(applied.currency).toBe("$");
    expect(applied.manualParamsPatch.currencyMeta).toEqual({
      code: "USD",
      symbol: "$",
      name: "Доллар США",
      custom: false,
    });
  });

  it("14: currencyFieldsForApi shape", () => {
    const f = currencyFieldsForApi(normalizeProjectCurrency({ currency: "€" }));
    expect(f.currencyCode).toBe("EUR");
    expect(f.currency).toBe("€");
  });
});

describe("projectCurrency backward compat (15–17)", () => {
  it("15: legacy currency ₽ → RUB", () => {
    expect(normalizeProjectCurrency({ currency: "₽" }).currencyCode).toBe("RUB");
  });

  it("16: legacy $ / € map to presets", () => {
    expect(normalizeProjectCurrency({ currency: "$" }).currencyCode).toBe("USD");
    expect(normalizeProjectCurrency({ currency: "€" }).currencyCode).toBe("EUR");
  });

  it("17: currencyMeta preferred when present", () => {
    const d = normalizeProjectCurrency({
      currency: "₽",
      manualParams: {
        currencyMeta: { code: "USD", symbol: "$", name: "Доллар США", custom: false },
      },
    });
    expect(d.currencyCode).toBe("USD");
    expect(d.currencySymbol).toBe("$");
  });
});

describe("projectCurrency release freeze (18–21)", () => {
  it("18: snapshot freezes full currency fields", () => {
    const payload = buildReleaseSnapshotPayload({
      id: "p1",
      name: "N",
      currency: "$",
      currencyCode: "USD",
      currencyName: "Доллар США",
      currencyCustom: false,
      vat: true,
      version: 2,
      manualParams: {
        currencyMeta: { code: "USD", symbol: "$", name: "Доллар США", custom: false },
      },
    }, []);
    expect(payload.projectMeta.currency).toBe("$");
    expect(payload.projectMeta.currencyCode).toBe("USD");
    expect(payload.projectMeta.currencySymbol).toBe("$");
    expect(payload.projectMeta.currencyCustom).toBe(false);
  });

  it("19: legacy release meta without code → RUB", () => {
    const d = normalizeProjectCurrency({ currency: "₽" });
    expect(d.currencyCode).toBe("RUB");
  });

  it("20: published export ignores live currency", () => {
    const pub = buildPublishedExportProject({
      currency: "$",
      publishedRelease: { versionNumber: 1 },
      publishedSnapshotMeta: { name: "P", currency: "₽", currencyCode: "RUB" },
      publishedSnapshotItems: [],
    });
    expect(pub.currency).toBe("₽");
    expect(pub.currencyCode).toBe("RUB");
  });

  it("21: draft export uses live currency", () => {
    const draft = buildDraftExportProject({
      name: "X",
      currency: "$",
      manualParams: { currencyMeta: { code: "USD", symbol: "$", name: "USD", custom: false } },
    });
    expect(draft.currency).toBe("$");
    expect(draft.currencyCode).toBe("USD");
  });
});

describe("projectCurrency parity helpers (22–28)", () => {
  it("22: resolveMoneyDisplaySymbol", () => {
    expect(resolveMoneyDisplaySymbol({ currencySymbol: "€" })).toBe("€");
  });

  it("23: formatMoneyAmount accepts descriptor", () => {
    expect(formatMoneyAmount(1000, { currencySymbol: "$" })).toMatch(/\$$/);
  });

  it("24: excelCurrencyNumFmt accepts descriptor", () => {
    expect(excelCurrencyNumFmt({ currencySymbol: "€" })).toBe('#,##0" €"');
  });

  it("25: defaultCurrencyPersist is RUB", () => {
    expect(defaultCurrencyPersist().currency).toBe("₽");
  });

  it("26: resolveCurrencyPersistFromBody null when absent", () => {
    expect(resolveCurrencyPersistFromBody({ name: "x" })).toBeNull();
  });

  it("27: resolveCurrencyPersistFromBody validates USD", () => {
    const p = resolveCurrencyPersistFromBody({ currencyCode: "USD" });
    expect(p.currency).toBe("$");
  });

  it("28: invalid body throws PROJECT_CURRENCY_INVALID", () => {
    try {
      resolveCurrencyPersistFromBody({ currencyCode: "NOPE" });
      expect.fail("should throw");
    } catch (e) {
      expect(e.code).toBe("PROJECT_CURRENCY_INVALID");
    }
  });
});

describe("projectCurrency PDF symbols (29–35)", () => {
  it("29: RUB symbol pdf-safe", () => {
    expect(isPdfSymbolGlyphSafe("₽")).toBe(true);
  });

  it("30: USD/EUR pdf-safe", () => {
    expect(isPdfSymbolGlyphSafe("$")).toBe(true);
    expect(isPdfSymbolGlyphSafe("€")).toBe(true);
  });

  it("31: AED Arabic not pdf-safe", () => {
    expect(isPdfSymbolGlyphSafe("د.إ")).toBe(false);
  });

  it("32: pdfCurrencySuffix falls back to AED code", () => {
    const desc = normalizeProjectCurrency({ currencyCode: "AED" });
    expect(pdfCurrencySuffix(desc)).toBe("AED");
  });

  it("33: pdfCurrencySuffix keeps USD symbol", () => {
    expect(pdfCurrencySuffix(normalizeProjectCurrency({ currencyCode: "USD" }))).toBe("$");
  });

  it("34: formatMoneyForPdf AED uses code", () => {
    const s = formatMoneyForPdf(1200, normalizeProjectCurrency({ currencyCode: "AED" }));
    expect(s).toMatch(/AED$/);
    expect(s).not.toMatch(/د/);
  });

  it("35: glyphSafe option forces code", () => {
    expect(pdfCurrencySuffix(normalizeProjectCurrency({ currencyCode: "USD" }), { glyphSafe: true })).toBe("USD");
  });
});

describe("projectCurrency Excel safety (36–39)", () => {
  it("36: safe symbols accepted", () => {
    expect(isExcelNumFmtSafeSymbol("₽")).toBe(true);
    expect(isExcelNumFmtSafeSymbol("$")).toBe(true);
  });

  it("37: quote / semicolon rejected", () => {
    expect(isExcelNumFmtSafeSymbol('a"b')).toBe(false);
    expect(isExcelNumFmtSafeSymbol("a;b")).toBe(false);
  });

  it("38: formula-like prefix rejected", () => {
    expect(isExcelNumFmtSafeSymbol("=1+1")).toBe(false);
    expect(isExcelNumFmtSafeSymbol("+x")).toBe(false);
    expect(isExcelNumFmtSafeSymbol("-x")).toBe(false);
    expect(isExcelNumFmtSafeSymbol("@x")).toBe(false);
  });

  it("39: custom unsafe uses code path via helper", () => {
    const desc = validateProjectCurrencyInput({
      currencyCustom: true,
      currencyCode: "XXX",
      currencySymbol: "=BAD",
      currencyName: "Bad",
    });
    expect(isExcelNumFmtSafeSymbol(desc.currencySymbol)).toBe(false);
  });
});

describe("projectCurrency no conversion (40–42)", () => {
  it("40: amounts unchanged RUB→USD", () => {
    const item = { qty: 10, price: 100, vatRate: 20, itemType: "material", includedInProject: true, enabled: true };
    const before = computeLineMoney(item);
    const rub = formatMoneyAmount(before.gross, "₽");
    const usd = formatMoneyAmount(before.gross, "$");
    expect(roundMoney(before.gross)).toBe(1200);
    expect(rub.startsWith(usd.slice(0, usd.lastIndexOf(" ")))).toBe(true);
    expect(rub).not.toBe(usd);
  });

  it("41: numeric gross identical across currency descriptors", () => {
    const item = { qty: 2, price: 50, vatRate: 0, itemType: "material", includedInProject: true, enabled: true };
    const g = computeLineMoney(item).gross;
    expect(g).toBe(100);
    expect(roundMoney(g)).toBe(100);
    expect(formatMoneyAmount(g, { currencySymbol: "₽" })).toContain("100");
    expect(formatMoneyAmount(g, { currencySymbol: "$" })).toContain("100");
  });

  it("42: switching currency does not rescale prices", () => {
    const price = 999.5;
    expect(roundMoney(price)).toBe(1000);
    expect(formatMoneyAmount(price, "₽")).toMatch(/^1[\u00a0 ]?000/);
    expect(formatMoneyAmount(price, "$")).toMatch(/^1[\u00a0 ]?000/);
  });
});
