import { describe, expect, it, beforeEach, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "daogreen-excel-responsible-"));
const tmpDb = path.join(tmpDir, "test.db");

let updateMaterial;
let createMaterial;
let getMaterial;
let bulkUpsertMaterials;
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
  bulkUpsertMaterials = matMod.bulkUpsertMaterials;
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

describe("bulkUpsertMaterials", () => {
  it("uses isolated temp database, not production file", () => {
    expect(getDbPath()).toBe(tmpDb);
    expect(getDbPath()).not.toMatch(/backend[\\/]data[\\/]daogreen\.db$/);
  });

  it("preserves responsible when importing excel", () => {
    const m = createMaterial({ name: "Test", defaultQty: 1, responsible: "climate" });
    expect(m.responsible).toBe("climate");

    const excelRow = {
      id: m.id,
      name: "Test Updated",
      unit: "шт.",
      basePrice: 100,
      defaultQty: 0,
      module: "Импорт",
      modules: ["Импорт"],
      category: "Прочее",
      subcategory: "",
      itemType: "material",
      supplier: "",
      link: "",
      linkAlt: "",
      photoUrl: "",
      imageUrl: "",
      vatRate: 0,
      vatIncluded: false,
      clientNote: "",
      techNote: "",
      internalNote: "",
      status: "active",
      needsApproval: false,
      isConsumable: false,
      isSparePart: false,
      clientVisibleDefault: true,
    };

    bulkUpsertMaterials([excelRow], "merge");

    const updated = getMaterial(m.id);
    expect(updated.responsible).toBe("climate");
  });
});
