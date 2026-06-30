import { describe, it, expect } from "vitest";
import {
  cleanFarmSectionCatalogs,
  cleanFarmSectionVersions,
} from "../shared/cleanFarmSectionCatalogs.js";

const materials = [
  { id: "m164", name: "Насос дренажный", status: "active" },
  { id: "m168", name: "Муфта-американка 32", status: "active" },
  { id: "m121", name: "Труба ПП д32", status: "active" },
  { id: "m143", name: "Гибкая канализационная подводка", status: "active" },
];

const sections = [{ id: "sec_poliv_pod" }];

describe("cleanFarmSectionCatalogs", () => {
  it("remaps legacy ids, drops ghost sections, slims lines", () => {
    const raw = {
      sec_poliv_pod: [
        { materialId: "m165", name: "Насос", defaultQty: 1, category: "Насосы", supplier: "x" },
        { materialId: "m167", defaultQty: 2 },
      ],
      sec_old_ghost: [{ materialId: "m165", defaultQty: 1 }],
    };
    const { next, report } = cleanFarmSectionCatalogs(raw, materials, sections);
    expect(Object.keys(next)).toEqual(["sec_poliv_pod"]);
    expect(next.sec_poliv_pod).toHaveLength(2);
    expect(next.sec_poliv_pod.every((l) => !l.name && l.materialId)).toBe(true);
    expect(next.sec_poliv_pod.map((l) => l.materialId).sort()).toEqual(["m164", "m168"].sort());
    expect(report.removedSections).toHaveLength(1);
  });

  it("drops lines with no match in materials db", () => {
    const raw = {
      sec_poliv_pod: [{ materialId: "m_deleted", name: "Несуществующий", defaultQty: 1 }],
    };
    const { next, report } = cleanFarmSectionCatalogs(raw, materials, sections);
    expect(next.sec_poliv_pod).toEqual([]);
    expect(report.dropped).toHaveLength(1);
  });
});

describe("cleanFarmSectionVersions", () => {
  it("cleans catalog inside version snapshots", () => {
    const raw = {
      sec_poliv_pod: [
        {
          id: "ver_1",
          savedAt: "2026-01-01",
          catalog: [{ materialId: "m165", name: "Насос", defaultQty: 1 }],
        },
      ],
    };
    const { next } = cleanFarmSectionVersions(raw, materials, sections);
    expect(next.sec_poliv_pod[0].catalog[0].materialId).toBe("m164");
    expect(next.sec_poliv_pod[0].catalog[0].name).toBeUndefined();
  });
});
