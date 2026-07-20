import { describe, expect, it, beforeEach, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildBulkPatchPayload,
  buildReviewPatchPayload,
  DEFAULT_MATERIAL_CATEGORY,
  LEGACY_REVIEW_CATEGORY,
  REVIEW_CLIENT_SECTION,
  resolveBulkPatchPayload,
} from "../shared/materialBulkActions.js";
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

function entryFor(material) {
  return { material, issues: [], row: material };
}

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

describe("review bulk actions 1g.2.1 — preserve category", () => {
  const normalCategories = ["Электрика и свет", "Инструмент и инвентарь", "Стеллажи и каркас"];

  it("setReview sends only clientSection (no category)", () => {
    expect(buildBulkPatchPayload("setReview")).toEqual({
      clientSection: REVIEW_CLIENT_SECTION,
    });
    expect("category" in buildBulkPatchPayload("setReview")).toBe(false);
  });

  it("clearReview generic payload clears only clientSection", () => {
    const payload = buildBulkPatchPayload("clearReview");
    expect(payload).toEqual({ clientSection: "" });
    expect("category" in payload).toBe(false);
  });

  for (const category of normalCategories) {
    it(`setReview/clearReview preserve category «${category}»`, () => {
      const material = { id: "m1", category, clientSection: "" };
      const setPayload = buildReviewPatchPayload(material, "setReview");
      expect(setPayload).toEqual({ clientSection: REVIEW_CLIENT_SECTION });
      expect("category" in setPayload).toBe(false);

      const inReview = { ...material, clientSection: REVIEW_CLIENT_SECTION };
      const clearPayload = buildReviewPatchPayload(inReview, "clearReview");
      expect(clearPayload).toEqual({ clientSection: "" });
      expect("category" in clearPayload).toBe(false);
    });
  }

  it("legacy materialInManualReview recognizes both markers", () => {
    expect(materialInManualReview({ category: "Электрика и свет", clientSection: REVIEW_CLIENT_SECTION })).toBe(true);
    expect(materialInManualReview({ category: LEGACY_REVIEW_CATEGORY, clientSection: "" })).toBe(true);
    expect(materialInManualReview({ category: LEGACY_REVIEW_CATEGORY, clientSection: REVIEW_CLIENT_SECTION })).toBe(
      true
    );
    expect(materialInManualReview({ category: "Полив", clientSection: "" })).toBe(false);
  });

  it("legacy clearReview normalizes category to fallback", () => {
    const legacy = { id: "leg", category: LEGACY_REVIEW_CATEGORY, clientSection: REVIEW_CLIENT_SECTION };
    const payload = buildReviewPatchPayload(legacy, "clearReview");
    expect(payload).toEqual({
      clientSection: "",
      category: DEFAULT_MATERIAL_CATEGORY,
    });
    expect(materialInManualReview(legacy)).toBe(true);
    const cleared = { ...legacy, category: DEFAULT_MATERIAL_CATEGORY, clientSection: "" };
    expect(materialInManualReview(cleared)).toBe(false);
  });

  it("mixed bulk resolveBulkPatchPayload builds per-material payloads", () => {
    const normal = { id: "n1", category: "Электрика и свет", clientSection: REVIEW_CLIENT_SECTION };
    const legacy = { id: "l1", category: LEGACY_REVIEW_CATEGORY, clientSection: REVIEW_CLIENT_SECTION };
    expect(resolveBulkPatchPayload("clearReview", null, null, normal)).toEqual({ clientSection: "" });
    expect(resolveBulkPatchPayload("clearReview", null, null, legacy)).toEqual({
      clientSection: "",
      category: DEFAULT_MATERIAL_CATEGORY,
    });
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

  it("temp SQLite: normal material preserves category through review toggle", () => {
    const created = createMaterial({
      name: "Cable",
      category: "Электрика и свет",
      clientSection: "",
      defaultQty: 1,
    });
    updateMaterial(created.id, buildReviewPatchPayload(created, "setReview"));
    let stored = getMaterial(created.id);
    expect(stored.category).toBe("Электрика и свет");
    expect(stored.clientSection).toBe(REVIEW_CLIENT_SECTION);
    expect(materialInManualReview(stored)).toBe(true);

    const entriesById = new Map([[stored.id, entryFor(stored)]]);
    expect(filterMaterialsCatalog([stored], { quick: "needs_review", entriesById }).map((m) => m.id)).toEqual([
      stored.id,
    ]);

    updateMaterial(created.id, buildReviewPatchPayload(stored, "clearReview"));
    stored = getMaterial(created.id);
    expect(stored.category).toBe("Электрика и свет");
    expect(stored.clientSection).toBe("");
    expect(materialInManualReview(stored)).toBe(false);
    expect(
      filterMaterialsCatalog([stored], {
        quick: "needs_review",
        entriesById: new Map([[stored.id, entryFor(stored)]]),
      }).length
    ).toBe(0);
  });

  it("temp SQLite: legacy material clearReview normalizes category", () => {
    const created = createMaterial({
      name: "Legacy item",
      category: LEGACY_REVIEW_CATEGORY,
      clientSection: REVIEW_CLIENT_SECTION,
      defaultQty: 1,
    });
    expect(materialInManualReview(getMaterial(created.id))).toBe(true);

    updateMaterial(created.id, buildReviewPatchPayload(created, "clearReview"));
    const stored = getMaterial(created.id);
    expect(stored.category).toBe(DEFAULT_MATERIAL_CATEGORY);
    expect(stored.clientSection).toBe("");
    expect(materialInManualReview(stored)).toBe(false);
    expect(
      filterMaterialsCatalog([stored], {
        quick: "needs_review",
        entriesById: new Map([[stored.id, entryFor(stored)]]),
      }).length
    ).toBe(0);
  });

  it("bulk mixed selection: per-id payloads preserve normal and normalize legacy", () => {
    const normal = createMaterial({
      name: "Normal",
      category: "Стеллажи и каркас",
      clientSection: REVIEW_CLIENT_SECTION,
      defaultQty: 1,
    });
    const legacy = createMaterial({
      name: "Legacy",
      category: LEGACY_REVIEW_CATEGORY,
      clientSection: REVIEW_CLIENT_SECTION,
      defaultQty: 1,
    });

    const normalPayload = resolveBulkPatchPayload("clearReview", null, null, normal);
    const legacyPayload = resolveBulkPatchPayload("clearReview", null, null, legacy);
    expect(normalPayload).toEqual({ clientSection: "" });
    expect(legacyPayload).toEqual({ clientSection: "", category: DEFAULT_MATERIAL_CATEGORY });

    updateMaterial(normal.id, normalPayload);
    updateMaterial(legacy.id, legacyPayload);

    const storedNormal = getMaterial(normal.id);
    const storedLegacy = getMaterial(legacy.id);
    expect(storedNormal.category).toBe("Стеллажи и каркас");
    expect(storedLegacy.category).toBe(DEFAULT_MATERIAL_CATEGORY);
    expect(materialInManualReview(storedNormal)).toBe(false);
    expect(materialInManualReview(storedLegacy)).toBe(false);
  });

  it("failed materialUpdate leaves stored material unchanged (API contract)", () => {
    const created = createMaterial({
      name: "Fail test",
      category: "Инструмент и инвентарь",
      clientSection: REVIEW_CLIENT_SECTION,
      defaultQty: 1,
    });
    const result = updateMaterial("missing-id", buildReviewPatchPayload(created, "clearReview"));
    expect(result).toBeNull();
    const stored = getMaterial(created.id);
    expect(stored.category).toBe("Инструмент и инвентарь");
    expect(stored.clientSection).toBe(REVIEW_CLIENT_SECTION);
    expect(materialInManualReview(stored)).toBe(true);
  });
});
