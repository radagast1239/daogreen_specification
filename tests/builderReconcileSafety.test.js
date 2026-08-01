/**
 * T5 — safe Frame Builder reconciliation on project save.
 *
 * Contract: a row may only be auto-deleted when it is provably Builder-owned,
 * carries machine-readable rack lineage pointing at a removed rack, and has no
 * procurement activity. Names never authorise deletion. An empty/unknown rack
 * set is fail-closed.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { buildProjectItemsAfterBuilderSave } from "../shared/buildProjectItemsAfterBuilderSave.js";
import { reconcileBuilderItemsAgainstDb } from "../shared/reconcileBuilderProjectSave.js";
import {
  resolveItemRackLineage,
  projectItemHasProcurementActivity,
} from "../shared/projectItemOwnership.js";

const RACK_A = "st_aaa";
const RACK_B = "st_bbb";

/** Ordinary builder catalog line on a rack. */
const rackLine = (rack, ln, over = {}) => ({
  id: `${rack}__ln_${ln}`,
  materialId: over.materialId || "m073",
  name: over.name || "Болт М6×20",
  section: over.section || "Стеллаж",
  module: over.section || "Стеллаж",
  qty: over.qty ?? 10,
  status: "not_bought",
  ...over,
});

/** Canonical frame BOM row with lineage. */
const frameLine = (rack, key, over = {}) => ({
  id: `it_fbom_d1_mod:${rack}_${key}`,
  materialId: over.materialId || "m073",
  name: over.name || "Болт М6×20",
  section: "Стеллаж",
  module: "Стеллаж",
  source: "frame_bom",
  sourceType: "frame_bom",
  sourceKey: `frame_bom:d1:mod:${rack}:${key}`,
  sourceObjectIds: { moduleRackKey: `mod:${rack}`, stellageId: rack, bomKey: key },
  qty: over.qty ?? 136,
  status: "not_bought",
  ...over,
});

const run = (existing, generated, activeStellageIds) =>
  buildProjectItemsAfterBuilderSave({
    existingItems: existing,
    generatedBuilderItems: generated,
    builderContext: { farmSectionNames: new Set(), activeStellageIds },
  });

const ids = (res) => res.items.map((i) => i.id).sort();

describe("T5 — builder reconciliation safety", () => {
  it("A. a manual row with the same name and material survives a builder save", () => {
    const manual = {
      id: "it_manual_1",
      materialId: "m073",
      name: "Болт М6×20",
      section: "Стеллаж",
      source: "manual",
      qty: 3,
    };
    const builder = rackLine(RACK_A, "x");
    const res = run([manual, builder], [rackLine(RACK_A, "x", { qty: 20 })], new Set([RACK_A]));
    expect(res.blocked).toBe(false);
    expect(ids(res)).toContain("it_manual_1");
    expect(res.items.find((i) => i.id === "it_manual_1").qty).toBe(3);
    expect(res.items.find((i) => i.id === `${RACK_A}__ln_x`).qty).toBe(20);
  });

  it("B. same material on two racks: removing rack A leaves rack B untouched", () => {
    const a = rackLine(RACK_A, "x");
    const b = rackLine(RACK_B, "x");
    const res = run([a, b], [rackLine(RACK_B, "x")], new Set([RACK_B]));
    expect(res.blocked).toBe(false);
    expect(ids(res)).toEqual([`${RACK_B}__ln_x`]);
    expect(res.removedBuilderIds).toEqual([`${RACK_A}__ln_x`]);
  });

  it("C. a legacy frame_bom row without rack lineage is never auto-deleted", () => {
    const legacy = {
      id: "it_fbom_legacy_1",
      materialId: "m073",
      name: "Болт М6×20",
      section: "Стеллаж",
      source: "frame_bom",
      qty: 50,
    };
    expect(resolveItemRackLineage(legacy).known).toBe(false);
    const res = run([legacy], [], new Set([RACK_A]));
    expect(res.blocked).toBe(false);
    expect(ids(res)).toEqual(["it_fbom_legacy_1"]);
    expect(res.removedBuilderIds).toEqual([]);
  });

  it("D. a legacy no-lineage row keeps every persisted procurement field", () => {
    const legacy = {
      id: "it_fbom_legacy_2",
      materialId: "m073",
      name: "Болт М6×20",
      section: "Стеллаж",
      source: "frame_bom",
      qty: 50,
      status: "bought",
      actualPrice: 123.45,
      purchasePriority: "today",
      deliveryDays: 5,
      replacementPrice: 99,
      replacementComment: "аналог",
      replacementLink: "https://ex/r",
      replacementProposedAt: "2026-07-01",
      nameOverridden: true,
      needsApproval: true,
      purchaseKey: "pk1",
      clientComment: "клиент просил",
    };
    expect(projectItemHasProcurementActivity(legacy)).toBe(true);
    const res = run([legacy], [], new Set([RACK_A]));
    expect(res.blocked).toBe(false);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toEqual(legacy);
  });

  it("E. a builder-owned row with exact lineage of a removed rack is deleted", () => {
    const orphan = rackLine(RACK_A, "x");
    const frameOrphan = frameLine(RACK_A, "bolt");
    const res = run([orphan, frameOrphan], [], new Set([RACK_B]));
    expect(res.blocked).toBe(false);
    expect(res.items).toEqual([]);
    expect(res.removedBuilderIds.sort()).toEqual([orphan.id, frameOrphan.id].sort());
    expect(res.procurementBlockedIds).toEqual([]);
  });

  it("F. a procurement-active row of a removed rack is kept and reported, not dropped", () => {
    const orphan = rackLine(RACK_A, "x", { status: "ordered", actualPrice: 50 });
    const frameOrphan = frameLine(RACK_A, "bolt", { status: "bought" });
    const res = run([orphan, frameOrphan], [], new Set([RACK_B]));
    expect(res.blocked).toBe(false);
    expect(ids(res)).toEqual([orphan.id, frameOrphan.id].sort());
    expect(res.procurementBlockedIds.sort()).toEqual([orphan.id, frameOrphan.id].sort());
    expect(res.removedBuilderIds).toEqual([]);
    expect(res.items.find((i) => i.id === orphan.id).actualPrice).toBe(50);
    expect(res.items.find((i) => i.id === frameOrphan.id).status).toBe("bought");
  });

  it("G. empty / missing / malformed stellageConfigs never mass-delete", () => {
    const existing = [rackLine(RACK_A, "x"), frameLine(RACK_A, "bolt"), rackLine(RACK_B, "y")];
    for (const active of [new Set(), [], null, undefined, "", 0, {}, NaN]) {
      const res = run(existing, [], active);
      expect(res.blocked, `active=${String(active)}`).toBe(false);
      expect(ids(res), `active=${String(active)}`).toEqual(ids({ items: existing }));
      expect(res.removedBuilderIds, `active=${String(active)}`).toEqual([]);
    }
    // Same through the server-side entry point, including a missing field.
    for (const cfgs of [[], null, undefined, "not-an-array", [{ noId: 1 }]]) {
      const rec = reconcileBuilderItemsAgainstDb({
        dbItems: existing,
        incomingItems: [],
        stellageConfigs: cfgs,
      });
      expect(rec.blocked, `cfgs=${JSON.stringify(cfgs)}`).toBe(false);
      expect(rec.items.map((i) => i.id).sort(), `cfgs=${JSON.stringify(cfgs)}`)
        .toEqual(ids({ items: existing }));
      expect(rec.meta.removedBuilderIds).toEqual([]);
    }
  });

  it("H. no explicit remove-all-racks contract exists, so Save cannot emulate one", () => {
    // Documented limitation: with a non-empty config list, orphan rows for racks
    // absent from it are still cleaned (E). With an empty list nothing is cleaned.
    const existing = [rackLine(RACK_A, "x")];
    const emptied = run(existing, [], new Set());
    expect(emptied.removedBuilderIds).toEqual([]);
    const stillOneRack = run(existing, [], new Set([RACK_B]));
    expect(stillOneRack.removedBuilderIds).toEqual([`${RACK_A}__ln_x`]);
  });

  it("I. three identical saves are idempotent", () => {
    const manual = { id: "it_m", materialId: "m073", name: "Болт М6×20", source: "manual", qty: 3 };
    const legacy = { id: "it_fbom_legacy", materialId: "m073", name: "Болт М6×20", source: "frame_bom", qty: 9, status: "bought" };
    let items = [manual, legacy, rackLine(RACK_A, "x")];
    const generated = [rackLine(RACK_A, "x", { qty: 42 })];
    const snapshots = [];
    for (let i = 0; i < 3; i += 1) {
      const res = run(items, generated, new Set([RACK_A]));
      expect(res.blocked).toBe(false);
      items = res.items;
      snapshots.push(JSON.stringify(items.map((r) => [r.id, r.qty, r.status]).sort()));
    }
    expect(snapshots[0]).toBe(snapshots[1]);
    expect(snapshots[1]).toBe(snapshots[2]);
    expect(items.find((i) => i.id === "it_m").qty).toBe(3);
    expect(items.find((i) => i.id === "it_fbom_legacy").status).toBe("bought");
    expect(items.find((i) => i.id === `${RACK_A}__ln_x`).qty).toBe(42);
  });

  it("M. malformed lineage is not a deletion permit", () => {
    const broken = [
      { id: "it_fbom_b1", source: "frame_bom", materialId: "m1", name: "X", moduleRackKey: "   " },
      { id: "it_fbom_b2", source: "frame_bom", materialId: "m1", name: "X", sourceObjectIds: "{not json" },
      { id: "it_fbom_b3", source: "frame_bom", materialId: "m1", name: "X", sourceObjectIds: {} },
      { id: "it_fbom_b4", source: "frame_bom", materialId: "m1", name: "X", moduleRackKey: ":" },
    ];
    for (const row of broken) expect(resolveItemRackLineage(row).known, row.id).toBe(false);
    const res = run(broken, [], new Set([RACK_A]));
    expect(res.blocked).toBe(false);
    expect(res.items).toHaveLength(4);
    expect(res.removedBuilderIds).toEqual([]);
  });

  it("N. production-shape fixture: only the proven orphan without procurement work is removed", () => {
    // Mirrors the read-only production inventory: frame rows all carry lineage,
    // auto-populated purchase_key / notes are present on most rows, and only a
    // few rows have a real status.
    const farmRow = { id: "it_other", materialId: "m9", name: "Прочее", section: "Общая закупка на ферму", qty: 1 };
    const existing = [
      frameLine(RACK_A, "bolt", { purchaseKey: "pk1", clientNote: "Из схемы стеллажа" }),
      frameLine(RACK_B, "bolt", { purchaseKey: "pk2", clientNote: "Из схемы стеллажа" }),
      rackLine(RACK_A, "tube", { purchaseKey: "pk3" }),
      rackLine(RACK_B, "tube", { purchaseKey: "pk4", status: "bought" }),
      farmRow,
    ];
    // Rack B was deleted; the builder regenerates everything that still exists.
    const res = run(existing, [rackLine(RACK_A, "tube", { purchaseKey: "pk3" }), farmRow], new Set([RACK_A]));
    expect(res.blocked).toBe(false);
    // Auto-populated purchaseKey/notes must not protect the plain orphan…
    expect(res.removedBuilderIds).toEqual([frameLine(RACK_B, "bolt").id]);
    // …while the row with a real status is preserved and reported.
    expect(res.procurementBlockedIds).toEqual([`${RACK_B}__ln_tube`]);
    expect(ids(res)).toContain("it_other");
  });
});

describe("T5 — persistence and isolation", () => {
  const testId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tempDir = path.join(os.tmpdir(), `daogreen-t5-${testId}`);
  const tempDbPath = path.join(tempDir, "t5.db");
  let db;
  let saveItems;
  let updateProject;
  let loadProject;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    process.env.DATABASE_PATH = tempDbPath;
    process.env.DB_PATH = tempDbPath;
    process.env.UPLOAD_ROOT = path.join(tempDir, "uploads");
    process.env.NODE_ENV = "test";
    vi.resetModules();
    const dbMod = await import("../backend/src/db.js");
    const projectsMod = await import("../backend/src/routes/projects.js");
    db = dbMod.db;
    loadProject = dbMod.loadProject;
    saveItems = projectsMod.saveItems;
    updateProject = projectsMod.updateProject;
    const activityMod = await import("../backend/src/services/activityLog.js");
    activityMod.initActivityLog();
    dbMod.initDb();
  });

  beforeEach(() => {
    db.prepare("DELETE FROM project_items").run();
    db.prepare("DELETE FROM projects").run();
    db.prepare("DELETE FROM materials").run();
  });

  afterAll(() => {
    delete process.env.DATABASE_PATH;
    delete process.env.DB_PATH;
    delete process.env.UPLOAD_ROOT;
    vi.resetModules();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  function seedMaterials() {
    for (const [mid, name] of [["m073", "Болт М6×20"], ["m9", "Прочее"]]) {
      db.prepare(`
        INSERT OR IGNORE INTO materials (id, name, unit, category, base_price, module)
        VALUES (?, ?, 'шт.', 'Каркас', 10, 'general')
      `).run(mid, name);
    }
  }

  function seed(id, stellageConfigs, items) {
    seedMaterials();
    db.prepare(`
      INSERT INTO projects (id, name, client, city, client_token, status, manual_params, rooms, currency, vat, version, comment, stellage_configs, revision)
      VALUES (?, ?, '', '', ?, 'active', '{}', '[]', '₽', 1, 0, '', ?, 1)
    `).run(id, `P ${id}`, `tok-${id}`, JSON.stringify(stellageConfigs));
    saveItems(id, items);
  }

  it("J. survives a real SQLite round-trip and a following save", () => {
    const legacy = {
      id: "it_fbom_legacy",
      materialId: "m073",
      name: "Болт",
      section: "Стеллаж",
      module: "Стеллаж",
      source: "frame_bom",
      qty: 9,
      status: "bought",
      actualPrice: 12,
    };
    seed("p1", [{ id: RACK_A, name: "A" }], [legacy, rackLine(RACK_A, "x")]);

    // Reload from disk, then reconcile against what came back out of SQLite.
    const reloaded = loadProject("p1");
    expect(reloaded.items).toHaveLength(2);
    const stored = reloaded.items.find((i) => i.id === "it_fbom_legacy");
    expect(resolveItemRackLineage(stored).known).toBe(false);
    expect(projectItemHasProcurementActivity(stored)).toBe(true);

    const rec = reconcileBuilderItemsAgainstDb({
      dbItems: reloaded.items,
      incomingItems: [rackLine(RACK_A, "x", { qty: 33 })],
      stellageConfigs: reloaded.stellageConfigs,
    });
    expect(rec.blocked).toBe(false);
    expect(rec.items.map((i) => i.id).sort()).toEqual(["it_fbom_legacy", `${RACK_A}__ln_x`]);
    // Procurement state read back out of SQLite survives the reconcile untouched.
    const reconciledLegacy = rec.items.find((i) => i.id === "it_fbom_legacy");
    expect(reconciledLegacy.status).toBe("bought");
    expect(Number(reconciledLegacy.actualPrice)).toBe(12);
    expect(rec.items.find((i) => i.id === `${RACK_A}__ln_x`).qty).toBe(33);

    // Re-read again: a second reconcile over the same stored state is stable.
    const second = reconcileBuilderItemsAgainstDb({
      dbItems: loadProject("p1").items,
      incomingItems: [rackLine(RACK_A, "x", { qty: 33 })],
      stellageConfigs: loadProject("p1").stellageConfigs,
    });
    expect(second.items.map((i) => i.id).sort()).toEqual(["it_fbom_legacy", `${RACK_A}__ln_x`]);
    expect(second.meta.removedBuilderIds).toEqual([]);
  });

  it("K. a failure inside the save transaction leaves no partial write", () => {
    seed("p1", [{ id: RACK_A, name: "A" }], [rackLine(RACK_A, "x"), rackLine(RACK_A, "y")]);
    const before = loadProject("p1");
    const beforeIds = before.items.map((i) => i.id).sort();

    // Duplicate persistent ids inside one payload violate the project_items PK
    // partway through the insert loop.
    expect(() =>
      saveItems("p1", [rackLine(RACK_A, "dup"), rackLine(RACK_A, "dup", { qty: 2 })]),
    ).toThrow();

    const after = loadProject("p1");
    expect(after.items.map((i) => i.id).sort()).toEqual(beforeIds);
  });

  it("L. saving one project does not touch another project's rows", () => {
    // project_items.id is globally unique, so each project owns distinct ids.
    seed("p1", [{ id: RACK_A, name: "A" }], [rackLine(RACK_A, "p1x")]);
    seed("p2", [{ id: RACK_A, name: "A" }], [rackLine(RACK_A, "p2x"), rackLine(RACK_B, "p2y")]);
    const p1 = loadProject("p1");
    const rec = reconcileBuilderItemsAgainstDb({
      dbItems: p1.items,
      incomingItems: [rackLine(RACK_A, "p1x", { qty: 77 })],
      stellageConfigs: p1.stellageConfigs,
    });
    saveItems("p1", rec.items);

    expect(loadProject("p1").items.find((i) => i.id === `${RACK_A}__ln_p1x`).qty).toBe(77);
    const p2 = loadProject("p2");
    expect(p2.items.map((i) => i.id).sort()).toEqual([`${RACK_A}__ln_p2x`, `${RACK_B}__ln_p2y`]);
    expect(p2.items.every((i) => i.qty === 10)).toBe(true);
  });
});
