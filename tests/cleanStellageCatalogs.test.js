import { describe, it, expect } from "vitest";
import {
  cleanStellageCatalogs,
  cleanStellageModuleMeta,
  STELLAGE_GHOST_MODULE_IDS,
} from "../shared/cleanStellageCatalogs.js";

const materials = [
  { id: "m073", name: "Болт М6×20", status: "active" },
  { id: "m074", name: "Гайка М6", status: "active" },
  { id: "m141", name: "Заглушка канализационная д110", status: "active" },
];

const official = ["mod_protochka", "mod_podtoplenie"];

describe("cleanStellageCatalogs", () => {
  it("remaps legacy ids and drops ghost modules", () => {
    const raw = {
      mod_protochka: [
        { materialId: "m039", defaultQty: 100, subcategory: "karkas" },
        { materialId: "m021", defaultQty: 2, subcategory: "poliv" },
      ],
      [STELLAGE_GHOST_MODULE_IDS[0]]: [{ materialId: "m039", defaultQty: 1 }],
    };
    const { next, report } = cleanStellageCatalogs(raw, materials, { officialModuleIds: official });
    expect(Object.keys(next)).toEqual(["mod_protochka"]);
    expect(next.mod_protochka).toHaveLength(2);
    expect(next.mod_protochka.map((l) => l.materialId).sort()).toEqual(["m073", "m141"]);
    expect(report.removedModules).toHaveLength(1);
    expect(report.remapped.some((r) => r.oldId === "m039" && r.newId === "m073")).toBe(true);
  });

  it("dedupes same material after remap", () => {
    const raw = {
      mod_podtoplenie: [
        { materialId: "m050", defaultQty: 3 },
        { materialId: "m085", defaultQty: 5 },
      ],
    };
    const { next, report } = cleanStellageCatalogs(raw, [
      ...materials,
      { id: "m144", name: "Труба канализационная д50, L=500 мм", status: "active" },
    ], { officialModuleIds: official });
    expect(next.mod_podtoplenie).toHaveLength(1);
    expect(next.mod_podtoplenie[0].materialId).toBe("m144");
    expect(next.mod_podtoplenie[0].defaultQty).toBe(5);
    expect(report.deduped.length).toBeGreaterThan(0);
  });
});

describe("cleanStellageModuleMeta", () => {
  it("keeps only official module photos", () => {
    const { next, removed } = cleanStellageModuleMeta(
      { mod_protochka: { photoUrl: "/a.jpg" }, mod_4lYb0iHFNK: { photoUrl: "/b.jpg" } },
      official
    );
    expect(next).toEqual({ mod_protochka: { photoUrl: "/a.jpg" } });
    expect(removed).toContain("mod_4lYb0iHFNK");
  });
});
