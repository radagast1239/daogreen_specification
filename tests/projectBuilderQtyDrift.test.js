import { describe, expect, it } from "vitest";
import { buildProjectFromBuilder } from "../src/lib/projectBuilder.js";
import { mergeStellageBuilderLines, stellagesFromProject } from "../src/lib/projectBuilderHydrate.js";
import { FRAME_BOM_SOURCE } from "../shared/frameBomProjectItems.js";

const materials = [
  { id: "m1", name: "Труба", unit: "м", category: "Каркас", basePrice: 100, status: "active" },
];
const catalogs = {
  mod1: [{ id: "ln1", materialId: "m1", name: "Труба", unit: "м", qty: 1 }],
};

function rack(id, qty, count = 3, price = 100) {
  return {
    id,
    moduleId: "mod1",
    moduleName: "NFT",
    name: `Стеллаж ${id}`,
    count,
    items: [{ id: "ln1", materialId: "m1", name: "Труба", unit: "м", category: "Каркас", included: true, qty, price }],
  };
}

function save(stellages) {
  return buildProjectFromBuilder({
    form: { name: "P", client: "C", manualParams: {} },
    stellages,
    farmSections: [],
    materials,
    rooms: [],
  });
}

describe("PROJECT-BUILDER-QTY-DRIFT-001", () => {
  it("does not divide an already per-rack manual quantity when reopening the rack editor", () => {
    const merged = mergeStellageBuilderLines(rack("st1", 20), catalogs, materials);
    expect(merged.find((line) => line.materialId === "m1")?.qty).toBe(20);
  });

  it.each([1, 2, 3, 7, 14, 20, 0.5, 1.5, 6.5])("keeps %s stable through three save/reload/reopen cycles", (perRack) => {
    let stellages = [rack("st1", perRack)];
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const project = save(stellages);
      expect(project.items.find((item) => item.id === "st1__ln1")?.qty).toBeCloseTo(perRack * 3, 10);
      const reloaded = stellagesFromProject(project, { stellageCatalogs: catalogs, materials });
      expect(reloaded[0].items.find((line) => line.materialId === "m1")?.qty).toBeCloseTo(perRack, 10);
      const reopenedItems = mergeStellageBuilderLines(reloaded[0], catalogs, materials, project.items);
      expect(reopenedItems.find((line) => line.materialId === "m1")?.qty).toBeCloseTo(perRack, 10);
      stellages = [{ ...reloaded[0], items: reopenedItems }];
    }
    expect(save(stellages).items.find((item) => item.id === "st1__ln1")?.qty).toBeCloseTo(perRack * 3, 10);
  });

  it("keeps identical materialId quantities isolated between racks", () => {
    const project = save([rack("a", 20), rack("b", 7)]);
    expect(project.items.find((item) => item.id === "a__ln1")?.qty).toBe(60);
    expect(project.items.find((item) => item.id === "b__ln1")?.qty).toBe(21);
    const reloaded = stellagesFromProject(project, { stellageCatalogs: catalogs, materials });
    expect(reloaded.find((st) => st.id === "a").items.find((line) => line.materialId === "m1").qty).toBe(20);
    expect(reloaded.find((st) => st.id === "b").items.find((line) => line.materialId === "m1").qty).toBe(7);
  });

  it("does not divide Frame BOM quantities or mix them with manual rows", () => {
    const st = rack("st1", 20);
    const frame = {
      id: "fb1", materialId: "m1", name: "Труба", qty: 88.32,
      source: FRAME_BOM_SOURCE, sourceType: FRAME_BOM_SOURCE,
      sourceKey: "frame_bom:d1:mod1:st1:profile_tube_20x20",
      sourceObjectIds: { moduleRackKey: "mod1:st1" },
      includedInProject: true,
    };
    const reopened = mergeStellageBuilderLines(st, catalogs, materials, [frame]);
    const frameLine = reopened.find((line) => line.source === FRAME_BOM_SOURCE);
    expect(frameLine?.qty).toBe(88.32);
    expect(reopened.filter((line) => line.materialId === "m1")).toHaveLength(1);
  });
});
