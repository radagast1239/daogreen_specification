import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { buildRefreshPatchForItem } from "../shared/refreshItemFromMaterial.js";
import {
  sanitizeBulkPatch,
  parseBulkPatchRequest,
  parseRefreshRequest,
  assertRefreshPatchSafe,
  BULK_PATCH_PROTECTED_KEYS,
} from "../backend/src/services/projectItems.js";

const testId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tempDir = path.join(os.tmpdir(), `daogreen-project-items-${testId}`);
const tempDbPath = path.join(tempDir, "daogreen-test.db");

let db;
let initDb;
let loadProject;
let addItem;
let patchItem;
let bulkPatchItems;
let refreshItemsFromMaterial;

const m034Material = {
  id: "m034",
  name: "Соединитель пластикового воздуховода 55×110 мм",
  unit: "шт",
  basePrice: 120,
  supplier: "ВентПро",
  link: "https://example.com/m034",
  clientSection: "trays_channels",
  clientSubsection: "NFT-каналы",
  clientVisibleDefault: false,
};

function seedProject(id = "proj1") {
  db.prepare(`
    INSERT INTO projects (id, name, client_token)
    VALUES (?, 'Test project', ?)
  `).run(id, `token-${id}`);
}

function insertMaterial(over = {}) {
  const m = { ...m034Material, ...over };
  db.prepare(`
    INSERT INTO materials (
      id, name, unit, base_price, module, category, supplier, link,
      client_section, client_subsection, client_visible_default, status
    ) VALUES (?, ?, ?, ?, 'general', 'Прочее', ?, ?, ?, ?, ?, 'active')
  `).run(
    m.id,
    m.name,
    m.unit,
    Number(m.basePrice) || 0,
    m.supplier || "",
    m.link || "",
    m.clientSection || "",
    m.clientSubsection || "",
    m.clientVisibleDefault === false ? 0 : 1
  );
  return m;
}

function insertItem(projectId, over = {}) {
  return addItem(projectId, {
    module: "NFT",
    section: "NFT",
    name: over.name || m034Material.name,
    unit: "шт",
    qty: 12,
    price: 85,
    materialId: over.materialId ?? "m034",
    includedInProject: true,
    visibleToClient: over.visibleToClient ?? false,
    visible: over.visible ?? false,
    approved: over.approved ?? false,
    itemType: "material",
    status: over.status || "not_bought",
    purchaseStatus: over.purchaseStatus || over.status || "not_bought",
    clientComment: over.clientComment || "",
    actualPrice: over.actualPrice ?? null,
    pipeCuts: over.pipeCuts || [],
    source: over.source || "",
    sourceKey: over.sourceKey || "",
    sourceType: over.sourceType || "",
    clientSection: "trays_channels",
    clientSubsection: "NFT-каналы",
    ...over,
  });
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
  loadProject = dbMod.loadProject;
  addItem = projectsMod.addItem;
  patchItem = projectsMod.patchItem;
  bulkPatchItems = projectsMod.bulkPatchItems;
  refreshItemsFromMaterial = projectsMod.refreshItemsFromMaterial;
  initDb();
});

beforeEach(() => {
  db.prepare("DELETE FROM project_items").run();
  db.prepare("DELETE FROM projects").run();
  db.prepare("DELETE FROM materials").run();
  seedProject();
  insertMaterial();
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

describe("projectItems service helpers", () => {
  it("parseBulkPatchRequest supports itemIds/patch and ids/updates aliases", () => {
    expect(parseBulkPatchRequest({ itemIds: ["a"], patch: { price: 1 } })).toEqual({
      itemIds: ["a"],
      patch: { price: 1 },
    });
    expect(parseBulkPatchRequest({ ids: ["b"], updates: { qty: 2 } })).toEqual({
      itemIds: ["b"],
      patch: { qty: 2 },
    });
  });

  it("sanitizeBulkPatch strips protected fields", () => {
    const patch = sanitizeBulkPatch({
      visibleToClient: true,
      materialId: "m034",
      sourceKey: "frame_bom:x",
      id: "hack",
      projectId: "p1",
    });
    expect(patch.visibleToClient).toBe(true);
    expect(patch.visible).toBe(true);
    expect(patch.approved).toBe(true);
    expect(patch.materialId).toBeUndefined();
    expect(patch.sourceKey).toBeUndefined();
    expect(patch.id).toBeUndefined();
    expect(patch.projectId).toBeUndefined();
    for (const key of BULK_PATCH_PROTECTED_KEYS) {
      expect(patch[key]).toBeUndefined();
    }
  });
});

describe("bulkPatchItems API", () => {
  it("sets visibleToClient=true for normal item", () => {
    const item = insertItem("proj1", { id: "it_norm", visibleToClient: false });
    const res = bulkPatchItems("proj1", {
      itemIds: [item.id],
      patch: { visibleToClient: true },
    });
    expect(res.ok).toBe(true);
    expect(res.updated).toHaveLength(1);
    expect(res.updated[0].visibleToClient).toBe(true);
    expect(res.updated[0].visible).toBe(true);
    expect(res.updated[0].approved).toBe(true);
  });

  it("sets visibleToClient=true for BOM item id with colon", () => {
    const bomId = "it_fbom_d1:rack1:air_duct_connector_55x110";
    const item = insertItem("proj1", {
      id: bomId,
      source: "frame_bom",
      sourceKey: "frame_bom:d1:rack1:air_duct_connector_55x110",
      visibleToClient: false,
    });
    const res = bulkPatchItems("proj1", {
      itemIds: [bomId],
      patch: { visibleToClient: true, visible: true, approved: true },
    });
    expect(res.updated).toHaveLength(1);
    expect(res.updated[0].id).toBe(bomId);
    expect(res.updated[0].visibleToClient).toBe(true);
    const reloaded = loadProject("proj1").items.find((i) => i.id === bomId);
    expect(reloaded.visibleToClient).toBe(true);
  });

  it("does not apply protected fields from bulk patch", () => {
    const item = insertItem("proj1", { id: "it_safe", materialId: "m034" });
    bulkPatchItems("proj1", {
      itemIds: [item.id],
      patch: { materialId: "m999", sourceKey: "hacked", name: "Hacked name" },
    });
    const reloaded = loadProject("proj1").items.find((i) => i.id === item.id);
    expect(reloaded.materialId).toBe("m034");
    expect(reloaded.sourceKey).toBe("");
    expect(reloaded.name).toBe(m034Material.name);
  });

  it("reports skipped ids when item not found", () => {
    const res = bulkPatchItems("proj1", {
      itemIds: ["missing:id"],
      patch: { visibleToClient: true },
    });
    expect(res.updated).toHaveLength(0);
    expect(res.skipped).toEqual([{ itemId: "missing:id", reason: "not_found" }]);
  });
});

describe("refreshItemsFromMaterial API", () => {
  it("updates price/link/supplier/clientSection from material", () => {
    insertMaterial({
      id: "m010",
      name: "Воздуховод",
      basePrice: 450,
      supplier: "НовыйПоставщик",
      link: "https://example.com/new",
      clientSection: "trays_channels",
      clientSubsection: "NFT-каналы",
    });
    const item = insertItem("proj1", {
      id: "it_refresh",
      materialId: "m010",
      price: 10,
      supplier: "",
      link: "",
      clientSection: "",
      clientSubsection: "",
    });
    const res = refreshItemsFromMaterial("proj1", {
      itemIds: [item.id],
      fields: ["price", "link", "supplier", "clientSection"],
    });
    expect(res.ok).toBe(true);
    expect(res.updated).toHaveLength(1);
    expect(res.updated[0].price).toBe(450);
    expect(res.updated[0].supplier).toBe("НовыйПоставщик");
    expect(res.updated[0].link).toBe("https://example.com/new");
    expect(res.updated[0].clientSection).toBe("trays_channels");
  });

  it("does not reset visibleToClient=true for m034 hidden-default material", () => {
    const item = insertItem("proj1", {
      id: "it_m034",
      visibleToClient: true,
      visible: true,
      approved: true,
    });
    const res = refreshItemsFromMaterial("proj1", {
      itemIds: [item.id],
      fields: ["price"],
    });
    expect(res.updated[0].visibleToClient).toBe(true);
    expect(res.updated[0].visible).toBe(true);
    expect(res.updated[0].approved).toBe(true);
    const reloaded = loadProject("proj1").items.find((i) => i.id === item.id);
    expect(reloaded.visibleToClient).toBe(true);
  });

  it("preserves purchaseStatus/clientComment/actualPrice/pipeCuts/sourceKey", () => {
    const pipeCuts = [{ lengthMm: 3200, qty: 6 }];
    const item = insertItem("proj1", {
      id: "it_keep",
      visibleToClient: true,
      status: "ordered",
      purchaseStatus: "ordered",
      clientComment: "keep me",
      actualPrice: 99,
      pipeCuts,
      sourceKey: "frame_bom:d1:rack1:tube",
      source: "frame_bom",
    });
    refreshItemsFromMaterial("proj1", { itemIds: [item.id], fields: ["price", "all"] });
    const reloaded = loadProject("proj1").items.find((i) => i.id === item.id);
    expect(reloaded.status).toBe("ordered");
    expect(reloaded.clientComment).toBe("keep me");
    expect(reloaded.actualPrice).toBe(99);
    expect(reloaded.pipeCuts).toEqual(pipeCuts);
    expect(reloaded.sourceKey).toBe("frame_bom:d1:rack1:tube");
    expect(reloaded.visibleToClient).toBe(true);
  });

  it("skips missing material gracefully", () => {
    const item = insertItem("proj1", { id: "it_missing_mat", materialId: "m999" });
    const res = refreshItemsFromMaterial("proj1", { itemIds: [item.id], fields: ["price"] });
    expect(res.updated).toHaveLength(0);
    expect(res.skipped).toEqual([{ itemId: item.id, reason: "material_missing" }]);
  });

  it("shared refresh patch does not include visibility fields", () => {
    const patch = buildRefreshPatchForItem(
      { id: "x", materialId: "m034", visibleToClient: true },
      m034Material,
      ["price", "clientSection"]
    );
    expect(() => assertRefreshPatchSafe(patch)).not.toThrow();
    expect(patch.visibleToClient).toBeUndefined();
  });
});

describe("single PATCH /api item route helper", () => {
  it("patchItem still works for encoded-style colon id", () => {
    const bomId = "it_fbom_scope:rack1:bolt_m6x20";
    const item = insertItem("proj1", { id: bomId, visibleToClient: false });
    const updated = patchItem("proj1", bomId, { visibleToClient: true, visible: true, approved: true });
    expect(updated.id).toBe(bomId);
    expect(updated.visibleToClient).toBe(true);
    const reloaded = loadProject("proj1").items.find((i) => i.id === item.id);
    expect(reloaded.visibleToClient).toBe(true);
  });
});

describe("parseRefreshRequest", () => {
  it("supports itemIds and ids aliases", () => {
    expect(parseRefreshRequest({ itemIds: ["a"], fields: ["price"] })).toEqual({
      itemIds: ["a"],
      fields: ["price"],
    });
    expect(parseRefreshRequest({ ids: ["b"] })).toEqual({ itemIds: ["b"], fields: [] });
  });
});
