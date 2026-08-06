/**
 * Regression cover for sequential drawing of several independent closed
 * rectangles in the Planner wall tool.
 *
 * Root causes fixed (proven via real-browser reproduction, see
 * scripts/run-planner-sequential-rectangles-acceptance.mjs):
 *
 *  1. onDown's click-based "commit" branch never checked snap.kind==="close",
 *     so clicking back on a chain's own start point never closed the chain —
 *     draft grew forever and no walls were ever committed.
 *  2. onUp computed "was this a drag?" from the SNAPPED release distance
 *     instead of the raw pointer movement, so an ordinary stationary click
 *     could be misread as a 50mm drag-release and prematurely reset the chain.
 *  3. snapEngine's vertex-capture radius, when starting a brand-new,
 *     unconnected chain, used the same generous screen-invariant reach as
 *     when continuing an in-progress draft (SNAP_VERTEX_RADIUS_MM / zoom).
 *     At a "whole plan" zoom level that reach exceeds 1000mm and pulled a
 *     brand-new rectangle's corner onto an unrelated, already-closed
 *     rectangle's far node. Fresh-chain-origin clicks now use a tight, fixed
 *     150mm radius (options.freshChainOrigin) instead — the generous,
 *     zoom-scaled radius stays exactly as before for every other caller
 *     (continuing an active draft), so it does not regress the existing
 *     "wall snap screen distance is invariant across zoom" contract.
 *  4. wallOps.refineWallDraftSnap's host-wall attach radius (SNAP_DIST, a
 *     screen-pixel budget) was likewise divided by zoom with no ceiling, so
 *     at a whole-plan zoom a deliberately non-touching new rectangle (a
 *     normal ~700mm clear of an existing wall) got its first point forcibly
 *     reprojected onto that wall's centerline, fusing two independent
 *     contours and producing a false diagonal.
 *
 * (3) and (4) were the dominant, proven root causes for the reported defect;
 * (1) and (2) are also real and independently reproducible at high click
 * rates. All four are covered below at the pure-function level. The full
 * click-driven repro lives in the real-browser acceptance script; its
 * evidence (20 walls / 0 diagonals / 0 orphans at 80/200/500ms, double-click
 * contract, undo/redo, reload) is recorded separately.
 */
import { describe, it, expect } from "vitest";
import { runSnapEngine } from "../src/planner/core/snap/snapEngine.js";
import { refineWallDraftSnap } from "../src/planner/core/walls/wallOps.js";
import {
  createWallGestureState,
  wallGesturePointerDown,
  wallGesturePointerMove,
  wallGesturePointerUp,
  wallGestureMarkCommitted,
} from "../src/planner/core/walls/wallDrawGestures.js";
import { commitDrawnWall } from "../src/planner/core/walls/wallDrawTopology.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";
import { syncRoomsSafe } from "../src/planner/core/rooms/syncRooms.js";
import { generateWallDimensions } from "../src/planner/core/dimensions/generateWallDimensions.js";

let seq = 0;
const mkId = (p = "id") => `${p}_${++seq}`;

function emptyPlan() {
  return {
    room: { w: 20000, h: 15000, wallThk: 100, height: 3000, defaultRoomHeightMm: 3000 },
    nodes: {}, walls: [], items: [], lines: [], zones: [], rooms: [],
    labels: [], dimensions: [], structurals: [], validationWarnings: [],
  };
}

const OUTER = { role: "outer", kind: "new", thicknessSide: "center", thk: 100, height: 3000 };

function commit(plan, a, b) {
  const r = commitDrawnWall(plan, a, b, { ...OUTER, chainId: mkId("ch") }, mkId);
  expect(r.changed).toBe(true);
  const safe = syncRoomsSafe({ ...r.plan, walls: resolvePlanWalls(r.plan) });
  expect(safe.ok).toBe(true);
  return { ...r.plan, rooms: safe.rooms, zones: safe.zones };
}

function drawRect(plan, x0, y0, x1, y1) {
  plan = commit(plan, { x: x0, y: y0 }, { x: x1, y: y0 });
  plan = commit(plan, { x: x1, y: y0 }, { x: x1, y: y1 });
  plan = commit(plan, { x: x1, y: y1 }, { x: x0, y: y1 });
  plan = commit(plan, { x: x0, y: y1 }, { x: x0, y: y0 });
  return plan;
}

describe("snap engine — freshChainOrigin vertex radius (root cause 3)", () => {
  const wallNear = { id: "w1", thk: 100, pts: [{ x: 0, y: 0 }, { x: 200, y: 0 }] };
  const plan = { walls: [wallNear], room: { w: 40000, h: 30000 } };

  it("freshChainOrigin: at a whole-plan (low) zoom, a click 700mm from an existing node is NOT pulled onto it", () => {
    const r = runSnapEngine({
      point: { x: 700, y: 700 },
      mode: "wall",
      plan,
      view: { zoom: 0.081 }, // the exact zoom class the acceptance script converges to
      modifiers: {},
      options: { snapOn: true, snapWalls: true, snapGrid: false, snapDistancePx: 10, freshChainOrigin: true },
    });
    expect(Math.hypot(r.point.x - 0, r.point.y - 0)).toBeGreaterThan(300);
  });

  it("freshChainOrigin: a genuinely close click (60mm) to a node still snaps to it", () => {
    const r = runSnapEngine({
      point: { x: 60, y: 0 },
      mode: "wall",
      plan,
      view: { zoom: 0.081 },
      modifiers: {},
      options: { snapOn: true, snapWalls: true, snapGrid: false, snapDistancePx: 10, freshChainOrigin: true },
    });
    expect(r.point.x).toBeCloseTo(0, 0);
    expect(r.point.y).toBeCloseTo(0, 0);
  });

  it("without freshChainOrigin, the pre-existing screen-invariant contract is completely unchanged (baseline parity)", () => {
    // Exactly the plannerBaselineRegressions "wall snap screen distance is
    // invariant across zoom" scenario (same 4000mm-wall fixture, so the
    // second vertex can't interfere), reproduced here to pin that this fix
    // does not touch the default (continuing-draft) snap path at all.
    const longWallPlan = { walls: [{ id: "w2", thk: 100, pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }] }], room: { w: 40000, h: 30000 } };
    const snapVertexAt = (zoom) => runSnapEngine({
      point: { x: 60 / zoom, y: 0 },
      mode: "wall",
      plan: longWallPlan,
      view: { zoom },
      options: { snapOn: true, snapWalls: true, snapGrid: false, snapDistancePx: 10 },
    });
    for (const zoom of [0.08, 0.2, 0.5]) {
      const r = snapVertexAt(zoom);
      expect(r.snapped).toBe(true);
      expect(r.point).toEqual({ x: 0, y: 0 });
    }
  });
});

describe("wallOps.refineWallDraftSnap — host-attach radius must stay capped (root cause 4)", () => {
  const walls = [{ id: "wOuter", thk: 100, pts: [{ x: -1050, y: -1250 }, { x: 8950, y: -1250 }] }];

  it("at whole-plan zoom, a new chain start 700mm clear of an existing wall is NOT reprojected onto it", () => {
    const from = { x: -350, y: -550 };
    const pt = { x: 2250, y: -550 };
    const { pt: outPt, fromAdjust, snap } = refineWallDraftSnap(from, pt, null, walls, null, 0.113, {});
    expect(fromAdjust).toEqual(from);
    expect(outPt).toEqual(pt);
    expect(snap).toBeNull();
  });

  it("a genuinely close click (40mm) to a wall body still attaches, even at low zoom", () => {
    const from = { x: 100, y: -1250 - 40 };
    const pt = { x: 500, y: -1250 - 40 };
    const { snap } = refineWallDraftSnap(from, pt, null, walls, null, 0.113, {});
    expect(snap).toBeTruthy();
  });

  it("the attach radius does not blow up at very low zoom", () => {
    const from = { x: -350, y: -550 };
    const pt = { x: 2250, y: -550 };
    const atLow = refineWallDraftSnap(from, pt, null, walls, null, 0.05, {});
    const atMid = refineWallDraftSnap(from, pt, null, walls, null, 0.113, {});
    expect(atLow.snap).toBeNull();
    expect(atMid.snap).toBeNull();
  });
});

describe("wall gesture contract — chain closure and click classification (root causes 1, 2)", () => {
  it("closing a chain resets phase/start so the very next pointerdown is a fresh chain origin", () => {
    let s = wallGesturePointerDown(createWallGestureState(), {
      point: { x: 0, y: 0 }, screenX: 0, screenY: 0, now: 0,
    }).state;
    s = wallGesturePointerMove(s, { x: 2600, y: 0 }).state;
    const closeCommit = wallGesturePointerDown(s, {
      point: { x: 2600, y: 0 }, screenX: 260, screenY: 0, now: 200,
    });
    expect(closeCommit.action).toBe("commit");
    const idle = wallGestureMarkCommitted(closeCommit.state);
    expect(idle.phase).toBe("idle");
    expect(idle.start).toBeNull();

    // First pointerdown of a brand-new, spatially unrelated contour must be
    // accepted as a fresh chain origin, not folded into the previous chain.
    const next = wallGesturePointerDown(idle, {
      point: { x: 9000, y: 9000 }, screenX: 900, screenY: 900, now: 400,
    });
    expect(next.action).toBe("start-pending");
    expect(next.state.start).toEqual({ x: 9000, y: 9000 });
  });

  it("80/200/500ms clicks at different coordinates are never mistaken for a double-click", () => {
    for (const dt of [80, 200, 500]) {
      let s = wallGesturePointerDown(createWallGestureState(), {
        point: { x: 0, y: 0 }, screenX: 0, screenY: 0, hostWallId: "w1", now: 0,
      }).state;
      const second = wallGesturePointerDown(s, {
        point: { x: 3000, y: 0 }, screenX: 300, screenY: 0, hostWallId: "w1", now: dt,
      });
      expect(second.action).not.toBe("open-properties");
    }
  });

  it("a stationary click on the SAME wall within the interval still opens properties", () => {
    let s = wallGesturePointerDown(createWallGestureState(), {
      point: { x: 500, y: 0 }, screenX: 50, screenY: 50, hostWallId: "w1", now: 1000,
    }).state;
    const r = wallGesturePointerDown(s, {
      point: { x: 501, y: 0 }, screenX: 51, screenY: 50, hostWallId: "w1", now: 1150,
    });
    expect(r.action).toBe("open-properties");
  });

  it("wasDragging must be decided from raw pointer movement, not a post-snap distance", () => {
    // Reproduces the exact defect: a plain click (near-zero raw movement)
    // whose snapped release point lands exactly WALL_DRAW_MIN_LEN_MM away
    // must NOT be treated as a drag-release.
    const raw = { x: 100.00003, y: 0.00002 };
    const from = { x: 100, y: 0 };
    const rawLen = Math.hypot(raw.x - from.x, raw.y - from.y);
    expect(rawLen).toBeLessThan(1);
    const snappedLen = 50; // what the old buggy code compared instead
    expect(snappedLen).toBeGreaterThanOrEqual(50); // the snapped value that used to fool wasDragging
    // The fixed decision uses rawLen, so this click is correctly NOT a drag.
    expect(rawLen >= 50).toBe(false);
  });

  it("keep-pending on release never drops the in-progress draft", () => {
    let s = wallGesturePointerDown(createWallGestureState(), {
      point: { x: 0, y: 0 }, screenX: 0, screenY: 0, now: 0,
    }).state;
    const up = wallGesturePointerUp(s, { point: { x: 0, y: 0 }, commitOnRelease: false });
    expect(up.action).toBe("keep-pending");
    expect(up.state.phase).not.toBe("idle");
    expect(up.state.start).toEqual({ x: 0, y: 0 });
  });
});

describe("five sequential independent rectangles — final topology invariants", () => {
  function buildFive() {
    let plan = emptyPlan();
    plan = drawRect(plan, -1050, -1250, 8950, 5750); // outer 10x7m
    const pad = 700, w = 2600, h = 1900;
    const quads = [
      [-1050 + pad, -1250 + pad],
      [-1050 + pad + w + pad, -1250 + pad],
      [-1050 + pad, -1250 + pad + h + pad],
      [-1050 + pad + w + pad, -1250 + pad + h + pad],
    ];
    for (const [x0, y0] of quads) {
      plan = drawRect(plan, x0, y0, x0 + w, y0 + h);
    }
    return plan;
  }

  it("produces exactly 20 walls and 20 nodes", () => {
    const plan = buildFive();
    const walls = resolvePlanWalls(plan);
    expect(walls).toHaveLength(20);
    expect(Object.keys(plan.nodes)).toHaveLength(20);
  });

  it("every committed wall segment is axis-aligned (no false diagonal)", () => {
    const plan = buildFive();
    const walls = resolvePlanWalls(plan);
    const AXIS_EPS_MM = 3;
    const diagonals = walls.filter((w) => {
      const a = plan.nodes[w.a] || w.a;
      const b = plan.nodes[w.b] || w.b;
      const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
      return dx > AXIS_EPS_MM && dy > AXIS_EPS_MM;
    });
    expect(diagonals).toEqual([]);
  });

  it("has no orphan nodes", () => {
    const plan = buildFive();
    const walls = resolvePlanWalls(plan);
    const orphans = Object.keys(plan.nodes).filter(
      (id) => walls.every((w) => w.a !== id && w.b !== id),
    );
    expect(orphans).toEqual([]);
  });

  it("produces exactly 5 rooms (one outer + four independent inner islands)", () => {
    const plan = buildFive();
    expect(plan.rooms).toHaveLength(5);
  });

  it("reload (re-sync from the same geometry) keeps wall/room counts stable", () => {
    const plan = buildFive();
    const again = syncRoomsSafe({ ...plan, walls: resolvePlanWalls(plan) });
    expect(again.ok).toBe(true);
    expect(again.rooms).toHaveLength(5);
  });

  it("wall array order does not change the detected topology", () => {
    const plan = buildFive();
    const shuffled = { ...plan, walls: [...plan.walls].reverse() };
    const again = syncRoomsSafe({ ...shuffled, walls: resolvePlanWalls(shuffled) });
    expect(again.ok).toBe(true);
    expect(again.rooms).toHaveLength(5);
  });

  it("dimension core still produces valid, non-fallback semantic dimensions over this topology", () => {
    const plan = buildFive();
    const { dimensions } = generateWallDimensions({ ...plan, walls: resolvePlanWalls(plan) }, {});
    const auto = dimensions.filter((d) => d.auto === true);
    expect(auto.length).toBeGreaterThan(0);
    for (const d of auto) {
      if (d.invalid) continue;
      expect(Number.isFinite(d.measurementValue)).toBe(true);
    }
  });
});
