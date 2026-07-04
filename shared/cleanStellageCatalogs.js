/**
 * Очистка шаблонов стеллажей: только официальные типы, только materialId из базы.
 */

import { slimCatalogLine } from "./catalogLine.js";
import { resolveOrphanMaterialIdStrict } from "./orphanMaterialRemap.js";

/** Удаляемые «призрачные» шаблоны (копии / забытые типы) */
export const STELLAGE_GHOST_MODULE_IDS = ["mod_4lYb0iHFNK", "mod_sYvrDdu5g-"];

export function officialStellageModuleIds(seedModules = []) {
  return seedModules.filter((m) => m.type === "stellage").map((m) => m.id);
}

function activeMaterials(materials) {
  return materials.filter((m) => m.status !== "archived");
}

function lineQty(ln) {
  return Number(ln.defaultQty ?? ln.qty) || 0;
}

/**
 * @param {Record<string, unknown[]>} rawCatalogs
 * @param {object[]} materials — база материалов (источник истины)
 * @param {{ officialModuleIds?: string[], ghostModuleIds?: string[] }} options
 */
export function cleanStellageCatalogs(rawCatalogs, materials, options = {}) {
  const mats = activeMaterials(materials);
  const materialIds = new Set(mats.map((m) => m.id));
  const officialIds = new Set(options.officialModuleIds || []);
  const ghostIds = new Set(options.ghostModuleIds || STELLAGE_GHOST_MODULE_IDS);

  const report = {
    removedModules: [],
    remapped: [],
    dropped: [],
    deduped: [],
  };
  const next = {};

  for (const [moduleId, lines] of Object.entries(rawCatalogs || {})) {
    if (!officialIds.has(moduleId) || ghostIds.has(moduleId)) {
      if (Array.isArray(lines) && lines.length) {
        report.removedModules.push({
          moduleId,
          lines: lines.length,
          reason: ghostIds.has(moduleId) ? "ghost" : "not_official_stellage",
        });
      }
      continue;
    }
    if (!Array.isArray(lines)) continue;

    /** @type {Map<string, object>} */
    const byMaterialId = new Map();

    for (const ln of lines) {
      let mid = String(ln.materialId || "").trim();
      if (!mid) {
        report.dropped.push({ moduleId, reason: "no_material_id", line: ln });
        continue;
      }

      if (!materialIds.has(mid)) {
        const newId = resolveOrphanMaterialIdStrict(mid, ln.name || "", mats, materialIds);
        if (!newId) {
          report.dropped.push({ moduleId, materialId: mid, name: ln.name, reason: "unresolved" });
          continue;
        }
        if (newId !== mid) {
          report.remapped.push({ moduleId, oldId: mid, newId, name: ln.name });
        }
        mid = newId;
      }

      if (!materialIds.has(mid)) {
        report.dropped.push({ moduleId, materialId: mid, reason: "missing_in_db" });
        continue;
      }

      const qty = lineQty(ln);
      const sub = String(ln.subcategory || ln.farmGroup || "").trim(); // subcategory — явный выбор в UI
      const prev = byMaterialId.get(mid);
      if (prev) {
        const prevQty = lineQty(prev);
        if (qty > prevQty) {
          byMaterialId.set(mid, { ...ln, materialId: mid, defaultQty: qty, subcategory: sub || prev.subcategory });
        }
        report.deduped.push({ moduleId, materialId: mid });
        continue;
      }
      byMaterialId.set(mid, {
        materialId: mid,
        defaultQty: qty,
        included: ln.included !== false,
        subcategory: sub,
        ...(ln.pipeCuts ? { pipeCuts: ln.pipeCuts } : {}),
        ...(ln.breakerSpecs ? { breakerSpecs: ln.breakerSpecs } : {}),
        ...(ln.flowSpecs ? { flowSpecs: ln.flowSpecs } : {}),
        ...(ln.splitSpecs ? { splitSpecs: ln.splitSpecs } : {}),
      });
    }

    const slim = [...byMaterialId.values()]
      .map((ln) => slimCatalogLine(ln))
      .filter(Boolean);
    if (slim.length) next[moduleId] = slim;
  }

  return { next, report, stats: summarizeCleanReport(report, next) };
}

export function cleanStellageModuleMeta(rawMeta, officialModuleIds) {
  const official = new Set(officialModuleIds || []);
  const meta = rawMeta && typeof rawMeta === "object" ? rawMeta : {};
  const next = {};
  const removed = [];
  for (const [k, v] of Object.entries(meta)) {
    if (official.has(k)) next[k] = v;
    else removed.push(k);
  }
  return { next, removed };
}

function summarizeCleanReport(report, next) {
  return {
    modulesKept: Object.keys(next).length,
    modulesRemoved: report.removedModules.length,
    linesRemapped: report.remapped.length,
    linesDropped: report.dropped.length,
    linesDeduped: report.deduped.length,
    totalLines: Object.values(next).reduce((n, arr) => n + arr.length, 0),
  };
}

export function parseSettingsJson(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
