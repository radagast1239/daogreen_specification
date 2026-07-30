import { describe, expect, it } from "vitest";
import {
  getSpecLineSelectionId,
  buildModuleSelectionFromIds,
  normalizeSpecSelectionIds,
} from "../shared/specLineSelection.js";

describe("specLineSelection", () => {
  it("getSpecLineSelectionId returns canonical item.id", () => {
    expect(getSpecLineSelectionId({ id: "it_1", materialId: "m034" })).toBe("it_1");
    expect(getSpecLineSelectionId({ id: "it_fbom:d1:rack1:m034", materialId: "m034" })).toBe(
      "it_fbom:d1:rack1:m034"
    );
  });

  it("does not use materialId as selection id", () => {
    expect(getSpecLineSelectionId({ materialId: "m034" })).toBeNull();
  });

  it("buildModuleSelectionFromIds groups by module", () => {
    const items = [
      { id: "a", module: "mod1" },
      { id: "b", module: "mod2" },
      { id: "c", module: "mod1" },
    ];
    const sel = buildModuleSelectionFromIds(items, ["a", "c"]);
    expect([...sel.mod1]).toEqual(["a", "c"]);
    expect(sel.mod2).toBeUndefined();
  });

  it("preserves BOM ids with colon", () => {
    const bomId = "it_fbom:d1:rack1:m034";
    const sel = buildModuleSelectionFromIds(
      [{ id: bomId, module: "stellage" }],
      [bomId]
    );
    expect([...sel.stellage]).toEqual([bomId]);
  });

  it("normalizeSpecSelectionIds dedupes and stringifies", () => {
    expect(normalizeSpecSelectionIds(["a", "a", 1])).toEqual(["a", "1"]);
  });
});
