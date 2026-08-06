/**
 * Wall/node drag adapter over interactionSession (PHASE 1A).
 *
 * Holds one transaction at a time and is the only place that decides when a
 * drag turns into a committed edit. Pointer handlers call begin/preview/
 * commit/cancel; history and autosave are reached solely through `commitFrom`,
 * which fires at most once per transaction and never during preview.
 *
 * Deliberately free of React so the boundary can be tested without a DOM.
 */
import {
  createInteractionSession,
  beginInteraction,
  previewInteraction,
  commitInteraction,
  cancelInteraction,
  isInteractionActive,
} from "./interactionSession.js";

/**
 * @param {object} opts
 * @param {(previewPlan: object, ctx: {kind: string|null, meta: any, basePlan: object}) => object} [opts.finalize]
 *        Commit-time pass over the last preview — this is where the single
 *        room sync belongs. Defaults to identity.
 * @param {(basePlan: object, finalPlan: object) => void} opts.commitFrom
 *        One history step + one autosave observation. Required.
 * @param {(state: object) => void} [opts.onChange] — re-render notification.
 */
export function createWallEditController({ finalize = null, commitFrom, onChange = null } = {}) {
  if (typeof commitFrom !== "function") {
    throw new Error("createWallEditController: commitFrom is required");
  }

  let state = createInteractionSession();

  const sync = (next) => {
    if (next === state) return;
    state = next;
    onChange?.(state);
  };

  return {
    getState: () => state,
    isActive: () => isInteractionActive(state),
    getTxId: () => state.txId,
    getKind: () => (isInteractionActive(state) ? state.kind : null),
    getBasePlan: () => (isInteractionActive(state) ? state.basePlan : null),
    getPreviewPlan: () => (isInteractionActive(state) ? state.previewPlan : null),

    /** @returns {number|null} transaction id to carry on the drag record. */
    begin(basePlan, kind, meta = null) {
      const r = beginInteraction(state, { basePlan, kind, meta });
      sync(r.state);
      return r.ok ? r.txId : null;
    },

    preview(txId, nextPlan) {
      const r = previewInteraction(state, txId, nextPlan);
      sync(r.state);
      return r.ok;
    },

    /**
     * @returns {{committed: boolean, reason: string|null, basePlan?: object, plan?: object}}
     * A rejected or empty commit still closes the transaction — the pointer is
     * up either way, so nothing may stay open behind it.
     */
    commit(txId) {
      const r = commitInteraction(state, txId);
      sync(r.state);
      if (!r.ok) return { committed: false, reason: r.reason };
      if (!r.changed) return { committed: false, reason: "NO_PREVIEW" };

      const finalPlan = finalize
        ? finalize(r.previewPlan, { kind: r.kind, meta: r.meta, basePlan: r.basePlan })
        : r.previewPlan;
      if (!finalPlan || finalPlan === r.basePlan) {
        return { committed: false, reason: "NO_EFFECTIVE_CHANGE" };
      }
      commitFrom(r.basePlan, finalPlan);
      return { committed: true, reason: null, basePlan: r.basePlan, plan: finalPlan };
    },

    cancel(txId = null) {
      const r = cancelInteraction(state, txId);
      sync(r.state);
      return { cancelled: r.ok, reason: r.reason };
    },
  };
}
