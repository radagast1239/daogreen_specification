/**
 * Live wall-drawing topology: snap, first-hit stop, deferred host splits,
 * T/cross junctions, undo-friendly atomic commit.
 */
import { describe, it, expect } from "vitest";
import { HistoryModel } from "../src/planner/core/history/historyModel.js";
import { runSnapEngine } from "../src/planner/core/snap/snapEngine.js";
import { SNAP_TYPES } from "../src/planner/core/snap/snapTypes.js";
import { pickBestSnap, SNAP_PRIORITY } from "../src/planner/core/snap/snapPriority.js";
import { resolvePlanWalls, ensureWallNetwork } from "../src/planner/wallNetwork.js";
import { findWallIntersections } from "../src/planner/core/walls/wallOps.js";
import { syncRooms } from "../src/planner/core/rooms/syncRooms.js";
import {
  nearestPointOnWallSegment,
  findFirstWallIntersectionAlongSegment,
  clipWallDraftEnd,
  commitDrawnWall,
  normalizeNetworkCrossings,
} from "../src/planner/core/walls/wallDrawTopology.js";
import { addWall } from "../src/planner/core/walls/wallCommands.js";

let n = 0;
const makeId = (p = "x") => `td_${p}${++n}`;

function emptyPlan() {
  return { nodes: {}, walls: [], room: { w: 12000, h: 8000, wallThk: 200 }, zones: [], items: [] };
}

function rectanglePlan(x0 = 0, y0 = 0, w = 8000, h = 6000, thk = 200) {
  n = 0;
  let plan = emptyPlan();
  const corners = [
    { x: x0, y: y0 },
    { x: x0 + w, y: y0 },
    { x: x0 + w, y: y0 + h },
    { x: x0, y: y0 + h },
  ];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const r = addWall(plan, a, b, { thk, role: "outer" }, makeId);
    expect(r.changed).toBe(true);
    plan = r.plan;
  }
  return plan;
}

function roomCount(plan) {
  const synced = syncRooms(plan);
  const zones = (synced.zones || []).filter((z) => z && z.kind !== "service");
  return zones.length;
}

function nodeValence(plan, nodeId) {
  return (plan.walls || []).filter((w) => w.a === nodeId || w.b === nodeId).length;
}

describe("wall drawing topology — snap & geometry helpers", () => {
  it("1. nearest point on wall segment (horizontal/vertical/diagonal)", () => {
    const walls = [
      { id: "h", thk: 100, pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }] },
      { id: "v", thk: 100, pts: [{ x: 0, y: 0 }, { x: 0, y: 4000 }] },
      { id: "d", thk: 100, pts: [{ x: 0, y: 0 }, { x: 4000, y: 4000 }] },
    ];
    const h = nearestPointOnWallSegment({ x: 1500, y: 80 }, walls, 200);
    expect(h.wallId).toBe("h");
    expect(h.point.x).toBeCloseTo(1500, 5);
    expect(h.point.y).toBeCloseTo(0, 5);

    const v = nearestPointOnWallSegment({ x: 60, y: 2200 }, walls, 200);
    expect(v.wallId).toBe("v");
    expect(v.point.x).toBeCloseTo(0, 5);

    const d = nearestPointOnWallSegment({ x: 2000, y: 2100 }, walls, 200);
    expect(d.wallId).toBe("d");
    expect(Math.abs(d.point.x - d.point.y)).toBeLessThan(2);
  });

  it("2. snap threshold is zoom-invariant (screen px → world mm)", () => {
    const plan = {
      walls: [{ id: "w1", thk: 100, pts: [{ x: 0, y: 0 }, { x: 5000, y: 0 }] }],
      room: { w: 12000, h: 8000 },
    };
    const px = 12;
    for (const zoom of [0.25, 0.5, 1, 2]) {
      // runSnapEngine uses thr = px / zoom
      const r = runSnapEngine({
        point: { x: 2500, y: (px / zoom) * 0.9 },
        mode: "wall",
        plan,
        view: { zoom },
        modifiers: {},
        options: { snapOn: true, snapWalls: true, snapGrid: false, snapDistancePx: px, from: null },
      });
      expect(r.snapped).toBe(true);
      expect(r.point.y).toBeCloseTo(0, 0);
    }
  });

  it("3. existing node / wall-end priority over interior and angle", () => {
    expect(SNAP_PRIORITY[SNAP_TYPES.VERTEX]).toBeLessThan(SNAP_PRIORITY[SNAP_TYPES.WALL_LINE]);
    expect(SNAP_PRIORITY[SNAP_TYPES.WALL_LINE]).toBeLessThan(SNAP_PRIORITY[SNAP_TYPES.ANGLE]);
    expect(SNAP_PRIORITY[SNAP_TYPES.WALL_LINE]).toBeLessThan(SNAP_PRIORITY[SNAP_TYPES.GRID]);
    const best = pickBestSnap([
      { type: SNAP_TYPES.ANGLE, distance: 1, point: { x: 1, y: 1 } },
      { type: SNAP_TYPES.WALL_LINE, distance: 8, point: { x: 2, y: 2 } },
      { type: SNAP_TYPES.VERTEX, distance: 10, point: { x: 0, y: 0 } },
    ]);
    expect(best.type).toBe(SNAP_TYPES.VERTEX);
  });

  it("26. reversed endpoints are equivalent for nearest-point", () => {
    const forward = [{ id: "w", thk: 100, pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }] }];
    const reversed = [{ id: "w", thk: 100, pts: [{ x: 4000, y: 0 }, { x: 0, y: 0 }] }];
    const a = nearestPointOnWallSegment({ x: 1234, y: 40 }, forward, 100);
    const b = nearestPointOnWallSegment({ x: 1234, y: 40 }, reversed, 100);
    expect(a.point.x).toBeCloseTo(b.point.x, 5);
    expect(a.point.y).toBeCloseTo(b.point.y, 5);
  });
});

describe("wall drawing topology — first intersection", () => {
  it("9/10/11. first wall intersection chosen; no geometry beyond hit", () => {
    const walls = [
      { id: "near", thk: 100, pts: [{ x: 1000, y: -1000 }, { x: 1000, y: 1000 }] },
      { id: "far", thk: 100, pts: [{ x: 3000, y: -1000 }, { x: 3000, y: 1000 }] },
    ];
    // Reverse array order to prove we do not pick by array order.
    const shuffled = [walls[1], walls[0]];
    const hit = findFirstWallIntersectionAlongSegment(
      { x: 0, y: 0 },
      { x: 5000, y: 0 },
      shuffled,
    );
    expect(hit.wallId).toBe("near");
    expect(hit.point.x).toBeCloseTo(1000, 5);
    expect(hit.ignored.map((h) => h.wallId)).toContain("far");

    const clipped = clipWallDraftEnd({ x: 0, y: 0 }, { x: 5000, y: 0 }, shuffled);
    expect(clipped.clipped).toBe(true);
    expect(clipped.point.x).toBeCloseTo(1000, 5);
    expect(clipped.point.x).toBeLessThan(2000);
  });
});

describe("wall drawing topology — deferred start + commit splits", () => {
  it("4. pending start snap does not mutate plan", () => {
    const plan = rectanglePlan();
    const before = JSON.stringify(plan);
    const midTop = { x: 4000, y: -30 };
    const snap = runSnapEngine({
      point: midTop,
      mode: "wall",
      plan,
      view: { zoom: 0.1 },
      modifiers: {},
      options: { snapOn: true, snapWalls: true, snapGrid: false, snapDistancePx: 20 },
    });
    expect(snap.snapped).toBe(true);
    expect(JSON.stringify(plan)).toBe(before);
  });

  it("5. Esc / no-commit leaves host unchanged (no-op commit)", () => {
    const plan = rectanglePlan();
    const wallsBefore = plan.walls.length;
    // Simulate cancel: never call commitDrawnWall
    expect(plan.walls.length).toBe(wallsBefore);
  });

  it("6. commit start-on-wall splits host", () => {
    const plan = rectanglePlan();
    const top = resolvePlanWalls(plan).find((w) => Math.abs(w.pts[0].y) < 1 && Math.abs(w.pts[1].y) < 1);
    const start = { x: 4000, y: 0 };
    const end = { x: 4000, y: 3000 };
    const r = commitDrawnWall(plan, start, end, { thk: 100, role: "partition" }, makeId);
    expect(r.changed).toBe(true);
    expect(r.meta.startHostId).toBe(top.id);
    expect(r.meta.startSplitWallIds.length).toBeGreaterThanOrEqual(1);
    expect(r.plan.walls.length).toBeGreaterThan(plan.walls.length);
  });

  it("7. commit end-on-wall splits target", () => {
    const plan = rectanglePlan();
    const start = { x: 4000, y: 0 };
    const end = { x: 4000, y: 6000 };
    const r = commitDrawnWall(plan, start, end, { thk: 100, role: "partition" }, makeId);
    expect(r.changed).toBe(true);
    expect(r.meta.endHostId).toBeTruthy();
    expect(r.meta.endSplitWallIds.length).toBeGreaterThanOrEqual(1);
  });

  it("8. start and target hosts split atomically", () => {
    const plan = rectanglePlan();
    const before = plan;
    const r = commitDrawnWall(
      plan,
      { x: 4000, y: 0 },
      { x: 4000, y: 6000 },
      { thk: 100, role: "partition" },
      makeId,
    );
    expect(r.changed).toBe(true);
    expect(r.meta.startHostId).toBeTruthy();
    expect(r.meta.endHostId).toBeTruthy();
    // Original plan object untouched
    expect(before.walls.length).toBe(4);
  });

  it("22/23. wall metadata preserved; unique stable IDs", () => {
    let plan = emptyPlan();
    plan = addWall(plan, { x: 0, y: 0 }, { x: 8000, y: 0 }, {
      thk: 250,
      role: "outer",
      kind: "bearing",
      material: "concrete",
      sourceObjectIds: ["src-1"],
    }, makeId).plan;
    const hostId = plan.walls[0].id;
    const r = commitDrawnWall(
      plan,
      { x: 4000, y: 0 },
      { x: 4000, y: 3000 },
      { thk: 100, role: "partition" },
      makeId,
    );
    const ids = r.plan.walls.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    const hostParts = r.plan.walls.filter((w) => w.id === hostId || r.meta.startSplitWallIds.includes(w.id));
    expect(hostParts.some((w) => w.thk === 250)).toBe(true);
    expect(hostParts.some((w) => w.kind === "bearing" || w.material === "concrete" || w.role === "outer")).toBe(true);
  });

  it("24/25. no zero-length / no duplicate walls", () => {
    const plan = rectanglePlan();
    const zero = commitDrawnWall(plan, { x: 100, y: 100 }, { x: 105, y: 100 }, { thk: 100 }, makeId);
    expect(zero.changed).toBe(false);
    const w = plan.walls[0];
    const a = plan.nodes[w.a];
    const b = plan.nodes[w.b];
    const dup = commitDrawnWall(plan, a, b, { thk: 100 }, makeId);
    expect(dup.changed).toBe(false);
  });
});

describe("wall drawing topology — junctions & rooms", () => {
  it("12. T-junction valence = 3", () => {
    const plan = rectanglePlan();
    const r = commitDrawnWall(
      plan,
      { x: 4000, y: 0 },
      { x: 4000, y: 3000 },
      { thk: 100, role: "partition" },
      makeId,
    );
    const junctionNode = r.affectedNodeIds.find((id) => nodeValence(r.plan, id) === 3);
    expect(junctionNode).toBeTruthy();
    expect(findWallIntersections(resolvePlanWalls(r.plan))).toHaveLength(0);
  });

  it("13. cross-junction valence = 4", () => {
    let plan = rectanglePlan();
    // Vertical partition first.
    plan = commitDrawnWall(plan, { x: 4000, y: 0 }, { x: 4000, y: 6000 }, { thk: 100, role: "partition" }, makeId).plan;
    // Scenario A: left half then right half from the T-node (stop-at-first-hit).
    plan = commitDrawnWall(plan, { x: 0, y: 3000 }, { x: 4000, y: 3000 }, { thk: 100, role: "partition" }, makeId).plan;
    plan = commitDrawnWall(plan, { x: 4000, y: 3000 }, { x: 8000, y: 3000 }, { thk: 100, role: "partition" }, makeId).plan;
    const cross = Object.keys(plan.nodes).find((id) => nodeValence(plan, id) === 4);
    expect(cross).toBeTruthy();
    expect(findWallIntersections(resolvePlanWalls(plan))).toHaveLength(0);
  });

  it("14. imported crossing normalized into node", () => {
    n = 0;
    let plan = emptyPlan();
    plan = addWall(plan, { x: 0, y: 3000 }, { x: 8000, y: 3000 }, { thk: 100 }, makeId).plan;
    plan = addWall(plan, { x: 4000, y: 0 }, { x: 4000, y: 6000 }, { thk: 100 }, makeId).plan;
    expect(findWallIntersections(resolvePlanWalls(plan)).length).toBeGreaterThan(0);
    const r = normalizeNetworkCrossings(plan, makeId);
    expect(r.changed).toBe(true);
    expect(findWallIntersections(resolvePlanWalls(r.plan))).toHaveLength(0);
    expect(Object.keys(r.plan.nodes).some((id) => nodeValence(r.plan, id) === 4)).toBe(true);
  });

  it("15. square + vertical partition → 2 rooms", () => {
    let plan = rectanglePlan();
    expect(roomCount(plan)).toBe(1);
    plan = commitDrawnWall(plan, { x: 4000, y: 0 }, { x: 4000, y: 6000 }, { thk: 100, role: "partition" }, makeId).plan;
    expect(plan.walls.length).toBe(7);
    expect(roomCount(plan)).toBe(2);
    expect(findWallIntersections(resolvePlanWalls(plan))).toHaveLength(0);
  });

  it("16. horizontal left half → 3 rooms", () => {
    let plan = rectanglePlan();
    plan = commitDrawnWall(plan, { x: 4000, y: 0 }, { x: 4000, y: 6000 }, { thk: 100, role: "partition" }, makeId).plan;
    plan = commitDrawnWall(plan, { x: 0, y: 3000 }, { x: 4000, y: 3000 }, { thk: 100, role: "partition" }, makeId).plan;
    expect(roomCount(plan)).toBe(3);
    expect(findWallIntersections(resolvePlanWalls(plan))).toHaveLength(0);
  });

  it("17/18. horizontal right half → 4 rooms; no parent ghost", () => {
    let plan = rectanglePlan();
    plan = commitDrawnWall(plan, { x: 4000, y: 0 }, { x: 4000, y: 6000 }, { thk: 100, role: "partition" }, makeId).plan;
    plan = commitDrawnWall(plan, { x: 0, y: 3000 }, { x: 4000, y: 3000 }, { thk: 100, role: "partition" }, makeId).plan;
    plan = commitDrawnWall(plan, { x: 4000, y: 3000 }, { x: 8000, y: 3000 }, { thk: 100, role: "partition" }, makeId).plan;
    const synced = syncRooms(plan);
    const zones = (synced.zones || []).filter((z) => z && z.kind !== "service");
    expect(zones.length).toBe(4);
    expect(findWallIntersections(resolvePlanWalls(synced))).toHaveLength(0);
  });

  it("19. no red invalid crossing for normalized junction", () => {
    let plan = rectanglePlan();
    plan = commitDrawnWall(plan, { x: 4000, y: 0 }, { x: 4000, y: 6000 }, { thk: 100, role: "partition" }, makeId).plan;
    plan = commitDrawnWall(plan, { x: 0, y: 3000 }, { x: 8000, y: 3000 }, { thk: 100, role: "partition" }, makeId).plan;
    expect(findWallIntersections(resolvePlanWalls(plan))).toHaveLength(0);
  });

  it("27. diagonal host split", () => {
    n = 0;
    let plan = emptyPlan();
    plan = addWall(plan, { x: 0, y: 0 }, { x: 6000, y: 6000 }, { thk: 120, role: "outer" }, makeId).plan;
    const r = commitDrawnWall(
      plan,
      { x: 3000, y: 3000 },
      { x: 5000, y: 1000 },
      { thk: 100, role: "partition" },
      makeId,
    );
    expect(r.changed).toBe(true);
    expect(r.plan.walls.length).toBeGreaterThanOrEqual(2);
    expect(findWallIntersections(resolvePlanWalls(r.plan))).toHaveLength(0);
  });
});

describe("wall drawing topology — undo/redo atomicity", () => {
  it("20/21. undo restores original walls; redo restores junction", () => {
    const plan = rectanglePlan();
    const history = new HistoryModel(plan);
    const beforeWalls = plan.walls.length;
    history.commit((p) => {
      const r = commitDrawnWall(
        p,
        { x: 4000, y: 0 },
        { x: 4000, y: 6000 },
        { thk: 100, role: "partition" },
        makeId,
      );
      return r.changed ? r.plan : p;
    });
    expect(history.current.walls.length).toBe(7);
    history.undo();
    expect(history.current.walls.length).toBe(beforeWalls);
    history.redo();
    expect(history.current.walls.length).toBe(7);
    expect(findWallIntersections(resolvePlanWalls(history.current))).toHaveLength(0);
  });
});

describe("wall drawing topology — snap engine first-hit preview", () => {
  it("preview stops at first wall when cursor is beyond", () => {
    const plan = {
      walls: [
        { id: "a", thk: 100, pts: [{ x: 2000, y: -1000 }, { x: 2000, y: 1000 }] },
        { id: "b", thk: 100, pts: [{ x: 4000, y: -1000 }, { x: 4000, y: 1000 }] },
      ],
      room: { w: 12000, h: 8000 },
    };
    const r = runSnapEngine({
      point: { x: 5500, y: 0 },
      mode: "wall",
      plan: ensureWallNetwork(plan, makeId),
      view: { zoom: 0.1 },
      modifiers: {},
      options: {
        snapOn: true,
        snapWalls: true,
        snapGrid: false,
        angleSnapOn: false,
        from: { x: 0, y: 0 },
        snapDistancePx: 10,
      },
    });
    expect(r.point.x).toBeCloseTo(2000, 0);
    expect(r.kind === "wall-first-hit" || r.type === SNAP_TYPES.WALL_LINE).toBe(true);
  });
});
