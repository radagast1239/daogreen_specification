/**
 * Перепривязка устаревших materialId в шаблонах (ферма/стеллажи) и project_items.
 * Таблица materials НЕ изменяется.
 *
 *   node backend/scripts/remapOrphanMaterialIds.mjs           # dry-run
 *   node backend/scripts/remapOrphanMaterialIds.mjs --apply # запись в БД
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { initDb, db, getDbPath, rowToMaterial } from "../src/db.js";
import {
  resolveOrphanMaterialId,
  projectItemPatchFromMaterial,
} from "../../shared/orphanMaterialRemap.js";
import {
  cleanStellageCatalogs,
  cleanStellageModuleMeta,
  parseSettingsJson,
} from "../../shared/cleanStellageCatalogs.js";
import {
  cleanFarmSectionCatalogs,
  cleanFarmSectionVersions,
  parseFarmSections,
} from "../../shared/cleanFarmSectionCatalogs.js";
import { seedModules } from "../../src/data/modules.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apply = process.argv.includes("--apply");

function parseJson(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function loadSettings() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function saveSettingsKey(key, value) {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, typeof value === "string" ? value : JSON.stringify(value));
}

initDb();
const UPDATE_ITEM_MATERIAL = db.prepare(`
  UPDATE project_items SET
    material_id=@material_id, name=@name, unit=@unit, category=@category,
    supplier=@supplier, link=@link, link_alt=@link_alt, photo_url=@photo_url,
    client_note=@client_note, tech_note=@tech_note, price=@price, vat_rate=@vat_rate,
    client_section=@client_section, client_subsection=@client_subsection
  WHERE id=@id AND project_id=@project_id
`);
const materials = db.prepare("SELECT * FROM materials").all().map(rowToMaterial);
const materialIds = new Set(materials.map((m) => m.id));
const materialById = Object.fromEntries(materials.map((m) => [m.id, m]));

console.log(`Режим: ${apply ? "APPLY" : "dry-run"}`);
console.log(`Материалов в базе: ${materials.length} (таблица materials не меняется)`);

const settings = loadSettings();
const farmSections = parseFarmSections(settings.farmSections);
const farmClean = cleanFarmSectionCatalogs(parseSettingsJson(settings.farmSectionCatalogs), materials, farmSections);
const farmVersionsClean = cleanFarmSectionVersions(parseSettingsJson(settings.farmSectionVersions), materials, farmSections);
const farm = {
  next: farmClean.next,
  report: [
    ...farmClean.report.remapped.map((r) => ({
      kind: "farm",
      catalogKey: r.sectionId,
      oldId: r.oldId,
      newId: r.newId,
      name: r.name,
      status: "remapped",
    })),
    ...farmClean.report.dropped.map((r) => ({
      kind: "farm",
      catalogKey: r.sectionId,
      oldId: r.materialId,
      name: r.name,
      status: "dropped",
    })),
  ],
};
const officialStellageIds = seedModules.filter((m) => m.type === "stellage").map((m) => m.id);
const stellageClean = cleanStellageCatalogs(parseSettingsJson(settings.stellageModuleCatalogs), materials, {
  officialModuleIds: officialStellageIds,
});
const stellageMetaClean = cleanStellageModuleMeta(parseSettingsJson(settings.stellageModuleMeta), officialStellageIds);
const stellage = {
  next: stellageClean.next,
  changed: stellageClean.stats.linesRemapped + stellageClean.stats.linesDropped + stellageClean.stats.modulesRemoved + stellageClean.stats.linesDeduped,
  report: [
    ...stellageClean.report.remapped.map((r) => ({
      kind: "stellage",
      catalogKey: r.moduleId,
      oldId: r.oldId,
      newId: r.newId,
      name: r.name,
      status: "remapped",
    })),
    ...stellageClean.report.dropped.map((r) => ({
      kind: "stellage",
      catalogKey: r.moduleId,
      oldId: r.materialId,
      name: r.name,
      status: "dropped",
    })),
  ],
};

console.log(`\nШаблоны фермы: remapped=${farmClean.stats.linesRemapped}, dropped=${farmClean.stats.linesDropped}, sections removed=${farmClean.stats.sectionsRemoved}, deduped=${farmClean.stats.linesDeduped}`);
console.log(`Версии разделов фермы: remapped=${farmVersionsClean.stats.linesRemapped}, dropped=${farmVersionsClean.stats.linesDropped}`);
console.log(`Шаблоны стеллажей: remapped=${stellageClean.stats.linesRemapped}, dropped=${stellageClean.stats.linesDropped}, modules removed=${stellageClean.stats.modulesRemoved}, deduped=${stellageClean.stats.linesDeduped}`);
if (stellageMetaClean.removed.length) {
  console.log(`stellageModuleMeta удалено ключей: ${stellageMetaClean.removed.join(", ")}`);
}

const remapped = [...farm.report, ...stellage.report].filter((r) => r.status === "remapped");
const dropped = [...farm.report, ...stellage.report].filter((r) => r.status === "dropped");
if (remapped.length) {
  console.log("\nПерепривязки в шаблонах:");
  for (const r of remapped) console.log(`  [${r.kind}/${r.catalogKey}] ${r.oldId} → ${r.newId} | ${r.name}`);
}
if (dropped.length) {
  console.log("\nУдалено из шаблонов (нет в базе):");
  for (const r of dropped) console.log(`  [${r.kind}/${r.catalogKey}] ${r.oldId} | ${r.name || "—"}`);
}

const itemRows = db
  .prepare("SELECT id, project_id, material_id, name, module FROM project_items WHERE material_id IS NOT NULL AND material_id != ''")
  .all();
const itemPlan = [];
for (const row of itemRows) {
  const oldId = row.material_id;
  if (materialIds.has(oldId)) continue;
  const newId = resolveOrphanMaterialId(oldId, row.name, materials, materialIds);
  if (!newId) {
    itemPlan.push({ ...row, status: "unresolved" });
    continue;
  }
  itemPlan.push({ ...row, newId, status: "remap" });
}

console.log(`\nПозиции проектов: к перепривязке ${itemPlan.filter((r) => r.status === "remap").length}, без пары ${itemPlan.filter((r) => r.status === "unresolved").length}`);

if (!apply) {
  console.log("\nЗапустите с --apply для записи в БД.");
  process.exit(itemPlan.some((r) => r.status === "unresolved") ? 1 : 0);
}

const dbPath = getDbPath();
const backupPath = `${dbPath}.bak-remap-${new Date().toISOString().replace(/[:.]/g, "-")}`;
fs.copyFileSync(dbPath, backupPath);
console.log(`\nБэкап БД: ${backupPath}`);

const settingsBackupDir = path.join(__dirname, "../data/backups");
fs.mkdirSync(settingsBackupDir, { recursive: true });
const settingsBackup = path.join(
  settingsBackupDir,
  `settings-before-remap-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
);
fs.writeFileSync(
  settingsBackup,
  JSON.stringify(
    {
      farmSectionCatalogs: settings.farmSectionCatalogs,
      stellageModuleCatalogs: settings.stellageModuleCatalogs,
    },
    null,
    2
  )
);
console.log(`Бэкап settings: ${settingsBackup}`);

saveSettingsKey("farmSectionCatalogs", JSON.stringify(farmClean.next));
saveSettingsKey("farmSectionVersions", JSON.stringify(farmVersionsClean.next));
saveSettingsKey("stellageModuleCatalogs", JSON.stringify(stellageClean.next));
saveSettingsKey("stellageModuleMeta", JSON.stringify(stellageMetaClean.next));

const touchedProjects = new Set();
let itemsUpdated = 0;
for (const plan of itemPlan) {
  if (plan.status !== "remap") continue;
  const mat = materialById[plan.newId];
  if (!mat) continue;
  UPDATE_ITEM_MATERIAL.run({
    id: plan.id,
    project_id: plan.project_id,
    ...projectItemPatchFromMaterial(mat),
  });
  touchedProjects.add(plan.project_id);
  itemsUpdated++;
}

db.exec("PRAGMA wal_checkpoint(FULL)");

console.log(`\nГотово. Ферма: ${farmClean.stats.totalLines} строк, стеллажи: ${stellageClean.stats.totalLines} строк. Позиций в проектах: ${itemsUpdated}. Проектов: ${touchedProjects.size}.`);
