import { useCallback, useEffect, useRef, useState } from "react";

/** Локальный черновик + отложенный commit в родителя (без запроса на каждый символ). */
export function useDebouncedSync(value, onCommit, delay = 450) {
  const [draft, setDraft] = useState(value);
  const timer = useRef(null);
  const latestCommit = useRef(onCommit);
  latestCommit.current = onCommit;

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const setDraftDebounced = useCallback(
    (next) => {
      setDraft(next);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        latestCommit.current(next);
      }, delay);
    },
    [delay]
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return [draft, setDraftDebounced];
}
