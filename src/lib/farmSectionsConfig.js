import { FARM_SECTIONS } from "../data/farmSections.js";
import { uid } from "./ids.js";
import { catalogLinesForFarmSection, lineFromMaterial } from "./projectBuilder.js";
import { cloneBuilderLines } from "./builderLines.js";
import { hydrateCatalogEditorLine } from "./specLineCore.js";
import { normalizeStoredCatalog } from "../../shared/catalogLine.js";
import { parseJson } from "./jsonUtils.js";
import { DEFAULT_FARM_SECTION_GROUPS, resolveFarmSectionGroups } from "./farmSectionGroupsRef.js";
import {
  NASOSNAYA_SECTION_ID,
  canonicalizeNasosnayaSection,
  isNasosnayaSectionName,
  nasosnayaCatalogLookupIds,
  normalizeFarmSectionLabel,
} from "../../shared/nasosnayaFarmSection.js";

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
    catalogAliasIds: Array.isArray(raw.catalogAliasIds)
      ? [...new Set(raw.catalogAliasIds.map((x) => String(x || "").trim()).filter(Boolean))]
      : [],
  };
}

/**
 * Runtime dedupe: by id, normalized name, and nasosnaya legacy aliases.
 * Canonicalizes legacy «Насосы» / «Насосная группа» / live uid ids → sec_nasosnaya.
 */
export function dedupeAndCanonicalizeFarmSections(sections) {
  const list = (Array.isArray(sections) ? sections : []).map(normalizeSection);
  const out = [];
  const seenIds = new Set();
  const seenNames = new Set();

  for (const raw of list) {
    const originalId = String(raw.id || "").trim();
    const s = normalizeSection(canonicalizeNasosnayaSection(raw));
    const nameKey = normalizeFarmSectionLabel(s.name);

    if (seenIds.has(s.id)) {
      if (s.id === NASOSNAYA_SECTION_ID) {
        const existing = out.find((x) => x.id === NASOSNAYA_SECTION_ID);
        if (existing) {
          const aliases = new Set([...(existing.catalogAliasIds || []), ...(s.catalogAliasIds || [])]);
          if (originalId && originalId !== NASOSNAYA_SECTION_ID) aliases.add(originalId);
          existing.catalogAliasIds = [...aliases];
          existing.hiddenForFarmTypes = [];
        }
      }
      continue;
    }
    if (seenNames.has(nameKey)) {
      if (s.id === NASOSNAYA_SECTION_ID) {
        const existing = out.find((x) => normalizeFarmSectionLabel(x.name) === nameKey);
        if (existing && existing.id !== NASOSNAYA_SECTION_ID) {
          // Replace weaker card with canonical nasosnaya
          const idx = out.indexOf(existing);
          const aliases = new Set([
            ...(existing.catalogAliasIds || []),
            ...(s.catalogAliasIds || []),
            existing.id,
          ]);
          out[idx] = normalizeSection({
            ...s,
            catalogAliasIds: [...aliases],
            hiddenForFarmTypes: [],
          });
          seenIds.delete(existing.id);
          seenIds.add(NASOSNAYA_SECTION_ID);
        }
      }
      continue;
    }
    seenIds.add(s.id);
    seenNames.add(nameKey);
    out.push(s);
  }
  return out;
}

/** Append default FARM_SECTIONS missing from a custom settings list (id + nasosnaya alias). */
export function mergeMissingDefaultFarmSections(sections) {
  let out = dedupeAndCanonicalizeFarmSections(sections);
  const haveIds = new Set(out.map((s) => s.id));
  const haveNasosnaya =
    haveIds.has(NASOSNAYA_SECTION_ID) || out.some((s) => isNasosnayaSectionName(s.name));

  for (const s of FARM_SECTIONS) {
    if (haveIds.has(s.id)) continue;
    if (s.id === NASOSNAYA_SECTION_ID && haveNasosnaya) continue;
    out.push(
      normalizeSection({
        id: s.id,
        name: s.name,
        group: inferGroupFromName(s.name),
      })
    );
    haveIds.add(s.id);
  }
  return dedupeAndCanonicalizeFarmSections(out);
}

/** Разделы фермы из настроек (с миграцией со старого формата) */
export function resolveFarmSections(settings = {}) {
  const direct = parseJson(settings.farmSections, null);
  if (Array.isArray(direct) && direct.length) {
    return mergeMissingDefaultFarmSections(direct.map(normalizeSection));
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
  return dedupeAndCanonicalizeFarmSections(out);
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
  const withMeta = (line) => ({
    ...line,
    responsible: line.responsible || defaultResp || undefined,
  });

  const lookupIds =
    sectionId === NASOSNAYA_SECTION_ID || isNasosnayaSectionName(sectionMeta?.name)
      ? nasosnayaCatalogLookupIds(sectionMeta)
      : [sectionId];

  let saved = null;
  for (const key of lookupIds) {
    if (catalogs?.[key]?.length) {
      saved = catalogs[key];
      break;
    }
  }

  const legacyFarmSectionIds =
    sectionId === NASOSNAYA_SECTION_ID
      ? nasosnayaCatalogLookupIds(sectionMeta).filter((id) => id !== NASOSNAYA_SECTION_ID)
      : [];

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
  return catalogLinesForFarmSection(materials, sectionId, { legacyFarmSectionIds }).map(withMeta);
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
