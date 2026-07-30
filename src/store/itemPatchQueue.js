/**
 * Serialize writes for one project item. Inputs emit a PATCH for every change;
 * without ordering, a delayed older PATCH can overwrite a newer qty in SQLite.
 */
export function createItemPatchQueue({ send, onOptimistic, onSettled, onLatestError } = {}) {
  const entries = new Map();

  return function enqueue(key, patch) {
    const entry = entries.get(key) || { revision: 0, tail: Promise.resolve(), lastConfirmed: null };
    entries.set(key, entry);

    const revision = ++entry.revision;
    onOptimistic?.(patch, revision);

    const task = entry.tail
      .catch(() => undefined)
      .then(async () => {
        try {
          const item = await send(patch);
          entry.lastConfirmed = item;
          if (entry.revision === revision) onSettled?.(item, patch, revision);
          return item;
        } catch (error) {
          if (entry.revision === revision) onLatestError?.(error, patch, revision, entry.lastConfirmed);
          throw error;
        }
      });

    entry.tail = task.catch(() => undefined);
    return task;
  };
}
