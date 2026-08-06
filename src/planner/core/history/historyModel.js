/** Undo/redo stack для планировщика (без React). */

const MAX_HISTORY = 60;

/**
 * PHASE 2E.1 (A) — where a mutation came from, declared by the CALL SITE.
 *
 * This replaces the old `skipNext` boolean. That flag was armed by reset(),
 * commitFrom(), undo() and redo() so that "the derived-state sync which follows"
 * would not become its own undo step — but every derived sync in PlanPage goes
 * through replace(), which never consumed the flag. The arming was therefore
 * always dangling, and the next call into mutate() — invariably a REAL user
 * command — silently lost its checkpoint. That is exactly the reported
 * "load a plan, press an arrow once, Ctrl+Z does nothing".
 *
 * There is now NO retained suppression state at all: suppression is an argument
 * of a single call and cannot outlive it, so a hydration can never swallow an
 * unrelated later user edit.
 *
 * USER is the default on purpose: a call site that declares nothing is treated
 * as a user command, whose worst case is one extra undo step — never a lost one.
 */
const MUTATION_ORIGIN = {
  /** A real user command. Checkpointed (unless it changed nothing). */
  USER: "user-command",
  /** Deterministic reconciliation of derived state (rooms, zones, warnings). */
  DERIVED_SYNC: "derived-sync",
  /** Loading/normalising a stored plan. */
  HYDRATION: "hydration",
};

/** Only a user command may create an undo entry. */
const recordsHistory = (origin) => origin === MUTATION_ORIGIN.USER;

export class HistoryModel {
  constructor(initialState) {
    this.current = initialState;
    this.past = [];
    this.future = [];
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  /** Сохранить снимок перед мутацией (commit). */
  checkpoint(state = this.current) {
    this.past.push(state);
    if (this.past.length > MAX_HISTORY) this.past.shift();
    this.future = [];
  }

  /** Применить updater без записи в историю. */
  #apply(updater) {
    const before = this.current;
    this.current = typeof updater === "function" ? updater(before) : updater;
    return before;
  }

  /**
   * @param {Function|object} updater
   * @param {{origin?: string}} [options] — see MUTATION_ORIGIN; defaults to USER.
   */
  mutate(updater, { origin = MUTATION_ORIGIN.USER } = {}) {
    const before = this.current;
    const next = typeof updater === "function" ? updater(before) : updater;
    // No-op updates must not become undo steps. Derived-state syncs return the
    // same object when nothing changed ("if (same) return p"), and checkpointing
    // those buried each real edit under duplicates, so undo appeared to do nothing.
    if (recordsHistory(origin) && next !== before) this.checkpoint(before);
    this.current = next;
    return this.current;
  }

  /** Обновление без записи в историю (для drag-preview и derived-sync). */
  replace(updater) {
    this.#apply(updater);
    return this.current;
  }

  /** @deprecated alias for mutate */
  setPlan(updater, options) {
    return this.mutate(updater, options);
  }

  /**
   * Мутация с явным checkpoint (завершение стены, move, resize).
   *
   * Identity no-ops (`commitPlan((p) => p)`) must NOT push a phantom past
   * entry: doing so after a real edit makes the next Ctrl+Z restore the
   * already-current state (undo appears broken). Real changes still get
   * exactly one checkpoint, independent of any load-path derived sync.
   */
  commit(updater) {
    const before = this.current;
    const next = typeof updater === "function" ? updater(before) : updater;
    if (next !== before) {
      this.checkpoint(before);
      this.current = next;
    }
    return this.current;
  }

  /** Единый commit с явной базовой и конечной версией. */
  commitFrom(previousState, nextState) {
    this.past.push(previousState);
    if (this.past.length > MAX_HISTORY) this.past.shift();
    this.future = [];
    this.current = nextState;
    return this.current;
  }

  undo() {
    if (!this.past.length) return this.current;
    const prev = this.past.pop();
    this.future.push(this.current);
    this.current = prev;
    return this.current;
  }

  redo() {
    if (!this.future.length) return this.current;
    const next = this.future.pop();
    this.past.push(this.current);
    this.current = next;
    return this.current;
  }

  reset(nextState) {
    this.past = [];
    this.future = [];
    this.current = nextState;
    return this.current;
  }
}

export { MAX_HISTORY, MUTATION_ORIGIN };
export { HistoryModel as PlanHistoryStack };
