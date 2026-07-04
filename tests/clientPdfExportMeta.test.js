import { describe, expect, it } from "vitest";
import {
  CLIENT_PDF_EXPORT_OPTIONS,
  getClientPdfExportStats,
  pdfExportOptionStats,
} from "../src/lib/clientPdfExportMeta.js";

describe("clientPdfExportMeta", () => {
  it("считает склейку и оценку полного PDF", () => {
    const items = [
      { name: "Болт", unit: "шт.", supplier: "A", module: "Стеллаж 1", itemType: "material", enabled: true },
      { name: "Болт", unit: "шт.", supplier: "A", module: "Стеллаж 2", itemType: "material", enabled: true },
      { name: "Кран", unit: "шт.", supplier: "B", category: "Полив и сантехника", itemType: "material", enabled: true },
    ];
    const stats = getClientPdfExportStats(items);
    expect(stats.rawCount).toBe(3);
    expect(stats.mergedCount).toBe(2);
    expect(stats.savedByMerge).toBe(1);
    expect(stats.plumberMerged).toBe(1);
    expect(pdfExportOptionStats("merged", stats)).toContain("2 строк");
  });

  it("CLIENT_PDF_EXPORT_OPTIONS содержит client_short в primary", () => {
    const opt = CLIENT_PDF_EXPORT_OPTIONS.find((o) => o.id === "client_short");
    expect(opt).toBeTruthy();
    expect(opt.group).toBe("primary");
    expect(opt.label).toBe("Короткий список закупки");
  });

  it("client_short stats — компактный список без фото", () => {
    const stats = getClientPdfExportStats([{ name: "A", unit: "шт.", itemType: "material", enabled: true }]);
    expect(pdfExportOptionStats("client_short", stats)).toContain("без фото");
  });
});
