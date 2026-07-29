/**
 * Local / remote-safe deploy step for material EN translations.
 *
 * Order:
 *   schema already via initDb
 *   → dry-run (fail-closed on errors / unknown IDs)
 *   → verified backup + apply (idempotent)
 *   → integrity + FK checks
 *
 * Usage:
 *   node scripts/run-material-translations-deploy-step.mjs
 *   node scripts/run-material-translations-deploy-step.mjs --dry-run-only
 *
 * Env:
 *   DATABASE_PATH, UPLOAD_ROOT (optional)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const dryRunOnly = process.argv.includes("--dry-run-only");
const nodeBin = process.execPath;
const backendDir = path.join(root, "backend");
const importScript = path.join(backendDir, "scripts", "importMaterialTranslations.mjs");
const dataFile = path.join(backendDir, "data", "materialTranslations.en.json");

function runImport(args) {
  const env = { ...process.env };
  const r = spawnSync(nodeBin, [importScript, ...args], {
    cwd: backendDir,
    env,
    encoding: "utf8",
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.status !== 0) {
    const err = new Error(`material translations import failed (exit ${r.status})`);
    err.code = "MATERIAL_TRANSLATIONS_DEPLOY_FAILED";
    throw err;
  }
  return r;
}

function integrityCheck(dbPath) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`database missing: ${dbPath}`);
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const integrity = db.prepare("PRAGMA integrity_check").get()?.integrity_check;
    if (String(integrity).toLowerCase() !== "ok") {
      throw new Error(`integrity_check failed: ${integrity}`);
    }
    const fk = db.prepare("PRAGMA foreign_key_check").all();
    if (Array.isArray(fk) && fk.length) {
      throw new Error(`foreign_key_check rows: ${fk.length}`);
    }
    const mats = db.prepare("SELECT COUNT(*) AS n FROM materials").get()?.n;
    const tr = db.prepare("SELECT COUNT(*) AS n FROM material_translations").get()?.n;
    console.error(`[material-translations-deploy] integrity ok; materials=${mats} translations=${tr}`);
  } finally {
    db.close();
  }
}

function resolveDbPath() {
  if (process.env.DATABASE_PATH) return path.resolve(process.env.DATABASE_PATH);
  return path.join(backendDir, "data", "daogreen.db");
}

if (!fs.existsSync(dataFile)) {
  console.error(`[material-translations-deploy] missing ${dataFile}`);
  process.exit(1);
}
if (!fs.existsSync(importScript)) {
  console.error(`[material-translations-deploy] missing ${importScript}`);
  process.exit(1);
}

try {
  console.error("[material-translations-deploy] dry-run…");
  runImport([]);
  if (dryRunOnly) {
    console.error("[material-translations-deploy] dry-run-only OK");
    process.exit(0);
  }
  console.error("[material-translations-deploy] apply…");
  runImport(["--apply"]);
  integrityCheck(resolveDbPath());
  console.error("[material-translations-deploy] OK");
  process.exit(0);
} catch (e) {
  console.error(JSON.stringify({
    ok: false,
    error: e.message,
    code: e.code || "MATERIAL_TRANSLATIONS_DEPLOY_FAILED",
  }, null, 2));
  process.exit(1);
}
