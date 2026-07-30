/**
 * Runtime mapping for farm section «Насосная группа и обвязка».
 * Live DB may use a custom section id (e.g. sec_mqnle91vjkr2l) with materials/
 * catalogs tagged to that id — not the canonical sec_nasosnaya.
 */

import {
  materialInFarmSection,
  primaryMaterialFarmSection,
  resolveMaterialFarmSections,
} from "./materialFarmSections.js";
import { materialInModule, resolveMaterialModules } from "./materialModules.js";

export const NASOSNAYA_SECTION_ID = "sec_nasosnaya";
export const NASOSNAYA_CANONICAL_NAME = "Насосная группа и обвязка";

/** Normalized labels that count as the same builder card. */
export const NASOSNAYA_NAME_ALIASES = [
  "насосы",
  "насосная группа",
  "насосная группа и обвязка",
];

/** Module / section tags on materials (as stored). */
export const NASOSNAYA_MODULE_ALIASES = [
  "Насосная группа и обвязка",
  "Насосная группа",
  "Насосы",
];

/**
 * Known live custom farm-section ids that are the pump group card.
 * Observed in local/production settings: same name, uid()-style id.
 */
export const NASOSNAYA_KNOWN_LEGACY_SECTION_IDS = new Set([
  "sec_mqnle91vjkr2l",
]);

/**
 * Seed/legacy material ids that are pump-core even under «Общая закупка».
 * Not a full m161–m178 sweep — fittings stay out.
 */
export const NASOSNAYA_SEED_MATERIAL_IDS = new Set([
  "m161",
  "m162",
  "m163",
  "m164",
  "m165",
  "m166",
  "m174",
]);

/** Modules that must not pull materials via broad fallback alone. */
export const NASOSNAYA_EXCLUDE_MODULES = [
  "Общая магистраль полива и дренажа",
  "Водоподготовка",
  "Полив/дренаж + обвязка насоса подтопление",
  "Полив/дренаж + обвязка насоса проточка",
  "Общая закупка на ферму",
];

export function normalizeFarmSectionLabel(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

export function isNasosnayaSectionName(name) {
  return NASOSNAYA_NAME_ALIASES.includes(normalizeFarmSectionLabel(name));
}

export function isNasosnayaFarmSectionId(id) {
  const sid = String(id || "").trim();
  if (!sid) return false;
  if (sid === NASOSNAYA_SECTION_ID) return true;
  return NASOSNAYA_KNOWN_LEGACY_SECTION_IDS.has(sid);
}

function materialHasModule(mat, moduleName) {
  return materialInModule(mat, moduleName);
}

function materialHasOnlyExcludedModules(mat) {
  const mods = resolveMaterialModules(mat);
  if (!mods.length) return false;
  return mods.every((m) => NASOSNAYA_EXCLUDE_MODULES.includes(m));
}

/** Strong name patterns for pump units / pump plumbing kits (not generic fittings). */
export function isNasosnayaCoreName(name) {
  const n = normalizeFarmSectionLabel(name);
  if (!n) return false;
  if (/^насосная станция/.test(n)) return true;
  if (/^насосы\b/.test(n)) return true;
  if (/^насос\b/.test(n)) return true;
  if (/обвязка насоса/.test(n)) return true;
  return false;
}

function isNasosnayaCategory(mat) {
  return normalizeFarmSectionLabel(mat?.category) === "насосы";
}

/**
 * Core pump rows via client section — pumps feed/drain only, not every dual-tagged fitting.
 */
function isNasosnayaClientPumpCore(mat) {
  if (String(mat?.clientSection || mat?.client_section || "").trim() !== "pumps") return false;
  const sub = normalizeFarmSectionLabel(mat?.clientSubsection || mat?.client_subsection);
  return (
    sub === "насосы подачи" ||
    sub === "насосы дренажа" ||
    sub === "обвязка насосов" ||
    !sub
  );
}

/**
 * @param {object} mat
 * @param {{ legacyFarmSectionIds?: string[] }} [options]
 */
export function materialBelongsToNasosnaya(mat, options = {}) {
  if (!mat || (mat.status && mat.status !== "active")) return false;

  if (materialInFarmSection(mat, NASOSNAYA_SECTION_ID)) return true;

  const legacyIds = [
    ...NASOSNAYA_KNOWN_LEGACY_SECTION_IDS,
    ...(options.legacyFarmSectionIds || []),
  ].filter(Boolean);

  for (const legacyId of legacyIds) {
    if (legacyId === NASOSNAYA_SECTION_ID) continue;
    if (materialInFarmSection(mat, legacyId)) {
      // Dual-tagged fittings: only include when primary/home section is the pump group
      // OR the material is a core pump name/category.
      const primary = primaryMaterialFarmSection(mat);
      if (isNasosnayaFarmSectionId(primary) || legacyIds.includes(primary)) return true;
      if (isNasosnayaCoreName(mat.name) || isNasosnayaCategory(mat)) return true;
      if (isNasosnayaClientPumpCore(mat) && isNasosnayaCoreName(mat.name)) return true;
      // Exclusive tag: only on nasosnaya legacy id(s)
      const secs = resolveMaterialFarmSections(mat);
      if (secs.length && secs.every((id) => isNasosnayaFarmSectionId(id) || legacyIds.includes(id))) {
        return true;
      }
    }
  }

  for (const alias of NASOSNAYA_MODULE_ALIASES) {
    if (materialHasModule(mat, alias)) return true;
  }

  const sectionField = String(mat.section || "").trim();
  if (sectionField && isNasosnayaSectionName(sectionField)) return true;

  if (isNasosnayaCategory(mat)) return true;
  if (isNasosnayaCoreName(mat.name)) return true;

  const id = String(mat.id || mat.materialId || "").trim();
  if (id && NASOSNAYA_SEED_MATERIAL_IDS.has(id)) return true;

  return false;
}

export function materialExcludedFromNasosnayaCatalog(mat, options = {}) {
  if (materialBelongsToNasosnaya(mat, options)) return false;
  if (materialHasOnlyExcludedModules(mat)) return true;
  const mods = resolveMaterialModules(mat);
  return mods.some((m) =>
    ["Общая магистраль полива и дренажа", "Водоподготовка"].includes(m)
  );
}

/**
 * Canonicalize runtime section card.
 * Clears broken hide-all farm-type filters; remembers legacy catalog id.
 */
export function canonicalizeNasosnayaSection(section) {
  if (!section) return section;
  const nameMatch = isNasosnayaSectionName(section.name);
  const idMatch = isNasosnayaFarmSectionId(section.id);
  if (!nameMatch && !idMatch) return section;
  const prevId = String(section.id || "").trim();
  const aliases = new Set(Array.isArray(section.catalogAliasIds) ? section.catalogAliasIds : []);
  if (prevId && prevId !== NASOSNAYA_SECTION_ID) aliases.add(prevId);
  for (const id of NASOSNAYA_KNOWN_LEGACY_SECTION_IDS) aliases.add(id);
  return {
    ...section,
    id: NASOSNAYA_SECTION_ID,
    name: NASOSNAYA_CANONICAL_NAME,
    // Live settings hid the card for every farm type — always show after canonicalize.
    hiddenForFarmTypes: [],
    catalogAliasIds: [...aliases],
  };
}

/** Catalog keys to try for nasosnaya (canonical + legacy). */
export function nasosnayaCatalogLookupIds(sectionMeta = null) {
  const ids = [NASOSNAYA_SECTION_ID];
  for (const id of sectionMeta?.catalogAliasIds || []) {
    if (id && !ids.includes(id)) ids.push(id);
  }
  for (const id of NASOSNAYA_KNOWN_LEGACY_SECTION_IDS) {
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}
