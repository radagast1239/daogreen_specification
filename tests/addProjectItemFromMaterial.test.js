import { describe, expect, it } from "vitest";
import {
  assertManualAddClientEligible,
  buildProjectItemFromMaterial,
  filterMaterialsForSpecAdd,
  findDuplicateMaterialInModule,
} from "../src/lib/addProjectItemFromMaterial.js";
import { filterItemsForViewMode } from "../shared/projectReadiness.js";
import { lineVisibleToClient } from "../shared/itemTypes.js";

const mat = {
  id: "m_pump",
  name: "Насос полива для подтопления",
  unit: "шт.",
  basePrice: 12000,
  category: "Полив и сантехника",
  supplier: "ООО Насосы",
  link: "https://example.com/pump",
  imageUrl: "/uploads/pump.jpg",
  photoUrl: "/uploads/pump.jpg",
  clientSection: "pumps",
  clientSubsection: "Насосы подачи",
  clientVisibleDefault: true,
  status: "active",
  itemType: "material",
  responsible: "Инженер",
};

describe("addProjectItemFromMaterial", () => {
  it("selector filter returns real materials by name/category/supplier", () => {
    const list = [
      mat,
      { id: "m2", name: "Кабель", category: "Электрика", supplier: "X", status: "active" },
      { id: "m3", name: "Archived pump", status: "archived", supplier: "ООО Насосы" },
    ];
    expect(filterMaterialsForSpecAdd(list, "насос").map((m) => m.id)).toEqual(["m_pump"]);
    expect(filterMaterialsForSpecAdd(list, "полив").map((m) => m.id)).toEqual(["m_pump"]);
    expect(filterMaterialsForSpecAdd(list, "ооо насосы").map((m) => m.id)).toEqual(["m_pump"]);
  });

  it("builds item with materialId, qty=1, pulled defaults, not forced hidden", () => {
    const item = buildProjectItemFromMaterial(mat, "Насосная группа и обвязка");
    expect(item.materialId).toBe("m_pump");
    expect(item.name).toBe(mat.name);
    expect(item.qty).toBe(1);
    expect(item.price).toBe(12000);
    expect(item.unit).toBe("шт.");
    expect(item.supplier).toBe("ООО Насосы");
    expect(item.link).toBe(mat.link);
    expect(item.imageUrl || item.photoUrl).toContain("pump");
    expect(item.category).toBe(mat.category);
    expect(item.clientSection).toBe("pumps");
    expect(item.module).toBe("Насосная группа и обвязка");
    expect(item.includedInProject).toBe(true);
    expect(item.itemType).not.toBe("internal_note");
    expect(item.visibleToClient).toBe(true);
    expect(lineVisibleToClient(item, mat)).toBe(true);
  });

  it("does not force hidden when material has no visibility default", () => {
    const item = buildProjectItemFromMaterial(
      { ...mat, clientVisibleDefault: undefined },
      "Раздел"
    );
    expect(item.visibleToClient).toBe(true);
    expect(item.includedInProject).toBe(true);
  });

  it("respects material clientVisibleDefault=false without locking included", () => {
    const item = buildProjectItemFromMaterial(
      { ...mat, clientVisibleDefault: false },
      "Раздел"
    );
    expect(item.includedInProject).toBe(true);
    expect(item.visibleToClient).toBe(false);
    // Admin can still toggle visibleToClient later — not internal_note
    expect(item.itemType).not.toBe("internal_note");
  });

  it("detects duplicate material in same module", () => {
    const existing = [{ id: "it1", materialId: "m_pump", module: "A", section: "A" }];
    expect(findDuplicateMaterialInModule(existing, "m_pump", "A")?.id).toBe("it1");
    expect(findDuplicateMaterialInModule(existing, "m_pump", "B")).toBeNull();
  });

  it("visible manual add passes client / PDF-style filters", () => {
    const item = buildProjectItemFromMaterial(mat, "Раздел");
    expect(assertManualAddClientEligible(item, mat)).toBe(true);
    const filtered = filterItemsForViewMode([item], "client");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].materialId).toBe("m_pump");
  });

  it("legacy blank internal_note row is excluded from client filters (regression)", () => {
    const legacy = {
      id: "bad",
      name: "— привязать материал из базы —",
      itemType: "internal_note",
      materialId: null,
      includedInProject: true,
      visibleToClient: true,
      visible: true,
      approved: true,
    };
    expect(lineVisibleToClient(legacy)).toBe(false);
    expect(filterItemsForViewMode([legacy], "client")).toHaveLength(0);
  });
});
