import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db, getDbPath, initDb } from "../src/db.js";
import { createAndVerifySqliteBackup } from "../src/sqliteBackup.js";
import { importMaterialTranslations } from "../src/services/materialTranslationService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apply = process.argv.includes("--apply");
const dataPathArg = process.argv.find((a) => a.startsWith("--file="));
const dataPath = dataPathArg
  ? path.resolve(dataPathArg.slice("--file=".length))
  : path.join(__dirname, "../data/materialTranslations.en.json");

initDb();

if (!fs.existsSync(dataPath)) {
  console.error(`[material-translations] missing data file: ${dataPath}`);
  process.exit(1);
}

const payload = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const records = Array.isArray(payload.translations) ? payload.translations : [];
const glossary = payload.glossary || {};

if (!apply) {
  const result = importMaterialTranslations(records, { dryRun: true, glossary });
  console.log(JSON.stringify({ mode: "dry-run", file: dataPath, ...result }, null, 2));
  console.error(
    `[material-translations] DRY-RUN planned=${result.planned} errors=${result.errors?.length || 0} skipped=${result.skipped?.length || 0}`,
  );
  process.exit(result.errors?.length ? 1 : 0);
}

const dbPath = getDbPath();
const backupDir = path.join(path.dirname(dbPath), "pre-migration-backups");
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = createAndVerifySqliteBackup(
  dbPath,
  path.join(backupDir, `daogreen_material_translations_${stamp}.db`),
);
if (!backup?.ok) {
  console.error(JSON.stringify({ ok: false, error: "Verified backup failed", code: "BACKUP_REQUIRED" }, null, 2));
  process.exit(1);
}

try {
  const result = importMaterialTranslations(records, { dryRun: false, glossary });
  console.log(JSON.stringify({
    mode: "apply",
    file: dataPath,
    backup: backup.path || backup.dest || null,
    ...result,
  }, null, 2));
  console.error(
    `[material-translations] APPLY applied=${result.applied} errors=${result.errors?.length || 0} skipped=${result.skipped?.length || 0}`,
  );
  process.exit(result.errors?.length ? 1 : 0);
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: error.message,
    code: error.code,
    details: error.details || null,
  }, null, 2));
  process.exit(1);
}

void db;
