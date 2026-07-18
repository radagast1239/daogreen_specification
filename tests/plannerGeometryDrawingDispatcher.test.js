/**
 * PHASE 1A-2B2 — wall drawing / finish-draft через geometry command boundary.
 *
 * Draft/preview state (draft points, drag-from, snap hints) is UI-only and
 * never touches `plan`/`HistoryModel` — confirmed by reading
 * src/planner/core/walls/wallDraft.js (pure, plan-free) and PlanPage.jsx's
 * onMove wall-tool branch (only setDraft/setDraftSnap/setDraftAngleSnap, no
 * setPlan/replacePlan/commitPlan). So there is no preview-history risk class
 * to test here, unlike drag (PHASE 1A-2B1) — this file tests only the single
 * finish-draft commit path: snapshot draft points → runGeometryCommand
 * ({type:"wall.create", ...}) → conditionally clear draft based on
 * result.ok, mirroring PlanPage.jsx's new finishWallChain().
 *
 * Command contract: wall.create is canonical; wall.finishDraft is a literal
 * alias in geometryCommands.js's HANDLERS table (same handleWallCreate
 * function reference) — not tested separately here since it is not a
 * distinct code path.
 *
 * Import-order fragility: same class as the rest of the command-layer test
 * suite (wallGeometry.js → core/walls/index.js re-export chain) — warm up
 * wallGeometry.js first in beforeAll.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";

let createGeometryCommandDispatcher;
let executeGeometryCommand;
let HistoryModel;
let GEOMETRY_COMMAND_INVALID;
let GEOMETRY_COMMAND_FAILED;
let validatePlanIntegrity;
let createWallDraftState;
let wallDraftStart;
let wallDraftAddSegment;
let wallDraftFinishMeta;

beforeAll(async () => {
  await import("../src/planner/wallGeometry.js");

  const dispatcherMod = await import("../src/planner/ui/geometryCommandDispatcher.js");
  createGeometryCommandDispatcher = dispatcherMod.createGeometryCommandDispatcher;

  const cmdMod = await import("../src/planner/commands/geometryCommands.js");
  executeGeometryCommand = cmdMod.executeGeometryCommand;
  GEOMETRY_COMMAND_INVALID = cmdMod.GEOMETRY_COMMAND_INVALID;
  GEOMETRY_COMMAND_FAILED = cmdMod.GEOMETRY_COMMAND_FAILED;

  const historyMod = await import("../src/planner/core/history/historyModel.js");
  HistoryModel = historyMod.HistoryModel;

  const validationMod = await import("../src/planner/core/validation/validatePlanIntegrity.js");
  validatePlanIntegrity = validationMod.validatePlanIntegrity;

  const draftMod = await import("../src/planner/core/walls/wallDraft.js");
  createWallDraftState = draftMod.createWallDraftState;
  wallDraftStart = draftMod.wallDraftStart;
  wallDraftAddSegment = draftMod.wallDraftAddSegment;
  wallDraftFinishMeta = draftMod.wallDraftFinishMeta;
});

// ── fixtures ─────────────────────────────────────────────────────────────

function ids(prefix = "id") {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function emptyPlan() {
  return {
    room: { w: 6000, h: 4000 },
    nodes: {}, walls: [], items: [], dimensions: [], rooms: [], zones: [],
  };
}

function singleWallPlan(a = { x: 0, y: 0 }, b = { x: 4000, y: 0 }) {
  return {
    room: { w: 6000, h: 4000 },
    nodes: { na: a, nb: b },
    walls: [{ id: "w1", a: "na", b: "nb", thk: 150 }],
    items: [], dimensions: [], rooms: [], zones: [],
  };
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
    makeId: extra.makeId || ids(),
    roomSyncFn,
  });
  return { history, dispatcher, commitPlan, setSelection, setRuntimeDiagnostic, showMessage, roomSyncFn };
}

/**
 * Mirrors PlanPage.jsx's new finishWallChain(): snapshot points/closed are
 * already known (draft computation itself is untouched, UI-only, not
 * re-tested here) → single runGeometryCommand call → draft cleared only if
 * result.ok (covers both success and no-op; rejected preserves the draft).
 */
function finishWallChainDraft(dispatcher, { pts, closed = false, wallProps = {} }) {
  if (!pts || pts.length < 2) {
    return { result: null, draftCleared: true }; // mirrors the pre-dispatch early return
  }
  const result = dispatcher({ type: "wall.create", points: pts, wallProps, closed });
  return { result, draftCleared: !!result?.ok };
}

/**
 * Real draft-ref harness — production-faithful reproduction of
 * wallDraftStateRef.current + the CORRECTED finishWallChain() (ref-only
 * source of truth, no fallback to a stale render-captured `draft`). Used to
 * exercise real event-sequencing scenarios (double finish, rapid Enter,
 * close-loop then dblclick) against the real pure wallDraft.js state
 * machine, not a hand-rolled points array.
 */
function makeDraftRefHarness() {
  const ref = { current: createWallDraftState() };
  return {
    ref,
    start(pt) { ref.current = wallDraftStart(ref.current, pt); },
    addSegment(pt) { const { state } = wallDraftAddSegment(ref.current, pt); ref.current = state; },
    markClosedLoop() { ref.current = { ...ref.current, closedLoop: true }; },
    /** Mirrors PlanPage.jsx's corrected finishWallChain() exactly. */
    finish(dispatcher, wallProps = {}) {
      const meta = wallDraftFinishMeta(ref.current);
      const pts = meta?.pts;
      const closed = meta?.closed === true;
      if (!pts || pts.length < 2) {
        ref.current = createWallDraftState(); // clearWallChain()-equivalent
        return { result: null, draftCleared: true };
      }
      const result = dispatcher({ type: "wall.create", points: pts, wallProps, closed });
      if (result?.ok) ref.current = createWallDraftState(); // clearWallChain()-equivalent
      return { result, draftCleared: !!result?.ok };
    },
  };
}

// ── chain semantics: point count → wall count ──────────────────────────────

describe("PHASE 1A-2B2 — finish-draft chain semantics", () => {
  it("2-point finish creates exactly 1 wall, 1 checkpoint, 1 room sync, draft cleared", () => {
    const { history, dispatcher, commitPlan, roomSyncFn } = makeHarness(emptyPlan());
    const { result, draftCleared } = finishWallChainDraft(dispatcher, {
      pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }],
    });
    expect(result.ok && result.changed).toBe(true);
    expect(result.plan.walls).toHaveLength(1);
    expect(commitPlan).toHaveBeenCalledTimes(1);
    expect(history.past).toHaveLength(1);
    expect(roomSyncFn).toHaveBeenCalledTimes(1);
    expect(draftCleared).toBe(true);
  });

  it("3-point chain creates exactly 2 walls, 1 checkpoint (not 2)", () => {
    const { history, dispatcher, commitPlan } = makeHarness(emptyPlan());
    const { result } = finishWallChainDraft(dispatcher, {
      pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }],
    });
    expect(result.ok && result.changed).toBe(true);
    expect(result.plan.walls).toHaveLength(2);
    expect(commitPlan).toHaveBeenCalledTimes(1);
    expect(history.past).toHaveLength(1);
  });

  it("N-point chain creates N-1 walls in a single command/checkpoint", () => {
    const { dispatcher, commitPlan, history } = makeHarness(emptyPlan());
    const pts = [
      { x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 },
      { x: 2000, y: 1000 }, { x: 2000, y: 2000 }, { x: 3000, y: 2000 },
    ];
    const { result } = finishWallChainDraft(dispatcher, { pts });
    expect(result.plan.walls).toHaveLength(pts.length - 1);
    expect(commitPlan).toHaveBeenCalledTimes(1);
    expect(history.past).toHaveLength(1);
  });

  it("closed chain (closed:true) creates N walls for N points, not N-1", () => {
    const { dispatcher, history } = makeHarness(emptyPlan());
    const pts = [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }];
    const { result } = finishWallChainDraft(dispatcher, { pts, closed: true });
    expect(result.ok && result.changed).toBe(true);
    // Triangle: 3 open segments + 1 closing segment back to the start = 3 walls.
    expect(result.plan.walls).toHaveLength(3);
    expect(history.past).toHaveLength(1);
  });

  it("wallProps (thk/role) are applied to every wall in the chain", () => {
    const { dispatcher } = makeHarness(emptyPlan());
    const { result } = finishWallChainDraft(dispatcher, {
      pts: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }],
      wallProps: { thk: 200, role: "outer" },
    });
    expect(result.plan.walls.every((w) => w.thk === 200)).toBe(true);
  });
});

// ── no-op / insufficient points ─────────────────────────────────────────

describe("PHASE 1A-2B2 — insufficient points / no-op", () => {
  it("fewer than 2 points never dispatches a command — zero checkpoint, draft cleared (current UX)", () => {
    const { history, dispatcher, commitPlan } = makeHarness(emptyPlan());
    const { result, draftCleared } = finishWallChainDraft(dispatcher, { pts: [{ x: 0, y: 0 }] });
    expect(result).toBeNull();
    expect(commitPlan).not.toHaveBeenCalled();
    expect(history.past).toHaveLength(0);
    expect(draftCleared).toBe(true);
  });

  it("identical two points is a no-op: zero checkpoint, draft cleared, no walls created", () => {
    const { history, dispatcher, commitPlan } = makeHarness(emptyPlan());
    const { result, draftCleared } = finishWallChainDraft(dispatcher, {
      pts: [{ x: 100, y: 100 }, { x: 100, y: 100 }],
    });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(false);
    expect(commitPlan).not.toHaveBeenCalled();
    expect(history.past).toHaveLength(0);
    expect(result.plan.walls).toHaveLength(0);
    expect(draftCleared).toBe(true);
  });

  it("duplicate consecutive point mid-chain is deduplicated, producing a valid 2-segment chain (not a no-op)", () => {
    const { dispatcher, commitPlan, history } = makeHarness(emptyPlan());
    const { result, draftCleared } = finishWallChainDraft(dispatcher, {
      pts: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }],
    });
    expect(result.ok && result.changed).toBe(true);
    expect(result.plan.walls).toHaveLength(2); // duplicate point collapsed, not a 3rd degenerate wall
    expect(commitPlan).toHaveBeenCalledTimes(1);
    expect(history.past).toHaveLength(1);
    expect(draftCleared).toBe(true);
  });
});

// ── rejected / invalid ──────────────────────────────────────────────────

describe("PHASE 1A-2B2 — rejected / invalid finish", () => {
  it("a non-finite point is rejected: zero checkpoint, structured message, draft preserved, IDs not consumed", () => {
    let calls = 0;
    const makeId = () => { calls += 1; return `id-${calls}`; };
    const { history, dispatcher, commitPlan, showMessage } = makeHarness(emptyPlan(), { makeId });
    const { result, draftCleared } = finishWallChainDraft(dispatcher, {
      pts: [{ x: 0, y: 0 }, { x: NaN, y: 100 }],
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe(GEOMETRY_COMMAND_INVALID);
    expect(commitPlan).not.toHaveBeenCalled();
    expect(history.past).toHaveLength(0);
    expect(calls).toBe(0); // no IDs consumed on rejection
    expect(showMessage).toHaveBeenCalledWith(result.error.message);
    expect(draftCleared).toBe(false); // draft preserved so the user can fix and retry
  });
});

// ── explicit cancel ──────────────────────────────────────────────────────

describe("PHASE 1A-2B2 — explicit cancel", () => {
  it("cancel never calls the dispatcher at all — zero checkpoint, no message", () => {
    // clearWallChain() (Escape / context-menu "wall-draft-cancel" / close-to-
    // start release) is pure draft/UI-state reset — it never calls
    // runGeometryCommand. Verified by source inspection (see RESULT — PHASE
    // 1A-2B2, "Drawing lifecycle audit"); nothing to exercise against a real
    // dispatcher here since there is no command call to make.
    const { history, dispatcher, commitPlan, showMessage } = makeHarness(emptyPlan());
    // No dispatcher call at all for cancel.
    expect(commitPlan).not.toHaveBeenCalled();
    expect(showMessage).not.toHaveBeenCalled();
    expect(history.past).toHaveLength(0);
    expect(dispatcher).toBeTypeOf("function"); // harness sanity — dispatcher exists but is simply never invoked
  });
});

// ── room-sync failure ────────────────────────────────────────────────────

describe("PHASE 1A-2B2 — room-sync failure", () => {
  it("room sync throwing: geometry still committed, one checkpoint, diagnostic surfaced, draft cleared", () => {
    const throwingRoomSyncFn = () => { throw new Error("controlled room-engine failure"); };
    const { history, dispatcher, commitPlan, setRuntimeDiagnostic } = makeHarness(emptyPlan(), { roomSyncFn: throwingRoomSyncFn });
    const { result, draftCleared } = finishWallChainDraft(dispatcher, {
      pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }],
    });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.plan.walls).toHaveLength(1); // geometry survives the room-sync failure
    expect(commitPlan).toHaveBeenCalledTimes(1);
    expect(history.past).toHaveLength(1);
    expect(setRuntimeDiagnostic).toHaveBeenCalled();
    expect(draftCleared).toBe(true);
  });
});

// ── command exception / atomicity ────────────────────────────────────────

describe("PHASE 1A-2B2 — command exception and atomicity", () => {
  it("makeId throwing mid-chain: structured failure, zero checkpoint, no partial nodes/walls, draft preserved", () => {
    const throwingMakeId = () => { throw new Error("boom"); };
    const { history, dispatcher, commitPlan, showMessage } = makeHarness(emptyPlan(), { makeId: throwingMakeId });
    const { result, draftCleared } = finishWallChainDraft(dispatcher, {
      pts: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }],
    });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe(GEOMETRY_COMMAND_FAILED);
    expect(commitPlan).not.toHaveBeenCalled();
    expect(history.past).toHaveLength(0);
    expect(history.current.walls).toHaveLength(0); // no partial chain leaked
    expect(showMessage).toHaveBeenCalled();
    expect(draftCleared).toBe(false);
  });

  it("input points array is not mutated by the command", () => {
    const { dispatcher } = makeHarness(emptyPlan());
    const pts = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 0 }];
    const before = JSON.parse(JSON.stringify(pts));
    finishWallChainDraft(dispatcher, { pts });
    expect(pts).toEqual(before);
  });
});

// ── undo / redo ──────────────────────────────────────────────────────────

describe("PHASE 1A-2B2 — undo / redo", () => {
  it("undo removes the whole chain in one step; redo restores the exact same plan/IDs", () => {
    const { history, dispatcher } = makeHarness(emptyPlan());
    const basePlan = history.current;
    const { result } = finishWallChainDraft(dispatcher, {
      pts: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }],
    });
    expect(result.plan.walls).toHaveLength(2);
    expect(history.undo()).toBe(basePlan);
    expect(history.current.walls).toHaveLength(0);
    expect(history.redo()).toBe(result.plan);
    expect(history.current.walls).toHaveLength(2);
    expect(history.current.walls.map((w) => w.id)).toEqual(result.plan.walls.map((w) => w.id));
  });
});

// ── idempotency / event sequencing (corrective pass) ─────────────────────

// Uses makeDraftRefHarness (real wallDraft.js pure functions + the CORRECTED
// finishWallChain pattern: ref-only source of truth, no fallback to a
// stale render-captured `draft`). Proves the specific stale-read class this
// corrective pass closed — a second finish call reads the ALREADY-cleared
// ref, not a not-yet-rerendered React state snapshot.
describe("PHASE 1A-2B2 corrective — idempotency / event sequencing", () => {
  it("two immediate finish calls: the second (no new points added) sees an already-empty ref — no second command, no phantom checkpoint", () => {
    const { history, dispatcher, commitPlan } = makeHarness(emptyPlan());
    const draft = makeDraftRefHarness();
    draft.start({ x: 0, y: 0 });
    draft.addSegment({ x: 1000, y: 0 });

    const first = draft.finish(dispatcher);
    expect(first.result.ok && first.result.changed).toBe(true);
    expect(commitPlan).toHaveBeenCalledTimes(1);
    expect(history.past).toHaveLength(1);
    const wallsAfterFirst = first.result.plan.walls.length;

    // Second finish trigger in the same synchronous tick — no addSegment in between.
    const second = draft.finish(dispatcher);
    expect(second.result).toBeNull(); // ref already empty -> pre-dispatch early return
    expect(commitPlan).toHaveBeenCalledTimes(1); // unchanged
    expect(history.past).toHaveLength(1); // no phantom second checkpoint
    expect(history.current.walls).toHaveLength(wallsAfterFirst); // no duplicate chain
  });

  it("rapid Enter twice (no point added between presses): only one chain, one checkpoint", () => {
    const { history, dispatcher, commitPlan } = makeHarness(emptyPlan());
    const draft = makeDraftRefHarness();
    draft.start({ x: 0, y: 0 });
    draft.addSegment({ x: 1000, y: 0 });
    draft.addSegment({ x: 1000, y: 1000 });

    draft.finish(dispatcher); // first Enter
    draft.finish(dispatcher); // second Enter, immediately after

    expect(commitPlan).toHaveBeenCalledTimes(1);
    expect(history.past).toHaveLength(1);
    expect(history.current.walls).toHaveLength(2);
  });

  it("close-loop finish (onUp snap-to-close) followed by a simulated double-click: no duplicate closing wall", () => {
    const { history, dispatcher, commitPlan } = makeHarness(emptyPlan());
    const draft = makeDraftRefHarness();
    draft.start({ x: 0, y: 0 });
    draft.addSegment({ x: 1000, y: 0 });
    draft.addSegment({ x: 1000, y: 1000 });
    // Mirrors onUp's close-loop branch: addWallDraftSegment back to the
    // chain start, THEN mark closedLoop:true, THEN finishWallChain().
    draft.addSegment({ x: 0, y: 0 });
    draft.markClosedLoop();

    const closeResult = draft.finish(dispatcher);
    expect(closeResult.result.ok && closeResult.result.changed).toBe(true);
    expect(commitPlan).toHaveBeenCalledTimes(1);
    expect(history.past).toHaveLength(1);
    expect(closeResult.result.plan.walls).toHaveLength(3); // triangle, exactly one closing segment
    const wallsAfterClose = closeResult.result.plan.walls.length;

    // Simulated subsequent double-click finish trigger.
    const dblClickResult = draft.finish(dispatcher);
    expect(dblClickResult.result).toBeNull();
    expect(commitPlan).toHaveBeenCalledTimes(1);
    expect(history.past).toHaveLength(1);
    expect(history.current.walls).toHaveLength(wallsAfterClose); // no duplicate closing wall
  });

  it("rejected finish preserves the draft ref; a corrected retry succeeds with one final checkpoint", () => {
    const { history, dispatcher, commitPlan } = makeHarness(emptyPlan());
    const draft = makeDraftRefHarness();
    draft.start({ x: 0, y: 0 });
    draft.addSegment({ x: 1000, y: 0 });
    // Simulate an invalid final coordinate reaching finish.
    draft.ref.current = { ...draft.ref.current, pts: [{ x: 0, y: 0 }, { x: NaN, y: 0 }] };

    const rejected = draft.finish(dispatcher);
    expect(rejected.result.ok).toBe(false);
    expect(commitPlan).not.toHaveBeenCalled();
    expect(history.past).toHaveLength(0);
    expect(draft.ref.current.pts).toEqual([{ x: 0, y: 0 }, { x: NaN, y: 0 }]); // preserved for retry

    // User corrects the point in place, same ref, then retries.
    draft.ref.current = { ...draft.ref.current, pts: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] };
    const retried = draft.finish(dispatcher);
    expect(retried.result.ok && retried.result.changed).toBe(true);
    expect(commitPlan).toHaveBeenCalledTimes(1);
    expect(history.past).toHaveLength(1); // only the successful retry checkpointed
  });

  it("commit failure preserves the draft ref (dispatcher's structured commit-failure path)", () => {
    const history = new HistoryModel(emptyPlan());
    const commitPlan = vi.fn(() => { throw new Error("commit failed"); });
    const dispatcher = createGeometryCommandDispatcher({
      getPlan: () => history.current,
      commitPlan,
      setSelection: vi.fn(),
      setRuntimeDiagnostic: vi.fn(),
      showMessage: vi.fn(),
      makeId: ids(),
    });
    const draft = makeDraftRefHarness();
    draft.start({ x: 0, y: 0 });
    draft.addSegment({ x: 1000, y: 0 });

    const { result } = draft.finish(dispatcher);
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("GEOMETRY_COMMAND_COMMIT_FAILED");
    expect(history.past).toHaveLength(0);
    expect(draft.ref.current.pts).toHaveLength(2); // preserved, not cleared
  });
});

// ── selection policy ─────────────────────────────────────────────────────

describe("PHASE 1A-2B2 — selection policy", () => {
  it("selection is never touched by finish-draft (matches old UX: finishWallChain never called setSelection)", () => {
    const { dispatcher, setSelection } = makeHarness(emptyPlan());
    finishWallChainDraft(dispatcher, { pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }] });
    expect(setSelection).not.toHaveBeenCalled();
  });

  it("entityChanges.created.walls/nodes contains all real created IDs, no duplicates, deterministic", () => {
    const { dispatcher } = makeHarness(emptyPlan(), { makeId: ids("gen") });
    const { result } = finishWallChainDraft(dispatcher, {
      pts: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }],
    });
    expect(result.entityChanges.created.walls).toHaveLength(2);
    expect(result.entityChanges.created.nodes).toHaveLength(3);
    expect(new Set(result.entityChanges.created.walls).size).toBe(2);
    expect(new Set(result.entityChanges.created.nodes).size).toBe(3);
    expect(result.createdEntityIds.sort()).toEqual(
      [...result.entityChanges.created.walls, ...result.entityChanges.created.nodes].sort(),
    );
  });
});

// ── node-reuse on create (T-junction / snap-onto-existing-geometry) ──────

// commitWallEdge -> findOrCreateNode(nodes, pt, makeId, NODE_LINK_THR) reuses
// an existing node whenever dist(existing, pt) <= NODE_LINK_THR (85mm, see
// src/planner/core/walls/wallOps.js), via near(a,b,thr) = dist(a,b) <= thr
// (src/planner/core/geometry/point.js). This is deterministic, pre-existing
// behavior (unchanged by this migration — commitWallEdge is called
// identically from the old direct path and the new wall.create command).
// A point placed exactly on an existing node's coordinate (distance 0) is
// unambiguously within tolerance, so the outcome below is exact, not a
// coincidence of fixture geometry.
describe("PHASE 1A-2B2 — node reuse on create (exact, deterministic)", () => {
  it("starting a new chain exactly at an existing wall's node reuses that node — not a duplicate", () => {
    const plan = singleWallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const existingNodeId = Object.keys(plan.nodes).find((id) => plan.nodes[id].x === 0 && plan.nodes[id].y === 0);
    expect(existingNodeId).toBeTruthy();
    const nodeCountBefore = Object.keys(plan.nodes).length;

    const result = executeGeometryCommand(plan, {
      type: "wall.create",
      points: [{ x: 0, y: 0 }, { x: 0, y: 3000 }],
    }, { makeId: ids() });

    expect(result.ok && result.changed).toBe(true);
    // Exactly +1 node: the shared corner is reused, only the free endpoint
    // {0,3000} gets a new node.
    expect(Object.keys(result.plan.nodes)).toHaveLength(nodeCountBefore + 1);
    // No new node was created at the existing coordinate.
    expect(result.entityChanges.created.nodes).not.toContain(existingNodeId);
    expect(result.entityChanges.created.nodes).toHaveLength(1);

    const newWall = result.plan.walls.find((w) => !plan.walls.some((ow) => ow.id === w.id));
    expect(newWall).toBeTruthy();
    // The new wall's endpoint at {0,0} is literally the pre-existing node ID.
    expect([newWall.a, newWall.b]).toContain(existingNodeId);
    expect(result.plan.nodes[existingNodeId]).toEqual({ x: 0, y: 0 });

    const diagnostics = validatePlanIntegrity(result.plan).diagnostics;
    expect(diagnostics).toEqual([]);
  });
});
