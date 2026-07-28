import path from "path";
import { db, getDbPath } from "../src/db.js";
import { resolveUploadRoot } from "../src/services/uploadRoot.js";
import { createAndVerifySqliteBackup } from "../src/sqliteBackup.js";
import { runLegacyPublicUploadMigration } from "../src/services/legacyPublicUploadMigration.js";

const apply = process.argv.includes("--apply");
const uploadRoot = resolveUploadRoot();
const dbPath = getDbPath();
const backupDir = path.join(path.dirname(dbPath), "pre-migration-backups");

const result = runLegacyPublicUploadMigration({
  db,
  uploadRoot,
  dryRun: !apply,
  createVerifiedBackup: () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return createAndVerifySqliteBackup(
      dbPath,
      path.join(backupDir, `daogreen_legacy_uploads_${stamp}.db`)
    );
  },
});

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  migration: result.migration,
  actions: result.actions.map((item) => ({
    from: item.url,
    to: item.destinationUrl,
    materials: item.materialIds.length,
    branding: item.settingKeys.length,
    collision: item.collision,
  })),
  skipped: result.skipped.map((item) => ({ url: item.url, reason: item.reason })),
  applied: result.applied,
}, null, 2));
