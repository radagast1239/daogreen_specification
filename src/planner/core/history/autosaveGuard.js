/**
 * Hydration-aware autosave controller — pure, no React/DOM.
 *
 * PlanPage's current autosave (a single debounced useEffect keyed on plan
 * reference, `actions.projectUpdate(project.id, { plan })` on a bare
 * setTimeout with `.catch(console.error)`) has no protection against:
 *   - saving the initial default plan before hydration completes;
 *   - a slow load's completion racing an unrelated later state;
 *   - two overlapping in-flight saves resolving out of order and marking
 *     a newer edit as "saved" because an older request happened to finish
 *     last;
 *   - a project switch (A -> B, or A -> B -> A) letting a stale load/save
 *     from the old identity touch the new one.
 * This module is the isolated fix for that class of bug — see the old,
 * NOT-ported WIP patch (PlanPage.jsx.wip-from-da63b94.patch) for the
 * specific failure mode this replaces: a hydrated ref that could fail to
 * reset, letting Undo-to-baseline return the same reference and skip a
 * real save.
 *
 * Design:
 *   - One record per *identity* (project id or standalone draft id). Each
 *     record carries a monotonic `generation`. Switching away and back to
 *     the same identity (A -> B -> A) starts a NEW generation for A, so a
 *     stale async completion tagged with the old generation is ignored
 *     instead of corrupting the new session.
 *   - Dirty/clean is decided by a semantic *fingerprint* of the plan
 *     (canonical, key-order-independent JSON), never by object identity —
 *     an Undo that lands back on a plan equal to the CURRENT saved baseline
 *     is clean; an Undo that lands on some other previously-saved state is
 *     dirty relative to the current baseline and must save again.
 *   - Baseline only advances on a *confirmed* save success (or a confirmed
 *     hydration), never optimistically.
 *   - At most one in-flight save per identity. A plan observed while a
 *     save is in flight becomes "pending latest" and is coalesced into the
 *     next save once the current one settles — never a second parallel
 *     request, never a stale live callback captured mid-flight.
 */

const STATUS = Object.freeze({
  IDLE: "idle",
  HYDRATING: "hydrating",
  HYDRATED: "hydrated",
  DIRTY: "dirty",
  SAVING: "saving",
  SAVE_FAILED: "save-failed",
});

function identityKey(identity) {
  if (!identity || identity.id == null) throw new Error("autosaveGuard: identity.id is required");
  const mode = identity.mode || "project";
  return `${mode}:${identity.id}`;
}

/**
 * Canonical, reference-independent, key-order-independent stringify.
 * No existing stable-stringify helper was found in this codebase (checked
 * package.json and src/shared for one) — this is intentionally small: sort
 * object keys recursively, leave array order as-is (array order is still
 * semantically meaningful for plan data), drop `undefined` values the same
 * way JSON.stringify already does.
 */
export function canonicalPlanStringify(value) {
  const seen = new WeakSet();
  const sort = (v) => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v)) return null; // break cycles — real plans may retain cross-links
    seen.add(v);
    if (Array.isArray(v)) return v.map(sort);
    return Object.keys(v).sort().reduce((acc, k) => {
      const val = v[k];
      if (val !== undefined) acc[k] = sort(val);
      return acc;
    }, {});
  };
  return JSON.stringify(sort(value));
}

/**
 * Default fingerprint: canonical stringify of the plan, optionally minus a
 * caller-supplied set of top-level keys that are known not to be persisted
 * (session-only UI state that might, in some future refactor, end up living
 * on the same object as the plan instead of in separate React state, as it
 * does today — see PlanPage's roomDetectionDiagnostic, which is already a
 * sibling state variable, not a plan field, and so is excluded from the
 * fingerprint simply by never being part of `plan` in the first place).
 */
export function defaultFingerprint(plan, { excludeKeys = [] } = {}) {
  if (!plan || typeof plan !== "object") return canonicalPlanStringify(plan);
  if (!excludeKeys.length) return canonicalPlanStringify(plan);
  const filtered = {};
  for (const k of Object.keys(plan)) {
    if (!excludeKeys.includes(k)) filtered[k] = plan[k];
  }
  return canonicalPlanStringify(filtered);
}

function createRecord(generation) {
  return {
    generation,
    status: STATUS.IDLE,
    baselineFingerprint: null,
    pendingPlan: null,
    pendingFingerprint: null,
    inFlight: null, // { generation, fingerprint }
    timerHandle: null,
    lastError: null,
  };
}

/**
 * @param {object} [opts]
 * @param {(identity, plan) => Promise<any>} [opts.saveFn] - required to use
 *   the automatic debounce/save pipeline (observePlan). Omit it to drive the
 *   state machine manually via beginSave/completeSave/failSave only.
 * @param {(plan, opts) => string} [opts.fingerprintFn]
 * @param {number} [opts.debounceMs]
 * @param {(fn: () => void, ms: number) => any} [opts.schedule]
 * @param {(handle: any) => void} [opts.cancelSchedule]
 * @param {string[]} [opts.excludeKeys] - top-level plan keys never part of the fingerprint.
 */
export function createAutosaveController(opts = {}) {
  const {
    saveFn = null,
    fingerprintFn = (plan) => defaultFingerprint(plan, { excludeKeys: opts.excludeKeys || [] }),
    debounceMs = 700,
    schedule = (fn, ms) => setTimeout(fn, ms),
    cancelSchedule = (h) => clearTimeout(h),
  } = opts;

  /** @type {Map<string, ReturnType<typeof createRecord>>} */
  const records = new Map();
  let generationSeq = 0;
  let disposed = false;

  function getOrInitRecord(identity) {
    const key = identityKey(identity);
    let record = records.get(key);
    if (!record) {
      record = createRecord(++generationSeq);
      records.set(key, record);
    }
    return record;
  }

  function isCurrent(identity, generation) {
    const record = records.get(identityKey(identity));
    return !!record && record.generation === generation;
  }

  function clearTimer(record) {
    if (record.timerHandle != null) {
      cancelSchedule(record.timerHandle);
      record.timerHandle = null;
    }
  }

  /** Starts a new session for this identity — new generation, clean slate. */
  function beginHydration(identity) {
    if (disposed) throw new Error("autosaveGuard: controller disposed");
    const key = identityKey(identity);
    const prior = records.get(key);
    if (prior) clearTimer(prior);
    const record = createRecord(++generationSeq);
    record.status = STATUS.HYDRATING;
    records.set(key, record);
    return record.generation;
  }

  /** Stale completions (identity moved on since beginHydration) are ignored. */
  function completeHydration(identity, loadedPlan) {
    const key = identityKey(identity);
    const record = records.get(key);
    if (!record || record.status !== STATUS.HYDRATING) return { applied: false, reason: "stale" };
    record.baselineFingerprint = fingerprintFn(loadedPlan);
    record.status = STATUS.HYDRATED;
    record.pendingPlan = null;
    record.pendingFingerprint = null;
    record.lastError = null;
    return { applied: true, generation: record.generation };
  }

  function failHydration(identity, error) {
    const key = identityKey(identity);
    const record = records.get(key);
    if (!record || record.status !== STATUS.HYDRATING) return { applied: false, reason: "stale" };
    record.status = STATUS.IDLE;
    record.lastError = error ?? null;
    return { applied: true };
  }

  /** True if `plan` differs from the identity's current saved baseline. */
  function shouldSave(identity, plan) {
    const record = records.get(identityKey(identity));
    if (!record) return false;
    if (record.status === STATUS.IDLE || record.status === STATUS.HYDRATING) return false;
    return fingerprintFn(plan) !== record.baselineFingerprint;
  }

  function startSaveIfPossible(identity) {
    const key = identityKey(identity);
    const record = records.get(key);
    if (!record || record.inFlight || !record.pendingPlan) return;
    if (!saveFn) return; // manual-drive mode: caller calls beginSave/completeSave/failSave itself.
    const plan = record.pendingPlan;
    const generation = record.generation;
    const gen = beginSave(identity, plan);
    if (gen == null) return; // stale/no-op
    Promise.resolve()
      .then(() => saveFn(identity, plan))
      .then((result) => {
        if (!isCurrent(identity, generation)) return;
        completeSave(identity, plan, result);
      }, (error) => {
        if (!isCurrent(identity, generation)) return;
        failSave(identity, error);
      });
  }

  /** Marks the given plan in-flight. Returns the generation, or null if stale/no-op. */
  function beginSave(identity, plan) {
    const key = identityKey(identity);
    const record = records.get(key);
    if (!record || record.inFlight) return null;
    const fingerprint = fingerprintFn(plan);
    record.status = STATUS.SAVING;
    record.inFlight = { generation: record.generation, fingerprint };
    return record.generation;
  }

  function completeSave(identity, savedPlan, result) {
    const key = identityKey(identity);
    const record = records.get(key);
    if (!record || !record.inFlight) return { applied: false, reason: "stale" };
    const savedFingerprint = fingerprintFn(savedPlan);
    record.baselineFingerprint = savedFingerprint;
    record.inFlight = null;
    record.lastError = null;
    if (record.pendingFingerprint && record.pendingFingerprint !== savedFingerprint) {
      // Newer edits arrived while this save was in flight — still dirty,
      // and the queue must serialize the next save rather than run it in
      // parallel with anything else.
      record.status = STATUS.DIRTY;
      startSaveIfPossible(identity);
    } else {
      record.status = STATUS.HYDRATED;
      record.pendingPlan = null;
      record.pendingFingerprint = null;
    }
    return { applied: true, revision: result?.revision };
  }

  function failSave(identity, error) {
    const key = identityKey(identity);
    const record = records.get(key);
    if (!record || !record.inFlight) return { applied: false, reason: "stale" };
    record.inFlight = null;
    record.status = STATUS.SAVE_FAILED;
    record.lastError = error ?? null;
    // Baseline is NOT advanced — pendingPlan/pendingFingerprint stay as-is so
    // the next observePlan (or an explicit retry()) re-attempts with the
    // still-dirty snapshot. No auto-retry loop is scheduled here.
    return { applied: true };
  }

  /**
   * Report the current plan for this identity. No-op before hydration
   * completes (nothing to compare against yet, and the default/initial plan
   * must never autosave). Coalesces rapid calls into the latest snapshot and
   * (re)starts the debounce timer; does not start a second save while one is
   * already in flight for this identity.
   */
  function observePlan(identity, plan) {
    if (disposed) return;
    const record = records.get(identityKey(identity));
    if (!record || record.status === STATUS.IDLE || record.status === STATUS.HYDRATING) return;

    const fingerprint = fingerprintFn(plan);
    if (fingerprint === record.baselineFingerprint) {
      clearTimer(record);
      record.pendingPlan = null;
      record.pendingFingerprint = null;
      if (record.status === STATUS.DIRTY) record.status = STATUS.HYDRATED;
      return;
    }

    record.pendingPlan = plan;
    record.pendingFingerprint = fingerprint;
    if (record.status !== STATUS.SAVING) record.status = STATUS.DIRTY;

    clearTimer(record);
    if (!saveFn) return; // manual-drive mode.
    record.timerHandle = schedule(() => {
      record.timerHandle = null;
      startSaveIfPossible(identity);
    }, debounceMs);
  }

  /** Re-attempt a save using the still-pending snapshot after a failure. */
  function retry(identity) {
    startSaveIfPossible(identity);
  }

  /** Explicitly invalidate an identity's session (e.g. leaving it) without starting a new one. */
  function resetForIdentity(identity) {
    const key = identityKey(identity);
    const record = records.get(key);
    if (record) clearTimer(record);
    records.delete(key);
  }

  function getState(identity) {
    const record = records.get(identityKey(identity));
    if (!record) return null;
    return {
      status: record.status,
      generation: record.generation,
      dirty: record.status === STATUS.DIRTY || record.status === STATUS.SAVING || record.status === STATUS.SAVE_FAILED,
      lastError: record.lastError,
    };
  }

  function dispose() {
    for (const record of records.values()) clearTimer(record);
    records.clear();
    disposed = true;
  }

  return {
    STATUS,
    beginHydration,
    completeHydration,
    failHydration,
    observePlan,
    shouldSave,
    beginSave,
    completeSave,
    failSave,
    retry,
    resetForIdentity,
    getState,
    dispose,
  };
}
