/**
 * PlanPage bridge over createAutosaveController.
 * Keeps React wiring thin and makes hydration/save integration testable
 * without mounting the full PlanPage.
 */
import {
  createAutosaveController,
  defaultFingerprint,
} from "./autosaveGuard.js";

/** Drop session-only wall-command warnings before fingerprint/persist. */
export function stripEphemeralPlanFields(plan) {
  if (!plan || typeof plan !== "object") return plan;
  const warnings = plan.validationWarnings;
  if (!Array.isArray(warnings) || !warnings.some((w) => w?.source === "wall-command")) {
    return plan;
  }
  return {
    ...plan,
    validationWarnings: warnings.filter((w) => w?.source !== "wall-command"),
  };
}

export function planAutosaveFingerprint(plan) {
  return defaultFingerprint(stripEphemeralPlanFields(plan));
}

export function identityKey(identity) {
  if (!identity || identity.id == null) throw new Error("planAutosaveBridge: identity.id required");
  return `${identity.mode || "project"}:${identity.id}`;
}

/**
 * @param {object} opts
 * @param {(identity, plan) => Promise<any>} opts.persistFn — projectUpdate / saveStandalone
 * @param {(status: {status:string, dirty:boolean, failed:boolean, identity:object|null}) => void} [opts.onStatus]
 * @param {() => {mode:string,id:string}|null} [opts.getActiveIdentity] — ignore UI updates for non-active identity
 * @param {number} [opts.debounceMs]
 * @param {(fn:Function, ms:number)=>any} [opts.schedule]
 * @param {(h:any)=>void} [opts.cancelSchedule]
 */
export function createPlanAutosaveBridge(opts = {}) {
  const {
    persistFn,
    onStatus = null,
    getActiveIdentity = null,
    debounceMs = 700,
    schedule,
    cancelSchedule,
  } = opts;

  if (typeof persistFn !== "function") {
    throw new Error("createPlanAutosaveBridge: persistFn is required");
  }

  const controller = createAutosaveController({
    debounceMs,
    fingerprintFn: planAutosaveFingerprint,
    schedule,
    cancelSchedule,
    saveFn: async (identity, plan) => {
      const gen = controller.getState(identity)?.generation;
      emitStatus(identity, "saving", gen);
      try {
        const result = await persistFn(identity, stripEphemeralPlanFields(plan));
        // completeSave/failSave run in the controller's promise chain after we
        // return — defer UI sync past that microtask turn.
        setTimeout(() => {
          if (generationStillCurrent(identity, gen)) syncStatus(identity);
        }, 0);
        return result;
      } catch (error) {
        setTimeout(() => {
          if (generationStillCurrent(identity, gen)) syncStatus(identity);
        }, 0);
        throw error;
      }
    },
  });

  function isActiveIdentity(identity) {
    if (!getActiveIdentity) return true;
    const active = getActiveIdentity();
    if (!active) return false;
    return identityKey(active) === identityKey(identity);
  }

  function generationStillCurrent(identity, generation) {
    const st = controller.getState(identity);
    return !!st && (generation == null || st.generation === generation);
  }

  function emitStatus(identity, phase, generation) {
    if (!onStatus) return;
    if (!generationStillCurrent(identity, generation)) return;
    if (!isActiveIdentity(identity)) return;
    if (phase === "saving") {
      onStatus({ status: "saving", dirty: true, failed: false, identity });
      return;
    }
    syncStatus(identity);
  }

  function syncStatus(identity) {
    const st = controller.getState(identity);
    if (!st) {
      onStatus?.({ status: "idle", dirty: false, failed: false, identity });
      return;
    }
    onStatus?.({
      status: st.status,
      dirty: !!st.dirty,
      failed: st.status === "save-failed",
      identity,
    });
  }

  return {
    controller,
    beginHydration: (identity) => {
      const gen = controller.beginHydration(identity);
      syncStatus(identity);
      return gen;
    },
    completeHydration: (identity, loadedPlan) => {
      const result = controller.completeHydration(identity, stripEphemeralPlanFields(loadedPlan));
      syncStatus(identity);
      return result;
    },
    failHydration: (identity, error) => {
      const result = controller.failHydration(identity, error);
      syncStatus(identity);
      return result;
    },
    observePlan: (identity, plan) => {
      controller.observePlan(identity, plan);
      syncStatus(identity);
    },
    retry: (identity) => {
      controller.retry(identity);
      syncStatus(identity);
    },
    resetForIdentity: (identity) => controller.resetForIdentity(identity),
    getState: (identity) => controller.getState(identity),
    dispose: () => controller.dispose(),
    stripEphemeralPlanFields,
  };
}
