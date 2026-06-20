import { FARM_SECTIONS } from "../data/farmSections.js";
import { uid } from "../store/helpers.js";
import { catalogLinesForFarmSection, lineFromMaterial } from "./projectBuilder.js";
import { cloneBuilderLines } from "./presetHelpers.js";

export const FARM_SECTION_GROUPS = [
  { id: "irrigation", label: "Полив", icon: "💧", color: "#0d7ea8" },
  { id: "climate", label: "Климат", icon: "🌡️", color: "#6b5b95" },
  { id: "electrics", label: "Электрика", icon: "⚡", color: "#c9a227" },
  { id: "storage", label: "Склад", icon: "📦", color: "#5a6b5c" },
  { id: "other", label: "Прочее", icon: "📋", color: "#116355" },
];

export const GROUP_LABEL = Object.fromEntries(FARM_SECTION_GROUPS.map((g) => [g.id, g.label]));

export function parseJson(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function inferGroupFromName(name) {
  const n = (name || "").toLowerCase();
  if (/полив|дренаж|насос|обвязк/.test(n)) return "irrigation";
  if (/климат|вентил|охлаж|отоп|влаж/.test(n)) return "climate";
  if (/электр|кабель|автомат|свет/.test(n)) return "electrics";
  if (/склад|манип|ёмк/.test(n)) return "storage";
  return "other";
}

function defaultGroupMeta(groupId) {
  return FARM_SECTION_GROUPS.find((g) => g.id === groupId) || FARM_SECTION_GROUPS[FARM_SECTION_GROUPS.length - 1];
}

/** Полная нормализация раздела (миграция старых { id, name }) */
export function normalizeSection(raw) {
  const group = raw.group || inferGroupFromName(raw.name);
  const meta = defaultGroupMeta(group);
  return {
    id: raw.id,
    name: String(raw.name || "").trim() || raw.id,
    group,
    icon: raw.icon || meta.icon,
    color: raw.color || meta.color,
    defaultResponsible: raw.defaultResponsible || "",
    hiddenForFarmTypes: Array.isArray(raw.hiddenForFarmTypes) ? raw.hiddenForFarmTypes : [],
  };
}

/** Разделы фермы из настроек (с миграцией со старого формата) */
export function resolveFarmSections(settings = {}) {
  const direct = parseJson(settings.farmSections, null);
  if (Array.isArray(direct) && direct.length) {
    return direct.map(normalizeSection);
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
    if (map.has(id)) {
      const base = map.get(id);
      out.push(normalizeSection({ id, name: names[id] || base.name, group: inferGroupFromName(names[id] || base.name) }));
    }
  }
  for (const s of FARM_SECTIONS) {
    if (!out.some((x) => x.id === s.id)) {
      out.push(normalizeSection({ id: s.id, name: names[s.id] || s.name }));
    }
  }
  return out;
}

export function filterSectionsForFarmType(sections, farmType) {
  if (!farmType) return sections;
  return sections.filter((sec) => {
    const hidden = sec.hiddenForFarmTypes || [];
    return !hidden.length || !hidden.includes(farmType);
  });
}

export function parseFarmSectionCatalogs(raw) {
  const obj = parseJson(raw, {});
  return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
}

export function parseFarmSectionVersions(raw) {
  const obj = parseJson(raw, {});
  return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
}

export function newFarmSection(name = "Новый раздел") {
  return normalizeSection({ id: uid("sec"), name: name.trim() || "Новый раздел" });
}

export function patchSectionName(sections, sectionId, name) {
  return sections.map((s) =>
    s.id === sectionId ? normalizeSection({ ...s, name: name.trim() || s.name }) : s
  );
}

export function patchSection(sections, sectionId, patch) {
  return sections.map((s) => (s.id === sectionId ? normalizeSection({ ...s, ...patch }) : s));
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

export function removeSection(sections, catalogs, sectionId, versions = {}) {
  const nextCatalogs = { ...catalogs };
  delete nextCatalogs[sectionId];
  const nextVersions = { ...versions };
  delete nextVersions[sectionId];
  return {
    sections: sections.filter((s) => s.id !== sectionId),
    catalogs: nextCatalogs,
    versions: nextVersions,
  };
}

function lineQtyFromCatalog(ln) {
  return Number(ln.defaultQty ?? ln.qty) || 0;
}

/** Сохранение шаблона раздела — с кол-вом по умолчанию */
export function stripLineIds(lines) {
  return (lines || [])
    .filter((ln) => ln.name?.trim() && ln.included !== false)
    .map(({ id, qty, defaultQty, ...rest }) => ({
      ...rest,
      included: true,
      defaultQty: Number(defaultQty ?? qty) || 0,
    }));
}

/** Состав раздела для редактора в пресетах */
export function catalogEditorLines(catalogs, sectionId, materials) {
  const saved = catalogs[sectionId];
  if (saved?.length) {
    return cloneBuilderLines(saved).map((ln) => {
      const qty = lineQtyFromCatalog(ln);
      if (!ln.materialId) return { ...ln, included: true, qty, defaultQty: qty };
      const mat = materials.find((m) => m.id === ln.materialId);
      return mat
        ? { ...lineFromMaterial(mat, { ...ln, included: true, qty, defaultQty: qty }), id: ln.id }
        : { ...ln, included: true, qty, defaultQty: qty };
    });
  }
  return catalogLinesForFarmSection(materials, sectionId).map((ln) => {
    const qty = lineQtyFromCatalog(ln);
    return { ...ln, qty, defaultQty: qty };
  });
}

/** Состав раздела при создании проекта — позиции видны, кол-во из шаблона */
export function projectLinesFromCatalog(catalogs, sectionId, materials, sectionMeta = null) {
  const defaultResp = sectionMeta?.defaultResponsible || "";
  const saved = catalogs[sectionId];
  const withMeta = (line) => ({
    ...line,
    responsible: line.responsible || defaultResp || undefined,
  });

  if (saved?.length) {
    return cloneBuilderLines(saved).map((ln) => {
      const defaultQty = lineQtyFromCatalog(ln);
      const base = { ...ln, included: false, qty: defaultQty, defaultQty: defaultQty };
      if (!ln.materialId) return withMeta(base);
      const mat = materials.find((m) => m.id === ln.materialId);
      return withMeta(
        mat
          ? { ...lineFromMaterial(mat, { ...base, included: false }), id: ln.id }
          : base
      );
    });
  }
  return catalogLinesForFarmSection(materials, sectionId).map(withMeta);
}

export function emptyFarmSectionsState(sections, catalogs, materials) {
  const map = {};
  for (const sec of sections) {
    map[sec.id] = projectLinesFromCatalog(catalogs, sec.id, materials, sec);
  }
  return map;
}

/** Запись версии шаблона при сохранении */
export function appendSectionVersion(versions, sectionId, { prevCount, newCount, catalog }) {
  const prev = versions[sectionId] || [];
  const entry = {
    id: uid("ver"),
    savedAt: new Date().toISOString(),
    prevCount,
    newCount,
    catalog: catalog || [],
  };
  return {
    ...versions,
    [sectionId]: [entry, ...prev].slice(0, 30),
  };
}

export function exportSectionBundle(section, catalog) {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    section: normalizeSection(section),
    catalog: stripLineIds(catalog),
  };
}

export function parseSectionImport(raw) {
  const data = typeof raw === "string" ? parseJson(raw, null) : raw;
  if (!data?.section?.name) throw new Error("Неверный формат: нужны section и catalog");
  const section = normalizeSection({
    ...data.section,
    id: data.section.id || uid("sec"),
  });
  const catalog = Array.isArray(data.catalog) ? data.catalog : [];
  return { section, catalog: stripLineIds(catalog) };
}
