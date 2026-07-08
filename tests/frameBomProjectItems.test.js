import { describe, expect, it } from "vitest";
import {
  mergeFrameBomIntoProjectItems,
  isFrameBomItemForRack,
  buildFrameBomSourceRackPrefix,
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

function frameBomItem({ sourceKey, name = "BOM", materialId = "m036" }) {
  return {
    id: `old_${sourceKey}`,
    name,
    materialId,
    qty: 1,
    source: "frame_bom",
    sourceType: "frame_bom",
    sourceKey,
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
    const rack2Item = frameBomItem({ sourceKey: "frame_bom:d1:rack2:profile_tube_20x20" });
    const existing = [
      frameBomItem({ sourceKey: "frame_bom:d1:rack1:profile_tube_20x20" }),
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
});

describe("frameBom source helpers", () => {
  it("buildFrameBomSourceRackPrefix", () => {
    expect(buildFrameBomSourceRackPrefix({ drawingId: "d1", moduleRackKey: "rack1" }).prefix).toBe(
      "frame_bom:d1:rack1",
    );
  });

  it("isFrameBomItemForRack matches prefix and line keys", () => {
    const prefix = "frame_bom:d1:rack1";
    expect(isFrameBomItemForRack({ source: "frame_bom", sourceKey: `${prefix}:crab_g` }, prefix)).toBe(true);
    expect(isFrameBomItemForRack({ source: "frame_bom", sourceKey: "frame_bom:d1:rack2:crab_g" }, prefix)).toBe(
      false,
    );
    expect(isFrameBomItemForRack({ source: "manual", sourceKey: `${prefix}:crab_g` }, prefix)).toBe(false);
  });
});
