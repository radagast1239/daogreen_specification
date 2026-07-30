/**
 * PHASE 1A-2C2D3D2 — pure classification/message helpers for the "Исходный
 * план" (room-layer) destructive clear confirmation. Leaf helper: не
 * импортирует React/DOM/HistoryModel/geometryCommands — только authoritative
 * kind predicates already used elsewhere in the planner (doorTypes.js,
 * openingTypes.js), so this never duplicates the room-kind catalog list.
 *
 * Priority (mutually exclusive, no overlap): door -> window -> opening ->
 * other. isOpeningKind() also matches "window", so window is checked first.
 */
import { isDoorKind, isWindowKind } from "../doorTypes.js";
import { isOpeningKind } from "../openingTypes.js";

/**
 * @param {object[]} items — plan.items already filtered to layer==="room"
 * @returns {{doors:number, windows:number, openings:number, other:number}}
 */
export function summarizeRoomClearItems(items) {
  const counts = {
    doors: 0, windows: 0, openings: 0, other: 0,
  };
  for (const it of items || []) {
    const kind = it?.kind;
    if (isDoorKind(kind)) counts.doors += 1;
    else if (isWindowKind(kind)) counts.windows += 1;
    else if (isOpeningKind(kind)) counts.openings += 1;
    else counts.other += 1;
  }
  return counts;
}

/**
 * @param {{doors:number, windows:number, openings:number, other:number}} counts
 * @returns {string} explicit, project-wide destructive confirmation text
 */
export function buildRoomClearConfirmMessage(counts) {
  const lines = [
    "Будут удалены все объекты исходного плана во всём проекте:",
    "",
    `Двери — ${counts.doors}`,
    `Окна — ${counts.windows}`,
    `Проёмы — ${counts.openings}`,
  ];
  if (counts.other > 0) {
    lines.push(`Прочие объекты — ${counts.other}`);
  }
  lines.push("", "Стены и перегородки останутся.", "", "Продолжить?");
  return lines.join("\n");
}
