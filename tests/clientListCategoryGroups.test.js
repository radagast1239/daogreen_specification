import { describe, expect, it } from "vitest";
import {
  resolveListCategoryGroupId,
  isStellagePurchaseModule,
  groupMergedByListCategories,
} from "../shared/clientListCategoryGroups.js";

describe("clientListCategoryGroups", () => {
  it("относит стеллажи к группе stellage", () => {
    expect(isStellagePurchaseModule({ module: "Стеллаж 1 — подтопление" })).toBe(true);
    expect(resolveListCategoryGroupId({ module: "Стеллаж 1", category: "Каркас" })).toBe("stellage");
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
      { sourceItems: [{ module: "Стеллаж 1", category: "Каркас" }], sumVat: 5 },
      { sourceItems: [{ module: "Общая магистраль полива и дренажа", category: "x" }], sumVat: 10 },
      { sourceItems: [{ module: "Электрика и щит", category: "y" }], sumVat: 20 },
    ];
    const groups = groupMergedByListCategories(rows);
    expect(groups.map((g) => g.sectionId)).toEqual(
      expect.arrayContaining(["stellage", "plumbing", "electrics"])
    );
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(3);
  });
});
