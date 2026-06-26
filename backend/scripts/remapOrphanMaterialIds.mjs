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
  hydrateLineFromMaterial,
  projectItemPatchFromMaterial,
} from "../../shared/orphanMaterialRemap.js";

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

function remapCatalog(catalogs, materials, materialIds, label) {
  const report = [];
  let changed = 0;
  const next = {};
  for (const [catalogKey, lines] of Object.entries(catalogs || {})) {
    if (!Array.isArray(lines)) {
      next[catalogKey] = lines;
      continue;
    }
    next[catalogKey] = lines.map((ln) => {
      const oldId = ln.materialId || "";
      if (!oldId || materialIds.has(oldId)) return ln;
      const newId = resolveOrphanMaterialId(oldId, ln.name, materials, materialIds);
      if (!newId) {
        report.push({ kind: label, catalogKey, oldId, name: ln.name, status: "unresolved" });
        return ln;
      }
      const mat = materials.find((m) => m.id === newId);
      const hydrated = hydrateLineFromMaterial({ ...ln, materialId: newId }, mat);
      changed++;
      report.push({ kind: label, catalogKey, oldId, newId, name: ln.name, status: "remapped" });
      return hydrated;
    });
  }
  return { next, changed, report };
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
const farmCatalogs = parseJson(settings.farmSectionCatalogs, {});
const stellageCatalogs = parseJson(settings.stellageModuleCatalogs, {});

const farm = remapCatalog(farmCatalogs, materials, materialIds, "farm");
const stellage = remapCatalog(stellageCatalogs, materials, materialIds, "stellage");

console.log(`\nШаблоны фермы: перепривязано строк ${farm.changed}`);
console.log(`Шаблоны стеллажей: перепривязано строк ${stellage.changed}`);

const unresolved = [...farm.report, ...stellage.report].filter((r) => r.status === "unresolved");
const remapped = [...farm.report, ...stellage.report].filter((r) => r.status === "remapped");
if (remapped.length) {
  console.log("\nПерепривязки в шаблонах:");
  for (const r of remapped) console.log(`  [${r.kind}/${r.catalogKey}] ${r.oldId} → ${r.newId} | ${r.name}`);
}
if (unresolved.length) {
  console.log("\nНе удалось перепривязать (шаблоны):");
  for (const r of unresolved) console.log(`  [${r.kind}/${r.catalogKey}] ${r.oldId} | ${r.name}`);
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
  process.exit(unresolved.length || itemPlan.some((r) => r.status === "unresolved") ? 1 : 0);
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

saveSettingsKey("farmSectionCatalogs", JSON.stringify(farm.next));
saveSettingsKey("stellageModuleCatalogs", JSON.stringify(stellage.next));

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

console.log(`\nГотово. Шаблоны: ферма ${farm.changed}, стеллажи ${stellage.changed}. Позиций в проектах: ${itemsUpdated}. Проектов: ${touchedProjects.size}.`);
