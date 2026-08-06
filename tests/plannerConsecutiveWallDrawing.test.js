/**
 * Regression cover for the defects that made consecutive wall drawing fail.
 *
 * Two real product defects were found by the browser acceptance run:
 *   1. the post-commit suppression flag ate the first press of every wall drawn
 *      after a commit, so partitions 2..n silently did nothing (three rooms);
 *   2. derived-state setPlan syncs pushed no-op history checkpoints, so one
 *      Ctrl+Z after drawing appeared to do nothing.
 *
 * The gesture-level contract for (1) lives in wallGesturesFaceReferences.test.js
 * ("7b."). Here we cover the drawing sequence, the topology it produces, the
 * dimension face references over that topology, and the history semantics.
 */
import { describe, it, expect } from "vitest";
import { commitDrawnWall } from "../src/planner/core/walls/wallDrawTopology.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";
import { syncRoomsSafe } from "../src/planner/core/rooms/syncRooms.js";
import { generateWallDimensions } from "../src/planner/core/dimensions/generateWallDimensions.js";
import { FACE_REF_KINDS } from "../src/planner/core/walls/wallFaceReferences.js";
import { HistoryModel } from "../src/planner/core/history/historyModel.js";
import {
  createWallGestureState,
  wallGesturePointerDown,
  wallGesturePointerMove,
  wallGestureMarkCommitted,
} from "../src/planner/core/walls/wallDrawGestures.js";

const X0 = 0, Y0 = 0, X1 = 8000, Y1 = 6000;
const MIDX = 4000, MIDY = 3000;

let seq = 0;
const mkId = (p = "id") => `${p}_${++seq}`;

function emptyPlan() {
  return {
    room: { w: 12000, h: 8000, wallThk: 100, height: 3000, defaultRoomHeightMm: 3000 },
    nodes: {}, walls: [], items: [], lines: [], zones: [], rooms: [],
    labels: [], dimensions: [], structurals: [], validationWarnings: [],
  };
}

const OUTER = { role: "outer", kind: "new", thicknessSide: "center", thk: 100, height: 3000 };
const PART = { role: "partition", kind: "new", thicknessSide: "center", thk: 100, height: 3000 };

/** Commit one drawn wall the way finishWallChain does, then re-sync rooms. */
function commit(plan, a, b, props) {
  const r = commitDrawnWall(plan, a, b, { ...props, chainId: mkId("ch") }, mkId);
  expect(r.changed).toBe(true);
  const safe = syncRoomsSafe({ ...r.plan, walls: resolvePlanWalls(r.plan) });
  expect(safe.ok).toBe(true);
  return {
    plan: { ...r.plan, rooms: safe.rooms, zones: safe.zones },
    meta: r.meta,
    warnings: r.warnings || [],
  };
}

/** The exact four gestures the browser run performs. */
function drawFourRooms() {
  let plan = emptyPlan();
  const warnings = [];
  const snapshots = {};

  // 1. closed rectangle (four chained segments)
  for (const [a, b] of [
    [{ x: X0, y: Y0 }, { x: X1, y: Y0 }],
    [{ x: X1, y: Y0 }, { x: X1, y: Y1 }],
    [{ x: X1, y: Y1 }, { x: X0, y: Y1 }],
    [{ x: X0, y: Y1 }, { x: X0, y: Y0 }],
  ]) {
    const r = commit(plan, a, b, OUTER);
    plan = r.plan;
    warnings.push(...r.warnings);
  }
  snapshots.rectangle = plan;

  // 2-3. vertical partition: top wall -> bottom wall
  let r = commit(plan, { x: MIDX, y: Y0 }, { x: MIDX, y: Y1 }, PART);
  plan = r.plan; warnings.push(...r.warnings);
  snapshots.vertical = plan;

  // 4-5. left wall -> central vertical
  r = commit(plan, { x: X0, y: MIDY }, { x: MIDX, y: MIDY }, PART);
  plan = r.plan; warnings.push(...r.warnings);
  snapshots.leftHorizontal = plan;

  // 6-8. central cross node -> right outer wall
  r = commit(plan, { x: MIDX, y: MIDY }, { x: X1, y: MIDY }, PART);
  plan = r.plan; warnings.push(...r.warnings);
  snapshots.fourth = plan;

  return { plan, warnings, snapshots };
}

const seg = (plan, w) => {
  const a = plan.nodes[w.a] || w.a;
  const b = plan.nodes[w.b] || w.b;
  return [a, b];
};
const lenOf = (plan, w) => {
  const [a, b] = seg(plan, w);
  return Math.hypot(b.x - a.x, b.y - a.y);
};
const perpFrom = (a, b, pt) => {
  const vx = b.x - a.x, vy = b.y - a.y;
  const L = Math.hypot(vx, vy) || 1;
  return Math.abs((pt.x - a.x) * vy - (pt.y - a.y) * vx) / L;
};

describe("consecutive wall drawing — four room flow", () => {
  it("1. four drawing gestures produce exactly four rooms", () => {
    const { plan } = drawFourRooms();
    expect(plan.rooms).toHaveLength(4);
  });

  it("2. central cross node exists with valence 4 and no orphan nodes", () => {
    const { plan } = drawFourRooms();
    const walls = resolvePlanWalls(plan);
    const entries = Object.entries(plan.nodes);
    const cross = entries.find(([, v]) => Math.hypot(v.x - MIDX, v.y - MIDY) < 1);
    expect(cross).toBeTruthy();
    const [crossId] = cross;
    const incident = walls.filter((w) => w.a === crossId || w.b === crossId);
    expect(incident).toHaveLength(4);

    const orphans = entries.filter(([k]) => walls.every((w) => w.a !== k && w.b !== k));
    expect(orphans).toEqual([]);
  });

  it("3. the fourth partition really is attached to the cross node", () => {
    const { snapshots } = drawFourRooms();
    const before = resolvePlanWalls(snapshots.leftHorizontal);
    const after = resolvePlanWalls(snapshots.fourth);
    expect(after.length).toBeGreaterThan(before.length);
    const added = after.filter((w) => !before.some((p) => p.id === w.id));
    // the new branch starts at the cross node and ends on the right outer wall
    const branch = added.find((w) => {
      const [a, b] = seg(snapshots.fourth, w);
      return Math.abs(a.y - MIDY) < 1 && Math.abs(b.y - MIDY) < 1;
    });
    expect(branch).toBeTruthy();
    const [ba, bb] = seg(snapshots.fourth, branch);
    const xs = [ba.x, bb.x].sort((p, q) => p - q);
    expect(xs[0]).toBeCloseTo(MIDX, 0);
    expect(xs[1]).toBeCloseTo(X1, 0);
  });

  it("4. host coordinates are unchanged through all four commits (split only)", () => {
    const { snapshots } = drawFourRooms();
    const stages = [
      ["rectangle", "vertical"],
      ["vertical", "leftHorizontal"],
      ["leftHorizontal", "fourth"],
    ];
    for (const [fromKey, toKey] of stages) {
      const before = resolvePlanWalls(snapshots[fromKey]);
      const after = resolvePlanWalls(snapshots[toKey]);
      for (const host of before) {
        const [ha, hb] = seg(snapshots[fromKey], host);
        // every part collinear with this host must stay exactly on its centerline
        const parts = after.filter((w) => {
          const [a, b] = seg(snapshots[toKey], w);
          return perpFrom(ha, hb, a) < 0.5 && perpFrom(ha, hb, b) < 0.5;
        });
        for (const p of parts) {
          const [pa, pb] = seg(snapshots[toKey], p);
          expect(perpFrom(ha, hb, pa)).toBeLessThan(0.5);
          expect(perpFrom(ha, hb, pb)).toBeLessThan(0.5);
          expect(p.thk).toBe(host.thk);
        }
      }
    }
  });

  it("5. a split host keeps its total length and thickness", () => {
    let plan = emptyPlan();
    let r = commitDrawnWall(plan, { x: X0, y: Y0 }, { x: X1, y: Y0 }, { ...OUTER, chainId: mkId("ch") }, mkId);
    plan = r.plan;
    const host = resolvePlanWalls(plan)[0];
    const hostLen = lenOf(plan, host);
    const [ha, hb] = seg(plan, host);

    r = commitDrawnWall(plan, { x: MIDX, y: Y0 }, { x: MIDX, y: 2000 }, { ...PART, chainId: mkId("ch") }, mkId);
    expect(r.changed).toBe(true);
    const after = resolvePlanWalls(r.plan);
    const parts = after.filter((w) => {
      const [a, b] = seg(r.plan, w);
      return perpFrom(ha, hb, a) < 0.5 && perpFrom(ha, hb, b) < 0.5;
    });
    expect(parts.length).toBe(2);
    const sum = parts.reduce((acc, w) => acc + lenOf(r.plan, w), 0);
    expect(sum).toBeCloseTo(hostLen, 3);
    for (const p of parts) expect(p.thk).toBe(host.thk);
  });

  it("6. room IDs and names are unique after the fourth commit", () => {
    const { plan } = drawFourRooms();
    const ids = plan.rooms.map((r) => r.id);
    const names = plan.rooms.map((r) => r.name);
    expect(new Set(ids).size).toBe(4);
    expect(new Set(names).size).toBe(4);
    expect(names.filter((n) => n === names[0])).toHaveLength(1);
  });

  it("7. re-syncing the same geometry keeps IDs and names stable (reload path)", () => {
    const { plan } = drawFourRooms();
    const again = syncRoomsSafe({ ...plan, walls: resolvePlanWalls(plan) });
    expect(again.ok).toBe(true);
    expect(again.rooms.map((r) => r.id).sort()).toEqual(plan.rooms.map((r) => r.id).sort());
    expect(again.rooms.map((r) => r.name).sort()).toEqual(plan.rooms.map((r) => r.name).sort());
  });

  it("8. wall array order does not change the detected room set", () => {
    const { plan } = drawFourRooms();
    const shuffled = { ...plan, walls: [...plan.walls].reverse() };
    const again = syncRoomsSafe({ ...shuffled, walls: resolvePlanWalls(shuffled) });
    expect(again.ok).toBe(true);
    expect(again.rooms).toHaveLength(4);
    expect(again.rooms.map((r) => r.id).sort()).toEqual(plan.rooms.map((r) => r.id).sort());
  });

  it("9. drawing produces no invalid-crossing diagnostics", () => {
    const { warnings, plan } = drawFourRooms();
    const bad = [...warnings, ...(plan.validationWarnings || [])]
      .filter((w) => /cross|intersect|invalid/i.test(String(w?.code || w?.id || w?.message || w)));
    expect(bad).toEqual([]);
  });
});

describe("consecutive wall drawing — dimension face references", () => {
  const dimsOf = (plan) => generateWallDimensions(
    { ...plan, walls: resolvePlanWalls(plan) },
    {},
  ).dimensions.filter((d) => d.auto === true);

  it("10. every internal_clear references a joined room face", () => {
    const { plan } = drawFourRooms();
    // Phase 2F1: room_edge_clear is the canonical room-face clear span.
    const internal = dimsOf(plan).filter((d) => (
      d.kind === "room_edge_clear" || d.kind === "internal_clear"
    ));
    expect(internal.length).toBeGreaterThan(0);
    for (const d of internal) {
      expect(d.referenceKind).toBe(FACE_REF_KINDS.JOINED_ROOM_FACE);
    }
  });

  it("11. every external_overall references the joined outer face", () => {
    const { plan } = drawFourRooms();
    const external = dimsOf(plan).filter((d) => d.kind === "external_overall");
    expect(external.length).toBeGreaterThan(0);
    for (const d of external) {
      expect(d.referenceKind).toBe(FACE_REF_KINDS.JOINED_OUTER_FACE);
    }
  });

  it("12. no semantic dimension silently falls back to the raw centerline", () => {
    const { plan } = drawFourRooms();
    const semantic = dimsOf(plan).filter((d) => (
      d.kind === "internal_clear" || d.kind === "external_overall" || d.kind === "wall_length"
    ));
    for (const d of semantic) {
      if (d.invalid) continue; // invalid/hidden is the allowed outcome, not a fallback
      expect(d.referenceKind).toBeTruthy();
      expect(d.referenceKind).not.toBe(FACE_REF_KINDS.CENTERLINE);
    }
  });

  it("13. semantic anchors sit half a thickness off the wall centerline, never on it", () => {
    const { plan } = drawFourRooms();
    const walls = resolvePlanWalls(plan);
    const parallelHost = (p1, p2) => {
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const dl = Math.hypot(dx, dy) || 1;
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      let best = null, bestD = Infinity;
      for (const w of walls) {
        const [a, b] = seg(plan, w);
        const wl = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const par = Math.abs(((b.x - a.x) / wl) * (dx / dl) + ((b.y - a.y) / wl) * (dy / dl));
        if (par < 0.98) continue;
        const d = perpFrom(a, b, mid);
        if (d < bestD) { bestD = d; best = w; }
      }
      return { wall: best, dist: bestD };
    };
    const semantic = dimsOf(plan).filter(
      (d) => (d.kind === "internal_clear" || d.kind === "external_overall") && !d.invalid,
    );
    expect(semantic.length).toBeGreaterThan(0);
    for (const d of semantic) {
      const { wall, dist } = parallelHost(d.p1, d.p2);
      expect(wall).toBeTruthy();
      expect(dist).toBeGreaterThan(0.5); // never on the centerline
      expect(dist).toBeCloseTo(wall.thk / 2, 1);
    }
  });

  it("14. selection does not change auto dimension anchors or values", () => {
    const { plan } = drawFourRooms();
    const sig = (list) => JSON.stringify(list
      .map((d) => [d.kind, d.p1.x, d.p1.y, d.p2.x, d.p2.y, d.referenceKind])
      .sort((a, b) => String(a).localeCompare(String(b))));
    const unselected = sig(dimsOf(plan));
    // selection is UI state; the generator must be independent of it
    const withSelection = sig(dimsOf({ ...plan, selectedWallId: resolvePlanWalls(plan)[0].id }));
    expect(withSelection).toBe(unselected);
  });
});

describe("wall tool stays usable across commits", () => {
  it("15. wall tool remains active after a commit (gesture returns to idle, not to select)", () => {
    let s = createWallGestureState();
    s = wallGesturePointerDown(s, {
      point: { x: MIDX, y: Y0 }, screenX: 10, screenY: 10, hostWallId: "top", now: 1000,
    }).state;
    s = wallGesturePointerMove(s, { x: MIDX, y: 2000 }).state;
    const commitRes = wallGesturePointerDown(s, {
      point: { x: MIDX, y: Y1 }, screenX: 10, screenY: 400, hostWallId: "bot", now: 1400,
    });
    expect(commitRes.action).toBe("commit");
    const idle = wallGestureMarkCommitted(commitRes.state);
    expect(idle.phase).toBe("idle");
    expect(idle.start).toBeNull();
  });

  it("16. the cross node can immediately start the next wall", () => {
    // straight after a commit the very next press must open a new pending draft
    const committed = wallGestureMarkCommitted(createWallGestureState());
    const next = wallGesturePointerDown(committed, {
      point: { x: MIDX, y: MIDY }, screenX: 200, screenY: 200, hostWallId: "central", now: 2000,
    });
    expect(next.action).toBe("start-pending");
    expect(next.state.phase).toBe("pending");
    expect(next.state.start).toEqual({ x: MIDX, y: MIDY });

    // and that draft can be completed onto the right outer wall
    const moved = wallGesturePointerMove(next.state, { x: 6000, y: MIDY }).state;
    const done = wallGesturePointerDown(moved, {
      point: { x: X1, y: MIDY }, screenX: 600, screenY: 200, hostWallId: "right", now: 2400,
    });
    expect(done.action).toBe("commit");
    expect(done.start).toEqual({ x: MIDX, y: MIDY });
    expect(done.end).toEqual({ x: X1, y: MIDY });
  });

  it("17. a cancelled draft mutates no plan geometry", () => {
    const plan = drawFourRooms().plan;
    const wallsBefore = resolvePlanWalls(plan).length;
    const nodesBefore = Object.keys(plan.nodes).length;

    // start a draft on a host wall and abandon it — the gesture layer owns no plan
    let s = wallGesturePointerDown(createWallGestureState(), {
      point: { x: MIDX, y: Y0 }, screenX: 5, screenY: 5, hostWallId: "top", now: 10,
    }).state;
    s = wallGesturePointerMove(s, { x: MIDX, y: 1200 }).state;
    s = createWallGestureState(); // Esc

    expect(s.phase).toBe("idle");
    expect(resolvePlanWalls(plan)).toHaveLength(wallsBefore);
    expect(Object.keys(plan.nodes)).toHaveLength(nodesBefore);
  });

  it("18. stationary double click opens properties instead of drawing", () => {
    let s = wallGesturePointerDown(createWallGestureState(), {
      point: { x: MIDX, y: Y0 }, screenX: 50, screenY: 50, hostWallId: "top", now: 1000,
    }).state;
    const r = wallGesturePointerDown(s, {
      point: { x: MIDX, y: Y0 }, screenX: 51, screenY: 50, hostWallId: "top", now: 1150,
    });
    expect(r.action).toBe("open-properties");
    expect(r.wallId).toBe("top");
    expect(r.state.phase).toBe("idle");
  });
});

describe("history records one undo step per user action", () => {
  it("19. a no-op derived sync does not create an undo step", () => {
    const base = { walls: ["w1"], rooms: [] };
    const h = new HistoryModel(base);
    h.commit((p) => ({ ...p, walls: [...p.walls, "w2"] }));
    // derived syncs that decide nothing changed return the same object
    h.setPlan((p) => p);
    h.setPlan((p) => p);
    h.undo();
    expect(h.current.walls).toEqual(["w1"]);
  });

  it("20. one undo removes the last committed wall, redo restores it", () => {
    const h = new HistoryModel({ walls: [] });
    h.commit((p) => ({ ...p, walls: ["a"] }));
    h.replace((p) => ({ ...p, rooms: ["r1"] })); // derived room sync
    h.commit((p) => ({ ...p, walls: [...p.walls, "b"] }));
    h.replace((p) => ({ ...p, rooms: ["r1", "r2"] }));

    h.undo();
    expect(h.current.walls).toEqual(["a"]);
    h.redo();
    expect(h.current.walls).toEqual(["a", "b"]);
  });

  it("21. replace() does not swallow the checkpoint of the next real edit", () => {
    const h = new HistoryModel({ v: 0 });
    h.replace((p) => ({ ...p, derived: 1 }));
    h.setPlan((p) => ({ ...p, v: 1 })); // a genuine user edit
    expect(h.canUndo).toBe(true);
    h.undo();
    expect(h.current.v).toBe(0);
  });

  it("22. real changes are still recorded (no regression in normal history)", () => {
    const h = new HistoryModel({ v: 0 });
    h.setPlan({ v: 1 });
    h.setPlan({ v: 2 });
    expect(h.current.v).toBe(2);
    h.undo();
    expect(h.current.v).toBe(1);
    h.undo();
    expect(h.current.v).toBe(0);
    expect(h.canUndo).toBe(false);
  });
});
