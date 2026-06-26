import { db } from "../db.js";
import { resolveMaterialFarmSections } from "../../../shared/materialFarmSections.js";
import { slimCatalogEntryFromMaterial } from "../../../shared/catalogLine.js";

function parseJson(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function loadCatalogs() {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("farmSectionCatalogs");
  return parseJson(row?.value, {});
}

function saveCatalogs(catalogs) {
  db
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .run("farmSectionCatalogs", JSON.stringify(catalogs));
}

/** @deprecated только ссылка materialId + qty — данные из таблицы materials */
export function materialToFarmCatalogLine(m, prevLine = {}) {
  return slimCatalogEntryFromMaterial(m, prevLine);
}

function removeMaterialFromSection(catalogs, sectionId, materialId) {
  if (!sectionId || !Array.isArray(catalogs[sectionId])) return false;
  const next = catalogs[sectionId].filter((ln) => ln.materialId !== materialId);
  if (next.length === catalogs[sectionId].length) return false;
  catalogs[sectionId] = next;
  return true;
}

function upsertInSection(catalogs, sectionId, material) {
  const cat = [...(catalogs[sectionId] || [])];
  const idx = cat.findIndex((ln) => ln.materialId === material.id);
  const entry = slimCatalogEntryFromMaterial(material, idx >= 0 ? cat[idx] : {});
  if (idx >= 0) {
    if (JSON.stringify(entry) === JSON.stringify(cat[idx])) return false;
    cat[idx] = entry;
  } else {
    cat.push(entry);
  }
  catalogs[sectionId] = cat;
  return true;
}

/** Синхронизация шаблонов разделов фермы при сохранении материала */
export function syncMaterialFarmSectionCatalog(material, prevMaterial = null) {
  if (!material?.id) return { changed: false };

  const catalogs = loadCatalogs();
  let changed = false;

  const prevSections = resolveMaterialFarmSections(prevMaterial);
  const nextSections = material.status === "active" ? resolveMaterialFarmSections(material) : [];
  const nextSet = new Set(nextSections);

  for (const sid of prevSections) {
    if (!nextSet.has(sid)) {
      changed = removeMaterialFromSection(catalogs, sid, material.id) || changed;
    }
  }

  for (const sid of nextSections) {
    changed = upsertInSection(catalogs, sid, material) || changed;
  }

  for (const sectionId of Object.keys(catalogs)) {
    if (nextSet.has(sectionId)) continue;
    const cat = catalogs[sectionId];
    if (!Array.isArray(cat)) continue;
    const idx = cat.findIndex((ln) => ln.materialId === material.id);
    if (idx < 0) continue;
    const entry = slimCatalogEntryFromMaterial(material, cat[idx]);
    if (JSON.stringify(entry) !== JSON.stringify(cat[idx])) {
      catalogs[sectionId] = [...cat.slice(0, idx), entry, ...cat.slice(idx + 1)];
      changed = true;
    }
  }

  if (changed) saveCatalogs(catalogs);
  return { changed };
}

export function removeMaterialFromFarmSectionCatalogs(materialId) {
  const catalogs = loadCatalogs();
  let changed = false;
  for (const sectionId of Object.keys(catalogs)) {
    changed = removeMaterialFromSection(catalogs, sectionId, materialId) || changed;
  }
  if (changed) saveCatalogs(catalogs);
  return { changed };
}
