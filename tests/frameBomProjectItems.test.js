import { describe, expect, it } from "vitest";
import {
  mergeFrameBomIntoProjectItems,
  isFrameBomItemForRack,
  buildFrameBomSourceRackPrefix,
  frameBomItemsForModuleRack,
  enrichFrameBomDraftWithMaterials,
  findMissingFrameBomMaterials,
  formatFrameBomMissingMaterialsMessage,
  resolveFrameBomItemModuleRackKey,
  sourceKeyMatchesModuleRack,
} from "../shared/frameBomProjectItems.js";

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
  return {
    key: "profile_tube_20x20",
    materialId: "m036",
    name: "Труба профильная 20/20/1,5 мм",
    unit: "м",
    qty: 88.32,
    pipeCuts: TUBE_CUTS,
    techNote: "Резы профтрубы: 3200 мм × 6 шт",
    ...overrides,
  };
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
