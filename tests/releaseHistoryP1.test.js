/**
 * P1 — Historical release list, preview, diff, export, security.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { createHash } from "crypto";
import { diffReleaseSnapshots } from "../shared/releaseHistoryDiff.js";
import { clientExportHeader } from "../shared/publishedClientMeta.js";
import { projectForClientPdfExport, projectForClientExcelExport } from "../src/lib/clientExportProject.js";
import {
  buildReleaseSnapshotPayload,
  RELEASE_SCHEMA_V3,
  RELEASE_SCHEMA_V4,
} from "../shared/projectPublishedRelease.js";

const require = createRequire(import.meta.url);
const express = require("../backend/node_modules/express");

const testId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tempDir = path.join(os.tmpdir(), `daogreen-history-p1-${testId}`);
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
let loadPublishedReleaseSnapshot;
let adminAuthMiddleware;
let projectsApi;

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

beforeAll(async () => {
  fs.mkdirSync(tempUploads, { recursive: true });
  process.env.DATABASE_PATH = tempDbPath;
  process.env.DB_PATH = tempDbPath;
  process.env.UPLOAD_ROOT = tempUploads;
  process.env.ADMIN_KEY = "history-p1-test-key";
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
  loadPublishedReleaseSnapshot = releaseMod.loadPublishedReleaseSnapshot;
  adminAuthMiddleware = authMod.adminAuthMiddleware;
  projectsApi = projectsMod.default;
  initDb();
});

beforeEach(() => {
  process.env.UPLOAD_ROOT = tempUploads;
  process.env.ADMIN_KEY = "history-p1-test-key";
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

describe("version list summaries", () => {
  it("returns project versions newest first with current badge and snapshot summary", () => {
    const url = writeUpload("s.png", "scheme-v1");
    seedProject("p1", "Header A", "tok-p1", url);
    createVersion("p1", "admin", { force: true });
    lockedUpdate("p1", { name: "Header B", client: "Client B" });
    saveItems("p1", [item("it1", { qty: 3, price: 100 })]);
    const url2 = writeUpload("s2.png", "scheme-v2");
    lockedUpdate("p1", {
      manualParams: {
        projectSchemes: [{ id: "s2", title: "S2", url: url2, clientVisible: true }],
        farmPower: { devices: [{ id: "p", name: "Pump", normalKw: 2, peakKw: 3 }], tariffPerKwh: 5, daysPerMonth: 30 },
      },
    });
    createVersion("p1", "admin", { force: true });

    const list = listVersions("p1");
    expect(list.length).toBe(2);
    expect(list[0].versionNumber).toBe(2);
    expect(list[1].versionNumber).toBe(1);
    expect(list[0].isCurrentPublished).toBe(true);
    expect(list[1].isCurrentPublished).toBe(false);
    expect(list[1].projectName).toBe("Header A");
    expect(list[0].projectName).toBe("Header B");
    expect(list[1].plannedTotal).toBe(200);
    expect(list[0].plannedTotal).toBe(300);
    // live rename after list should not affect stored summary fields
    lockedUpdate("p1", { name: "LIVE NAME" });
    const again = listVersions("p1");
    expect(again[0].projectName).toBe("Header B");
    expect(again[1].projectName).toBe("Header A");
  });

  it("does not return versions of another project", () => {
    const url = writeUpload("a.png", "a");
    seedProject("p1", "P1", "tok1", url, "it_p1");
    seedProject("p2", "P2", "tok2", url, "it_p2");
    createVersion("p1", "admin", { force: true });
    createVersion("p2", "admin", { force: true });
    const list = listVersions("p1");
    expect(list.every((v) => v.projectId === "p1")).toBe(true);
    expect(listVersions("p2").every((v) => v.projectId === "p2")).toBe(true);
  });
});

describe("historical preview", () => {
  it("opens release_v3 and ignores live edits and purchase overlay", () => {
    const url = writeUpload("h.png", "hash-a");
    seedProject("p1", "Header A", "tok-h", url);
    const v1 = createVersion("p1", "admin", { force: true });
    lockedUpdate("p1", {
      name: "Header LIVE",
      client: "Client LIVE",
      currency: "$",
      vat: false,
    });
    saveItems("p1", [item("it1", { qty: 9, price: 999, status: "bought", actualPrice: 1, clientComment: "live" })]);

    const preview = buildHistoricalClientPreview("p1", v1.id, loadProject("p1"));
    expect(preview.historical).toBe(true);
    expect(preview.project.historicalMode).toBe(true);
    expect(preview.project.name).toBe("Header A");
    expect(preview.project.client).toBe("Client A");
    expect(preview.project.currency).toBe("₽");
    expect(preview.project.items[0].qty).toBe(2);
    expect(preview.project.items[0].price).toBe(100);
    expect(preview.project.items[0].status).toBe("not_bought");
    expect(preview.schema).toBe(RELEASE_SCHEMA_V4);
    expect(preview.assetsPinned).toBe(true);
    expect(preview.project.readOnly).toBe(true);
    expect(Object.keys(preview.project).some((k) => /password|tokenSecret|absPath/i.test(k))).toBe(false);
  });

  it("returns null for version of another project (IDOR)", () => {
    const url = writeUpload("x.png", "x");
    seedProject("p1", "P1", "t1", url, "it_idor1");
    seedProject("p2", "P2", "t2", url, "it_idor2");
    const v1 = createVersion("p1", "admin", { force: true });
    expect(buildHistoricalClientPreview("p2", v1.id, loadProject("p2"))).toBeNull();
  });

  it("marks legacy snapshot with compatibility warning and does not invent pinned drawings", () => {
    db.prepare(`
      INSERT INTO projects (id, name, client, city, client_token, status, manual_params, currency, vat)
      VALUES ('p1', 'Legacy', 'C', 'City', 'tok-l', 'active', '{}', '₽', 1)
    `).run();
    saveItems("p1", [item("it1")]);
    // Insert legacy items-array snapshot manually
    db.prepare(`
      INSERT INTO spec_versions (id, project_id, version_number, created_by, summary, snapshot)
      VALUES ('v_legacy', 'p1', 1, 'admin', '{}', ?)
    `).run(JSON.stringify([item("it1")]));
    const preview = buildHistoricalClientPreview("p1", "v_legacy", loadProject("p1"));
    expect(preview.project.historicalCompatibility.isLegacy).toBe(true);
    expect(preview.project.historicalCompatibility.warnings.some((w) => w.code === "FRAME_DRAWINGS_NOT_PINNED")).toBe(true);
    expect(preview.project.pinnedFrameDrawings).toEqual([]);
  });
});

describe("historical PDF/Excel headers", () => {
  it("export builders keep selected version header after live rename", () => {
    const url = writeUpload("e.png", "e");
    seedProject("p1", "Header A", "tok-e", url);
    const v1 = createVersion("p1", "admin", { force: true });
    lockedUpdate("p1", { name: "Header B", client: "Client B", currency: "$" });
    const preview = buildHistoricalClientPreview("p1", v1.id, loadProject("p1"));
    expect(clientExportHeader(preview.project).name).toBe("Header A");
    expect(projectForClientPdfExport(preview.project).name).toBe("Header A");
    expect(projectForClientExcelExport(preview.project).client).toBe("Client A");
    // current published pointer moved? still v1 until republish — pointer is v1
    const live = loadProject("p1");
    expect(live.manualParams.publishedRelease.versionId).toBe(v1.id);
    // even if we republish later, historical v1 stays A
    createVersion("p1", "admin", { force: true });
    const again = buildHistoricalClientPreview("p1", v1.id, loadProject("p1"));
    expect(clientExportHeader(again.project).name).toBe("Header A");
  });
});

describe("release history diff", () => {
  it("diffs meta, items by id, totals, cooling, farmPower, images, drawings; order-insensitive", () => {
    const snapA = buildReleaseSnapshotPayload(
      {
        id: "p1",
        name: "A",
        client: "CA",
        city: "CityA",
        currency: "₽",
        vat: true,
        comment: "c1",
        rooms: [{ id: "r1", name: "R1", cooling: { params: { length: 1, width: 1, height: 1, shelves: 1, tiers: 1, safetyFactor: 1 }, recommendedKw: 1 }, acUnits: [] }],
        manualParams: { farmPower: { devices: [{ id: "d1", name: "D1", normalKw: 1, peakKw: 1 }], tariffPerKwh: 5, daysPerMonth: 30 } },
      },
      [item("it1", { qty: 2, price: 100 }), item("it2", { qty: 1, price: 50, name: "Dup" })],
      {
        schema: RELEASE_SCHEMA_V3,
        assetsPinned: true,
        imageManifest: {
          projectSchemes: [{ id: "s1", title: "S1", url: "/uploads/a.png", contentHash: "h1", order: 1, clientVisible: true }],
          rackImages: [],
        },
        pinnedFrameDrawings: [{ drawingId: "dA", drawingVersion: 1, targetKey: "st_a", title: "DA", url: "/uploads/a.pdf", contentHash: "pd1" }],
      },
    );
    const snapB = buildReleaseSnapshotPayload(
      {
        id: "p1",
        name: "B",
        client: "CB",
        city: "CityB",
        currency: "$",
        vat: false,
        comment: "c2",
        rooms: [
          { id: "r1", name: "R1", cooling: { params: { length: 2, width: 2, height: 2, shelves: 1, tiers: 1, safetyFactor: 1 }, recommendedKw: 9 }, acUnits: [] },
          { id: "r2", name: "R2", cooling: { params: { length: 1, width: 1, height: 1, shelves: 1, tiers: 1, safetyFactor: 1 }, recommendedKw: 2 }, acUnits: [] },
        ],
        manualParams: { farmPower: { devices: [{ id: "d1", name: "D1", normalKw: 2, peakKw: 2 }], tariffPerKwh: 9, daysPerMonth: 30 } },
      },
      // reverse order — must not create false remove/add of same ids
      [item("it2", { qty: 1, price: 50, name: "Dup" }), item("it1", { qty: 5, price: 110, name: "Bolt X", link: "https://ex/b" }), item("it3", { qty: 1, price: 10, name: "New" })],
      {
        schema: RELEASE_SCHEMA_V3,
        assetsPinned: true,
        imageManifest: {
          projectSchemes: [{ id: "s1", title: "S1b", url: "/uploads/b.png", contentHash: "h2", order: 2, clientVisible: true }],
          rackImages: [],
        },
        pinnedFrameDrawings: [{ drawingId: "dB", drawingVersion: 2, targetKey: "st_a", title: "DB", url: "/uploads/b.pdf", contentHash: "pd2" }],
      },
    );

    const diff = diffReleaseSnapshots(snapA, snapB);
    expect(diff.projectMeta.some((c) => c.field === "name" && c.from === "A" && c.to === "B")).toBe(true);
    expect(diff.items.added.some((i) => i.id === "it3")).toBe(true);
    expect(diff.items.removed.length).toBe(0);
    expect(diff.items.changed.some((i) => i.id === "it1" && i.changes.some((c) => c.field === "qty"))).toBe(true);
    expect(diff.items.changed.some((i) => i.id === "it1" && i.changes.some((c) => c.field === "price"))).toBe(true);
    expect(diff.totals.from).toBe(250);
    expect(diff.totals.to).toBe(5 * 110 + 50 + 10);
    expect(diff.cooling.roomsAdded).toContain("r2");
    expect(diff.cooling.powerChanged).toBe(true);
    expect(diff.farmPower.tariffChanged).toBe(true);
    expect(diff.images.changed.some((i) => i.changes.some((c) => c.field === "binary"))).toBe(true);
    expect(diff.drawings.replaced.some((d) => d.from.drawingId === "dA" && d.to.drawingId === "dB")).toBe(true);

    // order-insensitive: same content different array order → no false item churn
    const sameOrderFlipped = diffReleaseSnapshots(snapB, {
      ...snapB,
      items: [...snapB.items].reverse(),
    });
    expect(sameOrderFlipped.items.added).toEqual([]);
    expect(sameOrderFlipped.items.removed).toEqual([]);
  });

  it("compares duplicate material rows by item id", () => {
    const a = {
      schema: RELEASE_SCHEMA_V3,
      assetsPinned: true,
      projectMeta: { name: "P", currency: "₽" },
      items: [item("dup1", { qty: 1 }), item("dup2", { qty: 2 })],
      imageManifest: { projectSchemes: [], rackImages: [] },
      coolingRooms: [],
      farmPower: { devices: [] },
      pinnedFrameDrawings: [],
    };
    const b = {
      ...a,
      items: [item("dup1", { qty: 1 }), item("dup2", { qty: 9 })],
    };
    const diff = diffReleaseSnapshots(a, b);
    expect(diff.items.changed).toHaveLength(1);
    expect(diff.items.changed[0].id).toBe("dup2");
    expect(diff.items.added).toEqual([]);
    expect(diff.items.removed).toEqual([]);
  });
});

describe("HTTP security for history endpoints", () => {
  async function withApp(run) {
    const app = express();
    app.use(express.json());
    app.use("/api/projects", (req, res, next) => adminAuthMiddleware(req, res, next), projectsApi);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const { port } = server.address();
    try {
      await run(port);
    } finally {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  }

  it("requires admin auth and blocks cross-project version access", async () => {
    const url = writeUpload("sec.png", "sec");
    seedProject("p1", "P1", "ts1", url, "it_sec1");
    seedProject("p2", "P2", "ts2", url, "it_sec2");
    const v1 = createVersion("p1", "admin", { force: true });

    await withApp(async (port) => {
      const base = `http://127.0.0.1:${port}`;
      const noAuth = await fetch(`${base}/api/projects/p1/versions`);
      expect(noAuth.status).toBe(401);

      const idor = await fetch(`${base}/api/projects/p2/versions/${v1.id}/client-preview`, {
        headers: { "x-admin-key": "history-p1-test-key" },
      });
      expect(idor.status).toBe(404);

      const ok = await fetch(`${base}/api/projects/p1/versions/${v1.id}/client-preview`, {
        headers: { "x-admin-key": "history-p1-test-key" },
      });
      const okText = await ok.text();
      if (ok.status !== 200) throw new Error(`preview ${ok.status} ${okText}`);
      const body = JSON.parse(okText);
      expect(body.historical).toBe(true);
      expect(body.project.name).toBe("P1");

      const excel = await fetch(`${base}/api/projects/p1/versions/${v1.id}/excel`, {
        headers: { "x-admin-key": "history-p1-test-key" },
      });
      expect(excel.status).toBe(200);
      expect(excel.headers.get("content-type")).toMatch(/spreadsheetml/);
    });
  });
});
