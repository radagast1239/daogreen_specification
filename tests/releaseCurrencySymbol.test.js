import { describe, expect, it } from "vitest";
import {
  formatMoneyAmount,
  excelCurrencyNumFmt,
} from "../shared/moneyCalc.js";
import {
  normalizeProjectCurrency,
  resolveMoneyDisplaySymbol,
  pdfCurrencySuffix,
  formatMoneyForPdf,
  isPdfSymbolGlyphSafe,
} from "../shared/projectCurrency.js";
import {
  applyPublishedProjectMeta,
  buildPublishedProjectMeta,
  clientExportHeader,
} from "../shared/publishedClientMeta.js";
import { buildReleaseSnapshotPayload } from "../shared/projectPublishedRelease.js";

describe("release currency symbol preservation", () => {
  it("USD release → $ across meta, money, PDF, Excel", () => {
    const project = {
      id: "p1",
      name: "USD Farm",
      currency: "₽",
      manualParams: { currencyMeta: { code: "USD", symbol: "$", name: "USD", custom: false } },
      items: [],
    };
    const snap = buildReleaseSnapshotPayload(project, []);
    expect(snap.projectMeta.currencyCode).toBe("USD");
    expect(snap.projectMeta.currency).toBe("$");
    expect(snap.projectMeta.currencySymbol).toBe("$");

    const client = applyPublishedProjectMeta(snap.projectMeta);
    expect(client.currency).toBe("$");
    expect(client.currencyCode).toBe("USD");
    expect(formatMoneyAmount(1000, client)).toMatch(/\$$/);
    expect(formatMoneyForPdf(1000, client)).toMatch(/\$$/);
    expect(excelCurrencyNumFmt(client)).toContain("$");
  });

  it("EUR → €, RUB → ₽, AED → AED, KZT → ₸, INR → ₹", () => {
    const cases = [
      ["EUR", "€"],
      ["RUB", "₽"],
      ["AED", "AED"],
      ["KZT", "₸"],
      ["INR", "₹"],
    ];
    for (const [code, symbol] of cases) {
      const d = normalizeProjectCurrency({ currencyCode: code });
      expect(d.currencySymbol).toBe(symbol);
      expect(formatMoneyAmount(10, d)).toContain(symbol);
      expect(pdfCurrencySuffix(d)).toBe(symbol);
    }
  });

  it("custom currency preserves symbol", () => {
    const d = normalizeProjectCurrency({
      currencyCode: "GEL",
      currencySymbol: "₾",
      currencyName: "Lari",
      currencyCustom: true,
    });
    expect(d.currencySymbol).toBe("₾");
    expect(formatMoneyAmount(5, d)).toContain("₾");
  });

  it("legacy release without currency → RUB", () => {
    const client = applyPublishedProjectMeta({});
    expect(client.currencyCode).toBe("RUB");
    expect(client.currency).toBe("₽");
  });

  it("currencyCode and symbol do not diverge for USD", () => {
    const client = applyPublishedProjectMeta({
      currency: "₽",
      currencyCode: "USD",
      currencySymbol: "$",
    });
    expect(client.currencyCode).toBe("USD");
    expect(client.currency).toBe("$");
    expect(client.currencySymbol).toBe("$");
  });

  it("EN locale formatting does not change currency symbol", () => {
    const d = normalizeProjectCurrency({ currencyCode: "USD" });
    const s = formatMoneyAmount(1234.5, d);
    expect(s).toMatch(/\$$/);
    expect(s).not.toMatch(/₽/);
  });

  it("export header uses normalized symbol", () => {
    const h = clientExportHeader({ currency: "₽", currencyCode: "EUR", currencySymbol: "€" });
    expect(h.currency).toBe("€");
    expect(h.currencyCode).toBe("EUR");
  });

  it("buildPublishedProjectMeta freezes USD even if currency field is ₽", () => {
    const meta = buildPublishedProjectMeta({
      currency: "₽",
      currencyCode: "USD",
      currencySymbol: "$",
    });
    expect(meta.currency).toBe("$");
    expect(meta.currencyCode).toBe("USD");
  });

  it("money object with only currencyCode resolves USD to $", () => {
    expect(resolveMoneyDisplaySymbol(normalizeProjectCurrency({ currencyCode: "USD" }))).toBe("$");
    expect(formatMoneyAmount(1, { currencyCode: "USD" })).toMatch(/\$$/);
  });

  it("Arabic AED glyph remains unsafe for PDF even if not the preset symbol", () => {
    expect(isPdfSymbolGlyphSafe("د.إ")).toBe(false);
  });
});
