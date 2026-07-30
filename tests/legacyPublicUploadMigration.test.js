import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildLegacyPublicUploadPlan,
  runLegacyPublicUploadMigration,
} from "../backend/src/services/legacyPublicUploadMigration.js";

const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
]);
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
const FAKE = Buffer.from("not-an-image");

let root;
let db;

function write(relative, contents) {
  const file = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.isBuffer(contents) ? contents : Buffer.from(contents));
  return file;
}

function publicRefs(url) {
  return {
    references: [{ referenceType: url.includes("logo") ? "live:branding_logo" : "live:material_catalog" }],
  };
}

function insertMaterial(id, url) {
  db.prepare("INSERT INTO materials (id, photo_url) VALUES (?, ?)").run(id, url);
}

function hashOf(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "daogreen-legacy-upload-"));
  db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE materials (id TEXT PRIMARY KEY, photo_url TEXT DEFAULT '');
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');
  `);
});

afterEach(() => {
  try { db.close(); } catch { /* ignore */ }
  fs.rmSync(root, { recursive: true, force: true });
});

describe("legacy public upload migration (strict)", () => {
  it("plans and migrates a proven public material only after verified backup", () => {
    write("mat.jpg", "material");
    insertMaterial("m1", "/uploads/mat.jpg");
    let backups = 0;
    const result = runLegacyPublicUploadMigration({
      db,
      uploadRoot: root,
      dryRun: false,
      referenceLookup: publicRefs,
      createVerifiedBackup: () => { backups += 1; return { ok: true }; },
    });
    expect(backups).toBe(1);
    expect(result.applied).toBe(1);
    expect(db.prepare("SELECT photo_url FROM materials WHERE id='m1'").get().photo_url)
      .toBe("/uploads/public/legacy/mat.jpg");
    expect(fs.readFileSync(path.join(root, "public", "legacy", "mat.jpg"), "utf8")).toBe("material");
  });

  it("does not migrate an asset with a project-private reference", () => {
    write("shared.jpg", "private");
    insertMaterial("m1", "/uploads/shared.jpg");
    const plan = buildLegacyPublicUploadPlan({
      db,
      uploadRoot: root,
      referenceLookup: () => ({
        references: [
          { referenceType: "live:material_catalog" },
          { referenceType: "live:project_item" },
        ],
      }),
    });
    expect(plan.actions).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe("PRIVATE_OR_AMBIGUOUS_REFERENCE");
  });

  it("ignores already migrated URLs and remains idempotent", () => {
    write("public/legacy/done.jpg", "done");
    insertMaterial("m1", "/uploads/public/legacy/done.jpg");
    const first = runLegacyPublicUploadMigration({
      db, uploadRoot: root, dryRun: true, referenceLookup: publicRefs,
    });
    const second = runLegacyPublicUploadMigration({
      db, uploadRoot: root, dryRun: true, referenceLookup: publicRefs,
    });
    expect(first.actions).toEqual([]);
    expect(second.actions).toEqual([]);
  });

  it("uses a deterministic hash suffix on a different-content collision", () => {
    write("same.jpg", "source");
    write("public/legacy/same.jpg", "other");
    insertMaterial("m1", "/uploads/same.jpg");
    const plan = buildLegacyPublicUploadPlan({
      db, uploadRoot: root, referenceLookup: publicRefs,
    });
    expect(plan.actions[0].collision).toBe(true);
    expect(plan.actions[0].destinationUrl).toMatch(/^\/uploads\/public\/legacy\/same-[a-f0-9]{12}\.jpg$/);
  });

  it("reports a missing source without changing the DB", () => {
    insertMaterial("m1", "/uploads/missing.jpg");
    const plan = buildLegacyPublicUploadPlan({
      db, uploadRoot: root, referenceLookup: publicRefs,
    });
    expect(plan.actions).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe("SOURCE_MISSING");
    expect(db.prepare("SELECT photo_url FROM materials WHERE id='m1'").get().photo_url)
      .toBe("/uploads/missing.jpg");
  });

  it("rolls back copied files and DB URLs after failure", () => {
    write("rollback.jpg", "rollback");
    insertMaterial("m1", "/uploads/rollback.jpg");
    expect(() => runLegacyPublicUploadMigration({
      db,
      uploadRoot: root,
      dryRun: false,
      referenceLookup: publicRefs,
      createVerifiedBackup: () => ({ ok: true }),
      failAfterCopy: true,
    })).toThrow("Injected migration failure");
    expect(db.prepare("SELECT photo_url FROM materials WHERE id='m1'").get().photo_url)
      .toBe("/uploads/rollback.jpg");
    expect(fs.existsSync(path.join(root, "public", "legacy", "rollback.jpg"))).toBe(false);
  });

  it("requires verified backup for apply but not for dry-run", () => {
    write("backup.jpg", "backup");
    insertMaterial("m1", "/uploads/backup.jpg");
    expect(runLegacyPublicUploadMigration({
      db, uploadRoot: root, dryRun: true, referenceLookup: publicRefs,
    }).dryRun).toBe(true);
    expect(() => runLegacyPublicUploadMigration({
      db, uploadRoot: root, dryRun: false, referenceLookup: publicRefs,
    })).toThrow(/backup/i);
  });
});

describe("legacy public upload migration (copy-to-public)", () => {
  it("copies material-only ref to public/legacy/materials/<sha>.<ext>", () => {
    write("mat.jpg", JPEG);
    insertMaterial("m1", "/uploads/mat.jpg");
    const h = hashOf(JPEG);
    const result = runLegacyPublicUploadMigration({
      db,
      uploadRoot: root,
      dryRun: false,
      mode: "copy-to-public",
      createVerifiedBackup: () => ({ ok: true }),
    });
    expect(result.applied).toBe(1);
    const dest = `/uploads/public/legacy/materials/${h}.jpg`;
    expect(db.prepare("SELECT photo_url FROM materials WHERE id='m1'").get().photo_url).toBe(dest);
    expect(fs.existsSync(path.join(root, "mat.jpg"))).toBe(true);
    expect(fs.readFileSync(path.join(root, "public", "legacy", "materials", `${h}.jpg`))).toEqual(JPEG);
  });

  it("copies for material even when private project ref shares the file; only materials.photo_url updates", () => {
    write("shared.jpg", JPEG);
    insertMaterial("m1", "/uploads/shared.jpg");
    const h = hashOf(JPEG);
    const result = runLegacyPublicUploadMigration({
      db,
      uploadRoot: root,
      dryRun: false,
      mode: "copy-to-public",
      referenceLookup: () => ({
        references: [
          { referenceType: "live:material_catalog" },
          { referenceType: "live:project_scheme" },
        ],
      }),
      createVerifiedBackup: () => ({ ok: true }),
    });
    expect(result.applied).toBe(1);
    expect(db.prepare("SELECT photo_url FROM materials WHERE id='m1'").get().photo_url)
      .toBe(`/uploads/public/legacy/materials/${h}.jpg`);
    expect(fs.existsSync(path.join(root, "shared.jpg"))).toBe(true);
  });

  it("copies for material even with frame-drawing co-reference", () => {
    write("frame-shared.jpg", JPEG);
    insertMaterial("m1", "/uploads/frame-shared.jpg");
    const plan = buildLegacyPublicUploadPlan({
      db,
      uploadRoot: root,
      mode: "copy-to-public",
      referenceLookup: () => ({
        references: [
          { referenceType: "live:material_catalog" },
          { referenceType: "live:frame_drawing" },
        ],
      }),
    });
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0].destinationUrl).toMatch(/^\/uploads\/public\/legacy\/materials\/[a-f0-9]{64}\.jpg$/);
  });

  it("copies for material even with release-pinned co-reference", () => {
    write("release-shared.jpg", JPEG);
    insertMaterial("m1", "/uploads/release-shared.jpg");
    const plan = buildLegacyPublicUploadPlan({
      db,
      uploadRoot: root,
      mode: "copy-to-public",
      referenceLookup: () => ({
        references: [
          { referenceType: "pinned:release_image" },
          { referenceType: "live:material_catalog" },
        ],
      }),
    });
    expect(plan.actions).toHaveLength(1);
  });

  it("dry-run makes no filesystem or DB changes", () => {
    write("dry.jpg", JPEG);
    insertMaterial("m1", "/uploads/dry.jpg");
    const result = runLegacyPublicUploadMigration({
      db,
      uploadRoot: root,
      dryRun: true,
      mode: "copy-to-public",
    });
    expect(result.dryRun).toBe(true);
    expect(result.applied).toBe(0);
    expect(result.actions).toHaveLength(1);
    expect(db.prepare("SELECT photo_url FROM materials WHERE id='m1'").get().photo_url)
      .toBe("/uploads/dry.jpg");
    expect(fs.existsSync(path.join(root, "public", "legacy", "materials"))).toBe(false);
  });

  it("repeated apply is idempotent", () => {
    write("idem.jpg", JPEG);
    insertMaterial("m1", "/uploads/idem.jpg");
    const opts = {
      db,
      uploadRoot: root,
      dryRun: false,
      mode: "copy-to-public",
      createVerifiedBackup: () => ({ ok: true }),
    };
    const first = runLegacyPublicUploadMigration(opts);
    expect(first.applied).toBe(1);
    const url = db.prepare("SELECT photo_url FROM materials WHERE id='m1'").get().photo_url;
    const second = runLegacyPublicUploadMigration(opts);
    expect(second.actions).toHaveLength(0);
    expect(second.applied).toBe(0);
    expect(db.prepare("SELECT photo_url FROM materials WHERE id='m1'").get().photo_url).toBe(url);
  });

  it("rejects destination collision with different content at same hash path", () => {
    write("c.jpg", JPEG);
    insertMaterial("m1", "/uploads/c.jpg");
    const h = hashOf(JPEG);
    write(`public/legacy/materials/${h}.jpg`, PNG);
    const plan = buildLegacyPublicUploadPlan({
      db, uploadRoot: root, mode: "copy-to-public",
    });
    expect(plan.actions).toHaveLength(0);
    expect(plan.skipped[0].reason).toBe("LEGACY_UPLOAD_COLLISION");
  });

  it("skips missing source", () => {
    insertMaterial("m1", "/uploads/missing.jpg");
    const plan = buildLegacyPublicUploadPlan({
      db, uploadRoot: root, mode: "copy-to-public",
    });
    expect(plan.skipped[0].reason).toBe("SOURCE_MISSING");
  });

  it("rejects invalid magic", () => {
    write("bad.jpg", FAKE);
    insertMaterial("m1", "/uploads/bad.jpg");
    const plan = buildLegacyPublicUploadPlan({
      db, uploadRoot: root, mode: "copy-to-public",
    });
    expect(plan.skipped[0].reason).toBe("INVALID_MAGIC");
  });

  it("rejects SVG", () => {
    write("x.svg", SVG);
    insertMaterial("m1", "/uploads/x.svg");
    const plan = buildLegacyPublicUploadPlan({
      db, uploadRoot: root, mode: "copy-to-public",
    });
    expect(plan.skipped[0].reason).toBe("SVG_FORBIDDEN");
  });

  it("rejects path traversal", () => {
    insertMaterial("m1", "/uploads/../outside.jpg");
    const plan = buildLegacyPublicUploadPlan({
      db, uploadRoot: root, mode: "copy-to-public",
    });
    // normalizeLegacyUrl rejects .. → candidate never added
    expect(plan.actions).toHaveLength(0);
    expect(plan.skipped).toHaveLength(0);
  });

  it("rolls back after copy/DB failure (failAfterCopy)", () => {
    write("rb.jpg", JPEG);
    insertMaterial("m1", "/uploads/rb.jpg");
    const h = hashOf(JPEG);
    expect(() => runLegacyPublicUploadMigration({
      db,
      uploadRoot: root,
      dryRun: false,
      mode: "copy-to-public",
      createVerifiedBackup: () => ({ ok: true }),
      failAfterCopy: true,
    })).toThrow("Injected migration failure");
    expect(db.prepare("SELECT photo_url FROM materials WHERE id='m1'").get().photo_url)
      .toBe("/uploads/rb.jpg");
    expect(fs.existsSync(path.join(root, "public", "legacy", "materials", `${h}.jpg`))).toBe(false);
  });
});
