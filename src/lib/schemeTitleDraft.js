/**
 * Commit rules shared by SchemeTitleInput / FloorPlanField title editing.
 * Local draft only until commit; empty draft reverts; unchanged skips save.
 */
export function resolveSchemeTitleCommit(draft, savedValue) {
  const saved = String(savedValue ?? "");
  const next = String(draft ?? "").trim();
  if (!next) {
    return { shouldSave: false, value: saved, display: saved };
  }
  if (next === saved) {
    return { shouldSave: false, value: next, display: next };
  }
  return { shouldSave: true, value: next, display: next };
}

/** Sync draft from props when not actively editing (project switch / external rename). */
export function nextTitleDraftFromProps({ editing, incomingValue, currentDraft }) {
  if (editing) return currentDraft;
  return String(incomingValue ?? "");
}

/**
 * Monotonic save gate: after overlapping async saves, only the latest commit is "current".
 * Callers can ignore stale completions when `isLatest` is false.
 */
export function createTitleSaveGate() {
  let seq = 0;
  return {
    begin() {
      seq += 1;
      return seq;
    },
    isLatest(token) {
      return token === seq;
    },
    get seq() {
      return seq;
    },
  };
}
