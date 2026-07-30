import {
  NASOSNAYA_CANONICAL_NAME,
  NASOSNAYA_MODULE_ALIASES,
  NASOSNAYA_SECTION_ID,
} from "../../shared/nasosnayaFarmSection.js";

/** Разделы спецификации «Ферма целиком» — порядок задаётся sortOrder */
export const FARM_SECTIONS = [
  {
    id: "sec_poliv_pod",
    name: "Полив/дренаж + обвязка насоса подтопление",
    module: "Полив/дренаж + обвязка насоса подтопление",
    sortOrder: 1,
  },
  {
    id: "sec_poliv_proto",
    name: "Полив/дренаж + обвязка насоса проточка",
    module: "Полив/дренаж + обвязка насоса проточка",
    sortOrder: 2,
  },
  {
    id: NASOSNAYA_SECTION_ID,
    name: NASOSNAYA_CANONICAL_NAME,
    module: NASOSNAYA_CANONICAL_NAME,
    sortOrder: 3,
  },
  {
    id: "sec_klimat",
    name: "Климат, вентиляция, автоматика",
    module: "Климат, вентиляция, автоматика",
    sortOrder: 4,
  },
  {
    id: "sec_manip",
    name: "Манипуляционная зона",
    module: "Манипуляционная зона",
    sortOrder: 5,
  },
];

/** Primary module alias per section (see shared/nasosnayaFarmSection for full membership). */
export const FARM_SECTION_MODULE_ALIASES = {
  [NASOSNAYA_SECTION_ID]: NASOSNAYA_CANONICAL_NAME,
};

export function farmSectionById(id) {
  return FARM_SECTIONS.find((s) => s.id === id);
}

export function farmSectionModuleAlias(sectionId) {
  if (sectionId === NASOSNAYA_SECTION_ID) {
    return NASOSNAYA_MODULE_ALIASES[0] || NASOSNAYA_CANONICAL_NAME;
  }
  return FARM_SECTION_MODULE_ALIASES[sectionId] || farmSectionById(sectionId)?.module || "";
}
