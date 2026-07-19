/**
 * PHASE 1A-2C2D3E4D — pure UI orchestration for the combined power/light/
 * vent "Очистить лист" flow. Not a new command — composes the already-
 * accepted summarizeCombinedLayerClear (counts/IDs), a caller-supplied
 * confirm function, and applyItemLineBulkDelete (the one canonical
 * dispatch) exactly as clearSheet's combined branch needs, factored out
 * here so the full flow (pre-confirm summary, empty-before-confirm early
 * exit, confirm, live-plan-race re-read after confirm, dispatch) is
 * directly unit-testable without rendering PlanPage.jsx. PlanPage.jsx's
 * clearSheet calls this — not a duplicated/parallel implementation.
 *
 * Leaf: no React/DOM/HistoryModel/geometryCommands imports. window.confirm
 * itself is injected via confirmFn (never called directly here), so this
 * stays DOM-free and unit-testable with a fake confirm.
 */
import { summarizeCombinedLayerClear, buildCombinedLayerClearMessage } from "./combinedLayerClearSummary.js";
import { applyItemLineBulkDelete } from "./applyItemLineBulkDelete.js";

/**
 * @param {object} params
 * @param {() => {items: object[], lines: object[]}} params.getCurrentPlan —
 *   called twice: once for the pre-confirm display counts, once again
 *   AFTER the confirm resolves for the authoritative live-plan-race-safe
 *   delete set — never reuse the pre-confirm read for the actual delete.
 * @param {string} params.layerId — active layer id (e.g. "power")
 * @param {string} params.layerLabel — display name of the active sheet
 * @param {(message: string) => boolean} params.confirmFn — injected in
 *   place of window.confirm so this stays DOM-free
 * @param {(command: object) => object | null} params.runGeometryCommand
 * @returns {"empty"|"cancelled"|"success"|"noop"|"no-target"|"geometry-rejected"|"commit-failed"}
 */
export function applyCombinedLayerClear({
  getCurrentPlan, layerId, layerLabel, confirmFn, runGeometryCommand,
}) {
  const preConfirmPlan = getCurrentPlan();
  const preConfirmSummary = summarizeCombinedLayerClear({
    items: preConfirmPlan.items,
    lines: preConfirmPlan.lines,
    layerId,
  });
  if (preConfirmSummary.totalCount === 0) {
    // Nothing to clear — no confirm dialog, no dispatch, no history.
    return "empty";
  }

  const confirmed = confirmFn(buildCombinedLayerClearMessage({
    layerLabel,
    itemCount: preConfirmSummary.itemCount,
    lineCount: preConfirmSummary.lineCount,
  }));
  if (!confirmed) {
    return "cancelled";
  }

  // Live-plan race: itemIds/lineIds are recomputed from a fresh
  // getCurrentPlan() read taken AFTER the confirm dialog closes, never
  // from the pre-confirm snapshot used only for the displayed counts.
  const freshPlan = getCurrentPlan();
  const freshSummary = summarizeCombinedLayerClear({
    items: freshPlan.items,
    lines: freshPlan.lines,
    layerId,
  });

  const { status } = applyItemLineBulkDelete({
    itemIds: freshSummary.itemIds,
    lineIds: freshSummary.lineIds,
    runGeometryCommand,
  });
  return status;
}
