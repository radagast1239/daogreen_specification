import { describe, expect, it } from "vitest";
import {
  mergeFrameBomIntoProjectItems,
  isFrameBomItemForRack,
  isFrameBomLine,
  buildFrameBomSourceRackPrefix,
  frameBomItemsForModuleRack,
  enrichFrameBomDraftWithMaterials,
  findMissingFrameBomMaterials,
  formatFrameBomMissingMaterialsMessage,
  resolveFrameBomItemModuleRackKey,
  sourceKeyMatchesModuleRack,
  shouldRemoveFrameBomOnMerge,
  dedupeFrameBomProjectItems,
  countDedupedFrameBomItems,
  isExplicitManualProjectItem,
  buildFrameBomRepairPlan,
  isBuilderSyncedFrameBomLine,
  resolveBuilderPrefixedStellageId,
  buildLegacyFrameBomDedupePlan,
  hasLegacyFrameBomRowsForRack,
  rackFrameBomScopeItems,
  buildResidualFrameBomTwinRepairPlan,
  stripResidualFrameBomTwins,
  syncProjectItemStellageLabels,
  countResidualFrameBomTwins,
  isCanonicalFrameBomLine,
} from "../shared/frameBomProjectItems.js";
import * as frameBomProjectItems from "../shared/frameBomProjectItems.js";

const TUBE_CUTS = [
  { lengthMm: 3200, qty: 6 },
  { lengthMm: 1470, qty: 32 },
  { lengthMm: 460, qty: 48 },
];

const baseOpts = {
  projectId: "p1",
  drawingId: "d1",
  moduleRackKey: "rack1",
  stellageId: "st1",
  rackLabel: "Стеллаж 1",
};

const catalogMaterials = [
  {
    id: "m036",
    name: "Труба профильная 20/20/1,5 мм",
    unit: "м",
    basePrice: 120,
    supplier: "МеталлБаза",
    link: "https://example.com/tube",
    imageUrl: "/photos/m036.jpg",
    category: "Каркас",
  },
  {
    id: "m072",
    name: "Краб-система Г-образная 20×20, 1.2 мм",
    unit: "шт",
    basePrice: 45,
    supplier: "КрепёжПро",
    link: "https://example.com/crab-g",
    photoUrl: "/photos/m072.jpg",
    category: "Каркас",
  },
];

function tubeDraft(overrides = {}) {
  const draft = {
    key: "profile_tube_20x20",
    materialId: "m036",
    name: "Труба профильная 20/20/1,5 мм",
    unit: "м",
    qty: 88.32,
    pipeCuts: TUBE_CUTS,
    techNote: "Резы профтрубы: 3200 мм × 6 шт",
    ...overrides,
  };
  if (Object.hasOwn(overrides, "qty") && !Object.hasOwn(overrides, "pipeCuts")) {
    draft.pipeCuts = [{ lengthMm: 1000, qty: overrides.qty }];
  }
  return draft;
}

function crabGDraft(overrides = {}) {
  return {
    key: "crab_g",
    materialId: "m072",
    name: "Краб-система Г-образная 20×20, 1.2 мм",
    unit: "шт",
    qty: 4,
    ...overrides,
  };
}

function boltDraft(overrides = {}) {
  return {
    key: "bolt_m6",
    materialId: "m073",
    name: "Болт М6×20",
    unit: "шт",
    qty: 312,
    ...overrides,
  };
}

function legacyBomItem({
  id,
  materialId,
  qty = 1,
  price = 0,
  supplier = "поставщик",
  moduleRackKey = "rack1",
  rackLabel = "Стеллаж 1",
  note = "Из схемы стеллажа",
} = {}) {
  return {
    id: id || `legacy_${materialId}`,
    materialId,
    name: "Legacy BOM",
    qty,
    price,
    supplier,
    link: "",
    module: rackLabel,
    section: rackLabel,
    note,
    clientNote: note,
    sourceObjectIds: moduleRackKey ? { moduleRackKey } : {},
  };
}

function canonicalBomItem({
  materialId,
  moduleRackKey = "rack1",
  drawingId = "d1",
  bomKey,
  qty = 312,
  price = 0.5,
  supplier = "КрепёжПро",
  actualPrice,
  clientComment,
  visibleToClient = true,
} = {}) {
  const key = bomKey || (materialId === "m073" ? "bolt_m6" : materialId === "m072" ? "crab_g" : "profile_tube_20x20");
  return {
    id: `it_fbom_${drawingId}_${moduleRackKey}_${key}`,
    materialId,
    name: "Canonical BOM",
    qty,
    price,
    supplier,
    source: "frame_bom",
    sourceType: "frame_bom",
    frameBom: true,
    fromFrameBom: true,
    isFrameBom: true,
    bomKey: key,
    moduleRackKey,
    sourceKey: `frame_bom:${drawingId}:${moduleRackKey}:${key}`,
    sourceObjectIds: { moduleRackKey, bomKey: key, frameDrawingId: drawingId },
    actualPrice,
    clientComment,
    visibleToClient,
    visible: visibleToClient,
    approved: visibleToClient,
    module: "Стеллаж 1",
  };
}

function frameBomItem({ sourceKey, name = "BOM", materialId = "m036", moduleRackKey = "rack1", drawingId = "d1" }) {
  return {
    id: `old_${sourceKey}`,
    name,
    materialId,
    qty: 1,
    source: "frame_bom",
    sourceType: "frame_bom",
    sourceKey,
    sourceObjectIds: {
      moduleRackKey,
      frameDrawingId: drawingId,
      bomKey: sourceKey.split(":").pop(),
    },
  };
}

describe("mergeFrameBomIntoProjectItems", () => {
  it("adds frame BOM items and keeps unrelated positions", () => {
    const existing = [{ id: "it_client", name: "Клиентская позиция", source: "manual" }];
    const result = mergeFrameBomIntoProjectItems(existing, [tubeDraft(), crabGDraft()], baseOpts);

    expect(result.keptCount).toBe(1);
    expect(result.addedCount).toBe(2);
    expect(result.removedCount).toBe(0);
    expect(result.items).toHaveLength(3);
    expect(result.items[0].name).toBe("Клиентская позиция");

    const tube = result.items.find((i) => i.materialId === "m036");
    const crab = result.items.find((i) => i.materialId === "m072");
    expect(tube.source).toBe("frame_bom");
    expect(tube.sourceKey).toBe("frame_bom:d1:rack1:profile_tube_20x20");
    expect(tube.pipeCuts).toEqual(TUBE_CUTS);
    expect(crab.sourceKey).toBe("frame_bom:d1:rack1:crab_g");
  });

  it("replaces old BOM for same rack without duplicates", () => {
    const existing = [
      frameBomItem({ sourceKey: "frame_bom:d1:rack1:profile_tube_20x20" }),
      frameBomItem({ sourceKey: "frame_bom:d1:rack1:crab_g", materialId: "m072", name: "Crab" }),
      { id: "it_client", name: "Клиентская позиция" },
    ];
    const result = mergeFrameBomIntoProjectItems(
      existing,
      [tubeDraft({ qty: 90 }), crabGDraft({ qty: 8 })],
      baseOpts,
    );

    expect(result.removedCount).toBe(2);
    expect(result.addedCount).toBe(2);
    expect(result.keptCount).toBe(1);
    expect(result.items).toHaveLength(3);

    const oldIds = existing.filter((i) => i.source === "frame_bom").map((i) => i.id);
    expect(result.items.some((i) => oldIds.includes(i.id))).toBe(false);

    const tube = result.items.find((i) => i.materialId === "m036");
    expect(tube.qty).toBe(90);
    expect(result.items.find((i) => i.materialId === "m072")?.qty).toBe(8);
  });

  it("does not remove BOM for another rack", () => {
    const rack2Item = frameBomItem({
      sourceKey: "frame_bom:d1:rack2:profile_tube_20x20",
      moduleRackKey: "rack2",
    });
    const existing = [
      frameBomItem({ sourceKey: "frame_bom:d1:rack1:profile_tube_20x20", moduleRackKey: "rack1" }),
      rack2Item,
    ];
    const result = mergeFrameBomIntoProjectItems(existing, [tubeDraft()], baseOpts);

    expect(result.removedCount).toBe(1);
    expect(result.items.some((i) => i.id === rack2Item.id)).toBe(true);
    expect(result.items.filter((i) => i.source === "frame_bom")).toHaveLength(2);
  });

  it("skips draft without materialId and returns warning", () => {
    const result = mergeFrameBomIntoProjectItems(
      [],
      [{ key: "crab_x", qty: 5, name: "Краб X" }],
      baseOpts,
    );

    expect(result.addedCount).toBe(0);
    expect(result.warnings.some((w) => w.includes("materialId"))).toBe(true);
  });

  it("does not mutate existingItems input", () => {
    const existing = [{ id: "a", qty: 1, nested: { x: 1 } }];
    const snapshot = JSON.parse(JSON.stringify(existing));
    mergeFrameBomIntoProjectItems(existing, [tubeDraft()], baseOpts);
    expect(existing).toEqual(snapshot);
  });

  it("preserves pipeCuts for m036 in project item shape", () => {
    const result = mergeFrameBomIntoProjectItems([], [tubeDraft()], baseOpts);
    const tube = result.items[0];
    expect(tube.pipeCuts).toEqual(TUBE_CUTS);
    expect(tube.clientNote).toContain("3200 мм");
    expect(tube.techNote).toContain("Резы профтрубы");
  });

  it("uses unsaved prefix and warning when drawingId is missing", () => {
    const result = mergeFrameBomIntoProjectItems(
      [],
      [tubeDraft()],
      { ...baseOpts, drawingId: "" },
    );

    expect(result.sourceRackPrefix).toBe("frame_bom:unsaved:rack1");
    expect(result.warnings.some((w) => w.includes("drawingId"))).toBe(true);
    expect(result.items[0].sourceKey).toBe("frame_bom:unsaved:rack1:profile_tube_20x20");
  });

  it("enriches BOM items from materials catalog when materials provided", () => {
    const result = mergeFrameBomIntoProjectItems(
      [],
      [tubeDraft(), crabGDraft()],
      { ...baseOpts, materials: catalogMaterials },
    );

    const tube = result.items.find((i) => i.materialId === "m036");
    const crab = result.items.find((i) => i.materialId === "m072");
    expect(tube.name).toBe("Труба профильная 20/20/1,5 мм");
    expect(tube.price).toBe(120);
    expect(tube.supplier).toBe("МеталлБаза");
    expect(tube.link).toBe("https://example.com/tube");
    expect(tube.imageUrl).toBe("/photos/m036.jpg");
    expect(tube.qty).toBe(88.32);
    expect(tube.pipeCuts).toEqual(TUBE_CUTS);
    expect(crab.name).toBe("Краб-система Г-образная 20×20, 1.2 мм");
    expect(crab.price).toBe(45);
    expect(crab.supplier).toBe("КрепёжПро");
    expect(crab.photoUrl).toBe("/photos/m072.jpg");
  });

  it("catalog name wins over draft display name", () => {
    const { enriched } = enrichFrameBomDraftWithMaterials(
      crabGDraft({ name: "Самодельное имя краба" }),
      catalogMaterials,
    );
    expect(enriched.name).toBe("Краб-система Г-образная 20×20, 1.2 мм");
  });

  it("blocks entire add when materialId missing in catalog", () => {
    const result = mergeFrameBomIntoProjectItems(
      [{ id: "keep", name: "Клиент" }],
      [tubeDraft(), crabGDraft()],
      { ...baseOpts, materials: [catalogMaterials[0]] },
    );

    expect(result.blocked).toBe(true);
    expect(result.missingMaterialIds).toEqual(["m072"]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("Клиент");
    expect(result.addedCount).toBe(0);
    expect(result.blockedReason).toContain("BOM не добавлен");
    expect(result.blockedReason).toContain("m072");
  });

  it("formatFrameBomMissingMaterialsMessage lists ids with labels", () => {
    const msg = formatFrameBomMissingMaterialsMessage(["m072", "m999"]);
    expect(msg).toContain("BOM не добавлен");
    expect(msg).toContain("m072");
    expect(msg).toContain("новая позиция в базу");
  });

  it("findMissingFrameBomMaterials returns unique missing ids", () => {
    expect(findMissingFrameBomMaterials([tubeDraft(), crabGDraft()], [catalogMaterials[0]])).toEqual([
      "m072",
    ]);
  });

  it("same rack same drawing replaces tube qty without duplicates", () => {
    const existing = [
      frameBomItem({
        sourceKey: "frame_bom:d1:rack1:profile_tube_20x20",
        materialId: "m036",
        name: "Tube",
      }),
    ];
    existing[0].qty = 88;
    const result = mergeFrameBomIntoProjectItems(
      existing,
      [tubeDraft({ qty: 70 })],
      baseOpts,
    );
    const tubes = result.items.filter((i) => i.materialId === "m036" && i.source === "frame_bom");
    expect(tubes).toHaveLength(1);
    expect(tubes[0].qty).toBe(70);
    expect(result.removedCount).toBe(1);
  });

  it("same rack new drawingId removes old BOM and adds new", () => {
    const existing = [
      frameBomItem({
        sourceKey: "frame_bom:drawing_old:rack1:crab_g",
        materialId: "m072",
        drawingId: "drawing_old",
      }),
    ];
    const result = mergeFrameBomIntoProjectItems(
      existing,
      [crabGDraft({ qty: 8 })],
      { ...baseOpts, drawingId: "drawing_new" },
    );
    expect(result.removedCount).toBe(1);
    expect(result.items.filter((i) => i.source === "frame_bom")).toHaveLength(1);
    expect(result.items[0].sourceKey).toBe("frame_bom:drawing_new:rack1:crab_g");
    expect(result.items[0].qty).toBe(8);
    expect(result.items.some((i) => i.id === existing[0].id)).toBe(false);
  });

  it("different rack BOM is not removed when merging another rack", () => {
    const rack2Item = frameBomItem({
      sourceKey: "frame_bom:d_old:rack2:profile_tube_20x20",
      moduleRackKey: "rack2",
    });
    const existing = [
      frameBomItem({ sourceKey: "frame_bom:d_old:rack1:profile_tube_20x20" }),
      rack2Item,
    ];
    const result = mergeFrameBomIntoProjectItems(existing, [tubeDraft()], baseOpts);
    expect(result.items.some((i) => i.id === rack2Item.id)).toBe(true);
    expect(result.items.filter((i) => i.source === "frame_bom")).toHaveLength(2);
  });

  it("manual item with same materialId is kept when frame_bom is replaced", () => {
    const existing = [
      { id: "manual_tube", materialId: "m036", name: "Manual tube", qty: 5, source: "manual" },
      frameBomItem({
        sourceKey: "frame_bom:d1:rack1:profile_tube_20x20",
        materialId: "m036",
      }),
    ];
    existing[1].qty = 88;
    const result = mergeFrameBomIntoProjectItems(existing, [tubeDraft({ qty: 70 })], baseOpts);
    expect(result.items.find((i) => i.id === "manual_tube")?.qty).toBe(5);
    const bomTube = result.items.find((i) => i.source === "frame_bom" && i.materialId === "m036");
    expect(bomTube?.qty).toBe(70);
    expect(result.items.filter((i) => i.materialId === "m036")).toHaveLength(2);
  });

  it("construction type change removes old crabs and adds new angle BOM", () => {
    const existing = [
      frameBomItem({ sourceKey: "frame_bom:d1:rack1:crab_g", materialId: "m072", name: "Crab G" }),
      frameBomItem({ sourceKey: "frame_bom:d1:rack1:crab_t", materialId: "m071", name: "Crab T" }),
    ];
    const angleDraft = {
      key: "perforated_angle",
      materialId: "m_ohPQJOXcD2",
      name: "Перфорированный уголок",
      unit: "шт",
      qty: 12,
    };
    const result = mergeFrameBomIntoProjectItems(existing, [angleDraft], baseOpts);
    expect(result.items.filter((i) => i.source === "frame_bom")).toHaveLength(1);
    expect(result.items[0].materialId).toBe("m_ohPQJOXcD2");
    expect(result.items.some((i) => i.materialId === "m072")).toBe(false);
    expect(result.items.some((i) => i.materialId === "m071")).toBe(false);
  });

  it("removed material from new BOM disappears from rack scope", () => {
    const existing = [
      frameBomItem({
        sourceKey: "frame_bom:d1:rack1:nft_duct",
        materialId: "m010",
        name: "Воздуховод",
      }),
      frameBomItem({
        sourceKey: "frame_bom:d1:rack1:profile_tube_20x20",
        materialId: "m036",
      }),
    ];
    const result = mergeFrameBomIntoProjectItems(existing, [tubeDraft()], baseOpts);
    expect(result.items.some((i) => i.materialId === "m010")).toBe(false);
    expect(result.items.filter((i) => i.source === "frame_bom")).toHaveLength(1);
  });

  it("snake_case source_object_ids JSON is matched for rack replace", () => {
    const existing = [{
      id: "snake_fb",
      source_type: "frame_bom",
      source_key: "frame_bom:d1:mod1:st1:crab_g",
      materialId: "m072",
      qty: 4,
      source_object_ids: JSON.stringify({ module_rack_key: "mod1:st1" }),
    }];
    const result = mergeFrameBomIntoProjectItems(
      existing,
      [crabGDraft({ qty: 9 })],
      { ...baseOpts, moduleRackKey: "mod1:st1", drawingId: "d2" },
    );
    expect(result.removedCount).toBe(1);
    expect(result.items.some((i) => i.id === "snake_fb")).toBe(false);
    expect(result.items.find((i) => i.source === "frame_bom")?.qty).toBe(9);
  });

  it("missing moduleRackKey blocks merge and leaves items unchanged", () => {
    const existing = [{ id: "keep", name: "Клиент" }];
    const result = mergeFrameBomIntoProjectItems(existing, [tubeDraft()], {
      ...baseOpts,
      moduleRackKey: "",
    });
    expect(result.blocked).toBe(true);
    expect(result.blockedReason).toContain("нет привязки к стеллажу");
    expect(result.addedCount).toBe(0);
    expect(result.items).toEqual(existing);
  });

  it("merge removes legacy duplicate BOM rows for same rack", () => {
    const existing = [
      legacyBomItem({ id: "old_bolt", materialId: "m073", qty: 312 }),
      canonicalBomItem({ materialId: "m073", qty: 312, price: 0.5 }),
      legacyBomItem({ id: "old_crab", materialId: "m072", qty: 28 }),
      canonicalBomItem({ materialId: "m072", bomKey: "crab_g", qty: 28, price: 12 }),
    ];
    const result = mergeFrameBomIntoProjectItems(
      existing,
      [boltDraft(), crabGDraft({ qty: 28 })],
      { ...baseOpts, materials: [
        ...catalogMaterials,
        { id: "m073", name: "Болт М6×20", unit: "шт", basePrice: 0.5, supplier: "КрепёжПро" },
      ] },
    );
    expect(result.removedCount).toBe(4);
    expect(result.items.filter((i) => i.materialId === "m073" && isFrameBomLine(i))).toHaveLength(1);
    expect(result.items.filter((i) => i.materialId === "m072" && isFrameBomLine(i))).toHaveLength(1);
    expect(result.items.some((i) => i.id === "old_bolt")).toBe(false);
    expect(result.items.some((i) => i.id === "old_crab")).toBe(false);
  });

  it("merge keeps manual rows with same materialId but no BOM markers", () => {
    const existing = [
      legacyBomItem({ id: "old_bolt", materialId: "m073" }),
      canonicalBomItem({ materialId: "m073" }),
      {
        id: "manual_bolt",
        materialId: "m073",
        name: "Болт М6×20",
        qty: 20,
        source: "manual",
        note: "добавлено вручную",
        module: "Стеллаж 1",
      },
    ];
    const result = mergeFrameBomIntoProjectItems(existing, [boltDraft()], baseOpts);
    expect(result.items.find((i) => i.id === "manual_bolt")?.qty).toBe(20);
    expect(result.items.filter((i) => i.materialId === "m073")).toHaveLength(2);
    expect(isExplicitManualProjectItem(result.items.find((i) => i.id === "manual_bolt"))).toBe(true);
  });

  it("merge does not remove BOM rows from another rack", () => {
    const rack2Legacy = legacyBomItem({
      id: "rack2_bolt",
      materialId: "m073",
      moduleRackKey: "rack2",
      rackLabel: "Стеллаж 2",
    });
    rack2Legacy.sourceObjectIds = { moduleRackKey: "rack2" };
    const existing = [
      legacyBomItem({ id: "rack1_bolt", materialId: "m073" }),
      rack2Legacy,
    ];
    const result = mergeFrameBomIntoProjectItems(existing, [boltDraft()], baseOpts);
    expect(result.items.some((i) => i.id === "rack2_bolt")).toBe(true);
    expect(result.items.some((i) => i.id === "rack1_bolt")).toBe(false);
  });

  it("merge preserves status/actualPrice/clientComment/visibleToClient from existing current BOM line", () => {
    const existing = [
      legacyBomItem({ id: "old_bolt", materialId: "m073" }),
      {
        ...canonicalBomItem({ materialId: "m073" }),
        status: "ordered",
        purchaseStatus: "ordered",
        actualPrice: 0.45,
        clientComment: "уточнить длину",
        visibleToClient: false,
        visible: false,
        approved: false,
      },
    ];
    const result = mergeFrameBomIntoProjectItems(existing, [boltDraft()], baseOpts);
    const bolt = result.items.find((i) => i.materialId === "m073" && isFrameBomLine(i));
    expect(bolt.status).toBe("ordered");
    expect(bolt.actualPrice).toBe(0.45);
    expect(bolt.clientComment).toBe("уточнить длину");
    expect(bolt.visibleToClient).toBe(false);
  });

  it("merge removes old zero-price placeholder BOM when current material-backed BOM exists", () => {
    const existing = [
      legacyBomItem({ id: "placeholder", materialId: "m072", qty: 28, price: 0, supplier: "поставщик" }),
    ];
    const result = mergeFrameBomIntoProjectItems(
      existing,
      [crabGDraft({ qty: 28 })],
      { ...baseOpts, materials: catalogMaterials },
    );
    expect(result.items.filter((i) => i.materialId === "m072")).toHaveLength(1);
    expect(result.items[0].supplier).toBe("КрепёжПро");
    expect(result.items[0].price).toBe(45);
  });

  it("merge handles air duct/NFT BOM duplicates", () => {
    const existing = [
      legacyBomItem({
        id: "old_duct",
        materialId: "m010",
        note: "Из схемы стеллажа",
        rackLabel: "Стеллаж 1",
      }),
      frameBomItem({
        sourceKey: "frame_bom:d1:rack1:nft_duct",
        materialId: "m010",
        name: "Воздуховод",
      }),
    ];
    const ductDraft = {
      key: "nft_duct",
      materialId: "m010",
      name: "Воздуховод NFT",
      unit: "м",
      qty: 12,
    };
    const result = mergeFrameBomIntoProjectItems(existing, [ductDraft], baseOpts);
    expect(result.items.filter((i) => i.materialId === "m010")).toHaveLength(1);
    expect(result.items.find((i) => i.materialId === "m010")?.qty).toBe(12);
  });

  it('merge handles rows with note "Из схемы стеллажа"', () => {
    const existing = [
      {
        id: "note_only",
        materialId: "m072",
        qty: 28,
        price: 0,
        module: "Стеллаж 1",
        note: "Из схемы стеллажа",
      },
    ];
    expect(shouldRemoveFrameBomOnMerge(existing[0], "rack1", { rackLabel: "Стеллаж 1" })).toBe(true);
    const result = mergeFrameBomIntoProjectItems(existing, [crabGDraft({ qty: 28 })], baseOpts);
    expect(result.items.some((i) => i.id === "note_only")).toBe(false);
    expect(result.items.filter((i) => i.materialId === "m072")).toHaveLength(1);
  });

  it("merge handles colon sourceKey ids", () => {
    const existing = [{
      id: "frame_bom:d1:mod1:st1:crab_g",
      sourceKey: "frame_bom:d1:mod1:st1:crab_g",
      materialId: "m072",
      qty: 4,
      note: "Из схемы стеллажа",
      sourceObjectIds: { moduleRackKey: "mod1:st1" },
    }];
    const result = mergeFrameBomIntoProjectItems(
      existing,
      [crabGDraft({ qty: 9 })],
      { ...baseOpts, moduleRackKey: "mod1:st1", drawingId: "d2" },
    );
    expect(result.removedCount).toBe(1);
    expect(result.items.filter((i) => i.source === "frame_bom")).toHaveLength(1);
    expect(result.items[0].qty).toBe(9);
  });

  it("repeated merge is idempotent: running twice does not increase item count", () => {
    const existing = [
      legacyBomItem({ id: "old_bolt", materialId: "m073" }),
      canonicalBomItem({ materialId: "m073" }),
    ];
    const first = mergeFrameBomIntoProjectItems(existing, [boltDraft()], baseOpts);
    const second = mergeFrameBomIntoProjectItems(first.items, [boltDraft()], baseOpts);
    expect(second.items.length).toBe(first.items.length);
    expect(second.removedCount).toBe(1);
    expect(second.addedCount).toBe(1);
  });

  it("update BOM after legacy duplicates results in same item count as clean merge", () => {
    const dirty = [
      legacyBomItem({ id: "old_bolt", materialId: "m073" }),
      canonicalBomItem({ materialId: "m073" }),
      legacyBomItem({ id: "old_crab", materialId: "m072" }),
      canonicalBomItem({ materialId: "m072", bomKey: "crab_g" }),
      { id: "manual_bolt", materialId: "m073", qty: 20, source: "manual", note: "добавлено вручную" },
    ];
    const clean = [{ id: "manual_bolt", materialId: "m073", qty: 20, source: "manual", note: "добавлено вручную" }];
    const dirtyResult = mergeFrameBomIntoProjectItems(
      dirty,
      [boltDraft(), crabGDraft({ qty: 28 })],
      baseOpts,
    );
    const cleanResult = mergeFrameBomIntoProjectItems(
      clean,
      [boltDraft(), crabGDraft({ qty: 28 })],
      baseOpts,
    );
    expect(dirtyResult.items.length).toBe(cleanResult.items.length);
    expect(dirtyResult.items.filter((i) => isFrameBomLine(i)).length)
      .toBe(cleanResult.items.filter((i) => isFrameBomLine(i)).length);
  });
});

describe("frameBom source helpers", () => {
  it("buildFrameBomSourceRackPrefix", () => {
    expect(buildFrameBomSourceRackPrefix({ drawingId: "d1", moduleRackKey: "rack1" }).prefix).toBe(
      "frame_bom:d1:rack1",
    );
  });

  it("isFrameBomItemForRack matches rack scope, not drawingId", () => {
    expect(isFrameBomItemForRack(
      { source: "frame_bom", sourceKey: "frame_bom:d1:rack1:crab_g", sourceObjectIds: { moduleRackKey: "rack1" } },
      "rack1",
    )).toBe(true);
    expect(isFrameBomItemForRack(
      { source: "frame_bom", sourceKey: "frame_bom:d_old:rack1:crab_g", sourceObjectIds: { moduleRackKey: "rack1" } },
      "rack1",
    )).toBe(true);
    expect(isFrameBomItemForRack(
      { source: "frame_bom", sourceKey: "frame_bom:d1:rack2:crab_g", sourceObjectIds: { moduleRackKey: "rack2" } },
      "rack1",
    )).toBe(false);
    expect(isFrameBomItemForRack({ source: "manual", sourceKey: "frame_bom:d1:rack1:crab_g" }, "rack1")).toBe(false);
  });

  it("resolveFrameBomItemModuleRackKey reads snake_case source_object_ids", () => {
    const key = resolveFrameBomItemModuleRackKey({
      source_object_ids: { module_rack_key: "mod1:st1" },
    });
    expect(key).toBe("mod1:st1");
  });

  it("sourceKeyMatchesModuleRack supports colonated rack keys", () => {
    expect(sourceKeyMatchesModuleRack("frame_bom:d1:mod1:st1:crab_g", "mod1:st1")).toBe(true);
    expect(sourceKeyMatchesModuleRack("frame_bom:d1:rack2:crab_g", "mod1:st1")).toBe(false);
  });

  it("frameBomItemsForModuleRack filters BOM lines for one rack", () => {
    const items = [
      frameBomItem({ sourceKey: "frame_bom:d1:rack1:profile_tube_20x20", moduleRackKey: "rack1" }),
      frameBomItem({ sourceKey: "frame_bom:d1:rack2:profile_tube_20x20", moduleRackKey: "rack2" }),
    ];
    const rack1 = frameBomItemsForModuleRack(items, "rack1");
    expect(rack1).toHaveLength(1);
    expect(rack1[0].sourceKey).toContain("rack1");
  });
});

describe("isFrameBomLine detection", () => {
  it("merge creates stable frame BOM markers immediately", () => {
    const result = mergeFrameBomIntoProjectItems([], [tubeDraft()], baseOpts);
    expect(result.addedCount).toBe(1);
    const item = result.items[0];
    expect(item.source).toBe("frame_bom");
    expect(item.sourceType).toBe("frame_bom");
    expect(item.frameBom).toBe(true);
    expect(item.fromFrameBom).toBe(true);
    expect(item.isFrameBom).toBe(true);
    expect(item.bomKey).toBe("profile_tube_20x20");
    expect(item.moduleRackKey).toBe("rack1");
    expect(item.drawingId).toBe("d1");
    expect(item.sourceKey).toContain("frame_bom:");
    expect(item.sourceObjectIds.bomKey).toBe("profile_tube_20x20");
    expect(item.sourceObjectIds.moduleRackKey).toBe("rack1");
    expect(isFrameBomLine(item)).toBe(true);
    expect(frameBomItemsForModuleRack(result.items, "rack1")).toHaveLength(1);
  });

  it("detects sourceKey prefix without source field", () => {
    expect(
      isFrameBomLine({
        id: "frame_bom:d1:rack1:bolt_m6",
        sourceKey: "frame_bom:d1:rack1:bolt_m6",
      })
    ).toBe(true);
  });

  it("detects bomKey in sourceObjectIds", () => {
    expect(
      isFrameBomLine({
        id: "it_row",
        sourceObjectIds: { bomKey: "crab_g", moduleRackKey: "rack1" },
      })
    ).toBe(true);
  });

  it("detects moduleRackKey with sourceKey", () => {
    expect(
      isFrameBomLine({
        id: "it_row",
        sourceKey: "frame_bom:d1:rack1:crab_t",
        sourceObjectIds: { moduleRackKey: "rack1" },
      })
    ).toBe(true);
  });

  it("detects pipeCuts + moduleRackKey from frame constructor", () => {
    expect(
      isFrameBomLine({
        id: "it_row",
        materialId: "m036",
        sourceKey: "frame_bom:d1:rack1:profile_tube_20x20",
        sourceObjectIds: { moduleRackKey: "rack1", bomKey: "profile_tube_20x20" },
        pipeCuts: [{ lengthMm: 3200, qty: 6 }],
      })
    ).toBe(true);
  });

  it("does not treat manual tube without BOM markers as frame BOM", () => {
    expect(
      isFrameBomLine({
        id: "it_manual",
        materialId: "m036",
        name: "Труба профильная 20/20/1,5 мм",
        pipeCuts: [{ lengthMm: 3200, qty: 6 }],
      })
    ).toBe(false);
  });

  it("detects sourceLabel Из схемы каркаса", () => {
    expect(
      isFrameBomLine({
        id: "it_row",
        sourceLabel: "Из схемы каркаса",
      })
    ).toBe(true);
  });
});

describe("dedupeFrameBomProjectItems", () => {
  it("dedupes legacy + canonical rows for same rack/material", () => {
    const items = [
      legacyBomItem({ id: "old_bolt", materialId: "m073" }),
      canonicalBomItem({ materialId: "m073" }),
      { id: "manual_bolt", materialId: "m073", source: "manual", qty: 20 },
    ];
    const deduped = dedupeFrameBomProjectItems(items);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].source).toBe("frame_bom");
    expect(countDedupedFrameBomItems(items)).toBe(1);
  });

  it("does not dedupe manual rows without BOM markers", () => {
    const items = [
      { id: "manual1", materialId: "m073", source: "manual" },
      { id: "manual2", materialId: "m073", source: "manual" },
    ];
    expect(dedupeFrameBomProjectItems(items)).toHaveLength(0);
  });
});

describe("buildFrameBomRepairPlan / builder legacy ids", () => {
  const prodMaterials = [
    ...catalogMaterials,
    {
      id: "m073",
      name: "Болт М6×20",
      unit: "шт",
      basePrice: 0.5,
      supplier: "Лемана про",
      link: "https://example.com/bolt",
      photoUrl: "/photos/m073.jpg",
      category: "Каркас",
    },
    {
      id: "m003",
      name: "Краб X",
      unit: "шт",
      basePrice: 12,
      supplier: "Metallist",
      link: "https://example.com/crab",
      photoUrl: "/photos/m003.jpg",
      category: "Каркас",
    },
  ];

  const prodRackOpts = {
    projectId: "p_tvRZ7SOwL9",
    drawingId: "fd_drawing",
    moduleRackKey: "mod_protochka:st_mrdwu5kzthoor",
    stellageId: "st_mrdwu5kzthoor",
    rackLabel: "Стеллаж 1",
    materials: prodMaterials,
  };

  function builderLegacyLn(idSuffix, materialId, overrides = {}) {
    return {
      id: `st_mrdwu5kzthoor__ln_${idSuffix}`,
      materialId,
      name: "Legacy builder",
      qty: 312,
      price: 0,
      supplier: "",
      clientNote: "Из схемы стеллажа",
      ...overrides,
    };
  }

  function builderLegacyFbom(materialId, bomKey = "bolt_m6x20") {
    return {
      id: `st_mrdwu5kzthoor__it_fbom_x_mod_protochka:st_mrdwu5kzthoor_${bomKey}`,
      materialId,
      name: "Legacy prefixed fbom",
      qty: 28,
      price: 0,
      supplier: "",
      clientNote: "Из схемы стеллажа",
    };
  }

  it("detects builder-prefixed st_<rack>__ln_* ids", () => {
    const row = builderLegacyLn("abc", "m073");
    expect(isBuilderSyncedFrameBomLine(row)).toBe(true);
    expect(resolveBuilderPrefixedStellageId(row)).toBe("st_mrdwu5kzthoor");
  });

  it("detects builder-prefixed st_<rack>__it_fbom_* ids", () => {
    const row = builderLegacyFbom("m003", "crab_x");
    expect(isBuilderSyncedFrameBomLine(row)).toBe(true);
  });

  it("explicit repair removes builder legacy and keeps canonical row", () => {
    const existing = [
      builderLegacyLn("bolt1", "m073"),
      {
        id: "it_fbom_CVKWuQfs4UCv_mod_protochka:st_mrdwu5kzthoor_bolt_m6x20",
        materialId: "m073",
        qty: 312,
        price: 0.5,
        supplier: "Лемана про",
        clientNote: "Из схемы стеллажа",
        sourceKey: "frame_bom:fd:mod_protochka:st_mrdwu5kzthoor:bolt_m6x20",
        sourceObjectIds: { moduleRackKey: "mod_protochka:st_mrdwu5kzthoor", bomKey: "bolt_m6x20" },
      },
      { id: "manual_bolt", materialId: "m073", qty: 5, source: "manual" },
    ];
    const plan = buildFrameBomRepairPlan(existing, [boltDraft()], prodRackOpts);
    expect(plan.removeItemIds).toContain("st_mrdwu5kzthoor__ln_bolt1");
    expect(plan.cleanedItems.filter((i) => i.materialId === "m073" && i.source !== "manual")).toHaveLength(1);
    expect(plan.cleanedItems.some((i) => i.id === "manual_bolt")).toBe(true);
  });

  it("manual same material row is preserved", () => {
    const existing = [
      builderLegacyLn("x", "m073"),
      { id: "manual_bolt", materialId: "m073", qty: 20, source: "manual", note: "ручная" },
    ];
    const plan = buildFrameBomRepairPlan(existing, [boltDraft()], prodRackOpts);
    expect(plan.cleanedItems.some((i) => i.id === "manual_bolt")).toBe(true);
    expect(plan.removeItemIds).not.toContain("manual_bolt");
  });

  it("BOM of another rack is preserved", () => {
    const otherRackItem = canonicalBomItem({
      materialId: "m073",
      moduleRackKey: "mod_other:st_other",
      drawingId: "d2",
    });
    const existing = [
      builderLegacyLn("x", "m073"),
      otherRackItem,
    ];
    const plan = buildFrameBomRepairPlan(existing, [boltDraft()], prodRackOpts);
    expect(plan.cleanedItems.some((i) => i.id === otherRackItem.id)).toBe(true);
  });

  it("repeated repair is idempotent", () => {
    const dirty = [
      builderLegacyLn("a", "m073"),
      builderLegacyFbom("m003", "crab_x"),
      canonicalBomItem({ materialId: "m073", moduleRackKey: "mod_protochka:st_mrdwu5kzthoor" }),
    ];
    const first = buildFrameBomRepairPlan(dirty, [boltDraft(), crabGDraft({ qty: 28 })], prodRackOpts);
    const second = buildFrameBomRepairPlan(first.cleanedItems, [boltDraft(), crabGDraft({ qty: 28 })], prodRackOpts);
    expect(second.removeItemIds).toHaveLength(0);
    expect(second.cleanedItems.length).toBe(first.cleanedItems.length);
  });

  it("cleanedItems has no duplicate BOM material rows for same rack", () => {
    const existing = [
      builderLegacyLn("b1", "m073"),
      builderLegacyLn("b2", "m003"),
      canonicalBomItem({ materialId: "m073", moduleRackKey: "mod_protochka:st_mrdwu5kzthoor" }),
      canonicalBomItem({ materialId: "m003", bomKey: "crab_x", moduleRackKey: "mod_protochka:st_mrdwu5kzthoor" }),
    ];
    const plan = buildFrameBomRepairPlan(
      existing,
      [
        boltDraft(),
        { key: "crab_x", materialId: "m003", name: "Краб X", unit: "шт", qty: 28 },
      ],
      prodRackOpts,
    );
    const rackBom = plan.cleanedItems.filter(
      (i) => i.materialId === "m073" || i.materialId === "m003",
    );
    expect(rackBom.filter((i) => i.materialId === "m073")).toHaveLength(1);
    expect(rackBom.filter((i) => i.materialId === "m003")).toHaveLength(1);
  });
});

describe("legacy duct/channel dedupe repair", () => {
  const rackOpts = {
    moduleRackKey: "mod_protochka:st_mrdwu5kzthoor",
    stellageId: "st_mrdwu5kzthoor",
    rackLabel: "Стеллаж 1",
  };

  function ductLegacy(idSuffix, materialId = "m010", overrides = {}) {
    return {
      id: `st_mrdwu5kzthoor__ln_${idSuffix}`,
      materialId,
      module: "Стеллаж 1",
      qty: 4,
      price: 0,
      supplier: "",
      clientNote: "Из схемы стеллажа",
      ...overrides,
    };
  }

  function ductCanonical(materialId = "m010", bomKey = "duct_55x110") {
    return {
      id: `it_fbom_fd_mod_protochka:st_mrdwu5kzthoor_${bomKey}`,
      materialId,
      module: "Стеллаж 1",
      qty: 4,
      price: 890,
      supplier: "Лемана про",
      clientNote: "Из схемы стеллажа",
      source: "frame_bom",
      sourceObjectIds: {
        moduleRackKey: "mod_protochka:st_mrdwu5kzthoor",
        bomKey,
      },
    };
  }

  it("detects legacy duct duplicate rows for rack", () => {
    const items = [ductLegacy("duct"), ductCanonical()];
    expect(hasLegacyFrameBomRowsForRack(items, rackOpts)).toBe(true);
    expect(rackFrameBomScopeItems(items, rackOpts)).toHaveLength(2);
  });

  it("repair removes legacy duct duplicate m010", () => {
    const plan = buildLegacyFrameBomDedupePlan([ductLegacy("duct"), ductCanonical()], rackOpts);
    expect(plan.removeItemIds).toContain("st_mrdwu5kzthoor__ln_duct");
    expect(plan.cleanedItems.filter((i) => i.materialId === "m010")).toHaveLength(1);
    expect(plan.cleanedItems[0].price).toBe(890);
  });

  it("repair removes legacy elbow duplicate", () => {
    const plan = buildLegacyFrameBomDedupePlan(
      [ductLegacy("elbow", "m011"), ductCanonical("m011", "elbow_55x110")],
      rackOpts,
    );
    expect(plan.removeItemIds.some((id) => id.includes("elbow"))).toBe(true);
    expect(plan.cleanedItems.filter((i) => i.materialId === "m011")).toHaveLength(1);
  });

  it("repair removes legacy connector duplicate", () => {
    const plan = buildLegacyFrameBomDedupePlan(
      [ductLegacy("conn", "m012"), ductCanonical("m012", "duct_connector")],
      rackOpts,
    );
    expect(plan.removeItemIds.some((id) => id.includes("conn"))).toBe(true);
    expect(plan.cleanedItems.filter((i) => i.materialId === "m012")).toHaveLength(1);
  });

  it("repair keeps canonical priced row and manual row", () => {
    const manual = { id: "manual_duct", materialId: "m010", qty: 2, source: "manual" };
    const plan = buildLegacyFrameBomDedupePlan(
      [ductLegacy("duct"), ductCanonical(), manual],
      rackOpts,
    );
    expect(plan.cleanedItems.some((i) => i.id === "manual_duct")).toBe(true);
    expect(plan.cleanedItems.filter((i) => i.materialId === "m010" && i.source !== "manual")).toHaveLength(1);
  });

  it("repeated legacy dedupe repair is idempotent", () => {
    const first = buildLegacyFrameBomDedupePlan(
      [ductLegacy("duct"), ductCanonical()],
      rackOpts,
    );
    const second = buildLegacyFrameBomDedupePlan(first.cleanedItems, rackOpts);
    expect(second.removeItemIds).toHaveLength(0);
    expect(second.blocked).toBe(true);
  });
});

describe("buildResidualFrameBomTwinRepairPlan (project-wide A+B)", () => {
  function canonBolt() {
    return {
      id: "it_fbom_CVKWuQfs4UCv_mod_protochka:st_mrdwu5kzthoor_bolt_m6x20",
      materialId: "m073",
      name: "Болт М6×20",
      module: "Стеллаж 1",
      section: "Стеллаж 1",
      qty: 312,
      price: 0.5,
      supplier: "Лемана про",
      source: "frame_bom",
      sourceKey: "frame_bom:fd:mod_protochka:st_mrdwu5kzthoor:bolt_m6x20",
      sourceObjectIds: {
        moduleRackKey: "mod_protochka:st_mrdwu5kzthoor",
        bomKey: "bolt_m6x20",
      },
    };
  }

  it("removes exact prefixed st__it_fbom twin (pattern A)", () => {
    const canon = canonBolt();
    const twin = {
      id: `st_mrdwu5kzthoor__${canon.id}`,
      materialId: "m073",
      name: "Болт М6×20",
      module: "Стеллаж 1",
      section: "Стеллаж 1",
      qty: 312,
      price: 0.5,
      supplier: "Лемана про",
    };
    expect(isBuilderSyncedFrameBomLine(twin)).toBe(true);
    expect(isCanonicalFrameBomLine(canon)).toBe(true);
    const plan = buildResidualFrameBomTwinRepairPlan([twin, canon]);
    expect(plan.blocked).toBe(false);
    expect(plan.removeItemIds).toEqual([twin.id]);
    expect(plan.cleanedItems.map((i) => i.id)).toEqual([canon.id]);
  });

  it("removes catalog st__ln twin when canonical BOM exists (pattern B with lineage)", () => {
    const canon = canonBolt();
    const twin = {
      id: "st_mrdwu5kzthoor__ln_legacy_bolt",
      materialId: "m073",
      name: "Болт М6×20",
      module: "Стеллаж 1",
      section: "Стеллаж 1",
      qty: 228,
      price: 0.5,
      supplier: "Лемана про",
      clientNote: "Из схемы стеллажа",
    };
    const plan = buildResidualFrameBomTwinRepairPlan([twin, canon]);
    expect(plan.removeItemIds).toContain(twin.id);
    expect(plan.cleanedItems.some((i) => i.id === canon.id)).toBe(true);
  });

  it("preserves ordinary same-material st__ln without frame lineage (B2 safety)", () => {
    const canon = canonBolt();
    const ordinary = {
      id: "st_mrdwu5kzthoor__ln_extra_bolt_stock",
      materialId: "m073",
      name: "Болт М6×20 запас",
      module: "Стеллаж 1",
      section: "Стеллаж 1",
      qty: 50,
      price: 0.5,
      supplier: "Лемана про",
      clientComment: "отдельный запас",
    };
    const plan = buildResidualFrameBomTwinRepairPlan([ordinary, canon]);
    expect(plan.removeItemIds).not.toContain(ordinary.id);
    expect(plan.cleanedItems.some((i) => i.id === ordinary.id)).toBe(true);
    expect(plan.cleanedItems.some((i) => i.id === canon.id)).toBe(true);
    expect(plan.skippedAmbiguousGroups.some((g) => g.twinId === ordinary.id)).toBe(true);
  });

  it("does not remove PP farm-section rows with same materialId", () => {
    const a = {
      id: "ln_pp_a",
      materialId: "m110",
      name: "Труба ПП д25",
      section: "Полив/дренаж — подтопление, основное отделение",
      qty: 19,
    };
    const b = {
      id: "ln_pp_b",
      materialId: "m110",
      name: "Труба ПП д25",
      section: "Полив/дренаж — рассадное отделение подтопление",
      qty: 19,
    };
    const plan = buildResidualFrameBomTwinRepairPlan([a, b]);
    expect(plan.removeItemIds).toHaveLength(0);
    expect(plan.cleanedItems).toHaveLength(2);
  });

  it("preserves manual same-material row even with lineage twin present", () => {
    const canon = canonBolt();
    const twin = {
      id: "st_mrdwu5kzthoor__ln_legacy_bolt",
      materialId: "m073",
      section: "Стеллаж 1",
      qty: 10,
      clientNote: "Из схемы стеллажа",
    };
    const manual = { id: "manual_bolt", materialId: "m073", qty: 5, source: "manual" };
    const plan = buildResidualFrameBomTwinRepairPlan([twin, canon, manual]);
    expect(plan.removeItemIds).toContain(twin.id);
    expect(plan.removeItemIds).not.toContain("manual_bolt");
    expect(plan.cleanedItems.some((i) => i.id === "manual_bolt")).toBe(true);
  });

  it("preserves user fields on canonical after strip", () => {
    const canon = {
      ...canonBolt(),
      status: "ordered",
      actualPrice: 0.4,
      visibleToClient: false,
      clientComment: "keep me",
    };
    const twin = {
      id: "st_mrdwu5kzthoor__ln_legacy_bolt",
      materialId: "m073",
      section: "Стеллаж 1",
      qty: 10,
      clientNote: "Из схемы стеллажа",
    };
    const cleaned = stripResidualFrameBomTwins([twin, canon]);
    const kept = cleaned.find((i) => i.id === canon.id);
    expect(kept.status).toBe("ordered");
    expect(kept.actualPrice).toBe(0.4);
    expect(kept.visibleToClient).toBe(false);
    expect(kept.clientComment).toBe("keep me");
  });

  it("repeated residual repair is idempotent", () => {
    const dirty = [
      canonBolt(),
      {
        id: "st_mrdwu5kzthoor__ln_legacy_bolt",
        materialId: "m073",
        section: "Стеллаж 1",
        qty: 10,
        clientNote: "Из схемы стеллажа",
      },
    ];
    const first = buildResidualFrameBomTwinRepairPlan(dirty);
    const second = buildResidualFrameBomTwinRepairPlan(first.cleanedItems);
    expect(first.removeItemIds).toHaveLength(1);
    expect(second.removeItemIds).toHaveLength(0);
    expect(countResidualFrameBomTwins(first.cleanedItems)).toBe(0);
  });

  it("skips twin without canonical as ambiguous", () => {
    const twinOnly = {
      id: "st_mrdwu5kzthoor__ln_orphan",
      materialId: "m073",
      section: "Стеллаж 1",
      qty: 10,
    };
    const plan = buildResidualFrameBomTwinRepairPlan([twinOnly]);
    expect(plan.removeItemIds).toHaveLength(0);
    expect(plan.skippedAmbiguousGroups.length).toBe(1);
  });
});

describe("stripSameNameFrameBomBuilderTwins + label sync", () => {
  it("removes same-name st_*__ln_* twin when canonical it_fbom exists", () => {
    const items = [
      {
        id: "it_fbom_d1_mod:st_ms933oqimo2vp_bolt_m6x20",
        materialId: "m073",
        name: "Болт М6×20",
        module: "Стеллаж 2",
        section: "Стеллаж 2",
        source: "frame_bom",
        sourceKey: "frame_bom:d1:mod:st_ms933oqimo2vp:bolt_m6x20",
        qty: 136,
      },
      {
        // Exact legacy Builder twin; its procurement data moves to canonical.
        id: "st_ms933oqimo2vp__ln_old",
        materialId: "m073",
        name: "Болт М6×20",
        module: "Стеллаж 2",
        section: "Стеллаж 2",
        qty: 408,
        purchaseStatus: "bought",
        actualPrice: 1.25,
        clientComment: "уже закуплено",
      },
      {
        id: "st_ms933oqimo2vp__ln_manual",
        materialId: "m073",
        name: "Болт М6×20",
        module: "Стеллаж 2",
        section: "Стеллаж 2",
        source: "manual",
        qty: 7,
      },
      {
        id: "st_ms933oqimo2vp__ln_plumb",
        materialId: "m073",
        name: "Болт полив",
        module: "Стеллаж 2",
        section: "Стеллаж 2",
        qty: 12,
      },
      {
        id: "st_ms933oqimo2vp__ln_install",
        materialId: "m073",
        name: "Болт М6×20",
        itemRole: "installation",
        qty: 3,
      },
      {
        id: "st_other__ln_old",
        materialId: "m073",
        name: "Болт М6×20",
        qty: 5,
      },
    ];
    const cleaned = frameBomProjectItems.stripSameNameFrameBomBuilderTwins(items);
    expect(cleaned.map((i) => i.id)).not.toContain("st_ms933oqimo2vp__ln_old");
    expect(cleaned.map((i) => i.id)).toContain("st_ms933oqimo2vp__ln_manual");
    expect(cleaned.map((i) => i.id)).toContain("st_ms933oqimo2vp__ln_plumb");
    expect(cleaned.map((i) => i.id)).toContain("st_ms933oqimo2vp__ln_install");
    expect(cleaned.map((i) => i.id)).toContain("st_other__ln_old");
    const canonical = cleaned.find((i) => i.id.startsWith("it_fbom_"));
    expect(canonical).toMatchObject({
      status: "bought",
      purchaseStatus: "bought",
      actualPrice: 1.25,
      clientComment: "уже закуплено",
    });
  });

  it("syncs stale Стеллаж 1/2 labels to current stellage names", () => {
    const items = [
      {
        id: "it_fbom_d1_mod:st_a_bolt",
        materialId: "m073",
        name: "Болт",
        module: "Стеллаж 2",
        section: "Стеллаж 2",
        source: "frame_bom",
        sourceKey: "frame_bom:d1:mod:st_a:bolt",
        qty: 10,
      },
      {
        id: "st_a__ln_x",
        materialId: "m036",
        name: "Труба",
        module: "Стеллаж 2",
        section: "Стеллаж 2",
        qty: 5,
      },
    ];
    const synced = syncProjectItemStellageLabels(items, [
      { id: "st_a", name: "Основное отделение 35 см" },
    ]);
    expect(synced.every((i) => i.module === "Основное отделение 35 см")).toBe(true);
    expect(synced.every((i) => i.section === "Основное отделение 35 см")).toBe(true);
  });
});
