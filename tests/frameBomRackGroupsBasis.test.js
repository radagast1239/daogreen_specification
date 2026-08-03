/**
 * Frame BOM rack groups basis regression.
 *
 * Confirmed production corruption (project p_1Sa3IEbCy4, rack st_msd31aux1l1eo
 * «Подтопление»): stellageConfigs.groups held calculator × 2500 and the canonical
 * frame_bom rows held calculator × 50000, because opening the rack editor loaded
 * canonical project TOTALS into the editor as if they were per-rack quantities and
 * the following Builder save multiplied by the rack count again.
 *
 * Everything below runs the real production functions — the purchase draft always
 * comes from buildFramePurchaseDraftFromFrameConfig, never from literal numbers.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { defaultFrameParams, framePresets } from "../src/frameConstructor/framePresets.js";
import { buildFramePurchaseDraftFromFrameConfig } from "../src/frameConstructor/frameBomPurchasePreviewData.js";
import {
  buildFrameBomProjectMerge,
  scaleFrameBomDraftForRackCount,
} from "../src/frameConstructor/frameBomAddToProject.js";
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
  stripSameNameFrameBomBuilderTwins,
  syncProjectItemStellageLabels,
} from "../shared/frameBomProjectItems.js";
import {
  FRAME_BOM_GROUP_QTY_BASIS_INVALID,
  checkFrameBomGroupQtyBasis,
} from "../shared/frameBomRackBasis.js";

const RACK_ID = "st_msd31aux1l1eo";
const MODULE_ID = "mod_flood";
const MODULE_RACK_KEY = `${MODULE_ID}:${RACK_ID}`;
const RACK_NAME = "Подтопление";
const PROJECT_ID = "p_1Sa3IEbCy4";

/** Sanitized production fixture — geometry only, no client data. */
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
const NUT = "m074";
const WASHER = "m075";
const CRAB_G = "m072";
const CRAB_T = "m071";
const TUBE = "m036";

/** Confirmed per-rack calculator output for the production rack. */
const PER_RACK = {
  [BOLT]: 136,
  [NUT]: 136,
  [WASHER]: 136,
  [CRAB_G]: 8,
  [CRAB_T]: 132,
  [TUBE]: 43.26,
};

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
  drawingId: "fd_flood",
  moduleId: MODULE_ID,
  rackId: RACK_ID,
  moduleRackKey: MODULE_RACK_KEY,
  rackLabel: RACK_NAME,
};

function totalsFor(count) {
  const out = {};
  for (const [materialId, qty] of Object.entries(PER_RACK)) {
    out[materialId] = Math.round(qty * count * 1000) / 1000;
  }
  return out;
}

function canonicalQtys(items) {
  const out = {};
  for (const it of items || []) {
    if ((it.source || it.sourceType) !== "frame_bom") continue;
    out[it.materialId] = it.qty;
  }
  return out;
}

function groupQtys(stellageConfig) {
  const out = {};
  for (const g of stellageConfig?.groups || []) out[g.name] = g.qty;
  return out;
}

function groupQtysByMaterial(stellageConfig) {
  const byName = groupQtys(stellageConfig);
  const out = {};
  for (const [materialId, name] of nameByMaterialId) {
    if (name in byName) out[materialId] = byName[name];
  }
  return out;
}

function frameEditorQtys(stellage) {
  const out = {};
  for (const ln of stellage?.items || []) {
    if ((ln.source || ln.sourceType) !== "frame_bom") continue;
    out[ln.materialId] = ln.qty;
  }
  return out;
}

function framePipeCuts(items) {
  const tube = (items || []).find(
    (it) => it.materialId === TUBE && (it.source || it.sourceType) === "frame_bom",
  );
  return tube?.pipeCuts || [];
}

describe("Frame BOM rack groups keep a per-rack basis", () => {
  it("rebuilds the confirmed production per-rack calculator output", () => {
    const byMaterial = {};
    for (const line of purchaseDraft) byMaterial[line.materialId] = line.qty;
    expect(byMaterial).toEqual(PER_RACK);
  });

  // ---------------------------------------------------------------- SQLite E2E
  describe("SQLite round-trip", () => {
    const tempDir = path.join(
      os.tmpdir(),
      `frame-bom-groups-${Date.now()}-${Math.random().toString(16).slice(2)}`,
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
      const activityMod = await import("../backend/src/services/activityLog.js");
      activityMod.initActivityLog();
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

    /** One isolated project row per scenario. */
    function makeProject(projectId, count, extraItems = []) {
      db.prepare("INSERT INTO projects (id, name, client_token) VALUES (?, ?, ?)")
        .run(projectId, "Frame BOM basis", `tok-${projectId}`);
      const project = {
        id: projectId,
        name: "Frame BOM basis",
        client: "c",
        stellageConfigs: [{
          id: RACK_ID,
          moduleId: MODULE_ID,
          moduleName: RACK_NAME,
          name: RACK_NAME,
          count,
          params: {},
          groups: [],
        }],
        items: extraItems,
        rooms: [],
        manualParams: {},
      };
      save(projectId, project);
      return load(projectId);
    }

    function save(projectId, project) {
      db.prepare("UPDATE projects SET stellage_configs = ? WHERE id = ?")
        .run(JSON.stringify(project.stellageConfigs || []), projectId);
      saveItems(projectId, project.items || []);
    }

    function load(projectId) {
      const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
      const items = db
        .prepare("SELECT * FROM project_items WHERE project_id = ? ORDER BY sort_order")
        .all(projectId)
        .map(rowToItem);
      return {
        id: projectId,
        name: "Frame BOM basis",
        client: "c",
        revision: Number(row.revision) || 0,
        stellageConfigs: JSON.parse(row.stellage_configs || "[]"),
        items,
        rooms: [],
        manualParams: {},
      };
    }

    /** project_items.id is globally unique — one drawing id per scenario. */
    function contextFor(project) {
      return { ...drawingContext, projectId: project.id, drawingId: `fd_${project.id}` };
    }

    function addBom(project) {
      return {
        ...project,
        items: buildFrameBomProjectMerge(
          project,
          purchaseDraft,
          contextFor(project),
          materials,
        ).patch.items,
      };
    }

    function openBuilder(project) {
      return hydrateBuilderFromProject(project, {
        sections: [],
        farmCatalogs: {},
        stellageCatalogs: {},
        materials,
      });
    }

    /** Reproduces admin "открыть стеллаж" — the step that corrupted production. */
    function openRackEditor(stellages, project) {
      return stellages.map((st) => ({
        ...st,
        items: mergeStellageBuilderLines(st, {}, materials, project.items || []),
      }));
    }

    /** Mirror of ProjectBuilderPage.buildProjectPayload for a saved project. */
    function builderSave(project, hydrated, stellages) {
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
      if (project.items?.length) {
        const activeStellageIds = new Set(stellageList.map((st) => st.id).filter(Boolean));
        const mergeResult = buildProjectItemsAfterBuilderSave({
          existingItems: project.items,
          generatedBuilderItems: built.items,
          builderContext: { farmSectionNames: new Set(), activeStellageIds },
          materials,
        });
        expect(mergeResult.blocked, mergeResult.invariantErrors?.join("; ")).toBeFalsy();
        built.items = preserveFrameBomProjectItems(mergeResult.items, project.items, {
          activeStellageIds,
        });
        built.items = stripResidualFrameBomTwins(built.items);
        built.items = stripSameNameFrameBomBuilderTwins(built.items);
        built.items = syncProjectItemStellageLabels(built.items, stellageList);
        built.items = mergeFrameBomQtyFromBuilderLines(built.items, stellageList);
      }
      const basis = checkFrameBomGroupQtyBasis({
        projectId: project.id,
        stellages: stellageList,
        builtStellageConfigs: built.stellageConfigs,
        builtItems: built.items,
        loadedItems: project.items || [],
      });
      return { built, basis };
    }

    /** open builder → open rack editor → save → reload. */
    function builderCycle(project, { count = null } = {}) {
      const hydrated = openBuilder(project);
      let stellages = openRackEditor(hydrated.stellages, project);
      if (count != null) stellages = stellages.map((st) => ({ ...st, count }));
      const { built, basis } = builderSave(project, hydrated, stellages);
      expect(basis.violations, JSON.stringify(basis.violations)).toEqual([]);
      save(project.id, built);
      return { project: load(project.id), hydrated, stellages };
    }

    // ------------------------------------------------------ exact reproduction
    it("exactly reproduces and then fixes the production count=50 → count=20 case", () => {
      let project = makeProject("p_repro_50_20", 50);
      project = addBom(project);
      save(project.id, project);
      project = load(project.id);

      // Frame BOM add stores the total for all racks (contract D).
      expect(canonicalQtys(project.items)).toEqual(totalsFor(50));

      // Old behaviour: opening the rack editor handed the editor the canonical
      // TOTAL. Fixed behaviour: the editor sees the per-rack quantity.
      const hydratedOnce = openBuilder(project);
      expect(frameEditorQtys(hydratedOnce.stellages[0])).toEqual(PER_RACK);
      const rackEditorOnce = openRackEditor(hydratedOnce.stellages, project);
      expect(frameEditorQtys(rackEditorOnce[0])).toEqual(PER_RACK);

      // Round 1 — this save produced groups=6800 / canonical=340000 on the base.
      ({ project } = builderCycle(project));
      expect(groupQtysByMaterial(project.stellageConfigs[0])).toEqual(PER_RACK);
      expect(canonicalQtys(project.items)).toEqual(totalsFor(50));

      // Round 2 — on the base this wrote the corrupted groups (calculator × 2500).
      ({ project } = builderCycle(project));
      expect(groupQtysByMaterial(project.stellageConfigs[0])).toEqual(PER_RACK);
      expect(canonicalQtys(project.items)).toEqual(totalsFor(50));

      // Round 3 with the in-session count change 50 → 20. On the base this is the
      // save that produced canonical = corrupted groups × 20.
      ({ project } = builderCycle(project, { count: 20 }));
      expect(project.stellageConfigs[0].count).toBe(20);

      // Corrupted production values that must NEVER appear again.
      const groups = groupQtysByMaterial(project.stellageConfigs[0]);
      const canonical = canonicalQtys(project.items);
      expect(groups).not.toMatchObject({
        [BOLT]: 340000, [CRAB_G]: 20000, [CRAB_T]: 330000, [TUBE]: 108150,
      });
      expect(canonical).not.toMatchObject({
        [BOLT]: 6800000, [CRAB_G]: 400000, [CRAB_T]: 6600000, [TUBE]: 2163000,
      });

      // Per-rack quantities are untouched by the count change.
      expect(groups).toEqual(PER_RACK);
      expect(groups[BOLT]).toBe(136);
      expect(groups[CRAB_G]).toBe(8);
      expect(groups[CRAB_T]).toBe(132);
      expect(groups[TUBE]).toBe(43.26);

      // Only project totals move.
      expect(canonical).toEqual(totalsFor(20));
      expect(canonical[BOLT]).toBe(2720);
      expect(canonical[CRAB_G]).toBe(160);
      expect(canonical[CRAB_T]).toBe(2640);
      expect(canonical[TUBE]).toBe(865.2);
    });

    it("keeps count=50 totals before the change", () => {
      let project = makeProject("p_count_50", 50);
      project = addBom(project);
      save(project.id, project);
      project = load(project.id);
      ({ project } = builderCycle(project));
      const canonical = canonicalQtys(project.items);
      expect(canonical[BOLT]).toBe(6800);
      expect(canonical[CRAB_G]).toBe(400);
      expect(canonical[CRAB_T]).toBe(6600);
      expect(canonical[TUBE]).toBe(2163);
      expect(groupQtysByMaterial(project.stellageConfigs[0])).toEqual(PER_RACK);
    });

    // ------------------------------------------------------- idempotency matrix
    for (const count of [1, 20, 50]) {
      it(`save → reload → save is idempotent at count=${count}`, () => {
        let project = makeProject(`p_idem_${count}`, count);
        project = addBom(project);
        save(project.id, project);
        project = load(project.id);

        const cutsAfterAdd = framePipeCuts(project.items);
        ({ project } = builderCycle(project));
        const groupsFirst = groupQtysByMaterial(project.stellageConfigs[0]);
        const canonicalFirst = canonicalQtys(project.items);
        const cutsFirst = framePipeCuts(project.items);

        ({ project } = builderCycle(project));
        ({ project } = builderCycle(project));

        expect(groupQtysByMaterial(project.stellageConfigs[0])).toEqual(groupsFirst);
        expect(canonicalQtys(project.items)).toEqual(canonicalFirst);
        expect(framePipeCuts(project.items)).toEqual(cutsFirst);
        expect(cutsFirst).toEqual(cutsAfterAdd);
        expect(groupsFirst).toEqual(PER_RACK);
        expect(canonicalFirst).toEqual(totalsFor(count));
      });
    }

    it("survives two reloads without a builder save in between", () => {
      let project = makeProject("p_two_reloads", 20);
      project = addBom(project);
      save(project.id, project);
      project = load(project.id);
      save(project.id, project);
      project = load(project.id);
      save(project.id, project);
      project = load(project.id);
      expect(canonicalQtys(project.items)).toEqual(totalsFor(20));
      expect(frameEditorQtys(openBuilder(project).stellages[0])).toEqual(PER_RACK);
    });

    it("does not grow pipeCuts across repeated Frame BOM refresh", () => {
      let project = makeProject("p_refresh_repeat", 20);
      project = addBom(project);
      save(project.id, project);
      project = load(project.id);
      const cuts = framePipeCuts(project.items);
      expect(cuts.length).toBeGreaterThan(0);

      for (let i = 0; i < 3; i += 1) {
        project = addBom(project);
        save(project.id, project);
        project = load(project.id);
        expect(framePipeCuts(project.items)).toEqual(cuts);
        expect(canonicalQtys(project.items)).toEqual(totalsFor(20));
      }
    });

    it("leaves ordinary, manual and different-purpose rows untouched", () => {
      const PID = "p_ordinary";
      const ordinary = [
        {
          id: `${RACK_ID}__ln_ordinary_${PID}`,
          materialId: BOLT,
          name: nameByMaterialId.get(BOLT),
          module: RACK_NAME,
          section: RACK_NAME,
          qty: 7,
          unit: "шт",
          includedInProject: true,
          enabled: true,
        },
        {
          id: `${RACK_ID}__ln_manual_${PID}`,
          materialId: BOLT,
          name: nameByMaterialId.get(BOLT),
          module: RACK_NAME,
          section: RACK_NAME,
          source: "manual",
          sourceType: "manual",
          qty: 3,
          unit: "шт",
          includedInProject: true,
          enabled: true,
        },
        {
          id: `${RACK_ID}__ln_install_${PID}`,
          materialId: BOLT,
          name: nameByMaterialId.get(BOLT),
          module: RACK_NAME,
          section: RACK_NAME,
          itemRole: "installation",
          qty: 5,
          unit: "шт",
          includedInProject: true,
          enabled: true,
        },
        {
          id: `st_other__ln_bolt_${PID}`,
          materialId: BOLT,
          name: nameByMaterialId.get(BOLT),
          module: "Другой стеллаж",
          section: "Другой стеллаж",
          qty: 4,
          unit: "шт",
          includedInProject: true,
          enabled: true,
        },
      ];
      let project = makeProject(PID, 20, ordinary);
      project = addBom(project);
      save(project.id, project);
      project = load(project.id);

      const before = new Map(
        project.items
          .filter((it) => (it.source || it.sourceType) !== "frame_bom")
          .map((it) => [it.id, it.qty]),
      );
      expect(before.get(`${RACK_ID}__ln_manual_${PID}`)).toBe(3);
      expect(before.get(`${RACK_ID}__ln_install_${PID}`)).toBe(5);
      expect(before.get(`st_other__ln_bolt_${PID}`)).toBe(4);

      ({ project } = builderCycle(project));
      for (const it of project.items) {
        if ((it.source || it.sourceType) === "frame_bom") continue;
        if (!before.has(it.id)) continue;
        expect(it.qty, it.id).toBe(before.get(it.id));
      }
      expect(canonicalQtys(project.items)).toEqual(totalsFor(20));
    });

    it("removes an exact twin through the backend refresh and blocks on several twins", async () => {
      const { refreshFrameBomProject } = await import("../backend/src/services/frameBomRefresh.js");
      const projectsModule = await import("../backend/src/routes/projects.js");

      let project = makeProject("p_twins", 20);
      project = addBom(project);
      save(project.id, project);
      project = load(project.id);

      const canonicalBolt = project.items.find(
        (it) => it.materialId === BOLT && (it.source || it.sourceType) === "frame_bom",
      );
      /** Legacy Builder twin: same rack + materialId + name, ordinary st_*__ln_* id. */
      const twin = (suffix) => ({
        id: `${RACK_ID}__ln_bolt${suffix}`,
        materialId: BOLT,
        name: canonicalBolt.name,
        module: RACK_NAME,
        section: RACK_NAME,
        unit: canonicalBolt.unit,
        qty: canonicalBolt.qty,
        includedInProject: true,
        enabled: true,
      });

      save(project.id, { ...project, items: [...project.items, twin("_a")] });
      project = load(project.id);
      expect(project.items.filter((it) => it.materialId === BOLT)).toHaveLength(2);

      const scaled = scaleFrameBomDraftForRackCount(purchaseDraft, 20);
      const body = {
        expectedRevision: Number(project.revision) || 0,
        moduleRackKey: MODULE_RACK_KEY,
        stellageId: RACK_ID,
        drawingId: "fd_flood",
        rackLabel: RACK_NAME,
        purchaseDraft: scaled,
        mode: "full",
      };
      refreshFrameBomProject(project.id, body, {
        saveItemsWithin: projectsModule.saveItemsWithin,
      });
      project = load(project.id);
      expect(project.items.filter((it) => it.materialId === BOLT)).toHaveLength(1);
      expect(canonicalQtys(project.items)).toEqual(totalsFor(20));

      // Several twins for one canonical row must block instead of guessing.
      save(project.id, { ...project, items: [...project.items, twin("_b"), twin("_c")] });
      project = load(project.id);
      const before = project.items.length;
      const beforeQtys = canonicalQtys(project.items);
      expect(() =>
        refreshFrameBomProject(project.id, {
          ...body,
          expectedRevision: Number(project.revision) || 0,
        }, { saveItemsWithin: projectsModule.saveItemsWithin }),
      ).toThrow(/дубл|BOM/i);
      const after = load(project.id);
      expect(after.items).toHaveLength(before);
      expect(canonicalQtys(after.items)).toEqual(beforeQtys);
      expect(after.revision).toBe(project.revision);
    });
  });

  // ---------------------------------------------------------- write invariant
  describe("write-path invariant", () => {
    function stellage(count, lines) {
      return [{
        id: RACK_ID,
        moduleId: MODULE_ID,
        moduleName: RACK_NAME,
        name: RACK_NAME,
        count,
        items: lines,
      }];
    }

    function frameLine(qty, extra = {}) {
      return {
        id: "ln_bolt",
        materialId: BOLT,
        name: nameByMaterialId.get(BOLT),
        moduleRackKey: MODULE_RACK_KEY,
        qty,
        included: true,
        source: "frame_bom",
        sourceType: "frame_bom",
        frameBomBasisResolved: true,
        frameBomRackCount: 50,
        frameBomPerRackQty: 136,
        frameBomSourceTotalQty: 6800,
        ...extra,
      };
    }

    const canonicalItem = (qty) => ({
      id: "it_fbom_bolt",
      materialId: BOLT,
      name: nameByMaterialId.get(BOLT),
      moduleRackKey: MODULE_RACK_KEY,
      source: "frame_bom",
      sourceType: "frame_bom",
      qty,
    });

    const configs = (count, qty) => [{
      id: RACK_ID,
      count,
      groups: [{ name: nameByMaterialId.get(BOLT), qty }],
    }];

    it("passes for a correct per-rack write", () => {
      const result = checkFrameBomGroupQtyBasis({
        projectId: PROJECT_ID,
        stellages: stellage(50, [frameLine(136)]),
        builtStellageConfigs: configs(50, 136),
        builtItems: [canonicalItem(6800)],
        loadedItems: [canonicalItem(6800)],
      });
      expect(result.ok).toBe(true);
    });

    it("blocks when groups.qty is the canonical total", () => {
      const result = checkFrameBomGroupQtyBasis({
        projectId: PROJECT_ID,
        stellages: stellage(50, [frameLine(6800)]),
        builtStellageConfigs: configs(50, 6800),
        builtItems: [canonicalItem(340000)],
        loadedItems: [canonicalItem(6800)],
      });
      expect(result.ok).toBe(false);
      expect(result.code).toBe(FRAME_BOM_GROUP_QTY_BASIS_INVALID);
      expect(result.violations[0]).toMatchObject({
        code: FRAME_BOM_GROUP_QTY_BASIS_INVALID,
        projectId: PROJECT_ID,
        rackId: RACK_ID,
        itemId: "it_fbom_bolt",
        materialId: BOLT,
        groupQty: 6800,
        editorPerRackQty: 6800,
        projectTotalQty: 340000,
        rackCount: 50,
        expectedTotal: 340000,
      });
    });

    it("blocks when groups.qty is not the editor per-rack quantity", () => {
      const result = checkFrameBomGroupQtyBasis({
        projectId: PROJECT_ID,
        stellages: stellage(50, [frameLine(136)]),
        builtStellageConfigs: configs(50, 6800),
        builtItems: [canonicalItem(6800)],
        loadedItems: [canonicalItem(6800)],
      });
      expect(result.ok).toBe(false);
      expect(result.violations[0].reason).toBe("GROUP_QTY_NOT_PER_RACK");
    });

    it("blocks when the canonical row is not per-rack × count", () => {
      const result = checkFrameBomGroupQtyBasis({
        projectId: PROJECT_ID,
        stellages: stellage(50, [frameLine(136)]),
        builtStellageConfigs: configs(50, 136),
        builtItems: [canonicalItem(136)],
        loadedItems: [canonicalItem(6800)],
      });
      expect(result.ok).toBe(false);
      expect(result.violations[0]).toMatchObject({
        reason: "PROJECT_QTY_NOT_TOTAL",
        projectTotalQty: 136,
        expectedTotal: 6800,
      });
    });

    it("fails closed when the per-rack basis was never proven", () => {
      const unproven = frameLine(136, {
        frameBomBasisResolved: false,
        frameBomRackCount: 1,
      });
      const result = checkFrameBomGroupQtyBasis({
        projectId: PROJECT_ID,
        stellages: stellage(50, [unproven]),
        builtStellageConfigs: configs(50, 136),
        builtItems: [canonicalItem(6800)],
        loadedItems: [canonicalItem(6800)],
      });
      expect(result.ok).toBe(false);
      expect(result.violations[0].reason).toBe("BASIS_UNPROVEN");
    });

    it("leaves count=1 racks alone", () => {
      const result = checkFrameBomGroupQtyBasis({
        projectId: PROJECT_ID,
        stellages: stellage(1, [frameLine(136, { frameBomRackCount: 1, frameBomSourceTotalQty: 136 })]),
        builtStellageConfigs: configs(1, 136),
        builtItems: [canonicalItem(136)],
        loadedItems: [canonicalItem(136)],
      });
      expect(result.ok).toBe(true);
    });

    it("never inspects ordinary or manual rack lines", () => {
      const ordinary = {
        id: "ln_ordinary",
        materialId: BOLT,
        name: nameByMaterialId.get(BOLT),
        qty: 6800,
        included: true,
      };
      const manual = {
        id: "ln_manual",
        materialId: BOLT,
        name: nameByMaterialId.get(BOLT),
        qty: 6800,
        included: true,
        source: "manual",
        sourceType: "manual",
      };
      const result = checkFrameBomGroupQtyBasis({
        projectId: PROJECT_ID,
        stellages: stellage(50, [ordinary, manual]),
        builtStellageConfigs: [{
          id: RACK_ID,
          count: 50,
          groups: [
            { name: ordinary.name, qty: 6800 },
            { name: manual.name, qty: 6800 },
          ],
        }],
        builtItems: [canonicalItem(6800)],
        loadedItems: [canonicalItem(6800)],
      });
      expect(result.ok).toBe(true);
    });
  });

  // ------------------------------------------------------------- rack coverage
  it("keeps the per-rack basis for every supported rack type", () => {
    const configs = [
      ...framePresets.map((preset) => ({ id: preset.id, params: preset.params })),
      ...["nft", "seedling", "flood", "strawberry", "custom"].map((rackType) => ({
        id: rackType,
        params: { ...defaultFrameParams, rackType, channelsEnabled: rackType === "nft" },
      })),
    ];
    for (const { id, params } of configs) {
      const draft = buildFramePurchaseDraftFromFrameConfig(params);
      expect(draft.length, id).toBeGreaterThan(0);
      const perRack = scaleFrameBomDraftForRackCount(draft, 1);
      const twenty = scaleFrameBomDraftForRackCount(draft, 20);
      for (let i = 0; i < perRack.length; i += 1) {
        expect(perRack[i].qty, `${id}:${perRack[i].key}`).toBe(
          Math.round(Number(draft[i].qty ?? 0) * 1000) / 1000
            || Number(perRack[i].qty),
        );
        expect(twenty[i].qty, `${id}:${twenty[i].key}`).toBeCloseTo(perRack[i].qty * 20, 3);
      }
    }
  });
});
