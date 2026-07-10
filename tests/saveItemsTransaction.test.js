import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { validateProjectItemsForSave, validateSingleProjectItem } from "../backend/src/services/projectItemValidation.js";

const testId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tempDir = path.join(os.tmpdir(), `daogreen-saveitems-${testId}`);
const tempDbPath = path.join(tempDir, "daogreen-test.db");

let db;
let initDb;
let saveItems;
let loadProjectItems;
let patchItem;

function seedMaterial(id = "mat1") {
  db.prepare(`
    INSERT INTO materials (id, name, unit, category, base_price, module)
    VALUES (?, 'Material', 'шт.', 'Прочее', 100, 'general')
  `).run(id);
}

function item(id, materialId, overrides = {}) {
  return {
    id,
    materialId,
    name: "Line",
    unit: "шт.",
    module: "general",
    qty: 1,
    price: 10,
    itemType: "material",
    includedInProject: true,
    enabled: true,
    visibleToClient: true,
    approved: true,
    ...overrides,
  };
}

function seedProject(id = "p1") {
  db.prepare(`
    INSERT INTO projects (id, name, client_token)
    VALUES (?, 'Test', ?)
  `).run(id, `token-${id}`);
}

beforeAll(async () => {
  fs.mkdirSync(tempDir, { recursive: true });
  process.env.DATABASE_PATH = tempDbPath;
  process.env.DB_PATH = tempDbPath;
  process.env.NODE_ENV = "test";
  vi.resetModules();
  const dbMod = await import("../backend/src/db.js");
  const projectsMod = await import("../backend/src/routes/projects.js");
  db = dbMod.db;
  initDb = dbMod.initDb;
  loadProjectItems = dbMod.loadProjectItems;
  saveItems = projectsMod.saveItems;
  patchItem = projectsMod.patchItem;
  initDb();
});

beforeEach(() => {
  db.prepare("DELETE FROM project_items").run();
  db.prepare("DELETE FROM materials").run();
  db.prepare("DELETE FROM projects").run();
  seedMaterial("mat1");
  seedProject("p1");
});

afterAll(() => {
  delete process.env.DATABASE_PATH;
  delete process.env.DB_PATH;
  vi.resetModules();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(tempDbPath + suffix);
    } catch {
      /* ignore */
    }
  }
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* ignore */
    }
});

describe("saveItems transactional replace", () => {
  it("replaces all items on success", () => {
    saveItems("p1", [item("a", "mat1"), item("b", "mat1")]);
    saveItems("p1", [item("c", "mat1")]);
    const rows = loadProjectItems("p1");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("c");
  });

  it("rolls back on validation error — old items preserved", () => {
    saveItems("p1", [item("keep1", "mat1"), item("keep2", "mat1")]);
    expect(() =>
      saveItems(
        "p1",
        [item("new1", "mat1"), item("bad", null, { itemType: "material" })],
        { allowLegacyMissingMaterialId: false },
      ),
    ).toThrow();
    const rows = loadProjectItems("p1");
    expect(rows.map((r) => r.id).sort()).toEqual(["keep1", "keep2"]);
  });

  it("rejects material item without materialId on strict save", () => {
    expect(() =>
      validateProjectItemsForSave([item("x", null)], { allowLegacyMissingMaterialId: false }),
    ).toThrow(/materialId/);
  });

  it("rejects missing material reference", () => {
    expect(() =>
      validateSingleProjectItem(item("x", "missing-mat")),
    ).toThrow(/не найден/);
  });

  it("accepts internal_note without materialId", () => {
    expect(() =>
      validateSingleProjectItem({
        id: "note1",
        name: "Note",
        itemType: "internal_note",
        qty: 0,
        price: 0,
      }),
    ).not.toThrow();
  });

  it("allows legacy rows without materialId on bulk save by default", () => {
    expect(() =>
      validateProjectItemsForSave([item("legacy", null, { itemType: "material" })], {
        allowLegacyMissingMaterialId: true,
      }),
    ).not.toThrow();
  });

  it("legacy row readable; patchItem allowed without full items replace", () => {
    saveItems("p1", [item("legacy", null, { itemType: "material", name: "Legacy" })]);
    patchItem("p1", "legacy", { clientComment: "note" });
    const rows = loadProjectItems("p1");
    expect(rows).toHaveLength(1);
    expect(rows[0].clientComment).toBe("note");
  });

  it("full replacement with new material row without materialId rejected", () => {
    saveItems("p1", [item("keep1", "mat1")]);
    expect(() =>
      saveItems(
        "p1",
        [item("keep1", "mat1"), item("bad", null, { itemType: "material" })],
        { allowLegacyMissingMaterialId: false },
      ),
    ).toThrow();
    expect(loadProjectItems("p1")).toHaveLength(1);
  });

  it("legacy rows remain readable after bulk save with allowLegacy", () => {
    saveItems("p1", [item("legacy", null, { itemType: "material", name: "Legacy" })]);
    const rows = loadProjectItems("p1");
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Legacy");
  });
});
