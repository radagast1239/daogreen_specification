/**
 * T5 review follow-up — a refused deletion must reach the administrator.
 * Server exposes a structured warning; the builder page renders it.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildBuilderSaveWarnings,
  reconcileBuilderItemsAgainstDb,
  PROCUREMENT_ACTIVE_ITEMS_PRESERVED,
} from "../shared/reconcileBuilderProjectSave.js";
import { formatBuilderSaveWarning } from "../src/lib/builderSaveWarnings.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RACK_A = "st_aaa";
const RACK_B = "st_bbb";

const rackLine = (rack, ln, over = {}) => ({
  id: `${rack}__ln_${ln}`,
  materialId: "m073",
  name: over.name || "Болт М6×20",
  section: "Стеллаж",
  module: "Стеллаж",
  qty: over.qty ?? 10,
  status: "not_bought",
  ...over,
});

describe("structured builder-save warnings", () => {
  it("A. a refused deletion produces a structured warning with the right count", () => {
    const kept = rackLine(RACK_A, "x", { status: "bought" });
    const rec = reconcileBuilderItemsAgainstDb({
      dbItems: [kept, rackLine(RACK_B, "y")],
      incomingItems: [rackLine(RACK_B, "y")],
      stellageConfigs: [{ id: RACK_B }],
    });
    expect(rec.blocked).toBe(false);
    // The row survives the save.
    expect(rec.items.map((i) => i.id)).toContain(kept.id);
    expect(rec.meta.procurementBlockedIds).toEqual([kept.id]);

    const warnings = buildBuilderSaveWarnings(rec.meta);
    expect(warnings).toEqual([
      { code: PROCUREMENT_ACTIVE_ITEMS_PRESERVED, count: 1, itemIds: [kept.id] },
    ]);
  });

  it("B. an ordinary cleanup deletes and produces no warning", () => {
    const rec = reconcileBuilderItemsAgainstDb({
      dbItems: [rackLine(RACK_A, "x"), rackLine(RACK_B, "y")],
      incomingItems: [rackLine(RACK_B, "y")],
      stellageConfigs: [{ id: RACK_B }],
    });
    expect(rec.meta.removedBuilderIds).toEqual([`${RACK_A}__ln_x`]);
    expect(rec.meta.procurementBlockedIds).toEqual([]);
    expect(buildBuilderSaveWarnings(rec.meta)).toEqual([]);
  });

  it("C. the admin message states the count and never leaks item ids", () => {
    const saved = {
      items: [
        { id: "st_aaa__ln_x", name: "Труба профильная" },
        { id: "st_aaa__ln_y", name: "Болт М6×20" },
        { id: "st_aaa__ln_z", name: "Краб" },
      ],
      builderSaveMeta: {
        procurementBlockedIds: ["st_aaa__ln_x", "st_aaa__ln_y", "st_aaa__ln_z"],
        warnings: [{
          code: PROCUREMENT_ACTIVE_ITEMS_PRESERVED,
          count: 3,
          itemIds: ["st_aaa__ln_x", "st_aaa__ln_y", "st_aaa__ln_z"],
        }],
      },
    };
    const msg = formatBuilderSaveWarning(saved);
    expect(msg).toContain("Проект сохранён");
    expect(msg).toContain("3 позиции");
    expect(msg).toContain("закупочная активность");
    expect(msg).toContain("Труба профильная");
    expect(msg).toContain("и ещё 1");
    // No technical identifiers in user-facing text.
    expect(msg).not.toContain("st_aaa");
    expect(msg).not.toContain("__ln_");
  });

  it("C2. russian plural forms are correct", () => {
    const make = (count) => formatBuilderSaveWarning({
      items: [],
      builderSaveMeta: { warnings: [{ code: PROCUREMENT_ACTIVE_ITEMS_PRESERVED, count, itemIds: [] }] },
    });
    expect(make(1)).toContain("1 позиция не удалена");
    expect(make(2)).toContain("2 позиции не удалены");
    expect(make(5)).toContain("5 позиций не удалены");
    expect(make(11)).toContain("11 позиций не удалены");
    expect(make(21)).toContain("21 позиция не удалена");
  });

  it("D. a save without blocked rows renders nothing, so no stale notice repeats", () => {
    expect(formatBuilderSaveWarning({ items: [] })).toBe("");
    expect(formatBuilderSaveWarning({ items: [], builderSaveMeta: { warnings: [] } })).toBe("");
    expect(formatBuilderSaveWarning(null)).toBe("");
    expect(formatBuilderSaveWarning(undefined)).toBe("");
    expect(formatBuilderSaveWarning({
      builderSaveMeta: { warnings: [{ code: "SOMETHING_ELSE", count: 4 }] },
    })).toBe("");
  });

  it("F. repeating the same save reports the same single warning, never a growing list", () => {
    let items = [rackLine(RACK_A, "x", { status: "bought" }), rackLine(RACK_B, "y")];
    const seen = [];
    for (let i = 0; i < 3; i += 1) {
      const rec = reconcileBuilderItemsAgainstDb({
        dbItems: items,
        incomingItems: [rackLine(RACK_B, "y")],
        stellageConfigs: [{ id: RACK_B }],
      });
      items = rec.items;
      seen.push(buildBuilderSaveWarnings(rec.meta));
    }
    for (const w of seen) {
      expect(w).toHaveLength(1);
      expect(w[0].count).toBe(1);
    }
    // The protected row is still there and untouched after three saves.
    const kept = items.find((i) => i.id === `${RACK_A}__ln_x`);
    expect(kept.status).toBe("bought");
    expect(items.filter((i) => i.id === `${RACK_A}__ln_x`)).toHaveLength(1);
  });

  it("wiring: the builder page shows the warning through the toast provider", () => {
    const page = fs.readFileSync(path.join(ROOT, "src/pages/admin/ProjectBuilderPage.jsx"), "utf8");
    expect(page).toMatch(/formatBuilderSaveWarning/);
    expect(page).toMatch(/notifyBuilderSaveWarning\(updated\)/);
    expect(page).toMatch(/const \{ confirm, success, error, warning \} = useToast\(\)/);
    const toast = fs.readFileSync(path.join(ROOT, "src/components/Toast.jsx"), "utf8");
    expect(toast).toMatch(/warning/);
    expect(toast).toMatch(/type: "warn"/);
    const css = fs.readFileSync(path.join(ROOT, "src/styles/theme.css"), "utf8");
    expect(css).toMatch(/\.toast--warn/);
  });
});

describe("warning reaches the HTTP save result", () => {
  const testId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tempDir = path.join(os.tmpdir(), `daogreen-t5w-${testId}`);
  let db;
  let loadProject;
  let saveItems;
  let updateProject;

  beforeAll(async () => {
    fs.mkdirSync(tempDir, { recursive: true });
    process.env.DATABASE_PATH = path.join(tempDir, "t5w.db");
    process.env.DB_PATH = process.env.DATABASE_PATH;
    process.env.UPLOAD_ROOT = path.join(tempDir, "uploads");
    process.env.NODE_ENV = "test";
    vi.resetModules();
    const dbMod = await import("../backend/src/db.js");
    const projectsMod = await import("../backend/src/routes/projects.js");
    db = dbMod.db;
    loadProject = dbMod.loadProject;
    saveItems = projectsMod.saveItems;
    updateProject = projectsMod.updateProject;
    (await import("../backend/src/services/activityLog.js")).initActivityLog();
    dbMod.initDb();
  });

  beforeEach(() => {
    db.prepare("DELETE FROM project_items").run();
    db.prepare("DELETE FROM projects").run();
    db.prepare("DELETE FROM materials").run();
    db.prepare(`INSERT INTO materials (id, name, unit, category, base_price, module)
                VALUES ('m073','Болт М6×20','шт.','Каркас',10,'general')`).run();
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

  function seed(configs, items) {
    db.prepare(`
      INSERT INTO projects (id, name, client, city, client_token, status, manual_params, rooms, currency, vat, version, comment, stellage_configs, revision)
      VALUES ('p1','P','','','tok-p1','active','{}','[]','₽',1,0,'',?,1)
    `).run(JSON.stringify(configs));
    saveItems("p1", items);
  }

  it("A2. updateProject returns builderSaveMeta with the warning after commit", () => {
    seed([{ id: RACK_A }, { id: RACK_B }], [
      rackLine(RACK_A, "x", { status: "bought" }),
      rackLine(RACK_B, "y"),
    ]);
    const before = loadProject("p1");
    const saved = updateProject("p1", {
      expectedRevision: before.revision,
      builderSave: true,
      builderSaveMode: "full",
      // Rack A was deleted; its row carries procurement work.
      stellageConfigs: [{ id: RACK_B }],
      items: [rackLine(RACK_B, "y")],
    });
    expect(saved.builderSaveMeta.warnings).toEqual([
      { code: PROCUREMENT_ACTIVE_ITEMS_PRESERVED, count: 1, itemIds: [`${RACK_A}__ln_x`] },
    ]);
    expect(formatBuilderSaveWarning(saved)).toContain("1 позиция не удалена");
    // The row really is still persisted with its procurement state.
    const kept = loadProject("p1").items.find((i) => i.id === `${RACK_A}__ln_x`);
    expect(kept.status).toBe("bought");
  });

  it("B2. a clean save exposes no builderSaveMeta at all (backward compatible)", () => {
    seed([{ id: RACK_A }, { id: RACK_B }], [rackLine(RACK_A, "x"), rackLine(RACK_B, "y")]);
    const before = loadProject("p1");
    const saved = updateProject("p1", {
      expectedRevision: before.revision,
      builderSave: true,
      builderSaveMode: "full",
      stellageConfigs: [{ id: RACK_B }],
      items: [rackLine(RACK_B, "y")],
    });
    expect(saved.builderSaveMeta).toBeUndefined();
    expect(formatBuilderSaveWarning(saved)).toBe("");
    expect(loadProject("p1").items.map((i) => i.id)).toEqual([`${RACK_B}__ln_y`]);
  });

  it("E. a rejected save reports no success warning and keeps the row", () => {
    seed([{ id: RACK_A }, { id: RACK_B }], [
      rackLine(RACK_A, "x", { status: "bought" }),
      rackLine(RACK_B, "y"),
    ]);
    const before = loadProject("p1");
    // Stale revision → the whole transaction is refused.
    expect(() =>
      updateProject("p1", {
        expectedRevision: before.revision + 5,
        builderSave: true,
        builderSaveMode: "full",
        stellageConfigs: [{ id: RACK_B }],
        items: [rackLine(RACK_B, "y")],
      }),
    ).toThrow();

    const after = loadProject("p1");
    expect(after.revision).toBe(before.revision);
    expect(after.items.map((i) => i.id).sort()).toEqual([`${RACK_A}__ln_x`, `${RACK_B}__ln_y`]);
    expect(after.items.find((i) => i.id === `${RACK_A}__ln_x`).status).toBe("bought");
    // Nothing to render: there is no saved result object at all.
    expect(formatBuilderSaveWarning(after)).toBe("");
  });
});
