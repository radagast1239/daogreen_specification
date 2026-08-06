/**
 * Pointer adapter over wallDrawSession (PHASE 2A).
 *
 * Holds one drag-release gesture at a time and is the only place that turns a
 * released gesture into a committed wall: `commitSegment` runs at most once per
 * transaction and never during preview. Free of React so the pointer contract
 * can be tested without a DOM.
 */
import {
  createWallDrawSession,
  beginWallDraw,
  previewWallDraw,
  commitWallDraw,
  cancelWallDraw,
  isWallDrawActive,
  wallDrawPreview,
  WALL_DRAW_V2_MIN_LEN_MM,
} from "./wallDrawSession.js";

/**
 * @param {object} opts
 * @param {(segment: {start: object, end: object, startSnap: any, endSnap: any}) => void} opts.commitSegment
 *        Runs the canonical single-segment pipeline exactly once. Required.
 * @param {number} [opts.minLenMm] — below this a release draws nothing.
 * @param {(state: object) => void} [opts.onChange] — re-render notification.
 */
export function createWallDrawController({
  commitSegment,
  minLenMm = WALL_DRAW_V2_MIN_LEN_MM,
  onChange = null,
} = {}) {
  if (typeof commitSegment !== "function") {
    throw new Error("createWallDrawController: commitSegment is required");
  }

  let state = createWallDrawSession();

  const sync = (next) => {
    if (next === state) return;
    state = next;
    onChange?.(state);
  };

  return {
    getState: () => state,
    isActive: () => isWallDrawActive(state),
    getTxId: () => state.txId,
    getPointerId: () => (isWallDrawActive(state) ? state.pointerId : null),
    getPreview: () => wallDrawPreview(state),

    /** @returns {number|null} transaction id, or null if the point was invalid. */
    begin(input) {
      const r = beginWallDraw(state, input);
      sync(r.state);
      return r.ok ? r.txId : null;
    },

    preview(txId, input) {
      const r = previewWallDraw(state, txId, { minLenMm, ...input });
      sync(r.state);
      return r.ok;
    },

    /**
     * @returns {{committed: boolean, reason: string|null, segment: object|null}}
     * A release below the minimum length closes the gesture and draws nothing.
     */
    commit(txId) {
      const r = commitWallDraw(state, txId, { minLenMm });
      sync(r.state);
      if (!r.ok) return { committed: false, reason: r.reason, segment: null };
      if (!r.segment) return { committed: false, reason: r.reason, segment: null };
      commitSegment(r.segment);
      return { committed: true, reason: null, segment: r.segment };
    },

    cancel(txId = null) {
      const r = cancelWallDraw(state, txId);
      sync(r.state);
      return { cancelled: r.ok, reason: r.reason };
    },
  };
}
