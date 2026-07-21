/**
 * Commit rules for FloorPlanField title editing.
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
 * Serialized title-save queue keyed by identity.
 * Each job captures its project-bound commit callback at enqueue time.
 * Jobs for different identities never share callbacks or mutate each other's UI state.
 */
export function createFloorPlanTitleQueue() {
  /** @type {Array<{identityKey:string, projectId:string, value:string, commit:Function, onError?:Function, started?:boolean}>} */
  const queue = [];
  let flushing = false;

  const takeNext = () => {
    while (queue.length) {
      const job = queue.shift();
      // Coalesce: drop superseded pending jobs for the same identity that haven't started.
      while (
        queue.length &&
        queue[0].identityKey === job.identityKey &&
        !queue[0].started
      ) {
        const newer = queue.shift();
        job.value = newer.value;
        job.commit = newer.commit;
        job.onError = newer.onError;
        job.projectId = newer.projectId;
      }
      return job;
    }
    return null;
  };

  const flush = async () => {
    if (flushing) return;
    flushing = true;
    try {
      let job;
      while ((job = takeNext())) {
        job.started = true;
        try {
          await Promise.resolve(job.commit(job.value));
          job.onSuccess?.(job);
        } catch (error) {
          try {
            job.onError?.(error, job);
          } catch {
            // error handler must not break the queue
          }
        }
      }
    } finally {
      flushing = false;
      if (queue.length) await flush();
    }
  };

  return {
    /**
     * Enqueue a commit job. Captured `commit` must target the job's project.
     * Pending (not started) jobs for the same identityKey are replaced by the latest value.
     */
    enqueue(job) {
      if (!job || typeof job.commit !== "function") return;
      const identityKey = String(job.identityKey || "");
      // Replace unstarted pending jobs for this identity.
      for (let i = queue.length - 1; i >= 0; i -= 1) {
        if (queue[i].identityKey === identityKey && !queue[i].started) {
          queue.splice(i, 1);
        }
      }
      queue.push({
        identityKey,
        projectId: String(job.projectId || ""),
        value: String(job.value ?? ""),
        commit: job.commit,
        onError: job.onError,
        onSuccess: job.onSuccess,
        started: false,
      });
      // Defer flush so Enter+blur in the same turn coalesce to one job.
      queueMicrotask(() => {
        void flush();
      });
    },
    /** Test/inspection helper */
    pending() {
      return queue.map((j) => ({
        identityKey: j.identityKey,
        projectId: j.projectId,
        value: j.value,
        started: !!j.started,
      }));
    },
    get flushing() {
      return flushing;
    },
  };
}
