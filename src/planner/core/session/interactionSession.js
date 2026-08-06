/**
 * Transient interaction transaction (PHASE 1A).
 *
 * The committed plan and an in-flight edit preview are two different things.
 * This module owns that split as a pure state machine: no React, no DOM, no
 * history, no autosave. A caller begins a transaction against an immutable
 * base plan, pushes preview plans while the pointer moves, then commits or
 * cancels exactly once.
 *
 * Invariants:
 *   • begin never touches the base plan;
 *   • preview never touches the base plan;
 *   • commit and cancel each succeed at most once per transaction;
 *   • a stale txId can neither commit nor cancel a newer transaction.
 */

export const INTERACTION_IDLE = "idle";
export const INTERACTION_PREVIEWING = "previewing";

export function createInteractionSession() {
  return {
    status: INTERACTION_IDLE,
    txId: 0,
    kind: null,
    meta: null,
    basePlan: null,
    previewPlan: null,
  };
}

/** Idle state that keeps the counter, so a retired txId is never reissued. */
function idleAfter(state) {
  return { ...createInteractionSession(), txId: state.txId };
}

function isPlanLike(value) {
  return !!value && typeof value === "object";
}

/**
 * Start a transaction against `basePlan`.
 *
 * Contract for a begin while another transaction is still open: the fresh
 * begin ALWAYS wins and the previous transaction is CANCELLED, never
 * committed. A stranded session (lost pointerup, stolen pointer capture) must
 * not be able to block the next edit, and silently committing geometry the
 * user never released would be worse than dropping it.
 *
 * @returns {{state: object, ok: boolean, reason: string|null, txId: number|null, superseded: number|null}}
 */
export function beginInteraction(state, { basePlan, kind = null, meta = null } = {}) {
  const prev = state || createInteractionSession();
  if (!isPlanLike(basePlan)) {
    return { state: prev, ok: false, reason: "INVALID_BASE_PLAN", txId: null, superseded: null };
  }
  const superseded = prev.status === INTERACTION_PREVIEWING ? prev.txId : null;
  const txId = prev.txId + 1;
  return {
    state: {
      status: INTERACTION_PREVIEWING,
      txId,
      kind,
      meta,
      basePlan,
      previewPlan: null,
    },
    ok: true,
    reason: null,
    txId,
    superseded,
  };
}

/**
 * Record the latest preview plan. Pure: the caller's reducer owns geometry,
 * this only stores the result and never reads or rewrites `basePlan`.
 */
export function previewInteraction(state, txId, nextPlan) {
  const prev = state || createInteractionSession();
  if (prev.status !== INTERACTION_PREVIEWING) {
    return { state: prev, ok: false, reason: "NOT_ACTIVE" };
  }
  if (txId !== prev.txId) {
    return { state: prev, ok: false, reason: "STALE_TRANSACTION" };
  }
  if (!isPlanLike(nextPlan)) {
    return { state: prev, ok: false, reason: "INVALID_PREVIEW_PLAN" };
  }
  return { state: { ...prev, previewPlan: nextPlan }, ok: true, reason: null };
}

/**
 * Close the transaction and hand back what the caller needs to persist.
 * `changed` is false when no preview ever arrived, or when the reducer kept
 * returning the base plan — a click that never moved must not become an edit.
 */
export function commitInteraction(state, txId) {
  const prev = state || createInteractionSession();
  const empty = { basePlan: null, previewPlan: null, kind: null, meta: null, changed: false };
  if (prev.status !== INTERACTION_PREVIEWING) {
    return { state: prev, ok: false, reason: "NOT_ACTIVE", ...empty };
  }
  if (txId !== prev.txId) {
    return { state: prev, ok: false, reason: "STALE_TRANSACTION", ...empty };
  }
  return {
    state: idleAfter(prev),
    ok: true,
    reason: null,
    basePlan: prev.basePlan,
    previewPlan: prev.previewPlan,
    kind: prev.kind,
    meta: prev.meta,
    changed: !!prev.previewPlan && prev.previewPlan !== prev.basePlan,
  };
}

/**
 * Drop the transaction. `txId` is optional: an unscoped cancel (Escape, pointer
 * abort) targets whatever is open; a scoped cancel refuses stale ids.
 */
export function cancelInteraction(state, txId = null) {
  const prev = state || createInteractionSession();
  if (prev.status !== INTERACTION_PREVIEWING) {
    return { state: prev, ok: false, reason: "NOT_ACTIVE", basePlan: null };
  }
  if (txId != null && txId !== prev.txId) {
    return { state: prev, ok: false, reason: "STALE_TRANSACTION", basePlan: null };
  }
  return { state: idleAfter(prev), ok: true, reason: null, basePlan: prev.basePlan };
}

export function isInteractionActive(state) {
  return !!state && state.status === INTERACTION_PREVIEWING;
}

export function interactionPreviewPlan(state) {
  return isInteractionActive(state) ? state.previewPlan : null;
}

export function interactionBasePlan(state) {
  return isInteractionActive(state) ? state.basePlan : null;
}

export function interactionKind(state) {
  return isInteractionActive(state) ? state.kind : null;
}

export function interactionTxId(state) {
  return state ? state.txId : 0;
}
