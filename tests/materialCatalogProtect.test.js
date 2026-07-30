import { describe, expect, it, beforeEach, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import http from "http";

const require = createRequire(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../backend/package.json")
);
const express = require("express");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "daogreen-material-protect-"));
const tmpDb = path.join(tmpDir, "test.db");

let db;
let initDb;
let createMaterial;
let getMaterial;
let deleteMaterial;
let bulkUpsertMaterials;
let listMaterials;
let MaterialCatalogError;
let assertReplaceAllowed;
let collectMaterialReferences;
let materialsRouter;

beforeAll(async () => {
  process.env.DATABASE_PATH = tmpDb;
  vi.resetModules();
  const dbMod = await import("../backend/src/db.js");
  const matMod = await import("../backend/src/routes/materials.js");
  const guardMod = await import("../backend/src/services/materialReferenceGuard.js");
  const apiMod = await import("../backend/src/routes/materialsApi.js");
  db = dbMod.db;
  initDb = dbMod.initDb;
  createMaterial = matMod.createMaterial;
  getMaterial = matMod.getMaterial;
  deleteMaterial = matMod.deleteMaterial;
  bulkUpsertMaterials = matMod.bulkUpsertMaterials;
  listMaterials = matMod.listMaterials;
  MaterialCatalogError = guardMod.MaterialCatalogError;
  assertReplaceAllowed = guardMod.assertReplaceAllowed;
  collectMaterialReferences = guardMod.collectMaterialReferences;
  materialsRouter = apiMod.default;
  initDb();
});

beforeEach(() => {
  db.prepare("DELETE FROM project_items").run();
  db.prepare("DELETE FROM projects").run();
  db.prepare("DELETE FROM spec_presets").run();
  db.prepare("DELETE FROM files").run();
  db.prepare("DELETE FROM materials").run();
  db.prepare("DELETE FROM settings WHERE key = ?").run("farmSectionCatalogs");
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

function seedProject(id = "p1") {
  db.prepare(
    `INSERT INTO projects (id, name, client_token, status)
     VALUES (?, ?, ?, 'draft')`
  ).run(id, `Project ${id}`, `tok_${id}`);
}

function seedProjectItem({ id, projectId, materialId, sourceType = "", source = "", sourceKey = "" }) {
  db.prepare(
    `INSERT INTO project_items (
      id, project_id, material_id, module, name, unit, category, qty, price, source, source_type, source_key
    ) VALUES (?, ?, ?, 'mod', 'Item', 'шт.', 'Прочее', 1, 0, ?, ?, ?)`
  ).run(id, projectId, materialId, source, sourceType, sourceKey);
}

function seedPreset({ id, items }) {
  db.prepare(
    `INSERT INTO spec_presets (
      id, name, preset_type, items_json, params_json
    ) VALUES (?, ?, 'project_section', ?, '{}')`
  ).run(id, `Preset ${id}`, JSON.stringify(items));
}

async function withServer(run) {
  const app = express();
  app.use(express.json());
  app.use("/api/materials", materialsRouter);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("material catalog replace protection", () => {
  it("rejects replace mode before any delete", () => {
    createMaterial({ id: "m_keep", name: "Keep", defaultQty: 1 });
    const before = listMaterials().length;
    expect(() => bulkUpsertMaterials([{ name: "New" }], "replace")).toThrow(MaterialCatalogError);
    try {
      bulkUpsertMaterials([{ name: "New" }], "replace");
    } catch (e) {
      expect(e.code).toBe("MATERIAL_REPLACE_DISABLED");
      expect(e.status).toBe(409);
      expect(e.message).toMatch(/временно отключена/i);
    }
    expect(listMaterials().length).toBe(before);
    expect(getMaterial("m_keep")).toBeTruthy();
    expect(listMaterials().some((m) => m.name === "New")).toBe(false);
  });

  it("assertReplaceAllowed fails closed for replace", () => {
    expect(() => assertReplaceAllowed("replace")).toThrow(/MATERIAL_REPLACE_DISABLED|временно отключена/);
  });

  it("merge continues to upsert without clearing catalog", () => {
    const m = createMaterial({ id: "m_merge", name: "Old", basePrice: 10, defaultQty: 1 });
    bulkUpsertMaterials([{ id: m.id, name: "Updated", basePrice: 20 }], "merge");
    expect(getMaterial(m.id).name).toBe("Updated");
    expect(getMaterial(m.id).basePrice).toBe(20);
    expect(listMaterials()).toHaveLength(1);
  });

  it("HTTP import excel replace returns 409 and leaves rows intact", async () => {
    createMaterial({ id: "m_http", name: "Keep Http", defaultQty: 1 });
    await withServer(async (base) => {
      const fd = new FormData();
      // Minimal invalid xlsx is fine — replace must fail before parse side effects.
      // Use a tiny buffer; route checks replace first.
      fd.append("file", new Blob([Uint8Array.from([0x50, 0x4b])], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "t.xlsx");
      fd.append("mode", "replace");
      const res = await fetch(`${base}/api/materials/import/excel`, { method: "POST", body: fd });
      const body = await res.json();
      expect(res.status).toBe(409);
      expect(body.code || body.error).toBe("MATERIAL_REPLACE_DISABLED");
      expect(body.message).toMatch(/временно отключена/i);
    });
    expect(getMaterial("m_http")).toBeTruthy();
    expect(listMaterials()).toHaveLength(1);
  });
});

describe("material catalog delete protection", () => {
  it("blocks delete when used in project_items", () => {
    const m = createMaterial({ id: "m_pi", name: "In project", defaultQty: 1 });
    seedProject("p_pi");
    seedProjectItem({ id: "it1", projectId: "p_pi", materialId: m.id });
    expect(() => deleteMaterial(m.id)).toThrow(MaterialCatalogError);
    try {
      deleteMaterial(m.id);
    } catch (e) {
      expect(e.code).toBe("MATERIAL_IN_USE");
      expect(e.status).toBe(409);
      expect(e.references.projectItems).toBe(1);
      expect(e.references.projects).toBe(1);
    }
    expect(getMaterial(m.id)).toBeTruthy();
  });

  it("blocks delete when used in template/preset items_json", () => {
    const m = createMaterial({ id: "m_tpl", name: "In template", defaultQty: 1 });
    seedPreset({ id: "pr1", items: [{ materialId: m.id, defaultQty: 2, included: true }] });
    expect(() => deleteMaterial(m.id)).toThrow(MaterialCatalogError);
    try {
      deleteMaterial(m.id);
    } catch (e) {
      expect(e.code).toBe("MATERIAL_IN_USE");
      expect(e.references.templates).toBe(1);
    }
    expect(getMaterial(m.id)).toBeTruthy();
  });

  it("blocks delete when used as frame BOM project item", () => {
    const m = createMaterial({ id: "m_fb", name: "Frame bom", defaultQty: 1 });
    seedProject("p_fb");
    seedProjectItem({
      id: "it_fb",
      projectId: "p_fb",
      materialId: m.id,
      sourceType: "frame_bom",
      source: "frame_bom",
      sourceKey: "frame_bom:d1:rack1:tube",
    });
    try {
      deleteMaterial(m.id);
      expect.unreachable();
    } catch (e) {
      expect(e.code).toBe("MATERIAL_IN_USE");
      expect(e.references.frameBom).toBe(1);
      expect(e.references.projectItems).toBe(1);
    }
    expect(getMaterial(m.id)).toBeTruthy();
  });

  it("returns aggregated counts across reference types", () => {
    const m = createMaterial({ id: "m_multi", name: "Multi", defaultQty: 1 });
    seedProject("p_a");
    seedProject("p_b");
    seedProjectItem({ id: "it_a", projectId: "p_a", materialId: m.id });
    seedProjectItem({
      id: "it_b",
      projectId: "p_b",
      materialId: m.id,
      sourceType: "frame_bom",
      sourceKey: "frame_bom:x:y:z",
    });
    seedPreset({ id: "pr_m", items: [{ materialId: m.id, defaultQty: 1 }] });
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
      "farmSectionCatalogs",
      JSON.stringify({ nasosnaya: [{ materialId: m.id, defaultQty: 3, included: true }] })
    );
    const refs = collectMaterialReferences(db, m.id);
    expect(refs.projects).toBe(2);
    expect(refs.projectItems).toBe(2);
    expect(refs.frameBom).toBe(1);
    expect(refs.templates).toBe(1);
    expect(refs.farmCatalogs).toBe(1);
    expect(() => deleteMaterial(m.id)).toThrow(/MATERIAL_IN_USE|используется/);
    expect(getMaterial(m.id)).toBeTruthy();
  });

  it("deletes unused material", () => {
    const m = createMaterial({ id: "m_free", name: "Free", defaultQty: 1 });
    deleteMaterial(m.id);
    expect(getMaterial(m.id)).toBeNull();
  });

  it("HTTP delete returns 409 with stable code and leaves row", async () => {
    const m = createMaterial({ id: "m_http_del", name: "Http del", defaultQty: 1 });
    seedProject("p_http");
    seedProjectItem({ id: "it_http", projectId: "p_http", materialId: m.id });
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/materials/${m.id}`, { method: "DELETE" });
      const body = await res.json();
      expect(res.status).toBe(409);
      expect(body.code || body.error).toBe("MATERIAL_IN_USE");
      expect(body.message).toMatch(/не может быть удалён/i);
      expect(body.references.projectItems).toBe(1);
    });
    expect(getMaterial(m.id)).toBeTruthy();
  });

  it("two nearly simultaneous deletes cannot bypass the guard", () => {
    const m = createMaterial({ id: "m_race", name: "Race", defaultQty: 1 });
    seedProject("p_race");
    seedProjectItem({ id: "it_race", projectId: "p_race", materialId: m.id });
    const results = [];
    for (let i = 0; i < 2; i++) {
      try {
        deleteMaterial(m.id);
        results.push("deleted");
      } catch (e) {
        results.push(e.code || e.message);
      }
    }
    expect(results.every((r) => r === "MATERIAL_IN_USE")).toBe(true);
    expect(getMaterial(m.id)).toBeTruthy();
  });
});
