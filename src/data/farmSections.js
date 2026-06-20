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
    id: "sec_klimat",
    name: "Климат, вентиляция, автоматика",
    module: "Климат, вентиляция, автоматика",
    sortOrder: 3,
  },
  {
    id: "sec_manip",
    name: "Манипуляционная зона",
    module: "Манипуляционная зона",
    sortOrder: 4,
  },
];

export function farmSectionById(id) {
  return FARM_SECTIONS.find((s) => s.id === id);
}
