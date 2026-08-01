/**
 * T7 — release assets copied during a publication attempt must not survive a
 * rolled-back publication, and must never touch anything the attempt did not
 * create. Temporary SQLite + temporary UPLOAD_ROOT only.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const testId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tempDir = path.join(os.tmpdir(), `daogreen-t7-${testId}`);
const tempUploads = path.join(tempDir, "uploads");
const releasesRoot = () => path.join(tempUploads, "releases");

let db;
let loadProject;
let saveItems;
let createVersion;
let updateProject;
let pinClientDocumentsForRelease;
let beginPublicationAssetScope;
let isInsideReleasesRoot;
let openPublicationScopeCount;

const writeUpload = (rel, contents) => {
  const abs = path.join(tempUploads, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.from(contents));
  return `/uploads/${rel.replace(/\\/g, "/")}`;
};

const listReleaseFiles = () => {
  const root = releasesRoot();
  if (!fs.existsSync(root)) return [];
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else out.push(path.relative(root, abs).split(path.sep).join("/"));
    }
  };
  walk(root);
  return out.sort();
};

const clientItem = (id = "it1") => ({
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

function seedProject(id) {
  db.prepare(`
    INSERT INTO projects (id, name, client, city, client_token, status, manual_params, rooms, currency, vat, version, comment, stellage_configs, revision)
    VALUES (?, 'P', '', '', ?, 'active', '{}', '[]', '₽', 1, 0, '', '[]', 1)
  `).run(id, `tok-${id}`);
  // project_items.id is globally unique — scope the fixture id per project.
  saveItems(id, [clientItem(`it_${id}`)]);
}

function addDoc(projectId, fileId, name, contents) {
  const url = writeUpload(`docs/${projectId}-${name}`, contents);
  db.prepare("INSERT INTO files (id, project_id, type, filename, url) VALUES (?, ?, 'photo', ?, ?)")
    .run(fileId, projectId, name, url);
  return url;
}

beforeAll(async () => {
  fs.mkdirSync(tempUploads, { recursive: true });
  process.env.DATABASE_PATH = path.join(tempDir, "t7.db");
  process.env.DB_PATH = process.env.DATABASE_PATH;
  process.env.UPLOAD_ROOT = tempUploads;
  process.env.NODE_ENV = "test";
  vi.resetModules();
  const dbMod = await import("../backend/src/db.js");
  const projectsMod = await import("../backend/src/routes/projects.js");
  const pinMod = await import("../backend/src/services/releaseDocumentPinning.js");
  const stageMod = await import("../backend/src/services/publicationAssetStage.js");
  db = dbMod.db;
  loadProject = dbMod.loadProject;
  saveItems = projectsMod.saveItems;
  createVersion = projectsMod.createVersion;
  updateProject = projectsMod.updateProject;
  pinClientDocumentsForRelease = pinMod.pinClientDocumentsForRelease;
  beginPublicationAssetScope = stageMod.beginPublicationAssetScope;
  isInsideReleasesRoot = stageMod.isInsideReleasesRoot;
  openPublicationScopeCount = stageMod.openPublicationScopeCount;
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
  fs.rmSync(releasesRoot(), { recursive: true, force: true });
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

describe("T7 — publication asset lifecycle", () => {
  it("A. a successful publication leaves the version and its assets in place", () => {
    seedProject("p1");
    addDoc("p1", "fA", "a.pdf", "AAA");
    const v = createVersion("p1", "admin", { force: true });
    const files = listReleaseFiles();
    expect(files).toHaveLength(1);
    expect(files[0].startsWith(`p1/${v.id}/`)).toBe(true);

    const snap = JSON.parse(db.prepare("SELECT snapshot FROM spec_versions WHERE id = ?").get(v.id).snapshot);
    expect(snap.documentManifest).toHaveLength(1);
    const abs = path.join(tempUploads, snap.documentManifest[0].url.replace(/^\/uploads\//, ""));
    expect(fs.readFileSync(abs, "utf8")).toBe("AAA");
    // No leftover staging directories.
    expect(files.some((f) => f.includes(".staging"))).toBe(false);
    expect(openPublicationScopeCount()).toBe(0);
  });

  it("wiring: both publication transaction boundaries own a compensating scope", () => {
    const routes = fs.readFileSync(
      path.join(process.cwd(), "backend/src/routes/projects.js"), "utf8",
    );
    // mutateWithRevision (createVersion path) and updateProject (publish-on-status).
    expect(routes.match(/beginPublicationAssetScope\(\)/g) || []).toHaveLength(2);
    expect(routes.match(/assets\.rollback\(\)/g) || []).toHaveLength(2);
    expect(routes.match(/assets\.commit\(\)/g) || []).toHaveLength(2);
    const pinning = fs.readFileSync(
      path.join(process.cwd(), "backend/src/services/releaseDocumentPinning.js"), "utf8",
    );
    expect(pinning).toMatch(/recordStagedDir\(releaseDir\)/);
    expect(pinning).toMatch(/recordStagedFile\(destAbs\)/);
    expect(pinning).toMatch(/RELEASE_ASSET_DIR_EXISTS/);
    // Scopes must never leak between requests.
    expect(openPublicationScopeCount()).toBe(0);
  });

  it("B. a failure raised before any copy leaves no version and no files", () => {
    seedProject("p1");
    addDoc("p1", "fA", "a.pdf", "AAA");
    addDoc("p1", "fB", "b.pdf", "BBB");
    const before = loadProject("p1");

    // updateProject publishes on status change; a stale revision aborts the txn.
    expect(() =>
      updateProject("p1", { expectedRevision: before.revision + 7, status: "ready_to_send" }),
    ).toThrow();

    expect(listReleaseFiles()).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) c FROM spec_versions").get().c).toBe(0);
    expect(loadProject("p1").revision).toBe(before.revision);
    expect(openPublicationScopeCount()).toBe(0);
  });

  it("D. rollback removes files and the attempt directory, and is idempotent", () => {
    seedProject("p1");
    addDoc("p1", "fA", "a.pdf", "AAA");
    addDoc("p1", "fB", "b.pdf", "BBB");
    const scope = beginPublicationAssetScope();
    pinClientDocumentsForRelease({
      projectId: "p1",
      versionId: "v_attempt",
      liveDocuments: [
        { id: "fA", filename: "a.pdf", url: "/uploads/docs/p1-a.pdf" },
        { id: "fB", filename: "b.pdf", url: "/uploads/docs/p1-b.pdf" },
      ],
      uploadRoot: tempUploads,
    });
    expect(scope.stagedFileCount).toBe(2);
    expect(listReleaseFiles()).toHaveLength(2);

    const first = scope.rollback();
    expect(first.removedFiles).toBe(2);
    expect(first.failures).toEqual([]);
    expect(listReleaseFiles()).toEqual([]);
    expect(fs.existsSync(path.join(releasesRoot(), "p1", "v_attempt"))).toBe(false);
    // Idempotent: a second rollback is a no-op, not an error.
    expect(scope.rollback()).toBeNull();
    // The live source documents are untouched.
    expect(fs.existsSync(path.join(tempUploads, "docs", "p1-a.pdf"))).toBe(true);
  });

  it("D2. commit keeps the files and closes the scope", () => {
    seedProject("p1");
    addDoc("p1", "fA", "a.pdf", "AAA");
    const scope = beginPublicationAssetScope();
    pinClientDocumentsForRelease({
      projectId: "p1",
      versionId: "v_kept",
      liveDocuments: [{ id: "fA", filename: "a.pdf", url: "/uploads/docs/p1-a.pdf" }],
      uploadRoot: tempUploads,
    });
    expect(scope.commit()).toEqual({ committed: true, files: 1 });
    expect(listReleaseFiles()).toHaveLength(1);
    // After commit a rollback must not delete the now-published files.
    expect(scope.rollback()).toBeNull();
    expect(listReleaseFiles()).toHaveLength(1);
    expect(openPublicationScopeCount()).toBe(0);
  });

  it("C/E. a mid-publication failure keeps earlier releases and drops only the new attempt", () => {
    seedProject("p1");
    addDoc("p1", "fA", "a.pdf", "AAA");
    const good = createVersion("p1", "admin", { force: true });
    const keptFiles = listReleaseFiles();
    expect(keptFiles).toHaveLength(1);

    // Second attempt: documents are copied, then the publication fails before
    // the version row is written. The scope is the compensating boundary.
    addDoc("p1", "fB", "b.pdf", "BBB");
    const scope = beginPublicationAssetScope();
    const attemptVersionId = "v_failed_attempt";
    const { documentManifest } = pinClientDocumentsForRelease({
      projectId: "p1",
      versionId: attemptVersionId,
      liveDocuments: [
        { id: "fA", filename: "a.pdf", url: "/uploads/docs/p1-a.pdf" },
        { id: "fB", filename: "b.pdf", url: "/uploads/docs/p1-b.pdf" },
      ],
      uploadRoot: tempUploads,
    });
    expect(documentManifest.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(releasesRoot(), "p1", attemptVersionId))).toBe(true);

    scope.rollback();

    // The failed attempt left nothing; the earlier release survives untouched.
    expect(fs.existsSync(path.join(releasesRoot(), "p1", attemptVersionId))).toBe(false);
    expect(listReleaseFiles()).toEqual(keptFiles);
    expect(fs.existsSync(path.join(releasesRoot(), "p1", good.id))).toBe(true);
    const versions = db.prepare("SELECT id FROM spec_versions").all().map((r) => r.id);
    expect(versions).toEqual([good.id]);
  });

  it("G. a cleanup failure surfaces the original error and reports the remaining path", () => {
    const scope = beginPublicationAssetScope();
    const dir = path.join(releasesRoot(), "p9", "v9");
    fs.mkdirSync(dir, { recursive: true });
    const missing = path.join(dir, "gone.pdf");
    const real = path.join(dir, "kept.pdf");
    fs.writeFileSync(real, "X");
    // A path outside the release root can never be removed by rollback.
    const outside = path.join(tempUploads, "outside.pdf");
    fs.writeFileSync(outside, "OUT");

    expect(scope.stagedPaths()).toEqual([]);
    // Rollback may only ever act inside the release root.
    expect(isInsideReleasesRoot(real)).toBe(true);
    expect(isInsideReleasesRoot(outside)).toBe(false);
    expect(isInsideReleasesRoot(missing)).toBe(true);
    expect(isInsideReleasesRoot(releasesRoot())).toBe(false);
    scope.rollback();
    // The guard refused the outside file; it is still there.
    expect(fs.existsSync(outside)).toBe(true);
  });

  it("H. an existing version directory is never merged or overwritten", () => {
    seedProject("p1");
    addDoc("p1", "fA", "a.pdf", "AAA");
    const dir = path.join(releasesRoot(), "p1", "v_fixed");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "existing.pdf"), "OLD");

    expect(() =>
      pinClientDocumentsForRelease({
        projectId: "p1",
        versionId: "v_fixed",
        liveDocuments: [{ id: "fA", filename: "a.pdf", url: "/uploads/docs/p1-a.pdf" }],
        uploadRoot: tempUploads,
      }),
    ).toThrow(/already exists/);

    expect(fs.readFileSync(path.join(dir, "existing.pdf"), "utf8")).toBe("OLD");
    expect(fs.readdirSync(dir)).toEqual(["existing.pdf"]);
  });

  it("I/J. a failed attempt in one project never touches another project or an older version", () => {
    seedProject("p1");
    seedProject("p2");
    addDoc("p1", "fA1", "a.pdf", "A1");
    addDoc("p2", "fA2", "a.pdf", "A2");
    const v1 = createVersion("p1", "admin", { force: true });
    const v2 = createVersion("p2", "admin", { force: true });
    const baseline = listReleaseFiles();
    expect(baseline).toHaveLength(2);

    const before = loadProject("p1");
    expect(() =>
      updateProject("p1", { expectedRevision: before.revision + 9, status: "ready_to_send" }),
    ).toThrow();

    expect(listReleaseFiles()).toEqual(baseline);
    expect(fs.existsSync(path.join(releasesRoot(), "p1", v1.id))).toBe(true);
    expect(fs.existsSync(path.join(releasesRoot(), "p2", v2.id))).toBe(true);
  });

  it("K. containment refuses traversal, absolute and out-of-root paths", () => {
    const root = releasesRoot();
    fs.mkdirSync(path.join(root, "p1", "v1"), { recursive: true });
    expect(isInsideReleasesRoot(path.join(root, "p1", "v1", "ok.pdf"))).toBe(true);
    // Root itself and a bare project directory are not removable targets.
    expect(isInsideReleasesRoot(root)).toBe(false);
    expect(isInsideReleasesRoot(path.join(root, "p1"))).toBe(false);
    // Escapes.
    expect(isInsideReleasesRoot(path.join(root, "p1", "v1", "..", "..", "..", "x.pdf"))).toBe(false);
    expect(isInsideReleasesRoot(path.join(tempUploads, "docs", "a.pdf"))).toBe(false);
    expect(isInsideReleasesRoot(path.join(os.tmpdir(), "elsewhere.pdf"))).toBe(false);
    expect(isInsideReleasesRoot("")).toBe(false);
    expect(isInsideReleasesRoot(null)).toBe(false);
  });

  it("L. retrying after a failed attempt produces one clean version", () => {
    seedProject("p1");
    addDoc("p1", "fA", "a.pdf", "AAA");
    const before = loadProject("p1");
    expect(() =>
      updateProject("p1", { expectedRevision: before.revision + 3, status: "ready_to_send" }),
    ).toThrow();
    expect(listReleaseFiles()).toEqual([]);

    const v = createVersion("p1", "admin", { force: true });
    const files = listReleaseFiles();
    expect(files).toHaveLength(1);
    expect(files[0].startsWith(`p1/${v.id}/`)).toBe(true);
    const snap = JSON.parse(db.prepare("SELECT snapshot FROM spec_versions WHERE id = ?").get(v.id).snapshot);
    expect(snap.documentManifest).toHaveLength(1);
    expect(snap.documentManifest[0].url).toContain(`/uploads/releases/p1/${v.id}/`);
  });

  it("N. a published release round-trips through a reopened DB with its assets", () => {
    seedProject("p1");
    addDoc("p1", "fA", "a.pdf", "AAA");
    const v = createVersion("p1", "admin", { force: true });
    const reloaded = loadProject("p1");
    expect(reloaded.manualParams.publishedRelease.versionId).toBe(v.id);
    const snap = JSON.parse(db.prepare("SELECT snapshot FROM spec_versions WHERE id = ?").get(v.id).snapshot);
    const abs = path.join(tempUploads, snap.documentManifest[0].url.replace(/^\/uploads\//, ""));
    expect(fs.existsSync(abs)).toBe(true);
    expect(fs.readFileSync(abs, "utf8")).toBe("AAA");
  });

  it("O. two attempts for one project never share a version directory", () => {
    seedProject("p1");
    addDoc("p1", "fA", "a.pdf", "AAA");
    const a = createVersion("p1", "admin", { force: true });
    const b = createVersion("p1", "admin", { force: true });
    expect(a.id).not.toBe(b.id);
    const dirs = fs.readdirSync(path.join(releasesRoot(), "p1")).sort();
    expect(dirs).toEqual([a.id, b.id].sort());
    // Each manifest points only at its own directory.
    for (const v of [a, b]) {
      const snap = JSON.parse(db.prepare("SELECT snapshot FROM spec_versions WHERE id = ?").get(v.id).snapshot);
      expect(snap.documentManifest).toHaveLength(1);
      expect(snap.documentManifest[0].url).toContain(`/uploads/releases/p1/${v.id}/`);
    }
  });

  it("R. production-shape leftovers are left untouched by a new attempt", () => {
    // Mirrors the production categories: a referenced version dir and an
    // orphan dir whose spec_version no longer exists.
    seedProject("p1");
    addDoc("p1", "fA", "a.pdf", "AAA");
    const v = createVersion("p1", "admin", { force: true });
    const orphanDir = path.join(releasesRoot(), "p1", "v_orphan_leftover");
    fs.mkdirSync(orphanDir, { recursive: true });
    fs.writeFileSync(path.join(orphanDir, "leftover.pdf"), "LEFT");

    const before = loadProject("p1");
    expect(() =>
      updateProject("p1", { expectedRevision: before.revision + 4, status: "ready_to_send" }),
    ).toThrow();

    // Neither the good release nor the pre-existing leftover is removed.
    expect(fs.existsSync(path.join(releasesRoot(), "p1", v.id))).toBe(true);
    expect(fs.readFileSync(path.join(orphanDir, "leftover.pdf"), "utf8")).toBe("LEFT");
  });
});
