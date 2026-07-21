/**
 * Edge-case regressions for builder reconcile ownership / ghosts / full save mode.
 * Temporary SQLite only.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { readFileSync } from "fs";
import { buildClientVisibilityPatch } from "../shared/itemTypes.js";
import { projectItemHasAdminActivity } from "../shared/projectItemOwnership.js";
import { mergeManualParamsForBuilderSave } from "../shared/reconcileBuilderProjectSave.js";

const testId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tempDir = path.join(os.tmpdir(), `daogreen-builder-edge-${testId}`);
const tempDbPath = path.join(tempDir, "daogreen-test.db");
const tempUploads = path.join(tempDir, "uploads");

let db;
let loadProject;
let loadProjectItems;
let updateProject;
let createProject;
let patchItem;

function rev(id) {
  return Number(db.prepare("SELECT revision FROM projects WHERE id = ?").get(id)?.revision) || 1;
}

function builderUpdate(id, patch) {
  return updateProject(id, {
    ...patch,
    builderSave: true,
    builderSaveMode: patch.builderSaveMode || "full",
    expectedRevision: rev(id),
  });
}

function seedMaterial(id, name = "Material") {
  db.prepare(`
    INSERT INTO materials (id, name, unit, category, base_price, module,
                           supplier, link, photo_url, client_section, client_subsection)
    VALUES (?, ?, 'шт.', 'Каркас и крепёж', 100, 'general',
            'Каталог', 'https://example.test/x', 'https://example.test/p.jpg', 'Каркас', 'Профиль')
  `).run(id, name);
}

function baseItem(id, overrides = {}) {
  return {
    id,
    materialId: "mat1",
    name: "Линия",
    unit: "шт.",
    module: "Стеллаж 1",
    section: "Стеллаж 1",
    category: "Каркас и крепёж",
    qty: 2,
    price: 100,
    itemType: "material",
    includedInProject: true,
    enabled: true,
    visibleToClient: true,
    approved: true,
    supplier: "Каталог",
    link: "https://example.test/x",
    clientSection: "Каркас",
    clientSubsection: "Профиль",
    status: "not_bought",
    actualPrice: null,
    clientComment: "",
    responsible: "general",
    ...overrides,
  };
}

describe("builder reconcile edge cases", () => {
  beforeAll(async () => {
    fs.mkdirSync(tempUploads, { recursive: true });
    process.env.DATABASE_PATH = tempDbPath;
    process.env.DB_PATH = tempDbPath;
    process.env.UPLOAD_ROOT = tempUploads;
    process.env.NODE_ENV = "test";
    process.env.ADMIN_KEY = "test-admin-key";

    const dbMod = await import("../backend/src/db.js");
    await dbMod.initDb();
    db = dbMod.db;
    loadProject = dbMod.loadProject;
    loadProjectItems = dbMod.loadProjectItems;

    const projects = await import("../backend/src/routes/projects.js");
    updateProject = projects.updateProject;
    createProject = projects.createProject;
    patchItem = projects.patchItem;
  });

  afterAll(() => {
    try {
      db?.close?.();
    } catch {
      /* ignore */
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    db.exec("DELETE FROM project_items; DELETE FROM spec_versions; DELETE FROM projects; DELETE FROM materials;");
    seedMaterial("mat1", "Труба");
    seedMaterial("mat2", "Болт");
  });

  it("mergeManualParams: builder keys win when present; absent keeps DB; publishedRelease always DB", () => {
    const dbParams = {
      publishedRelease: { version: 3 },
      projectSchemes: [{ id: "a", title: "Old" }],
      farmPower: { total: 1 },
      coolingFarm: { rooms: [] },
      orphanKeep: "stay",
    };
    const patch = {
      publishedRelease: { version: 99 },
      projectSchemes: [{ id: "a", title: "New" }],
      farmPower: { total: 9 },
      coolingFarm: { rooms: [{ id: "r1" }] },
      floorPlanTitle: "",
      builderWizard: { lastStep: "review" },
    };
    const merged = mergeManualParamsForBuilderSave(dbParams, patch);
    expect(merged.publishedRelease.version).toBe(3);
    expect(merged.projectSchemes[0].title).toBe("New");
    expect(merged.farmPower.total).toBe(9);
    expect(merged.coolingFarm.rooms[0].id).toBe("r1");
    expect(merged.floorPlanTitle).toBe("");
    expect(merged.orphanKeep).toBe("stay");
    expect(merged.builderWizard.lastStep).toBe("review");
  });

  it("1-9 full save: edit/add schemes farmPower coolingFarm; absent key preserved; release immutable", () => {
    const created = createProject({
      name: "P0",
      client: "C",
      status: "active",
      items: [baseItem("st_1__ln1")],
      stellageConfigs: [{ id: "st_1", name: "Стеллаж 1", count: 1 }],
      manualParams: {
        publishedRelease: { version: 5, frozenAt: "t0" },
        projectSchemes: [{ id: "sch1", title: "Old Scheme" }],
        farmPower: { installedKw: 1 },
        coolingFarm: { mode: "old" },
        keepMe: "db-only",
      },
    });

    builderUpdate(created.id, {
      name: "P0 renamed",
      items: [baseItem("st_1__ln1", { qty: 2 })],
      stellageConfigs: [{ id: "st_1", name: "Стеллаж 1", count: 2 }],
      rooms: [{ id: "r1", name: "Room A", area: 12 }],
      manualParams: {
        builderWizard: { lastStep: "review" },
        publishedRelease: { version: 1 },
        projectSchemes: [{ id: "sch1", title: "Edited Scheme", clientVisible: true }],
        farmPower: { installedKw: 42 },
        coolingFarm: { mode: "edited" },
        floorPlanTitle: "Plan X",
      },
      status: "active",
    });
    let p = loadProject(created.id);
    expect(p.name).toBe("P0 renamed");
    expect(p.stellageConfigs[0].count).toBe(2);
    expect(p.rooms[0].name).toBe("Room A");
    expect(p.manualParams.publishedRelease.version).toBe(5);
    expect(p.manualParams.projectSchemes[0].title).toBe("Edited Scheme");
    expect(p.manualParams.farmPower.installedKw).toBe(42);
    expect(p.manualParams.coolingFarm.mode).toBe("edited");
    expect(p.manualParams.floorPlanTitle).toBe("Plan X");
    expect(p.manualParams.keepMe).toBe("db-only");

    // First add when keys absent
    const created2 = createProject({
      name: "P1",
      client: "C",
      status: "active",
      items: [baseItem("st_1__ln1", { id: "st_2__ln1" })],
      stellageConfigs: [{ id: "st_2", name: "Стеллаж 1", count: 1 }],
      manualParams: { publishedRelease: { version: 1 } },
    });
    builderUpdate(created2.id, {
      name: "P1",
      items: [baseItem("st_2__ln1")],
      stellageConfigs: [{ id: "st_2", name: "Стеллаж 1", count: 1 }],
      manualParams: {
        projectSchemes: [{ id: "n1", title: "First" }],
        farmPower: { installedKw: 3 },
        coolingFarm: { mode: "new" },
      },
      status: "active",
    });
    p = loadProject(created2.id);
    expect(p.manualParams.projectSchemes[0].title).toBe("First");
    expect(p.manualParams.farmPower.installedKw).toBe(3);
    expect(p.manualParams.coolingFarm.mode).toBe("new");
    expect(p.manualParams.publishedRelease.version).toBe(1);

    // Key absent → preserve DB
    builderUpdate(created2.id, {
      name: "P1",
      items: [baseItem("st_2__ln1")],
      stellageConfigs: [{ id: "st_2", name: "Стеллаж 1", count: 1 }],
      manualParams: { builderWizard: { lastStep: "basics" } },
      status: "active",
    });
    p = loadProject(created2.id);
    expect(p.manualParams.projectSchemes[0].title).toBe("First");
    expect(p.manualParams.farmPower.installedKw).toBe(3);
    expect(p.manualParams.builderWizard.lastStep).toBe("basics");

    // Explicit empty clear
    builderUpdate(created2.id, {
      name: "P1",
      items: [baseItem("st_2__ln1")],
      stellageConfigs: [{ id: "st_2", name: "Стеллаж 1", count: 1 }],
      manualParams: {
        projectSchemes: [],
        floorPlanTitle: "",
        farmPower: p.manualParams.farmPower,
        coolingFarm: p.manualParams.coolingFarm,
      },
      status: "active",
    });
    p = loadProject(created2.id);
    expect(p.manualParams.projectSchemes).toEqual([]);
    expect(p.manualParams.floorPlanTitle).toBe("");
  });

  it("10-13 rename + rack/items/rooms/schemes/power all persist on full save", () => {
    const created = createProject({
      name: "Old",
      client: "C",
      status: "active",
      items: [baseItem("st_1__ln1", { qty: 2 }), baseItem("st_1__ln2", { id: "st_1__extra", materialId: "mat2", name: "Extra", qty: 1 })],
      stellageConfigs: [{ id: "st_1", name: "Стеллаж 1", count: 1 }],
      rooms: [{ id: "r0", name: "Old room", area: 5 }],
      manualParams: { publishedRelease: { version: 1 } },
    });
    patchItem(created.id, "st_1__ln1", { status: "bought", clientComment: "keep" });

    builderUpdate(created.id, {
      name: "New Name",
      items: [baseItem("st_1__ln1", { qty: 8 })], // composition changed: extra removed
      stellageConfigs: [{ id: "st_1", name: "Стеллаж 1", count: 4 }],
      rooms: [{ id: "r0", name: "New room", area: 20 }],
      manualParams: {
        projectSchemes: [{ id: "s", title: "Scheme" }],
        farmPower: { kw: 7 },
        coolingFarm: { btus: 1000 },
        publishedRelease: { version: 99 },
      },
      status: "active",
    });
    const p = loadProject(created.id);
    expect(p.name).toBe("New Name");
    expect(p.stellageConfigs[0].count).toBe(4);
    expect(p.rooms[0].name).toBe("New room");
    expect(p.rooms[0].area).toBe(20);
    expect(p.manualParams.projectSchemes[0].title).toBe("Scheme");
    expect(p.manualParams.farmPower.kw).toBe(7);
    expect(p.manualParams.coolingFarm.btus).toBe(1000);
    expect(p.manualParams.publishedRelease.version).toBe(1);
    const kept = p.items.find((i) => i.id === "st_1__ln1");
    expect(kept.status).toBe("bought");
    expect(kept.clientComment).toBe("keep");
    expect(kept.qty).toBe(8);
    expect(p.items.find((i) => i.id === "st_1__extra")).toBeFalsy();
  });

  it("14 UI source no longer contains detectBuilderSaveMode heuristic", () => {
    const src = readFileSync("src/pages/admin/ProjectBuilderPage.jsx", "utf8");
    expect(src).not.toContain("detectBuilderSaveMode");
    expect(src).toContain('builderSaveMode: "full"');
    expect(src).not.toMatch(/builderSaveMode:\s*"title"/);
  });

  it("15-17 visibility-only removed line deleted; purchased preserved; no duplicate", () => {
    expect(projectItemHasAdminActivity(baseItem("x", { ...buildClientVisibilityPatch(false) }))).toBe(false);
    expect(projectItemHasAdminActivity(baseItem("x", { status: "bought" }))).toBe(true);
    expect(projectItemHasAdminActivity(baseItem("x", { clientComment: "n" }))).toBe(true);

    const created = createProject({
      name: "P0",
      client: "C",
      status: "active",
      items: [
        baseItem("st_1__keep", { qty: 1 }),
        baseItem("st_1__hidden", { id: "st_1__hidden", materialId: "mat2", name: "Hidden only", qty: 1 }),
        baseItem("st_1__bought", { id: "st_1__bought", materialId: "mat2", name: "Bought", qty: 1 }),
      ],
      stellageConfigs: [{ id: "st_1", name: "Стеллаж 1", count: 1 }],
      manualParams: {},
    });
    patchItem(created.id, "st_1__hidden", { ...buildClientVisibilityPatch(false) });
    patchItem(created.id, "st_1__bought", { status: "bought", clientComment: "cfg", supplier: "SpecSupplier" });

    const payload = {
      name: "P0",
      items: [baseItem("st_1__keep", { qty: 1 })],
      stellageConfigs: [{ id: "st_1", name: "Стеллаж 1", count: 1 }],
      manualParams: {},
      status: "active",
    };
    builderUpdate(created.id, payload);
    let items = loadProjectItems(created.id);
    expect(items.map((i) => i.id)).not.toContain("st_1__hidden");
    expect(items.map((i) => i.id)).toContain("st_1__bought");
    expect(items.find((i) => i.id === "st_1__bought").status).toBe("bought");

    builderUpdate(created.id, payload);
    items = loadProjectItems(created.id);
    const boughtCopies = items.filter((i) => i.id === "st_1__bought");
    expect(boughtCopies).toHaveLength(1);
    expect(items.filter((i) => i.name === "Bought")).toHaveLength(1);
  });

  it("19 stale revision still 409", () => {
    const created = createProject({
      name: "P0",
      client: "C",
      status: "active",
      items: [baseItem("st_1__ln1")],
      stellageConfigs: [{ id: "st_1", name: "Стеллаж 1", count: 1 }],
      manualParams: { projectSchemes: [{ id: "s", title: "A" }] },
    });
    updateProject(created.id, { name: "P0", expectedRevision: rev(created.id) });
    expect(() =>
      updateProject(created.id, {
        name: "HACK",
        builderSave: true,
        builderSaveMode: "full",
        items: [baseItem("st_1__ln1")],
        expectedRevision: 1,
      }),
    ).toThrow(/изменён|revision|conflict|PROJECT_REVISION/i);
    expect(loadProject(created.id).name).toBe("P0");
  });
});
