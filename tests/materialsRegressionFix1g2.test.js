import { describe, expect, it, beforeEach, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { buildBulkPatchPayload } from "../shared/materialBulkActions.js";
import {
  filterMaterialsCatalog,
  materialInManualReview,
  matchCatalogQuickFilter,
} from "../src/lib/materialsCatalogView.js";
import { modulesTabPath, resolveModulesTabFromSearch } from "../src/lib/modulesTabUrl.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const materialsPage = fs.readFileSync(
  path.join(__dirname, "../src/pages/admin/MaterialsPage.jsx"),
  "utf8"
);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "daogreen-review-toggle-"));
const tmpDb = path.join(tmpDir, "test.db");

let updateMaterial;
let createMaterial;
let getMaterial;
let db;
let initDb;

beforeAll(async () => {
  process.env.DATABASE_PATH = tmpDb;
  vi.resetModules();
  const dbMod = await import("../backend/src/db.js");
  const matMod = await import("../backend/src/routes/materials.js");
  db = dbMod.db;
  initDb = dbMod.initDb;
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

describe("material editor module links 1g.2", () => {
  it("uses React Router Link + modulesTabPath for client sections", () => {
    expect(materialsPage).toContain('import { modulesTabPath } from "../../lib/modulesTabUrl.js"');
    expect(materialsPage).toContain('<Link to={modulesTabPath("publish")}>Настроить клиентские разделы</Link>');
    expect(materialsPage).not.toContain('href="/settings"');
    expect(materialsPage).not.toMatch(/href="\/spec\/spec/);
  });

  it("uses React Router Link + modulesTabPath for farm sections", () => {
    expect(materialsPage).toContain('<Link to={modulesTabPath("farm")}>Настроить разделы фермы</Link>');
    expect(materialsPage).not.toContain('href="/modules"');
  });

  it("modulesTabPath targets known Modules tabs for deep-link", () => {
    expect(modulesTabPath("publish")).toBe("/modules?tab=publish");
    expect(modulesTabPath("farm")).toBe("/modules?tab=farm");
    expect(resolveModulesTabFromSearch("?tab=publish")).toBe("publish");
    expect(resolveModulesTabFromSearch("?tab=farm")).toBe("farm");
  });
});

describe("review bulk actions 1g.2", () => {
  it("setReview sets manual review fields", () => {
    expect(buildBulkPatchPayload("setReview")).toEqual({
      category: "Требует разбора",
      clientSection: "requires_review",
    });
  });

  it("clearReview clears category and clientSection (false is not dropped)", () => {
    const payload = buildBulkPatchPayload("clearReview");
    expect(payload).toEqual({ category: "", clientSection: "" });
    expect("category" in payload).toBe(true);
    expect(payload.clientSection).toBe("");
  });

  it("needs_review filter matches manual flag only, not unrelated critical issues", () => {
    const criticalOnly = {
      id: "x",
      name: "Pump",
      category: "Полив",
      clientSection: "",
    };
    const entry = {
      material: criticalOnly,
      issues: [{ id: "no_supplier", severity: "critical" }],
    };
    expect(materialInManualReview(criticalOnly)).toBe(false);
    expect(matchCatalogQuickFilter(entry, criticalOnly, "needs_review")).toBe(false);
  });

  it("persists clearReview via API contract on temp SQLite", () => {
    const created = createMaterial({
      name: "Review me",
      category: "Лотки",
      clientSection: "",
      defaultQty: 1,
    });
    updateMaterial(created.id, buildBulkPatchPayload("setReview"));
    let stored = getMaterial(created.id);
    expect(stored.category).toBe("Требует разбора");
    expect(stored.clientSection).toBe("requires_review");
    expect(materialInManualReview(stored)).toBe(true);

    const entriesById = new Map([[stored.id, { material: stored, issues: [], row: stored }]]);
    expect(
      filterMaterialsCatalog([stored], { quick: "needs_review", entriesById }).map((m) => m.id)
    ).toEqual([stored.id]);

    updateMaterial(created.id, buildBulkPatchPayload("clearReview"));
    stored = getMaterial(created.id);
    expect(stored.clientSection).toBe("");
    expect(stored.category).toBe("Прочее");
    expect(materialInManualReview(stored)).toBe(false);
    expect(
      filterMaterialsCatalog([stored], { quick: "needs_review", entriesById: new Map([[stored.id, { material: stored, issues: [], row: stored }]]) }).length
    ).toBe(0);
  });
});
