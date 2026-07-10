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
  it("writes supplier from materials for new builder lines", () => {
    const built = buildProjectFromBuilder({
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
            },
          ],
        },
      ],
      farmSections: [],
      materials,
      rooms: [],
    });
    const bolt = built.items.find((it) => it.materialId === "m073");
    expect(bolt).toBeTruthy();
    expect(bolt.supplier).toBe("Лемана про");
    expect(bolt.link).toBe("https://bolt");
    expect(bolt.price).toBe(12);
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
