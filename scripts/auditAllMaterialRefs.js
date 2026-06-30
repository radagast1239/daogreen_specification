/**
 * Полная сверка materialId по сервису — источник истины: база materials.
 *
 *   node scripts/auditAllMaterialRefs.js
 *   node scripts/auditAllMaterialRefs.js path/to/materials.json path/to/settings.json path/to/projects/*.json
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseStellageModuleCatalogs } from "../src/lib/stellageCatalogConfig.js";
import { parseSettingsJson } from "../shared/cleanStellageCatalogs.js";
import { LEGACY_MATERIAL_ID_MAP } from "../shared/orphanMaterialRemap.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const args = process.argv.slice(2);
const matsPath = args[0] || path.join(root, "backend/data/materials-live.json");
const settingsPath = args[1] || path.join(root, "backend/data/settings-live.json");

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function walk(obj, visit, stack = []) {
  if (obj == null) return;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => walk(v, visit, [...stack, i]));
    return;
  }
  if (typeof obj === "object") {
    visit(obj, stack);
    for (const [k, v] of Object.entries(obj)) walk(v, visit, [...stack, k]);
  }
}

function collectMaterialRefs(obj, source) {
  const refs = [];
  walk(obj, (node, stack) => {
    const mid = node.materialId ?? node.material_id;
    if (mid && typeof mid === "string" && mid.trim()) {
      refs.push({
        source,
        path: stack.join("."),
        materialId: mid.trim(),
        name: node.name || "",
        hasFatFields: !!(node.price || node.supplier || node.photoUrl || node.imageUrl || node.category),
      });
    }
    const alt = node.alternativeMaterialId ?? node.alternative_material_id;
    if (alt && typeof alt === "string" && alt.trim()) {
      refs.push({
        source,
        path: `${stack.join(".")}.alternativeMaterialId`,
        materialId: alt.trim(),
        name: "",
        hasFatFields: false,
      });
    }
  });
  return refs;
}

function auditCatalogObject(catalogs, source, materialIds, archivedIds) {
  const issues = [];
  for (const [key, lines] of Object.entries(catalogs || {})) {
    if (!Array.isArray(lines)) continue;
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const mid = ln.materialId;
      if (!mid) {
        if (ln.name) issues.push({ source, key, line: i, type: "no_id_manual_line", name: ln.name });
        continue;
      }
      if (!materialIds.has(mid)) {
        issues.push({
          source,
          key,
          line: i,
          type: "orphan_id",
          materialId: mid,
          legacyTarget: LEGACY_MATERIAL_ID_MAP[mid] || null,
          name: ln.name,
        });
      } else if (archivedIds.has(mid)) {
        issues.push({ source, key, line: i, type: "archived_id", materialId: mid, name: ln.name });
      }
      if (ln.name || ln.price || ln.supplier || ln.photoUrl) {
        issues.push({ source, key, line: i, type: "fat_catalog_line", materialId: mid, name: ln.name });
      }
    }
  }
  return issues;
}

const materials = loadJson(matsPath);
const settings = loadJson(settingsPath);
const materialIds = new Set(materials.map((m) => m.id));
const archivedIds = new Set(materials.filter((m) => m.status === "archived").map((m) => m.id));

console.log("=== БАЗА МАТЕРИАЛОВ (источник истины) ===");
console.log(`  Всего: ${materials.length}, active: ${materials.filter((m) => m.status !== "archived").length}, archived: ${archivedIds.size}`);

const allIssues = [];
const refCounts = new Map();

function addIssues(list) {
  allIssues.push(...list);
}

// --- Settings catalogs ---
const stCatalogs = parseStellageModuleCatalogs(settings.stellageModuleCatalogs);
const farmCatalogs = parseSettingsJson(settings.farmSectionCatalogs);
const farmVersions = parseSettingsJson(settings.farmSectionVersions);

addIssues(auditCatalogObject(stCatalogs, "stellageModuleCatalogs", materialIds, archivedIds));
addIssues(auditCatalogObject(farmCatalogs, "farmSectionCatalogs", materialIds, archivedIds));

for (const [secId, versions] of Object.entries(farmVersions || {})) {
  if (!Array.isArray(versions)) continue;
  for (let vi = 0; vi < versions.length; vi++) {
    const ver = versions[vi];
    if (!Array.isArray(ver?.catalog)) continue;
    const fake = { [secId]: ver.catalog };
    addIssues(
      auditCatalogObject(fake, `farmSectionVersions[${secId}][${vi}]`, materialIds, archivedIds).map((x) => ({
        ...x,
        savedAt: ver.savedAt,
      }))
    );
  }
}

// Ghost stellage module keys
const ghostStellage = ["mod_4lYb0iHFNK", "mod_sYvrDdu5g-"];
for (const g of ghostStellage) {
  if (stCatalogs[g]?.length) {
    addIssues([
      {
        source: "stellageModuleCatalogs",
        type: "ghost_module",
        key: g,
        lines: stCatalogs[g].length,
      },
    ]);
  }
}

// --- Projects ---
const projectPaths =
  args.length > 2
    ? args.slice(2)
    : [path.join(root, "backend/data/project-live.json"), path.join(root, "backend/data/project-after.json")].filter((p) =>
        fs.existsSync(p)
      );

const projectStats = [];
for (const pp of projectPaths) {
  let projects;
  try {
    const raw = loadJson(pp);
    projects = Array.isArray(raw) ? raw : [raw];
  } catch {
    continue;
  }
  for (const proj of projects) {
    const pid = proj.id || path.basename(pp);
    const items = proj.items || [];
    let orphanItems = 0;
    let noIdManual = 0;
    let archivedItems = 0;
    const orphanIds = new Set();

    for (const it of items) {
      const mid = it.materialId;
      if (!mid) {
        if (it.name) noIdManual++;
        continue;
      }
      refCounts.set(mid, (refCounts.get(mid) || 0) + 1);
      if (!materialIds.has(mid)) {
        orphanItems++;
        orphanIds.add(mid);
        addIssues([
          {
            source: `project:${pid}`,
            type: "orphan_id",
            materialId: mid,
            legacyTarget: LEGACY_MATERIAL_ID_MAP[mid] || null,
            name: it.name,
            module: it.module,
          },
        ]);
      } else if (archivedIds.has(mid)) archivedItems++;
    }

    // stellageConfigs items - usually name-only snapshots
    for (const st of proj.stellageConfigs || []) {
      for (const it of st.items || []) {
        if (it.materialId && !materialIds.has(it.materialId)) {
          addIssues([
            {
              source: `project:${pid}/stellageConfig:${st.id}`,
              type: "orphan_id",
              materialId: it.materialId,
              name: it.name,
            },
          ]);
        }
      }
    }

    projectStats.push({
      file: path.basename(pp),
      id: pid,
      name: proj.name,
      items: items.length,
      orphanItems,
      orphanUnique: orphanIds.size,
      noIdManual,
      archivedItems,
    });
  }
}

// --- alternativeMaterialId in materials ---
for (const m of materials) {
  const alt = m.alternativeMaterialId || m.alternative_material_id;
  if (alt && !materialIds.has(alt)) {
    addIssues([
      {
        source: "materials",
        type: "orphan_alternative_id",
        materialId: m.id,
        name: m.name,
        orphanAlt: alt,
      },
    ]);
  }
}

// --- Legacy IDs still anywhere ---
const legacyStillUsed = new Map();
for (const iss of allIssues.filter((x) => x.type === "orphan_id")) {
  if (LEGACY_MATERIAL_ID_MAP[iss.materialId]) {
    legacyStillUsed.set(iss.materialId, LEGACY_MATERIAL_ID_MAP[iss.materialId]);
  }
}

// --- Summary ---
const byType = {};
for (const iss of allIssues) byType[iss.type] = (byType[iss.type] || 0) + 1;

console.log("\n=== ШАБЛОНЫ (settings) ===");
console.log(`  stellageModuleCatalogs: ${Object.keys(stCatalogs).length} типов, ${Object.values(stCatalogs).reduce((n, a) => n + a.length, 0)} строк`);
console.log(`  farmSectionCatalogs: ${Object.keys(farmCatalogs).length} разделов, ${Object.values(farmCatalogs).reduce((n, a) => n + a.length, 0)} строк`);
console.log(`  farmSectionVersions: ${Object.keys(farmVersions || {}).length} разделов с историей`);

const settingsOrphans = allIssues.filter(
  (x) => x.type === "orphan_id" && !String(x.source).startsWith("project:")
);
console.log(`  Сирот materialId в settings: ${settingsOrphans.length}`);
if (settingsOrphans.length) {
  const uniq = [...new Map(settingsOrphans.map((x) => [x.materialId, x])).values()];
  for (const x of uniq.slice(0, 20)) {
    console.log(`    · ${x.materialId} → ${x.legacyTarget || "?"} | ${x.source} ${x.key || ""} | ${x.name || ""}`);
  }
}

console.log("\n=== ПРОЕКТЫ ===");
for (const ps of projectStats) {
  console.log(
    `  ${ps.name} (${ps.id}): ${ps.items} поз., сирот ${ps.orphanItems} (${ps.orphanUnique} id), ручных без id ${ps.noIdManual}`
  );
}

console.log("\n=== СВОДКА ПРОБЛЕМ ===");
console.log(byType);

if (legacyStillUsed.size) {
  console.log("\n=== Старые ID (есть в LEGACY_MAP, всё ещё в данных) ===");
  for (const [oldId, newId] of legacyStillUsed) console.log(`  ${oldId} → должно быть ${newId}`);
}

const fatLines = allIssues.filter((x) => x.type === "fat_catalog_line");
console.log(`\n=== Fat-строки в каталогах (дубли полей материала): ${fatLines.length} ===`);
if (fatLines.length) console.log("  (после slim-очистки должно быть 0 — если >0, шаблон не нормализован)");

const manualNoId = allIssues.filter((x) => x.type === "no_id_manual_line");
console.log(`\n=== Строки каталога без materialId (ручной мусор): ${manualNoId.length} ===`);

const totalOrphans = allIssues.filter((x) => x.type === "orphan_id").length;
const settingsClean = settingsOrphans.length === 0 && !byType.ghost_module && fatLines.length === 0;

console.log("\n=== ИТОГ ===");
if (settingsClean && totalOrphans === 0) {
  console.log("  Settings: чисто относительно базы materials.");
} else if (settingsClean) {
  console.log("  Settings: чисто. Остатки только в project_items (нужен remapOrphanMaterialIds --apply на сервере).");
} else {
  console.log("  Settings: есть сироты — нужна повторная clean* на сервере.");
}

if (totalOrphans > 0) {
  console.log(`  Всего ссылок на несуществующие materialId: ${totalOrphans}`);
}

// write report
const reportPath = path.join(root, "backend/data/audit-all-material-refs.json");
fs.writeFileSync(
  reportPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      materialsCount: materials.length,
      byType,
      legacyStillUsed: Object.fromEntries(legacyStillUsed),
      projectStats,
      issues: allIssues,
    },
    null,
    2
  )
);
console.log(`\nОтчёт: ${reportPath}`);

process.exit(totalOrphans > 0 || !settingsClean ? 1 : 0);
