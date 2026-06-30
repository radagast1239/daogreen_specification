import { describe, expect, it } from "vitest";
import { getClientPdfExportStats, pdfExportOptionStats } from "../src/lib/clientPdfExportMeta.js";

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
});
