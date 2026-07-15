import { describe, expect, it } from "vitest";
import { FARM_SECTIONS, farmSectionById, farmSectionModuleAlias } from "../src/data/farmSections.js";
import {
  mergeMissingDefaultFarmSections,
  resolveFarmSections,
  normalizeSection,
} from "../src/lib/farmSectionsConfig.js";
import { catalogLinesForFarmSection } from "../src/lib/projectBuilder.js";

describe("farm section Насосная группа и обвязка", () => {
  it("is present in default FARM_SECTIONS with stable key", () => {
    const sec = farmSectionById("sec_nasosnaya");
    expect(sec).toBeTruthy();
    expect(sec.name).toBe("Насосная группа и обвязка");
    expect(FARM_SECTIONS.map((s) => s.id)).toContain("sec_nasosnaya");
    expect(farmSectionModuleAlias("sec_nasosnaya")).toBe("Насосная группа и обвязка");
  });

  it("resolveFarmSections includes pump section even when settings list is incomplete", () => {
    const fromDefaults = resolveFarmSections({});
    expect(fromDefaults.some((s) => s.id === "sec_nasosnaya")).toBe(true);

    const custom = resolveFarmSections({
      farmSections: JSON.stringify([
        normalizeSection({ id: "sec_poliv_pod", name: "Полив подтопление" }),
        normalizeSection({ id: "sec_klimat", name: "Климат" }),
      ]),
    });
    expect(custom.some((s) => s.id === "sec_nasosnaya")).toBe(true);
    expect(custom.find((s) => s.id === "sec_nasosnaya").name).toBe("Насосная группа и обвязка");
  });

  it("mergeMissingDefaultFarmSections does not duplicate existing id", () => {
    const base = [normalizeSection({ id: "sec_nasosnaya", name: "Уже есть" })];
    const merged = mergeMissingDefaultFarmSections(base);
    expect(merged.filter((s) => s.id === "sec_nasosnaya")).toHaveLength(1);
    // Canonical name wins for nasosnaya id
    expect(merged.find((s) => s.id === "sec_nasosnaya").name).toBe("Насосная группа и обвязка");
  });

  it("legacy name Насосы does not create a second card with sec_nasosnaya", () => {
    const merged = mergeMissingDefaultFarmSections([
      normalizeSection({ id: "legacy_pumps", name: "Насосы" }),
    ]);
    expect(merged.filter((s) => s.id === "sec_nasosnaya")).toHaveLength(1);
    expect(merged.filter((s) => s.id === "legacy_pumps")).toHaveLength(0);
  });

  it("filters materials by farmSectionId or module alias without pulling poliv-only lines", () => {
    const materials = [
      {
        id: "m_pump",
        name: "Насос полива",
        status: "active",
        modules: ["Насосная группа и обвязка"],
        farmSections: ["sec_nasosnaya"],
        unit: "шт.",
        basePrice: 1,
      },
      {
        id: "m_pipe",
        name: "Труба ПНД",
        status: "active",
        modules: ["Общая магистраль полива и дренажа"],
        farmSections: ["sec_poliv_pod"],
        unit: "м",
        basePrice: 1,
      },
      {
        id: "m_alias_only",
        name: "Обратный клапан",
        status: "active",
        modules: ["Насосная группа и обвязка"],
        farmSections: [],
        unit: "шт.",
        basePrice: 1,
      },
    ];
    const lines = catalogLinesForFarmSection(materials, "sec_nasosnaya");
    const ids = lines.map((l) => l.materialId).sort();
    expect(ids).toEqual(["m_alias_only", "m_pump"]);
    expect(ids).not.toContain("m_pipe");

    const poliv = catalogLinesForFarmSection(materials, "sec_poliv_pod").map((l) => l.materialId);
    expect(poliv).toEqual(["m_pipe"]);
    expect(poliv).not.toContain("m_pump");
  });
});
