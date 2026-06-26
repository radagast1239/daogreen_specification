import { parseJson } from "./jsonUtils.js";

export const DEFAULT_FARM_SECTION_GROUPS = [
  { id: "irrigation", label: "Полив", icon: "💧", color: "#0d7ea8" },
  { id: "climate", label: "Климат", icon: "🌡️", color: "#6b5b95" },
  { id: "electrics", label: "Электрика", icon: "⚡", color: "#c9a227" },
  { id: "storage", label: "Склад", icon: "📦", color: "#5a6b5c" },
  { id: "other", label: "Прочее", icon: "📋", color: "#116355" },
];

export function resolveFarmSectionGroups(settings = {}) {
  const list = parseJson(settings.refFarmSectionGroups, null);
  if (Array.isArray(list) && list.length) {
    return list
      .filter((g) => g?.id && g?.label)
      .map((g, i) => ({
        id: String(g.id),
        label: String(g.label),
        icon: g.icon || "📋",
        color: g.color || "#116355",
        order: g.order ?? i,
      }))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
  return DEFAULT_FARM_SECTION_GROUPS.map((g, i) => ({ ...g, order: i }));
}
