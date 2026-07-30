/**
 * Release comments + human-readable publish summary.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { buildPublishAutoSummaryText, formatReleaseSummaryText } from "../shared/releaseHistoryDiff.js";
import { normalizeReleaseComment, RELEASE_COMMENT_MAX_LEN } from "../shared/releaseComment.js";

const require = createRequire(import.meta.url);
const express = require("../backend/node_modules/express");

const testId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tempDir = path.join(os.tmpdir(), `daogreen-release-comment-${testId}`);
const tempDbPath = path.join(tempDir, "test.db");
const tempUploads = path.join(tempDir, "uploads");

let db;
let initDb;
let loadProject;
let saveItems;
let createVersion;
let updateProject;
let listVersions;
let buildHistoricalClientPreview;
let buildClientProjectFromRelease;
let loadVersionRow;
let adminAuthMiddleware;
let projectsApi;
let clientRouter;

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

function seedProject(id, name, token, schemesUrl, itemId = "it1") {
  db.prepare(`
    INSERT INTO projects (id, name, client, city, client_token, status, manual_params, currency, vat, comment)
    VALUES (?, ?, 'Client A', 'City A', ?, 'active', ?, '₽', 1, 'Comment A')
  `).run(
    id,
    name,
    token,
    JSON.stringify({
      projectSchemes: schemesUrl
        ? [{ id: "s1", title: "Scheme", url: schemesUrl, clientVisible: true }]
        : [],
      farmPower: { devices: [{ id: "p", name: "Pump", normalKw: 2, peakKw: 3 }], tariffPerKwh: 5, daysPerMonth: 30 },
    }),
  );
  saveItems(id, [item(itemId)]);
  lockedUpdate(id, {
    rooms: [{
      id: "r1",
      name: "Room A",
      cooling: { params: { length: 5, width: 4, height: 3, shelves: 1, tiers: 1, safetyFactor: 1.2 }, recommendedKw: 3 },
      acUnits: [],
    }],
  });
}

async function listenApp(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

beforeAll(async () => {
  fs.mkdirSync(tempUploads, { recursive: true });
  process.env.DATABASE_PATH = tempDbPath;
  process.env.DB_PATH = tempDbPath;
  process.env.UPLOAD_ROOT = tempUploads;
  process.env.ADMIN_KEY = "release-comment-test-key";
  process.env.NODE_ENV = "test";
  vi.resetModules();
  const dbMod = await import("../backend/src/db.js");
  const projectsMod = await import("../backend/src/routes/projects.js");
  const releaseMod = await import("../backend/src/services/publishedReleaseService.js");
  const authMod = await import("../backend/src/auth.js");
  db = dbMod.db;
  initDb = dbMod.initDb;
  loadProject = dbMod.loadProject;
  saveItems = projectsMod.saveItems;
  createVersion = projectsMod.createVersion;
  updateProject = projectsMod.updateProject;
  listVersions = projectsMod.listVersions;
  buildHistoricalClientPreview = releaseMod.buildHistoricalClientPreview;
  buildClientProjectFromRelease = releaseMod.buildClientProjectFromRelease;
  loadVersionRow = releaseMod.loadVersionRow;
  adminAuthMiddleware = authMod.adminAuthMiddleware;
  projectsApi = projectsMod.default;
  clientRouter = projectsMod.clientRouter;
  initDb();
});

beforeEach(() => {
  process.env.UPLOAD_ROOT = tempUploads;
  process.env.ADMIN_KEY = "release-comment-test-key";
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
  delete process.env.ADMIN_KEY;
  vi.resetModules();
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("normalizeReleaseComment", () => {
  it("trims and keeps internal spaces; empty → null", () => {
    expect(normalizeReleaseComment("  hello  world  ")).toBe("hello  world");
    expect(normalizeReleaseComment("   ")).toBe(null);
    expect(normalizeReleaseComment("")).toBe(null);
    expect(normalizeReleaseComment(null)).toBe(null);
  });

  it("rejects over max length", () => {
    expect(() => normalizeReleaseComment("x".repeat(RELEASE_COMMENT_MAX_LEN + 1))).toThrow(/500/);
  });
});

describe("auto summary text", () => {
  it("describes added/removed/changed and total delta", () => {
    const text = buildPublishAutoSummaryText({
      hasChanges: true,
      items: { added: [{ id: "a" }, { id: "b" }], removed: [{ id: "c" }], changed: [{ id: "d" }] },
      totals: { from: 100, to: 224000, delta: 223900, currency: "₽" },
      images: { added: [], removed: [], changed: [] },
      drawings: { added: [], removed: [], replaced: [] },
      cooling: { powerChanged: false, roomsAdded: [], roomsRemoved: [] },
      farmPower: {},
    });
    expect(text).toMatch(/добавлено 2/i);
    expect(text).toMatch(/удалено 1/i);
    expect(text).toMatch(/изменено 1/i);
    expect(text).toMatch(/сумма выросла/i);
  });

  it("describes image and drawing changes", () => {
    const text = buildPublishAutoSummaryText({
      hasChanges: true,
      items: { added: [], removed: [], changed: [] },
      totals: { from: 1, to: 1, delta: 0, currency: "₽" },
      images: { added: [{ id: "1" }, { id: "2" }], removed: [], changed: [] },
      drawings: { added: [], removed: [], replaced: [{ targetKey: "st" }] },
      cooling: { powerChanged: false, roomsAdded: [], roomsRemoved: [] },
      farmPower: {},
    });
    expect(text).toMatch(/2 схем/i);
    expect(text).toMatch(/1 чертёж/i);
  });

  it("no changes → clear message", () => {
    expect(buildPublishAutoSummaryText({ empty: true })).toMatch(/без изменений/i);
    expect(formatReleaseSummaryText({})).toMatch(/без изменений/i);
  });
});

describe("publish with releaseComment", () => {
  it("publishes without comment", () => {
    const url = writeUpload("s.png", "a");
    seedProject("p1", "Header A", "tok1", url);
    const v = createVersion("p1", "admin", { force: true });
    expect(v.releaseComment).toBe(null);
    const row = loadVersionRow("p1", v.id);
    expect(row.releaseComment).toBe(null);
    expect(listVersions("p1")[0].releaseComment).toBe(null);
  });

  it("stores comment, trims, empty → null", () => {
    const url = writeUpload("s.png", "a");
    seedProject("p1", "Header A", "tok1", url);
    const v = createVersion("p1", "admin", {
      force: true,
      releaseComment: "  Первая версия для клиента  ",
    });
    expect(v.releaseComment).toBe("Первая версия для клиента");
    expect(loadVersionRow("p1", v.id).releaseComment).toBe("Первая версия для клиента");
    expect(listVersions("p1")[0].releaseComment).toBe("Первая версия для клиента");
    expect(listVersions("p1")[0].summaryText).toBeTruthy();

    saveItems("p1", [item("it1", { qty: 3, price: 120 })]);
    const v2 = createVersion("p1", "admin", { force: true, releaseComment: "   " });
    expect(v2.releaseComment).toBe(null);
  });

  it("rejects comment > 500", () => {
    const url = writeUpload("s.png", "a");
    seedProject("p1", "Header A", "tok1", url);
    expect(() =>
      createVersion("p1", "admin", { force: true, releaseComment: "z".repeat(501) })
    ).toThrow(/500/);
    expect(db.prepare("SELECT COUNT(*) c FROM spec_versions").get().c).toBe(0);
  });

  it("history returns releaseComment and auto summary; old rows without column value ok", () => {
    const url = writeUpload("s.png", "a");
    seedProject("p1", "Header A", "tok1", url);
    const v1 = createVersion("p1", "admin", { force: true, releaseComment: "v1 note" });
    // Simulate legacy row: clear comment via direct SQL is ok for test of reader
    db.prepare("UPDATE spec_versions SET release_comment = NULL WHERE id = ?").run(v1.id);
    saveItems("p1", [item("it1", { qty: 5, price: 100 }), item("it2", { qty: 1, price: 50, name: "Extra" })]);
    createVersion("p1", "admin", { force: true, releaseComment: "Добавили второй стеллаж" });
    const list = listVersions("p1");
    expect(list[0].releaseComment).toBe("Добавили второй стеллаж");
    expect(list[0].summaryText).toMatch(/добавлено|изменен|сумма/i);
    expect(list[1].releaseComment).toBe(null);
    expect(list[1].summaryText).toBeTruthy();
  });

  it("comment of one version does not change another", () => {
    const url = writeUpload("s.png", "a");
    seedProject("p1", "Header A", "tok1", url);
    const v1 = createVersion("p1", "admin", { force: true, releaseComment: "A" });
    saveItems("p1", [item("it1", { qty: 3 })]);
    const v2 = createVersion("p1", "admin", { force: true, releaseComment: "B" });
    expect(loadVersionRow("p1", v1.id).releaseComment).toBe("A");
    expect(loadVersionRow("p1", v2.id).releaseComment).toBe("B");
  });

  it("comment is immutable after create (no update API; SQL would not be exposed)", async () => {
    const url = writeUpload("s.png", "a");
    seedProject("p1", "Header A", "tok1", url);
    const v = createVersion("p1", "admin", { force: true, releaseComment: "locked" });
    const app = express();
    app.use(express.json());
    app.use("/api/projects", adminAuthMiddleware, projectsApi);
    const { server, base } = await listenApp(app);
    try {
      const rev = Number(db.prepare("SELECT revision FROM projects WHERE id = ?").get("p1").revision);
      for (const method of ["PATCH", "PUT"]) {
        const r = await fetch(`${base}/api/projects/p1/versions/${v.id}`, {
          method,
          headers: { "Content-Type": "application/json", "x-admin-key": "release-comment-test-key" },
          body: JSON.stringify({ releaseComment: "hacked", expectedRevision: rev }),
        });
        expect([404, 405]).toContain(r.status);
      }
      expect(loadVersionRow("p1", v.id).releaseComment).toBe("locked");
    } finally {
      server.close();
    }
  });

  it("HTML comment stored as plain text; preview returns it as text", () => {
    const url = writeUpload("s.png", "a");
    seedProject("p1", "Header A", "tok1", url);
    const html = '<script>alert(1)</script> ок';
    const v = createVersion("p1", "admin", { force: true, releaseComment: html });
    expect(v.releaseComment).toBe(html);
    const preview = buildHistoricalClientPreview("p1", v.id, loadProject("p1"));
    expect(preview.releaseComment).toBe(html);
    // must not be injected into client project DTO fields as executable structure
    expect(JSON.stringify(preview.project)).not.toContain("releaseComment");
  });

  it("stale revision does not create version or comment", async () => {
    const url = writeUpload("s.png", "a");
    seedProject("p1", "Header A", "tok1", url);
    const app = express();
    app.use(express.json());
    app.use("/api/projects", adminAuthMiddleware, projectsApi);
    const { server, base } = await listenApp(app);
    try {
      const r = await fetch(`${base}/api/projects/p1/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": "release-comment-test-key" },
        body: JSON.stringify({ force: true, expectedRevision: 999, releaseComment: "should-not-save" }),
      });
      expect(r.status).toBe(409);
      expect(db.prepare("SELECT COUNT(*) c FROM spec_versions").get().c).toBe(0);
    } finally {
      server.close();
    }
  });

  it("failed asset validation does not save comment", () => {
    const url = writeUpload("s.png", "a");
    seedProject("p1", "Header A", "tok1", url);
    // point scheme to missing file
    lockedUpdate("p1", {
      manualParams: {
        projectSchemes: [{ id: "s1", title: "S", url: "/uploads/missing-nope.png", clientVisible: true }],
        farmPower: { devices: [{ id: "p", name: "Pump", normalKw: 2, peakKw: 3 }], tariffPerKwh: 5, daysPerMonth: 30 },
      },
    });
    expect(() =>
      createVersion("p1", "admin", { force: true, releaseComment: "orphan" })
    ).toThrow();
    expect(db.prepare("SELECT COUNT(*) c FROM spec_versions").get().c).toBe(0);
  });

  it("client API does not expose releaseComment", async () => {
    const url = writeUpload("s.png", "a");
    seedProject("p1", "Header A", "tok-client", url);
    createVersion("p1", "admin", { force: true, releaseComment: "SECRET_INTERNAL" });
    const p = loadProject("p1");
    const snap = JSON.parse(
      db.prepare("SELECT snapshot FROM spec_versions WHERE project_id = ?").get("p1").snapshot
    );
    const clientProject = buildClientProjectFromRelease(p, snap, { overlayLive: true });
    expect(JSON.stringify(clientProject)).not.toContain("SECRET_INTERNAL");
    expect(clientProject.releaseComment).toBeUndefined();

    // Mirror serveClientProject versionInfo sanitization
    const versions = listVersions("p1");
    const versionInfoRaw = versions[0];
    const versionInfo = versionInfoRaw
      ? (({ releaseComment: _rc, ...safe }) => safe)(versionInfoRaw)
      : null;
    expect(versionInfoRaw.releaseComment).toBe("SECRET_INTERNAL");
    expect(versionInfo.releaseComment).toBeUndefined();
    expect(JSON.stringify(versionInfo)).not.toContain("SECRET_INTERNAL");

    const app = express();
    app.use(express.json());
    app.use("/api/client", clientRouter);
    const { server, base } = await listenApp(app);
    try {
      const r = await fetch(`${base}/api/client/p/tok-client`);
      const body = await r.text();
      expect(body).not.toContain("SECRET_INTERNAL");
      expect(body).not.toMatch(/"releaseComment"\s*:/);
    } finally {
      server.close();
    }
  });

  it("auto summary on second publish reflects item and total changes", () => {
    const url = writeUpload("s.png", "a");
    seedProject("p1", "Header A", "tok1", url);
    createVersion("p1", "admin", { force: true });
    saveItems("p1", [
      item("it1", { qty: 3, price: 100 }),
      item("it2", { qty: 1, price: 50, name: "New" }),
    ]);
    const v2 = createVersion("p1", "admin", { force: true, releaseComment: "Добавили второй стеллаж" });
    expect(v2.summaryText || v2.summary.autoSummaryText).toMatch(/добавлено/i);
    expect(v2.summary.autoSummaryText).toMatch(/сумма/i);
    expect(listVersions("p1")[0].totalDelta).not.toBe(0);
  });
});

describe("UI contracts for release comments", () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  function read(rel) {
    return fs.readFileSync(path.join(root, rel), "utf8");
  }

  it("publish modal has comment field", () => {
    const src = read("src/components/PublishVersionModal.jsx");
    expect(src).toContain("Опубликовать новую версию");
    expect(src).toContain("publish-release-comment");
    expect(src).toContain("Комментарий к версии");
    expect(src).toContain("Опубликовать версию");
  });

  it("history shows comment and hides empty block", () => {
    const src = read("src/components/ProjectReleaseHistory.jsx");
    expect(src).toContain("release-comment-");
    expect(src).toContain("v.releaseComment ?");
    expect(src).toContain("Комментарий:");
    expect(src).toContain("release-auto-summary-");
  });

  it("SpecEditor wires publish confirm modal", () => {
    const src = read("src/pages/admin/SpecEditorPage.jsx");
    expect(src).toContain("PublishVersionModal");
    expect(src).toContain("releaseComment");
  });
});
