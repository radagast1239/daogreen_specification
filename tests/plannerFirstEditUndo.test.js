/**
 * PHASE 2E.1 (A) — the FIRST real user edit after loading a plan is undoable.
 *
 * Reported: load a plan, select a wall, press ArrowRight once — the wall moves,
 * Ctrl+Z does nothing.
 *
 * Cause (traced, not guessed — see C:\tmp\phase2e1-history-grips\history-diagnosis.txt):
 * HistoryModel.reset() (plan load) and commitFrom() (every wall transaction)
 * armed a process-wide `skipNext` boolean so that "the derived-state sync which
 * follows" would not become its own undo step. Only mutate() ever consumed it —
 * but EVERY derived sync in PlanPage runs through replace(), which does not. The
 * arming was therefore always dangling, and the call that consumed it was
 * invariably the user's next real command, whose checkpoint was silently lost.
 * undo()/redo() armed it too, so the first edit after an Undo was lost as well.
 *
 * These are BEHAVIOURAL tests: they drive the shipped HistoryModel through the
 * shipped mutation pipeline (the real wall commands, the real autosave bridge,
 * the real wall-edit transaction controller) in the same order PlanPage does —
 * load -> derived sync -> first user gesture -> Ctrl+Z.
 */
import { describe, it, expect, vi } from "vitest";
import {
  PlanHistoryStack,
  MUTATION_ORIGIN,
  MAX_HISTORY,
  createPlanAutosaveBridge,
} from "../src/planner/core/history/index.js";
import { createWallEditController } from "../src/planner/core/session/index.js";
import {
  moveNode,
  moveWallSegment,
  addWall,
  deleteWall,
  classifyWallSegmentAttachments,
} from "../src/planner/core/walls/wallCommands.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";
import { syncRoomsSafe } from "../src/planner/core/rooms/index.js";

/**
 * PlanPage.jsx:929 syncAutoZones, minus the React diagnostic setState — the
 * deterministic derived-state reconciliation that runs after every load and
 * every wall commit, and that the old skipNext flag was supposedly armed for.
 */
function syncAutoZones(p) {
  const safe = syncRoomsSafe({ ...p, walls: resolvePlanWalls(p) });
  if (!safe.ok) return p;
  const keep = (p.validationWarnings || []).filter((w) => w.source === "dimensions" || w.source === "wall-command");
  return {
    ...p,
    rooms: safe.rooms,
    zones: safe.zones,
    validationWarnings: [...keep, ...(safe.validationWarnings || [])],
  };
}

let seq = 0;
const makeId = (p = "id") => `${p}_${++seq}`;
const WBASE = { thk: 100, role: "partition", kind: "new", thicknessSide: "center", height: 3000, material: "", type: "wall" };

/**
 * A stored plan as it comes back from the API: already room-synced, because it
 * was saved after a sync. The reconciliation that follows hydration therefore
 * finds nothing to change — which is why hydration must produce no write.
 */
function loadedPlan() {
  return syncAutoZones(rawPlan());
}

/** Two rooms' worth of walls, a corner, an ordinary T and a free wall. */
function rawPlan() {
  return {
    nodes: {
      n1: { x: 0, y: 0 }, n2: { x: 6000, y: 0 }, n3: { x: 6000, y: 4000 }, n4: { x: 0, y: 4000 },
      t: { x: 3000, y: 4000 }, tb: { x: 3000, y: 8000 },
      f1: { x: 9000, y: 1000 }, f2: { x: 13000, y: 1000 },
    },
    walls: [
      { id: "w_top", a: "n1", b: "n2", role: "outer" },
      { id: "w_right", a: "n2", b: "n3", role: "outer" },
      { id: "w_botL", a: "n3", b: "t", role: "outer" },
      { id: "w_botR", a: "t", b: "n4", role: "outer" },
      { id: "w_left", a: "n4", b: "n1", role: "outer" },
      { id: "w_branch", a: "t", b: "tb" },
      { id: "w_free", a: "f1", b: "f2" },
    ].map((w) => ({ ...WBASE, ...w })),
    items: [], rooms: [], zones: [], links: [], labels: [], lines: [],
    dimensions: [], structurals: [], rulers: [], validationWarnings: [],
    room: { w: 20000, h: 12000, wallThk: 100, height: 3000, showBoundary: true },
  };
}

/** Geometry + wall properties — ids are minted per command, coordinates are not. */
const fingerprint = (plan) => resolvePlanWalls(plan)
  .map((w) => `${w.id}@${w.thk}:${w.pts.map((p) => `${Math.round(p.x)},${Math.round(p.y)}`).join("|")}`)
  .sort().join(" ");

const applyCmd = (base, result) => (result?.changed ? result.plan : base);

/**
 * The PlanPage pipeline, minus React: one history stack, the real autosave
 * bridge, the real wall-edit transaction controller.
 */
function harness({ plan = loadedPlan() } = {}) {
  const writes = [];
  const timers = [];
  const bridge = createPlanAutosaveBridge({
    persistFn: async (identity, saved) => { writes.push({ identity, saved }); },
    debounceMs: 0,
    schedule: (fn) => { timers.push(fn); return timers.length - 1; },
    cancelSchedule: (h) => { if (h != null) timers[h] = null; },
  });
  const identity = { mode: "project", id: "p1" };
  const history = new PlanHistoryStack(null);

  const h = {
    history,
    bridge,
    identity,
    writes: () => writes.length,
    /** Fire the debounce timers, then let the controller's promise chain run. */
    flushAutosave: async () => {
      timers.splice(0).forEach((fn) => fn?.());
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
    steps: () => history.past.length,
    fingerprint: () => fingerprint(history.current),

    /** PlanPage.jsx:579 effect — load + hydration, then the derived sync. */
    load(next = plan, { derivedSync = true } = {}) {
      bridge.beginHydration(identity);
      history.reset(next);
      bridge.completeHydration(identity, next);
      if (derivedSync) h.derivedSync();
      bridge.observePlan(identity, history.current);
      return h;
    },
    /** PlanPage.jsx:636 effect — rooms/zones reconciliation. Never a step. */
    derivedSync() {
      history.mutate((p) => syncAutoZones(p), { origin: MUTATION_ORIGIN.DERIVED_SYNC });
      return h;
    },
    /** setPlan — the plain user-command path. */
    user(updater) {
      history.setPlan(updater);
      bridge.observePlan(identity, history.current);
      return h;
    },
    /** commitPlan — an explicit user checkpoint. */
    commit(updater) {
      history.commit(updater);
      bridge.observePlan(identity, history.current);
      return h;
    },
    /** A wall-edit transaction: preview -> release -> exactly one commitFrom. */
    transaction(previewFn) {
      const controller = createWallEditController({
        finalize: (previewPlan) => syncAutoZones(previewPlan),
        commitFrom: (base, next) => history.commitFrom(base, next),
      });
      const txId = controller.begin(history.current, "wall-node", {});
      controller.preview(txId, previewFn(history.current));
      controller.commit(txId);
      bridge.observePlan(identity, history.current);
      return h;
    },
    undo() { history.undo(); bridge.observePlan(identity, history.current); return h; },
    redo() { history.redo(); bridge.observePlan(identity, history.current); return h; },
  };
  return h;
}

// --- the six first-gesture shapes the contract names ------------------------

const firstArrowNudge = (p) => {
  const r = moveWallSegment(p, {
    wallId: "w_free",
    delta: { x: 100, y: 0 },
    expectedEndpointAttachments: classifyWallSegmentAttachments(p, "w_free"),
    makeId,
  });
  return applyCmd(p, r);
};
const firstEndpointMove = (p) => applyCmd(p, moveNode(p, "f2", { x: 13500, y: 1200 }));
const firstWallDraw = (p) => applyCmd(p, addWall(p, { x: 9000, y: 6000 }, { x: 13000, y: 6000 }, WBASE, makeId));
const firstDelete = (p) => applyCmd(p, deleteWall(p, "w_free"));
const firstInspectorEdit = (p) => ({
  ...p,
  walls: p.walls.map((w) => (w.id === "w_free" ? { ...w, thk: 200 } : w)),
});

describe("2E.1/A — hydration creates no history and no writes", () => {
  it("1. load/reset creates zero Undo steps", () => {
    const h = harness().load();
    expect(h.steps()).toBe(0);
    expect(h.history.canUndo).toBe(false);
    expect(h.history.canRedo).toBe(false);
  });

  it("2. reset followed by the expected derived sync still creates zero Undo steps", () => {
    const h = harness().load({ derivedSync: true });
    expect(h.steps()).toBe(0);
    // the sync really did run and really did change the plan
    expect(h.history.current).not.toBe(loadedPlan());
    expect(Array.isArray(h.history.current.zones)).toBe(true);
  });

  it("12. repeated derived reconciliations create no duplicate Undo entries", () => {
    const h = harness().load();
    h.derivedSync().derivedSync().derivedSync();
    expect(h.steps()).toBe(0);
    h.user(firstArrowNudge);
    expect(h.steps()).toBe(1);
  });

  it("16. hydration alone causes no autosave write", async () => {
    const h = harness().load();
    await h.flushAutosave();
    expect(h.writes()).toBe(0);
  });
});

describe("2E.1/A — the FIRST user gesture after load is exactly one Undo step", () => {
  const GESTURES = [
    ["3. first arrow-key wall movement", firstArrowNudge, "user"],
    ["8. first wall draw", firstWallDraw, "user"],
    ["10. first inspector property edit", firstInspectorEdit, "user"],
  ];

  for (const [label, gesture] of GESTURES) {
    it(`${label} — one step, and Ctrl+Z restores the loaded plan`, () => {
      const h = harness().load();
      const loaded = h.fingerprint();
      h.user(gesture);
      expect(h.steps(), "exactly one undo entry").toBe(1);
      expect(h.fingerprint(), "the gesture must actually change the plan").not.toBe(loaded);
      h.undo();
      expect(h.fingerprint()).toBe(loaded);
    });
  }

  it("9. first delete (explicit commit, delete + host heal) — one step", () => {
    const h = harness().load();
    const loaded = h.fingerprint();
    h.commit(firstDelete);
    expect(h.steps()).toBe(1);
    expect(h.fingerprint()).not.toBe(loaded);
    h.undo();
    expect(h.fingerprint()).toBe(loaded);
  });

  it("6. first whole-wall mouse drag after load — one step", () => {
    const h = harness().load();
    const loaded = h.fingerprint();
    h.transaction(firstArrowNudge);
    expect(h.steps()).toBe(1);
    h.undo();
    expect(h.fingerprint()).toBe(loaded);
  });

  it("7. first endpoint drag after load — one step", () => {
    const h = harness().load();
    const loaded = h.fingerprint();
    h.transaction(firstEndpointMove);
    expect(h.steps()).toBe(1);
    h.undo();
    expect(h.fingerprint()).toBe(loaded);
  });

  it("3./4./5. arrow edit: undo restores the loaded geometry, redo restores the edit", () => {
    const h = harness().load();
    const loaded = h.fingerprint();
    h.user(firstArrowNudge);
    const edited = h.fingerprint();
    h.undo();
    expect(h.fingerprint()).toBe(loaded);
    h.redo();
    expect(h.fingerprint()).toBe(edited);
  });

  it("the same holds with NO derived sync after load (wall-less plan path)", () => {
    // PlanPage's sync effect returns early when the plan has no drawn walls, so
    // nothing at all follows reset() — the case the old flag could never survive.
    const h = harness().load(loadedPlan(), { derivedSync: false });
    const loaded = h.fingerprint();
    h.user(firstArrowNudge);
    expect(h.steps()).toBe(1);
    h.undo();
    expect(h.fingerprint()).toBe(loaded);
  });
});

describe("2E.1/A — no suppression survives any earlier operation", () => {
  it("11. commitFrom followed by a real user edit: the edit is not swallowed", () => {
    const h = harness().load();
    h.transaction(firstEndpointMove);       // commitFrom
    const afterTx = h.fingerprint();
    h.user(firstArrowNudge);                // a plain user edit right after
    expect(h.steps()).toBe(2);
    h.undo();
    expect(h.fingerprint()).toBe(afterTx);
  });

  it("15. Undo/Redo do not corrupt suppression state", () => {
    const h = harness().load();
    const loaded = h.fingerprint();
    h.user(firstArrowNudge);
    h.undo();
    expect(h.fingerprint()).toBe(loaded);
    // the first edit AFTER an undo used to be swallowed too
    h.user(firstInspectorEdit);
    expect(h.steps()).toBe(1);
    h.undo();
    expect(h.fingerprint()).toBe(loaded);

    h.user(firstArrowNudge);
    h.undo();
    h.redo();
    h.user(firstInspectorEdit);
    expect(h.history.canUndo).toBe(true);
  });

  it("no reachable sequence leaves a pending suppression (exhaustive sweep)", () => {
    const OPS = ["load", "derivedSync", "transaction", "undo", "redo", "commit"];
    for (const a of OPS) {
      for (const b of OPS) {
        const h = harness().load();
        h.user(firstInspectorEdit);                // give undo/redo something to do
        for (const op of [a, b]) {
          if (op === "load") h.load();
          else if (op === "derivedSync") h.derivedSync();
          else if (op === "transaction") h.transaction(firstEndpointMove);
          else if (op === "undo") h.undo();
          else if (op === "redo") h.redo();
          else if (op === "commit") h.commit(firstInspectorEdit);
        }
        const before = h.steps();
        const beforePlan = h.fingerprint();
        h.user(firstArrowNudge);
        expect(h.steps(), `[${a}, ${b}] swallowed the next user edit`).toBe(before + 1);
        h.undo();
        expect(h.fingerprint(), `[${a}, ${b}] undo did not restore`).toBe(beforePlan);
      }
    }
  });
});

describe("2E.1/A — resets and identity switches stay safe", () => {
  it("13. switching project resets history safely", () => {
    const h = harness().load();
    h.user(firstArrowNudge);
    expect(h.steps()).toBe(1);
    const other = { ...loadedPlan(), room: { ...loadedPlan().room, w: 30000 } };
    h.identity.id = "p2";
    h.load(other);
    expect(h.steps()).toBe(0);
    expect(h.history.canUndo).toBe(false);
    expect(h.history.canRedo).toBe(false);
    h.user(firstArrowNudge);
    expect(h.steps()).toBe(1);
  });

  it("14. reload resets history safely and the first edit is still undoable", () => {
    const h = harness().load();
    h.user(firstArrowNudge);
    h.load();                                 // F5
    const loaded = h.fingerprint();
    expect(h.steps()).toBe(0);
    h.user(firstArrowNudge);
    expect(h.steps()).toBe(1);
    h.undo();
    expect(h.fingerprint()).toBe(loaded);
  });
});

describe("2E.1/A — history hygiene is unchanged", () => {
  it("17. a failed / no-op user command creates no history entry", () => {
    const h = harness().load();
    h.user((p) => p);                                     // identity update
    expect(h.steps()).toBe(0);
    // a genuinely refused command: moveNode on a node that does not exist
    h.user((p) => applyCmd(p, moveNode(p, "no_such_node", { x: 1, y: 1 })));
    expect(h.steps()).toBe(0);
    expect(h.history.canUndo).toBe(false);
  });

  it("18. one user gesture creates exactly one history entry", () => {
    const h = harness().load();
    // a drag: many previews, one release
    const controller = createWallEditController({
      finalize: (previewPlan) => syncAutoZones(previewPlan),
      commitFrom: (base, next) => h.history.commitFrom(base, next),
    });
    const txId = controller.begin(h.history.current, "wall-node", {});
    for (let i = 1; i <= 8; i++) {
      controller.preview(txId, applyCmd(h.history.current, moveNode(h.history.current, "f2", { x: 13000 + i * 40, y: 1000 })));
    }
    expect(h.steps(), "the hold must not touch history").toBe(0);
    controller.commit(txId);
    expect(h.steps()).toBe(1);
  });

  it("19. history capacity and order are unchanged", () => {
    const h = harness().load();
    for (let i = 1; i <= MAX_HISTORY + 12; i++) {
      h.user((p) => ({ ...p, room: { ...p.room, height: 3000 + i } }));
    }
    expect(h.history.past.length).toBe(MAX_HISTORY);
    // LIFO order preserved
    h.undo();
    expect(h.history.current.room.height).toBe(3000 + MAX_HISTORY + 11);
    h.undo();
    expect(h.history.current.room.height).toBe(3000 + MAX_HISTORY + 10);
  });

  it("20. input plans remain immutable across the whole flow", () => {
    const input = loadedPlan();
    const snapshot = JSON.stringify(input);
    const h = harness().load(input);
    h.user(firstArrowNudge);
    h.transaction(firstEndpointMove);
    h.commit(firstDelete);
    h.undo();
    h.redo();
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("16. autosave writes are driven by the plan, never by history bookkeeping", async () => {
    const h = harness().load();
    await h.flushAutosave();
    expect(h.writes()).toBe(0);
    h.user(firstArrowNudge);
    await h.flushAutosave();
    expect(h.writes()).toBe(1);
    expect(h.steps(), "the write itself must not add a history entry").toBe(1);
  });
});

describe("2E.1/A — the suppression flag is gone, not merely re-tuned", () => {
  it("HistoryModel exposes no retained skip flag", () => {
    const stack = new PlanHistoryStack({ v: 0 });
    stack.reset({ v: 1 });
    expect(stack.skipNext).toBeUndefined();
    expect(Object.keys(stack)).toEqual(["current", "past", "future"]);
  });

  it("origin is an argument of one call and cannot leak to the next", () => {
    const stack = new PlanHistoryStack({ v: 0 });
    stack.mutate({ v: 1 }, { origin: MUTATION_ORIGIN.HYDRATION });
    expect(stack.canUndo).toBe(false);
    stack.mutate({ v: 2 });                     // default origin = user command
    expect(stack.canUndo).toBe(true);
    stack.undo();
    expect(stack.current.v).toBe(1);
  });

  it("the derived-sync origin never records, however many times it runs", () => {
    const stack = new PlanHistoryStack({ v: 0 });
    const spy = vi.fn((p) => ({ ...p, derived: (p.derived || 0) + 1 }));
    for (let i = 0; i < 5; i++) stack.mutate(spy, { origin: MUTATION_ORIGIN.DERIVED_SYNC });
    expect(spy).toHaveBeenCalledTimes(5);
    expect(stack.current.derived).toBe(5);
    expect(stack.canUndo).toBe(false);
  });
});
