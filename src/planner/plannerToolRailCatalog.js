/**
 * Build PlannerToolRail tools from the real TOOL_REGISTRY.
 * Does not invent new CAD tools — only maps registry entries into rail shape.
 */
import { TOOL_REGISTRY, resolveTool } from "./plannerTools.js";

function childFromRegistry(id, icon) {
  const t = resolveTool(id) || TOOL_REGISTRY[id];
  if (!t) return null;
  return {
    id: t.id,
    label: t.label,
    icon: icon || t.id,
    tooltip: t.hint || t.label,
  };
}

/** Primary rail catalog for Phase 1 redesign. */
export function buildPlannerToolRailTools(registry = TOOL_REGISTRY) {
  const racks = (registry.racks_group?.children || [])
    .map((id) => childFromRegistry(id, "objects"))
    .filter(Boolean);
  const engineeringIds = [
    "panel",
    "socket",
    "line",
    "link",
    "pump",
    "ac_indoor",
  ];
  const engineering = engineeringIds
    .map((id) => childFromRegistry(id, "engineering"))
    .filter(Boolean);

  return [
    { id: "select", label: "Выбор", icon: "select", tooltip: "Выбор (Esc)" },
    { id: "wall", label: "Стены", icon: "wall", tooltip: registry.wall_draw?.label || "Стены" },
    { id: "door", label: "Дверь", icon: "door", tooltip: registry.door_std?.label || "Дверь" },
    { id: "window", label: "Окно", icon: "window", tooltip: registry.window_std?.label || "Окно" },
    {
      id: "measure",
      label: "Размер",
      icon: "measure",
      group: true,
      tooltip: "Размеры",
      children: [
        { id: "measure_linear", label: "Линейный", icon: "measure_linear", tooltip: "Линейный размер" },
        { id: "measure_diagonal", label: "Диагональный", icon: "measure_diagonal", tooltip: "Диагональный размер" },
        { id: "measure_angular", label: "Угловой", icon: "measure_angular", tooltip: "Угловой размер" },
      ],
    },
    {
      id: "objects",
      label: "Объекты",
      icon: "objects",
      group: true,
      tooltip: "Стеллажи и объекты",
      children: racks.length ? racks : [{ id: "rack_custom", label: "Стеллаж", icon: "objects" }],
    },
    {
      id: "engineering",
      label: "Инженерия",
      icon: "engineering",
      group: true,
      tooltip: "Инженерные сети",
      children: engineering.length
        ? engineering
        : [{ id: "line", label: "Трасса", icon: "engineering" }],
    },
    { id: "zones", label: "Зоны", icon: "zones", tooltip: "Зоны фермы" },
    { id: "pan", label: "Панорама", icon: "pan", tooltip: "Панорама (рука)" },
  ];
}

/** Map PlanPage tool/measure state → rail activeToolId. */
export function resolveRailActiveToolId({ tool, activeToolId, measureKind, activeCategoryId, activeSheetId }) {
  if (tool === "pan" || activeToolId === "pan") return "pan";
  if (tool === "measure" || activeToolId === "measure") {
    if (measureKind === "diagonal") return "measure_diagonal";
    if (measureKind === "angle") return "measure_angular";
    return "measure_linear";
  }
  if (tool === "select" || activeToolId === "select") return "select";
  if (tool === "wall" || String(activeToolId || "").startsWith("wall")) return "wall";
  if (String(activeToolId || "").startsWith("door") || activeToolId === "door_std") return "door";
  if (String(activeToolId || "").startsWith("window")) return "window";
  if (activeCategoryId === "zones" || activeSheetId === "farm_zones") return "zones";
  if (["power", "water", "drain", "light", "climate", "vent", "ac"].includes(activeCategoryId)) {
    return "engineering";
  }
  if (["racks", "furn", "plumb", "parts"].includes(activeCategoryId) || tool === "add") return "objects";
  return "select";
}
