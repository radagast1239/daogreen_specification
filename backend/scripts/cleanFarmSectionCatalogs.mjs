/**
 * Очистка каталогов разделов фермы: remapping, slim-формат, только materialId из базы.
 * База materials не меняется.
 *
 *   node backend/scripts/cleanFarmSectionCatalogs.mjs
 *   node backend/scripts/cleanFarmSectionCatalogs.mjs --apply
 *   node backend/scripts/cleanFarmSectionCatalogs.mjs --apply --settings backend/data/settings-live.json --materials backend/data/materials-live.json
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { initDb, db, getDbPath, rowToMaterial } from "../src/db.js";
import {
  cleanFarmSectionCatalogs,
  cleanFarmSectionVersions,
  parseFarmSections,
  parseSettingsJson,
} from "../../shared/cleanFarmSectionCatalogs.js";

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

function saveSettingsKey(key, value) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, typeof value === "string" ? value : JSON.stringify(value));
}

function printReport(label, report, stats) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(stats, null, 2));
  if (report.removedSections?.length) {
    console.log("Удалённые ключи разделов:");
    for (const r of report.removedSections) {
      console.log(`  · ${r.sectionId} (${r.lines} записей) — ${r.reason}`);
    }
  }
  if (report.remapped.length) {
    console.log(`Перепривязано ID: ${report.remapped.length}`);
    const uniq = new Map();
    for (const r of report.remapped) uniq.set(`${r.oldId}→${r.newId}`, r);
    for (const r of uniq.values()) console.log(`  · ${r.oldId} → ${r.newId}`);
  }
  if (report.dropped.length) {
    console.log(`Удалены строки (нет в базе): ${report.dropped.length}`);
    for (const r of report.dropped.slice(0, 12)) {
      console.log(`  · [${r.sectionId}] ${r.materialId || "—"} ${r.name || ""} (${r.reason})`);
    }
    if (report.dropped.length > 12) console.log(`  … ещё ${report.dropped.length - 12}`);
  }
  if (report.deduped.length) console.log(`Схлопнуто дублей: ${report.deduped.length}`);
}

let materials;
let settings;

if (useJsonFiles) {
  materials = loadMaterialsFromJson(path.resolve(root, materialsPath));
  settings = JSON.parse(fs.readFileSync(path.resolve(root, settingsPath), "utf8"));
  console.log(`Режим: JSON (${apply ? "APPLY" : "dry-run"})`);
} else {
  try {
    initDb();
    materials = db.prepare("SELECT * FROM materials").all().map(rowToMaterial);
    const rows = db.prepare("SELECT key, value FROM settings").all();
    settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    console.log(`Режим: SQLite ${getDbPath()} (${apply ? "APPLY" : "dry-run"})`);
  } catch (e) {
    console.error("БД недоступна. Укажите --settings и --materials.");
    console.error(e.message);
    process.exit(1);
  }
}

console.log(`Материалов в базе: ${materials.length}`);

const farmSections = parseFarmSections(settings.farmSections);
const rawCatalogs = parseSettingsJson(settings.farmSectionCatalogs);
const rawVersions = parseSettingsJson(settings.farmSectionVersions);

const farmClean = cleanFarmSectionCatalogs(rawCatalogs, materials, farmSections);
const versionsClean = cleanFarmSectionVersions(rawVersions, materials, farmSections);

printReport("farmSectionCatalogs", farmClean.report, farmClean.stats);
printReport("farmSectionVersions", versionsClean.report, versionsClean.stats);

const catalogsJson = JSON.stringify(farmClean.next);
const versionsJson = JSON.stringify(versionsClean.next);
const changed =
  catalogsJson !== JSON.stringify(rawCatalogs) || versionsJson !== JSON.stringify(rawVersions);

if (!changed) {
  console.log("\nИзменений нет — каталоги фермы уже чистые.");
  process.exit(0);
}

// verify zero orphans
const byId = new Set(materials.map((m) => m.id));
let orphans = 0;
for (const lines of Object.values(farmClean.next)) {
  for (const ln of lines) {
    if (ln.materialId && !byId.has(ln.materialId)) orphans++;
  }
}
console.log(`\nПроверка: сирот в каталогах после очистки: ${orphans}`);

if (!apply) {
  console.log("\nЗапустите с --apply для записи.");
  process.exit(orphans > 0 ? 1 : 0);
}

if (useJsonFiles) {
  const absSettings = path.resolve(root, settingsPath);
  const backup = absSettings.replace(/\.json$/i, `.bak-farm-${Date.now()}.json`);
  fs.copyFileSync(absSettings, backup);
  console.log(`\nБэкап settings: ${backup}`);
  settings.farmSectionCatalogs = catalogsJson;
  settings.farmSectionVersions = versionsJson;
  fs.writeFileSync(absSettings, JSON.stringify(settings, null, 2));
  console.log(`Записано: ${absSettings}`);
} else {
  const backupDir = path.join(__dirname, "../data/backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `settings-before-farm-clean-${stamp}.json`);
  fs.writeFileSync(
    backupPath,
    JSON.stringify(
      {
        farmSectionCatalogs: settings.farmSectionCatalogs,
        farmSectionVersions: settings.farmSectionVersions,
      },
      null,
      2
    )
  );
  console.log(`\nБэкап settings: ${backupPath}`);
  saveSettingsKey("farmSectionCatalogs", catalogsJson);
  saveSettingsKey("farmSectionVersions", versionsJson);
  db.exec("PRAGMA wal_checkpoint(FULL)");
  console.log("Записано в SQLite settings.");
}

console.log("\nГотово.");
