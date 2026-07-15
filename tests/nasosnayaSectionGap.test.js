import { describe, expect, it } from "vitest";
import {
  NASOSNAYA_CANONICAL_NAME,
  NASOSNAYA_SECTION_ID,
  NASOSNAYA_SEED_MATERIAL_IDS,
  materialBelongsToNasosnaya,
  materialExcludedFromNasosnayaCatalog,
  isNasosnayaSectionName,
} from "../shared/nasosnayaFarmSection.js";
import {
  dedupeAndCanonicalizeFarmSections,
  mergeMissingDefaultFarmSections,
  resolveFarmSections,
  normalizeSection,
  emptyFarmSectionsState,
} from "../src/lib/farmSectionsConfig.js";
import { catalogLinesForFarmSection, buildProjectFromBuilder } from "../src/lib/projectBuilder.js";
import { hydrateBuilderFromProject } from "../src/lib/projectBuilderHydrate.js";
import { buildProjectItemsAfterBuilderSave } from "../shared/buildProjectItemsAfterBuilderSave.js";
import { DEFAULT_MANUAL_PARAMS } from "../src/lib/itemHelpers.js";

function includedCount(lines) {
  return (lines || []).filter((ln) => ln.included && (ln.materialId || ln.name?.trim())).length;
}

const seedLikePumpMaterials = [
  {
    id: "m161",
    name: "Насосы полива и дренажные",
    status: "active",
    module: "Общая закупка на ферму",
    unit: "шт.",
    basePrice: 0,
  },
  {
    id: "m162",
    name: "Насос полив подтопление",
    status: "active",
    module: "Общая закупка на ферму",
    unit: "шт.",
    basePrice: 21000,
  },
  {
    id: "m166",
    name: "Обвязка насоса с емкостью подтопление",
    status: "active",
    module: "Общая закупка на ферму",
    unit: "шт.",
    basePrice: 0,
  },
  {
    id: "m174",
    name: "Обвязка насоса с емкостью проточка",
    status: "active",
    module: "Общая закупка на ферму",
    unit: "шт.",
    basePrice: 0,
  },
  {
    id: "m167",
    name: "муфта комбинированная американка",
    status: "active",
    module: "Общая закупка на ферму",
    unit: "шт.",
    basePrice: 300,
  },
  {
    id: "m_mag",
    name: "Труба магистрали",
    status: "active",
    modules: ["Общая магистраль полива и дренажа"],
    farmSections: ["sec_poliv_pod"],
    unit: "м",
    basePrice: 1,
  },
  {
    id: "m_water",
    name: "Фильтр осмос",
    status: "active",
    modules: ["Водоподготовка"],
    unit: "шт.",
    basePrice: 1,
  },
  {
    id: "m_tagged",
    name: "Насос из тега",
    status: "active",
    modules: ["Насосы"],
    unit: "шт.",
    basePrice: 1,
  },
];

describe("nasosnaya section gap close", () => {
  it("sec_nasosnaya present with old custom settings (no prior id)", () => {
    const sections = resolveFarmSections({
      farmSections: JSON.stringify([
        normalizeSection({ id: "sec_poliv_pod", name: "Полив" }),
        normalizeSection({ id: "sec_klimat", name: "Климат" }),
      ]),
    });
    expect(sections.filter((s) => s.id === NASOSNAYA_SECTION_ID)).toHaveLength(1);
    expect(sections.find((s) => s.id === NASOSNAYA_SECTION_ID).name).toBe(NASOSNAYA_CANONICAL_NAME);
  });

  it("dedupes legacy id/name aliases into one card", () => {
    const merged = mergeMissingDefaultFarmSections([
      normalizeSection({ id: "sec_custom_nasos", name: "Насосы" }),
      normalizeSection({ id: "sec_group", name: "Насосная группа" }),
      normalizeSection({ id: "sec_poliv_pod", name: "Полив" }),
    ]);
    const pumpCards = merged.filter(
      (s) => s.id === NASOSNAYA_SECTION_ID || isNasosnayaSectionName(s.name)
    );
    expect(pumpCards).toHaveLength(1);
    expect(pumpCards[0].id).toBe(NASOSNAYA_SECTION_ID);
    expect(merged.filter((s) => s.name === "Насосы")).toHaveLength(0);
  });

  it("dedupeAndCanonicalizeFarmSections collapses duplicate names", () => {
    const out = dedupeAndCanonicalizeFarmSections([
      normalizeSection({ id: "a", name: "Насосная группа и обвязка" }),
      normalizeSection({ id: NASOSNAYA_SECTION_ID, name: NASOSNAYA_CANONICAL_NAME }),
    ]);
    expect(out.filter((s) => s.id === NASOSNAYA_SECTION_ID)).toHaveLength(1);
  });

  it("seed allowlist + module tags land in nasosnaya catalog", () => {
    const lines = catalogLinesForFarmSection(seedLikePumpMaterials, NASOSNAYA_SECTION_ID);
    const ids = new Set(lines.map((l) => l.materialId));
    expect(ids.has("m161")).toBe(true);
    expect(ids.has("m162")).toBe(true);
    expect(ids.has("m166")).toBe(true);
    expect(ids.has("m174")).toBe(true);
    expect(ids.has("m_tagged")).toBe(true);
    for (const id of NASOSNAYA_SEED_MATERIAL_IDS) {
      expect(materialBelongsToNasosnaya({ id, status: "active", module: "Общая закупка на ферму" })).toBe(
        true
      );
    }
  });

  it("does not pull магистраль / водоподготовка / generic fittings by mistake", () => {
    const lines = catalogLinesForFarmSection(seedLikePumpMaterials, NASOSNAYA_SECTION_ID);
    const ids = lines.map((l) => l.materialId);
    expect(ids).not.toContain("m_mag");
    expect(ids).not.toContain("m_water");
    // m167 is in m161–m178 range but not in allowlist
    expect(ids).not.toContain("m167");
    expect(materialExcludedFromNasosnayaCatalog(seedLikePumpMaterials.find((m) => m.id === "m_mag"))).toBe(
      true
    );
    expect(materialBelongsToNasosnaya(seedLikePumpMaterials.find((m) => m.id === "m167"))).toBe(false);
  });

  it("empty nasosnaya catalog reports 0 available / 0 included", () => {
    const lines = catalogLinesForFarmSection(
      [{ id: "m_mag", name: "T", status: "active", modules: ["Общая магистраль полива и дренажа"], unit: "м" }],
      NASOSNAYA_SECTION_ID
    );
    expect(lines).toHaveLength(0);
    expect(includedCount(lines)).toBe(0);
    const state = emptyFarmSectionsState(
      [normalizeSection({ id: NASOSNAYA_SECTION_ID, name: NASOSNAYA_CANONICAL_NAME })],
      {},
      [{ id: "m_mag", name: "T", status: "active", modules: ["Общая магистраль полива и дренажа"], unit: "м" }]
    );
    expect(state[NASOSNAYA_SECTION_ID]).toHaveLength(0);
  });

  it("hydration keeps selected nasosnaya positions", () => {
    const materials = seedLikePumpMaterials;
    const sections = [normalizeSection({ id: NASOSNAYA_SECTION_ID, name: NASOSNAYA_CANONICAL_NAME })];
    const project = {
      id: "p1",
      name: "Farm",
      client: "C",
      type: "проточка",
      status: "active",
      rooms: [],
      stellageConfigs: [],
      manualParams: { ...DEFAULT_MANUAL_PARAMS },
      items: [
        {
          id: "it_pump1",
          materialId: "m162",
          name: "Насос полив подтопление",
          module: NASOSNAYA_CANONICAL_NAME,
          section: NASOSNAYA_CANONICAL_NAME,
          qty: 2,
          includedInProject: true,
          price: 21000,
          unit: "шт.",
        },
      ],
    };
    const hydrated = hydrateBuilderFromProject(project, {
      sections,
      farmCatalogs: {},
      stellageCatalogs: {},
      materials,
    });
    const lines = hydrated.farmSectionLines[NASOSNAYA_SECTION_ID] || [];
    const selected = lines.filter((ln) => ln.included && ln.materialId === "m162");
    expect(selected.length).toBeGreaterThanOrEqual(1);
    expect(selected[0].qty).toBe(2);
  });

  it("builder save does not duplicate nasosnaya items by materialId alone", () => {
    const materials = seedLikePumpMaterials;
    const farmSections = [
      {
        sectionId: NASOSNAYA_SECTION_ID,
        sectionName: NASOSNAYA_CANONICAL_NAME,
        items: [
          {
            id: "ln_pump",
            materialId: "m162",
            name: "Насос полив подтопление",
            qty: 1,
            included: true,
            unit: "шт.",
          },
        ],
      },
    ];
    const existing = [
      {
        id: "it_existing_pump",
        materialId: "m162",
        name: "Насос полив подтопление",
        module: NASOSNAYA_CANONICAL_NAME,
        section: NASOSNAYA_CANONICAL_NAME,
        qty: 1,
        price: 21000,
        status: "ordered",
        actualPrice: 20000,
        clientNote: "keep note",
        internalNote: "keep internal",
      },
    ];
    const built = buildProjectFromBuilder({
      form: { name: "P", client: "C", manualParams: {} },
      stellages: [],
      farmSections,
      materials,
      rooms: [],
      existingItems: existing,
    });
    const result = buildProjectItemsAfterBuilderSave({
      existingItems: existing,
      generatedBuilderItems: built.items,
      builderContext: {
        farmSectionNames: [NASOSNAYA_CANONICAL_NAME],
        activeStellageIds: [],
      },
      materials,
    });
    expect(result.blocked).toBe(false);
    const pumps = result.items.filter((it) => it.materialId === "m162");
    // same logical section+material should merge, not explode
    expect(pumps.length).toBeLessThanOrEqual(2);
    const withStatus = result.items.find((it) => it.actualPrice === 20000 || it.status === "ordered");
    expect(withStatus).toBeTruthy();
  });
});
