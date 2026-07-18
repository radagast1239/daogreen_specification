/**
 * P0 — Immutable client release + pinned assets / frame drawings.
 * Uses temporary SQLite + temporary uploads only.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";
import { buildReleaseSnapshotPayload, parseReleaseSnapshot } from "../shared/projectPublishedRelease.js";
import { clientExportHeader } from "../shared/publishedClientMeta.js";
import { publishedPlannedTotal } from "../shared/publishedPurchaseTotals.js";
import { projectForClientPdfExport, projectForClientExcelExport } from "../src/lib/clientExportProject.js";

const testId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tempDir = path.join(os.tmpdir(), `daogreen-immutable-p0-${testId}`);
const tempDbPath = path.join(tempDir, "daogreen-test.db");
const tempUploads = path.join(tempDir, "uploads");

let db;
let initDb;
let loadProject;
let saveItems;
let createVersion;
let updateProject;
let listVersions;
let loadVersionRow;
let loadPublishedReleaseSnapshot;
let buildClientProjectFromRelease;
let getClientProjectDocuments;
let resolveClientDocumentsForRelease;
let assertCanDeleteOrOverwriteAsset;
let isAssetPinnedByPublishedRelease;

function lockedUpdate(id, patch) {
  const revision = Number(db.prepare("SELECT revision FROM projects WHERE id = ?").get(id)?.revision) || 1;
  return updateProject(id, { ...patch, expectedRevision: revision });
}

function writeUpload(rel, contents = "x") {
  const abs = path.join(tempUploads, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.from(contents));
  return `/uploads/${rel.replace(/\\/g, "/")}`;
}

function sha(contents) {
  return createHash("sha256").update(Buffer.from(contents)).digest("hex");
}

function seedMaterial(id = "mat1") {
  db.prepare(`
    INSERT INTO materials (id, name, unit, category, base_price, module, supplier, link, photo_url, client_section, client_subsection)
    VALUES (?, 'Bolt', 'шт.', 'Каркас', 10, 'general', 'Sup', 'https://ex/a', 'https://ex/p', 'Каркас', 'Крепёж')
  `).run(id);
}

function clientItem(id, overrides = {}) {
  return {
    id,
    materialId: "mat1",
    name: overrides.name || "Bolt",
    unit: "шт.",
    module: "general",
    qty: overrides.qty ?? 2,
    price: overrides.price ?? 100,
    actualPrice: overrides.actualPrice ?? 90,
    supplier: "Sup",
    link: "https://ex/a",
    visibleToClient: true,
    includedInProject: true,
    enabled: true,
    approved: true,
    itemType: "material",
    status: overrides.status || "not_bought",
    clientComment: overrides.clientComment || "",
    clientSection: "Каркас",
    clientSubsection: "Крепёж",
    ...overrides,
  };
}

function seedProject(id = "p1", extras = {}) {
  db.prepare(`
    INSERT INTO projects (id, name, client, city, client_token, status, manual_params, rooms, currency, vat, version, comment)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    extras.name || "Header A",
    extras.client || "Client A",
    extras.city || "City A",
    `token-${id}`,
    extras.status || "active",
    JSON.stringify(extras.manualParams || {}),
    JSON.stringify(extras.rooms || []),
    extras.currency || "₽",
    extras.vat === false ? 0 : 1,
    extras.projectVersion || 0,
    extras.comment || "Comment A",
  );
  if (extras.items?.length) saveItems(id, extras.items);
}

beforeAll(async () => {
  fs.mkdirSync(tempUploads, { recursive: true });
  process.env.DATABASE_PATH = tempDbPath;
  process.env.DB_PATH = tempDbPath;
  process.env.UPLOAD_ROOT = tempUploads;
  process.env.NODE_ENV = "test";
  vi.resetModules();
  const dbMod = await import("../backend/src/db.js");
  const projectsMod = await import("../backend/src/routes/projects.js");
  const releaseMod = await import("../backend/src/services/publishedReleaseService.js");
  const retentionMod = await import("../backend/src/services/publishedAssetRetention.js");
  db = dbMod.db;
  initDb = dbMod.initDb;
  loadProject = dbMod.loadProject;
  saveItems = projectsMod.saveItems;
  createVersion = projectsMod.createVersion;
  updateProject = projectsMod.updateProject;
  listVersions = projectsMod.listVersions;
  getClientProjectDocuments = projectsMod.getClientProjectDocuments;
  loadVersionRow = releaseMod.loadVersionRow;
  loadPublishedReleaseSnapshot = releaseMod.loadPublishedReleaseSnapshot;
  buildClientProjectFromRelease = releaseMod.buildClientProjectFromRelease;
  resolveClientDocumentsForRelease = releaseMod.resolveClientDocumentsForRelease;
  assertCanDeleteOrOverwriteAsset = retentionMod.assertCanDeleteOrOverwriteAsset;
  isAssetPinnedByPublishedRelease = retentionMod.isAssetPinnedByPublishedRelease;
  initDb();
});

beforeEach(() => {
  db.prepare("DELETE FROM spec_versions").run();
  db.prepare("DELETE FROM project_items").run();
  db.prepare("DELETE FROM files").run();
  db.prepare("DELETE FROM frame_drawings").run();
  db.prepare("DELETE FROM materials").run();
  db.prepare("DELETE FROM projects").run();
  seedMaterial("mat1");
});

afterAll(() => {
  delete process.env.DATABASE_PATH;
  delete process.env.DB_PATH;
  delete process.env.UPLOAD_ROOT;
  vi.resetModules();
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("projectMeta freeze", () => {
  it("client DTO keeps published header after live rename", () => {
    seedProject("p1", { items: [clientItem("it1")] });
    createVersion("p1", "admin", { force: true });
    lockedUpdate("p1", {
      name: "Header B",
      client: "Client B",
      city: "City B",
      currency: "$",
      vat: false,
      comment: "Comment B",
    });
    const live = loadProject("p1");
    expect(live.name).toBe("Header B");
    const snap = loadPublishedReleaseSnapshot(live);
    const dto = buildClientProjectFromRelease(live, snap, { overlayLive: false });
    expect(dto.name).toBe("Header A");
    expect(dto.client).toBe("Client A");
    expect(dto.city).toBe("City A");
    expect(dto.currency).toBe("₽");
    expect(dto.vat).toBe(true);
    expect(dto.comment).toBe("Comment A");
    expect(clientExportHeader(dto).name).toBe("Header A");
    expect(projectForClientPdfExport(dto).name).toBe("Header A");
    expect(projectForClientExcelExport(dto).name).toBe("Header A");
  });

  it("republish updates header to live values", () => {
    seedProject("p1", { items: [clientItem("it1")] });
    createVersion("p1", "admin", { force: true });
    lockedUpdate("p1", { name: "Header B", client: "Client B", city: "City B" });
    createVersion("p1", "admin", { force: true });
    const live = loadProject("p1");
    const dto = buildClientProjectFromRelease(live, loadPublishedReleaseSnapshot(live), { overlayLive: false });
    expect(dto.name).toBe("Header B");
    expect(dto.client).toBe("Client B");
    expect(dto.city).toBe("City B");
  });
});

describe("live leak allowlist", () => {
  it("keeps commercial fields frozen and overlays purchase only", () => {
    seedProject("p1", { items: [clientItem("it1", { qty: 2, price: 100, status: "not_bought" })] });
    createVersion("p1", "admin", { force: true });
    saveItems("p1", [
      clientItem("it1", { qty: 99, price: 999, name: "LIVE", status: "bought", actualPrice: 50, clientComment: "ok" }),
      clientItem("it2", { qty: 1, price: 10, name: "NEW unpublished" }),
    ]);
    const live = loadProject("p1");
    const dto = buildClientProjectFromRelease(live, loadPublishedReleaseSnapshot(live), { overlayLive: true });
    expect(dto.items).toHaveLength(1);
    expect(dto.items[0]).toMatchObject({ id: "it1", qty: 2, price: 100, name: "Bolt", status: "bought", actualPrice: 50, clientComment: "ok" });
    expect(JSON.stringify(dto)).not.toContain("internalNote");
    expect(dto.items[0].materialId).toBeUndefined();
  });
});

describe("frame drawing pins", () => {
  it("pins drawing and ignores newer live drawing until republish", () => {
    const url1 = writeUpload("frame-drawings/p1/d1.pdf", "pdf-v1");
    seedProject("p1", { items: [clientItem("it1")] });
    db.prepare(`
      INSERT INTO frame_drawings (id, project_id, stellage_id, title, pdf_url, pdf_filename, file_id, is_client_visible, version, created_at, updated_at)
      VALUES ('d1', 'p1', 'st_a', 'Rack A v1', ?, 'd1.pdf', 'f1', 1, 1, datetime('now'), datetime('now'))
    `).run(url1);
    db.prepare("INSERT INTO files (id, project_id, type, filename, url) VALUES ('f1', 'p1', 'frame_drawing', 'd1.pdf', ?)").run(url1);

    createVersion("p1", "admin", { force: true });
    const snap1 = loadPublishedReleaseSnapshot(loadProject("p1"));
    expect(snap1.assetsPinned).toBe(true);
    expect(snap1.pinnedFrameDrawings[0]).toMatchObject({ drawingId: "d1", drawingVersion: 1, contentHash: sha("pdf-v1") });

    const url2 = writeUpload("frame-drawings/p1/d2.pdf", "pdf-v2");
    db.prepare(`
      INSERT INTO frame_drawings (id, project_id, stellage_id, title, pdf_url, pdf_filename, file_id, is_client_visible, version, created_at, updated_at)
      VALUES ('d2', 'p1', 'st_a', 'Rack A v2', ?, 'd2.pdf', 'f2', 1, 2, datetime('now'), datetime('now'))
    `).run(url2);
    db.prepare("INSERT INTO files (id, project_id, type, filename, url) VALUES ('f2', 'p1', 'frame_drawing', 'd2.pdf', ?)").run(url2);

    const live = loadProject("p1");
    const latest = getClientProjectDocuments("p1");
    expect(latest.find((d) => d.type === "frame_drawing").url).toBe(url2);

    const pinnedDocs = resolveClientDocumentsForRelease("p1", snap1);
    expect(pinnedDocs.find((d) => d.type === "frame_drawing").url).toBe(url1);
    expect(pinnedDocs.find((d) => d.type === "frame_drawing").drawingVersion).toBe(1);

    createVersion("p1", "admin", { force: true });
    const snap2 = loadPublishedReleaseSnapshot(loadProject("p1"));
    expect(snap2.pinnedFrameDrawings[0].drawingId).toBe("d2");
    expect(snap2.pinnedFrameDrawings[0].url).toBe(url2);
  });

  it("blocks delete of pinned drawing PDF and keeps file on disk", () => {
    const url1 = writeUpload("frame-drawings/p1/pin.pdf", "keep-me");
    seedProject("p1", { items: [clientItem("it1")] });
    db.prepare(`
      INSERT INTO frame_drawings (id, project_id, stellage_id, title, pdf_url, pdf_filename, file_id, is_client_visible, version, created_at, updated_at)
      VALUES ('pin1', 'p1', 'st_a', 'Pinned', ?, 'pin.pdf', 'fp1', 1, 1, datetime('now'), datetime('now'))
    `).run(url1);
    db.prepare("INSERT INTO files (id, project_id, type, filename, url) VALUES ('fp1', 'p1', 'frame_drawing', 'pin.pdf', ?)").run(url1);
    createVersion("p1", "admin", { force: true });
    expect(isAssetPinnedByPublishedRelease({ url: url1, drawingId: "pin1" })).toBe(true);
    expect(() => assertCanDeleteOrOverwriteAsset({ url: url1, drawingId: "pin1" })).toThrow(/закреплён/);
    expect(fs.existsSync(path.join(tempUploads, "frame-drawings/p1/pin.pdf"))).toBe(true);
  });

  it("legacy release without pins uses latest fallback", () => {
    seedProject("p1", { items: [clientItem("it1")] });
    const legacySnap = {
      schema: "release_v2",
      assetsPinned: false,
      projectMeta: { name: "L", client: "C", city: "X", currency: "₽", vat: true },
      items: [clientItem("it1")],
      imageManifest: { projectSchemes: [], rackImages: [] },
      coolingRooms: [],
      farmPower: { devices: [] },
      pinnedFrameDrawings: [],
    };
    const docs = resolveClientDocumentsForRelease("p1", parseReleaseSnapshot(legacySnap));
    expect(docs).toBeNull();
  });
});

describe("image contentHash and missing binary", () => {
  it("stores contentHash matching binary and blocks publish when file missing", () => {
    const url = writeUpload("scheme-a.png", "scheme-bytes");
    seedProject("p1", {
      items: [clientItem("it1")],
      manualParams: {
        projectSchemes: [{ id: "s1", title: "S", url, mimeType: "image/png", clientVisible: true, sortOrder: 0 }],
      },
    });
    createVersion("p1", "admin", { force: true });
    const snap = loadPublishedReleaseSnapshot(loadProject("p1"));
    expect(snap.imageManifest.projectSchemes[0].contentHash).toBe(sha("scheme-bytes"));

    lockedUpdate("p1", {
      manualParams: {
        projectSchemes: [{ id: "s2", title: "Missing", url: "/uploads/nope.png", clientVisible: true }],
      },
    });
    const beforeVersions = listVersions("p1").length;
    const beforePointer = loadProject("p1").manualParams.publishedRelease.versionId;
    const beforeRevision = loadProject("p1").revision;
    expect(() => createVersion("p1", "admin", { force: true })).toThrow(/Не найдены файлы/);
    expect(listVersions("p1")).toHaveLength(beforeVersions);
    expect(loadProject("p1").manualParams.publishedRelease.versionId).toBe(beforePointer);
    expect(loadProject("p1").revision).toBe(beforeRevision);
  });

  it("hidden images are excluded from manifest", () => {
    const url = writeUpload("hidden.png", "h");
    const payload = buildReleaseSnapshotPayload({
      id: "p1",
      name: "P",
      manualParams: {
        projectSchemes: [
          { id: "vis", title: "V", url, clientVisible: true },
          { id: "hid", title: "H", url, clientVisible: false },
        ],
      },
    }, [clientItem("it1")]);
    // pure payload without hash enrichment still filters visibility
    expect(payload.imageManifest.projectSchemes.map((x) => x.id)).toEqual(["vis"]);
  });
});

describe("exports and totals", () => {
  it("planned totals stay snapshot-based while purchase overlay can change actuals", () => {
    seedProject("p1", { items: [clientItem("it1", { qty: 2, price: 100, vatRate: 0 })] });
    createVersion("p1", "admin", { force: true });
    const snap = loadPublishedReleaseSnapshot(loadProject("p1"));
    expect(publishedPlannedTotal(snap.items)).toBe(200);
    saveItems("p1", [clientItem("it1", { qty: 2, price: 100, status: "bought", actualPrice: 40, vatRate: 0 })]);
    const dto = buildClientProjectFromRelease(loadProject("p1"), snap, { overlayLive: true });
    expect(publishedPlannedTotal(dto.items.map((it) => ({ ...it, price: 100, qty: 2 })))).toBe(200);
    expect(dto.items[0].actualPrice).toBe(40);
    expect(projectForClientPdfExport(dto).name).toBe("Header A");
  });
});

describe("compatibility", () => {
  it("reads legacy items[] and release_v2", () => {
    const legacy = parseReleaseSnapshot([clientItem("it1")]);
    expect(legacy.schema).toBe("legacy_items_array");
    expect(legacy.assetsPinned).toBe(false);
    const v2 = parseReleaseSnapshot({
      schema: "release_v2",
      projectMeta: { name: "N", client: "C", currency: "₽", vat: false },
      items: [clientItem("it1")],
    });
    expect(v2.schema).toBe("release_v2");
    expect(v2.assetsPinned).toBe(false);
    const dto = buildClientProjectFromRelease(
      { id: "p1", name: "LIVE", client: "LIVE", currency: "₽", vat: true, items: [], manualParams: {} },
      v2,
      { overlayLive: false },
    );
    expect(dto.name).toBe("N");
  });

  it("keeps admin version history readable", () => {
    seedProject("p1", { items: [clientItem("it1", { qty: 1 })] });
    const v1 = createVersion("p1", "admin", { force: true });
    saveItems("p1", [clientItem("it1", { qty: 5 })]);
    createVersion("p1", "admin", { force: true });
    const old = loadVersionRow("p1", v1.id);
    expect(JSON.parse(old.snapshot).items[0].qty).toBe(1);
    expect(listVersions("p1")).toHaveLength(2);
  });
});
