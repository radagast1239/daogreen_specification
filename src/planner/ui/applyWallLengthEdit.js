/**
 * PHASE 1B-1B — apply-orchestration для wall-length inline editor.
 *
 * Leaf helper: не импортирует React/DOM. Не закрывает editor и не знает про
 * focus — вызывающий код (PlanPage) решает по result.status, что делать
 * с editor state.
 */
import { parseWallLengthInput } from "./parseWallLengthInput.js";

const GEOMETRY_COMMAND_COMMIT_FAILED = "GEOMETRY_COMMAND_COMMIT_FAILED";

/**
 * @param {object} params
 * @param {string} params.rawValue
 * @param {string} params.wallId
 * @param {"a"|"b"} params.fixedEndpoint
 * @param {(command:object)=>object|null} params.runGeometryCommand
 * @returns {
 *   {status:"parse-rejected", code:string, message:string} |
 *   {status:"success"|"noop"|"geometry-rejected"|"commit-failed", result:object|null}
 * }
 */
export function applyWallLengthEdit({ rawValue, wallId, fixedEndpoint, runGeometryCommand }) {
  const parsed = parseWallLengthInput(rawValue);
  if (!parsed.ok) {
    return { status: "parse-rejected", code: parsed.code, message: parsed.message };
  }

  const result = runGeometryCommand({
    type: "wall.setLength",
    wallId,
    lengthMm: parsed.lengthMm,
    fixedEndpoint,
  });

  if (!result) {
    // Dispatcher's own unexpected-exception guard already fired and already
    // surfaced showMessage — nothing further for this helper to add.
    return { status: "geometry-rejected", result: null };
  }
  if (!result.ok) {
    const isCommitFailure = result.error?.code === GEOMETRY_COMMAND_COMMIT_FAILED;
    return { status: isCommitFailure ? "commit-failed" : "geometry-rejected", result };
  }
  return { status: result.changed ? "success" : "noop", result };
}

/**
 * PHASE 1B-1B §9 — synchronous submission guard against duplicate
 * Enter/blur/rapid-Enter command dispatch. A plain token compare-and-swap:
 * `tryConsume` only succeeds once per `open()`/`reopen()`; a later call with
 * a stale or already-consumed token is a safe no-op. Deliberately not tied to
 * React render timing — a trailing native blur fired by DOM removal after a
 * successful Enter must see an already-consumed token, regardless of whether
 * React has re-rendered yet.
 */
export function createWallLengthEditSession() {
  let activeToken = null;
  let counter = 0;
  return {
    /** Starts a new session, invalidating any previous token. Returns the fresh token. */
    open() {
      counter += 1;
      activeToken = counter;
      return activeToken;
    },
    /** Consumes the token if it's still the active one. Returns false (no-op) otherwise. */
    tryConsume(token) {
      if (token == null || activeToken !== token) return false;
      activeToken = null;
      return true;
    },
    /** Re-arms the same token after a "keep editor open" outcome (parse/geometry/commit rejection). */
    reopen(token) {
      activeToken = token;
    },
    /** Explicitly invalidates the session (Escape, or after a successful close). */
    close() {
      activeToken = null;
    },
    isOpen(token) {
      return activeToken === token;
    },
  };
}
