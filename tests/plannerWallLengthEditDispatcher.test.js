/**
 * PHASE 1B-1B — applyWallLengthEdit + createWallLengthEditSession, exercised
 * against the real geometry command dispatcher (real HistoryModel, real
 * createGeometryCommandDispatcher, real executeGeometryCommand, real
 * wall.setLength) — no mocks of the command layer itself.
 *
 * PlanPage.jsx is not rendered here (no React Testing Library harness exists
 * elsewhere in this suite either) — instead, a local `makeEditorHarness`
 * below reproduces PlanPage's planned open/setValue/toggleAnchor/submit/escape
 * glue byte-for-byte (session-guard + applyWallLengthEdit composition), so
 * the full Enter/blur/Escape/anchor-toggle event-sequencing matrix is proven
 * against real logic. The actual PlanPage wiring is verified separately via
 * static source review (see plannerDependencyBoundary.test.js).
 *
 * Import-order fragility: same class as the rest of the command-layer test
 * suite — wallGeometry.js warmed up first in beforeAll.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";

let createGeometryCommandDispatcher;
let HistoryModel;
let applyWallLengthEdit;
let createWallLengthEditSession;

beforeAll(async () => {
  await import("../src/planner/wallGeometry.js");

  const dispatcherMod = await import("../src/planner/ui/geometryCommandDispatcher.js");
  createGeometryCommandDispatcher = dispatcherMod.createGeometryCommandDispatcher;

  const historyMod = await import("../src/planner/core/history/historyModel.js");
  HistoryModel = historyMod.HistoryModel;

  const applyMod = await import("../src/planner/ui/applyWallLengthEdit.js");
  applyWallLengthEdit = applyMod.applyWallLengthEdit;
  createWallLengthEditSession = applyMod.createWallLengthEditSession;
});

// ── fixtures ─────────────────────────────────────────────────────────────

function ids(prefix = "id") {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function wallPlan(a, b) {
  return {
    room: { w: 8000, h: 6000 },
    nodes: { na: { x: a.x, y: a.y }, nb: { x: b.x, y: b.y } },
    walls: [{ id: "w1", a: "na", b: "nb", thk: 150 }],
    items: [],
    dimensions: [],
    rooms: [],
    zones: [],
  };
}

function makeHarness(initialPlan, extra = {}) {
  const history = new HistoryModel(initialPlan);
  const commitPlan = extra.commitPlan || vi.fn((next) => history.setPlan(() => next));
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
 * Reproduces the planned PlanPage glue exactly: one createWallLengthEditSession
 * per editor lifetime, applyWallLengthEdit as the single canonical apply path,
 * status-driven close/reopen policy (PHASE 1B-1B §12).
 */
function makeEditorHarness(dispatcher) {
  const session = createWallLengthEditSession();
  let entry = null;

  return {
    open({ wallId, fixedEndpoint, value }) {
      const token = session.open();
      entry = { wallId, fixedEndpoint, value, error: null, token };
    },
    setValue(value) {
      if (entry) entry = { ...entry, value, error: null };
    },
    toggleAnchor(fixedEndpoint) {
      if (entry) entry = { ...entry, fixedEndpoint };
    },
    submit() {
      if (!entry) return null;
      if (!session.tryConsume(entry.token)) return null; // guard: already handled
      const result = applyWallLengthEdit({
        rawValue: entry.value,
        wallId: entry.wallId,
        fixedEndpoint: entry.fixedEndpoint,
        runGeometryCommand: dispatcher,
      });
      if (result.status === "parse-rejected") {
        session.reopen(entry.token);
        entry = { ...entry, error: result.message };
        return result;
      }
      if (result.status === "geometry-rejected" || result.status === "commit-failed") {
        session.reopen(entry.token);
        entry = { ...entry, error: null };
        return result;
      }
      entry = null; // success or noop
      return result;
    },
    escape() {
      session.close();
      entry = null;
    },
    get isOpen() {
      return entry !== null;
    },
    get rawValue() {
      return entry?.value ?? null;
    },
    get error() {
      return entry?.error ?? null;
    },
    get fixedEndpoint() {
      return entry?.fixedEndpoint ?? null;
    },
  };
}

// ── createWallLengthEditSession (pure state machine) ────────────────────────

describe("PHASE 1B-1B — createWallLengthEditSession", () => {
  it("tryConsume succeeds exactly once per open()", () => {
    const session = createWallLengthEditSession();
    const token = session.open();
    expect(session.tryConsume(token)).toBe(true);
    expect(session.tryConsume(token)).toBe(false);
  });

  it("reopen re-arms the same token for a subsequent submit", () => {
    const session = createWallLengthEditSession();
    const token = session.open();
    expect(session.tryConsume(token)).toBe(true);
    session.reopen(token);
    expect(session.tryConsume(token)).toBe(true);
  });

  it("close invalidates the token", () => {
    const session = createWallLengthEditSession();
    const token = session.open();
    session.close();
    expect(session.tryConsume(token)).toBe(false);
  });

  it("opening a new session invalidates the previous token", () => {
    const session = createWallLengthEditSession();
    const tokenA = session.open();
    const tokenB = session.open();
    expect(tokenA).not.toBe(tokenB);
    expect(session.tryConsume(tokenA)).toBe(false);
    expect(session.tryConsume(tokenB)).toBe(true);
  });

  it("tryConsume rejects null/undefined tokens", () => {
    const session = createWallLengthEditSession();
    session.open();
    expect(session.tryConsume(null)).toBe(false);
    expect(session.tryConsume(undefined)).toBe(false);
  });
});

// ── applyWallLengthEdit (real dispatcher) ───────────────────────────────────

describe("PHASE 1B-1B — applyWallLengthEdit orchestration", () => {
  it("valid input: parses and calls the real command exactly once, success", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const { dispatcher, history } = makeHarness(plan);
    const spy = vi.fn(dispatcher);
    const result = applyWallLengthEdit({ rawValue: "5000", wallId: "w1", fixedEndpoint: "a", runGeometryCommand: spy });
    expect(result.status).toBe("success");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ type: "wall.setLength", wallId: "w1", lengthMm: 5000, fixedEndpoint: "a" });
    expect(history.past.length).toBe(1);
  });

  it("comma-decimal input parses correctly and succeeds", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const { dispatcher, history } = makeHarness(plan);
    const result = applyWallLengthEdit({ rawValue: "5000,5", wallId: "w1", fixedEndpoint: "a", runGeometryCommand: dispatcher });
    expect(result.status).toBe("success");
    expect(history.current.nodes.nb).toEqual({ x: 5000.5, y: 0 });
  });

  it("same length is a no-op: command called once, zero checkpoints", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const { dispatcher, history } = makeHarness(plan);
    const spy = vi.fn(dispatcher);
    const result = applyWallLengthEdit({ rawValue: "4000", wallId: "w1", fixedEndpoint: "a", runGeometryCommand: spy });
    expect(result.status).toBe("noop");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(history.past.length).toBe(0);
  });

  it("invalid text never reaches the dispatcher", () => {
    const spy = vi.fn();
    const result = applyWallLengthEdit({ rawValue: "abc", wallId: "w1", fixedEndpoint: "a", runGeometryCommand: spy });
    expect(result.status).toBe("parse-rejected");
    expect(spy).not.toHaveBeenCalled();
  });

  it("below the 50mm minimum never reaches the dispatcher", () => {
    const spy = vi.fn();
    const result = applyWallLengthEdit({ rawValue: "10", wallId: "w1", fixedEndpoint: "a", runGeometryCommand: spy });
    expect(result.status).toBe("parse-rejected");
    expect(spy).not.toHaveBeenCalled();
  });

  it("a geometry-level rejection (wall no longer exists) calls the command once, zero checkpoints", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const { dispatcher, history } = makeHarness(plan);
    history.setPlan((p) => ({ ...p, walls: [] })); // simulate the wall being removed elsewhere
    const spy = vi.fn(dispatcher);
    const historyDepthBefore = history.past.length;
    const result = applyWallLengthEdit({ rawValue: "5000", wallId: "w1", fixedEndpoint: "a", runGeometryCommand: spy });
    expect(result.status).toBe("geometry-rejected");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(history.past.length).toBe(historyDepthBefore); // no additional checkpoint from the rejected attempt
  });

  it("a commit failure is reported distinctly from a geometry rejection", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const commitPlan = vi.fn(() => { throw new Error("commit failed"); });
    const { dispatcher } = makeHarness(plan, { commitPlan });
    const result = applyWallLengthEdit({ rawValue: "5000", wallId: "w1", fixedEndpoint: "a", runGeometryCommand: dispatcher });
    expect(result.status).toBe("commit-failed");
    expect(commitPlan).toHaveBeenCalledTimes(1);
  });

  it("a room-sync diagnostic failure still reports success (geometry committed)", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const throwingRoomSyncFn = vi.fn(() => { throw new Error("controlled room-engine failure"); });
    const { dispatcher, history, setRuntimeDiagnostic } = makeHarness(plan, { roomSyncFn: throwingRoomSyncFn });
    const result = applyWallLengthEdit({ rawValue: "5000", wallId: "w1", fixedEndpoint: "a", runGeometryCommand: dispatcher });
    expect(result.status).toBe("success");
    expect(history.past.length).toBe(1);
    expect(setRuntimeDiagnostic).toHaveBeenCalled();
  });
});

// ── full editor event-sequencing matrix (PHASE 1B-1B §14) ───────────────────

describe("PHASE 1B-1B — editor event sequencing", () => {
  it("valid Enter: 1 command call, 1 checkpoint, editor closes, raw cleared, selection unchanged", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const { dispatcher, history, setSelection } = makeHarness(plan);
    const spy = vi.fn(dispatcher);
    const editor = makeEditorHarness(spy);
    editor.open({ wallId: "w1", fixedEndpoint: "a", value: "5000" });
    editor.submit(); // Enter
    expect(spy).toHaveBeenCalledTimes(1);
    expect(history.past.length).toBe(1);
    expect(editor.isOpen).toBe(false);
    expect(editor.rawValue).toBeNull();
    expect(setSelection).not.toHaveBeenCalled();
  });

  it("valid blur (same submit path as Enter): 1 command call, 1 checkpoint, editor closes", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const { dispatcher, history } = makeHarness(plan);
    const spy = vi.fn(dispatcher);
    const editor = makeEditorHarness(spy);
    editor.open({ wallId: "w1", fixedEndpoint: "a", value: "5000" });
    editor.submit(); // blur
    expect(spy).toHaveBeenCalledTimes(1);
    expect(history.past.length).toBe(1);
    expect(editor.isOpen).toBe(false);
  });

  it("Enter then a trailing blur: exactly 1 command call total, 1 checkpoint", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const { dispatcher, history } = makeHarness(plan);
    const spy = vi.fn(dispatcher);
    const editor = makeEditorHarness(spy);
    editor.open({ wallId: "w1", fixedEndpoint: "a", value: "5000" });
    editor.submit(); // Enter succeeds, closes
    editor.submit(); // trailing blur fired by DOM removal — must be a no-op
    expect(spy).toHaveBeenCalledTimes(1);
    expect(history.past.length).toBe(1);
    expect(editor.isOpen).toBe(false);
  });

  it("double Enter (rapid repeat): exactly 1 command call total, 1 checkpoint", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const { dispatcher, history } = makeHarness(plan);
    const spy = vi.fn(dispatcher);
    const editor = makeEditorHarness(spy);
    editor.open({ wallId: "w1", fixedEndpoint: "a", value: "5000" });
    editor.submit();
    editor.submit();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(history.past.length).toBe(1);
  });

  it("same length: 1 command call, 0 checkpoints, editor still closes", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const { dispatcher, history } = makeHarness(plan);
    const spy = vi.fn(dispatcher);
    const editor = makeEditorHarness(spy);
    editor.open({ wallId: "w1", fixedEndpoint: "a", value: "4000" });
    editor.submit();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(history.past.length).toBe(0);
    expect(editor.isOpen).toBe(false);
  });

  it("comma decimal: 1 command call, 1 checkpoint, editor closes", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const { dispatcher, history } = makeHarness(plan);
    const editor = makeEditorHarness(dispatcher);
    editor.open({ wallId: "w1", fixedEndpoint: "a", value: "5000,25" });
    editor.submit();
    expect(history.past.length).toBe(1);
    expect(history.current.nodes.nb).toEqual({ x: 5000.25, y: 0 });
    expect(editor.isOpen).toBe(false);
  });

  it("invalid text: 0 command calls, 0 checkpoints, editor stays open, raw preserved", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const { dispatcher, history } = makeHarness(plan);
    const spy = vi.fn(dispatcher);
    const editor = makeEditorHarness(spy);
    editor.open({ wallId: "w1", fixedEndpoint: "a", value: "abc" });
    editor.submit();
    expect(spy).not.toHaveBeenCalled();
    expect(history.past.length).toBe(0);
    expect(editor.isOpen).toBe(true);
    expect(editor.rawValue).toBe("abc");
    expect(editor.error).toBeTruthy();
  });

  it("below 50mm: 0 command calls, 0 checkpoints, editor stays open, raw preserved", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const { dispatcher, history } = makeHarness(plan);
    const spy = vi.fn(dispatcher);
    const editor = makeEditorHarness(spy);
    editor.open({ wallId: "w1", fixedEndpoint: "a", value: "10" });
    editor.submit();
    expect(spy).not.toHaveBeenCalled();
    expect(history.past.length).toBe(0);
    expect(editor.isOpen).toBe(true);
    expect(editor.rawValue).toBe("10");
  });

  it("geometry rejected: 1 command call, 0 checkpoints, editor stays open, raw preserved, retry succeeds", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const { dispatcher, history } = makeHarness(plan);
    history.setPlan((p) => ({ ...p, walls: [] })); // simulate the wall being removed elsewhere
    const historyDepthAfterSetup = history.past.length;
    const spy = vi.fn(dispatcher);
    const editor = makeEditorHarness(spy);
    editor.open({ wallId: "w1", fixedEndpoint: "a", value: "5000" });
    editor.submit();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(history.past.length).toBe(historyDepthAfterSetup); // no additional checkpoint from the rejected attempt
    expect(editor.isOpen).toBe(true);
    expect(editor.rawValue).toBe("5000");

    // A corrected retry (wall restored) on the SAME still-open editor succeeds.
    history.setPlan((p) => ({ ...p, walls: [{ id: "w1", a: "na", b: "nb", thk: 150 }] }));
    const historyDepthAfterRestore = history.past.length;
    editor.submit();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(history.past.length).toBe(historyDepthAfterRestore + 1); // exactly one new checkpoint from the successful retry
    expect(editor.isOpen).toBe(false);
  });

  it("commit failure: 1 command call, 0 checkpoints, editor stays open, raw preserved", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const commitPlan = vi.fn(() => { throw new Error("commit failed"); });
    const { dispatcher, history } = makeHarness(plan, { commitPlan });
    const spy = vi.fn(dispatcher);
    const editor = makeEditorHarness(spy);
    editor.open({ wallId: "w1", fixedEndpoint: "a", value: "5000" });
    editor.submit();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(history.past.length).toBe(0);
    expect(editor.isOpen).toBe(true);
    expect(editor.rawValue).toBe("5000");
  });

  it("room-sync diagnostic: 1 command call, 1 checkpoint, editor closes", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const throwingRoomSyncFn = vi.fn(() => { throw new Error("controlled room-engine failure"); });
    const { dispatcher, history, setRuntimeDiagnostic } = makeHarness(plan, { roomSyncFn: throwingRoomSyncFn });
    const editor = makeEditorHarness(dispatcher);
    editor.open({ wallId: "w1", fixedEndpoint: "a", value: "5000" });
    editor.submit();
    expect(history.past.length).toBe(1);
    expect(editor.isOpen).toBe(false);
    expect(setRuntimeDiagnostic).toHaveBeenCalled();
  });

  it("Escape: 0 command calls, 0 checkpoints, editor closes, raw discarded, selection unchanged", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const { dispatcher, history, setSelection } = makeHarness(plan);
    const spy = vi.fn(dispatcher);
    const editor = makeEditorHarness(spy);
    editor.open({ wallId: "w1", fixedEndpoint: "a", value: "5000" });
    editor.escape();
    expect(spy).not.toHaveBeenCalled();
    expect(history.past.length).toBe(0);
    expect(editor.isOpen).toBe(false);
    expect(editor.rawValue).toBeNull();
    expect(setSelection).not.toHaveBeenCalled();
  });

  it("Escape invalidates the session: a trailing blur after Escape cannot submit", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const { dispatcher, history } = makeHarness(plan);
    const spy = vi.fn(dispatcher);
    const editor = makeEditorHarness(spy);
    editor.open({ wallId: "w1", fixedEndpoint: "a", value: "5000" });
    editor.escape();
    editor.submit(); // trailing blur after Escape — entry is already null, must be a no-op
    expect(spy).not.toHaveBeenCalled();
    expect(history.past.length).toBe(0);
  });

  it("anchor toggle: 0 command calls, editor stays open, raw preserved, subsequent submit uses the new anchor", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const { dispatcher, history } = makeHarness(plan);
    const spy = vi.fn(dispatcher);
    const editor = makeEditorHarness(spy);
    editor.open({ wallId: "w1", fixedEndpoint: "a", value: "5000" });
    editor.toggleAnchor("b");
    expect(spy).not.toHaveBeenCalled();
    expect(history.past.length).toBe(0);
    expect(editor.isOpen).toBe(true);
    expect(editor.rawValue).toBe("5000");
    expect(editor.fixedEndpoint).toBe("b");

    editor.submit();
    expect(spy).toHaveBeenCalledWith({ type: "wall.setLength", wallId: "w1", lengthMm: 5000, fixedEndpoint: "b" });
    expect(history.current.nodes.na).toEqual({ x: -1000, y: 0 }); // b fixed, a moves
  });

  it("opening the editor alone (no submit) never calls the command, regardless of default anchor", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const { dispatcher, history } = makeHarness(plan);
    const spy = vi.fn(dispatcher);
    const editor = makeEditorHarness(spy);
    editor.open({ wallId: "w1", fixedEndpoint: "a", value: "4000" }); // e.g. shared-A default
    expect(spy).not.toHaveBeenCalled();
    expect(history.past.length).toBe(0);
    expect(editor.isOpen).toBe(true);
    expect(editor.rawValue).toBe("4000");
  });
});
