import { describe, expect, it } from "vitest";
import { lineVisibleToClient } from "../shared/itemTypes.js";

/** Логика отбора materialId для client catalog (без БД). */
function catalogMaterialIds(items) {
  return [
    ...new Set(
      (items || []).filter(lineVisibleToClient).map((i) => i.materialId).filter(Boolean)
    ),
  ];
}

describe("client catalog material ids", () => {
  it("берёт только видимые клиенту позиции с materialId", () => {
    const items = [
      { id: "1", materialId: "m1", visibleToClient: true, itemType: "material" },
      { id: "2", materialId: "m2", visibleToClient: false, itemType: "material" },
      { id: "3", materialId: "m3", itemType: "material" },
      { id: "4", itemType: "internal_note", materialId: "m9" },
    ];
    expect(catalogMaterialIds(items).sort()).toEqual(["m1", "m3"]);
  });
});
