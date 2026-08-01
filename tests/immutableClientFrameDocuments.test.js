/**
 * T4 — frame documents on a published client link are immutable.
 * A published link resolves documents from the release documentManifest only;
 * live frame_drawings are read at publish time and never afterwards.
 * Temporary SQLite + temporary UPLOAD_ROOT only.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { parseReleaseSnapshot } from "../shared/projectPublishedRelease.js";
import { collectPinnedAssetUrlsFromSnapshot } from "../shared/publishedAssetPin.js";

const require = createRequire(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../backend/package.json"),
);
const express = require("express");

const testId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tempDir = path.join(os.tmpdir(), `daogreen-t4-frame-docs-${testId}`);
const tempDbPath = path.join(tempDir, "daogreen-test.db");
const tempUploads = path.join(tempDir, "uploads");

let db;
let initDb;
let loadProject;
let saveItems;
let createVersion;
let clientRouter;
let loadVersionRow;
let loadPublishedReleaseSnapshot;
let resolveClientDocumentsForRelease;
let isAssetPinnedByPublishedRelease;
let getAssetReferenceSnapshot;

function writeUpload(rel, contents) {
  const abs = path.join(tempUploads, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.from(contents));
  return `/uploads/${rel.replace(/\\/g, "/")}`;
}

function absFromUploadUrl(url) {
  return path.join(tempUploads, String(url).replace(/^\/uploads\//, ""));
}

function seedMaterial(id = "mat1") {
  db.prepare(`
    INSERT INTO materials (id, name, unit, category, base_price, module, supplier, link, photo_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, "Bolt", "шт.", "Каркас", 10, "general", "Sup", "https://ex/a", "/uploads/m.jpg");
}

function clientItem(id = "it1") {
  return {
    id,
    materialId: "mat1",
    name: "Bolt",
    unit: "шт.",
    module: "general",
    qty: 2,
    price: 100,
    supplier: "Sup",
    visibleToClient: true,
    includedInProject: true,
    enabled: true,
    approved: true,
    itemType: "material",
    status: "not_bought",
  };
}

function seedProject(id = "p1", extras = {}) {
  db.prepare(`
    INSERT INTO projects (id, name, client, city, client_token, status, manual_params, rooms, currency, vat, version, comment, stellage_configs, revision)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    "Project A",
    "Client A",
    "City A",
    `token-${id}`,
    "active",
    JSON.stringify({}),
    JSON.stringify([]),
    "₽",
    1,
    0,
    "",
    JSON.stringify(extras.stellageConfigs || []),
    1,
  );
  saveItems(id, [clientItem()]);
}

function insertFile(projectId, { id, type = "frame_drawing", filename, url }) {
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
  stellageId = "st_a",
}) {
  db.prepare(`
    INSERT INTO frame_drawings (
      id, project_id, stellage_id, module_rack_key, source_type, title,
      pdf_url, pdf_filename, file_id, is_client_visible
    ) VALUES (?, ?, ?, '', 'project', ?, ?, ?, ?, ?)
  `).run(id, projectId, stellageId, title, pdfUrl, path.basename(pdfUrl), fileId, isClientVisible ? 1 : 0);
}

/** Publish a frame drawing as a live client-visible document. */
function addLiveFrameDrawing({ projectId = "p1", fileId, drawingId, filename, contents, visible = 1 }) {
  const url = writeUpload(`frame-drawings/${projectId}/${filename}`, contents);
  insertFile(projectId, { id: fileId, filename, url });
  insertFrameDrawing({ id: drawingId, projectId, fileId, title: "Rack A", pdfUrl: url, isClientVisible: visible });
  return url;
}

function clientApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/client", clientRouter);
  return app;
}

function httpReq(app, urlPath, { raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const req = http.request({ hostname: "127.0.0.1", port, path: urlPath, method: "GET" }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          server.close();
          let body = buf.toString("utf8");
          if (!raw) {
            try {
              body = body ? JSON.parse(body) : null;
            } catch {
              /* keep raw string */
            }
          }
          resolve({ status: res.statusCode, headers: res.headers, body });
        });
      });
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
      req.end();
    });
  });
}

const clientDocs = (token) => httpReq(clientApp(), `/api/client/p/${token}`);
const clientFile = (token, assetId) =>
  httpReq(clientApp(), `/api/client/p/${token}/files/${assetId}`, { raw: true });

function snapshotOf(projectId, versionId) {
  return parseReleaseSnapshot(JSON.parse(loadVersionRow(projectId, versionId).snapshot));
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
  const inventoryMod = await import("../backend/src/services/storageInventoryService.js");
  db = dbMod.db;
  initDb = dbMod.initDb;
  loadProject = dbMod.loadProject;
  saveItems = projectsMod.saveItems;
  createVersion = projectsMod.createVersion;
  clientRouter = projectsMod.clientRouter;
  loadVersionRow = releaseMod.loadVersionRow;
  loadPublishedReleaseSnapshot = releaseMod.loadPublishedReleaseSnapshot;
  resolveClientDocumentsForRelease = releaseMod.resolveClientDocumentsForRelease;
  isAssetPinnedByPublishedRelease = retentionMod.isAssetPinnedByPublishedRelease;
  getAssetReferenceSnapshot = inventoryMod.getAssetReferenceSnapshot;
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

describe("T4 — immutable frame documents on a published client link", () => {
  it("A. frozen document survives live PDF replacement; a new release picks up B", async () => {
    seedProject("p1");
    addLiveFrameDrawing({ fileId: "fA", drawingId: "drA", filename: "a.pdf", contents: "AAA" });
    const v1 = createVersion("p1", "admin", { force: true });

    const before = await clientDocs("token-p1");
    const frameDocs = before.body.documents.filter((d) => d.type === "frame_drawing");
    expect(frameDocs).toHaveLength(1);
    const assetId = frameDocs[0].id;
    expect((await clientFile("token-p1", assetId)).body).toBe("AAA");

    // Live replacement without publishing: same drawing id, new PDF bytes.
    const urlB = writeUpload("frame-drawings/p1/b.pdf", "BBB");
    db.prepare("UPDATE files SET url = ?, filename = ? WHERE id = ?").run(urlB, "b.pdf", "fA");
    db.prepare("UPDATE frame_drawings SET pdf_url = ?, pdf_filename = ? WHERE id = ?").run(urlB, "b.pdf", "drA");

    const after = await clientDocs("token-p1");
    expect(after.body.documents.filter((d) => d.type === "frame_drawing")).toHaveLength(1);
    expect((await clientFile("token-p1", assetId)).body).toBe("AAA");

    // Publishing again freezes the new state.
    const v2 = createVersion("p1", "admin", { force: true });
    const republished = await clientDocs("token-p1");
    const newAssetId = republished.body.documents.filter((d) => d.type === "frame_drawing")[0].id;
    expect((await clientFile("token-p1", newAssetId)).body).toBe("BBB");
    // The v1 snapshot itself still resolves to the A bytes.
    const v1Doc = resolveClientDocumentsForRelease(snapshotOf("p1", v1.id))[0];
    expect(fs.readFileSync(absFromUploadUrl(v1Doc.url), "utf8")).toBe("AAA");
    expect(v2.id).not.toBe(v1.id);
  });

  it("B. frozen document survives live deletion, hiding and supersede", async () => {
    seedProject("p1");
    const liveUrl = addLiveFrameDrawing({
      fileId: "fA", drawingId: "drA", filename: "a.pdf", contents: "AAA",
    });
    createVersion("p1", "admin", { force: true });
    const assetId = (await clientDocs("token-p1")).body.documents
      .filter((d) => d.type === "frame_drawing")[0].id;

    // Supersede + hide + delete every live trace, including the source PDF.
    db.prepare("UPDATE frame_drawings SET is_client_visible = 0 WHERE id = ?").run("drA");
    db.prepare("DELETE FROM frame_drawings WHERE id = ?").run("drA");
    db.prepare("DELETE FROM files WHERE id = ?").run("fA");
    fs.rmSync(absFromUploadUrl(liveUrl), { force: true });

    const res = await clientDocs("token-p1");
    expect(res.body.documents.filter((d) => d.type === "frame_drawing")).toHaveLength(1);
    expect((await clientFile("token-p1", assetId)).body).toBe("AAA");
  });

  it("C. a release published without frame documents never gains one from live data", async () => {
    seedProject("p1");
    createVersion("p1", "admin", { force: true });
    expect((await clientDocs("token-p1")).body.documents
      .filter((d) => d.type === "frame_drawing")).toHaveLength(0);

    addLiveFrameDrawing({ fileId: "fLate", drawingId: "drLate", filename: "late.pdf", contents: "LATE" });

    const res = await clientDocs("token-p1");
    expect(res.body.documents.filter((d) => d.type === "frame_drawing")).toHaveLength(0);
    // And the live asset id is not reachable through the release file route.
    expect((await clientFile("token-p1", "fLate")).status).toBe(404);
  });

  it("D. client visibility is frozen at publish time", async () => {
    seedProject("p1");
    addLiveFrameDrawing({ fileId: "fA", drawingId: "drA", filename: "a.pdf", contents: "AAA" });
    createVersion("p1", "admin", { force: true });
    expect((await clientDocs("token-p1")).body.documents
      .filter((d) => d.type === "frame_drawing")).toHaveLength(1);

    db.prepare("UPDATE frame_drawings SET is_client_visible = 0 WHERE id = ?").run("drA");
    expect((await clientDocs("token-p1")).body.documents
      .filter((d) => d.type === "frame_drawing")).toHaveLength(1);

    createVersion("p1", "admin", { force: true });
    expect((await clientDocs("token-p1")).body.documents
      .filter((d) => d.type === "frame_drawing")).toHaveLength(0);
  });

  it("E. the frozen asset counts as a pinned reference and is not an orphan", () => {
    seedProject("p1");
    addLiveFrameDrawing({ fileId: "fA", drawingId: "drA", filename: "a.pdf", contents: "AAA" });
    const v1 = createVersion("p1", "admin", { force: true });
    const snap = snapshotOf("p1", v1.id);
    const pinnedUrl = snap.documentManifest.find((d) => d.type === "frame_drawing").url;

    expect(collectPinnedAssetUrlsFromSnapshot(snap)).toContain(pinnedUrl);
    expect(isAssetPinnedByPublishedRelease({ url: pinnedUrl })).toBe(true);

    const snapshotRefs = getAssetReferenceSnapshot(pinnedUrl);
    expect(snapshotRefs.references.some((r) => r.field === "documentManifest")).toBe(true);
    expect(snapshotRefs.pinnedReferenceCount).toBeGreaterThan(0);
    expect(snapshotRefs.status).not.toBe("orphan");
  });

  it("F. frozen document is served by token route only and never leaks its uploads path", async () => {
    seedProject("p1");
    addLiveFrameDrawing({ fileId: "fA", drawingId: "drA", filename: "a.pdf", contents: "AAA" });
    const v1 = createVersion("p1", "admin", { force: true });
    const doc = (await clientDocs("token-p1")).body.documents
      .filter((d) => d.type === "frame_drawing")[0];

    // DTO exposes a token-scoped accessUrl, never the internal /uploads path.
    expect(doc.url).toBeUndefined();
    expect(doc.accessUrl).toBe(`/api/client/p/token-p1/files/${doc.id}`);
    expect(JSON.stringify(doc)).not.toContain("/uploads/");

    const ok = await clientFile("token-p1", doc.id);
    expect(ok.status).toBe(200);
    expect(ok.body).toBe("AAA");
    // The pinned copy lives under the release folder, not the live drawing tree.
    const pinnedUrl = snapshotOf("p1", v1.id).documentManifest
      .find((d) => d.type === "frame_drawing").url;
    expect(pinnedUrl.startsWith("/uploads/releases/p1/")).toBe(true);

    // Wrong / missing token must not reach the asset.
    expect((await clientFile("token-nope", doc.id)).status).toBe(404);
    expect((await httpReq(clientApp(), "/api/client/p//files/x")).status).toBe(404);

    // A manifest entry pointing at the live drawing tree must not be served:
    // the release route resolves pinned release files only.
    const raw = JSON.parse(loadVersionRow("p1", v1.id).snapshot);
    raw.documentManifest = raw.documentManifest.map((d) => (
      d.type === "frame_drawing" ? { ...d, url: "/uploads/frame-drawings/p1/a.pdf" } : d
    ));
    db.prepare("UPDATE spec_versions SET snapshot = ? WHERE id = ?").run(JSON.stringify(raw), v1.id);
    expect((await clientFile("token-p1", doc.id)).status).toBe(404);
  });

  it("G. legacy incomplete snapshots expose no documents and never fall back to live", async () => {
    seedProject("p1");
    addLiveFrameDrawing({ fileId: "fA", drawingId: "drA", filename: "a.pdf", contents: "AAA" });
    const v1 = createVersion("p1", "admin", { force: true });

    // Rewrite the stored snapshot as a legacy items-array release (v1 format).
    const parsedNow = snapshotOf("p1", v1.id);
    db.prepare("UPDATE spec_versions SET snapshot = ? WHERE id = ?")
      .run(JSON.stringify(parsedNow.items), v1.id);

    const legacySnapshot = loadPublishedReleaseSnapshot(loadProject("p1"));
    expect(resolveClientDocumentsForRelease(legacySnapshot)).toEqual([]);

    const res = await clientDocs("token-p1");
    expect(res.body.documents).toEqual([]);
    expect((await clientFile("token-p1", "fA")).status).toBe(404);
  });
});
