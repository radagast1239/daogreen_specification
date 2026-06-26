import React, { useCallback } from "react";
import { useDebouncedSync } from "../../lib/useDebouncedSync.js";

export function DebouncedInput({ value, onCommit, delay = 450, type, ...props }) {
  const commit = useCallback(
    (raw) => {
      if (type === "number") {
        onCommit(raw === "" || raw == null ? null : Number(raw));
      } else {
        onCommit(raw);
      }
    },
    [onCommit, type]
  );
  const [draft, setDraft] = useDebouncedSync(value ?? "", commit, delay);

  return (
    <input
      {...props}
      type={type}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit(draft)}
    />
  );
}
