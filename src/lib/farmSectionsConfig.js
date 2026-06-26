import { FARM_SECTIONS } from "../data/farmSections.js";
import { uid } from "./ids.js";
import { catalogLinesForFarmSection, lineFromMaterial } from "./projectBuilder.js";
import { cloneBuilderLines } from "./builderLines.js";
import { hydrateCatalogEditorLine } from "./specLineCore.js";
import { normalizeStoredCatalog } from "../../shared/catalogLine.js";
import { parseJson } from "./jsonUtils.js";
import { DEFAULT_FARM_SECTION_GROUPS, resolveFarmSectionGroups } from "./farmSectionGroupsRef.js";

export { DEFAULT_FARM_SECTION_GROUPS, resolveFarmSectionGroups, parseJson };
export { stripLineIds } from "./builderLines.js";

/** @deprecated используйте resolveFarmSectionGroups() */
export const FARM_SECTION_GROUPS = DEFAULT_FARM_SECTION_GROUPS;

export function groupLabelMap(groups = DEFAULT_FARM_SECTION_GROUPS) {
  return Object.fromEntries(groups.map((g) => [g.id, g.label]));
}

/** @deprecated */
export const GROUP_LABEL = groupLabelMap(DEFAULT_FARM_SECTION_GROUPS);

function inferGroupFromName(name) {
  const n = (name || "").toLowerCase();
  if (/полив|дренаж|насос|обвязк/.test(n)) return "irrigation";
  if (/климат|вентил|охлаж|отоп|влаж/.test(n)) return "climate";
  if (/электр|кабель|автомат|свет/.test(n)) return "electrics";
  if (/склад|манип|ёмк/.test(n)) return "storage";
  return "other";
}

function defaultGroupMeta(groupId, groups = DEFAULT_FARM_SECTION_GROUPS) {
  return groups.find((g) => g.id === groupId) || groups[groups.length - 1] || DEFAULT_FARM_SECTION_GROUPS[DEFAULT_FARM_SECTION_GROUPS.length - 1];
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
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = Array.isArray(v) ? normalizeStoredCatalog(v) : v;
  }
  return out;
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

/** Состав раздела для редактора в пресетах */
export function catalogEditorLines(catalogs, sectionId, materials) {
  const saved = catalogs[sectionId];
  if (saved?.length) {
    return cloneBuilderLines(saved).map((ln) => hydrateCatalogEditorLine(ln, materials));
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
      const sub = ln.subcategory || ln.farmGroup || "";
      if (!ln.materialId) {
        return withMeta({
          ...hydrateCatalogEditorLine(ln, materials),
          included: false,
          qty: defaultQty,
          defaultQty,
        });
      }
      const mat = materials.find((m) => m.id === ln.materialId);
      return withMeta(
        mat
          ? {
              ...lineFromMaterial(mat, {
                included: false,
                qty: defaultQty,
                defaultQty,
                subcategory: sub,
                farmGroup: sub,
              }),
              id: ln.id,
            }
          : hydrateCatalogEditorLine({ ...ln, included: false, qty: defaultQty, defaultQty }, materials)
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
