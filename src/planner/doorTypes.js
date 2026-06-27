/** Типы дверей и вспомогательные проверки настенных объектов. */

import { isOpeningKind } from "./openingTypes.js";

export { isOpeningKind } from "./openingTypes.js";

export const DOOR_KINDS = new Set([
  "door",
  "door2",
  "door_slide",
  "door_pivot",
  "door_cold",
  "door_sanitary",
  "door_wash",
  "door_tech",
  "door_gate",
]);

export const DOOR_ICONS = new Set([
  "door",
  "door2",
  "door_slide",
  "door_pivot",
  "door_cold",
  "door_sanitary",
  "door_wash",
  "door_tech",
  "door_gate",
]);

export const DOOR_TYPES = {
  door: { label: "Одинарная", color: "#2f3431", accent: null, swing: true },
  door2: { label: "Двойная", color: "#2f3431", accent: null, swing: true, double: true },
  door_slide: { label: "Откатная", color: "#2f3431", accent: "#6b7d74", swing: false },
  door_pivot: { label: "Маятниковая", color: "#2f3431", accent: "#8a7a9c", swing: true, pivot: true },
  door_cold: { label: "Холодильная", color: "#2f3431", accent: "#4a90c4", swing: true },
  door_sanitary: { label: "Санитарная", color: "#2f3431", accent: "#7a9c6e", swing: true },
  door_wash: { label: "Грязная зона", color: "#2f3431", accent: "#b9741d", swing: true },
  door_tech: { label: "Техническая", color: "#5a5f5c", accent: "#6b7d74", swing: true },
  door_gate: { label: "Ворота", color: "#2f3431", accent: null, swing: true, wide: true },
};

export function isDoorKind(kind) {
  return DOOR_KINDS.has(kind);
}

export function isDoorItem(it) {
  return isDoorKind(it?.kind) || DOOR_ICONS.has(it?.icon);
}

export function isWindowKind(kind) {
  return kind === "window";
}

export function isWallOpeningKind(kind) {
  return isDoorKind(kind) || isOpeningKind(kind);
}

export function isStrictWallItem(kind) {
  return isWallOpeningKind(kind);
}

export function doorStyle(kind) {
  return DOOR_TYPES[kind] || DOOR_TYPES.door;
}

export function doorShowsSwing(kind, display = {}) {
  if (display.doorOpeningsOnly) return false;
  if (display.showDoorArcs === false) return false;
  const st = doorStyle(kind);
  return st.swing !== false;
}
