import { describe, it, expect } from "vitest";
import { buildProjectItemsAfterBuilderSave } from "../shared/buildProjectItemsAfterBuilderSave.js";
import { buildProjectFromBuilder } from "../src/lib/projectBuilder.js";
import {
  classifyProjectItemOwnership,
  PROJECT_ITEM_OWNERSHIP,
} from "../shared/projectItemOwnership.js";
import {
  applyMaterialCatalogFields,
} from "../src/lib/specLineCore.js";
import {
  buildProjectCatalogUpdateDiff,
  applyCatalogDiffToItem,
  effectiveItemPrice,
} from "../shared/materialCatalogSnapshot.js";
import { buildProjectParityReport } from "../shared/projectParity.js";

const materials = [
  {
    id: "m073",
    name: "Болт М6×20",
    unit: "шт.",
    category: "Крепёж",
    supplier: "Лемана про",
    link: "https://bolt-new",
    basePrice: 12,
  },
  {
    id: "m036",
    name: "Труба профильная",
    unit: "м",
    category: "Каркас",
    supplier: "Металлобаза",
    link: "https://tube",
    basePrice: 100,
  },
];

describe("buildProjectItemsAfterBuilderSave", () => {
  it("preserves SpecEditor-only item after builder save", () => {
    const specItem = {
      id: "it_spec_manual",
      materialId: "m073",
      name: "Болт из SpecEditor",
      module: "Ручной раздел",
      section: "Ручной раздел",
      source: "manual",
      qty: 3,
      price: 99,
      supplier: "Ручной поставщик",
      actualPrice: 88,
      clientComment: "keep",
      status: "ordered",
    };
    const built = buildProjectFromBuilder({
      form: { name: "P", client: "C", manualParams: {} },
      stellages: [
        {
          id: "st1",
          name: "Стеллаж 1",
          moduleName: "Проточка",
          moduleId: "mod1",
          count: 1,
          items: [
            {
              id: "ln1",
              materialId: "m036",
              name: "Труба",
              qty: 5,
              included: true,
              unit: "м",
              category: "Каркас",
            },
          ],
        },
      ],
      farmSections: [],
      materials,
      rooms: [],
      existingItems: [specItem],
    });
    const result = buildProjectItemsAfterBuilderSave({
      existingItems: [specItem],
      generatedBuilderItems: built.items,
      builderContext: {
        farmSectionNames: [],
        activeStellageIds: ["st1"],
      },
      materials,
    });
    expect(result.blocked).toBe(false);
    const kept = result.items.find((it) => it.id === "it_spec_manual");
    expect(kept).toBeTruthy();
    expect(kept.supplier).toBe("Ручной поставщик");
    expect(kept.actualPrice).toBe(88);
    expect(kept.clientComment).toBe("keep");
    expect(kept.status).toBe("ordered");
  });

  it("preserves ambiguous legacy item", () => {
    const legacy = {
      id: "row_legacy_unknown",
      materialId: "m073",
      name: "Legacy",
      module: "Старый модуль",
      qty: 1,
      price: 50,
    };
    const built = buildProjectFromBuilder({
      form: { name: "P", client: "C", manualParams: {} },
      stellages: [],
      farmSections: [],
      materials,
      rooms: [],
    });
    const result = buildProjectItemsAfterBuilderSave({
      existingItems: [legacy],
      generatedBuilderItems: built.items,
      builderContext: { farmSectionNames: [], activeStellageIds: [] },
      materials,
    });
    expect(result.items.some((it) => it.id === "row_legacy_unknown")).toBe(true);
    expect(result.ambiguousIds).toContain("row_legacy_unknown");
  });

  it("keeps same materialId in frame BOM and ordinary rack line", () => {
    const frameItem = {
      id: "st1__it_fbom_bolt",
      materialId: "m073",
      name: "Болт каркас",
      module: "Стеллаж 1",
      section: "Стеллаж 1",
      source: "frame_bom",
      sourceType: "frame_bom",
      moduleRackKey: "mod1:st1",
      qty: 6,
      price: 12,
      supplier: "snap",
    };
    const built = buildProjectFromBuilder({
      form: { name: "P", client: "C", manualParams: {} },
      stellages: [
        {
          id: "st1",
          name: "Стеллаж 1",
          moduleName: "Проточка",
          moduleId: "mod1",
          count: 1,
          items: [
            {
              id: "ln_plumbing",
              materialId: "m073",
              name: "Болт полив",
              qty: 12,
              included: true,
              unit: "шт.",
              category: "Крепёж",
            },
          ],
        },
      ],
      farmSections: [],
      materials,
      rooms: [],
      existingItems: [frameItem],
    });
    const m073rows = built.items.filter((it) => it.materialId === "m073");
    expect(m073rows.length).toBe(1);

    const result = buildProjectItemsAfterBuilderSave({
      existingItems: [frameItem],
      generatedBuilderItems: built.items,
      builderContext: { farmSectionNames: [], activeStellageIds: ["st1"] },
      materials,
    });
    const m073After = result.items.filter((it) => it.materialId === "m073");
    expect(m073After.length).toBe(2);
    expect(m073After.some((it) => it.id === frameItem.id)).toBe(true);
    expect(m073After.some((it) => it.id === "st1__ln_plumbing")).toBe(true);
  });

  it("repeated save is idempotent", () => {
    const existing = [
      {
        id: "st1__ln1",
        materialId: "m036",
        name: "Труба",
        module: "Стеллаж 1",
        qty: 5,
        price: 100,
        supplier: "snap",
      },
    ];
    const built = buildProjectFromBuilder({
      form: { name: "P", client: "C", manualParams: {} },
      stellages: [
        {
          id: "st1",
          name: "Стеллаж 1",
          moduleName: "Проточка",
          moduleId: "mod1",
          count: 1,
          items: [
            {
              id: "ln1",
              materialId: "m036",
              name: "Труба",
              qty: 5,
              included: true,
              unit: "м",
              category: "Каркас",
            },
          ],
        },
      ],
      farmSections: [],
      materials,
      rooms: [],
      existingItems: existing,
    });
    const ctx = { farmSectionNames: [], activeStellageIds: ["st1"] };
    const r1 = buildProjectItemsAfterBuilderSave({
      existingItems: existing,
      generatedBuilderItems: built.items,
      builderContext: ctx,
      materials,
    });
    const r2 = buildProjectItemsAfterBuilderSave({
      existingItems: r1.items,
      generatedBuilderItems: built.items,
      builderContext: ctx,
      materials,
    });
    expect(r2.items.length).toBe(r1.items.length);
    expect(r2.items[0].supplier).toBe("snap");
  });

  it("one-to-one: same section+materialId with different semantic keys stay separate", () => {
    const farmSection = "Полив";
    const existing = [
      {
        id: "farm_row_a",
        materialId: "m073",
        name: "Болт A",
        section: farmSection,
        module: farmSection,
        roomId: "room_a",
        farmGroup: "zone_a",
        sourceKey: "farm:poliv:a",
        qty: 1,
        price: 12,
        purchaseStatus: "ordered",
        actualPrice: 11,
        clientComment: "preserve-A",
      },
      {
        id: "farm_row_b",
        materialId: "m073",
        name: "Болт B",
        section: farmSection,
        module: farmSection,
        roomId: "room_b",
        farmGroup: "zone_b",
        sourceKey: "farm:poliv:b",
        qty: 2,
        price: 12,
        purchaseStatus: "searching",
        actualPrice: 22,
        clientComment: "preserve-B",
      },
    ];
    const generated = [
      {
        id: "gen_new_a",
        materialId: "m073",
        name: "Болт A",
        section: farmSection,
        module: farmSection,
        roomId: "room_a",
        farmGroup: "zone_a",
        sourceKey: "farm:poliv:a",
        qty: 10,
        price: 12,
      },
      {
        id: "gen_new_b",
        materialId: "m073",
        name: "Болт B",
        section: farmSection,
        module: farmSection,
        roomId: "room_b",
        farmGroup: "zone_b",
        sourceKey: "farm:poliv:b",
        qty: 20,
        price: 12,
      },
    ];
    const result = buildProjectItemsAfterBuilderSave({
      existingItems: existing,
      generatedBuilderItems: generated,
      builderContext: {
        farmSectionNames: [farmSection],
        activeStellageIds: [],
      },
      materials,
    });
    expect(result.blocked).toBe(false);
    // merge may adopt generated ids; identity of purchase fields must stay per-row
    const a = result.items.find((it) => it.clientComment === "preserve-A");
    const b = result.items.find((it) => it.clientComment === "preserve-B");
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a.qty).toBe(10);
    expect(b.qty).toBe(20);
    expect(a.actualPrice).toBe(11);
    expect(b.actualPrice).toBe(22);
    expect(a.purchaseStatus).toBe("ordered");
    expect(b.purchaseStatus).toBe("searching");
    expect(a.roomId).toBe("room_a");
    expect(b.roomId).toBe("room_b");
    expect(result.items.filter((it) => it.materialId === "m073")).toHaveLength(2);
  });
});

describe("catalog snapshot policy", () => {
  it("keeps an overridden project price through builder generation", () => {
    const built = buildProjectFromBuilder({
      form: { name: "P", client: "C", manualParams: {} },
      stellages: [{
        id: "st1", moduleId: "mod1", moduleName: "Rack", name: "Rack A", count: 1,
        items: [{ id: "ln1", materialId: "m073", name: "Болт", unit: "шт.", category: "Крепёж", qty: 1, included: true, price: 8.5, priceOverridden: true }],
      }],
      farmSections: [], materials,
    });
    expect(built.items[0].price).toBe(8.5);
    expect(built.items[0].priceOverridden).toBe(true);
    expect(materials[0].basePrice).toBe(12);
  });

  it("keeps project-local primary and alternative links through builder generation", () => {
    const catalogLink = materials[0].link;
    const built = buildProjectFromBuilder({
      form: { name: "P", client: "C", manualParams: {} },
      stellages: [{
        id: "st1", moduleId: "mod1", moduleName: "Rack", name: "Rack A", count: 1,
        items: [{
          id: "ln1", materialId: "m073", name: "Болт", unit: "шт.", category: "Крепёж",
          qty: 1, included: true, price: 12,
          link: "https://project.example/bolt", linkOverridden: true,
          linkAlt: "https://project.example/bolt-alt", linkAltOverridden: true,
        }],
      }],
      farmSections: [], materials,
    });
    expect(built.items[0].link).toBe("https://project.example/bolt");
    expect(built.items[0].linkAlt).toBe("https://project.example/bolt-alt");
    expect(built.items[0].linkOverridden).toBe(true);
    expect(built.items[0].linkAltOverridden).toBe(true);
    expect(materials[0].link).toBe(catalogLink);
  });

  it("keeps project links even when override flags were lost (draft round-trip)", () => {
    const built = buildProjectFromBuilder({
      form: { name: "P", client: "C", manualParams: {} },
      stellages: [{
        id: "st1", moduleId: "mod1", moduleName: "Rack", name: "Rack A", count: 1,
        items: [{
          id: "ln1", materialId: "m073", name: "Болт", unit: "шт.", category: "Крепёж",
          qty: 1, included: true, price: 12,
          // Flags absent — DB does not persist linkOverridden / linkAltOverridden
          link: "https://project.example/bolt-no-flag",
          linkAlt: "https://project.example/bolt-alt-no-flag",
        }],
      }],
      farmSections: [], materials,
    });
    expect(built.items[0].link).toBe("https://project.example/bolt-no-flag");
    expect(built.items[0].linkAlt).toBe("https://project.example/bolt-alt-no-flag");
    expect(built.items[0].linkOverridden).toBe(true);
    expect(built.items[0].linkAltOverridden).toBe(true);
  });

  it("keeps project-local price and links for farm-wide section lines", () => {
    const catalogBefore = { ...materials[0] };
    const built = buildProjectFromBuilder({
      form: { name: "P", client: "C", manualParams: {} },
      stellages: [{
        id: "rack-1",
        moduleId: "rack-module",
        moduleName: "Стеллаж",
        name: "Стеллаж 1",
        count: 1,
        items: [{
          id: "rack-ln1",
          materialId: "m073",
          name: "Болт",
          unit: "шт.",
          qty: 2,
          included: true,
          price: materials[0].basePrice,
          link: materials[0].link,
        }],
      }],
      farmSections: [{
        id: "consumables",
        sectionName: "Расходники запуска",
        items: [{
          id: "farm-ln1",
          materialId: "m073",
          name: "Болт",
          unit: "шт.",
          qty: 3,
          included: true,
          price: 9.5,
          priceOverridden: true,
          link: "https://project.example/farm-bolt",
          linkOverridden: true,
          linkAlt: "https://project.example/farm-bolt-alt",
          linkAltOverridden: true,
        }],
      }],
      materials,
    });

    const farmItem = built.items.find((item) => item.section === "Расходники запуска");
    const rackItem = built.items.find((item) => item.section === "Стеллаж 1");
    expect(farmItem).toMatchObject({
      section: "Расходники запуска",
      price: 9.5,
      link: "https://project.example/farm-bolt",
      linkAlt: "https://project.example/farm-bolt-alt",
      priceOverridden: true,
      linkOverridden: true,
      linkAltOverridden: true,
    });
    expect(rackItem).toMatchObject({
      materialId: "m073",
      price: catalogBefore.basePrice,
      link: catalogBefore.link,
    });
    expect(materials[0]).toEqual(catalogBefore);
  });

  it("does not overwrite existing snapshot on applyMaterialCatalogFields", () => {
    const line = {
      id: "ln1",
      materialId: "m073",
      name: "Snapshot name",
      supplier: "Old supplier",
      link: "https://old",
      price: 99,
      qty: 4,
    };
    const out = applyMaterialCatalogFields(line, materials);
    expect(out.supplier).toBe("Old supplier");
    expect(out.link).toBe("https://old");
    expect(out.price).toBe(99);
  });

  it("fills catalog on new line", () => {
    const line = { id: "ln_new", materialId: "m073", qty: 1 };
    const out = applyMaterialCatalogFields(line, materials, { isNewLine: true });
    expect(out.supplier).toBe("Лемана про");
    expect(out.price).toBe(12);
  });

  it("buildProjectCatalogUpdateDiff detects catalog changes", () => {
    const item = {
      id: "it1",
      materialId: "m073",
      name: "Болт",
      supplier: "Old",
      price: 99,
      link: "https://old",
    };
    const diff = buildProjectCatalogUpdateDiff([item], materials);
    expect(diff.changedItemCount).toBe(1);
    expect(diff.changes[0].diffs.some((d) => d.field === "supplier")).toBe(true);
  });

  it("applyCatalogDiffToItem preserves actualPrice", () => {
    const item = {
      id: "it1",
      materialId: "m073",
      supplier: "Old",
      price: 99,
      actualPrice: 77,
    };
    const mat = materials[0];
    const next = applyCatalogDiffToItem(item, mat, ["supplier", "price"]);
    expect(next.supplier).toBe("Лемана про");
    expect(next.price).toBe(12);
    expect(next.actualPrice).toBe(77);
  });

  it("effectiveItemPrice prefers actualPrice", () => {
    expect(effectiveItemPrice({ price: 10, actualPrice: 25 })).toBe(25);
    expect(effectiveItemPrice({ price: 10 })).toBe(10);
  });
});

describe("projectItemOwnership", () => {
  it("classifies manual source as spec_manual", () => {
    expect(classifyProjectItemOwnership({ id: "it_x", source: "manual" })).toBe(
      PROJECT_ITEM_OWNERSHIP.SPEC_MANUAL,
    );
  });

  it("classifies prefixed st_<id>__ lines as builder even when rack is inactive", () => {
    expect(
      classifyProjectItemOwnership(
        { id: "st_a__ln_pipe", materialId: "m036", name: "Труба", qty: 1 },
        { activeStellageIds: new Set() },
      ),
    ).toBe(PROJECT_ITEM_OWNERSHIP.BUILDER);
  });
});

describe("builder commercial overrides on re-save", () => {
  it("applies new builder priceOverridden over previous project price", () => {
    const existing = [
      {
        id: "st_ms92yvoflhsu3__ln1",
        materialId: "m073",
        name: "Болт",
        module: "Стеллаж 1",
        section: "Стеллаж 1",
        qty: 5,
        price: 12,
        priceOverridden: false,
        purchaseStatus: "ordered",
        actualPrice: 11,
      },
    ];
    const generated = [
      {
        id: "st_ms92yvoflhsu3__ln1",
        materialId: "m073",
        name: "Болт",
        module: "Стеллаж 1",
        section: "Стеллаж 1",
        qty: 9,
        price: 8.5,
        priceOverridden: true,
      },
    ];
    const result = buildProjectItemsAfterBuilderSave({
      existingItems: existing,
      generatedBuilderItems: generated,
      builderContext: { farmSectionNames: [], activeStellageIds: ["st_ms92yvoflhsu3"] },
      materials,
    });
    expect(result.blocked).toBe(false);
    const row = result.items.find((it) => it.id === "st_ms92yvoflhsu3__ln1");
    expect(row.qty).toBe(9);
    expect(row.price).toBe(8.5);
    expect(row.priceOverridden).toBe(true);
    expect(row.actualPrice).toBe(11);
    expect(row.purchaseStatus).toBe("ordered");
  });

  it("drops unmatched leftover builder duplicate after catalog line id change", () => {
    const existing = [
      {
        id: "st_ms92yvoflhsu3__ln_old",
        materialId: "m073",
        name: "Болт",
        module: "Rack",
        section: "Rack",
        qty: 408,
      },
      {
        id: "st_ms92yvoflhsu3__ln_new",
        materialId: "m073",
        name: "Болт",
        module: "Rack",
        section: "Rack",
        qty: 408,
      },
    ];
    const generated = [
      {
        id: "st_ms92yvoflhsu3__ln_new",
        materialId: "m073",
        name: "Болт",
        module: "Rack",
        section: "Rack",
        qty: 100,
      },
    ];
    const result = buildProjectItemsAfterBuilderSave({
      existingItems: existing,
      generatedBuilderItems: generated,
      builderContext: { farmSectionNames: [], activeStellageIds: ["st_ms92yvoflhsu3"] },
      materials,
    });
    expect(result.blocked).toBe(false);
    const bolts = result.items.filter((it) => it.materialId === "m073");
    expect(bolts).toHaveLength(1);
    expect(bolts[0].id).toBe("st_ms92yvoflhsu3__ln_new");
    expect(bolts[0].qty).toBe(100);
    expect(result.removedBuilderIds).toContain("st_ms92yvoflhsu3__ln_old");
  });
});

describe("deleted stellage orphan cleanup", () => {
  it("removes existing composition line when its rack is deleted", () => {
    const orphan = {
      id: "st_a__ln_pipe",
      materialId: "m036",
      name: "Труба",
      module: "Стеллаж A",
      section: "Стеллаж A",
      qty: 5,
      price: 100,
    };
    const result = buildProjectItemsAfterBuilderSave({
      existingItems: [orphan],
      generatedBuilderItems: [],
      builderContext: {
        farmSectionNames: [],
        activeStellageIds: new Set(["st_b"]),
      },
      materials,
    });
    expect(result.blocked).toBe(false);
    expect(result.items.find((it) => it.id === orphan.id)).toBeFalsy();
    expect(result.removedBuilderIds).toContain(orphan.id);
  });

  it("removes composition for deleted rack even when peers share section/material", () => {
    const orphanA = {
      id: "st_a__ln_pipe",
      materialId: "m036",
      name: "Труба",
      module: "Стеллаж",
      section: "Стеллаж",
      qty: 5,
      price: 100,
    };
    const generatedB = {
      id: "st_b__ln_pipe",
      materialId: "m036",
      name: "Труба",
      module: "Стеллаж",
      section: "Стеллаж",
      qty: 3,
      price: 100,
    };
    const result = buildProjectItemsAfterBuilderSave({
      existingItems: [orphanA],
      generatedBuilderItems: [generatedB],
      builderContext: {
        farmSectionNames: [],
        activeStellageIds: new Set(["st_b"]),
      },
      materials,
    });
    expect(result.blocked).toBe(false);
    expect(result.items.find((it) => it.id === orphanA.id)).toBeFalsy();
    expect(result.removedBuilderIds).toContain(orphanA.id);
    expect(result.items.find((it) => it.id === generatedB.id)).toBeTruthy();
  });

  it("removes frame_bom for deleted rack without invariant block", () => {
    const frameOrphan = {
      id: "it_fbom_orphan",
      materialId: "m073",
      name: "Болт каркас",
      module: "Стеллаж A",
      section: "Стеллаж A",
      source: "frame_bom",
      sourceType: "frame_bom",
      moduleRackKey: "mod1:st_a",
      qty: 6,
      price: 12,
    };
    const result = buildProjectItemsAfterBuilderSave({
      existingItems: [frameOrphan],
      generatedBuilderItems: [],
      builderContext: {
        farmSectionNames: [],
        activeStellageIds: new Set(["st_b"]),
      },
      materials,
    });
    expect(result.blocked).toBe(false);
    expect(result.items.find((it) => it.id === frameOrphan.id)).toBeFalsy();
    expect(result.removedBuilderIds).toContain(frameOrphan.id);
  });

  it("still merges composition for an active rack", () => {
    const existing = {
      id: "st_a__ln_pipe",
      materialId: "m036",
      name: "Труба",
      module: "Стеллаж A",
      section: "Стеллаж A",
      qty: 5,
      price: 100,
      status: "ordered",
      actualPrice: 88,
    };
    const generated = {
      id: "st_a__ln_pipe",
      materialId: "m036",
      name: "Труба",
      module: "Стеллаж A",
      section: "Стеллаж A",
      qty: 7,
      price: 100,
    };
    const result = buildProjectItemsAfterBuilderSave({
      existingItems: [existing],
      generatedBuilderItems: [generated],
      builderContext: {
        farmSectionNames: [],
        activeStellageIds: new Set(["st_a"]),
      },
      materials,
    });
    expect(result.blocked).toBe(false);
    const kept = result.items.find((it) => it.id === existing.id);
    expect(kept).toBeTruthy();
    expect(kept.qty).toBe(7);
    expect(kept.status).toBe("ordered");
    expect(kept.actualPrice).toBe(88);
    expect(result.removedBuilderIds).not.toContain(existing.id);
  });

  it("still preserves SpecEditor manual items when racks are deleted", () => {
    const specItem = {
      id: "it_spec_manual",
      materialId: "m073",
      name: "Болт из SpecEditor",
      module: "Ручной раздел",
      section: "Ручной раздел",
      source: "manual",
      qty: 3,
      price: 99,
      actualPrice: 88,
    };
    const orphan = {
      id: "st_a__ln_pipe",
      materialId: "m036",
      name: "Труба",
      module: "Стеллаж A",
      section: "Стеллаж A",
      qty: 5,
      price: 100,
    };
    const result = buildProjectItemsAfterBuilderSave({
      existingItems: [specItem, orphan],
      generatedBuilderItems: [],
      builderContext: {
        farmSectionNames: [],
        activeStellageIds: new Set(),
      },
      materials,
    });
    expect(result.blocked).toBe(false);
    expect(result.items.find((it) => it.id === specItem.id)).toBeTruthy();
    expect(result.items.find((it) => it.id === orphan.id)).toBeFalsy();
    expect(result.preservedManualIds).toContain(specItem.id);
  });
});

describe("buildProjectParityReport", () => {
  it("reports same client totals for merged pool", () => {
    const project = {
      items: [
        {
          id: "it1",
          materialId: "m073",
          name: "Болт",
          unit: "шт.",
          qty: 2,
          price: 10,
          supplier: "S",
          link: "L",
          includedInProject: true,
          visibleToClient: true,
          vatRate: 0,
        },
      ],
    };
    const report = buildProjectParityReport(project, materials);
    expect(report.client.total).toBe(report.pdf.total);
    expect(report.differences.filter((d) => d.kind === "hidden_in_client_merge")).toHaveLength(0);
  });
});
