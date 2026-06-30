/** Режимы верхней панели — фильтр групп листов, не отдельные экраны. */

export const PLANNER_VIEW_MODES = [
  {
    id: "2d",
    label: "2D",
    title: "Все листы — полный набор вкладок",
    sheetIds: null,
    defaultSheetId: "base_plan",
  },
  {
    id: "walls",
    label: "Стены",
    title: "Чертёж: исходный план, перегородки, зоны фермы",
    sheetIds: ["base_plan", "partitions", "farm_zones"],
    defaultSheetId: "partitions",
  },
  {
    id: "objects",
    label: "Объекты",
    title: "Оборудование: стеллажи, мебель, сантехника",
    sheetIds: ["racks", "equipment", "plumbing"],
    defaultSheetId: "racks",
  },
  {
    id: "engineering",
    label: "Инженерка",
    title: "Инженерные системы: вода, дренаж, электрика, климат, вентиляция…",
    sheetIds: [
      "irrigation", "drainage", "water_treatment", "electrical", "lighting",
      "climate", "ventilation", "plumbing", "safety", "specification",
    ],
    defaultSheetId: "irrigation",
  },
  {
    id: "3d",
    label: "3D",
    title: "3D — в разработке",
    disabled: true,
  },
];

export function viewModeById(id) {
  return PLANNER_VIEW_MODES.find((m) => m.id === id) || PLANNER_VIEW_MODES[0];
}

export function viewModeForSheet(sheetId) {
  for (const mode of PLANNER_VIEW_MODES) {
    if (!mode.sheetIds?.includes(sheetId)) continue;
    return mode.id;
  }
  return "2d";
}

export function sheetsForViewMode(modeId, allSheets) {
  const mode = viewModeById(modeId);
  if (!mode.sheetIds) return allSheets;
  const allowed = new Set(mode.sheetIds);
  return allSheets.filter((s) => allowed.has(s.id));
}

export function sheetAllowedInViewMode(sheetId, modeId) {
  const mode = viewModeById(modeId);
  if (!mode.sheetIds) return true;
  return mode.sheetIds.includes(sheetId);
}
