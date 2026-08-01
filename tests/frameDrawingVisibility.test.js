import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const testId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tempDir = path.join(os.tmpdir(), `daogreen-fd-vis-${testId}`);
const tempDbPath = path.join(tempDir, "daogreen-test.db");
const tempUploadsRoot = path.join(tempDir, "uploads");

let db;
let initDb;
let hideOrphanFrameDrawingsForProject;
let hideSupersededFrameDrawingVersions;
let purgeHiddenFrameDrawingById;
let purgeEligibleHiddenFrameDrawings;
let evaluateHiddenFrameDrawingPurge;
let seedCounter = 0;

function seedProject(id = "proj1", stellageConfigs = []) {
  seedCounter += 1;
  db.prepare(`
    INSERT INTO projects (id, name, client_token, stellage_configs)
    VALUES (?, 'Test project', ?, ?)
  `).run(id, `token-${id}-${seedCounter}`, JSON.stringify(stellageConfigs));
}

function insertDrawing(overrides = {}) {
  const id = overrides.id || `fd_${Math.random().toString(16).slice(2, 8)}`;
  const now = new Date().toISOString();
  const fileId = overrides.file_id ?? null;
  db.prepare(`
    INSERT INTO frame_drawings (
      id, project_id, module_id, stellage_id, module_rack_key, preset_id, source_type,
      title, rack_type, frame_config_json, pdf_url, pdf_filename, file_id,
      is_client_visible, version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.project_id ?? "proj1",
    overrides.module_id ?? null,
    overrides.stellage_id ?? null,
    overrides.module_rack_key ?? null,
    overrides.preset_id ?? null,
    overrides.source_type ?? "project_stellage",
    overrides.title ?? "Test drawing",
    overrides.rack_type ?? "nft",
    overrides.frame_config_json ?? "{}",
    overrides.pdf_url ?? `/uploads/frame-drawings/proj1/${id}.pdf`,
    overrides.pdf_filename ?? "test.pdf",
    fileId,
    overrides.is_client_visible ?? 1,
    overrides.version ?? 1,
    now,
    now,
  );
  return id;
}

function insertFilesRow(id, projectId, url) {
  db.prepare(`
    INSERT INTO files (id, project_id, type, filename, url)
    VALUES (?, ?, 'frame_drawing', 'test.pdf', ?)
  `).run(id, projectId, url);
}

beforeAll(async () => {
  fs.mkdirSync(tempDir, { recursive: true });
  fs.mkdirSync(tempUploadsRoot, { recursive: true });
  process.env.DATABASE_PATH = tempDbPath;
  process.env.DB_PATH = tempDbPath;
  process.env.UPLOAD_ROOT = tempUploadsRoot;
  process.env.NODE_ENV = "test";
  vi.resetModules();
  const dbMod = await import("../backend/src/db.js");
  const visMod = await import("../backend/src/services/frameDrawingVisibility.js");
  db = dbMod.db;
  initDb = dbMod.initDb;
  hideOrphanFrameDrawingsForProject = visMod.hideOrphanFrameDrawingsForProject;
  hideSupersededFrameDrawingVersions = visMod.hideSupersededFrameDrawingVersions;
  purgeHiddenFrameDrawingById = visMod.purgeHiddenFrameDrawingById;
  purgeEligibleHiddenFrameDrawings = visMod.purgeEligibleHiddenFrameDrawings;
  evaluateHiddenFrameDrawingPurge = visMod.evaluateHiddenFrameDrawingPurge;
  initDb();
});

beforeEach(() => {
  seedCounter = 0;
  db.prepare("DELETE FROM files").run();
  db.prepare("DELETE FROM frame_drawings").run();
  db.prepare("DELETE FROM spec_versions").run();
  db.prepare("DELETE FROM projects").run();
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

describe("hideOrphanFrameDrawingsForProject", () => {
  it("hides drawings for deleted stellages and removes files rows", () => {
    seedProject("proj1", [{ id: "st_keep", name: "Keep" }]);
    const fileKeep = "file_keep";
    const fileGone = "file_gone";
    insertFilesRow(fileKeep, "proj1", "/uploads/frame-drawings/proj1/keep.pdf");
    insertFilesRow(fileGone, "proj1", "/uploads/frame-drawings/proj1/gone.pdf");
    insertDrawing({ id: "keep", stellage_id: "st_keep", file_id: fileKeep, version: 1 });
    insertDrawing({ id: "gone", stellage_id: "st_gone", file_id: fileGone, version: 1 });

    const result = hideOrphanFrameDrawingsForProject("proj1", new Set(["st_keep"]));
    expect(result.hidden).toBe(1);
    expect(result.hiddenIds).toEqual(["gone"]);

    const keep = db.prepare("SELECT is_client_visible, file_id FROM frame_drawings WHERE id=?").get("keep");
    const gone = db.prepare("SELECT is_client_visible, file_id FROM frame_drawings WHERE id=?").get("gone");
    expect(keep.is_client_visible).toBe(1);
    expect(keep.file_id).toBe(fileKeep);
    expect(gone.is_client_visible).toBe(0);
    expect(gone.file_id).toBeNull();
    expect(db.prepare("SELECT id FROM files WHERE id=?").get(fileGone)).toBeFalsy();
    expect(db.prepare("SELECT id FROM files WHERE id=?").get(fileKeep)).toBeTruthy();
  });

  it("no-ops when active stellage set is empty", () => {
    seedProject("proj1", []);
    insertDrawing({ id: "a", stellage_id: "st_a" });
    const result = hideOrphanFrameDrawingsForProject("proj1", new Set());
    expect(result.hidden).toBe(0);
    expect(db.prepare("SELECT is_client_visible FROM frame_drawings WHERE id=?").get("a").is_client_visible).toBe(1);
  });

  it("reads stellage_configs from DB when configs arg omitted", () => {
    seedProject("proj1", [{ id: "st_keep", name: "Keep" }]);
    insertDrawing({ id: "keep", stellage_id: "st_keep" });
    insertDrawing({ id: "gone", stellage_id: "st_gone" });
    const result = hideOrphanFrameDrawingsForProject("proj1");
    expect(result.hiddenIds).toEqual(["gone"]);
  });
});

describe("hideSupersededFrameDrawingVersions", () => {
  it("hides older visible versions for same project+stellage", () => {
    seedProject("proj1", [{ id: "st1", name: "S1" }]);
    const oldFile = "file_old";
    insertFilesRow(oldFile, "proj1", "/uploads/frame-drawings/proj1/old.pdf");
    insertDrawing({ id: "old", stellage_id: "st1", version: 1, file_id: oldFile });
    insertDrawing({ id: "new", stellage_id: "st1", version: 2 });
    insertDrawing({ id: "other", stellage_id: "st2", version: 1 });

    const result = hideSupersededFrameDrawingVersions({
      keepId: "new",
      projectId: "proj1",
      stellageId: "st1",
    });
    expect(result.hiddenIds).toEqual(["old"]);
    expect(db.prepare("SELECT is_client_visible FROM frame_drawings WHERE id=?").get("old").is_client_visible).toBe(0);
    expect(db.prepare("SELECT is_client_visible FROM frame_drawings WHERE id=?").get("new").is_client_visible).toBe(1);
    expect(db.prepare("SELECT is_client_visible FROM frame_drawings WHERE id=?").get("other").is_client_visible).toBe(1);
    expect(db.prepare("SELECT id FROM files WHERE id=?").get(oldFile)).toBeFalsy();
  });

  it("does nothing without keepId", () => {
    seedProject();
    insertDrawing({ id: "a", stellage_id: "st1" });
    expect(hideSupersededFrameDrawingVersions({}).hidden).toBe(0);
  });
});

describe("purgeHiddenFrameDrawing", () => {
  function writePdf(relUnderUploads, bytes = "%PDF-1.4 purge-test") {
    const abs = path.join(tempUploadsRoot, relUnderUploads);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, bytes);
    return `/uploads/${relUnderUploads.replace(/\\/g, "/")}`;
  }

  it("refuses visible drawings and non frame-drawings paths", () => {
    seedProject();
    insertDrawing({ id: "vis", stellage_id: "st1", is_client_visible: 1 });
    expect(evaluateHiddenFrameDrawingPurge(
      db.prepare("SELECT * FROM frame_drawings WHERE id=?").get("vis"),
    ).reason).toBe("still_visible");

    insertDrawing({
      id: "rel",
      stellage_id: "st1",
      is_client_visible: 0,
      pdf_url: "/uploads/releases/proj1/v1/x.pdf",
    });
    expect(purgeHiddenFrameDrawingById("rel").reason).toBe("not_live_frame_path");
  });

  it("purges soft-hidden live PDF and DB row when not pinned", () => {
    seedProject();
    const url = writePdf("frame-drawings/proj1/orphan.pdf");
    insertDrawing({
      id: "orphan",
      stellage_id: "st_gone",
      is_client_visible: 0,
      pdf_url: url,
    });
    const result = purgeHiddenFrameDrawingById("orphan");
    expect(result).toMatchObject({ purged: true, fileDeleted: true, url });
    expect(db.prepare("SELECT id FROM frame_drawings WHERE id=?").get("orphan")).toBeFalsy();
    expect(fs.existsSync(path.join(tempUploadsRoot, "frame-drawings/proj1/orphan.pdf"))).toBe(false);
  });

  it("skips pinned soft-hidden drawings", () => {
    seedProject();
    const url = writePdf("frame-drawings/proj1/pinned.pdf", "%PDF pinned");
    insertDrawing({
      id: "pinned_fd",
      stellage_id: "st_gone",
      is_client_visible: 0,
      pdf_url: url,
    });
    const snapshot = JSON.stringify({
      schema: "release_v2",
      pinnedFrameDrawings: [{
        drawingId: "pinned_fd",
        url,
        title: "Pinned",
      }],
      documentManifest: [],
      imageManifest: { projectSchemes: [], rackImages: [] },
      items: [],
    });
    db.prepare(`
      INSERT INTO spec_versions (id, project_id, version_number, created_by, summary, snapshot)
      VALUES ('v_pin', 'proj1', 1, 'admin', 't', ?)
    `).run(snapshot);

    const result = purgeHiddenFrameDrawingById("pinned_fd");
    expect(result).toMatchObject({ purged: false, reason: "pinned" });
    expect(db.prepare("SELECT id FROM frame_drawings WHERE id=?").get("pinned_fd")).toBeTruthy();
    expect(fs.readFileSync(path.join(tempUploadsRoot, "frame-drawings/proj1/pinned.pdf"), "utf8")).toContain("pinned");
  });

  it("dry-run lists eligible without deleting", () => {
    seedProject();
    const url = writePdf("frame-drawings/proj1/dry.pdf");
    insertDrawing({ id: "dry", stellage_id: "st_x", is_client_visible: 0, pdf_url: url });
    const scan = purgeEligibleHiddenFrameDrawings({ dryRun: true });
    expect(scan.wouldPurge).toBe(1);
    expect(scan.purged).toBe(0);
    expect(db.prepare("SELECT id FROM frame_drawings WHERE id=?").get("dry")).toBeTruthy();
  });
});
