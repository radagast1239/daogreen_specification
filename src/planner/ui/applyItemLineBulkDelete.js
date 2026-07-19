/**
 * PHASE 1A-2C2D3E4C — apply-orchestration для atomic combined item+line
 * delete (itemLine.bulkDelete), mirroring applyItemBulkDelete.js/
 * applyLineBulkDelete.js's contract. Leaf helper: не импортирует React/DOM/
 * HistoryModel/geometryCommands напрямую — только вызывает переданный
 * runGeometryCommand (production dispatcher) ровно один раз с каноническим
 * payload itemLine.bulkDelete. Не закрывает editor/confirm dialog, не
 * трогает selection и не мутирует plan — вызывающий код (PlanPage, в
 * будущей фазе) решает по result.status, что делать дальше.
 */

const GEOMETRY_COMMAND_NO_TARGET = "GEOMETRY_COMMAND_NO_TARGET";
const GEOMETRY_COMMAND_COMMIT_FAILED = "GEOMETRY_COMMAND_COMMIT_FAILED";

/**
 * PHASE 1A-2C2D3E4C REQUIRED FIX F-01 — a collection that is genuinely
 * omitted (undefined) defaults to [] (convenience for an items-only/
 * lines-only caller). A collection that IS present but is not an array
 * (a string, number, object, null, boolean — e.g. a caller passing a bare
 * ID instead of a one-element array) is a caller bug and must never be
 * silently coerced to [] and dispatched as a partial delete of the other,
 * valid collection — that would report "success" while silently dropping
 * half of what the caller asked for. Mirrors applyItemBulkDelete/
 * applyLineBulkDelete's own immediate no-target short-circuit on malformed
 * input, extended to two independently-checked collections here.
 *
 * @param {object} params
 * @param {string[]} params.itemIds
 * @param {string[]} params.lineIds
 * @param {(command:object)=>object|null} params.runGeometryCommand
 * @returns {
 *   {status:"success"|"noop"|"no-target"|"geometry-rejected"|"commit-failed", result:object|null}
 * }
 */
export function applyItemLineBulkDelete({ itemIds, lineIds, runGeometryCommand }) {
  const normalizedItemIds = itemIds === undefined ? [] : itemIds;
  const normalizedLineIds = lineIds === undefined ? [] : lineIds;

  if (!Array.isArray(normalizedItemIds) || !Array.isArray(normalizedLineIds)) {
    return { status: "no-target", result: null };
  }

  if (normalizedItemIds.length === 0 && normalizedLineIds.length === 0) {
    // Nothing to even attempt — mirrors an empty/stale delete set, not a
    // geometry failure, so callers should treat this like "no-target".
    return { status: "no-target", result: null };
  }

  const result = runGeometryCommand({
    type: "itemLine.bulkDelete",
    itemIds: normalizedItemIds,
    lineIds: normalizedLineIds,
  });

  if (!result) {
    // Dispatcher's own unexpected-exception guard already fired and already
    // surfaced showMessage — nothing further for this helper to add.
    return { status: "geometry-rejected", result: null };
  }
  if (!result.ok) {
    if (result.error?.code === GEOMETRY_COMMAND_NO_TARGET) {
      return { status: "no-target", result };
    }
    const isCommitFailure = result.error?.code === GEOMETRY_COMMAND_COMMIT_FAILED;
    return { status: isCommitFailure ? "commit-failed" : "geometry-rejected", result };
  }
  return { status: result.changed ? "success" : "noop", result };
}
