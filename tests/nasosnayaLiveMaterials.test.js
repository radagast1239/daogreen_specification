import { describe, expect, it } from "vitest";
import {
  NASOSNAYA_CANONICAL_NAME,
  NASOSNAYA_SECTION_ID,
  canonicalizeNasosnayaSection,
  materialBelongsToNasosnaya,
  materialExcludedFromNasosnayaCatalog,
} from "../shared/nasosnayaFarmSection.js";
import {
  dedupeAndCanonicalizeFarmSections,
  filterSectionsForFarmType,
  normalizeSection,
  projectLinesFromCatalog,
  resolveFarmSections,
} from "../src/lib/farmSectionsConfig.js";
import { catalogLinesForFarmSection } from "../src/lib/projectBuilder.js";

/** Shape from local daogreen.db (not seed defaults). */
const LIVE_PUMP_MATERIALS = [
  {
    id: "m162",
    name: "Насосная станция полив подтопление",
    status: "active",
    module: "",
    modules: [],
    category: "Насосы",
    farmSectionId: "sec_mqnle91vjkr2l",
    farmSections: ["sec_mqnle91vjkr2l"],
    clientSection: "pumps",
    clientSubsection: "Насосы подачи",
    unit: "шт.",
    basePrice: 21000,
  },
  {
    id: "m163",
    name: "Насосная станция полив проточка",
    status: "active",
    module: "",
    modules: [],
    category: "Насосы",
    farmSectionId: "sec_mqnle91vjkr2l",
    farmSections: ["sec_mqnle91vjkr2l"],
    clientSection: "pumps",
    clientSubsection: "Насосы подачи",
    unit: "шт.",
    basePrice: 21000,
  },
  {
    id: "m164",
    name: "Насос дренажный погружной",
    status: "active",
    module: "",
    modules: [],
    category: "Насосы",
    farmSectionId: "sec_mqnle91vjkr2l",
    farmSections: ["sec_mqnle91vjkr2l"],
    clientSection: "pumps",
    clientSubsection: "Насосы дренажа",
    unit: "шт.",
    basePrice: 4000,
  },
  {
    id: "m_custom_pump",
    name: "Насос полива custom id",
    status: "active",
    module: "",
    category: "Насосы",
    farmSectionId: "sec_mqnle91vjkr2l",
    farmSections: ["sec_mqnle91vjkr2l"],
    unit: "шт.",
    basePrice: 1,
  },
  {
    id: "m176",
    name: "Кран шаровый ПП д32, 1 1/4\"",
    status: "active",
    category: "Полив — подача раствора",
    farmSectionId: "sec_poliv_proto",
    farmSections: [
      "sec_poliv_proto",
      "sec_poliv_pod",
      "sec_mqp1esmwh2pcj",
      "sec_mqnle91vjkr2l",
    ],
    clientSection: "irrigation",
    unit: "шт.",
    basePrice: 350,
  },
  {
    id: "m_mag",
    name: "Труба магистрали",
    status: "active",
    category: "Полив — подача раствора",
    farmSectionId: "sec_mqp1esmwh2pcj",
    farmSections: ["sec_mqp1esmwh2pcj"],
    modules: ["Общая магистраль полива и дренажа"],
    unit: "м",
    basePrice: 1,
  },
  {
    id: "m_water",
    name: "Фильтр осмос",
    status: "active",
    category: "Водоподготовка",
    farmSectionId: "sec_mqo5utcdgj03d",
    farmSections: ["sec_mqo5utcdgj03d"],
    modules: ["Водоподготовка"],
    unit: "шт.",
    basePrice: 1,
  },
];

const LIVE_SETTINGS_SECTION = {
  id: "sec_mqnle91vjkr2l",
  name: "Насосная группа и обвязка",
  group: "насосы_и_ёмкости",
  hiddenForFarmTypes: [
    "подтопление",
    "аэропоника",
    "смешанная",
    "микрозелень",
    "проточка",
    "NFT",
  ],
};

describe("live nasosnaya visibility + materials", () => {
  it("does not hide nasosnaya card for проточка after resolve (clears broken hide-all)", () => {
    const sections = resolveFarmSections({
      farmSections: JSON.stringify([
        normalizeSection({ id: "sec_poliv_proto", name: "Полив проточка" }),
        normalizeSection(LIVE_SETTINGS_SECTION),
      ]),
    });
    const pump = sections.filter((s) => s.id === NASOSNAYA_SECTION_ID);
    expect(pump).toHaveLength(1);
    expect(pump[0].hiddenForFarmTypes).toEqual([]);
    expect(pump[0].catalogAliasIds).toContain("sec_mqnle91vjkr2l");

    const visible = filterSectionsForFarmType(sections, "проточка");
    expect(visible.some((s) => s.id === NASOSNAYA_SECTION_ID)).toBe(true);
    expect(visible.filter((s) => s.id === NASOSNAYA_SECTION_ID)).toHaveLength(1);
  });

  it("dedupes live legacy id + canonical id into one card", () => {
    const merged = dedupeAndCanonicalizeFarmSections([
      normalizeSection(LIVE_SETTINGS_SECTION),
      normalizeSection({ id: NASOSNAYA_SECTION_ID, name: NASOSNAYA_CANONICAL_NAME }),
    ]);
    expect(merged.filter((s) => s.id === NASOSNAYA_SECTION_ID)).toHaveLength(1);
    expect(merged.find((s) => s.id === NASOSNAYA_SECTION_ID).catalogAliasIds).toContain(
      "sec_mqnle91vjkr2l"
    );
  });

  it("maps live pump materials with non-seed names and legacy farmSectionId", () => {
    expect(materialBelongsToNasosnaya(LIVE_PUMP_MATERIALS[0])).toBe(true);
    expect(materialBelongsToNasosnaya(LIVE_PUMP_MATERIALS[2])).toBe(true);
    expect(materialBelongsToNasosnaya(LIVE_PUMP_MATERIALS[3])).toBe(true);

    const lines = catalogLinesForFarmSection(LIVE_PUMP_MATERIALS, NASOSNAYA_SECTION_ID, {
      legacyFarmSectionIds: ["sec_mqnle91vjkr2l"],
    });
    const ids = lines.map((l) => l.materialId);
    expect(ids).toEqual(expect.arrayContaining(["m162", "m163", "m164", "m_custom_pump"]));
    expect(ids).not.toContain("m176");
    expect(ids).not.toContain("m_mag");
    expect(ids).not.toContain("m_water");
  });

  it("does not treat dual-tagged magistral fittings as nasosnaya-only false positives", () => {
    expect(materialBelongsToNasosnaya(LIVE_PUMP_MATERIALS.find((m) => m.id === "m176"))).toBe(false);
    expect(materialExcludedFromNasosnayaCatalog(LIVE_PUMP_MATERIALS.find((m) => m.id === "m_mag"))).toBe(
      true
    );
  });

  it("loads catalog lines via legacy farmSectionCatalogs key after canonicalize", () => {
    const sec = normalizeSection(canonicalizeNasosnayaSection(normalizeSection(LIVE_SETTINGS_SECTION)));
    const catalogs = {
      sec_mqnle91vjkr2l: [
        { materialId: "m162", defaultQty: 1 },
        { materialId: "m164", defaultQty: 1 },
      ],
    };
    const lines = projectLinesFromCatalog(catalogs, NASOSNAYA_SECTION_ID, LIVE_PUMP_MATERIALS, sec);
    expect(lines.map((l) => l.materialId).sort()).toEqual(["m162", "m164"]);
    expect(lines.every((l) => l.included === false)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("empty nasosnaya stays empty when only magistral materials exist", () => {
    const lines = catalogLinesForFarmSection(
      [LIVE_PUMP_MATERIALS.find((m) => m.id === "m_mag")],
      NASOSNAYA_SECTION_ID,
      { legacyFarmSectionIds: ["sec_mqnle91vjkr2l"] }
    );
    expect(lines).toHaveLength(0);
  });
});
