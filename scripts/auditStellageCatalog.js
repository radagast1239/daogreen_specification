/**
 * Сверка шаблонов стеллажей (stellageModuleCatalogs) с материалами базы.
 *
 * Usage:
 *   node scripts/auditStellageCatalog.js
 *   node scripts/auditStellageCatalog.js path/to/materials.json path/to/settings.json path/to/modules.json
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseStellageModuleCatalogs } from "../src/lib/stellageCatalogConfig.js";
import { materialInModule, resolveMaterialModules } from "../shared/materialModules.js";
import { seedModules } from "../src/data/modules.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function normName(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/×/g, "x")
    .replace(/,/g, ".")
    .replace(/\s+/g, " ");
}

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function isStellageModule(mod) {
  return mod?.type === "stellage" || /^стеллаж/i.test(mod?.name || "");
}

function lineQty(ln) {
  return Number(ln.defaultQty ?? ln.qty) || 0;
}

function audit(materials, settings, modules) {
  const catalogs = parseStellageModuleCatalogs(settings.stellageModuleCatalogs);
  const matById = new Map(materials.map((m) => [m.id, m]));
  const activeMaterials = materials.filter((m) => m.status !== "archived");

  const stellageMods = modules.filter(isStellageModule);
  const modById = new Map(stellageMods.map((m) => [m.id, m]));

  const report = {
    summary: {
      materialsTotal: materials.length,
      materialsActive: activeMaterials.length,
      stellageModuleTypes: stellageMods.length,
      catalogModuleKeys: Object.keys(catalogs).length,
    },
    modules: [],
    global: {
      stellageMaterialsNotInAnyCatalog: [],
      catalogRefsMissingMaterial: [],
      duplicateMaterialIdsInCatalogs: [],
    },
  };

  const allCatalogMaterialIds = new Map();

  for (const mod of stellageMods) {
    const catalog = catalogs[mod.id] || [];
    const modMaterials = activeMaterials.filter((m) => materialInModule(m, mod.name));

    const catalogIds = new Set();
    const brokenRefs = [];
    const nameMismatches = [];
    const zeroQtyInTemplate = [];
    const includedInTemplate = [];

    for (const ln of catalog) {
      const mid = ln.materialId;
      if (mid) {
        if (catalogIds.has(mid)) {
          report.global.duplicateMaterialIdsInCatalogs.push({ moduleId: mod.id, moduleName: mod.name, materialId: mid });
        }
        catalogIds.add(mid);
        if (!allCatalogMaterialIds.has(mid)) allCatalogMaterialIds.set(mid, []);
        allCatalogMaterialIds.get(mid).push(mod.name);

        const mat = matById.get(mid);
        if (!mat) {
          brokenRefs.push({ materialId: mid, name: ln.name, reason: "material_id_not_in_db" });
        } else if (mat.status === "archived") {
          brokenRefs.push({ materialId: mid, name: ln.name, materialName: mat.name, reason: "material_archived" });
        } else if (!materialInModule(mat, mod.name)) {
          brokenRefs.push({
            materialId: mid,
            name: ln.name,
            materialName: mat.name,
            materialModules: resolveMaterialModules(mat),
            reason: "material_not_linked_to_module",
          });
        } else if (normName(ln.name) !== normName(mat.name)) {
          nameMismatches.push({ materialId: mid, catalogName: ln.name, materialName: mat.name });
        }
      }
      if (lineQty(ln) <= 0 && ln.included !== false) zeroQtyInTemplate.push(ln.name);
      if (ln.included) includedInTemplate.push(ln.name || ln.materialId);
    }

    const modMatIds = new Set(modMaterials.map((m) => m.id));
    const inCatalogNotInModuleMaterials = [...catalogIds].filter((id) => matById.has(id) && !modMatIds.has(id));
    const inMaterialsNotInCatalog = modMaterials.filter((m) => !catalogIds.has(m.id));
    const catalogWithoutMaterialId = catalog.filter((ln) => !ln.materialId && (ln.name || "").trim());

    report.modules.push({
      id: mod.id,
      name: mod.name,
      catalogLines: catalog.length,
      catalogWithMaterialId: catalogIds.size,
      materialsInModule: modMaterials.length,
      brokenRefs,
      nameMismatches,
      zeroQtyInTemplate: zeroQtyInTemplate.slice(0, 15),
      zeroQtyCount: zeroQtyInTemplate.length,
      inMaterialsNotInCatalog: inMaterialsNotInCatalog.map((m) => ({
        id: m.id,
        name: m.name,
        defaultQty: m.defaultQty,
        category: m.category,
        modules: resolveMaterialModules(m),
      })),
      inMaterialsNotInCatalogCount: inMaterialsNotInCatalog.length,
      catalogWithoutMaterialId: catalogWithoutMaterialId.map((ln) => ln.name),
      orphanCatalogKeys: catalogs[mod.id] && !catalog.length ? 0 : undefined,
    });
  }

  // Catalog keys without stellage module
  for (const key of Object.keys(catalogs)) {
    if (!modById.has(key)) {
      report.global.orphanCatalogModuleId = report.global.orphanCatalogModuleId || [];
      report.global.orphanCatalogModuleId.push({ moduleId: key, lines: catalogs[key].length });
    }
  }

  // Stellage-tagged materials not in any catalog
  for (const m of activeMaterials) {
    const mods = resolveMaterialModules(m);
    const stellageModNames = mods.filter((name) => stellageMods.some((sm) => sm.name === name));
    if (!stellageModNames.length) continue;
    if (!allCatalogMaterialIds.has(m.id)) {
      report.global.stellageMaterialsNotInAnyCatalog.push({
        id: m.id,
        name: m.name,
        modules: stellageModNames,
        category: m.category,
        defaultQty: m.defaultQty,
      });
    }
  }

  for (const [mid, mods] of allCatalogMaterialIds) {
    if (!matById.has(mid)) {
      report.global.catalogRefsMissingMaterial.push({ materialId: mid, inModules: mods });
    }
  }

  return report;
}

function printReport(report) {
  console.log("=== Сводка ===");
  console.log(JSON.stringify(report.summary, null, 2));

  let totalOrphanMaterials = 0;
  let totalBroken = 0;

  for (const m of report.modules) {
    console.log(`\n--- ${m.name} (${m.id}) ---`);
    console.log(`  Шаблон: ${m.catalogLines} строк (${m.catalogWithMaterialId} с materialId)`);
    console.log(`  Материалы с модулем «${m.name}»: ${m.materialsInModule}`);
    console.log(`  В базе, но НЕ в шаблоне: ${m.inMaterialsNotInCatalogCount}`);
    totalOrphanMaterials += m.inMaterialsNotInCatalogCount;
    if (m.inMaterialsNotInCatalogCount) {
      for (const x of m.inMaterialsNotInCatalog.slice(0, 20)) {
        console.log(`    · [${x.id}] ${x.name} (qty ${x.defaultQty}, ${x.category})`);
      }
      if (m.inMaterialsNotInCatalogCount > 20) console.log(`    … ещё ${m.inMaterialsNotInCatalogCount - 20}`);
    }
    if (m.brokenRefs.length) {
      totalBroken += m.brokenRefs.length;
      console.log(`  Битые ссылки в шаблоне: ${m.brokenRefs.length}`);
      for (const x of m.brokenRefs.slice(0, 10)) console.log(`    · ${x.materialId}: ${x.name} — ${x.reason}`);
    }
    if (m.nameMismatches.length) {
      console.log(`  Расхождение названий: ${m.nameMismatches.length}`);
      for (const x of m.nameMismatches.slice(0, 5)) {
        console.log(`    · шаблон «${x.catalogName}» vs база «${x.materialName}»`);
      }
    }
    if (m.catalogWithoutMaterialId.length) {
      console.log(`  Строки шаблона без materialId: ${m.catalogWithoutMaterialId.length}`);
      for (const n of m.catalogWithoutMaterialId.slice(0, 8)) console.log(`    · ${n}`);
    }
    if (m.zeroQtyCount) console.log(`  С qty=0 в шаблоне: ${m.zeroQtyCount}`);
  }

  console.log("\n=== Глобально ===");
  console.log(`Мусор в базе (стеллажный модуль, но ни в одном шаблоне): ${report.global.stellageMaterialsNotInAnyCatalog.length}`);
  for (const x of report.global.stellageMaterialsNotInAnyCatalog.slice(0, 25)) {
    console.log(`  · [${x.id}] ${x.name} → ${x.modules.join(", ")}`);
  }
  if (report.global.stellageMaterialsNotInAnyCatalog.length > 25) {
    console.log(`  … ещё ${report.global.stellageMaterialsNotInAnyCatalog.length - 25}`);
  }
  if (report.global.orphanCatalogModuleId?.length) {
    console.log("Каталоги без модуля в справочнике:", report.global.orphanCatalogModuleId);
  }
  console.log(`\nИТОГО: ${totalOrphanMaterials} материалов в базе вне шаблонов, ${totalBroken} битых ссылок`);
}

const args = process.argv.slice(2).filter((a) => a !== "--json");
const matsPath = args[0] || path.join(root, "backend/data/materials-live.json");
const settingsPath = args[1] || path.join(root, "backend/data/settings-live.json");
const modulesPath = args[2];

function buildModulesList(settings, materials) {
  if (modulesPath && fs.existsSync(modulesPath)) return loadJson(modulesPath);
  const catalogs = parseStellageModuleCatalogs(settings.stellageModuleCatalogs);
  const byId = new Map(seedModules.map((m) => [m.id, m]));
  for (const id of Object.keys(catalogs)) {
    if (!byId.has(id)) {
      const nameFromMaterials = materials.find((m) => resolveMaterialModules(m).some((n) => n.includes(id)));
      byId.set(id, { id, name: nameFromMaterials ? resolveMaterialModules(nameFromMaterials)[0] : id, type: "stellage" });
    }
  }
  return [...byId.values()];
}

const materials = loadJson(matsPath);
const settings = loadJson(settingsPath);
const modules = buildModulesList(settings, materials);
const report = audit(materials, settings, modules);
printReport(report);

if (process.argv.includes("--json")) {
  fs.writeFileSync(path.join(root, "backend/data/stellage-audit-report.json"), JSON.stringify(report, null, 2));
  console.log("\nWritten backend/data/stellage-audit-report.json");
}
