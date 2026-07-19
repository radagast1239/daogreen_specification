import { describe, it, expect } from "vitest";
import { applyMaterialCatalogFields } from "../src/lib/specLineCore.js";
import { buildProjectFromBuilder } from "../src/lib/projectBuilder.js";
import { mergeFrameBomIntoProjectItems } from "../shared/frameBomProjectItems.js";

const materials = [
  {
    id: "m073",
    name: "Болт М6×20",
    unit: "шт.",
    category: "Крепёж",
    supplier: "Лемана про",
    link: "https://bolt",
    linkAlt: "https://bolt-alt",
    basePrice: 12,
    vatRate: 0,
  },
  {
    id: "m036",
    name: "Труба профильная",
    unit: "м",
    category: "Каркас",
    supplier: "Металлобаза",
    link: "https://tube",
    basePrice: 100,
  },
];

describe("applyMaterialCatalogFields", () => {
  it("preserves existing supplier/link/price snapshot by default", () => {
    const line = {
      id: "ln1",
      materialId: "m073",
      name: "old",
      supplier: "Custom supplier",
      link: "https://custom",
      price: 42,
      qty: 4,
      included: true,
    };
    const out = applyMaterialCatalogFields(line, materials);
    expect(out.supplier).toBe("Custom supplier");
    expect(out.link).toBe("https://custom");
    expect(out.price).toBe(42);
    expect(out.qty).toBe(4);
  });

  it("fills empty fields from catalog", () => {
    const line = {
      id: "ln1",
      materialId: "m073",
      name: "Болт",
      supplier: "",
      link: "",
      price: 0,
      qty: 1,
    };
    const out = applyMaterialCatalogFields(line, materials);
    expect(out.supplier).toBe("Лемана про");
    expect(out.price).toBe(12);
  });

  it("force mode overwrites from catalog", () => {
    const line = {
      id: "ln1",
      materialId: "m073",
      supplier: "Custom",
      price: 42,
    };
    const out = applyMaterialCatalogFields(line, materials, { force: true });
    expect(out.supplier).toBe("Лемана про");
    expect(out.price).toBe(12);
  });
});

describe("buildProjectFromBuilder material catalog sync", () => {
  const buildBoltLine = (lineOverrides = {}) =>
    buildProjectFromBuilder({
      form: { name: "P", client: "C", manualParams: {} },
      stellages: [
        {
          id: "st1",
          name: "Стеллаж 1",
          moduleName: "Проточка",
          moduleId: "mod1",
          count: 1,
          items: [
            {
              id: "ln1",
              materialId: "m073",
              name: "Болт",
              supplier: "",
              qty: 10,
              included: true,
              unit: "шт.",
              category: "Крепёж",
              ...lineOverrides,
            },
          ],
        },
      ],
      farmSections: [],
      materials,
      rooms: [],
    }).items.find((it) => it.materialId === "m073");

  it("writes supplier from materials for new builder lines", () => {
    const bolt = buildBoltLine();
    expect(bolt).toBeTruthy();
    expect(bolt.supplier).toBe("Лемана про");
    expect(bolt.price).toBe(12);
  });

  it("inherits missing link and linkAlt from catalog for a new builder line", () => {
    const bolt = buildBoltLine();
    expect(bolt.link).toBe("https://bolt");
    expect(bolt.linkAlt).toBe("https://bolt-alt");
    expect(bolt.linkOverridden).toBeFalsy();
    expect(bolt.linkAltOverridden).toBeFalsy();
  });

  it("explicit empty link/linkAlt clears catalog values as a project override", () => {
    const bolt = buildBoltLine({ link: "", linkAlt: "" });
    expect(bolt.link).toBe("");
    expect(bolt.linkAlt).toBe("");
    expect(bolt.linkOverridden).toBe(true);
    expect(bolt.linkAltOverridden).toBe(true);
  });

  it("custom project link/linkAlt are preserved over catalog", () => {
    const bolt = buildBoltLine({ link: "https://custom-bolt", linkAlt: "https://custom-bolt-alt" });
    expect(bolt.link).toBe("https://custom-bolt");
    expect(bolt.linkAlt).toBe("https://custom-bolt-alt");
    expect(bolt.linkOverridden).toBe(true);
    expect(bolt.linkAltOverridden).toBe(true);
  });

  it("explicit price 0 is preserved as a project override, not reset to catalog", () => {
    const bolt = buildBoltLine({ price: 0 });
    expect(bolt.price).toBe(0);
    expect(bolt.priceOverridden).toBe(true);
  });

  it("custom project price is preserved over catalog", () => {
    const bolt = buildBoltLine({ price: 99 });
    expect(bolt.price).toBe(99);
    expect(bolt.priceOverridden).toBe(true);
  });

  it("explicit price equal to catalog price is not marked as override", () => {
    const bolt = buildBoltLine({ price: 12 });
    expect(bolt.price).toBe(12);
    expect(bolt.priceOverridden).toBeFalsy();
  });

  it("priceOverridden flag with missing price normalizes to 0, keeps override", () => {
    const bolt = buildBoltLine({ priceOverridden: true });
    expect(bolt.price).toBe(0);
    expect(bolt.priceOverridden).toBe(true);
  });

  it("malformed price without override flag inherits catalog price, never NaN", () => {
    const bolt = buildBoltLine({ price: "abc" });
    expect(bolt.price).toBe(12);
    expect(Number.isFinite(bolt.price)).toBe(true);
    expect(bolt.priceOverridden).toBeFalsy();
  });

  it("malformed price with override flag normalizes to 0, keeps override", () => {
    const bolt = buildBoltLine({ priceOverridden: true, price: "abc" });
    expect(bolt.price).toBe(0);
    expect(Number.isFinite(bolt.price)).toBe(true);
    expect(bolt.priceOverridden).toBe(true);
  });

  it("existing custom price override survives a re-run through the builder", () => {
    const bolt = buildBoltLine({ price: 99, priceOverridden: true });
    expect(bolt.price).toBe(99);
    expect(bolt.priceOverridden).toBe(true);
  });
});

describe("frame BOM merge material catalog sync", () => {
  it("fills supplier from materials when draft has none", () => {
    const { items } = mergeFrameBomIntoProjectItems(
      [],
      [{ key: "profile_tube", materialId: "m036", qty: 12, name: "Труба", unit: "м" }],
      {
        moduleRackKey: "mod1:st1",
        rackLabel: "Стеллаж 1",
        drawingId: "d1",
        materials,
      },
    );
    const tube = items.find((it) => it.materialId === "m036");
    expect(tube).toBeTruthy();
    expect(tube.supplier).toBe("Металлобаза");
    expect(tube.link).toBe("https://tube");
    expect(tube.price).toBe(100);
  });
});
