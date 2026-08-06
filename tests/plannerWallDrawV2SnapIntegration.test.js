/**
 * PHASE 2B2 — V2 wall drawing wired to the bounded snap resolver.
 *
 * The harness mirrors the PlanPage V2 pointer contract exactly (resolve on
 * down, resolve on every move, resolve the release point only when no move
 * happened, commit the stored segment) and drives the real controller, the
 * real HistoryModel, the real autosave bridge and the real commitDrawnWall.
 * Resolver logic is imported from PHASE 2B1, never re-implemented here.
 */
import { describe, it, expect, vi } from "vitest";
import {
  resolveWallPoint,
  runSnapEngine,
  WALL_POINT_MAX_DISTANCE_PX,
} from "../src/planner/core/snap/index.js";
import { createWallDrawController } from "../src/planner/core/session/index.js";
import { HistoryModel } from "../src/planner/core/history/historyModel.js";
import { createPlanAutosaveBridge } from "../src/planner/core/history/planAutosaveBridge.js";
import { commitDrawnWall } from "../src/planner/core/walls/wallDrawTopology.js";
import { materializeWallCommand } from "../src/planner/core/walls/applyWallCommand.js";
import { syncRoomsSafe } from "../src/planner/core/rooms/syncRooms.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";
import { wallDrawV2SnapToTopologyIntent } from "../src/pages/admin/PlanPage.jsx";

const P = (x, y) => ({ x, y });

function emptyPlan() {
  return {
    walls: [],
    nodes: {},
    items: [],
    rooms: [],
    zones: [],
    room: { w: 20000, h: 15000, wallThk: 100, height: 3000 },
    dimensions: [],
    validationWarnings: [],
  };
}

/** Canonical network wall: nodes + a/b (walls[].pts stays derived). */
function networkPlan(thk = 100) {
  return {
    ...emptyPlan(),
    nodes: { n1: P(0, 0), n2: P(4000, 0) },
    walls: [{ id: "w1", a: "n1", b: "n2", thk, role: "outer", kind: "new", thicknessSide: "center", height: 3000 }],
  };
}

/** Legacy pts-only wall (no nodes) — exercises the wall-end kind. */
function legacyPtsPlan(thk = 100) {
  return {
    ...emptyPlan(),
    nodes: {},
    walls: [{ id: "lw1", thk, pts: [P(0, 0), P(4000, 0)], role: "outer", kind: "new", thicknessSide: "center", height: 3000 }],
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

/**
 * PlanPage's V2 wiring, without React.
 * Mirrors: resolveWallDrawPoint, wallDrawV2MovedRef, onDown/onMove/onUp,
 * cancelWallDrawV2 and wallDrawV2CommitRef.
 */
function createHarness({
  plan: initialPlan = emptyPlan(),
  zoom = 0.08,
  gridEnabled = true,
  snapStep = 50,
} = {}) {
  const scheduler = createManualScheduler();
  const persistFn = vi.fn(async () => ({ ok: true }));
  const identity = { mode: "project", id: "p1" };
  const history = new HistoryModel(initialPlan);
  const bridge = createPlanAutosaveBridge({
    persistFn,
    debounceMs: 700,
    schedule: scheduler.schedule,
    cancelSchedule: scheduler.cancelSchedule,
  });
  bridge.beginHydration(identity);
  bridge.completeHydration(identity, initialPlan);

  const roomSync = vi.fn((p) => {
    const safe = syncRoomsSafe({ ...p, walls: resolvePlanWalls(p) });
    return safe.ok ? { ...p, rooms: safe.rooms, zones: safe.zones } : p;
  });
  const committedSetter = vi.fn();
  const modifiers = { shift: false, alt: false, ctrl: false };
  let ids = 0;
  const makeId = (prefix) => `${prefix}_${++ids}`;
  let moved = false;
  let lastCommitResult = null;
  const resolveCalls = [];

  const resolvePoint = (raw, { role, from = null }) => {
    const resolved = resolveWallPoint({
      point: raw,
      from,
      role,
      zoom,
      plan: history.current,
      candidateContext: { view: { zoom }, draft: { pts: [], chainStart: null } },
      modifiers: { ...modifiers },
      grid: { enabled: gridEnabled, step: snapStep, fineStep: 10 },
      options: {
        snapOn: true,
        snapWalls: true,
        snapGrid: gridEnabled,
        angleSnapOn: true,
        toleranceDeg: 5,
        snapDistancePx: 10,
        wallThk: 100,
        snapStep,
        chainStart: null,
        prevSegAngleDeg: null,
      },
    });
    resolveCalls.push({ role, raw: { ...raw }, from: from ? { ...from } : null, resolved });
    return resolved;
  };

  const meta = (raw, resolved) => ({ ...resolved, raw: { x: raw.x, y: raw.y } });

  const controller = createWallDrawController({
    commitSegment: (segment) => {
      const base = history.current;
      const r = commitDrawnWall(base, segment.start, segment.end, { thk: 100, role: "outer" }, makeId, {
        startIntent: wallDrawV2SnapToTopologyIntent(segment.startSnap, segment.start),
        endIntent: wallDrawV2SnapToTopologyIntent(segment.endSnap, segment.end),
      });
      lastCommitResult = r;
      if (!r.changed) return;
      const mat = materializeWallCommand(base, r);
      if (!mat.changed) return;
      const next = roomSync(mat.plan);
      committedSetter(next);
      history.commitFrom(base, next);
      bridge.observePlan(identity, history.current);
    },
  });

  return {
    scheduler, persistFn, history, roomSync, committedSetter, controller,
    modifiers, resolveCalls,
    getLastCommitResult() { return lastCommitResult; },
    setModifier(name, value) { modifiers[name] = value; },

    down(raw) {
      const resolved = resolvePoint(raw, { role: "start" });
      moved = false;
      controller.begin({
        point: resolved.point,
        snap: meta(raw, resolved),
        pointerId: 1,
        now: Date.now(),
      });
      return resolved;
    },
    move(raw) {
      const start = controller.getPreview()?.start || raw;
      const resolved = resolvePoint(raw, { role: "end", from: start });
      moved = true;
      controller.preview(controller.getTxId(), {
        point: resolved.point,
        snap: meta(raw, resolved),
        pointerId: 1,
      });
      return resolved;
    },
    up(raw = null) {
      const txId = controller.getTxId();
      if (!moved) {
        const releaseRaw = raw || controller.getPreview()?.start;
        const resolved = resolvePoint(releaseRaw, { role: "end", from: controller.getPreview()?.start || null });
        controller.preview(txId, { point: resolved.point, snap: meta(releaseRaw, resolved), pointerId: 1 });
        moved = true;
      }
      const previewBefore = controller.getPreview();
      const res = controller.commit(txId);
      moved = false;
      return { ...res, previewBefore };
    },
    cancel() { controller.cancel(); moved = false; },
  };
}

describe("PHASE 2B2 — V2 start/end resolution", () => {
  it("1. start uses the bounded resolver, not the legacy runSnapEngine result", () => {
    const plan = networkPlan();
    const raw = P(0, 1400); // 1400 mm from node n1 => 112 px at zoom 0.08
    const legacy = runSnapEngine({
      point: raw,
      mode: "wall",
      plan,
      view: { zoom: 0.08 },
      options: { snapOn: true, snapWalls: true, snapGrid: true, snapDistancePx: 10, snapStep: 50 },
    });
    // The legacy engine's screen-invariant magnet swallows 1400 mm.
    expect(legacy.point).toEqual(P(0, 0));

    const h = createHarness({ plan });
    const resolved = h.down(raw);
    expect(resolved.point).not.toEqual(legacy.point);
    expect(resolved.point).toEqual(raw);
    expect(resolved.connects).toBe(false);
    expect(h.controller.getPreview().start).toEqual(raw);
  });

  it("2. the end is resolved against the session's resolved start, not the raw press", () => {
    const h = createHarness({ plan: networkPlan() });
    const rawPress = P(30, 30);
    const start = h.down(rawPress);
    expect(start.point).not.toEqual(rawPress);   // the press was snapped
    h.move(P(3000, 3000));
    const endCall = h.resolveCalls.find((c) => c.role === "end");
    expect(endCall.from).toEqual(start.point);
    expect(endCall.from).toEqual(h.controller.getPreview().start);
    expect(endCall.from).not.toEqual(rawPress);
  });

  it("3./4. the previewed endpoint is the committed endpoint and is not re-snapped", () => {
    const h = createHarness({ plan: networkPlan() });
    h.down(P(0, 3000));
    h.move(P(2000, 3010));
    const previewed = h.controller.getPreview().end;
    const resolveCountBefore = h.resolveCalls.length;

    const res = h.up();
    expect(res.committed).toBe(true);
    expect(res.segment.end).toEqual(previewed);
    expect(Math.hypot(res.segment.end.x - previewed.x, res.segment.end.y - previewed.y)).toBeLessThan(0.001);
    // pointerup ran no additional resolve.
    expect(h.resolveCalls.length).toBe(resolveCountBefore);
  });

  it("5. node snap lands exactly on the existing node with node metadata", () => {
    const h = createHarness({ plan: networkPlan() });
    // Within the 2 px topology tie band, where node outranks the wall body.
    const r = h.down(P(4010, 0));
    expect(r.kind).toBe("node");
    expect(r.point).toEqual(P(4000, 0));
    expect(r.nodeId).toBe("n2");
    expect(r.connects).toBe(true);
    expect(r.distancePx).toBeLessThanOrEqual(WALL_POINT_MAX_DISTANCE_PX);
    expect(wallDrawV2SnapToTopologyIntent(h.controller.getPreview().startSnap, r.point)).toEqual({
      kind: "node", point: P(4000, 0), nodeId: "n2",
      wallId: null, hostWallId: null, connects: true,
    });
    h.move(P(4000, 2000));
    expect(h.up().committed).toBe(true);
    const added = h.history.current.walls.find((w) => w.id !== "w1");
    expect(added.a).toBe("n2");
  });

  it("6. a legacy pts-only wall endpoint resolves as wall-end with exact geometry", () => {
    const h = createHarness({ plan: legacyPtsPlan() });
    const r = h.down(P(4010, 0));
    expect(r.kind).toBe("wall-end");
    expect(r.point).toEqual(P(4000, 0));
    expect(r.nodeId).toBeNull();
    expect(r.connects).toBe(true);
    expect(wallDrawV2SnapToTopologyIntent(h.controller.getPreview().startSnap, r.point)).toEqual({
      kind: "wall-end", point: P(4000, 0), nodeId: null,
      wallId: "lw1", hostWallId: null, connects: true,
    });
  });

  it("7. wall body resolves to the exact centerline projection with hostWallId", () => {
    const h = createHarness({ plan: networkPlan() });
    const r = h.down(P(2000, 40)); // inside the 100 mm mass
    expect(r.kind).toBe("wall-body");
    expect(r.point).toEqual(P(2000, 0));
    expect(r.hostWallId).toBe("w1");
    expect(r.connects).toBe(true);
    expect(wallDrawV2SnapToTopologyIntent(h.controller.getPreview().startSnap, r.point)).toEqual({
      kind: "wall-body", point: P(2000, 0), nodeId: null,
      wallId: null, hostWallId: "w1", connects: true,
    });
  });

  it.each(["grid", "axis", "angle", "raw"])("8-11. %s metadata maps to explicit none", (kind) => {
    const point = P(1234, 5678);
    expect(wallDrawV2SnapToTopologyIntent({
      kind, point, nodeId: "ignored-node", wallId: "ignored-wall",
      hostWallId: "ignored-host", connects: true,
    }, point)).toEqual({
      kind: "none", point, nodeId: null, wallId: null, hostWallId: null, connects: false,
    });
  });

  it("8. a far node at overview zoom is rejected", () => {
    const h = createHarness({ plan: networkPlan(), zoom: 0.08 });
    const r = h.down(P(0, 1400));
    expect(r.kind).not.toBe("node");
    expect(r.connects).toBe(false);
    expect(r.nodeId).toBeNull();
  });

  it("9. a close wall body beats a farther eligible node", () => {
    const h = createHarness({ plan: networkPlan(), zoom: 0.02 });
    // 200 mm from node n1 (4 px) vs 5 mm off the wall centerline (0.1 px).
    const r = h.down(P(200, 5));
    expect(r.kind).toBe("wall-body");
    expect(r.point).toEqual(P(200, 0));
  });

  it("10. a 25 mm candidate is rejected at zoom 3 because it is 75 px away", () => {
    // Thin wall, and diagonally off the end so the point is outside both the
    // visible mass and the segment: inside the mass a wall body is a
    // zero-face-distance hit at any zoom, by design.
    const h = createHarness({ plan: networkPlan(10), zoom: 3 });
    const r = h.down(P(-18, -18)); // 25.5 mm from n1 => 76 px at zoom 3
    expect(r.kind).not.toBe("node");
    expect(r.kind).not.toBe("wall-body");
    expect(r.connects).toBe(false);
  });

  it("11. an eligible topology candidate beats angle and grid", () => {
    const h = createHarness({ plan: networkPlan() });
    h.down(P(0, 3000));
    const r = h.move(P(4000 - 20, 20)); // near n2, and near a 45-degree ray
    expect(["node", "wall-end", "wall-body"]).toContain(r.kind);
    expect(r.connects).toBe(true);
    expect(r.kind).not.toBe("angle");
    expect(r.kind).not.toBe("grid");
    // Exactly on the resolved topology geometry, not on an angle ray.
    expect(r.point).toEqual(P(3980, 0));
  });

  it("12. Alt bypasses every magnet and returns the 1 mm-rounded raw point", () => {
    const h = createHarness({ plan: networkPlan() });
    h.setModifier("alt", true);
    const r = h.down(P(4000.4, 0.4));
    expect(r.kind).toBe("raw");
    expect(r.connects).toBe(false);
    expect(r.nodeId).toBeNull();
    expect(r.hostWallId).toBeNull();
    expect(r.point).toEqual(P(4000, 0)); // rounding only, not a node snap
    expect(r.source).toBe("alt-raw");
    expect(wallDrawV2SnapToTopologyIntent(h.controller.getPreview().startSnap, r.point).kind).toBe("none");

    // Releasing Alt restores magnets on the next move.
    h.setModifier("alt", false);
    const back = h.move(P(30, 30));
    expect(back.kind).not.toBe("raw");
    expect(back.connects).toBe(true);
  });

  it("13. Ctrl keeps the fine grid without widening magnetic eligibility", () => {
    const coarse = createHarness({ plan: emptyPlan() });
    expect(coarse.down(P(1234, 0)).point).toEqual(P(1250, 0));

    const fine = createHarness({ plan: emptyPlan() });
    fine.setModifier("ctrl", true);
    expect(fine.down(P(1234, 0)).point).toEqual(P(1230, 0));

    // Ctrl must not make a far node eligible.
    const far = createHarness({ plan: networkPlan(), zoom: 0.08 });
    far.setModifier("ctrl", true);
    expect(far.down(P(0, 1400)).kind).not.toBe("node");
  });

  it("14. start and end share identical topology eligibility", () => {
    const near = P(4000 - 40, 40);
    const far = P(0, 1400);

    const a = createHarness({ plan: networkPlan() });
    const startNear = a.down(near);
    const b = createHarness({ plan: networkPlan() });
    b.down(P(0, 5000));
    const endNear = b.move(near);
    expect(endNear.kind).toBe(startNear.kind);
    expect(endNear.point).toEqual(startNear.point);
    expect(endNear.connects).toBe(startNear.connects);

    const c = createHarness({ plan: networkPlan() });
    const startFar = c.down(far);
    const d = createHarness({ plan: networkPlan() });
    d.down(P(8000, 8000));
    const endFar = d.move(far);
    expect(endFar.connects).toBe(startFar.connects);
    expect(endFar.kind).not.toBe("node");
  });

  it("15. a press with no movement creates no wall", async () => {
    const h = createHarness({ plan: emptyPlan() });
    const base = h.history.current;
    h.down(P(1000, 1000));
    const res = h.up(P(1000, 1000));

    expect(res.committed).toBe(false);
    expect(h.history.current).toBe(base);
    expect(h.history.past.length).toBe(0);
    expect(h.controller.isActive()).toBe(false);
    h.scheduler.flush();
    await flushAsync();
    expect(h.persistFn).not.toHaveBeenCalled();
  });

  it("16. Escape clears the session and its resolved preview metadata", () => {
    const h = createHarness({ plan: networkPlan() });
    h.down(P(0, 3000));
    h.move(P(3000, 3000));
    expect(h.controller.getPreview().endSnap.kind).toBeDefined();

    h.cancel();
    expect(h.controller.isActive()).toBe(false);
    expect(h.controller.getPreview()).toBeNull();
    expect(h.history.past.length).toBe(0);
  });

  it("17. a lost pointer capture before commit cancels the gesture", () => {
    const h = createHarness({ plan: networkPlan() });
    const base = h.history.current;
    h.down(P(0, 3000));
    h.move(P(3000, 3000));
    h.cancel();                       // onPointerAbort path
    expect(h.controller.isActive()).toBe(false);
    expect(h.history.current).toBe(base);
    expect(h.controller.commit(h.controller.getTxId()).committed).toBe(false);
  });

  it("18. a lost pointer capture after commit neither cancels nor duplicates", () => {
    const h = createHarness({ plan: emptyPlan() });
    h.down(P(0, 0));
    h.move(P(4000, 0));
    const txId = h.controller.getTxId();
    expect(h.up().committed).toBe(true);
    const afterCommit = h.history.current;
    const steps = h.history.past.length;

    h.cancel();                       // trailing lostpointercapture
    expect(h.history.current).toBe(afterCommit);
    expect(h.history.past.length).toBe(steps);
    expect(h.controller.commit(txId).committed).toBe(false);
    expect(h.history.past.length).toBe(steps);
    expect(resolvePlanWalls(h.history.current)).toHaveLength(1);
  });

  it("19. pointermove touches no history, room sync or autosave", async () => {
    const h = createHarness({ plan: networkPlan() });
    const base = h.history.current;
    h.down(P(0, 3000));
    for (const x of [500, 1500, 3000, 4000]) {
      h.move(P(x, 3000));
      h.scheduler.flush();
      await flushAsync();
    }
    expect(h.history.current).toBe(base);
    expect(h.history.past.length).toBe(0);
    expect(h.roomSync).not.toHaveBeenCalled();
    expect(h.committedSetter).not.toHaveBeenCalled();
    expect(h.scheduler.pendingCount()).toBe(0);
    expect(h.persistFn).not.toHaveBeenCalled();
  });

  it("20. release produces one history step, one room sync and one autosave", async () => {
    const h = createHarness({ plan: networkPlan() });
    const base = h.history.current;
    h.down(P(0, 3000));
    h.move(P(2000, 3000));
    h.move(P(4000, 3000));
    expect(h.up().committed).toBe(true);

    expect(h.roomSync).toHaveBeenCalledTimes(1);
    expect(h.committedSetter).toHaveBeenCalledTimes(1);
    expect(h.history.past.length).toBe(1);
    expect(h.history.past[0]).toBe(base);

    h.scheduler.flush();
    await flushAsync();
    expect(h.persistFn).toHaveBeenCalledTimes(1);
    expect(h.controller.isActive()).toBe(false);
  });

  it("21. resolved topology coordinates land inside commitDrawnWall's own tolerance", () => {
    // The wall-body projection must be exact enough that the topology engine
    // reuses the host instead of leaving a visually merged, unlinked wall.
    const h = createHarness({ plan: networkPlan() });
    const start = h.down(P(2000, 40));
    expect(start.kind).toBe("wall-body");
    h.move(P(2000, 3000));
    expect(h.up().committed).toBe(true);

    const plan = h.history.current;
    const walls = resolvePlanWalls(plan);
    // Host split into two + the new branch.
    expect(walls).toHaveLength(3);
    const orphans = Object.keys(plan.nodes).filter(
      (id) => !plan.walls.some((w) => w.a === id || w.b === id),
    );
    expect(orphans).toHaveLength(0);
  });

  it("23. stale resolver metadata is rejected by commitDrawnWall without a fallback inference", () => {
    const plan = networkPlan();
    const start = P(0, 71);
    const end = P(-1000, 1000);
    const result = commitDrawnWall(plan, start, end, {}, (() => {
      let i = 0;
      return (prefix) => `${prefix}_stale_${++i}`;
    })(), {
      startIntent: wallDrawV2SnapToTopologyIntent({ kind: "node", nodeId: "missing" }, start),
      endIntent: wallDrawV2SnapToTopologyIntent({ kind: "grid" }, end),
    });
    expect(result.changed).toBe(true);
    expect(result.intentWarnings.map((w) => w.code)).toContain("INTENT_REJECTED_NODE");
    expect(result.meta.intents.start.kind).toBe("none");
    const added = result.plan.walls.find((w) => w.id === result.meta.newWallId);
    expect(added.a).not.toBe("n1");
  });

  it("24. explicit none at 71 mm remains separate after serialize and normalizePlan", async () => {
    const plan = networkPlan();
    const start = P(0, 71);
    const end = P(-1000, 1000);
    let i = 0;
    const result = commitDrawnWall(plan, start, end, {}, (prefix) => `${prefix}_load_${++i}`, {
      startIntent: wallDrawV2SnapToTopologyIntent({ kind: "grid" }, start),
      endIntent: wallDrawV2SnapToTopologyIntent({ kind: "raw" }, end),
    });
    const added = result.plan.walls.find((w) => w.id === result.meta.newWallId);
    expect(added.a).not.toBe("n1");
    // Load normalizePlan first in a fresh graph; wallNetwork and planNormalize
    // intentionally have a legacy cycle whose safe initialization order is
    // already covered by plannerWallTopologyIntent.
    vi.resetModules();
    const { normalizePlan } = await import("../src/planner/planNormalize.js");
    const loaded = normalizePlan(JSON.parse(JSON.stringify(result.plan)));
    expect(loaded.walls.find((w) => w.id === added.id).a).toBe(added.a);
    expect(loaded.nodes[added.a]).toEqual(start);
  });

  it("25. a real crossing still splits when both mapped intents are none", () => {
    const plan = networkPlan();
    const start = P(3000, -1000);
    const end = P(3000, 1000);
    let i = 0;
    const result = commitDrawnWall(plan, start, end, {}, (prefix) => `${prefix}_cross_${++i}`, {
      startIntent: wallDrawV2SnapToTopologyIntent({ kind: "raw" }, start),
      endIntent: wallDrawV2SnapToTopologyIntent({ kind: "angle" }, end),
    });
    expect(result.changed).toBe(true);
    expect(result.meta.firstIntersection.wallId).toBe("w1");
    expect(result.meta.endSplitWallIds).toHaveLength(2);
    expect(result.plan.walls).toHaveLength(3);
  });
});
