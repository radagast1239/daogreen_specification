/**
 * Сравнение каталогов фермы/стеллажей и позиций проекта с базой материалов.
 */
import { initDb, db, rowToMaterial, rowToItem } from "../src/db.js";
import { listModulesAdmin } from "../src/routes/materials.js";

function parseJson(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function settingsMap() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const o = {};
  for (const r of rows) o[r.key] = r.value;
  return o;
}

function auditCatalogLines(label, catalogs, materialIds, materialById) {
  const issues = {
    noMaterialId: [],
    orphanMaterialId: [],
    duplicateMaterialId: [],
  };
  const seen = new Map();

  for (const [catalogKey, lines] of Object.entries(catalogs || {})) {
    if (!Array.isArray(lines)) continue;
    for (const ln of lines) {
      const name = (ln.name || "").trim();
      const mid = ln.materialId || "";
      const row = { catalogKey, name, materialId: mid, qty: ln.qty, defaultQty: ln.defaultQty };

      if (!mid) {
        issues.noMaterialId.push(row);
        continue;
      }
      if (!materialIds.has(mid)) {
        issues.orphanMaterialId.push(row);
      }
      const k = `${catalogKey}::${mid}`;
      if (seen.has(k)) issues.duplicateMaterialId.push({ ...row, dupOf: seen.get(k) });
      else seen.set(k, name);
    }
  }

  console.log(`\n=== ${label} ===`);
  console.log(`  Каталогов/ключей: ${Object.keys(catalogs || {}).length}`);
  const totalLines = Object.values(catalogs || {}).reduce((n, a) => n + (Array.isArray(a) ? a.length : 0), 0);
  console.log(`  Строк в каталогах: ${totalLines}`);
  console.log(`  Без materialId (ручные/левые): ${issues.noMaterialId.length}`);
  console.log(`  materialId нет в базе: ${issues.orphanMaterialId.length}`);
  console.log(`  Дубли materialId в одном каталоге: ${issues.duplicateMaterialId.length}`);

  function show(title, list, map) {
    if (!list.length) return;
    console.log(`\n  --- ${title} (${list.length}) ---`);
    list.slice(0, 25).forEach((x) => console.log("   ", map(x)));
    if (list.length > 25) console.log(`    … ещё ${list.length - 25}`);
  }

  show("Без materialId", issues.noMaterialId, (x) => `[${x.catalogKey}] ${x.name}`);
  show("Сироты (id не в базе)", issues.orphanMaterialId, (x) => `[${x.catalogKey}] ${x.materialId} — ${x.name}`);
  show("Дубли", issues.duplicateMaterialId, (x) => `[${x.catalogKey}] ${x.materialId} — ${x.name}`);

  return issues;
}

initDb();
const materials = db.prepare("SELECT * FROM materials WHERE status != 'archived' OR status IS NULL").all().map(rowToMaterial);
const allMaterials = db.prepare("SELECT * FROM materials").all().map(rowToMaterial);
const materialIds = new Set(allMaterials.map((m) => m.id));
const materialById = Object.fromEntries(allMaterials.map((m) => [m.id, m]));
const modules = listModulesAdmin({ includeArchived: true });
const settings = settingsMap();

const farmCatalogs = parseJson(settings.farmSectionCatalogs, {});
const stellageCatalogs = parseJson(settings.stellageModuleCatalogs, {});

console.log("=== БАЗА МАТЕРИАЛОВ ===");
console.log(`  Всего записей: ${allMaterials.length}`);
console.log(`  Активных (не archived): ${materials.length}`);

const farmIssues = auditCatalogLines("РАЗДЕЛЫ ФЕРМЫ (farmSectionCatalogs)", farmCatalogs, materialIds, materialById);
const stIssues = auditCatalogLines("СТЕЛЛАЖИ (stellageModuleCatalogs)", stellageCatalogs, materialIds, materialById);

// Уникальные materialId в каталогах
function uniqueMids(catalogs) {
  const s = new Set();
  for (const lines of Object.values(catalogs || {})) {
    if (!Array.isArray(lines)) continue;
    for (const ln of lines) if (ln.materialId) s.add(ln.materialId);
  }
  return s;
}
const farmMids = uniqueMids(farmCatalogs);
const stMids = uniqueMids(stellageCatalogs);
const inFarmNotInDb = [...farmMids].filter((id) => !materialIds.has(id));
const inStNotInDb = [...stMids].filter((id) => !materialIds.has(id));
const inDbNotInFarm = [...materialIds].filter((id) => !farmMids.has(id) && !stMids.has(id));

console.log("\n=== СВОДКА materialId ===");
console.log(`  Уникальных в разделах фермы: ${farmMids.size}`);
console.log(`  Уникальных в стеллажах: ${stMids.size}`);
console.log(`  В ферме, но нет в базе: ${inFarmNotInDb.length}`);
console.log(`  В стеллажах, но нет в базе: ${inStNotInDb.length}`);

// Проекты
const projects = db.prepare("SELECT id, name, client_token FROM projects").all();
console.log("\n=== ПРОЕКТЫ ===");
for (const p of projects) {
  const items = db.prepare("SELECT * FROM project_items WHERE project_id = ? ORDER BY sort_order").all(p.id).map(rowToItem);
  const withMid = items.filter((it) => it.materialId);
  const noMid = items.filter((it) => !it.materialId);
  const orphanMid = withMid.filter((it) => !materialIds.has(it.materialId));
  const uniqueMidsInProject = new Set(withMid.map((it) => it.materialId));

  const byModule = {};
  for (const it of items) {
    byModule[it.module || "(без модуля)"] = (byModule[it.module || "(без модуля)"] || 0) + 1;
  }

  console.log(`\n  Проект: ${p.name} (${p.id})`);
  console.log(`    Строк в спецификации: ${items.length}`);
  console.log(`    С materialId (это число в диалоге «Обновить»): ${withMid.length}`);
  console.log(`    Уникальных materialId: ${uniqueMidsInProject.size}`);
  console.log(`    Без materialId (ручные): ${noMid.length}`);
  console.log(`    materialId не в базе: ${orphanMid.length}`);
  console.log(`    По модулям: ${JSON.stringify(byModule)}`);

  if (noMid.length) {
    console.log("    Ручные позиции (без materialId):");
    noMid.slice(0, 15).forEach((it) => console.log(`      - [${it.module}] ${it.name} qty=${it.qty}`));
    if (noMid.length > 15) console.log(`      … ещё ${noMid.length - 15}`);
  }
  if (orphanMid.length) {
    console.log("    Сироты в проекте:");
    orphanMid.slice(0, 10).forEach((it) => console.log(`      - ${it.materialId} [${it.module}] ${it.name}`));
  }

  // Дубли materialId в проекте (разные item.id, один materialId)
  const midCount = {};
  for (const it of withMid) midCount[it.materialId] = (midCount[it.materialId] || 0) + 1;
  const dupMats = Object.entries(midCount).filter(([, c]) => c > 1);
  const extraFromDupes = dupMats.reduce((s, [, c]) => s + c - 1, 0);
  console.log(`    Повторы одного materialId (лишние строки): ${extraFromDupes} (${dupMats.length} материалов × несколько стеллажей/комнат)`);
  if (dupMats.length) {
    const top = dupMats.sort((a, b) => b[1] - a[1]).slice(0, 8);
    for (const [mid, c] of top) {
      const mat = materialById[mid];
      console.log(`      ×${c}  ${mat?.name || mid}`);
    }
  }
}

// Модули legacy catalog
console.log("\n=== МОДУЛИ (привязка материалов по module name) ===");
for (const mod of modules.filter((m) => m.active)) {
  const linked = allMaterials.filter((m) => {
    const mods = m.modules?.length ? m.modules : m.module ? [m.module] : [];
    return mods.includes(mod.name);
  });
  if (mod.type === "stellage") {
    const cat = stellageCatalogs[mod.id];
    const catLen = Array.isArray(cat) ? cat.length : 0;
    console.log(`  [stellage] ${mod.name}: материалов по тегу=${linked.length}, строк в шаблоне=${catLen}`);
  } else if (mod.farmSectionId) {
    const cat = farmCatalogs[mod.farmSectionId];
    const catLen = Array.isArray(cat) ? cat.length : 0;
    console.log(`  [farm] ${mod.name} → ${mod.farmSectionId}: материалов по тегу=${linked.length}, строк в каталоге=${catLen}`);
  }
}
