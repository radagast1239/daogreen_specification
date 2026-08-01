/**
 * T7 — release assets copied during a publication attempt must not survive a
 * rolled-back publication, and must never touch anything the attempt did not
 * create. Temporary SQLite + temporary UPLOAD_ROOT only.
 *
 * Failure points are driven by publicationCheckpoint(), a test-only hook that
 * is inert unless NODE_ENV === "test" and is not reachable from any request.
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
let setFailurePoint;
let runPublishedReleaseBackfill;

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

const versionIds = () => db.prepare("SELECT id FROM spec_versions").all().map((r) => r.id).sort();
const publishedPointer = (pid) => loadProject(pid)?.manualParams?.publishedRelease?.versionId || null;

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
    VALUES (?, 'Проект', 'Клиент', 'Город', ?, 'active', '{}', '[]', '₽', 1, 0, '', '[]', 1)
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

const docRefs = (projectId, names) =>
  names.map((n) => ({ id: `f${n}`, filename: `${n}.pdf`, url: `/uploads/docs/${projectId}-${n}.pdf` }));

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
  const backfillMod = await import("../backend/src/services/publishedReleaseBackfillService.js");
  db = dbMod.db;
  loadProject = dbMod.loadProject;
  saveItems = projectsMod.saveItems;
  createVersion = projectsMod.createVersion;
  updateProject = projectsMod.updateProject;
  pinClientDocumentsForRelease = pinMod.pinClientDocumentsForRelease;
  beginPublicationAssetScope = stageMod.beginPublicationAssetScope;
  isInsideReleasesRoot = stageMod.isInsideReleasesRoot;
  setFailurePoint = stageMod.__setPublicationFailurePoint;
  runPublishedReleaseBackfill = backfillMod.runPublishedReleaseBackfill;
  (await import("../backend/src/services/activityLog.js")).initActivityLog();
  dbMod.initDb();
});

beforeEach(() => {
  setFailurePoint(null);
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
  setFailurePoint(null);
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
    addDoc("p1", "fa", "a.pdf", "AAA");
    const v = createVersion("p1", "admin", { force: true });
    const files = listReleaseFiles();
    expect(files).toHaveLength(1);
    expect(files[0].startsWith(`p1/${v.id}/`)).toBe(true);

    const snap = JSON.parse(db.prepare("SELECT snapshot FROM spec_versions WHERE id = ?").get(v.id).snapshot);
    expect(snap.documentManifest).toHaveLength(1);
    const abs = path.join(tempUploads, snap.documentManifest[0].url.replace(/^\/uploads\//, ""));
    expect(fs.readFileSync(abs, "utf8")).toBe("AAA");
  });

  it("scope is mandatory: pinning without one refuses to create anything", () => {
    seedProject("p1");
    addDoc("p1", "fa", "a.pdf", "AAA");
    expect(() =>
      pinClientDocumentsForRelease({
        projectId: "p1",
        versionId: "v_noscope",
        liveDocuments: docRefs("p1", ["a"]),
        uploadRoot: tempUploads,
      }),
    ).toThrow(/scope is required/i);
    expect(listReleaseFiles()).toEqual([]);
  });

  it("D. rollback removes files and the attempt directory, and is idempotent", () => {
    seedProject("p1");
    addDoc("p1", "fa", "a.pdf", "AAA");
    addDoc("p1", "fb", "b.pdf", "BBB");
    const scope = beginPublicationAssetScope();
    pinClientDocumentsForRelease({
      projectId: "p1",
      versionId: "v_attempt",
      liveDocuments: docRefs("p1", ["a", "b"]),
      uploadRoot: tempUploads,
      assetScope: scope,
    });
    expect(scope.stagedFileCount).toBe(2);
    expect(listReleaseFiles()).toHaveLength(2);

    const first = scope.rollback();
    expect(first.removedFiles).toBe(2);
    expect(first.failures).toEqual([]);
    expect(listReleaseFiles()).toEqual([]);
    expect(fs.existsSync(path.join(releasesRoot(), "p1", "v_attempt"))).toBe(false);
    expect(scope.rollback()).toBeNull();
    expect(fs.existsSync(path.join(tempUploads, "docs", "p1-a.pdf"))).toBe(true);
  });

  it("D2. commit keeps the files; a later rollback cannot delete them", () => {
    seedProject("p1");
    addDoc("p1", "fa", "a.pdf", "AAA");
    const scope = beginPublicationAssetScope();
    pinClientDocumentsForRelease({
      projectId: "p1",
      versionId: "v_kept",
      liveDocuments: docRefs("p1", ["a"]),
      uploadRoot: tempUploads,
      assetScope: scope,
    });
    expect(scope.commit()).toEqual({ committed: true, files: 1 });
    expect(listReleaseFiles()).toHaveLength(1);
    expect(scope.rollback()).toBeNull();
    expect(listReleaseFiles()).toHaveLength(1);
  });

  it("a journaled file that was never written is not a cleanup failure", () => {
    seedProject("p1");
    addDoc("p1", "fa", "a.pdf", "AAA");
    const scope = beginPublicationAssetScope();
    pinClientDocumentsForRelease({
      projectId: "p1",
      versionId: "v_ghost",
      liveDocuments: docRefs("p1", ["a"]),
      uploadRoot: tempUploads,
      assetScope: scope,
    });
    // Simulate the file disappearing before rollback runs.
    fs.rmSync(path.join(releasesRoot(), "p1", "v_ghost", "a.pdf"), { force: true });
    const res = scope.rollback();
    expect(res.failures).toEqual([]);
    expect(res.removedFiles).toBe(0);
    expect(fs.existsSync(path.join(releasesRoot(), "p1", "v_ghost"))).toBe(false);
  });

  it("H. an existing version directory is never merged or overwritten", () => {
    seedProject("p1");
    addDoc("p1", "fa", "a.pdf", "AAA");
    const dir = path.join(releasesRoot(), "p1", "v_fixed");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "existing.pdf"), "OLD");

    expect(() =>
      pinClientDocumentsForRelease({
        projectId: "p1",
        versionId: "v_fixed",
        liveDocuments: docRefs("p1", ["a"]),
        uploadRoot: tempUploads,
        assetScope: beginPublicationAssetScope(),
      }),
    ).toThrow(/already exists/);

    expect(fs.readdirSync(dir)).toEqual(["existing.pdf"]);
    expect(fs.readFileSync(path.join(dir, "existing.pdf"), "utf8")).toBe("OLD");
  });

  it("K. containment refuses traversal, absolute and out-of-root paths", () => {
    const root = releasesRoot();
    fs.mkdirSync(path.join(root, "p1", "v1"), { recursive: true });
    expect(isInsideReleasesRoot(path.join(root, "p1", "v1", "ok.pdf"))).toBe(true);
    expect(isInsideReleasesRoot(root)).toBe(false);
    expect(isInsideReleasesRoot(path.join(root, "p1"))).toBe(false);
    expect(isInsideReleasesRoot(path.join(root, "p1", "v1", "..", "..", "..", "x.pdf"))).toBe(false);
    expect(isInsideReleasesRoot(path.join(tempUploads, "docs", "a.pdf"))).toBe(false);
    expect(isInsideReleasesRoot(path.join(os.tmpdir(), "elsewhere.pdf"))).toBe(false);
    expect(isInsideReleasesRoot("")).toBe(false);
    expect(isInsideReleasesRoot(null)).toBe(false);
  });

  it("O. two attempts for one project never share a version directory", () => {
    seedProject("p1");
    addDoc("p1", "fa", "a.pdf", "AAA");
    const a = createVersion("p1", "admin", { force: true });
    const b = createVersion("p1", "admin", { force: true });
    expect(a.id).not.toBe(b.id);
    expect(fs.readdirSync(path.join(releasesRoot(), "p1")).sort()).toEqual([a.id, b.id].sort());
    for (const v of [a, b]) {
      const snap = JSON.parse(db.prepare("SELECT snapshot FROM spec_versions WHERE id = ?").get(v.id).snapshot);
      expect(snap.documentManifest[0].url).toContain(`/uploads/releases/p1/${v.id}/`);
    }
  });
});

describe("T7 — route-level failure after copy", () => {
  /**
   * Publishes through the real service entry point with an injected failure and
   * asserts the full before/after contract.
   * @param {string} point checkpoint name
   */
  function publishExpectingFailure(point, { docs = ["a", "b"] } = {}) {
    seedProject("p1");
    seedProject("p2");
    for (const d of docs) addDoc("p1", `f${d}`, `${d}.pdf`, d.toUpperCase());
    addDoc("p2", "fother", "other.pdf", "OTHER");
    // A healthy earlier release for p1 and one for p2.
    const prev = createVersion("p1", "admin", { force: true });
    const otherProject = createVersion("p2", "admin", { force: true });
    const filesBefore = listReleaseFiles();
    const revBefore = loadProject("p1").revision;
    const pointerBefore = publishedPointer("p1");
    const versionsBefore = versionIds();

    setFailurePoint(point);
    let thrown = null;
    try {
      createVersion("p1", "admin", { force: true });
    } catch (e) {
      thrown = e;
    }

    expect(thrown, `expected ${point} to fail the publication`).toBeTruthy();
    // The original error survives — cleanup must not replace it.
    expect(thrown.message).toContain(`injected_publication_failure_at_${point}`);
    expect(thrown.code).toBe("INJECTED_PUBLICATION_FAILURE");
    // No new version, pointer and revision untouched.
    expect(versionIds()).toEqual(versionsBefore);
    expect(publishedPointer("p1")).toBe(pointerBefore);
    expect(loadProject("p1").revision).toBe(revBefore);
    // Not one stray file: the attempt directory is gone, everything else intact.
    expect(listReleaseFiles()).toEqual(filesBefore);
    expect(fs.existsSync(path.join(releasesRoot(), "p1", prev.id))).toBe(true);
    expect(fs.existsSync(path.join(releasesRoot(), "p2", otherProject.id))).toBe(true);
    return { prev, otherProject };
  }

  it("A-point: fails after the first document copy", () => {
    publishExpectingFailure("after_first_document_copy");
  });

  it("B-point: fails after several copies, before the version insert", () => {
    publishExpectingFailure("after_documents_pinned");
  });

  it("C-point: fails immediately before INSERT spec_versions", () => {
    publishExpectingFailure("before_version_insert");
  });

  it("D-point: fails after INSERT, still inside the transaction", () => {
    // createVersion has no transaction of its own — production always wraps it
    // (mutateWithRevision / backfill tx), so the post-INSERT case must be driven
    // through a transactional entry point for the DB rollback to apply.
    // A neighbouring project with a healthy release must stay untouched.
    seedProject("pkeep");
    addDoc("pkeep", "fkeep", "a.pdf", "KEEP");
    const kept = createVersion("pkeep", "admin", { force: true });
    const filesBefore = listReleaseFiles();
    const versionsBefore = versionIds();

    // Fresh project with a client token and no release → backfill publishes it.
    seedProject("pnew");
    addDoc("pnew", "fnew", "a.pdf", "NEW");

    setFailurePoint("after_version_insert");
    const report = runPublishedReleaseBackfill({ projectIds: ["pnew"], dryRun: false });
    expect(report.reports[0].ok).toBe(false);
    expect(String(report.reports[0].error)).toContain("injected_publication_failure");

    // The inserted row was rolled back with the transaction, assets removed.
    expect(versionIds()).toEqual(versionsBefore);
    expect(publishedPointer("pnew")).toBeNull();
    expect(listReleaseFiles()).toEqual(filesBefore);
    expect(fs.existsSync(path.join(releasesRoot(), "pkeep", kept.id))).toBe(true);
  });

  it("copy failure on the very first document leaves nothing behind", () => {
    publishExpectingFailure("before_first_document_copy");
  });

  it("copy failure on a later document removes the already copied one", () => {
    seedProject("p1");
    addDoc("p1", "fa", "a.pdf", "AAA");
    addDoc("p1", "fb", "b.pdf", "BBB");
    setFailurePoint("before_next_document_copy");
    expect(() => createVersion("p1", "admin", { force: true })).toThrow(/injected_publication_failure/);
    // The first file was copied and journaled — it must be gone too.
    expect(listReleaseFiles()).toEqual([]);
    expect(versionIds()).toEqual([]);
    expect(publishedPointer("p1")).toBeNull();
  });

  it("the publish-on-status route path owns a scope and stays clean on abort", () => {
    seedProject("p1");
    addDoc("p1", "fa", "a.pdf", "AAA");
    const before = loadProject("p1");
    // Aborting before any copy must leave the project and disk untouched.
    expect(() =>
      updateProject("p1", { expectedRevision: before.revision + 5, status: "ready_to_send" }),
    ).toThrow();
    expect(listReleaseFiles()).toEqual([]);
    expect(versionIds()).toEqual([]);
    expect(loadProject("p1").revision).toBe(before.revision);
    expect(loadProject("p1").status).toBe("active");

    // updateProject creates its own journal and hands it to the publish call.
    const routes = fs.readFileSync(
      path.join(process.cwd(), "backend/src/routes/projects.js"), "utf8",
    );
    expect(routes).toMatch(/publishReleaseIfNeeded\(id, merged, safePatch\.status, assets\)/);
    expect(routes).toMatch(/createVersionRecord\(projectId, project, \{ force: false, assetScope \}\)/);
  });

  it("a retry after a failed attempt produces exactly one clean version", () => {
    seedProject("p1");
    addDoc("p1", "fa", "a.pdf", "AAA");
    setFailurePoint("after_documents_pinned");
    expect(() => createVersion("p1", "admin", { force: true })).toThrow();
    expect(listReleaseFiles()).toEqual([]);

    const v = createVersion("p1", "admin", { force: true });
    const files = listReleaseFiles();
    expect(files).toHaveLength(1);
    expect(files[0].startsWith(`p1/${v.id}/`)).toBe(true);
    expect(versionIds()).toEqual([v.id]);
  });
});

describe("T7 — backfill asset lifecycle", () => {
  function seedBackfillCandidate(pid) {
    // Client token + no published release → BACKFILL_ACTION.CREATE_V1.
    db.prepare(`
      INSERT INTO projects (id, name, client, city, client_token, status, manual_params, rooms, currency, vat, version, comment, stellage_configs, revision)
      VALUES (?, 'P', '', '', ?, 'active', '{}', '[]', '₽', 1, 0, '', '[]', 1)
    `).run(pid, `tok-${pid}`);
    saveItems(pid, [clientItem(`it_${pid}`)]);
    addDoc(pid, `f${pid}`, "a.pdf", "AAA");
  }

  it("successful backfill creates the version and keeps its assets", () => {
    seedBackfillCandidate("pbf");
    const report = runPublishedReleaseBackfill({ projectIds: ["pbf"], dryRun: false });
    expect(report.reports[0].ok).toBe(true);
    const vid = publishedPointer("pbf");
    expect(vid).toBeTruthy();
    const files = listReleaseFiles();
    expect(files).toHaveLength(1);
    expect(files[0].startsWith(`pbf/${vid}/`)).toBe(true);
  });

  it("backfill failure after copy removes the attempt assets and publishes nothing", () => {
    seedBackfillCandidate("pbf");
    setFailurePoint("after_documents_pinned");
    const report = runPublishedReleaseBackfill({ projectIds: ["pbf"], dryRun: false });
    expect(report.reports[0].ok).toBe(false);
    expect(report.reports[0].error).toContain("injected_publication_failure");
    expect(publishedPointer("pbf")).toBeNull();
    expect(versionIds()).toEqual([]);
    expect(listReleaseFiles()).toEqual([]);
  });

  it("backfill failure does not disturb an existing release of another project", () => {
    seedProject("pkeep");
    addDoc("pkeep", "fkeep", "a.pdf", "KEEP");
    const kept = createVersion("pkeep", "admin", { force: true });
    const keptFiles = listReleaseFiles();

    seedBackfillCandidate("pbf");
    setFailurePoint("before_version_insert");
    const report = runPublishedReleaseBackfill({ projectIds: ["pbf"], dryRun: false });
    expect(report.reports[0].ok).toBe(false);

    expect(listReleaseFiles()).toEqual(keptFiles);
    expect(fs.existsSync(path.join(releasesRoot(), "pkeep", kept.id))).toBe(true);
    expect(publishedPointer("pkeep")).toBe(kept.id);
  });
});
