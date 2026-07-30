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

  it("keeps project-local price and links during controlled-input rehydration", () => {
    const materials = [{
      id: "m1",
      name: "Вентилятор",
      unit: "шт.",
      basePrice: 3500,
      link: "https://catalog.example/fan",
      linkAlt: "https://catalog.example/fan-alt",
    }];
    const edited = {
      id: "ln1",
      materialId: "m1",
      included: true,
      qty: 1,
      price: 4200,
      priceOverridden: true,
      link: "https://project.example/fan",
      linkOverridden: true,
      linkAlt: "https://project.example/fan-alt",
      linkAltOverridden: true,
    };

    expect(hydrateCatalogEditorLine(edited, materials)).toMatchObject({
      price: 4200,
      priceOverridden: true,
      link: "https://project.example/fan",
      linkOverridden: true,
      linkAlt: "https://project.example/fan-alt",
      linkAltOverridden: true,
    });
    expect(materials[0].basePrice).toBe(3500);
  });
});
