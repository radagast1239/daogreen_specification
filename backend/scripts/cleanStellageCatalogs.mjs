/**
 * Очистка шаблонов стеллажей: remapping старых materialId, удаление призраков, slim-формат.
 * База materials не меняется.
 *
 *   node backend/scripts/cleanStellageCatalogs.mjs
 *   node backend/scripts/cleanStellageCatalogs.mjs --apply
 *   node backend/scripts/cleanStellageCatalogs.mjs --apply --settings backend/data/settings-live.json --materials backend/data/materials-live.json
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { initDb, db, getDbPath, rowToMaterial } from "../src/db.js";
import {
  cleanStellageCatalogs,
  cleanStellageModuleMeta,
  parseSettingsJson,
} from "../../shared/cleanStellageCatalogs.js";
import { seedModules } from "../../src/data/modules.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "../..");
const apply = process.argv.includes("--apply");

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : "";
}

const settingsPath = argValue("--settings");
const materialsPath = argValue("--materials");
const useJsonFiles = !!(settingsPath && materialsPath);

function loadMaterialsFromJson(p) {
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  return Array.isArray(raw) ? raw : [];
}

function loadSettingsFromJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function saveSettingsKey(key, value) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, typeof value === "string" ? value : JSON.stringify(value));
}

function printReport(report, stats) {
  console.log("\n--- Сводка ---");
  console.log(JSON.stringify(stats, null, 2));
  if (report.removedModules.length) {
    console.log("\nУдалённые шаблоны модулей:");
    for (const r of report.removedModules) console.log(`  · ${r.moduleId} (${r.lines} строк) — ${r.reason}`);
  }
  if (report.remapped.length) {
    console.log(`\nПерепривязано ID: ${report.remapped.length}`);
    const uniq = new Map();
    for (const r of report.remapped) uniq.set(`${r.oldId}→${r.newId}`, r);
    for (const r of uniq.values()) console.log(`  · ${r.oldId} → ${r.newId}`);
  }
  if (report.dropped.length) {
    console.log(`\nУдалены строки без материала в базе: ${report.dropped.length}`);
    for (const r of report.dropped.slice(0, 15)) {
      console.log(`  · [${r.moduleId}] ${r.materialId || "—"} ${r.reason}`);
    }
  }
  if (report.deduped.length) console.log(`\nСхлопнуто дублей materialId: ${report.deduped.length}`);
}

const officialIds = seedModules.filter((m) => m.type === "stellage").map((m) => m.id);

let materials;
let settings;
let settingsIsFlat = false;

if (useJsonFiles) {
  materials = loadMaterialsFromJson(path.resolve(root, materialsPath));
  settings = loadSettingsFromJson(path.resolve(root, settingsPath));
  settingsIsFlat = true;
  console.log(`Режим: JSON (${apply ? "APPLY" : "dry-run"})`);
} else {
  try {
    initDb();
    materials = db.prepare("SELECT * FROM materials").all().map(rowToMaterial);
    const rows = db.prepare("SELECT key, value FROM settings").all();
    settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    console.log(`Режим: SQLite ${getDbPath()} (${apply ? "APPLY" : "dry-run"})`);
  } catch (e) {
    console.error("БД недоступна. Укажите --settings и --materials для JSON.");
    console.error(e.message);
    process.exit(1);
  }
}

console.log(`Материалов в базе: ${materials.length}`);

const rawCatalogs = parseSettingsJson(settings.stellageModuleCatalogs);
const rawMeta = parseSettingsJson(settings.stellageModuleMeta);

const { next: catalogs, report, stats } = cleanStellageCatalogs(rawCatalogs, materials, {
  officialModuleIds: officialIds,
});
const { next: meta, removed: metaRemoved } = cleanStellageModuleMeta(rawMeta, officialIds);

printReport(report, stats);
if (metaRemoved.length) console.log(`\nУдалено из stellageModuleMeta: ${metaRemoved.join(", ")}`);

const catalogsJson = JSON.stringify(catalogs);
const metaJson = JSON.stringify(meta);
const changed =
  catalogsJson !== JSON.stringify(rawCatalogs) || metaJson !== JSON.stringify(rawMeta);

if (!changed) {
  console.log("\nИзменений нет — шаблоны уже чистые.");
  process.exit(0);
}

if (!apply) {
  console.log("\nЗапустите с --apply для записи.");
  process.exit(0);
}

if (useJsonFiles) {
  const absSettings = path.resolve(root, settingsPath);
  const backup = absSettings.replace(/\.json$/i, `.bak-stellage-${Date.now()}.json`);
  fs.copyFileSync(absSettings, backup);
  console.log(`\nБэкап settings: ${backup}`);
  settings.stellageModuleCatalogs = catalogsJson;
  settings.stellageModuleMeta = metaJson;
  fs.writeFileSync(absSettings, JSON.stringify(settings, null, 2));
  console.log(`Записано: ${absSettings}`);
} else {
  const backupDir = path.join(__dirname, "../data/backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `settings-before-stellage-clean-${stamp}.json`);
  fs.writeFileSync(
    backupPath,
    JSON.stringify(
      { stellageModuleCatalogs: settings.stellageModuleCatalogs, stellageModuleMeta: settings.stellageModuleMeta },
      null,
      2
    )
  );
  console.log(`\nБэкап settings: ${backupPath}`);
  saveSettingsKey("stellageModuleCatalogs", catalogsJson);
  saveSettingsKey("stellageModuleMeta", metaJson);
  db.exec("PRAGMA wal_checkpoint(FULL)");
  console.log("Записано в SQLite settings.");
}

console.log("\nГотово.");
