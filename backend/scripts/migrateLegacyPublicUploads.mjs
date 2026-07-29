import path from "path";
import { db, getDbPath } from "../src/db.js";
import { resolveUploadRoot } from "../src/services/uploadRoot.js";
import { createAndVerifySqliteBackup } from "../src/sqliteBackup.js";
import { runLegacyPublicUploadMigration } from "../src/services/legacyPublicUploadMigration.js";

const apply = process.argv.includes("--apply");
const copyToPublic = process.argv.includes("--copy-to-public");
const uploadRoot = resolveUploadRoot();
const dbPath = getDbPath();
const backupDir = path.join(path.dirname(dbPath), "pre-migration-backups");

const result = runLegacyPublicUploadMigration({
  db,
  uploadRoot,
  dryRun: !apply,
  mode: copyToPublic ? "copy-to-public" : "strict",
  createVerifiedBackup: () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return createAndVerifySqliteBackup(
      dbPath,
      path.join(backupDir, `daogreen_legacy_uploads_${stamp}.db`)
    );
  },
});

const counts = result.counts || {
  actions: result.actions?.length || 0,
  skipped: result.skipped?.length || 0,
  applied: result.applied || 0,
};

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  migrationMode: result.mode || (copyToPublic ? "copy-to-public" : "strict"),
  migration: result.migration,
  counts,
  actions: (result.actions || []).map((item) => ({
    from: item.url,
    to: item.destinationUrl,
    materials: item.materialIds.length,
    branding: item.settingKeys.length,
    collision: item.collision,
  })),
  skipped: (result.skipped || []).map((item) => ({ url: item.url, reason: item.reason })),
  applied: result.applied,
}, null, 2));

console.error(
  `[legacy-public-uploads] ${apply ? "APPLY" : "DRY-RUN"} mode=${result.mode || "strict"} ` +
  `actions=${counts.actions} skipped=${counts.skipped} applied=${counts.applied}`
);
