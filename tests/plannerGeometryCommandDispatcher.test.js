/**
 * PHASE 1A-2A — UI orchestration boundary (src/planner/ui/geometryCommandDispatcher.js).
 *
 * Тестирует createGeometryCommandDispatcher как чистый orchestration helper,
 * без рендера React/PlanPage (нестабильный browser environment здесь не
 * нужен и не используется). Callbacks — простые spy-функции, plan — обычный
 * JS-объект, эквивалентный тому, что PlanPage хранит в HistoryModel.
 *
 * Import-order stability: тот же класс фрагильности, что и в
 * tests/plannerGeometryCommands.test.js (geometryCommandDispatcher.js →
 * geometryCommands.js → wallNetwork.js → wallGeometry.js, 15-файловый цикл,
 * см. PHASE 0G/1A-1 corrective reports) — применяется тот же проверенный фикс.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";

let createGeometryCommandDispatcher;
let GEOMETRY_COMMAND_FAILED;
let GEOMETRY_COMMAND_NO_TARGET;
let ROOM_DETECTION_FAILED;
let HistoryModel;

beforeAll(async () => {
  await import("../src/planner/wallGeometry.js"); // прогрев фрагильного export* первым

  const dispatcherMod = await import("../src/planner/ui/geometryCommandDispatcher.js");
  createGeometryCommandDispatcher = dispatcherMod.createGeometryCommandDispatcher;

  const cmdMod = await import("../src/planner/commands/geometryCommands.js");
  GEOMETRY_COMMAND_FAILED = cmdMod.GEOMETRY_COMMAND_FAILED;
  GEOMETRY_COMMAND_NO_TARGET = cmdMod.GEOMETRY_COMMAND_NO_TARGET;

  const roomsMod = await import("../src/planner/core/rooms/syncRooms.js");
  ROOM_DETECTION_FAILED = roomsMod.ROOM_DETECTION_FAILED;

  const historyMod = await import("../src/planner/core/history/historyModel.js");
  HistoryModel = historyMod.HistoryModel;
});

// ── fixtures ─────────────────────────────────────────────────────────────

function ids(prefix = "id") {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function rectPlan() {
  return {
    room: { w: 4000, h: 3000 },
    nodes: {
      n1: { x: 0, y: 0 }, n2: { x: 4000, y: 0 }, n3: { x: 4000, y: 3000 }, n4: { x: 0, y: 3000 },
    },
    walls: [
      { id: "w1", a: "n1", b: "n2", thk: 100 },
      { id: "w2", a: "n2", b: "n3", thk: 100 },
      { id: "w3", a: "n3", b: "n4", thk: 100 },
      { id: "w4", a: "n4", b: "n1", thk: 100 },
    ],
    items: [], dimensions: [], rooms: [], zones: [],
  };
}

function singleWallPlan(a = { x: 0, y: 0 }, b = { x: 6000, y: 0 }) {
  return {
    room: { w: 6000, h: 3000 },
    nodes: { na: a, nb: b },
    walls: [{ id: "w1", a: "na", b: "nb", thk: 150 }],
    items: [], dimensions: [], rooms: [], zones: [],
  };
}

const throwingRoomSyncFn = () => { throw new Error("controlled room-engine failure"); };

/** Собирает spy-based dispatcher + HistoryModel, воспроизводящие реальный PlanPage-паттерн. */
function makeHarness(initialPlan, extra = {}) {
  const history = new HistoryModel(initialPlan);
  const commitPlan = vi.fn((nextPlan) => history.setPlan(() => nextPlan));
  const setSelection = vi.fn();
  const setRuntimeDiagnostic = vi.fn();
  const showMessage = vi.fn();
  const dispatcher = createGeometryCommandDispatcher({
    getPlan: () => history.current,
    commitPlan,
    setSelection,
    setRuntimeDiagnostic,
    showMessage,
    makeId: ids(),
    ...extra,
  });
  return { history, dispatcher, commitPlan, setSelection, setRuntimeDiagnostic, showMessage };
}

// ── contract ─────────────────────────────────────────────────────────────

describe("PHASE 1A-2A — geometry command dispatcher contract", () => {
  it("rejected: commitPlan not called, no history checkpoint, error message shown", () => {
    const { dispatcher, history, commitPlan, showMessage } = makeHarness(rectPlan());
    const result = dispatcher({ type: "wall.straightenHorizontal", wallId: "does-not-exist" });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe(GEOMETRY_COMMAND_NO_TARGET);
    expect(commitPlan).not.toHaveBeenCalled();
    expect(history.past).toHaveLength(0);
    expect(showMessage).toHaveBeenCalledWith(result.error.message);
  });

  it("no-op: commitPlan not called, no history checkpoint, no message shown", () => {
    const plan = rectPlan(); // w1 is already horizontal
    const { dispatcher, history, commitPlan, showMessage } = makeHarness(plan);
    const result = dispatcher({ type: "wall.straightenHorizontal", wallId: "w1" });
    expect(result).toMatchObject({ ok: true, changed: false });
    expect(commitPlan).not.toHaveBeenCalled();
    expect(history.past).toHaveLength(0);
    expect(showMessage).not.toHaveBeenCalled();
  });

  it("success: commitPlan called exactly once, one history checkpoint", () => {
    const plan = singleWallPlan({ x: 0, y: 0 }, { x: 4000, y: 30 });
    const { dispatcher, history, commitPlan } = makeHarness(plan);
    const result = dispatcher({ type: "wall.straightenHorizontal", wallId: "w1" });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(commitPlan).toHaveBeenCalledTimes(1);
    expect(commitPlan).toHaveBeenCalledWith(result.plan);
    expect(history.past).toHaveLength(1);
    expect(history.undo()).toBe(plan);
  });

  it("selection policy: selectAfter is invoked with the result and its return value is committed", () => {
    const plan = singleWallPlan();
    const { dispatcher, setSelection } = makeHarness(plan);
    const result = dispatcher(
      { type: "wall.split", wallId: "w1", point: { x: 3000, y: 0 } },
      { selectAfter: (r) => ({ coll: "walls", id: r.operationResult.childWallIds[1] }) },
    );
    expect(setSelection).toHaveBeenCalledWith({ coll: "walls", id: result.operationResult.childWallIds[1] });
  });

  it("no-op does not invoke selectAfter", () => {
    const plan = rectPlan();
    const { dispatcher, setSelection } = makeHarness(plan);
    dispatcher({ type: "wall.straightenHorizontal", wallId: "w1" }, { selectAfter: () => ({ coll: "walls", id: "w1" }) });
    expect(setSelection).not.toHaveBeenCalled();
  });

  it("rejected does not invoke selectAfter", () => {
    const plan = rectPlan();
    const { dispatcher, setSelection } = makeHarness(plan);
    dispatcher({ type: "wall.straightenHorizontal", wallId: "missing" }, { selectAfter: () => ({ coll: "walls", id: "w1" }) });
    expect(setSelection).not.toHaveBeenCalled();
  });

  it("diagnostics: room sync failure sets the runtime diagnostic, geometry still committed", () => {
    const plan = singleWallPlan({ x: 0, y: 0 }, { x: 4000, y: 30 });
    const { dispatcher, commitPlan, setRuntimeDiagnostic } = makeHarness(plan, { roomSyncFn: throwingRoomSyncFn });
    const result = dispatcher({ type: "wall.straightenHorizontal", wallId: "w1" });
    expect(result.ok).toBe(true);
    expect(commitPlan).toHaveBeenCalledTimes(1);
    expect(setRuntimeDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ code: ROOM_DETECTION_FAILED }));
  });

  it("diagnostics: a following successful command clears the runtime diagnostic", () => {
    const plan = rectPlan();
    const { dispatcher, setRuntimeDiagnostic } = makeHarness(plan);
    dispatcher({ type: "node.move", wallId: "w1", nodeIdx: 0, point: { x: -100, y: -100 } });
    setRuntimeDiagnostic.mockClear();
    dispatcher({ type: "node.move", wallId: "w1", nodeIdx: 1, point: { x: 4100, y: -50 } });
    expect(setRuntimeDiagnostic).toHaveBeenCalledWith(null);
  });

  it("warnings: multiple warnings are combined into a single showMessage call", () => {
    const plan = singleWallPlan();
    plan.dimensions = [{ id: "d1", p1: { x: 1200, y: 0 }, p2: { x: 4800, y: 0 }, attachedTo: { type: "wall", wallId: "w1", t0: 0.2, t1: 0.8 } }];
    const { dispatcher, showMessage } = makeHarness(plan);
    const result = dispatcher(
      { type: "wall.split", wallId: "w1", point: { x: 3000, y: 0 } },
      { warningMessage: () => "Стена разделена. Часть размеров была откреплена." },
    );
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(showMessage).toHaveBeenCalledTimes(1);
  });

  it("error: SPLIT_INTERSECTS_OPENING message is surfaced via showMessage, no commitPlan", () => {
    const plan = singleWallPlan();
    plan.items = [{ id: "d1", kind: "door", x: 2700, y: -50, w: 900, h: 100, wallId: "w1" }];
    const { dispatcher, commitPlan, showMessage } = makeHarness(plan);
    const result = dispatcher({ type: "wall.split", wallId: "w1", point: { x: 3000, y: 0 } });
    expect(result.ok).toBe(false);
    expect(commitPlan).not.toHaveBeenCalled();
    expect(showMessage).toHaveBeenCalledWith(result.error.message);
  });

  it("no duplicate room sync: roomSyncFn is invoked exactly once per command", () => {
    const plan = rectPlan();
    const roomSyncFn = vi.fn((p) => ({ rooms: p.rooms || [], zones: p.zones || [], validationWarnings: [] }));
    const { dispatcher } = makeHarness(plan, { roomSyncFn });
    dispatcher({ type: "node.move", wallId: "w1", nodeIdx: 0, point: { x: -50, y: -50 } });
    expect(roomSyncFn).toHaveBeenCalledTimes(1);
  });

  it("stale-plan safety: getPlan is re-read on every call, reflecting prior commits", () => {
    const plan = rectPlan();
    const history = new HistoryModel(plan);
    const dispatcher = createGeometryCommandDispatcher({
      getPlan: () => history.current,
      commitPlan: (next) => history.setPlan(() => next),
      setSelection: vi.fn(),
      setRuntimeDiagnostic: vi.fn(),
      showMessage: vi.fn(),
      makeId: ids(),
    });
    const first = dispatcher({ type: "node.move", wallId: "w1", nodeIdx: 0, point: { x: -50, y: -50 } });
    expect(first.ok && first.changed).toBe(true);
    // Второй вызов ДОЛЖЕН видеть результат первого (через history.current), а
    // не значение plan, захваченное в замыкании при создании dispatcher.
    const second = dispatcher({ type: "node.move", wallId: "w1", nodeIdx: 1, point: { x: 4050, y: -50 } });
    expect(second.ok && second.changed).toBe(true);
    expect(second.plan.nodes.n1).toEqual({ x: -50, y: -50 }); // сохранился результат ПЕРВОГО вызова
    expect(second.plan.nodes.n2).toEqual({ x: 4050, y: -50 });
  });

  it("two rapid successful commands: both commits survive with correct history order", () => {
    const plan = rectPlan();
    const history = new HistoryModel(plan);
    const dispatcher = createGeometryCommandDispatcher({
      getPlan: () => history.current, // production-like live getter
      commitPlan: (next) => history.setPlan(() => next),
      setSelection: vi.fn(),
      setRuntimeDiagnostic: vi.fn(),
      showMessage: vi.fn(),
      makeId: ids(),
    });
    const first = dispatcher({ type: "node.move", wallId: "w1", nodeIdx: 0, point: { x: -50, y: -50 } });
    const second = dispatcher({ type: "node.move", wallId: "w1", nodeIdx: 0, point: { x: -100, y: -100 } });
    expect(first.ok && first.changed).toBe(true);
    expect(second.ok && second.changed).toBe(true);
    expect(history.current.nodes.n1).toEqual({ x: -100, y: -100 });
    expect(history.past).toHaveLength(2);
    // Undo/redo round-trip preserves both commands in order.
    const afterFirstUndo = history.undo();
    expect(afterFirstUndo.nodes.n1).toEqual({ x: -50, y: -50 }); // second command undone
    expect(afterFirstUndo).toBe(first.plan);
    const originalAfterSecondUndo = history.undo();
    expect(originalAfterSecondUndo).toEqual(plan);
    expect(history.redo()).toBe(first.plan);
    expect(history.redo()).toBe(second.plan);
  });

  it("regression: stale render-captured plan getter loses the first rapid command", () => {
    // Этот тест документирует старый баг PlanPage: getPlan замкнут на
    // переменную текущего рендера, а commitPlan обновляет HistoryModel, но НЕ
    // эту переменную до следующего React render. С relative-командой (nudge)
    // это видно: вторая команда применяется к исходному плану и не видит
    // смещение первой.
    const plan = rectPlan();
    const history = new HistoryModel(plan);
    const capturedPlan = history.current; // simulate React render capture
    const dispatcher = createGeometryCommandDispatcher({
      getPlan: () => capturedPlan, // OLD bug pattern
      // Simulate commit that updates HistoryModel but does NOT refresh the
      // captured render variable (as in real React before next render).
      commitPlan: (next) => history.setPlan(() => next),
      setSelection: vi.fn(),
      setRuntimeDiagnostic: vi.fn(),
      showMessage: vi.fn(),
      makeId: ids(),
    });
    const first = dispatcher({ type: "node.nudge", wallId: "w1", nodeIdx: 0, dx: 10, dy: 0 });
    // No React re-render happened: capturedPlan is still the original plan.
    const second = dispatcher({ type: "node.nudge", wallId: "w1", nodeIdx: 0, dx: 20, dy: 0 });
    expect(first.ok && first.changed).toBe(true);
    expect(second.ok && second.changed).toBe(true);
    // With the stale getter the second command ran against the original plan,
    // so the first nudge (+10) is lost: final x is 20, not 30.
    expect(history.current.nodes.n1).toEqual({ x: 20, y: 0 });
    expect(history.current.nodes.n1).not.toEqual({ x: 30, y: 0 });
    // HistoryModel still records both commits, but the second branch was based
    // on stale state, so undo exposes the correctly-committed first command.
    expect(history.past).toHaveLength(2);
    const afterFirstUndo = history.undo();
    expect(afterFirstUndo.nodes.n1).toEqual({ x: 10, y: 0 });
  });

  it("success followed by rejection keeps the first commit and only one checkpoint", () => {
    const plan = rectPlan();
    const history = new HistoryModel(plan);
    const dispatcher = createGeometryCommandDispatcher({
      getPlan: () => history.current,
      commitPlan: (next) => history.setPlan(() => next),
      setSelection: vi.fn(),
      setRuntimeDiagnostic: vi.fn(),
      showMessage: vi.fn(),
      makeId: ids(),
    });
    const first = dispatcher({ type: "node.move", wallId: "w1", nodeIdx: 0, point: { x: -50, y: -50 } });
    expect(first.ok && first.changed).toBe(true);
    const second = dispatcher({ type: "wall.straightenHorizontal", wallId: "missing" });
    expect(second.ok).toBe(false);
    expect(history.past).toHaveLength(1);
    expect(history.current.nodes.n1).toEqual({ x: -50, y: -50 });
  });

  it("success followed by no-op keeps the first commit and only one checkpoint", () => {
    const plan = rectPlan();
    const history = new HistoryModel(plan);
    const dispatcher = createGeometryCommandDispatcher({
      getPlan: () => history.current,
      commitPlan: (next) => history.setPlan(() => next),
      setSelection: vi.fn(),
      setRuntimeDiagnostic: vi.fn(),
      showMessage: vi.fn(),
      makeId: ids(),
    });
    const first = dispatcher({ type: "node.move", wallId: "w1", nodeIdx: 0, point: { x: -50, y: -50 } });
    expect(first.ok && first.changed).toBe(true);
    const second = dispatcher({ type: "node.move", wallId: "w1", nodeIdx: 0, point: { x: -50, y: -50 } }); // already there
    expect(second.ok).toBe(true);
    expect(second.changed).toBe(false);
    expect(history.past).toHaveLength(1);
    expect(history.current.nodes.n1).toEqual({ x: -50, y: -50 });
  });

  it("commitPlan exception: no side-effects, structured failure, plan not committed", () => {
    const plan = singleWallPlan({ x: 0, y: 0 }, { x: 4000, y: 30 });
    const history = new HistoryModel(plan);
    const commitPlan = vi.fn(() => { throw new Error("controlled commit failure"); });
    const setSelection = vi.fn();
    const setRuntimeDiagnostic = vi.fn();
    const showMessage = vi.fn();
    const dispatcher = createGeometryCommandDispatcher({
      getPlan: () => history.current,
      commitPlan,
      setSelection,
      setRuntimeDiagnostic,
      showMessage,
      makeId: ids(),
    });
    const result = dispatcher({ type: "wall.straightenHorizontal", wallId: "w1" });
    expect(result.ok).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.error.code).toBe("GEOMETRY_COMMAND_COMMIT_FAILED");
    expect(history.past).toHaveLength(0);
    expect(history.current).toBe(plan);
    expect(setSelection).not.toHaveBeenCalled();
    expect(setRuntimeDiagnostic).not.toHaveBeenCalled();
    expect(showMessage).toHaveBeenCalledWith("Не удалось зафиксировать изменение плана.");
  });

  it("a throwing selectAfter callback does not undo or corrupt the already-committed plan", () => {
    const plan = singleWallPlan({ x: 0, y: 0 }, { x: 4000, y: 30 });
    const { dispatcher, history, commitPlan } = makeHarness(plan);
    const result = dispatcher(
      { type: "wall.straightenHorizontal", wallId: "w1" },
      { selectAfter: () => { throw new Error("boom in selectAfter"); } },
    );
    expect(result.ok && result.changed).toBe(true);
    expect(commitPlan).toHaveBeenCalledTimes(1);
    expect(history.current).toBe(result.plan); // commit уже применился, несмотря на исключение
    expect(history.past).toHaveLength(1);
  });

  it("a throwing showMessage on the warning path does not affect the already-committed plan", () => {
    const plan = singleWallPlan();
    plan.dimensions = [{ id: "d1", p1: { x: 1200, y: 0 }, p2: { x: 4800, y: 0 }, attachedTo: { type: "wall", wallId: "w1", t0: 0.2, t1: 0.8 } }];
    const history = new HistoryModel(plan);
    let calls = 0;
    const dispatcher = createGeometryCommandDispatcher({
      getPlan: () => history.current,
      commitPlan: (next) => history.setPlan(() => next),
      setSelection: vi.fn(),
      setRuntimeDiagnostic: vi.fn(),
      showMessage: () => { calls += 1; throw new Error("boom in showMessage"); },
      makeId: ids(),
    });
    const result = dispatcher(
      { type: "wall.split", wallId: "w1", point: { x: 3000, y: 0 } },
      { warningMessage: () => "..." },
    );
    expect(result.ok && result.changed).toBe(true);
    expect(history.current).toBe(result.plan);
    expect(calls).toBe(1);
  });
});

// ── selection policy per action (section 6) ───────────────────────────────

describe("PHASE 1A-2A — selection policy", () => {
  it("wall.split selects the new child wall (matches PHASE 0F newWallId semantics)", () => {
    const plan = singleWallPlan();
    const { dispatcher, setSelection } = makeHarness(plan);
    const result = dispatcher(
      { type: "wall.split", wallId: "w1", point: { x: 3000, y: 0 } },
      { selectAfter: (r) => ({ coll: "walls", id: r.operationResult.childWallIds[1] }) },
    );
    const newWallId = result.operationResult.childWallIds[1];
    expect(newWallId).not.toBe("w1");
    expect(setSelection).toHaveBeenCalledWith({ coll: "walls", id: newWallId });
  });

  it("wall.merge selects the surviving wall via entityRemap, not by guessing array order", () => {
    const plan = {
      room: { w: 6000, h: 3000 },
      nodes: { n1: { x: 0, y: 0 }, n2: { x: 3000, y: 0 }, n3: { x: 6000, y: 0 } },
      walls: [{ id: "w1", a: "n1", b: "n2", thk: 100 }, { id: "w2", a: "n2", b: "n3", thk: 100 }],
      items: [], dimensions: [], rooms: [], zones: [],
    };
    const { dispatcher, setSelection } = makeHarness(plan);
    const result = dispatcher(
      { type: "wall.merge", wallId: "w1" },
      { selectAfter: (r) => ({ coll: "walls", id: r.entityRemap.walls.survivingWallId }) },
    );
    expect(result.ok).toBe(true);
    expect(setSelection).toHaveBeenCalledWith({ coll: "walls", id: "w1" });
  });

  it("straighten/align: selection is left unchanged by the caller policy (no selectAfter passed -> setSelection not called)", () => {
    const plan = singleWallPlan({ x: 0, y: 0 }, { x: 4000, y: 30 });
    const { dispatcher, setSelection } = makeHarness(plan);
    dispatcher({ type: "wall.straightenHorizontal", wallId: "w1" }); // no selectAfter option
    expect(setSelection).not.toHaveBeenCalled();
  });
});

// ── phantom history fix — integration proof (section 8) ──────────────────
// Реальный dispatcher pattern (не прямой executeGeometryCommand) — именно
// тот путь, которым теперь пользуется PlanPage.jsx. Подтверждает, что
// исправление PHASE 1A-1 (audit-подтверждённый phantom checkpoint у старых
// wall-align/wall-merge веток PlanPage) реально устранено на уровне UI
// orchestration, а не только внутри executeGeometryCommand.

describe("PHASE 1A-2A — phantom history fix (dispatcher integration)", () => {
  it("align rejected: no commitPlan, no checkpoint, canUndo unchanged, selection unchanged", () => {
    const plan = singleWallPlan(); // no neighbor to align to
    const { history, dispatcher, commitPlan, setSelection } = makeHarness(plan);
    const beforeCanUndo = history.canUndo;
    const result = dispatcher({ type: "wall.alignToNeighbor", wallId: "w1" }, {});
    expect(result.ok === false || result.changed === false).toBe(true);
    expect(commitPlan).not.toHaveBeenCalled();
    expect(history.past).toHaveLength(0);
    expect(history.canUndo).toBe(beforeCanUndo);
    expect(setSelection).not.toHaveBeenCalled();
  });

  it("merge rejected: no commitPlan, no checkpoint, canUndo unchanged, selection unchanged", () => {
    const plan = singleWallPlan(); // no neighbor to merge with
    const { history, dispatcher, commitPlan, setSelection } = makeHarness(plan);
    const beforeCanUndo = history.canUndo;
    const result = dispatcher(
      { type: "wall.merge", wallId: "w1" },
      { selectAfter: (r) => ({ coll: "walls", id: r.entityRemap.walls.survivingWallId }) },
    );
    expect(result.ok === false || result.changed === false).toBe(true);
    expect(commitPlan).not.toHaveBeenCalled();
    expect(history.past).toHaveLength(0);
    expect(history.canUndo).toBe(beforeCanUndo);
    expect(setSelection).not.toHaveBeenCalled();
  });

  it("already-straight wall: no-op, history gets no new entry", () => {
    const plan = rectPlan(); // w1 is already horizontal
    const { history, dispatcher, commitPlan } = makeHarness(plan);
    const result = dispatcher({ type: "wall.straightenHorizontal", wallId: "w1" });
    expect(result).toMatchObject({ ok: true, changed: false });
    expect(commitPlan).not.toHaveBeenCalled();
    expect(history.past).toHaveLength(0);
  });

  it("successful merge: exactly one checkpoint, undo/redo round-trip, selection on surviving wall", () => {
    const plan = {
      room: { w: 6000, h: 3000 },
      nodes: { n1: { x: 0, y: 0 }, n2: { x: 3000, y: 0 }, n3: { x: 6000, y: 0 } },
      walls: [{ id: "w1", a: "n1", b: "n2", thk: 100 }, { id: "w2", a: "n2", b: "n3", thk: 100 }],
      items: [], dimensions: [], rooms: [], zones: [],
    };
    const { history, dispatcher, setSelection } = makeHarness(plan);
    const result = dispatcher(
      { type: "wall.merge", wallId: "w1" },
      { selectAfter: (r) => ({ coll: "walls", id: r.entityRemap.walls.survivingWallId }) },
    );
    expect(result.ok && result.changed).toBe(true);
    expect(history.past).toHaveLength(1);
    expect(history.undo()).toBe(plan);
    expect(history.redo()).toBe(result.plan);
    expect(setSelection).toHaveBeenCalledWith({ coll: "walls", id: "w1" });
  });

  it("successful split: exactly one checkpoint, opening/dimension migration preserved, selection on the new wall", () => {
    const plan = singleWallPlan();
    plan.items = [{ id: "d1", kind: "door", x: 5000, y: -50, w: 900, h: 100, wallId: "w1" }];
    plan.dimensions = [{ id: "dm1", p1: { x: 600, y: 0 }, p2: { x: 1200, y: 0 }, attachedTo: { type: "wall", wallId: "w1", t0: 0.1, t1: 0.2 } }];
    const { history, dispatcher, setSelection } = makeHarness(plan);
    const result = dispatcher(
      { type: "wall.split", wallId: "w1", point: { x: 3000, y: 0 } },
      { selectAfter: (r) => ({ coll: "walls", id: r.operationResult.childWallIds[1] }) },
    );
    expect(result.ok && result.changed).toBe(true);
    expect(history.past).toHaveLength(1);
    expect(history.undo()).toBe(plan);
    expect(history.redo()).toBe(result.plan);

    const newWallId = result.operationResult.childWallIds[1];
    expect(setSelection).toHaveBeenCalledWith({ coll: "walls", id: newWallId });
    // Opening migrated onto the new (far) wall; dimension reattached (t0/t1 unaffected here since it's on the near half).
    const door = result.plan.items.find((it) => it.id === "d1");
    expect(door.wallId).toBe(newWallId);
    const dim = result.plan.dimensions.find((d) => d.id === "dm1");
    expect(dim.attachedTo).not.toBeNull();
  });
});
