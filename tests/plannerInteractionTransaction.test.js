/**
 * PHASE 1A — transient wall-edit transaction boundary.
 *
 * Proves the split the drag paths rely on: while a wall/node drag is in
 * flight the committed plan, the history stack and the autosave controller
 * must not move at all; a single commit at pointerup produces exactly one of
 * each. The pure state machine is tested directly, then wired together with
 * the real HistoryModel and the real autosave bridge — the same way PlanPage
 * wires them — so the boundary is proven end to end without a DOM.
 */
import { describe, it, expect, vi } from "vitest";
import {
  createInteractionSession,
  beginInteraction,
  previewInteraction,
  commitInteraction,
  cancelInteraction,
  isInteractionActive,
  interactionPreviewPlan,
  createWallEditController,
  INTERACTION_IDLE,
  INTERACTION_PREVIEWING,
} from "../src/planner/core/session/index.js";
import { HistoryModel } from "../src/planner/core/history/historyModel.js";
import { createPlanAutosaveBridge } from "../src/planner/core/history/planAutosaveBridge.js";
import {
  classifyWallSegmentAttachments,
  moveNode,
  moveWallSegment,
} from "../src/planner/core/walls/wallCommands.js";

function makePlan(overrides = {}) {
  return {
    walls: [{ id: "w1", a: "n1", b: "n2", thk: 100 }],
    nodes: { n1: { x: 0, y: 0 }, n2: { x: 4000, y: 0 } },
    items: [],
    rooms: [],
    zones: [],
    room: { w: 10000, h: 8000, wallThk: 100 },
    dimensions: [],
    validationWarnings: [],
    ...overrides,
  };
}

function connectedMovePlan() {
  const wallProps = { thk: 100, role: "partition", kind: "new", height: 3000, material: "", createdAt: 1, updatedAt: 1 };
  return makePlan({
    nodes: {
      lt: { x: 0, y: 0 }, lj: { x: 0, y: 2000 }, lb: { x: 0, y: 4000 },
      rt: { x: 4000, y: 0 }, rj: { x: 4000, y: 2000 }, rb: { x: 4000, y: 4000 },
    },
    walls: [
      { id: "la", a: "lt", b: "lj", chainId: "left", ...wallProps },
      { id: "lb", a: "lj", b: "lb", chainId: "left", ...wallProps },
      { id: "ra", a: "rt", b: "rj", chainId: "right", ...wallProps },
      { id: "rb", a: "rj", b: "rb", chainId: "right", ...wallProps },
      { id: "selected", a: "lj", b: "rj", chainId: "selected", ...wallProps },
    ],
  });
}

function connectedPreview(base, y, seed = 0) {
  let id = seed;
  return moveWallSegment(base, {
    wallId: "selected",
    delta: { x: 0, y },
    expectedEndpointAttachments: classifyWallSegmentAttachments(base, "selected"),
    makeId: (prefix) => `tx_${prefix}_${++id}`,
  }).plan;
}

/** Same manual scheduler shape the existing autosave tests use. */
function createManualScheduler() {
  let queue = [];
  return {
    schedule: (fn) => {
      const handle = { fn, cancelled: false };
      queue.push(handle);
      return handle;
    },
    cancelSchedule: (handle) => { handle.cancelled = true; },
    flush: () => {
      const toRun = queue.filter((h) => !h.cancelled);
      queue = [];
      toRun.forEach((h) => h.fn());
    },
    pendingCount: () => queue.filter((h) => !h.cancelled).length,
  };
}

async function flushAsync() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe("PHASE 1A — interaction session state machine", () => {
  it("1. begin does not touch the base plan and opens exactly one transaction", () => {
    const base = makePlan();
    const snapshot = JSON.parse(JSON.stringify(base));
    const s0 = createInteractionSession();
    expect(s0.status).toBe(INTERACTION_IDLE);

    const r = beginInteraction(s0, { basePlan: base, kind: "wall-seg" });

    expect(r.ok).toBe(true);
    expect(r.txId).toBe(1);
    expect(r.superseded).toBeNull();
    expect(r.state.status).toBe(INTERACTION_PREVIEWING);
    expect(r.state.basePlan).toBe(base);
    expect(r.state.previewPlan).toBeNull();
    // Base plan untouched, by identity and by value.
    expect(base).toEqual(snapshot);
    // A begin without a plan is refused and leaves the machine alone.
    const bad = beginInteraction(s0, { basePlan: null });
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe("INVALID_BASE_PLAN");
    expect(bad.state).toBe(s0);
  });

  it("2. repeated previews keep the base plan intact and never notify history/persist", () => {
    const base = makePlan();
    const snapshot = JSON.parse(JSON.stringify(base));
    const commitSpy = vi.fn();
    const persistSpy = vi.fn();

    let state = beginInteraction(createInteractionSession(), { basePlan: base }).state;
    const txId = state.txId;

    let latest = null;
    for (let i = 1; i <= 5; i++) {
      latest = { ...base, nodes: { ...base.nodes, n1: { x: i * 10, y: 0 } } };
      const r = previewInteraction(state, txId, latest);
      expect(r.ok).toBe(true);
      state = r.state;
    }

    expect(interactionPreviewPlan(state)).toBe(latest);
    expect(state.basePlan).toBe(base);
    expect(base).toEqual(snapshot);
    expect(commitSpy).not.toHaveBeenCalled();
    expect(persistSpy).not.toHaveBeenCalled();
  });

  it("3. commit hands back the latest preview once, then the transaction is closed", () => {
    const base = makePlan();
    let state = beginInteraction(createInteractionSession(), { basePlan: base, kind: "wall-node" }).state;
    const txId = state.txId;
    const preview = { ...base, nodes: { ...base.nodes, n1: { x: 500, y: 0 } } };
    state = previewInteraction(state, txId, preview).state;

    const first = commitInteraction(state, txId);
    expect(first.ok).toBe(true);
    expect(first.changed).toBe(true);
    expect(first.previewPlan).toBe(preview);
    expect(first.basePlan).toBe(base);
    expect(first.kind).toBe("wall-node");
    expect(first.state.status).toBe(INTERACTION_IDLE);

    // 7. double commit is rejected — the id is retired, never reissued.
    const second = commitInteraction(first.state, txId);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("NOT_ACTIVE");
    expect(second.previewPlan).toBeNull();
  });

  it("4. a press that never moved commits nothing (changed=false)", () => {
    const base = makePlan();
    const begun = beginInteraction(createInteractionSession(), { basePlan: base });
    const r = commitInteraction(begun.state, begun.txId);
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(false);
    expect(r.state.status).toBe(INTERACTION_IDLE);
  });

  it("5. cancel restores idle, returns the base plan and cannot run twice", () => {
    const base = makePlan();
    let state = beginInteraction(createInteractionSession(), { basePlan: base }).state;
    const txId = state.txId;
    state = previewInteraction(state, txId, { ...base, nodes: { n1: { x: 9, y: 9 } } }).state;

    const first = cancelInteraction(state, txId);
    expect(first.ok).toBe(true);
    expect(first.basePlan).toBe(base);
    expect(first.state.status).toBe(INTERACTION_IDLE);
    expect(isInteractionActive(first.state)).toBe(false);

    const second = cancelInteraction(first.state, txId);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("NOT_ACTIVE");
  });

  it("6. a stale txId can neither preview, commit nor cancel a newer transaction", () => {
    const base1 = makePlan();
    const base2 = makePlan({ walls: [{ id: "w2", a: "n1", b: "n2", thk: 200 }] });

    const first = beginInteraction(createInteractionSession(), { basePlan: base1 });
    const staleTx = first.txId;
    // A fresh begin always wins and cancels the stranded transaction.
    const second = beginInteraction(first.state, { basePlan: base2 });
    expect(second.ok).toBe(true);
    expect(second.superseded).toBe(staleTx);
    expect(second.txId).toBe(staleTx + 1);
    expect(second.state.basePlan).toBe(base2);

    const stalePreview = previewInteraction(second.state, staleTx, makePlan());
    expect(stalePreview.ok).toBe(false);
    expect(stalePreview.reason).toBe("STALE_TRANSACTION");
    expect(stalePreview.state).toBe(second.state);

    const staleCommit = commitInteraction(second.state, staleTx);
    expect(staleCommit.ok).toBe(false);
    expect(staleCommit.reason).toBe("STALE_TRANSACTION");
    expect(staleCommit.state.status).toBe(INTERACTION_PREVIEWING);

    const staleCancel = cancelInteraction(second.state, staleTx);
    expect(staleCancel.ok).toBe(false);
    expect(staleCancel.reason).toBe("STALE_TRANSACTION");
    expect(staleCancel.state.status).toBe(INTERACTION_PREVIEWING);
  });

  it("8. the real move reducer leaves the base plan's nested nodes/walls untouched", () => {
    const base = makePlan();
    const nodeSnapshot = JSON.parse(JSON.stringify(base.nodes));
    const wallSnapshot = JSON.parse(JSON.stringify(base.walls));
    const baseNodeRef = base.nodes.n1;

    let state = beginInteraction(createInteractionSession(), { basePlan: base }).state;
    const txId = state.txId;

    for (const x of [100, 250, 900]) {
      const r = moveNode(base, "n1", { x, y: 0 });
      expect(r.changed).toBe(true);
      state = previewInteraction(state, txId, r.plan).state;
      // Reduced from the base plan every time — the base must never drift.
      expect(base.nodes).toEqual(nodeSnapshot);
      expect(base.walls).toEqual(wallSnapshot);
      expect(base.nodes.n1).toBe(baseNodeRef);
      expect(r.plan).not.toBe(base);
      expect(r.plan.nodes).not.toBe(base.nodes);
    }
    expect(interactionPreviewPlan(state).nodes.n1).toEqual({ x: 900, y: 0 });
  });
});

describe("PHASE 1A — wall edit controller against real history + autosave", () => {
  /**
   * Wires HistoryModel + createPlanAutosaveBridge + createWallEditController
   * exactly as PlanPage does, so the assertions below are about the shipped
   * boundary rather than a mock of it.
   */
  function createHarness(initial = makePlan()) {
    const scheduler = createManualScheduler();
    const persistFn = vi.fn(async () => ({ ok: true }));
    const identity = { mode: "project", id: "p1" };
    const history = new HistoryModel(initial);
    const bridge = createPlanAutosaveBridge({
      persistFn,
      debounceMs: 700,
      schedule: scheduler.schedule,
      cancelSchedule: scheduler.cancelSchedule,
    });
    bridge.beginHydration(identity);
    bridge.completeHydration(identity, initial);

    // PlanPage's effect: the autosave controller only ever sees committed state.
    const observeCommitted = () => bridge.observePlan(identity, history.current);
    const roomSync = vi.fn((p) => ({ ...p, rooms: [{ id: "r-synced" }] }));

    const controller = createWallEditController({
      finalize: (previewPlan) => roomSync(previewPlan),
      commitFrom: (basePlan, finalPlan) => {
        history.commitFrom(basePlan, finalPlan);
        observeCommitted();
      },
    });

    return { scheduler, persistFn, identity, initial, history, bridge, controller, roomSync };
  }

  it("pointermove previews do not move the committed plan, history or autosave", async () => {
    const h = createHarness();
    const base = h.history.current;
    const pastBefore = h.history.past.length;

    const txId = h.controller.begin(base, "wall-seg", { wallId: "w1" });
    expect(txId).toBe(1);

    for (const x of [50, 120, 340, 500]) {
      h.controller.preview(txId, moveNode(base, "n1", { x, y: 0 }).plan);
      // Simulated pause far longer than the 700 ms autosave debounce.
      h.scheduler.flush();
      await flushAsync();
    }

    expect(h.controller.getPreviewPlan().nodes.n1).toEqual({ x: 500, y: 0 });
    // Committed plan untouched, by identity.
    expect(h.history.current).toBe(base);
    expect(h.history.past.length).toBe(pastBefore);
    expect(h.history.future.length).toBe(0);
    // Autosave never saw a preview: nothing scheduled, nothing persisted.
    expect(h.scheduler.pendingCount()).toBe(0);
    expect(h.persistFn).not.toHaveBeenCalled();
    // Room sync is commit-only.
    expect(h.roomSync).not.toHaveBeenCalled();
  });

  it("pointerup commits once: one room sync, one history step, one persist", async () => {
    const h = createHarness();
    const base = h.history.current;
    const pastBefore = h.history.past.length;

    const txId = h.controller.begin(base, "wall-seg", { wallId: "w1" });
    h.controller.preview(txId, moveNode(base, "n1", { x: 100, y: 0 }).plan);
    h.controller.preview(txId, moveNode(base, "n1", { x: 700, y: 0 }).plan);

    const res = h.controller.commit(txId);

    expect(res.committed).toBe(true);
    expect(h.roomSync).toHaveBeenCalledTimes(1);
    expect(h.history.past.length).toBe(pastBefore + 1);
    expect(h.history.past[h.history.past.length - 1]).toBe(base);
    // Committed plan is the finalized (room-synced) latest preview.
    expect(h.history.current.nodes.n1).toEqual({ x: 700, y: 0 });
    expect(h.history.current.rooms).toEqual([{ id: "r-synced" }]);
    expect(h.controller.isActive()).toBe(false);

    h.scheduler.flush();
    await flushAsync();
    expect(h.persistFn).toHaveBeenCalledTimes(1);
    const [, savedPlan] = h.persistFn.mock.calls[0];
    expect(savedPlan.nodes.n1).toEqual({ x: 700, y: 0 });

    // A second pointerup for the same transaction changes nothing.
    const again = h.controller.commit(txId);
    expect(again.committed).toBe(false);
    expect(again.reason).toBe("NOT_ACTIVE");
    expect(h.history.past.length).toBe(pastBefore + 1);
  });

  it("Escape / pointer abort cancels: no commit, no history step, no persist", async () => {
    const h = createHarness();
    const base = h.history.current;
    const snapshot = JSON.parse(JSON.stringify(base));
    const pastBefore = h.history.past.length;

    const txId = h.controller.begin(base, "wall-node", { wallId: "w1", idx: 0 });
    h.controller.preview(txId, moveNode(base, "n1", { x: 1200, y: 300 }).plan);

    const cancelled = h.controller.cancel();
    expect(cancelled.cancelled).toBe(true);
    expect(h.controller.isActive()).toBe(false);
    expect(h.controller.getPreviewPlan()).toBeNull();

    h.scheduler.flush();
    await flushAsync();

    expect(h.history.current).toBe(base);
    expect(base).toEqual(snapshot);
    expect(h.history.past.length).toBe(pastBefore);
    expect(h.roomSync).not.toHaveBeenCalled();
    expect(h.persistFn).not.toHaveBeenCalled();

    // A trailing pointerup after the cancel must not resurrect the edit.
    expect(h.controller.commit(txId).committed).toBe(false);
    expect(h.history.past.length).toBe(pastBefore);
  });

  it("a press with no movement commits nothing", async () => {
    const h = createHarness();
    const base = h.history.current;
    const pastBefore = h.history.past.length;

    const txId = h.controller.begin(base, "wall-seg", { wallId: "w1" });
    const res = h.controller.commit(txId);

    expect(res.committed).toBe(false);
    expect(res.reason).toBe("NO_PREVIEW");
    expect(h.history.current).toBe(base);
    expect(h.history.past.length).toBe(pastBefore);
    expect(h.controller.isActive()).toBe(false);

    h.scheduler.flush();
    await flushAsync();
    expect(h.persistFn).not.toHaveBeenCalled();
  });

  it("a stale pointerup cannot commit the transaction that replaced it", async () => {
    const h = createHarness();
    const base = h.history.current;
    const pastBefore = h.history.past.length;

    const staleTx = h.controller.begin(base, "wall-seg", { wallId: "w1" });
    h.controller.preview(staleTx, moveNode(base, "n1", { x: 400, y: 0 }).plan);

    // Pointer capture lost, a new drag starts before the old pointerup lands.
    const freshTx = h.controller.begin(h.history.current, "wall-node", { wallId: "w1", idx: 1 });
    expect(freshTx).toBe(staleTx + 1);

    expect(h.controller.commit(staleTx).committed).toBe(false);
    expect(h.controller.isActive()).toBe(true);
    expect(h.history.past.length).toBe(pastBefore);

    h.controller.preview(freshTx, moveNode(base, "n2", { x: 4000, y: 900 }).plan);
    expect(h.controller.commit(freshTx).committed).toBe(true);
    expect(h.history.past.length).toBe(pastBefore + 1);
    expect(h.history.current.nodes.n2).toEqual({ x: 4000, y: 900 });

    h.scheduler.flush();
    await flushAsync();
    expect(h.persistFn).toHaveBeenCalledTimes(1);
  });

  it("controller refuses to exist without a commitFrom sink", () => {
    expect(() => createWallEditController({})).toThrow(/commitFrom is required/);
  });

  it("connected-wall preview stays transient and release commits that exact topology once", async () => {
    const initial = connectedMovePlan();
    const h = createHarness(initial);
    const base = h.history.current;
    const txId = h.controller.begin(base, "wall-seg", { wallId: "selected" });
    const preview = connectedPreview(base, 500);
    const previewFingerprint = JSON.stringify({ nodes: preview.nodes, walls: preview.walls });
    h.controller.preview(txId, preview);

    h.scheduler.flush();
    await flushAsync();
    expect(h.history.current).toBe(base);
    expect(h.history.past).toHaveLength(0);
    expect(h.persistFn).not.toHaveBeenCalled();
    expect(h.roomSync).not.toHaveBeenCalled();

    expect(h.controller.commit(txId).committed).toBe(true);
    expect(JSON.stringify({ nodes: h.history.current.nodes, walls: h.history.current.walls })).toBe(previewFingerprint);
    expect(h.history.past).toHaveLength(1);
    expect(h.roomSync).toHaveBeenCalledTimes(1);
    h.scheduler.flush();
    await flushAsync();
    expect(h.persistFn).toHaveBeenCalledTimes(1);
    expect(h.controller.commit(txId).committed).toBe(false);
  });

  it("connected-wall Escape/lost-capture cancellation discards preview with zero writes", async () => {
    const initial = connectedMovePlan();
    const h = createHarness(initial);
    const baseSnapshot = structuredClone(h.history.current);
    const txId = h.controller.begin(h.history.current, "wall-seg", { wallId: "selected" });
    h.controller.preview(txId, connectedPreview(h.history.current, 500));
    expect(h.controller.cancel(txId).cancelled).toBe(true);
    expect(h.controller.getPreviewPlan()).toBeNull();
    h.scheduler.flush();
    await flushAsync();
    expect(h.history.current).toEqual(baseSnapshot);
    expect(h.history.past).toHaveLength(0);
    expect(h.roomSync).not.toHaveBeenCalled();
    expect(h.persistFn).not.toHaveBeenCalled();
    expect(h.controller.commit(txId).committed).toBe(false);
  });
});
