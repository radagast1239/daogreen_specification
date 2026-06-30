/**
 * Очистка каталогов разделов фермы: только sec_* из farmSections, только materialId из базы.
 */

import { slimCatalogLine } from "./catalogLine.js";
import { resolveOrphanMaterialIdStrict } from "./orphanMaterialRemap.js";

export { parseSettingsJson } from "./cleanStellageCatalogs.js";

function activeMaterials(materials) {
  return materials.filter((m) => m.status !== "archived");
}

function lineQty(ln) {
  return Number(ln.defaultQty ?? ln.qty) || 0;
}

/**
 * @param {unknown[]} lines
 * @param {object[]} mats
 * @param {Set<string>} materialIds
 * @param {object} report
 * @param {string} contextKey — id раздела (для отчёта)
 */
function cleanCatalogLines(lines, mats, materialIds, report, contextKey) {
  if (!Array.isArray(lines)) return [];

  /** @type {Map<string, object>} */
  const byMaterialId = new Map();

  for (const ln of lines) {
    let mid = String(ln.materialId || "").trim();
    if (!mid) {
      report.dropped.push({ sectionId: contextKey, reason: "no_material_id", name: ln.name });
      continue;
    }

    if (!materialIds.has(mid)) {
      const newId = resolveOrphanMaterialIdStrict(mid, ln.name || "", mats, materialIds);
      if (!newId) {
        report.dropped.push({
          sectionId: contextKey,
          materialId: mid,
          name: ln.name,
          reason: "unresolved",
        });
        continue;
      }
      if (newId !== mid) {
        report.remapped.push({ sectionId: contextKey, oldId: mid, newId, name: ln.name });
      }
      mid = newId;
    }

    if (!materialIds.has(mid)) {
      report.dropped.push({ sectionId: contextKey, materialId: mid, reason: "missing_in_db" });
      continue;
    }

    const qty = lineQty(ln);
    const sub = String(ln.subcategory || ln.farmGroup || "").trim();
    const prev = byMaterialId.get(mid);
    if (prev) {
      const prevQty = lineQty(prev);
      if (qty > prevQty) {
        byMaterialId.set(mid, { ...ln, materialId: mid, defaultQty: qty, subcategory: sub || prev.subcategory });
      }
      report.deduped.push({ sectionId: contextKey, materialId: mid });
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

  return [...byMaterialId.values()].map((ln) => slimCatalogLine(ln)).filter(Boolean);
}

function summarizeReport(report, next) {
  const totalLines = Object.values(next).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0);
  return {
    sectionsKept: Object.keys(next).length,
    sectionsRemoved: report.removedSections.length,
    linesRemapped: report.remapped.length,
    linesDropped: report.dropped.length,
    linesDeduped: report.deduped.length,
    totalLines,
  };
}

/**
 * @param {Record<string, unknown[]>} rawCatalogs
 * @param {object[]} materials
 * @param {{ id: string }[]} farmSections
 */
export function cleanFarmSectionCatalogs(rawCatalogs, materials, farmSections = []) {
  const mats = activeMaterials(materials);
  const materialIds = new Set(mats.map((m) => m.id));
  const sectionIds = new Set((farmSections || []).map((s) => s.id));

  const report = {
    removedSections: [],
    remapped: [],
    dropped: [],
    deduped: [],
  };
  const next = {};

  for (const [sectionId, lines] of Object.entries(rawCatalogs || {})) {
    if (!sectionIds.has(sectionId)) {
      if (Array.isArray(lines) && lines.length) {
        report.removedSections.push({ sectionId, lines: lines.length, reason: "not_in_farm_sections" });
      }
      continue;
    }
    const slim = cleanCatalogLines(lines, mats, materialIds, report, sectionId);
    next[sectionId] = slim;
  }

  return { next, report, stats: summarizeReport(report, next) };
}

/**
 * @param {Record<string, { catalog?: unknown[] }[]>} rawVersions
 * @param {object[]} materials
 * @param {{ id: string }[]} farmSections
 */
export function cleanFarmSectionVersions(rawVersions, materials, farmSections = []) {
  const mats = activeMaterials(materials);
  const materialIds = new Set(mats.map((m) => m.id));
  const sectionIds = new Set((farmSections || []).map((s) => s.id));

  const report = {
    removedSections: [],
    remapped: [],
    dropped: [],
    deduped: [],
    versionsRemoved: 0,
  };
  const next = {};

  for (const [sectionId, versions] of Object.entries(rawVersions || {})) {
    if (!sectionIds.has(sectionId)) {
      if (Array.isArray(versions) && versions.length) {
        report.removedSections.push({ sectionId, lines: versions.length, reason: "not_in_farm_sections" });
      }
      continue;
    }
    if (!Array.isArray(versions)) continue;

    const cleanedVersions = [];
    for (const ver of versions) {
      if (!ver || typeof ver !== "object") continue;
      const catalog = cleanCatalogLines(ver.catalog, mats, materialIds, report, sectionId);
      cleanedVersions.push({
        ...ver,
        catalog,
        newCount: catalog.length,
      });
    }
    if (cleanedVersions.length) next[sectionId] = cleanedVersions;
  }

  return {
    next,
    report,
    stats: {
      ...summarizeReport(report, {}),
      sectionsKept: Object.keys(next).length,
      totalVersions: Object.values(next).reduce((n, arr) => n + arr.length, 0),
    },
  };
}

export function parseFarmSections(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
