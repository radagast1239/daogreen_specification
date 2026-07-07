import { describe, expect, it, beforeEach, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "daogreen-patch-responsible-"));
const tmpDb = path.join(tmpDir, "test.db");

let updateMaterial;
let createMaterial;
let getMaterial;
let db;
let initDb;
let getDbPath;

beforeAll(async () => {
  process.env.DATABASE_PATH = tmpDb;
  vi.resetModules();
  const dbMod = await import("../backend/src/db.js");
  const matMod = await import("../backend/src/routes/materials.js");
  db = dbMod.db;
  initDb = dbMod.initDb;
  getDbPath = dbMod.getDbPath;
  updateMaterial = matMod.updateMaterial;
  createMaterial = matMod.createMaterial;
  getMaterial = matMod.getMaterial;
  initDb();
});

beforeEach(() => {
  db.prepare("DELETE FROM materials").run();
});

afterAll(() => {
  delete process.env.DATABASE_PATH;
  vi.resetModules();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(tmpDb + suffix);
    } catch {
      /* ignore */
    }
  }
  try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("updateMaterial", () => {
  it("uses isolated temp database, not production file", () => {
    expect(getDbPath()).toBe(tmpDb);
    expect(getDbPath()).not.toMatch(/backend[\\/]data[\\/]daogreen\.db$/);
  });

  it("preserves responsible when not in patch (clientVisibleDefault)", () => {
    const m = createMaterial({ name: "Test", defaultQty: 1, responsible: "climate" });
    const updated = updateMaterial(m.id, { clientVisibleDefault: false });
    expect(updated.responsible).toBe("climate");
  });

  it("preserves responsible when not in patch (needsApproval)", () => {
    const m = createMaterial({ name: "Test", defaultQty: 1, responsible: "climate" });
    const updated = updateMaterial(m.id, { needsApproval: true });
    expect(updated.responsible).toBe("climate");
  });

  it("preserves responsible on partial patch from MaterialsQualityPage", () => {
    const m = createMaterial({ name: "Test", defaultQty: 1, responsible: "climate" });
    const updated = updateMaterial(m.id, { category: "Требует разбора", clientSection: "requires_review" });
    expect(updated.responsible).toBe("climate");
  });

  it("updates responsible when explicitly provided", () => {
    const m = createMaterial({ name: "Test", defaultQty: 1, responsible: "climate" });
    const updated = updateMaterial(m.id, { responsible: "plumber" });
    expect(updated.responsible).toBe("plumber");
  });

  it("sets to general when explicitly empty", () => {
    const m = createMaterial({ name: "Test", defaultQty: 1, responsible: "climate" });
    const updated = updateMaterial(m.id, { responsible: "" });
    expect(updated.responsible).toBe("general");
  });

  it("preserves unpatched fields when only responsible-related patch is sent", () => {
    const m = createMaterial({
      name: "Pump",
      defaultQty: 2,
      responsible: "plumber",
      category: "Полив и сантехника",
      supplier: "Ozon",
    });
    const updated = updateMaterial(m.id, { needsApproval: true });
    expect(updated.responsible).toBe("plumber");
    expect(updated.name).toBe("Pump");
    expect(updated.category).toBe("Полив и сантехника");
    expect(updated.supplier).toBe("Ozon");
    expect(updated.defaultQty).toBe(2);
  });
});
