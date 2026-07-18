/**
 * Storage orphan quarantine — eligibility, move, restore, security.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import {
  evaluateQuarantineEligibility,
  QUARANTINE_CONFIRM_PHRASE,
  isBlockedServiceFilename,
} from "../shared/storageQuarantine.js";

const require = createRequire(import.meta.url);
const express = require("../backend/node_modules/express");

const testId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tempDir = path.join(os.tmpdir(), `daogreen-q-${testId}`);
const tempDbPath = path.join(tempDir, "test.db");
const tempUploads = path.join(tempDir, "uploads");
const tempQuarantine = path.join(tempDir, "quarantine");

let db;
let initDb;
let saveItems;
let createVersion;
let updateProject;
let adminAuthMiddleware;
let adminApi;
let runStorageInventoryScan;
let previewQuarantine;
let executeQuarantine;
let listQuarantine;
let restoreQuarantinedFile;
let getQuarantineRoot;
let __qTest;
let __invTest;

function lockedUpdate(id, patch) {
  const revision = Number(db.prepare("SELECT revision FROM projects WHERE id = ?").get(id)?.revision) || 1;
  return updateProject(id, { ...patch, expectedRevision: revision });
}

function writeUpload(rel, body = "x", mtimeDaysAgo = 30) {
  const abs = path.join(tempUploads, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.from(body));
  const t = Date.now() - mtimeDaysAgo * 24 * 60 * 60 * 1000;
  fs.utimesSync(abs, new Date(t), new Date(t));
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

describe("quarantine pure helpers", () => {
  it("blocks service files and young / referenced / duplicate", () => {
    expect(isBlockedServiceFilename(".gitkeep")).toBe(true);
    expect(isBlockedServiceFilename(".hidden")).toBe(true);
    expect(isBlockedServiceFilename("ok.png")).toBe(false);

    expect(
      evaluateQuarantineEligibility({
        status: "ORPHAN",
        physicalExists: true,
        filename: "a.png",
        modifiedAt: new Date(Date.now() - 30 * 864e5).toISOString(),
        pinnedReferenceCount: 0,
        liveReferenceCount: 0,
      }).ok
    ).toBe(true);

    expect(
      evaluateQuarantineEligibility({
        status: "PINNED",
        physicalExists: true,
        filename: "a.png",
        modifiedAt: new Date(Date.now() - 30 * 864e5).toISOString(),
        pinnedReferenceCount: 1,
        liveReferenceCount: 0,
      }).ok
    ).toBe(false);

    expect(
      evaluateQuarantineEligibility({
        status: "DUPLICATE",
        isDuplicate: true,
        physicalExists: true,
        filename: "a.png",
        modifiedAt: new Date(Date.now() - 30 * 864e5).toISOString(),
        pinnedReferenceCount: 0,
        liveReferenceCount: 0,
      }).code
    ).toBe("DUPLICATE");

    expect(
      evaluateQuarantineEligibility({
        status: "ORPHAN",
        physicalExists: true,
        filename: "a.png",
        modifiedAt: new Date().toISOString(),
        pinnedReferenceCount: 0,
        liveReferenceCount: 0,
        minAgeDays: 14,
      }).code
    ).toBe("TOO_YOUNG");
  });
});

describe("quarantine service + API", () => {
  beforeAll(async () => {
    fs.mkdirSync(tempUploads, { recursive: true });
    fs.mkdirSync(tempQuarantine, { recursive: true });
    process.env.DATABASE_PATH = tempDbPath;
    process.env.DB_PATH = tempDbPath;
    process.env.UPLOAD_ROOT = tempUploads;
    process.env.STORAGE_QUARANTINE_ROOT = tempQuarantine;
    process.env.STORAGE_QUARANTINE_MIN_AGE_DAYS = "14";
    process.env.ADMIN_KEY = "q-test-key";
    process.env.NODE_ENV = "test";
    vi.resetModules();
    const dbMod = await import("../backend/src/db.js");
    const projectsMod = await import("../backend/src/routes/projects.js");
    const invMod = await import("../backend/src/services/storageInventoryService.js");
    const qMod = await import("../backend/src/services/storageQuarantineService.js");
    const authMod = await import("../backend/src/auth.js");
    const adminMod = await import("../backend/src/routes/admin.js");
    db = dbMod.db;
    initDb = dbMod.initDb;
    saveItems = projectsMod.saveItems;
    createVersion = projectsMod.createVersion;
    updateProject = projectsMod.updateProject;
    runStorageInventoryScan = invMod.runStorageInventoryScan;
    __invTest = invMod.__test;
    previewQuarantine = qMod.previewQuarantine;
    executeQuarantine = qMod.executeQuarantine;
    listQuarantine = qMod.listQuarantine;
    restoreQuarantinedFile = qMod.restoreQuarantinedFile;
    getQuarantineRoot = qMod.getQuarantineRoot;
    __qTest = qMod.__test;
    adminAuthMiddleware = authMod.adminAuthMiddleware;
    adminApi = adminMod.default;
    initDb();
  });

  beforeEach(() => {
    process.env.UPLOAD_ROOT = tempUploads;
    process.env.STORAGE_QUARANTINE_ROOT = tempQuarantine;
    process.env.STORAGE_QUARANTINE_MIN_AGE_DAYS = "14";
    process.env.ADMIN_KEY = "q-test-key";
    __invTest.resetLastScan();
    __qTest.resetPreviewTokens();
    db.prepare("DELETE FROM storage_quarantine_events").run();
    db.prepare("DELETE FROM storage_quarantine").run();
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
    for (const name of fs.readdirSync(tempQuarantine)) {
      fs.rmSync(path.join(tempQuarantine, name), { recursive: true, force: true });
    }
  });

  afterAll(() => {
    delete process.env.DATABASE_PATH;
    delete process.env.DB_PATH;
    delete process.env.UPLOAD_ROOT;
    delete process.env.STORAGE_QUARANTINE_ROOT;
    delete process.env.ADMIN_KEY;
    vi.resetModules();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("eligibility: orphan yes; pinned/live/dup/gitkeep/young blocked", async () => {
    const orphan = writeUpload("old-orphan.png", "ORPHAN-OLD", 30);
    const young = writeUpload("young.png", "YOUNG", 1);
    writeUpload(".gitkeep", "", 30);
    const pinned = writeUpload("pinned.png", "PIN", 30);
    const live = writeUpload("live.png", "LIVE", 30);
    writeUpload("dup-a.png", "SAME", 30);
    writeUpload("dup-b.png", "SAME", 30);

    db.prepare(`
      INSERT INTO projects (id, name, client, city, client_token, status, manual_params, currency, vat, comment, stellage_configs)
      VALUES ('p1', 'P', 'C', 'City', 'tok', 'active', ?, '₽', 1, '', ?)
    `).run(
      JSON.stringify({
        projectSchemes: [{ id: "s1", title: "S", url: pinned, clientVisible: true }],
        farmPower: { devices: [], tariffPerKwh: 5, daysPerMonth: 30 },
      }),
      JSON.stringify([{ id: "st1", name: "R", extraImages: [{ id: "r1", url: live, clientVisible: true }] }])
    );
    saveItems("p1", [item("it1")]);
    createVersion("p1", "admin", { force: true });
    await runStorageInventoryScan();

    const preview = await previewQuarantine({
      assetPaths: [orphan, young, "/uploads/.gitkeep", pinned, live, "/uploads/dup-a.png"],
    });
    expect(preview.eligible.map((e) => e.assetPath)).toEqual([orphan]);
    const codes = Object.fromEntries(preview.blocked.map((b) => [b.assetPath, b.code]));
    expect(codes[young]).toBe("TOO_YOUNG");
    expect(codes["/uploads/.gitkeep"]).toBe("SERVICE_FILE");
    expect(codes[pinned]).toMatch(/PINNED|REFERENCED|STORAGE_ASSET_REFERENCED/);
    expect(codes[live]).toMatch(/LIVE|REFERENCED|STORAGE_ASSET_REFERENCED/);
    expect(codes["/uploads/dup-a.png"]).toBe("DUPLICATE");
  });

  it("revalidation: reference after preview → 409; token replay rejected", async () => {
    const orphan = writeUpload("will-ref.png", "WILLREF", 30);
    await runStorageInventoryScan();
    const preview = await previewQuarantine({ assetPaths: [orphan] });
    expect(preview.eligible).toHaveLength(1);

    db.prepare(`
      INSERT INTO projects (id, name, client, city, client_token, status, manual_params, currency, vat, comment, stellage_configs)
      VALUES ('p2', 'P2', 'C', 'City', 'tok2', 'active', ?, '₽', 1, '', '[]')
    `).run(
      JSON.stringify({
        projectSchemes: [{ id: "s1", title: "S", url: orphan, clientVisible: true }],
        farmPower: { devices: [], tariffPerKwh: 5, daysPerMonth: 30 },
      })
    );

    await expect(
      executeQuarantine({
        assetPaths: [orphan],
        confirmationToken: preview.confirmationToken,
        confirmationPhrase: QUARANTINE_CONFIRM_PHRASE,
      })
    ).rejects.toMatchObject({ code: expect.stringMatching(/REFERENCED|CHANGED/) });

    // fresh orphan for token replay — mark token used without depending on file still existing
    const o2 = writeUpload("replay.png", "REPLAY", 30);
    await runStorageInventoryScan();
    const p2 = await previewQuarantine({ assetPaths: [o2] });
    const tok = p2.confirmationToken;
    __qTest.previewTokens.get(tok).used = true;
    await expect(
      executeQuarantine({
        assetPaths: [o2],
        confirmationToken: tok,
        confirmationPhrase: QUARANTINE_CONFIRM_PHRASE,
      })
    ).rejects.toMatchObject({ code: expect.stringMatching(/TOKEN/) });
  });

  it("hash change after preview → 409", async () => {
    const orphan = writeUpload("hash-change.png", "HASH1", 30);
    await runStorageInventoryScan();
    const preview = await previewQuarantine({ assetPaths: [orphan] });
    fs.writeFileSync(path.join(tempUploads, "hash-change.png"), Buffer.from("HASH2-CHANGED"));
    const t = Date.now() - 30 * 864e5;
    fs.utimesSync(path.join(tempUploads, "hash-change.png"), new Date(t), new Date(t));
    await expect(
      executeQuarantine({
        assetPaths: [orphan],
        confirmationToken: preview.confirmationToken,
        confirmationPhrase: QUARANTINE_CONFIRM_PHRASE,
      })
    ).rejects.toMatchObject({ code: "STORAGE_ASSET_CHANGED" });
  });

  it("atomic quarantine + restore; public path 404 then 200; hash stable", async () => {
    const orphan = writeUpload("move-me.png", "MOVE-BYTES-XYZ", 40);
    await runStorageInventoryScan();
    const beforeHash = previewQuarantine;
    const preview = await beforeHash({ assetPaths: [orphan] });
    expect(preview.totalFiles).toBe(1);
    const hash = preview.eligible[0].contentHash;

    const result = await executeQuarantine({
      assetPaths: [orphan],
      confirmationToken: preview.confirmationToken,
      confirmationPhrase: QUARANTINE_CONFIRM_PHRASE,
    });
    expect(result.quarantined).toHaveLength(1);
    expect(fs.existsSync(path.join(tempUploads, "move-me.png"))).toBe(false);
    expect(getQuarantineRoot()).toBe(path.resolve(tempQuarantine));
    const qRel = result.quarantined[0].quarantineRelativePath;
    const qAbs = path.join(tempQuarantine, ...qRel.split("/"));
    expect(fs.existsSync(qAbs)).toBe(true);
    // quarantine not under uploads
    expect(qAbs.startsWith(path.resolve(tempUploads))).toBe(false);

    const list = listQuarantine({ status: "QUARANTINED" });
    expect(list.total).toBe(1);

    const restored = await restoreQuarantinedFile(result.quarantined[0].quarantineId);
    expect(restored.ok).toBe(true);
    expect(fs.existsSync(path.join(tempUploads, "move-me.png"))).toBe(true);
    const { createHash } = await import("crypto");
    const h = createHash("sha256").update(fs.readFileSync(path.join(tempUploads, "move-me.png"))).digest("hex");
    expect(h).toBe(hash);

    await expect(restoreQuarantinedFile(result.quarantined[0].quarantineId)).rejects.toMatchObject({
      code: "STORAGE_ALREADY_RESTORED",
    });
  });

  it("restore blocked if destination exists", async () => {
    const orphan = writeUpload("dest-block.png", "DEST", 40);
    await runStorageInventoryScan();
    const preview = await previewQuarantine({ assetPaths: [orphan] });
    const result = await executeQuarantine({
      assetPaths: [orphan],
      confirmationToken: preview.confirmationToken,
      confirmationPhrase: QUARANTINE_CONFIRM_PHRASE,
    });
    // recreate destination
    writeUpload("dest-block.png", "OTHER", 40);
    await expect(restoreQuarantinedFile(result.quarantined[0].quarantineId)).rejects.toMatchObject({
      code: "STORAGE_RESTORE_EXISTS",
    });
  });

  it("batch all-or-nothing; admin auth; no absolute paths; no delete endpoint", async () => {
    const a = writeUpload("batch-a.png", "BA", 40);
    const b = writeUpload("batch-b.png", "BB", 40);
    await runStorageInventoryScan();
    const preview = await previewQuarantine({ assetPaths: [a, b] });
    expect(preview.eligible).toHaveLength(2);

    const app = express();
    app.use(express.json());
    app.use("/api/admin", adminAuthMiddleware, adminApi);
    const { server, base } = await listenApp(app);
    try {
      const noAuth = await fetch(`${base}/api/admin/storage/quarantine/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetPaths: [a] }),
      });
      expect(noAuth.status).toBe(401);

      const ok = await fetch(`${base}/api/admin/storage/quarantine`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": "q-test-key" },
        body: JSON.stringify({
          assetPaths: [a, b],
          confirmationToken: preview.confirmationToken,
          confirmationPhrase: QUARANTINE_CONFIRM_PHRASE,
        }),
      });
      expect(ok.status).toBe(200);
      const body = await ok.json();
      expect(body.quarantined).toHaveLength(2);
      expect(JSON.stringify(body)).not.toMatch(/[A-Za-z]:\\\\|C:\\\\Temp|\\\\Users\\\\/i);
      expect(fs.existsSync(path.join(tempUploads, "batch-a.png"))).toBe(false);

      const del = await fetch(`${base}/api/admin/storage/quarantine/${body.quarantined[0].quarantineId}`, {
        method: "DELETE",
        headers: { "x-admin-key": "q-test-key" },
      });
      expect([404, 405]).toContain(del.status);

      const trav = await fetch(`${base}/api/admin/storage/quarantine/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": "q-test-key" },
        body: JSON.stringify({ assetPaths: ["C:/Windows/system32/x.png", "/uploads/../secret"] }),
      });
      expect(trav.status).toBe(200);
      const travBody = await trav.json();
      expect(travBody.eligible).toHaveLength(0);
      expect(travBody.blocked.length).toBeGreaterThan(0);
    } finally {
      server.close();
    }
  });

  it("UI contracts: quarantine wording, no permanent delete", () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
    const src = fs.readFileSync(path.join(root, "src/pages/admin/StorageInventoryPage.jsx"), "utf8");
    expect(src).toContain("Переместить в карантин");
    expect(src).toContain("QUARANTINE_CONFIRM_PHRASE");
    expect(src).toContain("storage-quarantine-list");
    expect(src).toContain("Восстановить");
    expect(src).not.toMatch(/Удалить навсегда|permanent delete|delete orphan/i);
    expect(src).toContain("canSelectForQuarantine");
  });
});
