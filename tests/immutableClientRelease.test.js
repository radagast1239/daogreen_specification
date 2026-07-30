/**
 * Phase 4 — Immutable client release (release_v4).
 * Temporary SQLite + temporary UPLOAD_ROOT only.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import {
  buildReleaseSnapshotPayload,
  isLegacyReleaseIncomplete,
  parseReleaseSnapshot,
  RELEASE_SCHEMA_V4,
} from "../shared/projectPublishedRelease.js";
import { enrichProjectItemFromMaterial } from "../shared/frameBomProjectItems.js";
import { projectForClientPdfExport, projectForClientExcelExport } from "../src/lib/clientExportProject.js";

const require = createRequire(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../backend/package.json"),
);
const express = require("express");

const testId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tempDir = path.join(os.tmpdir(), `daogreen-immutable-v4-${testId}`);
const tempDbPath = path.join(tempDir, "daogreen-test.db");
const tempUploads = path.join(tempDir, "uploads");

let db;
let initDb;
let loadProject;
let saveItems;
let createVersion;
let updateProject;
let patchItem;
let loadVersionRow;
let loadPublishedReleaseSnapshot;
let buildClientProjectFromRelease;
let resolveClientDocumentsForRelease;
let getProjectReleaseInfo;
let getClientProjectDocuments;
let clientRouter;
let prepareClientMutationItemResponse;

function writeUpload(rel, contents = "x") {
  const abs = path.join(tempUploads, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.from(contents));
  return `/uploads/${rel.replace(/\\/g, "/")}`;
}

function seedMaterial(id = "mat1", overrides = {}) {
  db.prepare(`
    INSERT INTO materials (id, name, unit, category, base_price, module, supplier, link, photo_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.name || "Bolt",
    overrides.unit || "шт.",
    overrides.category || "Каркас",
    overrides.basePrice ?? 10,
    overrides.module || "general",
    overrides.supplier || "Sup",
    overrides.link || "https://ex/a",
    overrides.photoUrl || "/uploads/m.jpg",
  );
}

function clientItem(id, overrides = {}) {
  return {
    id,
    materialId: overrides.materialId || "mat1",
    name: overrides.name || "Bolt",
    unit: "шт.",
    module: "general",
    qty: overrides.qty ?? 2,
    price: overrides.price ?? 100,
    actualPrice: overrides.actualPrice ?? 90,
    supplier: overrides.supplier || "Sup",
    link: overrides.link || "https://ex/a",
    visibleToClient: true,
    includedInProject: true,
    enabled: true,
    approved: true,
    itemType: "material",
    status: overrides.status || "not_bought",
    clientComment: overrides.clientComment || "",
    ...overrides,
  };
}

function seedProject(id = "p1", extras = {}) {
  db.prepare(`
    INSERT INTO projects (id, name, client, city, client_token, status, manual_params, rooms, currency, vat, version, comment, stellage_configs, revision)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    JSON.stringify(extras.stellageConfigs || []),
    extras.revision ?? 1,
  );
  if (extras.items?.length) saveItems(id, extras.items);
}

function insertFile(projectId, { id, type = "photo", filename, url }) {
  db.prepare(
    "INSERT INTO files (id, project_id, type, filename, url) VALUES (?, ?, ?, ?, ?)",
  ).run(id, projectId, type, filename, url);
}

function insertFrameDrawing({
  id,
  projectId,
  fileId,
  title,
  pdfUrl,
  isClientVisible = 1,
  stellageId = "",
  moduleRackKey = "",
}) {
  db.prepare(`
    INSERT INTO frame_drawings (
      id, project_id, stellage_id, module_rack_key, source_type, title,
      pdf_url, pdf_filename, file_id, is_client_visible
    ) VALUES (?, ?, ?, ?, 'project', ?, ?, ?, ?, ?)
  `).run(
    id,
    projectId,
    stellageId,
    moduleRackKey,
    title,
    pdfUrl,
    path.basename(pdfUrl),
    fileId,
    isClientVisible ? 1 : 0,
  );
}

function httpJson(app, method, urlPath, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const payload = body != null ? JSON.stringify(body) : null;
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: urlPath,
          method,
          headers: {
            "Content-Type": "application/json",
            ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
            ...(headers || {}),
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            let json = null;
            try {
              json = raw ? JSON.parse(raw) : null;
            } catch {
              json = raw;
            }
            server.close();
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: json,
            });
          });
        },
      );
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
      if (payload) req.write(payload);
      req.end();
    });
  });
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
  db = dbMod.db;
  initDb = dbMod.initDb;
  loadProject = dbMod.loadProject;
  saveItems = projectsMod.saveItems;
  createVersion = projectsMod.createVersion;
  updateProject = projectsMod.updateProject;
  patchItem = projectsMod.patchItem;
  getClientProjectDocuments = projectsMod.getClientProjectDocuments;
  clientRouter = projectsMod.clientRouter;
  loadVersionRow = releaseMod.loadVersionRow;
  loadPublishedReleaseSnapshot = releaseMod.loadPublishedReleaseSnapshot;
  buildClientProjectFromRelease = releaseMod.buildClientProjectFromRelease;
  resolveClientDocumentsForRelease = releaseMod.resolveClientDocumentsForRelease;
  getProjectReleaseInfo = releaseMod.getProjectReleaseInfo;
  prepareClientMutationItemResponse = releaseMod.prepareClientMutationItemResponse;
  const activityMod = await import("../backend/src/services/activityLog.js");
  activityMod.initActivityLog();
  initDb();
});

beforeEach(() => {
  db.prepare("DELETE FROM spec_versions").run();
  db.prepare("DELETE FROM project_items").run();
  db.prepare("DELETE FROM frame_drawings").run();
  db.prepare("DELETE FROM files").run();
  db.prepare("DELETE FROM materials").run();
  db.prepare("DELETE FROM projects").run();
  seedMaterial("mat1");
});

afterAll(() => {
  delete process.env.DATABASE_PATH;
  delete process.env.DB_PATH;
  delete process.env.UPLOAD_ROOT;
  vi.resetModules();
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("release_v4 schema", () => {
  it("new publish writes release_v4 with stellageCounts + documentManifest", () => {
    seedProject("p1", {
      items: [clientItem("it1")],
      stellageConfigs: [{ id: "r1", name: "Rack A", moduleName: "Mod", count: 3 }],
    });
    const version = createVersion("p1", "admin", { force: true });
    const parsed = parseReleaseSnapshot(JSON.parse(loadVersionRow("p1", version.id).snapshot));
    expect(parsed.schema).toBe(RELEASE_SCHEMA_V4);
    expect(parsed.stellageCounts).toEqual([
      { id: "r1", name: "Rack A", moduleName: "Mod", count: 3 },
    ]);
    expect(parsed.projectMeta.stellageCounts).toEqual(parsed.stellageCounts);
    expect(Array.isArray(parsed.documentManifest)).toBe(true);
    expect(isLegacyReleaseIncomplete(parsed)).toBe(false);
  });
});

describe("stellageCounts freeze", () => {
  it("client DTO keeps published rack counts after live edit; republish updates", () => {
    seedProject("p1", {
      items: [clientItem("it1")],
      stellageConfigs: [{ id: "r1", name: "Rack A", moduleName: "M", count: 2 }],
    });
    createVersion("p1", "admin", { force: true });
    updateProject("p1", {
      expectedRevision: loadProject("p1").revision,
      stellageConfigs: [{ id: "r1", name: "Rack A", moduleName: "M", count: 9 }],
    });
    const live = loadProject("p1");
    expect(live.stellageConfigs[0].count).toBe(9);
    const dto = buildClientProjectFromRelease(live, loadPublishedReleaseSnapshot(live), {
      overlayLive: false,
    });
    expect(dto.stellageCounts[0].count).toBe(2);
    expect(dto.stellageConfigs).toBeUndefined();
    expect(projectForClientPdfExport(dto).stellageConfigs[0].count).toBe(2);
    expect(projectForClientExcelExport(dto).stellageCounts[0].count).toBe(2);

    createVersion("p1", "admin", { force: true });
    const dto2 = buildClientProjectFromRelease(
      loadProject("p1"),
      loadPublishedReleaseSnapshot(loadProject("p1")),
      { overlayLive: false },
    );
    expect(dto2.stellageCounts[0].count).toBe(9);
  });
});

describe("document pinning", () => {
  it("pins docs; old release keeps A; new sees A+B; rename/delete live does not break pinned", () => {
    const urlA = writeUpload("docs/a.pdf", "AAA");
    seedProject("p1", { items: [clientItem("it1")] });
    insertFile("p1", { id: "fA", type: "photo", filename: "a.pdf", url: urlA });
    const v1 = createVersion("p1", "admin", { force: true });
    const snap1 = parseReleaseSnapshot(JSON.parse(loadVersionRow("p1", v1.id).snapshot));
    expect(snap1.documentManifest).toHaveLength(1);
    expect(snap1.documentManifest[0].url).toContain(`/uploads/releases/p1/${v1.id}/`);
    const pinnedA = path.join(tempUploads, snap1.documentManifest[0].url.replace(/^\/uploads\//, ""));
    expect(fs.existsSync(pinnedA)).toBe(true);
    expect(fs.readFileSync(pinnedA, "utf8")).toBe("AAA");

    const urlB = writeUpload("docs/b.pdf", "BBB");
    insertFile("p1", { id: "fB", type: "photo", filename: "b.pdf", url: urlB });
    // rename live A
    db.prepare("UPDATE files SET filename = ? WHERE id = ?").run("renamed-a.pdf", "fA");
    const v2 = createVersion("p1", "admin", { force: true });
    const snap2 = parseReleaseSnapshot(JSON.parse(loadVersionRow("p1", v2.id).snapshot));
    expect(snap2.documentManifest.map((d) => d.sourceFileId).sort()).toEqual(["fA", "fB"]);

    // delete live A row — old pinned file still readable
    db.prepare("DELETE FROM files WHERE id = ?").run("fA");
    expect(fs.existsSync(pinnedA)).toBe(true);
    expect(resolveClientDocumentsForRelease(snap1)).toHaveLength(1);
    expect(resolveClientDocumentsForRelease(snap1)[0].url).toBe(snap1.documentManifest[0].url);

    // other project docs never in manifest
    seedProject("p2", { items: [clientItem("it2")] });
    const urlOther = writeUpload("docs/other.pdf", "OTHER");
    insertFile("p2", { id: "fOther", type: "photo", filename: "other.pdf", url: urlOther });
    const liveDocs = getClientProjectDocuments("p1");
    expect(liveDocs.some((d) => d.id === "fOther")).toBe(false);
  });

  it("hidden frame_drawing not in manifest", () => {
    const urlVis = writeUpload("draw/vis.pdf", "VIS");
    const urlHid = writeUpload("draw/hid.pdf", "HID");
    seedProject("p1", { items: [clientItem("it1")] });
    insertFile("p1", { id: "fdVis", type: "frame_drawing", filename: "vis.pdf", url: urlVis });
    insertFile("p1", { id: "fdHid", type: "frame_drawing", filename: "hid.pdf", url: urlHid });
    insertFrameDrawing({
      id: "drVis",
      projectId: "p1",
      fileId: "fdVis",
      title: "Visible",
      pdfUrl: urlVis,
      isClientVisible: 1,
    });
    insertFrameDrawing({
      id: "drHid",
      projectId: "p1",
      fileId: "fdHid",
      title: "Hidden",
      pdfUrl: urlHid,
      isClientVisible: 0,
    });
    const v = createVersion("p1", "admin", { force: true });
    const snap = parseReleaseSnapshot(JSON.parse(loadVersionRow("p1", v.id).snapshot));
    expect(snap.documentManifest.map((d) => d.sourceFileId)).toEqual(["fdVis"]);
  });
});

describe("catalog enrich & price 0", () => {
  it("material catalog change does not affect client DTO; status patch keeps engineering", () => {
    seedProject("p1", {
      items: [clientItem("it1", { price: 0, qty: 2, supplier: "Sup", name: "Bolt" })],
    });
    createVersion("p1", "admin", { force: true });
    db.prepare("UPDATE materials SET supplier = ?, base_price = ?, name = ? WHERE id = ?").run(
      "NEW",
      777,
      "CHANGED",
      "mat1",
    );
    const live = loadProject("p1");
    const dto = buildClientProjectFromRelease(live, loadPublishedReleaseSnapshot(live), {
      overlayLive: true,
    });
    expect(dto.items[0].supplier).toBe("Sup");
    expect(dto.items[0].name).toBe("Bolt");
    expect(dto.items[0].price).toBe(0);

    const updated = patchItem("p1", "it1", { status: "bought", actualPrice: 5, clientComment: "ok" });
    const snapItem = loadPublishedReleaseSnapshot(loadProject("p1")).items[0];
    const resp = prepareClientMutationItemResponse(snapItem, updated);
    expect(resp.price).toBe(0);
    expect(resp.supplier).toBe("Sup");
    expect(resp.name).toBe("Bolt");
    expect(resp.status).toBe("bought");
    expect(resp.actualPrice).toBe(5);
    expect(resp.clientComment).toBe("ok");
    expect(resp.qty).toBe(2);
  });

  it("enrichProjectItemFromMaterial keeps explicit price 0", () => {
    const enriched = enrichProjectItemFromMaterial(
      { materialId: "mat1", price: 0, name: "X", qty: 1 },
      [{ id: "mat1", name: "Cat", price: 50, basePrice: 50, supplier: "C", link: "L", unit: "шт." }],
    );
    expect(enriched.price).toBe(0);
  });
});

describe("purchase overlays", () => {
  it("overlays status/actualPrice/comment only; qty/price/supplier stay from snapshot", () => {
    seedProject("p1", {
      items: [clientItem("it1", { qty: 2, price: 100, status: "not_bought" })],
    });
    createVersion("p1", "admin", { force: true });
    saveItems("p1", [
      clientItem("it1", {
        qty: 99,
        price: 999,
        name: "LIVE",
        supplier: "LIVE-SUP",
        status: "bought",
        actualPrice: 50,
        clientComment: "note",
      }),
    ]);
    const dto = buildClientProjectFromRelease(
      loadProject("p1"),
      loadPublishedReleaseSnapshot(loadProject("p1")),
      { overlayLive: true },
    );
    expect(dto.items).toHaveLength(1);
    expect(dto.items[0].qty).toBe(2);
    expect(dto.items[0].price).toBe(100);
    expect(dto.items[0].name).toBe("Bolt");
    expect(dto.items[0].supplier).toBe("Sup");
    expect(dto.items[0].status).toBe("bought");
    expect(dto.items[0].actualPrice).toBe(50);
    expect(dto.items[0].clientComment).toBe("note");
  });
});

describe("client cooling forbidden", () => {
  it("PATCH cooling returns 403 without writing DB or bumping revision; admin still works", async () => {
    seedProject("p1", {
      items: [clientItem("it1")],
      manualParams: { coolingFarm: { safetyFactor: 1.3 } },
      revision: 3,
    });
    createVersion("p1", "admin", { force: true });
    const before = loadProject("p1");
    expect(before.manualParams.coolingFarm.safetyFactor).toBe(1.3);
    expect(Number(before.revision)).toBe(3);

    const app = express();
    app.use(express.json());
    app.use("/api/client", clientRouter);
    const res = await httpJson(app, "PATCH", "/api/client/p/token-p1/cooling", {
      body: { safetyFactor: 2.0 },
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CLIENT_ENGINEERING_MUTATION_FORBIDDEN");
    const after = loadProject("p1");
    expect(after.manualParams.coolingFarm.safetyFactor).toBe(1.3);
    expect(Number(after.revision)).toBe(3);

    updateProject("p1", {
      expectedRevision: after.revision,
      manualParams: { ...after.manualParams, coolingFarm: { safetyFactor: 1.8 } },
    });
    expect(loadProject("p1").manualParams.coolingFarm.safetyFactor).toBe(1.8);
  });
});

describe("legacy incomplete", () => {
  it("legacy release loads with empty racks/docs and legacyReleaseIncomplete; GET does not mutate", () => {
    seedProject("p1", {
      items: [clientItem("it1")],
      stellageConfigs: [{ id: "r1", name: "Live", count: 5 }],
    });
    const legacySnap = {
      schema: "release_v1",
      projectMeta: { id: "p1", name: "Header A", currency: "₽", vat: true },
      items: [clientItem("it1")],
    };
    const versionId = "v-legacy";
    db.prepare(`
      INSERT INTO spec_versions (id, project_id, version_number, created_by, summary, snapshot)
      VALUES (?, 'p1', 1, 'admin', '{}', ?)
    `).run(versionId, JSON.stringify(legacySnap));
    db.prepare("UPDATE projects SET manual_params = ?, version = 1 WHERE id = ?").run(
      JSON.stringify({
        publishedRelease: { versionId, versionNumber: 1, publishedAt: "2020-01-01" },
      }),
      "p1",
    );
    insertFile("p1", {
      id: "liveDoc",
      type: "photo",
      filename: "live.pdf",
      url: writeUpload("docs/live.pdf", "LIVE"),
    });

    const live = loadProject("p1");
    const parsed = loadPublishedReleaseSnapshot(live);
    expect(isLegacyReleaseIncomplete(parsed)).toBe(true);
    const dto = buildClientProjectFromRelease(live, parsed, { overlayLive: true });
    expect(dto.legacyReleaseIncomplete).toBe(true);
    expect(dto.stellageCounts).toEqual([]);
    expect(resolveClientDocumentsForRelease(parsed)).toEqual([]);
    const info = getProjectReleaseInfo(live);
    expect(info.legacyReleaseIncomplete).toBe(true);
    expect(info.needsRepublish).toBe(true);

    const beforeItems = JSON.stringify(loadProject("p1").items);
    buildClientProjectFromRelease(loadProject("p1"), parsed, { overlayLive: true });
    expect(JSON.stringify(loadProject("p1").items)).toBe(beforeItems);
  });
});

describe("client GET headers + documents", () => {
  it("sets Cache-Control private, no-store and serves snapshot documents", async () => {
    const urlA = writeUpload("docs/a.pdf", "AAA");
    seedProject("p1", { items: [clientItem("it1")] });
    insertFile("p1", { id: "fA", type: "photo", filename: "a.pdf", url: urlA });
    createVersion("p1", "admin", { force: true });

    const app = express();
    app.use(express.json());
    app.use("/api/client", clientRouter);
    const res = await httpJson(app, "GET", "/api/client/p/token-p1");
    expect(res.status).toBe(200);
    expect(String(res.headers["cache-control"] || "")).toMatch(/private/i);
    expect(String(res.headers["cache-control"] || "")).toMatch(/no-store/i);
    expect(res.body.documents).toHaveLength(1);
    expect(res.body.documents[0].url).toBeUndefined();
    expect(res.body.documents[0].accessUrl).toContain("/api/client/p/token-p1/files/");
    expect(res.body.documents[0].accessUrl).toContain(res.body.documents[0].id);
    expect(res.body.project.stellageCounts).toEqual([]);
    expect(res.body.project.legacyReleaseIncomplete).toBe(false);
    expect(res.body.project.items[0].price).toBe(100);
  });
});

describe("pure payload helpers", () => {
  it("buildReleaseSnapshotPayload defaults to release_v4", () => {
    const payload = buildReleaseSnapshotPayload(
      {
        id: "p1",
        name: "P",
        stellageConfigs: [{ id: "r1", name: "R", count: 2 }],
      },
      [clientItem("it1")],
      { documentManifest: [] },
    );
    expect(payload.schema).toBe(RELEASE_SCHEMA_V4);
    expect(payload.stellageCounts[0].count).toBe(2);
    expect(payload.documentManifest).toEqual([]);
  });
});
