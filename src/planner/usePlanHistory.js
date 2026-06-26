import { useCallback, useRef, useState } from "react";

const MAX_HISTORY = 60;

export function usePlanHistory(initialPlan) {
  const [plan, setPlanInner] = useState(initialPlan);
  const pastRef = useRef([]);
  const futureRef = useRef([]);
  const skipRef = useRef(false);

  const setPlan = useCallback((updater) => {
    setPlanInner((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (!skipRef.current && next !== prev) {
        pastRef.current.push(prev);
        if (pastRef.current.length > MAX_HISTORY) pastRef.current.shift();
        futureRef.current = [];
      }
      skipRef.current = false;
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    const past = pastRef.current;
    if (!past.length) return;
    setPlanInner((cur) => {
      const prev = past[past.length - 1];
      pastRef.current = past.slice(0, -1);
      futureRef.current.push(cur);
      skipRef.current = true;
      return prev;
    });
  }, []);

  const redo = useCallback(() => {
    const future = futureRef.current;
    if (!future.length) return;
    setPlanInner((cur) => {
      const next = future[future.length - 1];
      futureRef.current = future.slice(0, -1);
      pastRef.current.push(cur);
      skipRef.current = true;
      return next;
    });
  }, []);

  const resetHistory = useCallback((nextPlan) => {
    pastRef.current = [];
    futureRef.current = [];
    skipRef.current = true;
    setPlanInner(nextPlan);
  }, []);

  return {
    plan,
    setPlan,
    undo,
    redo,
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
    resetHistory,
  };
}
