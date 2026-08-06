/**
 * Command layer over wallNetwork/wallOps primitives — see
 * src/planner/core/walls/wallCommands.js. Every command returns
 * { plan, changed, affectedNodeIds, affectedWallIds, warnings } and never
 * throws on expected user conditions (zero-length, duplicate, missing id).
 * No PlanPage, no autosave, no room detection — geometry only.
 */
import { describe, it, expect } from "vitest";
import {
  addWall, moveNode, splitWall, deleteWall, deleteNode, mergeNodes,
  connectWallEndpoint, normalizeWallNetwork, deriveLegacyPts,
} from "../src/planner/core/walls/wallCommands.js";
import { ensureWallNetwork, resolvePlanWalls } from "../src/planner/wallNetwork.js";
import { loadPlannerFixture } from "./fixtures/planner/loadFixture.js";

// Prefixed so generated ids can never collide with a fixture's own literal
// "n1"/"w1" ids (rectangle-room, t-junction, etc. all use that scheme).
let n = 0;
const makeId = (p) => `cmd_${p}${++n}`;

function networkPlan(fixtureName) {
  n = 0;
  return ensureWallNetwork(loadPlannerFixture(fixtureName), makeId);
}

describe("wallCommands — addWall", () => {
  it("1. adds an isolated wall between two fresh points", () => {
    n = 0;
    const plan = { nodes: {}, walls: [] };
    const r = addWall(plan, { x: 0, y: 0 }, { x: 4000, y: 0 }, { thk: 100 }, makeId);
    expect(r.changed).toBe(true);
    expect(r.plan.walls.length).toBe(1);
    expect(r.affectedWallIds.length).toBe(1);
    expect(r.affectedNodeIds.length).toBe(2);
    expect(r.warnings).toEqual([]);
  });

  it("2. adds a wall connected to an existing node (rectangle fixture)", () => {
    const plan = networkPlan("rectangle-room");
    const n1 = plan.walls[0].a;
    const corner = plan.nodes[n1];
    const r = addWall(plan, corner, { x: corner.x, y: corner.y - 3000 }, { thk: 100 }, makeId);
    expect(r.changed).toBe(true);
    expect(r.affectedNodeIds).toContain(n1);
    expect(Object.keys(r.plan.nodes).length).toBe(Object.keys(plan.nodes).length + 1);
  });

  it("3. endpoint snaps to an existing node within link tolerance (not exact)", () => {
    const plan = networkPlan("rectangle-room");
    const n1 = plan.walls[0].a;
    const corner = plan.nodes[n1];
    const nearlyThere = { x: corner.x + 10, y: corner.y - 10 }; // within NODE_LINK_THR=85mm
    const r = addWall(plan, nearlyThere, { x: corner.x, y: corner.y - 3000 }, { thk: 100 }, makeId);
    expect(r.changed).toBe(true);
    expect(r.affectedNodeIds).toContain(n1);
    expect(Object.keys(r.plan.nodes).length).toBe(Object.keys(plan.nodes).length + 1);
  });

  it("11. rejects a zero-length wall", () => {
    n = 0;
    const plan = { nodes: {}, walls: [] };
    const r = addWall(plan, { x: 0, y: 0 }, { x: 5, y: 0 }, {}, makeId);
    expect(r.changed).toBe(false);
    expect(r.plan).toBe(plan);
    expect(r.warnings[0].code).toBe("ZERO_LENGTH_WALL");
  });

  it("12. rejects a duplicate wall between the same two nodes", () => {
    const plan = networkPlan("rectangle-room");
    const w = plan.walls[0];
    const a = plan.nodes[w.a];
    const b = plan.nodes[w.b];
    const r = addWall(plan, a, b, {}, makeId);
    expect(r.changed).toBe(false);
    expect(r.warnings[0].code).toBe("DUPLICATE_WALL");
    expect(r.plan.walls.length).toBe(plan.walls.length);
  });
});

describe("wallCommands — splitWall", () => {
  it("5. splits a wall into two edges sharing a new node", () => {
    const plan = networkPlan("rectangle-room");
    const w = plan.walls[0];
    const a = plan.nodes[w.a];
    const b = plan.nodes[w.b];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const r = splitWall(plan, w.id, mid, makeId);
    expect(r.changed).toBe(true);
    expect(r.plan.walls.length).toBe(plan.walls.length + 1);
    expect(r.affectedWallIds).toContain(w.id);
    const resolved = resolvePlanWalls(r.plan);
    const kept = resolved.find((x) => x.id === w.id);
    expect(kept.pts[1]).toEqual(mid);
  });

  it("6. splitting twice at the same point is idempotent", () => {
    const plan = networkPlan("rectangle-room");
    const w = plan.walls[0];
    const a = plan.nodes[w.a];
    const b = plan.nodes[w.b];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const once = splitWall(plan, w.id, mid, makeId);
    const twice = splitWall(once.plan, w.id, mid, makeId);
    expect(twice.changed).toBe(false);
    expect(twice.plan.walls.length).toBe(once.plan.walls.length);
  });

  it("10. splits a very short wall segment safely", () => {
    n = 0;
    // 150mm: short relative to typical wall lengths, but comfortably above
    // both MIN_SEGMENT_MM(50) and commitWallEdge's own NODE_LINK_THR(85)
    // endpoint-merge tolerance, so the two ends aren't collapsed into one node.
    let plan = { nodes: {}, walls: [] };
    const added = addWall(plan, { x: 0, y: 0 }, { x: 150, y: 0 }, {}, makeId);
    plan = added.plan;
    const w = plan.walls[0];
    const r = splitWall(plan, w.id, { x: 75, y: 0 }, makeId);
    expect(r.changed).toBe(true);
    expect(r.plan.walls.length).toBe(2);
  });

  it("17. door attachment survives a safe split (refreshWallMountedItems)", () => {
    const plan = networkPlan("door-on-wall");
    const w = plan.walls[0];
    const door = plan.items[0];
    expect(door.wallId).toBe(w.id);
    // split well clear of the door's own position (door centered ~x=2000)
    const r = splitWall(plan, w.id, { x: 500, y: 0 }, makeId);
    expect(r.changed).toBe(true);
    const doorAfter = r.plan.items.find((i) => i.id === door.id);
    expect(doorAfter.wallId).toBeTruthy();
    // door still resolves onto *some* wall (the far segment, since it sits past x=500)
    const resolved = resolvePlanWalls(r.plan);
    expect(resolved.some((rw) => rw.id === doorAfter.wallId)).toBe(true);
  });

  it("19. dimension anchor on a split wall gets an explicit review warning", () => {
    const plan = networkPlan("manual-dimension");
    const w = plan.walls[0];
    const r = splitWall(plan, w.id, { x: 2000, y: 0 }, makeId);
    expect(r.changed).toBe(true);
    expect(r.warnings.some((warn) => warn.code === "DIMENSION_ANCHOR_NEEDS_REVIEW" && warn.dimensionId === "dim1")).toBe(true);
  });

  it("20. manual dimension is unaffected when a different wall is split", () => {
    n = 0;
    let plan = networkPlan("manual-dimension");
    const added = addWall(plan, { x: 0, y: 5000 }, { x: 4000, y: 5000 }, {}, makeId);
    plan = added.plan;
    const otherWall = added.plan.walls.find((x) => x.id !== plan.walls[0].id) || added.plan.walls[added.plan.walls.length - 1];
    const r = splitWall(plan, otherWall.id, { x: 2000, y: 5000 }, makeId);
    expect(r.warnings.some((warn) => warn.dimensionId === "dim1")).toBe(false);
  });
});

describe("wallCommands — cross/T-junction/diagonal", () => {
  it("7. crossing two walls: splitting each at the same intersection point shares one node", () => {
    n = 0;
    let plan = { nodes: {}, walls: [] };
    plan = addWall(plan, { x: 0, y: 2000 }, { x: 4000, y: 2000 }, {}, makeId).plan;
    const horiz = plan.walls[0];
    const vAdd = addWall(plan, { x: 2000, y: 0 }, { x: 2000, y: 4000 }, {}, makeId);
    plan = vAdd.plan;
    const vert = plan.walls.find((w) => w.id !== horiz.id);

    const s1 = splitWall(plan, horiz.id, { x: 2000, y: 2000 }, makeId);
    const s2 = splitWall(s1.plan, vert.id, { x: 2000, y: 2000 }, makeId);
    expect(s1.changed).toBe(true);
    expect(s2.changed).toBe(true);
    // breakWallEdgeAt dedupes the exact coincident point onto s1's own new
    // node, so no separate merge step is needed for a same-point crossing.
    expect(s2.affectedNodeIds[0]).toBe(s1.affectedNodeIds[0]);
    const resolved = resolvePlanWalls(s2.plan);
    expect(resolved.length).toBe(4);
    const nodeIds = new Set();
    resolved.forEach((w) => { nodeIds.add(w.nodeA); nodeIds.add(w.nodeB); });
    expect(nodeIds.size).toBe(5); // 4 outer ends + 1 shared center
  });

  it("8. T-junction: connectWallEndpoint attaches a floating endpoint onto a wall body", () => {
    n = 0;
    let plan = { nodes: {}, walls: [] };
    plan = addWall(plan, { x: 0, y: 0 }, { x: 6000, y: 0 }, {}, makeId).plan;
    const main = plan.walls[0];
    const stub = addWall(plan, { x: 3000, y: 500 }, { x: 3000, y: 3000 }, {}, makeId);
    plan = stub.plan;
    const stubWall = plan.walls.find((w) => w.id !== main.id);
    const stubFreeEnd = stubWall.a; // { x:3000, y:500 } end, floating above the main wall

    const r = connectWallEndpoint(plan, stubFreeEnd, main.id, { x: 3000, y: 0 }, makeId);
    expect(r.changed).toBe(true);
    const resolved = resolvePlanWalls(r.plan);
    expect(resolved.length).toBe(3); // main split into 2 + the stub
    const stubResolved = resolved.find((w) => w.id === stubWall.id);
    expect(stubResolved.pts.some((p) => p.x === 3000 && p.y === 0)).toBe(true);
  });

  it("existing T-junction fixture already models a valid shared node", () => {
    const plan = networkPlan("t-junction");
    const shared = plan.walls.filter((w) => w.a === "n3" || w.b === "n3");
    expect(shared.length).toBe(3);
  });

  it("9. diagonal wall intersection splits both walls at the true intersection point", () => {
    n = 0;
    let plan = { nodes: {}, walls: [] };
    plan = addWall(plan, { x: 0, y: 0 }, { x: 4000, y: 4000 }, {}, makeId).plan;
    const diagA = plan.walls[0];
    const diagB = addWall(plan, { x: 0, y: 4000 }, { x: 4000, y: 0 }, {}, makeId);
    plan = diagB.plan;
    const other = plan.walls.find((w) => w.id !== diagA.id);
    const cross = { x: 2000, y: 2000 };
    const s1 = splitWall(plan, diagA.id, cross, makeId);
    const s2 = splitWall(s1.plan, other.id, cross, makeId);
    expect(s1.changed).toBe(true);
    expect(s2.changed).toBe(true);
    expect(s2.affectedNodeIds[0]).toBe(s1.affectedNodeIds[0]);
    expect(resolvePlanWalls(s2.plan).length).toBe(4);
  });
});

describe("wallCommands — moveNode / deleteWall / deleteNode / mergeNodes", () => {
  it("13. moving a node updates every wall attached to it", () => {
    const plan = networkPlan("t-junction");
    const r = moveNode(plan, "n3", { x: 3000, y: 100 });
    expect(r.changed).toBe(true);
    expect(r.affectedWallIds.length).toBe(3);
    const resolved = resolvePlanWalls(r.plan);
    resolved.forEach((w) => {
      if (w.nodeA === "n3" || w.nodeB === "n3") {
        const pt = w.nodeA === "n3" ? w.pts[0] : w.pts[1];
        expect(pt).toEqual({ x: 3000, y: 100 });
      }
    });
  });

  it("14. merges two nodes, removing degenerate/duplicate walls", () => {
    n = 0;
    let plan = { nodes: {}, walls: [] };
    plan = addWall(plan, { x: 0, y: 0 }, { x: 4000, y: 0 }, {}, makeId).plan;
    const w1 = plan.walls[0];
    const added2 = addWall(plan, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, {}, makeId);
    plan = added2.plan;
    const r = mergeNodes(plan, w1.a, w1.b === plan.walls[1].a ? plan.walls[1].a : w1.b);
    // merging the wall's own two endpoints collapses w1 to a degenerate edge
    expect(r.changed).toBe(true);
    expect(r.plan.walls.some((w) => w.id === w1.id)).toBe(false);
    expect(r.warnings.some((warn) => warn.code === "DEGENERATE_WALL_REMOVED")).toBe(true);
  });

  it("15. deleting a wall cleans up its now-dangling node", () => {
    n = 0;
    let plan = { nodes: {}, walls: [] };
    plan = addWall(plan, { x: 0, y: 0 }, { x: 4000, y: 0 }, {}, makeId).plan;
    const w = plan.walls[0];
    const r = deleteWall(plan, w.id);
    expect(r.changed).toBe(true);
    expect(r.plan.walls.length).toBe(0);
    expect(Object.keys(r.plan.nodes).length).toBe(0);
  });

  it("16. deleting a shared node removes every wall touching it", () => {
    const plan = networkPlan("t-junction");
    const r = deleteNode(plan, "n3");
    expect(r.changed).toBe(true);
    expect(r.plan.walls.length).toBe(0); // all 3 walls touched n3
    expect(r.plan.nodes.n3).toBeUndefined();
    expect(r.affectedWallIds.length).toBe(3);
  });
});

describe("wallCommands — legacy compatibility & normalization", () => {
  it("22. legacy pts[] plan migrates to network model via normalizeWallNetwork", () => {
    n = 0;
    const raw = loadPlannerFixture("legacy-pts-wall");
    const r = normalizeWallNetwork(raw, makeId);
    expect(r.plan.walls[0].a).toBeTruthy();
    expect(r.plan.walls[0].b).toBeTruthy();
    expect(Object.keys(r.plan.nodes).length).toBe(2);
  });

  it("23. mixed legacy/network plan normalizes without duplicating walls", () => {
    n = 0;
    const raw = loadPlannerFixture("legacy-pts-wall");
    const mixed = {
      ...raw,
      nodes: { existing1: { x: 9000, y: 9000 }, existing2: { x: 9500, y: 9000 } },
      walls: [...raw.walls, { id: "already-network", a: "existing1", b: "existing2", thk: 100 }],
    };
    const r = normalizeWallNetwork(mixed, makeId);
    expect(r.plan.walls.length).toBe(2);
  });

  it("24. normalizing twice yields the same result (idempotent)", () => {
    n = 0;
    const raw = loadPlannerFixture("two-rooms");
    const once = normalizeWallNetwork(raw, makeId);
    const twice = normalizeWallNetwork(once.plan, makeId);
    expect(twice.changed).toBe(false);
    expect(resolvePlanWalls(twice.plan)).toEqual(resolvePlanWalls(once.plan));
  });

  it("25. reordered wall/node arrays produce the same semantic network", () => {
    const plan = networkPlan("two-rooms");
    const reordered = {
      ...plan,
      walls: [...plan.walls].reverse(),
      nodes: Object.fromEntries(Object.entries(plan.nodes).reverse()),
    };
    const key = (w) => [w.pts[0].x, w.pts[0].y, w.pts[1].x, w.pts[1].y].join(",");
    const a = resolvePlanWalls(plan).map((w) => ({ a: w.pts[0], b: w.pts[1] })).sort((x, y) => (key({ pts: [x.a, x.b] }) < key({ pts: [y.a, y.b] }) ? -1 : 1));
    const b = resolvePlanWalls(reordered).map((w) => ({ a: w.pts[0], b: w.pts[1] })).sort((x, y) => (key({ pts: [x.a, x.b] }) < key({ pts: [y.a, y.b] }) ? -1 : 1));
    expect(b).toEqual(a);
  });

  it("21. stable IDs — unrelated wall/node ids untouched by an unrelated command", () => {
    const plan = networkPlan("two-rooms");
    const untouchedWallIds = plan.walls.filter((w) => w.id !== plan.walls[0].id).map((w) => w.id);
    const r = moveNode(plan, plan.walls[0].a, { x: 1, y: 1 });
    untouchedWallIds.forEach((id) => {
      expect(r.plan.walls.some((w) => w.id === id)).toBe(true);
    });
  });

  it("26. commands do not mutate their plan input", () => {
    const plan = networkPlan("rectangle-room");
    const snapshot = JSON.parse(JSON.stringify(plan));
    addWall(plan, { x: 0, y: -1000 }, { x: 4000, y: -1000 }, {}, makeId);
    moveNode(plan, plan.walls[0].a, { x: 999, y: 999 });
    deleteWall(plan, plan.walls[0].id);
    expect(plan).toEqual(snapshot);
  });

  it("deriveLegacyPts is the same resolvePlanWalls adapter (no duplicated math)", () => {
    const plan = networkPlan("rectangle-room");
    expect(deriveLegacyPts(plan)).toEqual(resolvePlanWalls(plan));
  });
});

describe("wallCommands — invalid input / diagnostics", () => {
  it("28. missing wall id returns a structured warning, not a crash", () => {
    const plan = networkPlan("rectangle-room");
    expect(() => deleteWall(plan, "nope")).not.toThrow();
    const r = deleteWall(plan, "nope");
    expect(r.changed).toBe(false);
    expect(r.warnings[0].code).toBe("WALL_NOT_FOUND");
  });

  it("28b. missing node id returns a structured warning, not a crash", () => {
    const plan = networkPlan("rectangle-room");
    const r = moveNode(plan, "nope", { x: 0, y: 0 });
    expect(r.changed).toBe(false);
    expect(r.warnings[0].code).toBe("NODE_NOT_FOUND");
  });

  it("addWall throws only on programmer error (missing makeId)", () => {
    const plan = networkPlan("rectangle-room");
    expect(() => addWall(plan, { x: 0, y: 0 }, { x: 1000, y: 0 }, {})).toThrow();
  });
});

describe("wallCommands — performance", () => {
  it("27. large network: 400 walls normalize + one split within budget", () => {
    n = 0;
    const nodes = {};
    const walls = [];
    for (let i = 0; i < 400; i++) {
      nodes[`n${i}`] = { x: i * 100, y: 0 };
      nodes[`n${i}b`] = { x: i * 100, y: 200 };
      walls.push({ id: `w${i}`, a: `n${i}`, b: `n${i}b`, thk: 100 });
    }
    const plan = { nodes, walls };
    const start = Date.now();
    const normalized = normalizeWallNetwork(plan, makeId);
    const r = splitWall(normalized.plan, "w0", { x: 0, y: 100 }, makeId);
    const elapsed = Date.now() - start;
    expect(r.changed).toBe(true);
    expect(elapsed).toBeLessThan(2000);
  });
});
