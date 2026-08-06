export { HistoryModel, PlanHistoryStack, MAX_HISTORY, MUTATION_ORIGIN } from "./historyModel.js";
export { createAutosaveController, canonicalPlanStringify, defaultFingerprint } from "./autosaveGuard.js";
export {
  createPlanAutosaveBridge,
  stripEphemeralPlanFields,
  planAutosaveFingerprint,
  identityKey as planAutosaveIdentityKey,
} from "./planAutosaveBridge.js";
