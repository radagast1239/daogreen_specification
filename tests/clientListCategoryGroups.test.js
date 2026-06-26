import { describe, expect, it } from "vitest";
import {
  resolveListCategoryGroupId,
  isStellagePurchaseModule,
  groupMergedByListCategories,
} from "../shared/clientListCategoryGroups.js";

describe("clientListCategoryGroups", () => {
  it("исключает стеллажи из списка", () => {
    expect(isStellagePurchaseModule({ module: "Стеллаж 1 — подтопление" })).toBe(true);
    expect(resolveListCategoryGroupId({ module: "Стеллаж 1", category: "Каркас" })).toBeNull();
  });

  it("относит полив к сантехнике", () => {
    expect(
      resolveListCategoryGroupId({
        module: "Полив/дренаж — подтопление",
        category: "Прочее",
      })
    ).toBe("plumbing");
  });

  it("группирует merged rows без дублирования", () => {
    const rows = [
      { sourceItems: [{ module: "Общая магистраль полива и дренажа", category: "x" }], sumVat: 10 },
      { sourceItems: [{ module: "Электрика и щит", category: "y" }], sumVat: 20 },
    ];
    const groups = groupMergedByListCategories(rows);
    expect(groups.map((g) => g.sectionId)).toEqual(expect.arrayContaining(["plumbing", "electrics"]));
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(2);
  });
});
