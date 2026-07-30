/**
 * UPLOAD_ROOT + retention regression tests (temp dirs only).
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";
import { clientExportHeader } from "../shared/publishedClientMeta.js";
import { projectForClientPdfExport, projectForClientExcelExport } from "../src/lib/clientExportProject.js";

const testId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tempDir = path.join(os.tmpdir(), `daogreen-upload-root-${testId}`);
const tempDbPath = path.join(tempDir, "test.db");
const tempUploads = path.join(tempDir, "uploads");
let db;
let initDb;
let loadProject;
let saveItems;
let createVersion;
let updateProject;
let localUploadDir;
let saveFile;
let getUploadRoot;
let resolveLocalUploadAbsPath;
let hashLocalUploadFile;
let deleteLocalUploadFile;
let assertCanDeleteOrOverwriteAsset;
let buildClientProjectFromRelease;
let loadPublishedReleaseSnapshot;

function lockedUpdate(id, patch) {
  const revision = Number(db.prepare("SELECT revision FROM projects WHERE id = ?").get(id)?.revision) || 1;
  return updateProject(id, { ...patch, expectedRevision: revision });
}

function writeUpload(rel, body = "x") {
  const abs = path.join(tempUploads, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.from(body));
  return `/uploads/${rel.replace(/\\/g, "/")}`;
}

function seedMaterial() {
  db.prepare(`
    INSERT INTO materials (id, name, unit, category, base_price, module, supplier, link, photo_url, client_section, client_subsection)
    VALUES ('mat1', 'Bolt', 'шт.', 'Каркас', 10, 'general', 'Sup', 'https://ex/a', 'https://ex/p', 'Каркас', 'Крепёж')
  `).run();
}

function item(id, overrides = {}) {
  return {
    id,
    materialId: "mat1",
    name: "Bolt",
    unit: "шт.",
    module: "general",
    qty: 2,
    price: 100,
    supplier: "Sup",
    link: "https://ex/a",
    visibleToClient: true,
    includedInProject: true,
    enabled: true,
    approved: true,
    itemType: "material",
    status: "not_bought",
    clientSection: "Каркас",
    clientSubsection: "Крепёж",
    ...overrides,
  };
}

beforeAll(async () => {
  fs.mkdirSync(tempUploads, { recursive: true });
  process.env.DATABASE_PATH = tempDbPath;
  process.env.DB_PATH = tempDbPath;
  process.env.UPLOAD_ROOT = tempUploads;
  process.env.NODE_ENV = "test";
  vi.resetModules();
  const storage = await import("../backend/src/storage/index.js");
  const retention = await import("../backend/src/services/publishedAssetRetention.js");
  const dbMod = await import("../backend/src/db.js");
  const projectsMod = await import("../backend/src/routes/projects.js");
  const releaseMod = await import("../backend/src/services/publishedReleaseService.js");
  localUploadDir = storage.localUploadDir;
  saveFile = storage.saveFile;
  getUploadRoot = retention.getUploadRoot;
  resolveLocalUploadAbsPath = retention.resolveLocalUploadAbsPath;
  hashLocalUploadFile = retention.hashLocalUploadFile;
  deleteLocalUploadFile = retention.deleteLocalUploadFile;
  assertCanDeleteOrOverwriteAsset = retention.assertCanDeleteOrOverwriteAsset;
  db = dbMod.db;
  initDb = dbMod.initDb;
  loadProject = dbMod.loadProject;
  saveItems = projectsMod.saveItems;
  createVersion = projectsMod.createVersion;
  updateProject = projectsMod.updateProject;
  buildClientProjectFromRelease = releaseMod.buildClientProjectFromRelease;
  loadPublishedReleaseSnapshot = releaseMod.loadPublishedReleaseSnapshot;
  initDb();
});

beforeEach(() => {
  process.env.UPLOAD_ROOT = tempUploads;
  db.prepare("DELETE FROM spec_versions").run();
  db.prepare("DELETE FROM project_items").run();
  db.prepare("DELETE FROM files").run();
  db.prepare("DELETE FROM frame_drawings").run();
  db.prepare("DELETE FROM materials").run();
  db.prepare("DELETE FROM projects").run();
  seedMaterial();
  for (const name of fs.readdirSync(tempUploads)) {
    fs.rmSync(path.join(tempUploads, name), { recursive: true, force: true });
  }
});

afterAll(() => {
  delete process.env.DATABASE_PATH;
  delete process.env.DB_PATH;
  delete process.env.UPLOAD_ROOT;
  vi.resetModules();
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("UPLOAD_ROOT storage contract", () => {
  it("saveFile writes into UPLOAD_ROOT and localUploadDir matches getUploadRoot", async () => {
    expect(path.resolve(localUploadDir())).toBe(path.resolve(tempUploads));
    expect(path.resolve(getUploadRoot())).toBe(path.resolve(tempUploads));
    const url = await saveFile(Buffer.from("hello-root"), "root-test.png");
    expect(url).toBe("/uploads/public/root-test.png");
    expect(fs.existsSync(path.join(tempUploads, "public", "root-test.png"))).toBe(true);
    expect(fs.readFileSync(path.join(tempUploads, "public", "root-test.png"), "utf8")).toBe("hello-root");
  });

  it("static /uploads serves files from the same UPLOAD_ROOT", async () => {
    const { createRequire } = await import("module");
    const require = createRequire(import.meta.url);
    const express = require("../backend/node_modules/express");
    writeUpload("static-serve.png", "static-body");
    const app = express();
    app.use("/uploads", express.static(localUploadDir()));
    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    try {
      const { port } = server.address();
      const res = await fetch(`http://127.0.0.1:${port}/uploads/static-serve.png`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("static-body");
    } finally {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  it("default upload root works without env override", () => {
    const prev = process.env.UPLOAD_ROOT;
    delete process.env.UPLOAD_ROOT;
    try {
      const root = localUploadDir();
      expect(path.isAbsolute(root)).toBe(true);
      expect(root.replace(/\\/g, "/")).toMatch(/\/uploads$/);
      expect(path.resolve(root)).not.toBe(path.resolve(tempUploads));
    } finally {
      process.env.UPLOAD_ROOT = prev;
    }
  });

  it("blocks path traversal outside UPLOAD_ROOT", () => {
    expect(resolveLocalUploadAbsPath("/uploads/../secret.txt")).toBeNull();
    expect(resolveLocalUploadAbsPath("/uploads/a/../../etc/passwd")).toBeNull();
    expect(resolveLocalUploadAbsPath("/uploads/ok.png")).toBe(path.resolve(tempUploads, "ok.png"));
  });

  it("hashes project image and frame drawing PDF from UPLOAD_ROOT", () => {
    const img = writeUpload("img.png", "img-bytes");
    const pdf = writeUpload("frame-drawings/p/d.pdf", "pdf-bytes");
    const h1 = hashLocalUploadFile(img);
    const h2 = hashLocalUploadFile(pdf);
    expect(h1.ok).toBe(true);
    expect(h1.contentHash).toBe(createHash("sha256").update("img-bytes").digest("hex"));
    expect(h2.ok).toBe(true);
    expect(h2.contentHash).toBe(createHash("sha256").update("pdf-bytes").digest("hex"));
  });

  it("missing file in UPLOAD_ROOT is detected and blocks publish", () => {
    db.prepare(`
      INSERT INTO projects (id, name, client, city, client_token, status, manual_params, currency, vat)
      VALUES ('p1', 'P', 'C', 'City', 'tok-p1', 'active', ?, '₽', 1)
    `).run(JSON.stringify({
      projectSchemes: [{ id: "s1", title: "S", url: "/uploads/missing-only.png", clientVisible: true }],
    }));
    saveItems("p1", [item("it1")]);
    expect(() => createVersion("p1", "admin", { force: true })).toThrow(/Не найдены файлы/);
    expect(db.prepare("SELECT COUNT(*) c FROM spec_versions WHERE project_id='p1'").get().c).toBe(0);
  });

  it("pinned retention blocks delete and keeps binary", () => {
    const url = writeUpload("pinned.png", "keep");
    db.prepare(`
      INSERT INTO projects (id, name, client, city, client_token, status, manual_params, currency, vat)
      VALUES ('p1', 'Header A', 'Client A', 'City A', 'tok-p1', 'active', ?, '₽', 1)
    `).run(JSON.stringify({
      projectSchemes: [{ id: "s1", title: "S", url, mimeType: "image/png", clientVisible: true }],
    }));
    saveItems("p1", [item("it1")]);
    createVersion("p1", "admin", { force: true });
    expect(() => assertCanDeleteOrOverwriteAsset({ url })).toThrow(/закреплён/);
    expect(() => deleteLocalUploadFile(url)).toThrow(/закреплён/);
    expect(fs.existsSync(path.join(tempUploads, "pinned.png"))).toBe(true);
    expect(fs.readFileSync(path.join(tempUploads, "pinned.png"), "utf8")).toBe("keep");
  });

  it("saveFile refuses overwrite of pinned path", async () => {
    const url = writeUpload("public/same.png", "v1");
    db.prepare(`
      INSERT INTO projects (id, name, client_token, status, manual_params, currency, vat)
      VALUES ('p1', 'P', 'tok-ow', 'active', ?, '₽', 1)
    `).run(JSON.stringify({
      projectSchemes: [{ id: "s1", title: "S", url, clientVisible: true }],
    }));
    saveItems("p1", [item("it1")]);
    createVersion("p1", "admin", { force: true });
    await expect(saveFile(Buffer.from("v2"), "same.png")).rejects.toThrow(/закреплён/);
    expect(fs.readFileSync(path.join(tempUploads, "public", "same.png"), "utf8")).toBe("v1");
  });
});

describe("export header from snapshot DTO", () => {
  it("PDF/Excel builders keep published header after live rename", () => {
    const url = writeUpload("h.png", "h");
    db.prepare(`
      INSERT INTO projects (id, name, client, city, client_token, status, manual_params, currency, vat, comment)
      VALUES ('p1', 'Header A', 'Client A', 'City A', 'tok-h', 'active', ?, '₽', 1, 'Comment A')
    `).run(JSON.stringify({
      projectSchemes: [{ id: "s1", title: "S", url, clientVisible: true }],
    }));
    saveItems("p1", [item("it1")]);
    createVersion("p1", "admin", { force: true });
    lockedUpdate("p1", { name: "Header B", client: "Client B", city: "City B", currency: "$", vat: false });
    const live = loadProject("p1");
    const dto = buildClientProjectFromRelease(live, loadPublishedReleaseSnapshot(live), { overlayLive: true });
    expect(clientExportHeader(dto)).toMatchObject({
      name: "Header A",
      client: "Client A",
      city: "City A",
      currency: "₽",
      vat: true,
    });
    expect(projectForClientPdfExport(dto).name).toBe("Header A");
    expect(projectForClientExcelExport(dto).name).toBe("Header A");
  });
});
