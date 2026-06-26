/**
 * Одноразовая нормализация шаблонов: убрать дубликаты полей материалов из settings.
 * Оставляет materialId + defaultQty + subcategory (или name/unit для черновиков без materialId).
 *
 * node backend/scripts/normalizeCatalogSettings.mjs
 * node backend/scripts/normalizeCatalogSettings.mjs --apply
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { normalizeStoredCatalog } from "../../shared/catalogLine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apply = process.argv.includes("--apply");

function getDbPath() {
  return process.env.DB_PATH || path.join(__dirname, "../data/daogreen.db");
}

function parseJson(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function normalizeCatalogObject(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { next: obj, changed: false };
  const next = {};
  let changed = false;
  for (const [k, v] of Object.entries(obj)) {
    if (!Array.isArray(v)) {
      next[k] = v;
      continue;
    }
    const slim = normalizeStoredCatalog(v);
    next[k] = slim;
    if (JSON.stringify(slim) !== JSON.stringify(v)) changed = true;
  }
  return { next, changed };
}

const db = new Database(getDbPath());
const rows = db.prepare("SELECT key, value FROM settings WHERE key IN (?, ?)").all(
  "farmSectionCatalogs",
  "stellageModuleCatalogs"
);
const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));

const farm = normalizeCatalogObject(parseJson(settings.farmSectionCatalogs, {}));
const stellage = normalizeCatalogObject(parseJson(settings.stellageModuleCatalogs, {}));

console.log(`Режим: ${apply ? "APPLY" : "dry-run"}`);
console.log(`farmSectionCatalogs: ${farm.changed ? "есть изменения" : "без изменений"}`);
console.log(`stellageModuleCatalogs: ${stellage.changed ? "есть изменения" : "без изменений"}`);

if (!farm.changed && !stellage.changed) {
  console.log("Нормализация не требуется.");
  process.exit(0);
}

if (!apply) {
  console.log("\nЗапустите с --apply для записи в БД.");
  process.exit(0);
}

const backupDir = path.join(__dirname, "../data/backups");
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = path.join(backupDir, `settings-before-normalize-${stamp}.json`);
fs.writeFileSync(backupPath, JSON.stringify(settings, null, 2));
console.log(`Бэкап: ${backupPath}`);

const upsert = db.prepare(
  "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
);
if (farm.changed) upsert.run("farmSectionCatalogs", JSON.stringify(farm.next));
if (stellage.changed) upsert.run("stellageModuleCatalogs", JSON.stringify(stellage.next));
console.log("Готово.");
