/** Подгруппы строк внутри раздела фермы (не связаны с группами стеллажей) */

export const FARM_LINE_GROUPS = [
  { id: "poliv_podacha", label: "Полив / подача", order: 1 },
  { id: "sliv_drenazh", label: "Слив / дренаж", order: 2 },
  { id: "obvyazka", label: "Обвязка", order: 3 },
  { id: "opcii", label: "Опции", order: 4 },
  { id: "primechaniya", label: "Примечания", order: 5 },
];

export function farmLineGroupLabel(id, groups = FARM_LINE_GROUPS) {
  return groups.find((g) => g.id === id)?.label || id || "—";
}

export function inferFarmLineGroup(line) {
  const n = (line?.name || "").toLowerCase();
  if (/примеч|заметк|видео|memo/.test(n)) return "primechaniya";
  if (/дренаж|слив|канализац/.test(n)) return "sliv_drenazh";
  if (/обвязк|муфт|тройник|угольник/.test(n)) return "obvyazka";
  if (/опци|доп\.|аксессуар/.test(n)) return "opcii";
  return "poliv_podacha";
}

export function resolveFarmLineGroup(line) {
  return line?.farmGroup || line?.lineGroup || line?.subcategory || inferFarmLineGroup(line);
}
