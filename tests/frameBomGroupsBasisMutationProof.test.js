/**
 * Mutation proof for the Frame BOM rack-groups basis fix.
 *
 * Deliberately imports ONLY modules that exist both on production base 64f7b912
 * and on the fix, so the very same file can be run against either revision:
 *
 *   base 64f7b912 → FAILS, producing the confirmed production corruption
 *                   groups   = calculator × 2500 (bolt 340000, G 20000,
 *                              T 330000, tube 108150)
 *                   canonical = groups × 20      (bolt 6800000, G 400000,
 *                              T 6600000, tube 2163000)
 *   fixed HEAD    → PASSES, groups stay per-rack and only totals follow count.
 *
 * The purchase draft always comes from the real calculator.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { defaultFrameParams } from "../src/frameConstructor/framePresets.js";
import { buildFramePurchaseDraftFromFrameConfig } from "../src/frameConstructor/frameBomPurchasePreviewData.js";
import { buildFrameBomProjectMerge } from "../src/frameConstructor/frameBomAddToProject.js";
import {
  hydrateBuilderFromProject,
  mergeStellageBuilderLines,
  preserveFrameBomProjectItems,
  mergeFrameBomQtyFromBuilderLines,
  stellagesForProjectSave,
} from "../src/lib/projectBuilderHydrate.js";
import { buildProjectFromBuilder } from "../src/lib/projectBuilder.js";
import { buildProjectItemsAfterBuilderSave } from "../shared/buildProjectItemsAfterBuilderSave.js";
import {
  stripResidualFrameBomTwins,
  syncProjectItemStellageLabels,
} from "../shared/frameBomProjectItems.js";

const PROJECT_ID = "p_mutation_proof";
const RACK_ID = "st_msd31aux1l1eo";
const MODULE_ID = "mod_flood";
const MODULE_RACK_KEY = `${MODULE_ID}:${RACK_ID}`;
const RACK_NAME = "Подтопление";

const floodFrameConfig = {
  ...defaultFrameParams,
  name: RACK_NAME,
  rackType: "flood",
  channelsEnabled: false,
  showChannels: false,
  postCountX: 2,
  postCountY: 2,
  beamSpacingMode: "equal",
  trayEnabled: false,
  tierCount: 6,
  crossBeamsPerLevel: 3,
  lengthMm: 1340,
  depthMm: 700,
  tierSpacingMm: 400,
  bottomOffsetMm: 400,
};

const BOLT = "m073";
const CRAB_G = "m072";
const CRAB_T = "m071";
const TUBE = "m036";

const PER_RACK = { [BOLT]: 136, [CRAB_G]: 8, [CRAB_T]: 132, [TUBE]: 43.26 };
const TOTALS_20 = { [BOLT]: 2720, [CRAB_G]: 160, [CRAB_T]: 2640, [TUBE]: 865.2 };

const purchaseDraft = buildFramePurchaseDraftFromFrameConfig(floodFrameConfig);
const materials = purchaseDraft.map((line) => ({
  id: line.materialId,
  name: line.name,
  unit: line.unit,
  category: "Каркас",
  basePrice: 1,
  status: "active",
  modules: [RACK_NAME],
}));
const nameByMaterialId = new Map(materials.map((m) => [m.id, m.name]));

const drawingContext = {
  projectId: PROJECT_ID,
  drawingId: "fd_mutation_proof",
  moduleId: MODULE_ID,
  rackId: RACK_ID,
  moduleRackKey: MODULE_RACK_KEY,
  rackLabel: RACK_NAME,
};

function pick(map) {
  const out = {};
  for (const materialId of Object.keys(PER_RACK)) out[materialId] = map[materialId];
  return out;
}

describe("Frame BOM groups basis — mutation proof", () => {
  const tempDir = path.join(
    os.tmpdir(),
    `frame-bom-mutation-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
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
      .run(PROJECT_ID, "Mutation proof", "tok-mutation-proof");
    const insertMaterial = db.prepare(`
      INSERT INTO materials (id, name, unit, category, base_price, module, status)
      VALUES (?, ?, ?, 'Каркас', 1, ?, 'active')
    `);
    for (const m of materials) insertMaterial.run(m.id, m.name, m.unit, RACK_NAME);
  });

  afterAll(() => {
    try { db?.close(); } catch { /* ignore */ }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function save(project) {
    db.prepare("UPDATE projects SET stellage_configs = ? WHERE id = ?")
      .run(JSON.stringify(project.stellageConfigs || []), PROJECT_ID);
    saveItems(PROJECT_ID, project.items || []);
  }

  function load() {
    const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(PROJECT_ID);
    const items = db
      .prepare("SELECT * FROM project_items WHERE project_id = ? ORDER BY sort_order")
      .all(PROJECT_ID)
      .map(rowToItem);
    return {
      id: PROJECT_ID,
      name: "Mutation proof",
      client: "c",
      revision: Number(row.revision) || 0,
      stellageConfigs: JSON.parse(row.stellage_configs || "[]"),
      items,
      rooms: [],
      manualParams: {},
    };
  }

  function canonicalQtys(items) {
    const out = {};
    for (const it of items || []) {
      if ((it.source || it.sourceType) !== "frame_bom") continue;
      out[it.materialId] = it.qty;
    }
    return out;
  }

  function groupQtysByMaterial(cfg) {
    const byName = {};
    for (const g of cfg?.groups || []) byName[g.name] = g.qty;
    const out = {};
    for (const [materialId, name] of nameByMaterialId) {
      if (name in byName) out[materialId] = byName[name];
    }
    return out;
  }

  function builderSaveAndReload(project, { count = null } = {}) {
    const hydrated = hydrateBuilderFromProject(project, {
      sections: [],
      farmCatalogs: {},
      stellageCatalogs: {},
      materials,
    });
    // Admin "открыть стеллаж" — the step that corrupted production.
    let stellages = hydrated.stellages.map((st) => ({
      ...st,
      items: mergeStellageBuilderLines(st, {}, materials, project.items || []),
    }));
    if (count != null) stellages = stellages.map((st) => ({ ...st, count }));

    const stellageList = stellagesForProjectSave(stellages, null);
    const built = buildProjectFromBuilder({
      form: hydrated.form,
      stellages: stellageList,
      farmSections: [],
      materials,
      rooms: [],
      stellageModuleMeta: {},
      existingItems: project.items || [],
    });
    const activeStellageIds = new Set(stellageList.map((st) => st.id).filter(Boolean));
    const mergeResult = buildProjectItemsAfterBuilderSave({
      existingItems: project.items,
      generatedBuilderItems: built.items,
      builderContext: { farmSectionNames: new Set(), activeStellageIds },
      materials,
    });
    expect(mergeResult.blocked).toBeFalsy();
    built.items = preserveFrameBomProjectItems(mergeResult.items, project.items, {
      activeStellageIds,
    });
    built.items = stripResidualFrameBomTwins(built.items);
    built.items = syncProjectItemStellageLabels(built.items, stellageList);
    built.items = mergeFrameBomQtyFromBuilderLines(built.items, stellageList);
    save(built);
    return load();
  }

  it("keeps rack groups per-rack through two builder saves and a count 50 → 20 change", () => {
    let project = {
      id: PROJECT_ID,
      name: "Mutation proof",
      client: "c",
      stellageConfigs: [{
        id: RACK_ID,
        moduleId: MODULE_ID,
        moduleName: RACK_NAME,
        name: RACK_NAME,
        count: 50,
        params: {},
        groups: [],
      }],
      items: [],
      rooms: [],
      manualParams: {},
    };
    save(project);
    project = load();

    project = { ...project, items: buildFrameBomProjectMerge(project, purchaseDraft, drawingContext, materials).patch.items };
    save(project);
    project = load();
    expect(pick(canonicalQtys(project.items))).toEqual({
      [BOLT]: 6800, [CRAB_G]: 400, [CRAB_T]: 6600, [TUBE]: 2163,
    });

    // Base 64f7b912: groups 6800/400/6600/2163, canonical 340000/20000/330000/108150.
    project = builderSaveAndReload(project);
    expect(pick(groupQtysByMaterial(project.stellageConfigs[0]))).toEqual(PER_RACK);
    expect(pick(canonicalQtys(project.items))).toEqual({
      [BOLT]: 6800, [CRAB_G]: 400, [CRAB_T]: 6600, [TUBE]: 2163,
    });

    // Base 64f7b912: this save writes the confirmed corrupted groups (×2500) and
    // canonical = groups × 20.
    project = builderSaveAndReload(project, { count: 20 });
    expect(project.stellageConfigs[0].count).toBe(20);

    const groups = pick(groupQtysByMaterial(project.stellageConfigs[0]));
    const canonical = pick(canonicalQtys(project.items));

    expect(groups).toEqual(PER_RACK);
    expect(canonical).toEqual(TOTALS_20);

    // Confirmed production corruption must not be reachable.
    expect(groups).not.toEqual({
      [BOLT]: 340000, [CRAB_G]: 20000, [CRAB_T]: 330000, [TUBE]: 108150,
    });
    expect(canonical).not.toEqual({
      [BOLT]: 6800000, [CRAB_G]: 400000, [CRAB_T]: 6600000, [TUBE]: 2163000,
    });
  });
});
