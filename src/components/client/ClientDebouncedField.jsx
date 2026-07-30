import React, { useCallback } from "react";
import { useDebouncedSync } from "../../lib/useDebouncedSync.js";

function normalizeNumberCommit(raw) {
  if (raw === "" || raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function sameCommittedValue(type, draft, value) {
  if (type === "number") {
    return Object.is(normalizeNumberCommit(draft), normalizeNumberCommit(value));
  }
  return String(draft ?? "") === String(value ?? "");
}

export function DebouncedInput({ value, onCommit, delay = 450, type, ...props }) {
  const commit = useCallback(
    (raw) => {
      if (type === "number") {
        onCommit(normalizeNumberCommit(raw));
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
      onBlur={() => {
        // Skip no-op blur (e.g. wheel-induced blur with unchanged value).
        if (sameCommittedValue(type, draft, value)) return;
        commit(draft);
      }}
    />
  );
}
