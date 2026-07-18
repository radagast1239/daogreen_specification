/**
 * Storage inventory — pure model + service scan (read-only).
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import {
  classifyInventoryStatus,
  filterInventoryFiles,
  sanitizeInventoryFile,
  buildInventorySummary,
  STORAGE_STATUSES,
} from "../shared/storageInventory.js";

const require = createRequire(import.meta.url);
const express = require("../backend/node_modules/express");

const testId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tempDir = path.join(os.tmpdir(), `daogreen-storage-inv-${testId}`);
const tempDbPath = path.join(tempDir, "test.db");
const tempUploads = path.join(tempDir, "uploads");

let db;
let initDb;
let saveItems;
let createVersion;
let updateProject;
let adminAuthMiddleware;
let adminApi;
let walkUploadRootFiles;
let runStorageInventoryScan;
let queryStorageInventory;
let __test;

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
    VALUES ('mat1', 'Bolt', 'шт.', 'Каркас', 10, 'general', 'Sup', 'https://ex/a', '', 'Каркас', 'Крепёж')
  `).run();
}

function item(id, overrides = {}) {
  return {
    id,
    materialId: "mat1",
    name: "Bolt",
    unit: "шт.",
    module: "general",
    qty: 1,
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

async function listenApp(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

describe("storage inventory pure model", () => {
  it("classifies statuses", () => {
    expect(
      classifyInventoryStatus({ physicalExists: true, pinnedReferenceCount: 1, liveReferenceCount: 0 })
    ).toBe(STORAGE_STATUSES.PINNED);
    expect(
      classifyInventoryStatus({ physicalExists: true, pinnedReferenceCount: 0, liveReferenceCount: 1 })
    ).toBe(STORAGE_STATUSES.LIVE_REFERENCED);
    expect(
      classifyInventoryStatus({ physicalExists: true, pinnedReferenceCount: 1, liveReferenceCount: 1 })
    ).toBe(STORAGE_STATUSES.PINNED_AND_LIVE);
    expect(
      classifyInventoryStatus({ physicalExists: true, pinnedReferenceCount: 0, liveReferenceCount: 0 })
    ).toBe(STORAGE_STATUSES.ORPHAN);
    expect(
      classifyInventoryStatus({
        physicalExists: true,
        pinnedReferenceCount: 0,
        liveReferenceCount: 0,
        isDuplicate: true,
      })
    ).toBe(STORAGE_STATUSES.DUPLICATE);
    expect(
      classifyInventoryStatus({ physicalExists: false, pinnedReferenceCount: 1, liveReferenceCount: 0 })
    ).toBe(STORAGE_STATUSES.MISSING);
  });

  it("sanitizes absolute paths from API payload", () => {
    const safe = sanitizeInventoryFile({
      assetPath: "/uploads/a.png",
      abs: "C:\\secret\\uploads\\a.png",
      absolutePath: "/var/secret",
      references: [{ url: "/uploads/a.png", abs: "/secret" }],
    });
    expect(JSON.stringify(safe)).not.toMatch(/secret|C:\\\\/i);
    expect(safe.abs).toBeUndefined();
    expect(safe.references[0].abs).toBeUndefined();
  });

  it("filters by status and search", () => {
    const files = [
      { assetPath: "/uploads/a.png", status: "PINNED", filename: "a.png", contentHash: "aa" },
      { assetPath: "/uploads/b.png", status: "ORPHAN", filename: "b.png", contentHash: "bb", isDuplicate: true },
      { assetPath: "/uploads/c.png", status: "MISSING", filename: "c.png", contentHash: "" },
    ];
    expect(filterInventoryFiles(files, { status: "ORPHAN" }).map((f) => f.filename)).toContain("b.png");
    expect(filterInventoryFiles(files, { missingOnly: true })).toHaveLength(1);
    expect(filterInventoryFiles(files, { search: "aa" })[0].filename).toBe("a.png");
  });
});

describe("storage inventory service + API", () => {
  beforeAll(async () => {
    fs.mkdirSync(tempUploads, { recursive: true });
    process.env.DATABASE_PATH = tempDbPath;
    process.env.DB_PATH = tempDbPath;
    process.env.UPLOAD_ROOT = tempUploads;
    process.env.ADMIN_KEY = "storage-inv-test-key";
    process.env.NODE_ENV = "test";
    vi.resetModules();
    const dbMod = await import("../backend/src/db.js");
    const projectsMod = await import("../backend/src/routes/projects.js");
    const invMod = await import("../backend/src/services/storageInventoryService.js");
    const authMod = await import("../backend/src/auth.js");
    const adminMod = await import("../backend/src/routes/admin.js");
    db = dbMod.db;
    initDb = dbMod.initDb;
    saveItems = projectsMod.saveItems;
    createVersion = projectsMod.createVersion;
    updateProject = projectsMod.updateProject;
    walkUploadRootFiles = invMod.__test.walkUploadRootFiles;
    runStorageInventoryScan = invMod.runStorageInventoryScan;
    queryStorageInventory = invMod.queryStorageInventory;
    __test = invMod.__test;
    adminAuthMiddleware = authMod.adminAuthMiddleware;
    adminApi = adminMod.default;
    initDb();
  });

  beforeEach(() => {
    process.env.UPLOAD_ROOT = tempUploads;
    process.env.ADMIN_KEY = "storage-inv-test-key";
    __test.resetLastScan();
    db.prepare("DELETE FROM spec_versions").run();
    db.prepare("DELETE FROM project_items").run();
    db.prepare("DELETE FROM files").run();
    db.prepare("DELETE FROM frame_drawings").run();
    db.prepare("DELETE FROM materials").run();
    db.prepare("DELETE FROM projects").run();
    db.prepare("DELETE FROM settings").run();
    seedMaterial();
    for (const name of fs.readdirSync(tempUploads)) {
      fs.rmSync(path.join(tempUploads, name), { recursive: true, force: true });
    }
  });

  afterAll(() => {
    delete process.env.DATABASE_PATH;
    delete process.env.DB_PATH;
    delete process.env.UPLOAD_ROOT;
    delete process.env.ADMIN_KEY;
    vi.resetModules();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("walk finds files inside root and ignores symlink escape", () => {
    writeUpload("in.png", "inside");
    const outside = path.join(tempDir, "outside.txt");
    fs.writeFileSync(outside, "escape");
    const linkPath = path.join(tempUploads, "escape-link.txt");
    try {
      fs.symlinkSync(outside, linkPath);
    } catch {
      // Windows may require admin for symlinks — skip escape assert if cannot create
      const files = walkUploadRootFiles(tempUploads);
      expect(files.some((f) => f.rel === "in.png")).toBe(true);
      return;
    }
    const files = walkUploadRootFiles(tempUploads);
    expect(files.some((f) => f.rel === "in.png")).toBe(true);
    expect(files.some((f) => f.rel.includes("escape"))).toBe(false);
  });

  it("scan hashes, finds orphan/duplicate/missing/pinned/live", async () => {
    const pinnedUrl = writeUpload("pinned.png", "PINNED-BYTES");
    const liveUrl = writeUpload("live.png", "LIVE-BYTES");
    writeUpload("orphan.png", "ORPHAN-BYTES");
    writeUpload("dup-a.png", "SAME-HASH");
    writeUpload("dup-b.png", "SAME-HASH");

    db.prepare(`
      INSERT INTO projects (id, name, client, city, client_token, status, manual_params, currency, vat, comment, stellage_configs)
      VALUES ('p1', 'Proj', 'C', 'City', 'tok1', 'active', ?, '₽', 1, '', ?)
    `).run(
      JSON.stringify({
        projectSchemes: [{ id: "s1", title: "S", url: pinnedUrl, clientVisible: true }],
        farmPower: { devices: [], tariffPerKwh: 5, daysPerMonth: 30 },
      }),
      JSON.stringify([{ id: "st1", name: "Rack", extraImages: [{ id: "r1", url: liveUrl, clientVisible: true }] }])
    );
    saveItems("p1", [item("it1")]);
    createVersion("p1", "admin", { force: true });

    // After publish, live still references live.png via stellage; pinned scheme is in snapshot
    // Add missing reference
    lockedUpdate("p1", {
      manualParams: {
        projectSchemes: [
          { id: "s1", title: "S", url: pinnedUrl, clientVisible: true },
          { id: "missing", title: "M", url: "/uploads/does-not-exist.png", clientVisible: true },
        ],
        farmPower: { devices: [], tariffPerKwh: 5, daysPerMonth: 30 },
      },
    });

    // Material photo
    const matPhoto = writeUpload("mat.png", "MAT");
    db.prepare("UPDATE materials SET photo_url = ? WHERE id = 'mat1'").run(matPhoto);

    // Live Frame Drawing PDF
    const drawingUrl = writeUpload("frame-drawings/p1/fd1.pdf", "%PDF-1.4 drawing");
    db.prepare(`
      INSERT INTO frame_drawings (
        id, project_id, module_id, stellage_id, module_rack_key, preset_id, source_type,
        title, rack_type, frame_config_json, pdf_url, pdf_filename, file_id,
        is_client_visible, version, created_at, updated_at
      ) VALUES ('fd1', 'p1', NULL, 'st1', '', NULL, 'project_stellage',
        'FD', 'nft', '{}', ?, 'fd1.pdf', NULL, 1, 1, datetime('now'), datetime('now'))
    `).run(drawingUrl);

    const mtimeBefore = fs.statSync(path.join(tempUploads, "orphan.png")).mtimeMs;
    const result = await runStorageInventoryScan();
    const mtimeAfter = fs.statSync(path.join(tempUploads, "orphan.png")).mtimeMs;
    expect(Math.abs(mtimeAfter - mtimeBefore)).toBeLessThan(5);

    expect(result.readOnly).toBe(true);
    const byPath = Object.fromEntries(result.files.map((f) => [f.assetPath, f]));

    expect(byPath[pinnedUrl]?.status).toMatch(/PINNED/);
    expect(byPath[liveUrl]?.status).toMatch(/LIVE|PINNED/);
    expect(byPath["/uploads/orphan.png"]?.status).toMatch(/ORPHAN|DUPLICATE/);
    expect(byPath["/uploads/does-not-exist.png"]?.status).toBe("MISSING");
    expect(byPath["/uploads/dup-a.png"]?.isDuplicate).toBe(true);
    expect(byPath["/uploads/dup-b.png"]?.isDuplicate).toBe(true);
    expect(byPath[matPhoto]?.liveReferenceCount).toBeGreaterThan(0);
    expect(byPath[drawingUrl]?.liveReferenceCount).toBeGreaterThan(0);
    expect(byPath[drawingUrl]?.status).toMatch(/LIVE|PINNED/);

    const json = JSON.stringify(result);
    expect(json).not.toMatch(/[A-Za-z]:\\\\|\/Users\/|C:\\\\Temp/i);
    expect(json).not.toContain(tempUploads.replace(/\\/g, "\\\\"));

    const summary = buildInventorySummary(result.files);
    expect(summary.totalFiles).toBeGreaterThanOrEqual(5);
    expect(summary.missingReferences).toBeGreaterThanOrEqual(1);
    expect(summary.duplicateGroups).toBeGreaterThanOrEqual(1);
  });

  it("admin auth required; no path traversal query", async () => {
    writeUpload("a.png", "a");
    await runStorageInventoryScan();
    const app = express();
    app.use(express.json());
    app.use("/api/admin", adminAuthMiddleware, adminApi);
    const { server, base } = await listenApp(app);
    try {
      const noAuth = await fetch(`${base}/api/admin/storage/inventory`);
      expect(noAuth.status).toBe(401);

      const ok = await fetch(`${base}/api/admin/storage/inventory`, {
        headers: { "x-admin-key": "storage-inv-test-key" },
      });
      expect(ok.status).toBe(200);
      const body = await ok.json();
      expect(body.ok).toBe(true);
      expect(JSON.stringify(body)).not.toMatch(/\/delete|deleteFile|canDelete":true/i);
      expect(body.items.every((f) => f.canDelete === false)).toBe(true);

      const bad = await fetch(
        `${base}/api/admin/storage/inventory/file?assetPath=${encodeURIComponent("C:/Windows/system32")}`,
        { headers: { "x-admin-key": "storage-inv-test-key" } }
      );
      expect(bad.status).toBe(400);

      const trav = await fetch(
        `${base}/api/admin/storage/inventory/file?assetPath=${encodeURIComponent("/uploads/../etc/passwd")}`,
        { headers: { "x-admin-key": "storage-inv-test-key" } }
      );
      expect(trav.status).toBe(400);
    } finally {
      server.close();
    }
  });

  it("UI contracts: page has no delete buttons", () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
    const src = fs.readFileSync(path.join(root, "src/pages/admin/StorageInventoryPage.jsx"), "utf8");
    expect(src).toContain("storage-inventory-page");
    expect(src).toContain("storage-summary-cards");
    expect(src).toContain("storage-filters");
    expect(src).toContain("storage-file-detail");
    expect(src).not.toMatch(/Удалить все|delete orphan|очистить сирот/i);
    expect(src).toContain("Только просмотр");
  });
});
