/**
 * PHASE 1A-2C2D3E4D — pure classification/message helpers for the combined
 * power/light/vent (mode:"both") clear confirmation. Leaf helper: не
 * импортирует React/DOM/HistoryModel/geometryCommands/dispatcher — только
 * production migrateLayerId (catalog.js), не переопределяет собственную
 * alias map. Не мутирует переданные items/lines.
 *
 * Items are already canonical after normalizePlanResult (see
 * planNormalize.js), so item.layer is compared directly. Lines still carry
 * legacy layer aliases in older saved plans, so both the raw layer and its
 * migrated form are checked — same policy as clearSheet's existing
 * drain/irrigation line-only branch.
 */
import { migrateLayerId } from "../catalog.js";

/**
 * @param {object} params
 * @param {object[]} params.items — plan.items (unfiltered; this function
 *   does the layer filtering)
 * @param {object[]} params.lines — plan.lines (unfiltered)
 * @param {string} params.layerId — active layer id (e.g. "power")
 * @returns {{itemIds:string[], lineIds:string[], itemCount:number,
 *   lineCount:number, totalCount:number}}
 */
export function summarizeCombinedLayerClear({ items, lines, layerId }) {
  const itemIds = [...new Set(
    (items || [])
      .filter((it) => it && typeof it.id === "string" && it.layer === layerId)
      .map((it) => it.id),
  )];
  const lineIds = [...new Set(
    (lines || [])
      .filter((line) => line && typeof line.id === "string"
        && (line.layer === layerId || migrateLayerId(line.layer) === layerId))
      .map((line) => line.id),
  )];
  return {
    itemIds,
    lineIds,
    itemCount: itemIds.length,
    lineCount: lineIds.length,
    totalCount: itemIds.length + lineIds.length,
  };
}

/**
 * @param {object} params
 * @param {string} params.layerLabel — display name of the active sheet
 * @param {number} params.itemCount
 * @param {number} params.lineCount
 * @returns {string} explicit, honest combined-clear confirmation text
 */
export function buildCombinedLayerClearMessage({ layerLabel, itemCount, lineCount }) {
  return [
    `Будут удалены объекты листа «${layerLabel}»:`,
    "",
    `Оборудование — ${itemCount}`,
    `Линии и трассы — ${lineCount}`,
    "",
    "Продолжить?",
  ].join("\n");
}
