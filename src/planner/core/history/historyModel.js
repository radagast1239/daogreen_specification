/** Undo/redo stack для планировщика (без React). */

const MAX_HISTORY = 60;

export class HistoryModel {
  constructor(initialState) {
    this.current = initialState;
    this.past = [];
    this.future = [];
    this.skipNext = false;
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  /** Сохранить снимок перед мутацией (commit). */
  checkpoint() {
    this.past.push(this.current);
    if (this.past.length > MAX_HISTORY) this.past.shift();
    this.future = [];
  }

  mutate(updater) {
    if (!this.skipNext) this.checkpoint();
    this.skipNext = false;
    this.current = typeof updater === "function" ? updater(this.current) : updater;
    return this.current;
  }

  /** Обновление без записи в историю (для drag-preview). */
  replace(updater) {
    this.skipNext = true;
    this.current = typeof updater === "function" ? updater(this.current) : updater;
    return this.current;
  }

  /** @deprecated alias for mutate */
  setPlan(updater) {
    return this.mutate(updater);
  }

  /** Мутация с явным checkpoint (завершение стены, move, resize). */
  commit(updater) {
    this.checkpoint();
    this.skipNext = true;
    return this.mutate(updater);
  }

  /** Единый commit с явной базовой и конечной версией. */
  commitFrom(previousState, nextState) {
    this.past.push(previousState);
    if (this.past.length > MAX_HISTORY) this.past.shift();
    this.future = [];
    this.skipNext = true;
    this.current = nextState;
    return this.current;
  }

  undo() {
    if (!this.past.length) return this.current;
    const prev = this.past.pop();
    this.future.push(this.current);
    this.skipNext = true;
    this.current = prev;
    return this.current;
  }

  redo() {
    if (!this.future.length) return this.current;
    const next = this.future.pop();
    this.past.push(this.current);
    this.skipNext = true;
    this.current = next;
    return this.current;
  }

  reset(nextState) {
    this.past = [];
    this.future = [];
    this.skipNext = true;
    this.current = nextState;
    return this.current;
  }
}

export { MAX_HISTORY };
export { HistoryModel as PlanHistoryStack };
