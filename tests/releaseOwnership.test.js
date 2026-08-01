/**
 * T8 — a published version must belong to the project that points at it.
 * Cross-project pointers are refused on write and fail closed on read.
 * Temporary SQLite + temporary UPLOAD_ROOT only.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../backend/package.json"),
);
const express = require("express");

const testId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tempDir = path.join(os.tmpdir(), `daogreen-t8-${testId}`);
const tempUploads = path.join(tempDir, "uploads");

let db;
let loadProject;
let saveItems;
let createVersion;
let updateProject;
let clientRouter;
let loadVersionRow;
let loadPublishedReleaseSnapshot;
let getProjectReleaseInfo;
let listVersions;
let assertPublishedReleaseOwnership;
let versionBelongsToProject;
let describePublishedPointerIntegrity;
let findInvalidPublishedVersionPointers;
let getAssetReferenceSnapshot;
let buildPublishedExportProject;

const writeUpload = (rel, contents) => {
  const abs = path.join(tempUploads, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.from(contents));
  return `/uploads/${rel.replace(/\\/g, "/")}`;
};

const clientItem = (id) => ({
  id,
  materialId: "mat1",
  name: "Bolt",
  unit: "шт.",
  module: "general",
  section: "general",
  qty: 2,
  price: 100,
  supplier: "Sup",
  visibleToClient: true,
  includedInProject: true,
  enabled: true,
  approved: true,
  itemType: "material",
  status: "not_bought",
});

function seedProject(id, extras = {}) {
  db.prepare(`
    INSERT INTO projects (id, name, client, city, client_token, status, manual_params, rooms, currency, vat, version, comment, stellage_configs, revision)
    VALUES (?, 'Проект', 'Клиент', 'Город', ?, ?, '{}', '[]', '₽', 1, 0, '', '[]', 1)
  `).run(id, `tok-${id}`, extras.status || "active");
  saveItems(id, [clientItem(`it_${id}`)]);
}

function addDoc(projectId, fileId, name, contents) {
  const url = writeUpload(`docs/${projectId}-${name}`, contents);
  db.prepare("INSERT INTO files (id, project_id, type, filename, url) VALUES (?, ?, 'photo', ?, ?)")
    .run(fileId, projectId, name, url);
  return url;
}

/** Force a foreign pointer straight into the DB, bypassing every guard. */
function forcePointer(projectId, versionRow) {
  const row = db.prepare("SELECT manual_params FROM projects WHERE id = ?").get(projectId);
  const mp = JSON.parse(row.manual_params || "{}");
  mp.publishedRelease = versionRow
    ? {
        versionId: versionRow.id,
        versionNumber: versionRow.versionNumber ?? 1,
        publishedAt: "2026-01-01T00:00:00.000Z",
        workflowStatus: "",
      }
    : { versionId: "v_does_not_exist", versionNumber: 1, publishedAt: "", workflowStatus: "" };
  db.prepare("UPDATE projects SET manual_params = ? WHERE id = ?").run(JSON.stringify(mp), projectId);
}

function clientApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/client", clientRouter);
  return app;
}

function httpGet(urlPath, { raw = false } = {}) {
  const app = clientApp();
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
              /* keep raw */
            }
          }
          resolve({ status: res.statusCode, body });
        });
      });
      req.on("error", (e) => {
        server.close();
        reject(e);
      });
      req.end();
    });
  });
}

beforeAll(async () => {
  fs.mkdirSync(tempUploads, { recursive: true });
  process.env.DATABASE_PATH = path.join(tempDir, "t8.db");
  process.env.DB_PATH = process.env.DATABASE_PATH;
  process.env.UPLOAD_ROOT = tempUploads;
  process.env.NODE_ENV = "test";
  vi.resetModules();
  const dbMod = await import("../backend/src/db.js");
  const projectsMod = await import("../backend/src/routes/projects.js");
  const releaseMod = await import("../backend/src/services/publishedReleaseService.js");
  const inventoryMod = await import("../backend/src/services/storageInventoryService.js");
  const exportMod = await import("../src/lib/exportProjectContext.js");
  db = dbMod.db;
  loadProject = dbMod.loadProject;
  saveItems = projectsMod.saveItems;
  createVersion = projectsMod.createVersion;
  updateProject = projectsMod.updateProject;
  clientRouter = projectsMod.clientRouter;
  listVersions = projectsMod.listVersions;
  loadVersionRow = releaseMod.loadVersionRow;
  loadPublishedReleaseSnapshot = releaseMod.loadPublishedReleaseSnapshot;
  getProjectReleaseInfo = releaseMod.getProjectReleaseInfo;
  assertPublishedReleaseOwnership = releaseMod.assertPublishedReleaseOwnership;
  versionBelongsToProject = releaseMod.versionBelongsToProject;
  describePublishedPointerIntegrity = releaseMod.describePublishedPointerIntegrity;
  findInvalidPublishedVersionPointers = releaseMod.findInvalidPublishedVersionPointers;
  getAssetReferenceSnapshot = inventoryMod.getAssetReferenceSnapshot;
  buildPublishedExportProject = exportMod.buildPublishedExportProject;
  (await import("../backend/src/services/activityLog.js")).initActivityLog();
  dbMod.initDb();
});

beforeEach(() => {
  db.prepare("DELETE FROM spec_versions").run();
  db.prepare("DELETE FROM project_items").run();
  db.prepare("DELETE FROM files").run();
  db.prepare("DELETE FROM projects").run();
  db.prepare("DELETE FROM materials").run();
  db.prepare(`INSERT INTO materials (id, name, unit, category, base_price, module)
              VALUES ('mat1','Bolt','шт.','Каркас',10,'general')`).run();
  fs.rmSync(path.join(tempUploads, "releases"), { recursive: true, force: true });
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

/** Project A published normally + project B published normally. */
function seedTwoPublishedProjects() {
  seedProject("pA");
  seedProject("pB");
  addDoc("pA", "fa", "a.pdf", "AAA");
  addDoc("pB", "fb", "b.pdf", "BBB");
  const vA = createVersion("pA", "admin", { force: true });
  const vB = createVersion("pB", "admin", { force: true });
  return { vA, vB };
}

describe("T8 — published version ownership", () => {
  it("A. a same-project release serves normally", async () => {
    const { vA } = seedTwoPublishedProjects();
    const res = await httpGet("/api/client/p/tok-pA");
    expect(res.status).toBe(200);
    expect(res.body.project.items).toHaveLength(1);
    expect(res.body.documents.length).toBeGreaterThan(0);
    expect(loadPublishedReleaseSnapshot(loadProject("pA"))).toBeTruthy();
    expect(getProjectReleaseInfo(loadProject("pA")).publishedPointerIntegrity).toBeNull();
    expect(versionBelongsToProject("pA", vA.id)).toBe(true);
  });

  it("B. a cross-project pointer never yields the other project's release", async () => {
    const { vB } = seedTwoPublishedProjects();
    forcePointer("pA", vB);

    // Read side is scoped by project — no snapshot, no items, no documents.
    expect(loadPublishedReleaseSnapshot(loadProject("pA"))).toBeNull();
    const res = await httpGet("/api/client/p/tok-pA");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PUBLISHED_SNAPSHOT_MISSING");
    // Nothing about project B leaks.
    const text = JSON.stringify(res.body);
    expect(text).not.toContain("pB");
    expect(text).not.toContain(vB.id);
    expect(text).not.toContain("/uploads/");
  });

  it("C/D. cross-project file and image routes stay closed", async () => {
    const { vB } = seedTwoPublishedProjects();
    const snapB = JSON.parse(db.prepare("SELECT snapshot FROM spec_versions WHERE id = ?").get(vB.id).snapshot);
    const foreignDocId = snapB.documentManifest[0].id;
    forcePointer("pA", vB);

    const file = await httpGet(`/api/client/p/tok-pA/files/${foreignDocId}`, { raw: true });
    expect(file.status).not.toBe(200);
    expect(String(file.body)).not.toContain("BBB");

    const image = await httpGet("/api/client/p/tok-pA/images/whatever");
    expect(image.status).not.toBe(200);
  });

  it("E. a pointer at a non-existent version fails closed, with no live fallback", async () => {
    seedTwoPublishedProjects();
    forcePointer("pA", null);
    expect(loadPublishedReleaseSnapshot(loadProject("pA"))).toBeNull();
    const res = await httpGet("/api/client/p/tok-pA");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PUBLISHED_SNAPSHOT_MISSING");
  });

  it("F. updateProject refuses a foreign pointer atomically", () => {
    const { vA, vB } = seedTwoPublishedProjects();
    const before = loadProject("pA");
    const pointerBefore = before.manualParams.publishedRelease.versionId;
    expect(pointerBefore).toBe(vA.id);

    expect(() =>
      updateProject("pA", {
        expectedRevision: before.revision,
        name: "Переименован",
        manualParams: {
          publishedRelease: { versionId: vB.id, versionNumber: 1, publishedAt: "", workflowStatus: "" },
        },
      }),
    ).toThrow(/does not belong to this project/i);

    const after = loadProject("pA");
    expect(after.manualParams.publishedRelease.versionId).toBe(pointerBefore);
    expect(after.revision).toBe(before.revision);
    expect(after.name).toBe(before.name);
    expect(after.status).toBe(before.status);
  });

  it("G. publishing writes a pointer at the project's own new version", () => {
    seedProject("pA");
    addDoc("pA", "fa", "a.pdf", "AAA");
    const v = createVersion("pA", "admin", { force: true });
    const p = loadProject("pA");
    expect(p.manualParams.publishedRelease.versionId).toBe(v.id);
    expect(versionBelongsToProject("pA", v.id)).toBe(true);
    expect(describePublishedPointerIntegrity(p).status).toBe("VALID_SAME_PROJECT");
  });

  it("H/M. a direct service call with a foreign pair is refused", () => {
    const { vA, vB } = seedTwoPublishedProjects();
    expect(() =>
      assertPublishedReleaseOwnership("pA", { versionId: vB.id, versionNumber: 1 }),
    ).toThrow(/does not belong/i);
    expect(() => assertPublishedReleaseOwnership("pA", { versionId: vA.id })).not.toThrow();
    expect(() => assertPublishedReleaseOwnership("pA", { versionId: "v_nope" })).toThrow();
    expect(versionBelongsToProject("pA", vB.id)).toBe(false);
    // A null pointer is a legitimate "not published" state.
    expect(() => assertPublishedReleaseOwnership("pA", null)).not.toThrow();
  });

  it("J. release history of A never lists B's version", () => {
    const { vA, vB } = seedTwoPublishedProjects();
    forcePointer("pA", vB);
    const versions = listVersions("pA").map((v) => v.id);
    expect(versions).toEqual([vA.id]);
    expect(versions).not.toContain(vB.id);
    expect(loadVersionRow("pA", vB.id)).toBeNull();
  });

  it("K. published export of A cannot be built from B's snapshot", () => {
    const { vB } = seedTwoPublishedProjects();
    forcePointer("pA", vB);
    const project = loadProject("pA");
    const snapshot = loadPublishedReleaseSnapshot(project);
    expect(snapshot).toBeNull();
    const dto = buildPublishedExportProject(project, snapshot);
    expect(dto.items).toEqual([]);
    expect(dto.documentManifest).toEqual([]);
  });

  it("L. B's pinned asset is not a published reference of A", () => {
    const { vB } = seedTwoPublishedProjects();
    forcePointer("pA", vB);
    const snapB = JSON.parse(db.prepare("SELECT snapshot FROM spec_versions WHERE id = ?").get(vB.id).snapshot);
    const url = snapB.documentManifest[0].url;
    const refs = getAssetReferenceSnapshot(url).references;
    // Referenced by its real owner only.
    expect(refs.every((r) => r.projectId === "pB")).toBe(true);
    expect(refs.some((r) => r.projectId === "pA")).toBe(false);
  });

  it("N. one version id pointed at by two projects serves only its owner", async () => {
    const { vB } = seedTwoPublishedProjects();
    forcePointer("pA", vB);
    const owner = await httpGet("/api/client/p/tok-pB");
    expect(owner.status).toBe(200);
    expect(owner.body.project.items).toHaveLength(1);
    const impostor = await httpGet("/api/client/p/tok-pA");
    expect(impostor.status).toBe(403);
  });

  it("O. the client error carries no foreign identifiers, paths or tokens", async () => {
    const { vB } = seedTwoPublishedProjects();
    forcePointer("pA", vB);
    const res = await httpGet("/api/client/p/tok-pA");
    const text = JSON.stringify(res.body);
    expect(text).not.toContain("pB");
    expect(text).not.toContain(vB.id);
    expect(text).not.toContain("tok-");
    expect(text).not.toContain(tempUploads);
    expect(text).not.toMatch(/[A-Za-z]:\\/);
  });

  it("P. a valid pointer survives a reopened DB read", () => {
    seedProject("pA");
    addDoc("pA", "fa", "a.pdf", "AAA");
    const v = createVersion("pA", "admin", { force: true });
    const reread = loadProject("pA");
    expect(reread.manualParams.publishedRelease.versionId).toBe(v.id);
    expect(loadVersionRow("pA", v.id).projectId).toBe("pA");
    expect(describePublishedPointerIntegrity(reread).ok).toBe(true);
  });

  it("Q. a rejected ownership check leaves no partial project update", () => {
    const { vB } = seedTwoPublishedProjects();
    const before = loadProject("pA");
    expect(() =>
      updateProject("pA", {
        expectedRevision: before.revision,
        name: "Должно откатиться",
        comment: "тоже",
        manualParams: { publishedRelease: { versionId: vB.id, versionNumber: 1 } },
      }),
    ).toThrow();
    const after = loadProject("pA");
    expect(after.name).toBe(before.name);
    expect(after.comment).toBe(before.comment);
    expect(after.revision).toBe(before.revision);
    expect(after.manualParams.publishedRelease.versionId).toBe(before.manualParams.publishedRelease.versionId);
  });

  it("R. production-shape fixture is classified correctly by the integrity report", () => {
    // One healthy project, one archived project with a foreign pointer and no
    // versions of its own, one project with a missing pointer target.
    const { vB } = seedTwoPublishedProjects();
    seedProject("pArchived", { status: "archived" });
    forcePointer("pArchived", vB);
    seedProject("pMissing");
    forcePointer("pMissing", null);

    const invalid = findInvalidPublishedVersionPointers()
      .sort((a, b) => a.projectId.localeCompare(b.projectId));
    expect(invalid).toEqual([
      { projectId: "pArchived", versionId: vB.id, status: "CROSS_PROJECT_POINTER" },
      { projectId: "pMissing", versionId: "v_does_not_exist", status: "VERSION_MISSING" },
    ]);
    // The archived project owns nothing of its own — matching production.
    expect(listVersions("pArchived")).toEqual([]);
    // Admin sees a structured warning; clients see nothing.
    const info = getProjectReleaseInfo(loadProject("pArchived"));
    expect(info.publishedPointerIntegrity).toEqual({
      code: "PUBLISHED_RELEASE_PROJECT_MISMATCH",
      status: "CROSS_PROJECT_POINTER",
      projectId: "pArchived",
      versionId: vB.id,
    });
    expect(getProjectReleaseInfo(loadProject("pB")).publishedPointerIntegrity).toBeNull();
  });
});
