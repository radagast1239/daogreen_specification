import { FARM_SECTIONS } from "../data/farmSections.js";
import { uid } from "../store/helpers.js";
import { catalogLinesForFarmSection, lineFromMaterial } from "./projectBuilder.js";
import { cloneBuilderLines } from "./presetHelpers.js";

export function parseJson(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

/** Разделы фермы из настроек (с миграцией со старого формата) */
export function resolveFarmSections(settings = {}) {
  const direct = parseJson(settings.farmSections, null);
  if (Array.isArray(direct) && direct.length) {
    return direct.map((s) => ({ id: s.id, name: String(s.name || "").trim() || s.id }));
  }

  let order = [];
  const names = parseJson(settings.farmSectionNames, {});
  try {
    if (settings.farmSectionOrder) order = JSON.parse(settings.farmSectionOrder);
  } catch {
    order = [];
  }

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

export function parseFarmSectionCatalogs(raw) {
  const obj = parseJson(raw, {});
  return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
}

export function newFarmSection(name = "Новый раздел") {
  return { id: uid("sec"), name: name.trim() || "Новый раздел" };
}

export function patchSectionName(sections, sectionId, name) {
  return sections.map((s) => (s.id === sectionId ? { ...s, name: name.trim() || s.name } : s));
}

export function moveSection(sections, sectionId, dir) {
  const list = [...sections];
  const i = list.findIndex((s) => s.id === sectionId);
  if (i < 0) return list;
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= list.length) return list;
  [list[i], list[j]] = [list[j], list[i]];
  return list;
}

export function removeSection(sections, catalogs, sectionId) {
  const nextCatalogs = { ...catalogs };
  delete nextCatalogs[sectionId];
  return {
    sections: sections.filter((s) => s.id !== sectionId),
    catalogs: nextCatalogs,
  };
}

/** Состав раздела для редактора в пресетах */
export function catalogEditorLines(catalogs, sectionId, materials) {
  const saved = catalogs[sectionId];
  if (saved?.length) {
    return cloneBuilderLines(saved).map((ln) => {
      if (!ln.materialId) return { ...ln, included: true };
      const mat = materials.find((m) => m.id === ln.materialId);
      return mat ? { ...lineFromMaterial(mat, { ...ln, included: true }), id: ln.id } : { ...ln, included: true };
    });
  }
  return catalogLinesForFarmSection(materials, sectionId).map((ln) => ({ ...ln, included: true }));
}

/** Состав раздела при создании проекта — все позиции видны, ничего не отмечено */
export function projectLinesFromCatalog(catalogs, sectionId, materials) {
  const saved = catalogs[sectionId];
  if (saved?.length) {
    return cloneBuilderLines(saved).map((ln) => {
      const base = { ...ln, included: false, qty: 0 };
      if (!ln.materialId) return base;
      const mat = materials.find((m) => m.id === ln.materialId);
      return mat
        ? { ...lineFromMaterial(mat, { ...base, included: false }), id: ln.id }
        : base;
    });
  }
  return catalogLinesForFarmSection(materials, sectionId);
}

export function emptyFarmSectionsState(sections, catalogs, materials) {
  const map = {};
  for (const sec of sections) {
    map[sec.id] = projectLinesFromCatalog(catalogs, sec.id, materials);
  }
  return map;
}

export function stripLineIds(lines) {
  return (lines || [])
    .filter((ln) => ln.name?.trim() && ln.included !== false)
    .map(({ id, qty, ...rest }) => ({
      ...rest,
      included: true,
    }));
}
