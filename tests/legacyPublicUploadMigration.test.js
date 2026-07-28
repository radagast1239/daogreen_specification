import fs from "fs";
import os from "os";
import path from "path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildLegacyPublicUploadPlan,
  runLegacyPublicUploadMigration,
} from "../backend/src/services/legacyPublicUploadMigration.js";

let root;
let db;

function write(relative, contents) {
  const file = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
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

describe("legacy public upload migration", () => {
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
