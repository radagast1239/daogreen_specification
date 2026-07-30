/**
 * PHASE 1A-2C2D3E2 — apply-orchestration для atomic multi-line delete
 * (line.bulkDelete), mirroring applyItemBulkDelete.js's contract for lines.
 * Leaf helper: не импортирует React/DOM/HistoryModel/geometryCommands
 * напрямую — только вызывает переданный runGeometryCommand (production
 * dispatcher) ровно один раз с каноническим payload line.bulkDelete. Не
 * закрывает editor/confirm dialog, не трогает selection и не мутирует plan —
 * вызывающий код (PlanPage) решает по result.status, что делать дальше.
 */

const GEOMETRY_COMMAND_NO_TARGET = "GEOMETRY_COMMAND_NO_TARGET";
const GEOMETRY_COMMAND_COMMIT_FAILED = "GEOMETRY_COMMAND_COMMIT_FAILED";

/**
 * @param {object} params
 * @param {string[]} params.lineIds
 * @param {(command:object)=>object|null} params.runGeometryCommand
 * @returns {
 *   {status:"success"|"noop"|"no-target"|"geometry-rejected"|"commit-failed", result:object|null}
 * }
 */
export function applyLineBulkDelete({ lineIds, runGeometryCommand }) {
  if (!Array.isArray(lineIds) || lineIds.length === 0) {
    // Nothing to even attempt — mirrors an empty/stale delete set, not a
    // geometry failure, so callers should treat this like "no-target".
    return { status: "no-target", result: null };
  }

  const result = runGeometryCommand({ type: "line.bulkDelete", lineIds });

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
