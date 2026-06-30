import { useCallback, useRef, useState } from "react";
import { HistoryModel } from "./core/history/historyModel.js";

export function usePlanHistory(initialPlan) {
  const stackRef = useRef(null);
  if (!stackRef.current) {
    const seed = typeof initialPlan === "function" ? initialPlan() : initialPlan;
    stackRef.current = new HistoryModel(seed);
  }

  const [, tick] = useState(0);
  const bump = () => tick((n) => n + 1);

  const setPlan = useCallback((updater) => {
    stackRef.current.setPlan(updater);
    bump();
  }, []);

  const replacePlan = useCallback((updater) => {
    stackRef.current.replace(updater);
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
    commitPlan,
    commitFrom,
    undo,
    redo,
    canUndo: stack.canUndo,
    canRedo: stack.canRedo,
    resetHistory,
  };
}
