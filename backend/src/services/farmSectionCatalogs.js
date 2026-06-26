import { db } from "../db.js";
import { listMaterials } from "../routes/materials.js";
import { FARM_SECTIONS } from "../../../src/data/farmSections.js";
import { materialInFarmSection } from "../../../shared/materialFarmSections.js";
import { slimCatalogEntryFromMaterial } from "../../../shared/catalogLine.js";

function parseJson(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function resolveSections(settings) {
  const direct = parseJson(settings.farmSections, null);
  if (Array.isArray(direct) && direct.length) return direct;

  let order = parseJson(settings.farmSectionOrder, []);
  const names = parseJson(settings.farmSectionNames, {});
  const map = new Map(FARM_SECTIONS.map((s) => [s.id, s]));
  const out = [];
  for (const id of order) {
    if (map.has(id)) out.push({ id, name: names[id] || map.get(id).name });
  }
  for (const s of FARM_SECTIONS) {
    if (!out.some((x) => x.id === s.id)) out.push({ id: s.id, name: names[s.id] || s.name });
  }
  return out;
}

function materialToCatalogLine(m) {
  return slimCatalogEntryFromMaterial(m, {});
}

/** Первичное заполнение шаблонов разделов из farm_section_id (после импорта Excel) */
export function ensureFarmSectionCatalogs() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const catalogs = parseJson(settings.farmSectionCatalogs, {});

  if (Object.values(catalogs).some((v) => Array.isArray(v) && v.length)) {
    return { skipped: true };
  }

  const sections = resolveSections(settings);
  const materials = listMaterials();
  let filled = 0;

  for (const sec of sections) {
    const mats = materials.filter((m) => materialInFarmSection(m, sec.id) && m.status === "active");
    if (!mats.length) continue;
    catalogs[sec.id] = mats.map(materialToCatalogLine);
    filled += mats.length;
  }

  if (!filled) return { skipped: true, reason: "no materials" };

  const upsert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  upsert.run("farmSectionCatalogs", JSON.stringify(catalogs));
  if (!settings.farmSections) {
    upsert.run("farmSections", JSON.stringify(sections));
  }

  console.log(`Farm section catalogs: seeded ${filled} lines across ${sections.length} sections`);
  return { filled, sections: sections.length };
}
