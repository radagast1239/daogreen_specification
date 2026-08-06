import { useCallback, useRef, useState } from "react";
import { HistoryModel, MUTATION_ORIGIN } from "./core/history/historyModel.js";

/**
 * PHASE 2E.1 (A) — mutation origin is declared here, per call, and nowhere
 * retained. `setPlan` is the user-command path and always checkpoints a real
 * change; `syncDerivedPlan`/`replacePlan` are the derived-sync path and never
 * do. Nothing a load leaves behind can therefore reach a later user edit.
 */
export function usePlanHistory(initialPlan) {
  const stackRef = useRef(null);
  if (!stackRef.current) {
    const seed = typeof initialPlan === "function" ? initialPlan() : initialPlan;
    stackRef.current = new HistoryModel(seed);
  }

  const [, tick] = useState(0);
  const bump = () => tick((n) => n + 1);

  const setPlan = useCallback((updater) => {
    stackRef.current.mutate(updater, { origin: MUTATION_ORIGIN.USER });
    bump();
  }, []);

  const replacePlan = useCallback((updater) => {
    stackRef.current.replace(updater);
    bump();
  }, []);

  /** Named derived-state path: deterministic reconciliation, never an undo step. */
  const syncDerivedPlan = useCallback((updater) => {
    stackRef.current.mutate(updater, { origin: MUTATION_ORIGIN.DERIVED_SYNC });
    bump();
  }, []);

  const commitPlan = useCallback((updater) => {
    stackRef.current.commit(updater);
    bump();
  }, []);

  const commitFrom = useCallback((previousState, nextState) => {
    stackRef.current.commitFrom(previousState, nextState);
    bump();
  }, []);

  const undo = useCallback(() => {
    stackRef.current.undo();
    bump();
  }, []);

  const redo = useCallback(() => {
    stackRef.current.redo();
    bump();
  }, []);

  const resetHistory = useCallback((nextPlan) => {
    stackRef.current.reset(nextPlan);
    bump();
  }, []);

  const stack = stackRef.current;

  return {
    plan: stack.current,
    setPlan,
    replacePlan,
    syncDerivedPlan,
    commitPlan,
    commitFrom,
    undo,
    redo,
    canUndo: stack.canUndo,
    canRedo: stack.canRedo,
    // Read-only depths — the acceptance run has to count history steps, not just
    // ask whether Undo is enabled.
    undoDepth: stack.past.length,
    redoDepth: stack.future.length,
    resetHistory,
  };
}
