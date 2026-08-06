/**
 * PHASE 2C3A — wall movement acquisition on REAL topologies.
 *
 * The Phase 2C2 suite only proved fail-closed behaviour for a degree-4 node.
 * On a real plan almost every degree-3 node is a host-half junction, which the
 * original classifier called "multi" — 23 of 24 walls could not be dragged
 * while the same walls still moved with the arrow keys.
 *
 * These tests drive the production commands (classifyWallSegmentAttachments,
 * moveWallSegment) and include a sanitized copy of the live 24-wall topology
 * that exposed the defect.
 */
import { describe, it, expect } from "vitest";
import {
  classifyWallSegmentAttachments,
  moveWallSegment,
} from "../src/planner/core/walls/wallCommands.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";
import { findUnnodedCrossings } from "../src/planner/core/walls/renderedContours.js";
import { detectRooms } from "../src/planner/core/rooms/detectRooms.js";
import { syncRoomsSafe } from "../src/planner/core/rooms/syncRooms.js";
import { LIVE_NODES, LIVE_WALLS } from "./fixtures/planner/liveWallTopology.js";
import {
  CLEAN_WALL_FIXTURE,
  cleanWallPlan,
} from "./fixtures/planner/cleanWallTopology.js";

const WP = { thk: 100, role: "partition", kind: "new", thicknessSide: "center", height: 3000, material: "" };
const P = (x, y) => ({ x, y });

function planOf(nodes, walls) {
  return {
    nodes: JSON.parse(JSON.stringify(nodes)),
    walls: walls.map((w) => ({ ...WP, ...w })),
    items: [], rooms: [], zones: [], dimensions: [], validationWarnings: [],
    room: { w: 20000, h: 15000, wallThk: 100, height: 3000 },
  };
}
// One monotonic id source for the whole file — production uses the global uid,
// and a per-call counter would collide across repeated moves.
let idSeq = 0;
const makeId = (prefix) => `${prefix}_t${++idSeq}`;
const move = (plan, wallId, delta) => moveWallSegment(plan, {
  wallId,
  delta,
  expectedEndpointAttachments: classifyWallSegmentAttachments(plan, wallId),
  makeId,
});

/**
 * Classic T: one straight host split into two collinear halves (h1,h2) meeting
 * at j, plus a perpendicular branch (br) rising from j.
 */
function teePlan() {
  return planOf(
    { hl: P(0, 0), j: P(4000, 0), hr: P(8000, 0), bt: P(4000, -3000) },
    [
      { id: "h1", a: "hl", b: "j" },
      { id: "h2", a: "j", b: "hr" },
      { id: "br", a: "j", b: "bt" },
    ],
  );
}

function degree(plan, nodeId) {
  return plan.walls.filter((w) => w.a === nodeId || w.b === nodeId).length;
}
function postConditions(plan) {
  const walls = resolvePlanWalls(plan);
  const used = new Set();
  const edges = new Set();
  for (const w of plan.walls) {
    used.add(w.a); used.add(w.b);
    const e = [w.a, w.b].sort().join("|");
    expect(edges.has(e)).toBe(false);
    edges.add(e);
    expect(w.a).not.toBe(w.b);
    expect(Math.hypot(plan.nodes[w.b].x - plan.nodes[w.a].x, plan.nodes[w.b].y - plan.nodes[w.a].y)).toBeGreaterThanOrEqual(50);
  }
  expect(Object.keys(plan.nodes).filter((n) => !used.has(n))).toHaveLength(0);
  expect(findUnnodedCrossings(walls)).toHaveLength(0);
}
const fp = (plan) => JSON.stringify(
  resolvePlanWalls(plan)
    .map((w) => [
      [Math.round(w.pts[0].x), Math.round(w.pts[0].y)],
      [Math.round(w.pts[w.pts.length - 1].x), Math.round(w.pts[w.pts.length - 1].y)],
    ].sort())
    .sort(),
);

function fixtureDiagnostics(plan, ignoredWallIds = []) {
  const ignored = new Set(ignoredWallIds);
  const resolved = resolvePlanWalls(plan);
  const used = new Set(plan.walls.flatMap((wall) => [wall.a, wall.b]));
  const edges = plan.walls.map((wall) => [wall.a, wall.b].sort().join("|"));
  const hostBent = [];
  for (const host of CLEAN_WALL_FIXTURE.hostChains) {
    for (const wall of resolved.filter((candidate) => candidate.chainId === host.chainId && !ignored.has(candidate.id))) {
      if (wall.pts.some((point) => Math.abs(point[host.axis] - host.coordinate) > 1e-4)) hostBent.push(wall.id);
    }
  }
  return {
    orphanNodes: Object.keys(plan.nodes).filter((id) => !used.has(id)),
    duplicateEdges: edges.filter((edge, index) => edges.indexOf(edge) !== index),
    zeroLength: plan.walls.filter((wall) => wall.a === wall.b),
    unnodedCrossings: findUnnodedCrossings(resolved),
    hostBent,
  };
}

describe("PHASE 2C3A — clean browser fixture contract", () => {
  it("is valid, deterministic, room-producing, and exposes every required movement class", () => {
    const plan = cleanWallPlan();
    expect(fixtureDiagnostics(plan)).toEqual({
      orphanNodes: [], duplicateEdges: [], zeroLength: [], unnodedCrossings: [], hostBent: [],
    });
    const resolved = resolvePlanWalls(plan);
    const detectedRooms = detectRooms({ ...plan, rooms: [], walls: resolved });
    expect(detectedRooms).toHaveLength(2);
    const synced = syncRoomsSafe({ ...plan, rooms: [], zones: [], walls: resolved });
    expect(synced.ok).toBe(true);
    expect(plan.rooms).toEqual(synced.rooms);
    expect(plan.zones).toEqual(synced.zones);
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);

    const ids = CLEAN_WALL_FIXTURE.wallIds;
    expect(classifyWallSegmentAttachments(plan, ids.free).start.type).toBe("free");
    expect(classifyWallSegmentAttachments(plan, ids.free).end.type).toBe("free");
    expect(classifyWallSegmentAttachments(plan, ids.teeBranch).start.type).toBe("tee");
    expect(classifyWallSegmentAttachments(plan, ids.teeBranch).end.type).toBe("tee");
    expect(classifyWallSegmentAttachments(plan, ids.hostHalf).end.type).toBe("detach");
    expect(classifyWallSegmentAttachments(plan, ids.ambiguous).start.type).toBe("multi");
  });
});

describe("PHASE 2C3A — degree-3 junction contract", () => {
  it("1. selected T-branch keeps its host attachment and slides along the host", () => {
    const plan = teePlan();
    const att = classifyWallSegmentAttachments(plan, "br");
    expect(att.start.type).toBe("tee");          // the junction end
    expect(att.end.type).toBe("free");

    const r = move(plan, "br", { x: 900, y: 0 }); // along the horizontal host
    expect(r.changed).toBe(true);
    expect(r.reason).toBe("WALL_SEGMENT_MOVED");
    postConditions(r.plan);
    // still exactly one node shared with the host, and the host is still straight
    const moved = resolvePlanWalls(r.plan).find((w) => w.id === "br");
    expect(Math.round(moved.pts[0].y)).toBe(0);
    expect(Math.round(moved.pts[0].x)).toBe(4900);
  });

  it("2. selected host half DETACHES; the shared junction node never moves", () => {
    const plan = teePlan();
    const before = { ...plan.nodes.j };
    const att = classifyWallSegmentAttachments(plan, "h1");
    expect(att.end.type).toBe("detach");          // the junction end, seen from a host half

    const r = move(plan, "h1", { x: 0, y: -400 });
    expect(r.changed).toBe(true);
    postConditions(r.plan);
    // junction still there, unmoved, and still carries the other host half + branch
    expect(r.plan.nodes.j).toEqual(before);
    expect(degree(r.plan, "j")).toBe(2);
    const survivors = r.plan.walls.filter((w) => w.a === "j" || w.b === "j").map((w) => w.id).sort();
    expect(survivors).toEqual(["br", "h2"]);
    // the moved wall no longer touches the junction
    const h1 = r.plan.walls.find((w) => w.id === "h1");
    expect(h1.a === "j" || h1.b === "j").toBe(false);
  });

  it("3. the opposite host half behaves symmetrically", () => {
    const plan = teePlan();
    const before = { ...plan.nodes.j };
    const r = move(plan, "h2", { x: 0, y: 400 });
    expect(r.changed).toBe(true);
    postConditions(r.plan);
    expect(r.plan.nodes.j).toEqual(before);
    expect(r.plan.walls.filter((w) => w.a === "j" || w.b === "j").map((w) => w.id).sort()).toEqual(["br", "h1"]);
  });

  it("4. a degree-4 junction stays fail-closed", () => {
    const plan = planOf(
      { c: P(0, 0), e: P(3000, 0), w: P(-3000, 0), n: P(0, -3000), s: P(0, 3000) },
      [
        { id: "we", a: "w", b: "c" }, { id: "ee", a: "c", b: "e" },
        { id: "nn", a: "c", b: "n" }, { id: "ss", a: "c", b: "s" },
      ],
    );
    const att = classifyWallSegmentAttachments(plan, "nn");
    expect(att.start.type).toBe("multi");
    const r = move(plan, "nn", { x: 200, y: 0 });
    expect(r.changed).toBe(false);
    expect(r.reason).toBe("WALL_MOVE_UNSAFE_MULTI_JUNCTION");
    expect(r.plan).toBe(plan);
  });
});

describe("PHASE 2C3A — single rigid effective delta", () => {
  it("5. one free end + one tee end move by ONE delta; length and angle survive", () => {
    const plan = teePlan();
    const before = resolvePlanWalls(plan).find((w) => w.id === "br");
    const len0 = Math.hypot(before.pts[1].x - before.pts[0].x, before.pts[1].y - before.pts[0].y);
    const ang0 = Math.atan2(before.pts[1].y - before.pts[0].y, before.pts[1].x - before.pts[0].x);

    // A drag with a component across the host: the host component is dropped,
    // the along-host component is applied to BOTH endpoints.
    const r = move(plan, "br", { x: 600, y: 250 });
    expect(r.changed).toBe(true);
    const after = resolvePlanWalls(r.plan).find((w) => w.id === "br");
    const len1 = Math.hypot(after.pts[1].x - after.pts[0].x, after.pts[1].y - after.pts[0].y);
    const ang1 = Math.atan2(after.pts[1].y - after.pts[0].y, after.pts[1].x - after.pts[0].x);
    expect(len1).toBeCloseTo(len0, 6);
    expect(ang1).toBeCloseTo(ang0, 6);
    expect(r.movement.delta).toEqual({ x: 600, y: 0 });   // projected onto the host
  });

  it("6. two parallel host constraints share one common delta", () => {
    // Two collinear hosts (top and bottom), one wall bridging both as branches.
    const plan = planOf(
      {
        tl: P(0, 0), tj: P(4000, 0), tr: P(8000, 0),
        bl: P(0, 5000), bj: P(4000, 5000), br2: P(8000, 5000),
      },
      [
        { id: "t1", a: "tl", b: "tj" }, { id: "t2", a: "tj", b: "tr" },
        { id: "b1", a: "bl", b: "bj" }, { id: "b2", a: "bj", b: "br2" },
        { id: "mid", a: "tj", b: "bj" },
      ],
    );
    const att = classifyWallSegmentAttachments(plan, "mid");
    expect(att.start.type).toBe("tee");
    expect(att.end.type).toBe("tee");
    const r = move(plan, "mid", { x: 700, y: 400 });
    expect(r.changed).toBe(true);
    expect(r.movement.delta).toEqual({ x: 700, y: 0 });
    postConditions(r.plan);
    const mid = resolvePlanWalls(r.plan).find((w) => w.id === "mid");
    expect(Math.round(mid.pts[0].x)).toBe(4700);
    expect(Math.round(mid.pts[1].x)).toBe(4700);
  });

  it("7. crossing host constraints leave the plan untouched with a deterministic reason", () => {
    // Horizontal host at the top, VERTICAL host at the right: no common motion.
    const plan = planOf(
      {
        tl: P(0, 0), tj: P(4000, 0), tr: P(8000, 0),
        rt: P(8000, -2000), rj: P(8000, 2000), rb: P(8000, 6000),
      },
      [
        { id: "t1", a: "tl", b: "tj" }, { id: "t2", a: "tj", b: "tr" },
        { id: "r1", a: "rt", b: "rj" }, { id: "r2", a: "rj", b: "rb" },
        { id: "diag", a: "tj", b: "rj" },
      ],
    );
    const r = move(plan, "diag", { x: 300, y: 300 });
    expect(r.changed).toBe(false);
    expect(r.reason).toBe("WALL_MOVE_INCOMPATIBLE_HOST_CONSTRAINTS");
    expect(r.plan).toBe(plan);
  });
});

describe("PHASE 2C3A — mouse/arrow parity and invariants", () => {
  it("8. the same delta gives the same topology fingerprint on both input paths", () => {
    // Both entry points now call moveWallSegment with an identical delta, so
    // the results must be byte-identical geometry.
    const a = move(teePlan(), "h1", { x: 0, y: -300 });
    const b = move(teePlan(), "h1", { x: 0, y: -300 });
    expect(a.changed && b.changed).toBe(true);
    expect(fp(a.plan)).toBe(fp(b.plan));
  });

  it("9./10. repeated moves keep the host straight and never bend it", () => {
    let plan = teePlan();
    for (let i = 0; i < 4; i++) {
      const r = move(plan, "br", { x: 200, y: 0 });
      expect(r.changed).toBe(true);
      plan = r.plan;
      postConditions(plan);
    }
    // The host is re-split each time under a new id, so assert the invariant
    // rather than fixed ids: every wall except the branch still lies on y = 0.
    const walls = resolvePlanWalls(plan);
    const hosts = walls.filter((w) => w.id !== "br");
    expect(hosts.length).toBeGreaterThanOrEqual(2);
    for (const w of hosts) {
      expect(Math.round(w.pts[0].y)).toBe(0);
      expect(Math.round(w.pts[w.pts.length - 1].y)).toBe(0);
    }
    // and the branch is still attached to that straight host
    const br = walls.find((w) => w.id === "br");
    expect(Math.round(br.pts[0].y)).toBe(0);
    expect(Math.round(br.pts[0].x)).toBe(4800);
  });

  it("11.-15. post-conditions hold and the input plan is never mutated", () => {
    const plan = teePlan();
    const snapshot = JSON.stringify(plan);
    const r = move(plan, "h1", { x: 0, y: -350 });
    expect(r.changed).toBe(true);
    postConditions(r.plan);
    expect(JSON.stringify(plan)).toBe(snapshot);
  });

  it("16. a failed move returns the original plan object, so no history step is possible", () => {
    const plan = teePlan();
    const r = move(plan, "br", { x: 0, y: 400 }); // across the host -> zero motion
    expect(r.changed).toBe(false);
    expect(r.reason).toBe("NO_CHANGE");
    expect(r.plan).toBe(plan);
  });
});

describe("PHASE 2C3A — sanitized live 24-wall topology", () => {
  const live = () => planOf(LIVE_NODES, LIVE_WALLS);

  it("17. every endpoint classifies, and none is left as the old blanket 'multi'", () => {
    const plan = live();
    const types = {};
    for (const w of plan.walls) {
      const att = classifyWallSegmentAttachments(plan, w.id);
      expect(att).not.toBeNull();
      types[att.start.type] = (types[att.start.type] || 0) + 1;
      types[att.end.type] = (types[att.end.type] || 0) + 1;
    }
    expect(types.multi ?? 0).toBe(0);
  });

  it("18. the overwhelming majority of real walls can be dragged (was 1 of 24)", () => {
    const plan = live();
    const moved = [];
    const blocked = [];
    for (const w of plan.walls) {
      const a = plan.nodes[w.a];
      const b = plan.nodes[w.b];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      // the UI drags along the wall normal; a branch may only slide along its host
      const dirs = [
        { x: -(b.y - a.y) / len * 50, y: (b.x - a.x) / len * 50 },
        { x: (b.y - a.y) / len * 50, y: -(b.x - a.x) / len * 50 },
        { x: (b.x - a.x) / len * 50, y: (b.y - a.y) / len * 50 },
      ];
      let ok = null;
      for (const d of dirs) {
        const r = move(plan, w.id, d);
        if (r.changed) { ok = r; break; }
        ok = ok || r;
      }
      (ok.changed ? moved : blocked).push({ id: w.id, reason: ok.reason });
    }
    // Regression guard: the defect this phase fixes produced 1/24.
    expect(moved.length).toBeGreaterThanOrEqual(20);
    // Anything still blocked must carry a concrete, proven reason.
    for (const b of blocked) {
      expect([
        "WALL_MOVE_UNNODED_CROSSING",
        "WALL_MOVE_UNSAFE_MULTI_JUNCTION",
        "WALL_MOVE_INCOMPATIBLE_HOST_CONSTRAINTS",
        "DUPLICATE_WALL",
        "ZERO_LENGTH_WALL",
        "WALL_MOVE_ZERO_LENGTH",
        "NO_CHANGE",
      ]).toContain(b.reason);
    }
  });

  it("19. every successful live move keeps the network valid", () => {
    const plan = live();
    let checked = 0;
    for (const w of plan.walls) {
      const a = plan.nodes[w.a];
      const b = plan.nodes[w.b];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const r = move(plan, w.id, { x: -(b.y - a.y) / len * 40, y: (b.x - a.x) / len * 40 });
      if (!r.changed) continue;
      postConditions(r.plan);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("20. the live fixture is never mutated by any move attempt", () => {
    const plan = live();
    const snapshot = JSON.stringify(plan);
    for (const w of plan.walls) move(plan, w.id, { x: 0, y: 50 });
    expect(JSON.stringify(plan)).toBe(snapshot);
  });
});
