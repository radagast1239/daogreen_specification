import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { framePresets, defaultFrameParams } from "../src/frameConstructor/framePresets.js";
import { buildFramePurchaseDraftFromFrameConfig } from "../src/frameConstructor/frameBomPurchasePreviewData.js";
import {
  buildFrameBomProjectMerge,
  scaleFrameBomDraftForRackCount,
} from "../src/frameConstructor/frameBomAddToProject.js";
import {
  frameBomProjectItemToBuilderLine,
  mergeFrameBomQtyFromBuilderLines,
} from "../src/lib/projectBuilderHydrate.js";
import {
  stripSameNameFrameBomBuilderTwins,
} from "../shared/frameBomProjectItems.js";

const RACK_ID = "st_nursery";
const MODULE_ID = "mod_nursery";
const MODULE_RACK_KEY = `${MODULE_ID}:${RACK_ID}`;
const RACK_NAME = "Рассадное отделение подтопление";

const perRackDraft = [
  { key: "bolt_m6x20", materialId: "m073", name: "Болт М6×20", unit: "шт", qty: 340 },
  { key: "nut_m6", materialId: "m074", name: "Гайка М6", unit: "шт", qty: 34 },
  { key: "crab_g", materialId: "m072", name: "Краб-система Г-образная 20×20, 1.2 мм", unit: "шт", qty: 20 },
  { key: "crab_t", materialId: "m071", name: "Краб-система Т-образная 20×20, 1.2 мм", unit: "шт", qty: 33 },
  {
    key: "profile_tube_20x20",
    materialId: "m036",
    name: "Труба профильная 20/20/1,5 мм",
    unit: "м",
    qty: "10,815",
    pipeCuts: [
      { lengthMm: 2800, qty: 2 },
      { lengthMm: 1300, qty: 3 },
      { lengthMm: 1315, qty: 1 },
    ],
  },
  { key: "spring_washer_m6", materialId: "m075", name: "Шайба гроверная М6", unit: "шт", qty: 34 },
];

const materials = perRackDraft.map((line) => ({
  id: line.materialId,
  name: line.name,
  unit: line.unit,
  category: "Каркас",
  basePrice: 1,
}));

const expectedTotals = {
  m073: 6800,
  m074: 680,
  m072: 400,
  m071: 660,
  m036: 216.3,
  m075: 680,
};

function expectTotals(items) {
  for (const [materialId, qty] of Object.entries(expectedTotals)) {
    const rows = items.filter((item) => item.materialId === materialId && item.source === "frame_bom");
    expect(rows, materialId).toHaveLength(1);
    expect(rows[0].qty, materialId).toBe(qty);
  }
}

function mergeProject(items = []) {
  return buildFrameBomProjectMerge(
    {
      items,
      stellageConfigs: [{ id: RACK_ID, moduleId: MODULE_ID, name: RACK_NAME, count: 20 }],
    },
    perRackDraft,
    {
      projectId: "p_nursery",
      drawingId: "fd_nursery",
      moduleId: MODULE_ID,
      rackId: RACK_ID,
      moduleRackKey: MODULE_RACK_KEY,
      rackLabel: RACK_NAME,
    },
    materials,
  ).patch.items;
}

describe("nursery Frame BOM unit and duplicate regression", () => {
  it("keeps the confirmed count=1/count=20 quantities in their declared units", () => {
    const one = scaleFrameBomDraftForRackCount(perRackDraft, 1);
    expect(one.map((line) => line.qty)).toEqual([340, 34, 20, 33, 10.815, 34]);
    const twenty = scaleFrameBomDraftForRackCount(perRackDraft, 20);
    expect(twenty.map((line) => line.qty)).toEqual([6800, 680, 400, 660, 216.3, 680]);
  });

  it("survives add, JSON/API shape, hydrate, two saves and repeated refresh", () => {
    const added = mergeProject();
    expectTotals(added);

    const bolt = added.find((item) => item.materialId === "m073");
    const withLegacyRows = [
      ...added,
      {
        id: `${RACK_ID}__ln_old_bolt`,
        materialId: "m073",
        name: "  БОЛТ   М6×20 ",
        module: RACK_NAME,
        section: RACK_NAME,
        qty: 340000,
        purchaseStatus: "bought",
        actualPrice: 0.5,
        clientComment: "закуплено до refresh",
      },
      { id: `${RACK_ID}__ln_manual`, materialId: "m073", name: bolt.name, source: "manual", qty: 2 },
      { id: `${RACK_ID}__ln_install`, materialId: "m073", name: bolt.name, itemRole: "installation", qty: 3 },
      { id: "st_other__ln_bolt", materialId: "m073", name: bolt.name, qty: 4 },
    ];
    const deduped = stripSameNameFrameBomBuilderTwins(withLegacyRows);
    expect(deduped.some((item) => item.id === `${RACK_ID}__ln_old_bolt`)).toBe(false);
    expect(deduped.some((item) => item.id === `${RACK_ID}__ln_manual`)).toBe(true);
    expect(deduped.some((item) => item.id === `${RACK_ID}__ln_install`)).toBe(true);
    expect(deduped.some((item) => item.id === "st_other__ln_bolt")).toBe(true);
    expect(deduped.find((item) => item.id === bolt.id)).toMatchObject({
      status: "bought",
      actualPrice: 0.5,
      clientComment: "закуплено до refresh",
    });

    const apiReload = JSON.parse(JSON.stringify(deduped));
    const frameItems = apiReload.filter((item) => item.source === "frame_bom");
    const editorItems = frameItems.map((item) => frameBomProjectItemToBuilderLine(item, { stCount: 20 }));
    expect(editorItems.map((line) => line.qty)).toEqual([340, 34, 20, 33, 10.815, 34]);

    const savedOnce = mergeFrameBomQtyFromBuilderLines(apiReload, [{
      id: RACK_ID,
      moduleId: MODULE_ID,
      count: 20,
      items: editorItems,
    }]);
    const savedTwice = mergeFrameBomQtyFromBuilderLines(
      JSON.parse(JSON.stringify(savedOnce)),
      [{ id: RACK_ID, moduleId: MODULE_ID, count: 20, items: editorItems }],
    );
    expectTotals(savedTwice);
    expectTotals(mergeProject(savedTwice));
    expectTotals(mergeProject(mergeProject(savedTwice)));
  });

  it("keeps every supported rack type on the same mm-to-m purchase contract", () => {
    const configs = [
      ...framePresets.map((preset) => preset.params),
      ...["nft", "seedling", "flood", "strawberry", "custom"].map((rackType) => ({
        ...defaultFrameParams,
        rackType,
        channelsEnabled: rackType === "nft",
      })),
    ];
    for (const config of configs) {
      const draft = buildFramePurchaseDraftFromFrameConfig(config);
      const tube = draft.find((line) => line.materialId === "m036");
      expect(tube, config.rackType).toBeTruthy();
      const metresFromCuts = tube.pipeCuts.reduce(
        (sum, cut) => sum + cut.lengthMm * cut.qty,
        0,
      ) / 1000;
      expect(tube.qty, config.rackType).toBeCloseTo(metresFromCuts, 3);
      expect(Math.max(...draft.map((line) => Number(line.qty) || 0)), config.rackType).toBeLessThan(10000);
    }
  });
});

describe("nursery Frame BOM SQLite/API round-trip", () => {
  const tempDir = path.join(os.tmpdir(), `nursery-frame-bom-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  let db;
  let saveItems;
  let rowToItem;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    process.env.DATABASE_PATH = path.join(tempDir, "test.db");
    process.env.DB_PATH = process.env.DATABASE_PATH;
    process.env.UPLOAD_ROOT = path.join(tempDir, "uploads");
    process.env.NODE_ENV = "test";
    vi.resetModules();
    const dbModule = await import("../backend/src/db.js");
    const projectsModule = await import("../backend/src/routes/projects.js");
    db = dbModule.db;
    rowToItem = dbModule.rowToItem;
    saveItems = projectsModule.saveItems;
    dbModule.initDb();
    db.prepare("INSERT INTO projects (id, name, client_token) VALUES (?, ?, ?)")
      .run("p_nursery", "Nursery BOM", "token-nursery");
    const insertMaterial = db.prepare(`
      INSERT INTO materials (id, name, unit, category, base_price, module)
      VALUES (?, ?, ?, 'Каркас', 1, 'test')
    `);
    for (const material of materials) {
      insertMaterial.run(material.id, material.name, material.unit);
    }
  });

  afterAll(() => {
    try { db?.close(); } catch { /* ignore */ }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("stores and reloads totals twice without ×1000 or a second ×20", () => {
    const first = mergeProject();
    saveItems("p_nursery", first);
    const reload = () => db.prepare("SELECT * FROM project_items WHERE project_id = ? ORDER BY sort_order")
      .all("p_nursery")
      .map(rowToItem);
    expectTotals(reload());
    saveItems("p_nursery", reload());
    expectTotals(reload());
    saveItems("p_nursery", mergeProject(reload()));
    expectTotals(reload());
  });
});
