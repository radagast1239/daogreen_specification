import { describe, expect, it } from "vitest";
import {
  normalizeStoredCatalogLine,
  slimCatalogLine,
  stripCatalogLines,
} from "../shared/catalogLine.js";
import { hydrateCatalogEditorLine } from "../src/lib/specLineCore.js";
import { projectStellageLinesFromCatalog } from "../src/lib/stellageCatalogConfig.js";
import { lineToProjectItem } from "../src/lib/projectBuilder.js";
import { buildItemsFromModules } from "../src/lib/apiHelpers.js";

const materials = [
  {
    id: "m1",
    name: "Болт М6",
    unit: "шт.",
    category: "Каркас и крепёж",
    defaultQty: 10,
    basePrice: 5,
    status: "active",
    subcategory: "karkas",
    module: "Стеллаж проточка",
    modules: ["Стеллаж проточка"],
  },
];

const modules = [{ id: "mod1", name: "Стеллаж проточка", type: "stellage" }];

describe("stellage catalog group (subcategory)", () => {
  it("slimCatalogLine сохраняет явный subcategory, даже если farmGroup устарел", () => {
    const slim = slimCatalogLine({
      materialId: "m1",
      defaultQty: 10,
      included: true,
      subcategory: "lotki",
      farmGroup: "karkas",
    });
    expect(slim.subcategory).toBe("lotki");
  });

  it("normalize/save/load сохраняет группу шаблона", () => {
    const stored = normalizeStoredCatalogLine({
      materialId: "m1",
      defaultQty: 10,
      included: true,
      subcategory: "poliv",
      farmGroup: "karkas",
    });
    expect(stored.subcategory).toBe("poliv");

    const stripped = stripCatalogLines([
      {
        materialId: "m1",
        qty: 10,
        included: true,
        subcategory: "poliv",
        farmGroup: "karkas",
      },
    ]);
    expect(stripped[0].subcategory).toBe("poliv");

    const editor = hydrateCatalogEditorLine(stripped[0], materials);
    expect(editor.subcategory).toBe("poliv");
    expect(editor.farmGroup).toBe("poliv");
  });

  it("применение шаблона к проекту переносит subcategory в project_items", () => {
    const catalogs = {
      mod1: [{ materialId: "m1", defaultQty: 10, included: true, subcategory: "drenazh" }],
    };
    const lines = projectStellageLinesFromCatalog(catalogs, "mod1", materials, modules[0].name);
    expect(lines[0].subcategory).toBe("drenazh");

    const item = lineToProjectItem({ ...lines[0], included: true, qty: 10 }, "Стеллаж 1", 0);
    expect(item.subcategory).toBe("drenazh");
  });

  it("пустая группа не ломает сохранение строки", () => {
    const slim = slimCatalogLine({
      materialId: "m1",
      defaultQty: 10,
      included: true,
      subcategory: "",
      farmGroup: "",
    });
    expect(slim.subcategory).toBeUndefined();
    expect(slim.materialId).toBe("m1");
  });

  it("buildItemsFromModules копирует subcategory материала", () => {
    const items = buildItemsFromModules(materials, modules, [{ moduleId: "mod1", count: 1 }]);
    expect(items[0].subcategory).toBe("karkas");
  });
});
