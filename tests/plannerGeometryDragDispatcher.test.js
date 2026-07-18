/**
 * PHASE 1A-2B1 — node drag / wall-segment drag / keyboard nudge через
 * geometry command boundary.
 *
 * Воспроизводит production-паттерн PlanPage.jsx (см. RESULT — PHASE 1A-2B1,
 * "Base-plan restore strategy"), без React render:
 *   preview  — history-free `HistoryModel.replace()` + реальный low-level
 *              мутатор (applyNetworkNodeAtWall/applyNetworkWallSegMove),
 *              абсолютный target на каждый кадр (как в onMove);
 *   final    — restore basePlan (`replace`, без checkpoint) →
 *              runGeometryCommand(finalTarget) через реальный
 *              createGeometryCommandDispatcher + executeGeometryCommand
 *              (как в onUp).
 *
 * Import-order fragility: тот же класс, что и в остальных тестах command
 * layer (wallGeometry.js → core/walls/index.js re-export chain, 15-файловый
 * цикл) — прогреваем wallGeometry.js первым в beforeAll.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";

let createGeometryCommandDispatcher;
let HistoryModel;
let applyNetworkNodeAtWall;
let applyNetworkWallSegMove;
let validatePlanIntegrity;

beforeAll(async () => {
  await import("../src/planner/wallGeometry.js");

  const dispatcherMod = await import("../src/planner/ui/geometryCommandDispatcher.js");
  createGeometryCommandDispatcher = dispatcherMod.createGeometryCommandDispatcher;

  const historyMod = await import("../src/planner/core/history/historyModel.js");
  HistoryModel = historyMod.HistoryModel;

  const wallNetworkMod = await import("../src/planner/wallNetwork.js");
  applyNetworkNodeAtWall = wallNetworkMod.applyNetworkNodeAtWall;
  applyNetworkWallSegMove = wallNetworkMod.applyNetworkWallSegMove;

  const validationMod = await import("../src/planner/core/validation/validatePlanIntegrity.js");
  validatePlanIntegrity = validationMod.validatePlanIntegrity;
});

// ── fixtures ─────────────────────────────────────────────────────────────

function ids(prefix = "id") {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function singleWallPlan(a = { x: 0, y: 0 }, b = { x: 4000, y: 0 }) {
  return {
    room: { w: 6000, h: 3000 },
    nodes: { na: a, nb: b },
    walls: [{ id: "w1", a: "na", b: "nb", thk: 150 }],
    items: [], dimensions: [], rooms: [], zones: [],
  };
}

/** w1: n1(0,0)-n2(3000,0), w2: n2(3000,0)-n3(3000,3000) — n2 общий (junction). */
function sharedNodePlan(items = []) {
  return {
    room: { w: 6000, h: 3000 },
    nodes: { n1: { x: 0, y: 0 }, n2: { x: 3000, y: 0 }, n3: { x: 3000, y: 3000 } },
    walls: [{ id: "w1", a: "n1", b: "n2", thk: 100 }, { id: "w2", a: "n2", b: "n3", thk: 100 }],
    items, dimensions: [], rooms: [], zones: [],
  };
}

function sharedNodeDoors() {
  return [
    { id: "d1", kind: "door", x: 1400, y: -50, w: 600, h: 100, wallId: "w1" }, // near n2 on w1
    { id: "d2", kind: "door", x: 2950, y: 1200, w: 100, h: 600, wallId: "w2" }, // near n2 on w2
  ];
}

/** Собирает real HistoryModel + real dispatcher, эквивалент usePlanHistory + createGeometryCommandDispatcher в PlanPage. */
function makeHarness(initialPlan, extra = {}) {
  const history = new HistoryModel(initialPlan);
  const commitPlan = vi.fn((next) => history.setPlan(() => next));
  const setSelection = vi.fn();
  const setRuntimeDiagnostic = vi.fn();
  const showMessage = vi.fn();
  const roomSyncFn = extra.roomSyncFn
    || vi.fn((p) => ({ rooms: p.rooms || [], zones: p.zones || [], validationWarnings: [] }));
  const dispatcher = createGeometryCommandDispatcher({
    getPlan: () => history.current,
    commitPlan,
    setSelection,
    setRuntimeDiagnostic,
    showMessage,
    makeId: ids(),
    roomSyncFn,
  });
  return { history, dispatcher, commitPlan, setSelection, setRuntimeDiagnostic, showMessage, roomSyncFn };
}

// ── PlanPage onMove/onUp pattern, reproduced without React ────────────────

/** Mirrors PlanPage onMove's "node"/walls branch: history-free replace, absolute target per frame. */
function previewNodeDrag(history, wallId, nodeIdx, point) {
  history.replace((p) => applyNetworkNodeAtWall(p, wallId, nodeIdx, point));
}

/** Mirrors PlanPage onMove's "move-wall-seg" branch. */
function previewWallSegDrag(history, wallId, a, b) {
  history.replace((p) => applyNetworkWallSegMove(p, wallId, a, b));
}

/**
 * Mirrors PlanPage onUp's new node-drag final-commit branch.
 *
 * Restore uses history.setPlan (HistoryModel.mutate), NOT history.replace —
 * replace() leaves skipNext=true and doesn't consume it, so a restore via
 * replace() right before a mutate()-based commitPlan would cause THAT
 * commit's checkpoint to be silently skipped (mutate() sees skipNext still
 * true from preview and treats the checkpoint as already done). setPlan
 * here is itself checkpoint-free (skipNext is already true from the last
 * preview replace() call) and correctly resets the flag so the following
 * commitPlan checkpoints for real. See PlanPage.jsx onUp for the same fix.
 */
function commitNodeDrag(history, dispatcher, basePlan, wallId, nodeIdx, finalPoint) {
  if (!finalPoint) return null;
  if (history.current !== basePlan) history.setPlan(() => basePlan);
  return dispatcher({ type: "node.move", wallId, nodeIdx, point: finalPoint });
}

/** Mirrors PlanPage onUp's new wall-segment final-commit branch (see commitNodeDrag). */
function commitWallSegDrag(history, dispatcher, basePlan, wallId, finalA, finalB) {
  if (!finalA || !finalB) return null;
  if (history.current !== basePlan) history.setPlan(() => basePlan);
  return dispatcher({ type: "wall.moveSegment", wallId, a: finalA, b: finalB });
}

// ── node drag ────────────────────────────────────────────────────────────

describe("PHASE 1A-2B1 — node drag via geometry command boundary", () => {
  it("1. preview does not add history", () => {
    const { history } = makeHarness(singleWallPlan());
    const basePlan = history.current;
    previewNodeDrag(history, "w1", 1, { x: 4100, y: 20 });
    previewNodeDrag(history, "w1", 1, { x: 4250, y: -10 });
    expect(history.past).toHaveLength(0);
    expect(history.current).not.toBe(basePlan); // preview did move the live plan
  });

  it("2. success: basePlan restored before dispatch, exactly one checkpoint, undo/redo exact", () => {
    const { history, dispatcher, commitPlan } = makeHarness(singleWallPlan());
    const basePlan = history.current;
    previewNodeDrag(history, "w1", 1, { x: 4500, y: 80 });
    const finalPoint = { x: 4600, y: 100 };
    previewNodeDrag(history, "w1", 1, finalPoint);
    expect(history.current).not.toBe(basePlan);

    const result = commitNodeDrag(history, dispatcher, basePlan, "w1", 1, finalPoint);
    expect(result.ok && result.changed).toBe(true);
    expect(result.plan.nodes.nb).toEqual(finalPoint);
    expect(commitPlan).toHaveBeenCalledTimes(1);
    expect(history.past).toHaveLength(1);
    // Checkpoint = basePlan (restored before commit), NOT the noisy preview plan.
    expect(history.past[0]).toBe(basePlan);
    expect(history.current).toBe(result.plan);
    expect(history.undo()).toBe(basePlan);
    expect(history.redo()).toBe(result.plan);
  });

  it("3. two or more preview frames do not accumulate error — final geometry matches a single computation from basePlan", () => {
    const { history, dispatcher } = makeHarness(singleWallPlan());
    const basePlan = history.current;
    previewNodeDrag(history, "w1", 1, { x: 4001, y: 0 });
    previewNodeDrag(history, "w1", 1, { x: 4037, y: -3 });
    previewNodeDrag(history, "w1", 1, { x: 3990, y: 12 });
    const finalPoint = { x: 4123, y: -45 };
    previewNodeDrag(history, "w1", 1, finalPoint);

    const result = commitNodeDrag(history, dispatcher, basePlan, "w1", 1, finalPoint);
    const expected = applyNetworkNodeAtWall(basePlan, "w1", 1, finalPoint);
    expect(result.plan.nodes.nb).toEqual(expected.nodes.nb);
    expect(result.plan.nodes.nb).toEqual(finalPoint);
  });

  it("4. click with no preview frames commits nothing — zero checkpoint, plan stays basePlan", () => {
    const { history, dispatcher, commitPlan, setSelection } = makeHarness(singleWallPlan());
    const basePlan = history.current;
    // No previewNodeDrag call at all — mirrors zero pointermove events between down/up.
    const result = commitNodeDrag(history, dispatcher, basePlan, "w1", 1, null);
    expect(result).toBeNull();
    expect(commitPlan).not.toHaveBeenCalled();
    expect(setSelection).not.toHaveBeenCalled();
    expect(history.past).toHaveLength(0);
    expect(history.current).toBe(basePlan);
  });

  it("5. invalid final point is rejected: preview rolled back, zero checkpoint, selection unchanged", () => {
    const { history, dispatcher, commitPlan, setSelection } = makeHarness(singleWallPlan());
    const basePlan = history.current;
    previewNodeDrag(history, "w1", 1, { x: 4500, y: 30 });
    expect(history.current).not.toBe(basePlan);

    const result = commitNodeDrag(history, dispatcher, basePlan, "w1", 1, { x: NaN, y: 0 });
    expect(result.ok).toBe(false);
    expect(commitPlan).not.toHaveBeenCalled();
    expect(setSelection).not.toHaveBeenCalled();
    expect(history.past).toHaveLength(0);
    // Restored to basePlan, not left mid-preview.
    expect(history.current).toBe(basePlan);
  });

  it("6. shared node: both connected walls and mounted items update; room sync runs exactly once", () => {
    const plan = sharedNodePlan(sharedNodeDoors());
    const roomSyncFn = vi.fn((p) => ({ rooms: p.rooms || [], zones: p.zones || [], validationWarnings: [] }));
    const { history, dispatcher } = makeHarness(plan, { roomSyncFn });
    const basePlan = history.current;
    const finalPoint = { x: 3060, y: 40 };
    previewNodeDrag(history, "w1", 1, { x: 3020, y: 20 });
    previewNodeDrag(history, "w1", 1, finalPoint);

    const result = commitNodeDrag(history, dispatcher, basePlan, "w1", 1, finalPoint);
    expect(result.ok && result.changed).toBe(true);
    expect(result.plan.nodes.n2).toEqual(finalPoint);
    const w2 = result.plan.walls.find((w) => w.id === "w2");
    expect(result.plan.nodes[w2.a]).toEqual(finalPoint);
    expect(result.entityChanges.changed.walls.sort()).toEqual(["w1", "w2"]);

    const d1 = result.plan.items.find((it) => it.id === "d1");
    const d2 = result.plan.items.find((it) => it.id === "d2");
    expect(d1.wallSeg.b).toEqual(finalPoint);
    expect(d2.wallSeg.a).toEqual(finalPoint);

    expect(roomSyncFn).toHaveBeenCalledTimes(1);
    const diagnostics = validatePlanIntegrity(result.plan).diagnostics.filter((d) => d.entityType === "opening");
    expect(diagnostics).toEqual([]);
  });
});

// ── wall-segment drag ───────────────────────────────────────────────────

describe("PHASE 1A-2B1 — wall-segment drag via geometry command boundary", () => {
  it("1. preview does not add history", () => {
    const { history } = makeHarness(singleWallPlan());
    const basePlan = history.current;
    previewWallSegDrag(history, "w1", { x: 0, y: 100 }, { x: 4000, y: 100 });
    expect(history.past).toHaveLength(0);
    expect(history.current).not.toBe(basePlan);
  });

  it("2. success: exactly one checkpoint, checkpoint is basePlan", () => {
    const { history, dispatcher, commitPlan } = makeHarness(singleWallPlan());
    const basePlan = history.current;
    const finalA = { x: 0, y: 150 };
    const finalB = { x: 4000, y: 150 };
    previewWallSegDrag(history, "w1", { x: 0, y: 60 }, { x: 4000, y: 60 });
    previewWallSegDrag(history, "w1", finalA, finalB);

    const result = commitWallSegDrag(history, dispatcher, basePlan, "w1", finalA, finalB);
    expect(result.ok && result.changed).toBe(true);
    expect(commitPlan).toHaveBeenCalledTimes(1);
    expect(history.past).toHaveLength(1);
    expect(history.past[0]).toBe(basePlan);
    expect(result.plan.nodes.na).toEqual(finalA);
    expect(result.plan.nodes.nb).toEqual(finalB);
  });

  it("3. final A/B computed from origPts, not from accumulated preview state", () => {
    const { history, dispatcher } = makeHarness(singleWallPlan());
    const basePlan = history.current;
    // Noisy intermediate frames — must not influence the committed result.
    previewWallSegDrag(history, "w1", { x: 5, y: 33 }, { x: 4005, y: 33 });
    previewWallSegDrag(history, "w1", { x: -12, y: 61 }, { x: 3988, y: 61 });
    const finalA = { x: 0, y: 200 };
    const finalB = { x: 4000, y: 200 };
    previewWallSegDrag(history, "w1", finalA, finalB);

    const result = commitWallSegDrag(history, dispatcher, basePlan, "w1", finalA, finalB);
    const expected = applyNetworkWallSegMove(basePlan, "w1", finalA, finalB);
    expect(result.plan.nodes.na).toEqual(expected.nodes.na);
    expect(result.plan.nodes.nb).toEqual(expected.nodes.nb);
  });

  it("4. pending drag below the 4px threshold never previews — zero checkpoint, plan stays basePlan", () => {
    const { history, dispatcher, commitPlan } = makeHarness(singleWallPlan());
    const basePlan = history.current;
    // Mirrors PlanPage: mode stays "move-wall-seg-pending", onMove's
    // "move-wall-seg" branch (and therefore finalA/finalB) never runs.
    const result = commitWallSegDrag(history, dispatcher, basePlan, "w1", null, null);
    expect(result).toBeNull();
    expect(commitPlan).not.toHaveBeenCalled();
    expect(history.past).toHaveLength(0);
    expect(history.current).toBe(basePlan);
  });

  it("5a. invalid final target is rejected: preview rolled back, zero checkpoint", () => {
    const { history, dispatcher, commitPlan } = makeHarness(singleWallPlan());
    const basePlan = history.current;
    previewWallSegDrag(history, "w1", { x: 0, y: 90 }, { x: 4000, y: 90 });
    const result = commitWallSegDrag(history, dispatcher, basePlan, "w1", { x: NaN, y: 0 }, { x: 4000, y: 0 });
    expect(result.ok).toBe(false);
    expect(commitPlan).not.toHaveBeenCalled();
    expect(history.past).toHaveLength(0);
    expect(history.current).toBe(basePlan);
  });

  it("5b. no-op (dragged back to origin) is rejected as no-change: preview rolled back, zero checkpoint", () => {
    const a0 = { x: 0, y: 0 };
    const b0 = { x: 4000, y: 0 };
    const { history, dispatcher, commitPlan } = makeHarness(singleWallPlan(a0, b0));
    const basePlan = history.current;
    previewWallSegDrag(history, "w1", { x: 0, y: 120 }, { x: 4000, y: 120 });
    // Final target identical to the original committed position.
    const result = commitWallSegDrag(history, dispatcher, basePlan, "w1", a0, b0);
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(false);
    expect(commitPlan).not.toHaveBeenCalled();
    expect(history.past).toHaveLength(0);
    expect(history.current).toBe(basePlan);
  });

  it("6. undo/redo exact", () => {
    const { history, dispatcher } = makeHarness(singleWallPlan());
    const basePlan = history.current;
    const finalA = { x: 0, y: 175 };
    const finalB = { x: 4000, y: 175 };
    previewWallSegDrag(history, "w1", finalA, finalB);
    const result = commitWallSegDrag(history, dispatcher, basePlan, "w1", finalA, finalB);
    expect(history.undo()).toBe(basePlan);
    expect(history.redo()).toBe(result.plan);
  });

  it("7. selection is left untouched by the dispatcher (stays on wallId as set at drag start)", () => {
    const { history, dispatcher, setSelection } = makeHarness(singleWallPlan());
    const basePlan = history.current;
    const finalA = { x: 0, y: 210 };
    const finalB = { x: 4000, y: 210 };
    previewWallSegDrag(history, "w1", finalA, finalB);
    commitWallSegDrag(history, dispatcher, basePlan, "w1", finalA, finalB);
    // No selectAfter passed by the wall-segment final-commit path — selection,
    // set at drag start (setSelection({coll:"walls", ids:[wall.id]})) outside
    // this dispatch, is never touched here.
    expect(setSelection).not.toHaveBeenCalled();
  });
});

// ── keyboard nudge ──────────────────────────────────────────────────────

describe("PHASE 1A-2B1 — keyboard nudge via geometry command boundary", () => {
  it("1. one arrow press: exactly one checkpoint, geometry correct", () => {
    const { history, dispatcher, commitPlan } = makeHarness(singleWallPlan());
    const result = dispatcher({ type: "node.nudge", wallId: "w1", nodeIdx: 1, dx: 10, dy: 0, round: (v) => v });
    expect(result.ok && result.changed).toBe(true);
    expect(commitPlan).toHaveBeenCalledTimes(1);
    expect(history.past).toHaveLength(1);
    expect(result.plan.nodes.nb).toEqual({ x: 4010, y: 0 });
  });

  it("2. zero delta: zero checkpoint", () => {
    const { history, dispatcher, commitPlan } = makeHarness(singleWallPlan());
    const result = dispatcher({ type: "node.nudge", wallId: "w1", nodeIdx: 1, dx: 0, dy: 0, round: (v) => v });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(false);
    expect(commitPlan).not.toHaveBeenCalled();
    expect(history.past).toHaveLength(0);
  });

  it("3. whole-wall nudge without nodeIdx moves both endpoints", () => {
    const { dispatcher } = makeHarness(singleWallPlan());
    const result = dispatcher({ type: "node.nudge", wallId: "w1", dx: 25, dy: -15, round: (v) => v });
    expect(result.ok && result.changed).toBe(true);
    expect(result.plan.nodes.na).toEqual({ x: 25, y: -15 });
    expect(result.plan.nodes.nb).toEqual({ x: 4025, y: -15 });
  });

  it("4. endpoint nudge with nodeIdx moves only that node", () => {
    const { dispatcher } = makeHarness(singleWallPlan());
    const result = dispatcher({ type: "node.nudge", wallId: "w1", nodeIdx: 0, dx: 25, dy: -15, round: (v) => v });
    expect(result.ok && result.changed).toBe(true);
    expect(result.plan.nodes.na).toEqual({ x: 25, y: -15 });
    expect(result.plan.nodes.nb).toEqual({ x: 4000, y: 0 });
  });

  it("5. shared node: both connected walls and mounted items refresh; validator clean", () => {
    const plan = sharedNodePlan(sharedNodeDoors());
    const { dispatcher } = makeHarness(plan);
    const result = dispatcher({ type: "node.nudge", wallId: "w1", nodeIdx: 1, dx: 60, dy: 40 });
    expect(result.ok && result.changed).toBe(true);
    expect(result.plan.nodes.n2).toEqual({ x: 3060, y: 40 });
    const w2 = result.plan.walls.find((w) => w.id === "w2");
    expect(result.plan.nodes[w2.a]).toEqual({ x: 3060, y: 40 });
    const d1 = result.plan.items.find((it) => it.id === "d1");
    const d2 = result.plan.items.find((it) => it.id === "d2");
    expect(d1.wallSeg.b).toEqual({ x: 3060, y: 40 });
    expect(d2.wallSeg.a).toEqual({ x: 3060, y: 40 });
    const diagnostics = validatePlanIntegrity(result.plan).diagnostics.filter((d) => d.entityType === "opening");
    expect(diagnostics).toEqual([]);
  });

  it("6. selection is left untouched by the dispatcher", () => {
    const { dispatcher, setSelection } = makeHarness(singleWallPlan());
    dispatcher({ type: "node.nudge", wallId: "w1", nodeIdx: 1, dx: 10, dy: 0 });
    expect(setSelection).not.toHaveBeenCalled();
  });

  it("7. room sync runs exactly once", () => {
    const roomSyncFn = vi.fn((p) => ({ rooms: p.rooms || [], zones: p.zones || [], validationWarnings: [] }));
    const { dispatcher } = makeHarness(singleWallPlan(), { roomSyncFn });
    const result = dispatcher({ type: "node.nudge", wallId: "w1", nodeIdx: 1, dx: 10, dy: 0 });
    expect(result.ok).toBe(true);
    expect(roomSyncFn).toHaveBeenCalledTimes(1);
  });

  it("rounding function is threaded through to the command", () => {
    const { dispatcher } = makeHarness(singleWallPlan());
    const round = (v) => Math.round(v / 10) * 10;
    const result = dispatcher({ type: "node.nudge", wallId: "w1", nodeIdx: 1, dx: 3, dy: 0, round });
    // 4000 + 3 = 4003, rounded to nearest 10 -> 4000 -> same as original -> no-op.
    expect(result.changed).toBe(false);
  });
});
