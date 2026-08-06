/**
 * PHASE 2A — single-wall drag-release drawing session (B+ V2 path).
 *
 * The pure state machine is tested directly, then the pointer controller is
 * wired to the real HistoryModel and the real autosave bridge — the same way
 * PlanPage wires them — so "preview touches nothing, release commits once" is
 * proven against the shipped collaborators rather than a mock of them.
 */
import { describe, it, expect, vi } from "vitest";
import {
  createWallDrawSession,
  beginWallDraw,
  previewWallDraw,
  commitWallDraw,
  cancelWallDraw,
  isWallDrawActive,
  wallDrawPreview,
  createWallDrawController,
  WALL_DRAW_IDLE,
  WALL_DRAW_DRAWING,
  WALL_DRAW_V2_MIN_LEN_MM,
} from "../src/planner/core/session/index.js";
import { HistoryModel } from "../src/planner/core/history/historyModel.js";
import { createPlanAutosaveBridge } from "../src/planner/core/history/planAutosaveBridge.js";
import { commitDrawnWall } from "../src/planner/core/walls/wallDrawTopology.js";
import { materializeWallCommand } from "../src/planner/core/walls/applyWallCommand.js";
import { syncRoomsSafe } from "../src/planner/core/rooms/syncRooms.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";

const P = (x, y) => ({ x, y });

function emptyPlan() {
  return {
    walls: [],
    nodes: {},
    items: [],
    rooms: [],
    zones: [],
    room: { w: 12000, h: 9000, wallThk: 100, height: 3000 },
    dimensions: [],
    validationWarnings: [],
  };
}

function createManualScheduler() {
  let queue = [];
  return {
    schedule: (fn) => { const h = { fn, cancelled: false }; queue.push(h); return h; },
    cancelSchedule: (h) => { h.cancelled = true; },
    flush: () => { const run = queue.filter((h) => !h.cancelled); queue = []; run.forEach((h) => h.fn()); },
    pendingCount: () => queue.filter((h) => !h.cancelled).length,
  };
}
const flushAsync = async () => {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
};

describe("PHASE 2A — wall draw session state machine", () => {
  it("1. begin enters drawing and seeds start == current", () => {
    const s0 = createWallDrawSession();
    expect(s0.status).toBe(WALL_DRAW_IDLE);

    const r = beginWallDraw(s0, { point: P(1000, 2000), snap: { kind: "grid" }, pointerId: 7, now: 111 });
    expect(r.ok).toBe(true);
    expect(r.txId).toBe(1);
    expect(r.superseded).toBeNull();
    expect(r.state.status).toBe(WALL_DRAW_DRAWING);
    expect(r.state.startPoint).toEqual(P(1000, 2000));
    expect(r.state.currentPoint).toEqual(P(1000, 2000));
    expect(r.state.pointerId).toBe(7);
    expect(r.state.startedAt).toBe(111);
    expect(r.state.moved).toBe(false);
    // No plan is reachable from the session at all.
    expect(Object.keys(r.state)).not.toContain("plan");
    expect(beginWallDraw(s0, { point: null }).ok).toBe(false);
  });

  it("2. preview moves only the endpoint; start is never rewritten", () => {
    let st = beginWallDraw(createWallDrawSession(), { point: P(0, 0), pointerId: 1 }).state;
    const tx = st.txId;
    for (const x of [10, 40, 900, 3000]) {
      const r = previewWallDraw(st, tx, { point: P(x, 0), pointerId: 1 });
      expect(r.ok).toBe(true);
      st = r.state;
      expect(st.startPoint).toEqual(P(0, 0));
    }
    expect(st.currentPoint).toEqual(P(3000, 0));
    expect(wallDrawPreview(st)).toMatchObject({ start: P(0, 0), end: P(3000, 0), lengthMm: 3000, moved: true });
    // A foreign pointer cannot steer this gesture.
    const foreign = previewWallDraw(st, tx, { point: P(-500, -500), pointerId: 99 });
    expect(foreign.ok).toBe(false);
    expect(foreign.reason).toBe("FOREIGN_POINTER");
  });

  it("3. commit returns exactly one segment, 4. a second commit is refused", () => {
    let st = beginWallDraw(createWallDrawSession(), { point: P(0, 0) }).state;
    const tx = st.txId;
    st = previewWallDraw(st, tx, { point: P(4000, 0) }).state;

    const first = commitWallDraw(st, tx);
    expect(first.ok).toBe(true);
    expect(first.segment).toMatchObject({ start: P(0, 0), end: P(4000, 0) });
    expect(first.state.status).toBe(WALL_DRAW_IDLE);

    const second = commitWallDraw(first.state, tx);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("NOT_ACTIVE");
    expect(second.segment).toBeNull();
  });

  it("5. cancel closes the gesture and yields no segment", () => {
    let st = beginWallDraw(createWallDrawSession(), { point: P(0, 0) }).state;
    const tx = st.txId;
    st = previewWallDraw(st, tx, { point: P(5000, 0) }).state;

    const c = cancelWallDraw(st, tx);
    expect(c.ok).toBe(true);
    expect(c.state.status).toBe(WALL_DRAW_IDLE);
    expect(isWallDrawActive(c.state)).toBe(false);
    expect(wallDrawPreview(c.state)).toBeNull();
    expect(cancelWallDraw(c.state, tx).ok).toBe(false);
    // Nothing can be committed out of a cancelled gesture.
    expect(commitWallDraw(c.state, tx).segment).toBeNull();
  });

  it("6. a stale txId cannot preview, commit or cancel", () => {
    const first = beginWallDraw(createWallDrawSession(), { point: P(0, 0) });
    const stale = first.txId;
    const second = beginWallDraw(first.state, { point: P(9000, 9000) });
    expect(second.superseded).toBe(stale);

    expect(previewWallDraw(second.state, stale, { point: P(1, 1) }).reason).toBe("STALE_TRANSACTION");
    expect(commitWallDraw(second.state, stale).reason).toBe("STALE_TRANSACTION");
    expect(commitWallDraw(second.state, stale).segment).toBeNull();
    expect(cancelWallDraw(second.state, stale).reason).toBe("STALE_TRANSACTION");
    // The live gesture survived all three stale attempts.
    expect(second.state.status).toBe(WALL_DRAW_DRAWING);
  });

  it("7. a new begin never inherits the previous wall's start point", () => {
    let st = beginWallDraw(createWallDrawSession(), { point: P(0, 0) }).state;
    st = previewWallDraw(st, st.txId, { point: P(4000, 0) }).state;
    const committed = commitWallDraw(st, st.txId);
    expect(committed.segment.end).toEqual(P(4000, 0));

    // Next wall starts somewhere else entirely.
    const next = beginWallDraw(committed.state, { point: P(8000, 8000) });
    expect(next.state.startPoint).toEqual(P(8000, 8000));
    expect(next.state.currentPoint).toEqual(P(8000, 8000));
    expect(next.txId).toBe(committed.state.txId + 1);

    // Even when the previous gesture was never released.
    let open = beginWallDraw(createWallDrawSession(), { point: P(100, 100) }).state;
    open = previewWallDraw(open, open.txId, { point: P(5000, 100) }).state;
    const fresh = beginWallDraw(open, { point: P(-2000, -2000) });
    expect(fresh.state.startPoint).toEqual(P(-2000, -2000));
    expect(fresh.superseded).toBe(open.txId);
  });

  it("8. a press without real movement draws nothing", () => {
    for (const end of [P(0, 0), P(WALL_DRAW_V2_MIN_LEN_MM - 1, 0)]) {
      let st = beginWallDraw(createWallDrawSession(), { point: P(0, 0) }).state;
      const tx = st.txId;
      st = previewWallDraw(st, tx, { point: end }).state;
      const r = commitWallDraw(st, tx);
      expect(r.ok).toBe(true);
      expect(r.segment).toBeNull();
      expect(r.reason).toBe("BELOW_MIN_LENGTH");
      expect(r.state.status).toBe(WALL_DRAW_IDLE);
    }
  });

  it("9./10. Escape and pointer abort cancel an un-released gesture", () => {
    let st = beginWallDraw(createWallDrawSession(), { point: P(0, 0) }).state;
    st = previewWallDraw(st, st.txId, { point: P(3000, 0) }).state;
    // Unscoped cancel is what Escape / pointercancel / lostpointercapture use.
    const r = cancelWallDraw(st);
    expect(r.ok).toBe(true);
    expect(r.state.status).toBe(WALL_DRAW_IDLE);
  });

  it("11. a lost pointer capture after pointerup cannot undo the commit", () => {
    let st = beginWallDraw(createWallDrawSession(), { point: P(0, 0) }).state;
    const tx = st.txId;
    st = previewWallDraw(st, tx, { point: P(4000, 0) }).state;
    const committed = commitWallDraw(st, tx);
    expect(committed.segment).not.toBeNull();

    // The trailing lostpointercapture that follows every pointerup.
    const trailing = cancelWallDraw(committed.state);
    expect(trailing.cancelled).toBeUndefined();
    expect(trailing.ok).toBe(false);
    expect(trailing.reason).toBe("NOT_ACTIVE");
    expect(trailing.state.status).toBe(WALL_DRAW_IDLE);
  });

  it("12. consecutive drags keep their own endpoints with no linking diagonal", () => {
    const drags = [
      [P(0, 0), P(4000, 0)],
      [P(4000, 0), P(4000, 3000)],
      [P(9000, 9000), P(12000, 9000)], // deliberately detached from wall 2
    ];
    let state = createWallDrawSession();
    const segments = [];
    for (const [from, to] of drags) {
      const b = beginWallDraw(state, { point: from });
      state = b.state;
      state = previewWallDraw(state, b.txId, { point: to }).state;
      const c = commitWallDraw(state, b.txId);
      state = c.state;
      segments.push(c.segment);
    }
    expect(segments).toHaveLength(3);
    segments.forEach((s, i) => {
      expect(s.start).toEqual(drags[i][0]);
      expect(s.end).toEqual(drags[i][1]);
    });
    // The detached third wall did not start where the second ended.
    expect(segments[2].start).not.toEqual(segments[1].end);
    expect(state.status).toBe(WALL_DRAW_IDLE);
  });
});

describe("PHASE 2A — controller against real history + autosave + wall pipeline", () => {
  /** Wires the collaborators exactly as PlanPage does. */
  function createHarness() {
    const scheduler = createManualScheduler();
    const persistFn = vi.fn(async () => ({ ok: true }));
    const identity = { mode: "project", id: "p1" };
    const initial = emptyPlan();

    const history = new HistoryModel(initial);
    const bridge = createPlanAutosaveBridge({
      persistFn,
      debounceMs: 700,
      schedule: scheduler.schedule,
      cancelSchedule: scheduler.cancelSchedule,
    });
    bridge.beginHydration(identity);
    bridge.completeHydration(identity, initial);

    const roomSync = vi.fn((p) => {
      const safe = syncRoomsSafe({ ...p, walls: resolvePlanWalls(p) });
      return safe.ok ? { ...p, rooms: safe.rooms, zones: safe.zones } : p;
    });
    const committedSetter = vi.fn();

    let ids = 0;
    const makeId = (prefix) => `${prefix}_${++ids}`;

    const controller = createWallDrawController({
      commitSegment: (segment) => {
        const base = history.current;
        const r = commitDrawnWall(base, segment.start, segment.end, { thk: 100, role: "outer" }, makeId);
        if (!r.changed) return;
        const mat = materializeWallCommand(base, r);
        if (!mat.changed) return;
        const next = roomSync(mat.plan);
        committedSetter(next);
        history.commitFrom(base, next);
        bridge.observePlan(identity, history.current);
      },
    });

    return { scheduler, persistFn, identity, history, bridge, controller, roomSync, committedSetter };
  }

  it("pointermove previews touch neither the committed plan, history, room sync nor autosave", async () => {
    const h = createHarness();
    const base = h.history.current;
    const tx = h.controller.begin({ point: P(0, 0), pointerId: 1 });

    for (const x of [200, 900, 2400, 5000]) {
      h.controller.preview(tx, { point: P(x, 0), pointerId: 1 });
      h.scheduler.flush();            // far longer than the 700 ms debounce
      await flushAsync();
    }

    expect(h.controller.getPreview()).toMatchObject({ start: P(0, 0), end: P(5000, 0) });
    expect(h.history.current).toBe(base);
    expect(h.history.past.length).toBe(0);
    expect(h.committedSetter).not.toHaveBeenCalled();
    expect(h.roomSync).not.toHaveBeenCalled();
    expect(h.scheduler.pendingCount()).toBe(0);
    expect(h.persistFn).not.toHaveBeenCalled();
  });

  it("pointerup commits one wall: one room sync, one history step, one autosave", async () => {
    const h = createHarness();
    const base = h.history.current;

    const tx = h.controller.begin({ point: P(0, 0), pointerId: 1 });
    h.controller.preview(tx, { point: P(2000, 0), pointerId: 1 });
    h.controller.preview(tx, { point: P(6000, 0), pointerId: 1 });
    const res = h.controller.commit(tx);

    expect(res.committed).toBe(true);
    expect(h.roomSync).toHaveBeenCalledTimes(1);
    expect(h.committedSetter).toHaveBeenCalledTimes(1);
    expect(h.history.past.length).toBe(1);
    expect(h.history.past[0]).toBe(base);
    expect(h.history.current.walls).toHaveLength(1);
    expect(h.controller.isActive()).toBe(false);

    h.scheduler.flush();
    await flushAsync();
    expect(h.persistFn).toHaveBeenCalledTimes(1);
    const [, saved] = h.persistFn.mock.calls[0];
    expect(saved.walls).toHaveLength(1);

    // A duplicate release changes nothing.
    expect(h.controller.commit(tx).committed).toBe(false);
    expect(h.history.past.length).toBe(1);
  });

  it("four drag-releases build a closed rectangle: 4 walls, 4 nodes, no diagonal", () => {
    const h = createHarness();
    const corners = [P(0, 0), P(6000, 0), P(6000, 4000), P(0, 4000)];
    for (let i = 0; i < 4; i++) {
      const from = corners[i];
      const to = corners[(i + 1) % 4];
      const tx = h.controller.begin({ point: from, pointerId: 1 });
      h.controller.preview(tx, { point: P((from.x + to.x) / 2, (from.y + to.y) / 2), pointerId: 1 });
      h.controller.preview(tx, { point: to, pointerId: 1 });
      expect(h.controller.commit(tx).committed).toBe(true);
    }

    const plan = h.history.current;
    const walls = resolvePlanWalls(plan);
    expect(walls).toHaveLength(4);
    expect(Object.keys(plan.nodes)).toHaveLength(4);
    expect(h.history.past.length).toBe(4);

    const diagonals = walls.filter((w) => {
      const [a, b] = [w.pts[0], w.pts[w.pts.length - 1]];
      return Math.abs(a.x - b.x) > 3 && Math.abs(a.y - b.y) > 3;
    });
    expect(diagonals).toHaveLength(0);

    const orphans = Object.keys(plan.nodes).filter((id) => !plan.walls.some((w) => w.a === id || w.b === id));
    expect(orphans).toHaveLength(0);
    expect(plan.rooms.length).toBeGreaterThanOrEqual(1);
  });

  it("a cancelled gesture commits nothing and leaves the plan alone", async () => {
    const h = createHarness();
    const base = h.history.current;
    const tx = h.controller.begin({ point: P(0, 0), pointerId: 1 });
    h.controller.preview(tx, { point: P(7000, 0), pointerId: 1 });
    h.controller.cancel();

    h.scheduler.flush();
    await flushAsync();

    expect(h.history.current).toBe(base);
    expect(h.history.past.length).toBe(0);
    expect(h.roomSync).not.toHaveBeenCalled();
    expect(h.persistFn).not.toHaveBeenCalled();
    expect(h.controller.commit(tx).committed).toBe(false);
  });

  it("a click with no drag creates no wall and no history step", async () => {
    const h = createHarness();
    const base = h.history.current;
    const tx = h.controller.begin({ point: P(1000, 1000), pointerId: 1 });
    h.controller.preview(tx, { point: P(1010, 1000), pointerId: 1 });
    const res = h.controller.commit(tx);

    expect(res.committed).toBe(false);
    expect(res.reason).toBe("BELOW_MIN_LENGTH");
    expect(h.history.current).toBe(base);
    expect(h.history.past.length).toBe(0);
    expect(h.controller.isActive()).toBe(false);

    h.scheduler.flush();
    await flushAsync();
    expect(h.persistFn).not.toHaveBeenCalled();
  });

  it("controller refuses to exist without a commit sink", () => {
    expect(() => createWallDrawController({})).toThrow(/commitSegment is required/);
  });
});
