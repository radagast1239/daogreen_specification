import { describe, expect, it } from "vitest";
import { hydrateCatalogEditorLine } from "../src/lib/specLineCore.js";

describe("hydrateCatalogEditorLine", () => {
  it("preserves a saved project qty over a catalog defaultQty", () => {
    const materials = [
      { id: "m1", name: "Material", unit: "шт.", basePrice: 10, vatRate: 20, status: "active" },
    ];
    const line = { id: "ln1", materialId: "m1", qty: 5, defaultQty: 2, included: true };

    expect(hydrateCatalogEditorLine(line, materials).qty).toBe(5);
  });
});
