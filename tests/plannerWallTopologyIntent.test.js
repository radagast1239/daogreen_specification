import { beforeAll, describe, expect, it } from "vitest";
import { HistoryModel } from "../src/planner/core/history/historyModel.js";

let normalizePlan;
let findWallIntersections;
let resolvePlanWalls;
let commitDrawnWall;

beforeAll(async () => {
  ({ normalizePlan } = await import("../src/planner/planNormalize.js"));
  ({ findWallIntersections } = await import("../src/planner/core/walls/wallOps.js"));
  ({ resolvePlanWalls } = await import("../src/planner/wallNetwork.js"));
  ({ commitDrawnWall } = await import("../src/planner/core/walls/wallDrawTopology.js"));
});

const clone = (value) => JSON.parse(JSON.stringify(value));

function makeIds() {
  let sequence = 0;
  return (prefix = "id") => `${prefix}-${++sequence}`;
}

function wall(id, a, b) {
  return {
    id,
    a,
    b,
    thk: 100,
    role: "partition",
    kind: "new",
    thicknessSide: "center",
    height: 3000,
    material: "",
    chainId: id,
    createdAt: 1,
    updatedAt: 1,
  };
}

function planWithHost() {
  return {
    nodes: { h1: { x: 0, y: 0 }, h2: { x: 6000, y: 0 } },
    walls: [wall("host", "h1", "h2")],
    room: { height: 3000 },
    items: [],
    dimensions: [],
  };
}

function planWithParallelHosts() {
  return {
    nodes: {
      a1: { x: 0, y: 0 }, a2: { x: 6000, y: 0 },
      b1: { x: 0, y: 4000 }, b2: { x: 6000, y: 4000 },
    },
    walls: [wall("bottom", "a1", "a2"), wall("top", "b1", "b2")],
    room: { height: 3000 },
    items: [],
    dimensions: [],
  };
}

function nodeIntent(nodeId, point) {
  return { kind: "node", point, nodeId, wallId: null, hostWallId: null, connects: true };
}

function wallEndIntent(wallId, nodeId, point) {
  return { kind: "wall-end", point, nodeId, wallId, hostWallId: null, connects: true };
}

function wallBodyIntent(hostWallId, point) {
  return { kind: "wall-body", point, nodeId: null, wallId: null, hostWallId, connects: true };
}

function noneIntent(point) {
  return { kind: "none", point, nodeId: null, wallId: null, hostWallId: null, connects: false };
}

function newWall(result) {
  return result.plan.walls.find((item) => item.id === result.meta?.newWallId);
}

function nodesAt(plan, point, epsilon = 0.001) {
  return Object.entries(plan.nodes || {}).filter(([, node]) => (
    Math.hypot(node.x - point.x, node.y - point.y) <= epsilon
  ));
}

function topologyFingerprint(plan) {
  return {
    nodes: Object.entries(plan.nodes || {}).sort(([a], [b]) => a.localeCompare(b)),
    walls: (plan.walls || []).map(({ id, a, b, thk, role }) => ({ id, a, b, thk, role })),
    geometry: resolvePlanWalls(plan).map((item) => ({ id: item.id, pts: item.pts })),
  };
}

describe("explicit wall topology intent contract", () => {
  it("1. legacy call without intents retains coordinate inference", () => {
    const plan = planWithHost();
    const result = commitDrawnWall(plan, { x: 0, y: 71 }, { x: 0, y: 2000 }, {}, makeIds());
    expect(result.changed).toBe(true);
    expect(newWall(result).a).toBe("h1");
  });

  it("2. an empty options object is identical to the old call", () => {
    const plan = planWithHost();
    const oldResult = commitDrawnWall(plan, { x: 3000, y: 0 }, { x: 3000, y: 2000 }, {}, makeIds());
    const emptyOptionsResult = commitDrawnWall(plan, { x: 3000, y: 0 }, { x: 3000, y: 2000 }, {}, makeIds(), {});
    expect(emptyOptionsResult.changed).toBe(oldResult.changed);
    expect(emptyOptionsResult.reason).toBe(oldResult.reason);
    expect(topologyFingerprint(emptyOptionsResult.plan)).toEqual(topologyFingerprint(oldResult.plan));
  });

  it("3. valid start node intent reuses the exact nodeId", () => {
    const plan = planWithHost();
    const result = commitDrawnWall(plan, plan.nodes.h1, { x: 0, y: 2000 }, {}, makeIds(), {
      startIntent: nodeIntent("h1", plan.nodes.h1),
    });
    expect(newWall(result).a).toBe("h1");
  });

  it("4. valid end node intent reuses the exact nodeId", () => {
    const plan = planWithHost();
    const result = commitDrawnWall(plan, { x: 0, y: 2000 }, plan.nodes.h1, {}, makeIds(), {
      endIntent: nodeIntent("h1", plan.nodes.h1),
    });
    expect(newWall(result).b).toBe("h1");
  });

  it("5. node intent does not create a duplicate node", () => {
    const plan = planWithHost();
    const result = commitDrawnWall(plan, plan.nodes.h1, { x: -1000, y: 1000 }, {}, makeIds(), {
      startIntent: nodeIntent("h1", plan.nodes.h1),
      endIntent: noneIntent({ x: -1000, y: 1000 }),
    });
    expect(nodesAt(result.plan, plan.nodes.h1)).toHaveLength(1);
  });

  it("6. stale node intent becomes none with deterministic warning", () => {
    const plan = planWithHost();
    const point = { x: 0, y: 71 };
    const result = commitDrawnWall(plan, point, { x: -1000, y: 1000 }, {}, makeIds(), {
      startIntent: nodeIntent("missing", point),
      endIntent: noneIntent({ x: -1000, y: 1000 }),
    });
    expect(newWall(result).a).not.toBe("h1");
    expect(result.intentWarnings.map((item) => item.code)).toContain("INTENT_REJECTED_NODE");
    expect(result.meta.intents.start.kind).toBe("none");
  });

  it("7. valid wall-end normalizes to the exact endpoint node", () => {
    const plan = planWithHost();
    const result = commitDrawnWall(plan, plan.nodes.h1, { x: -1000, y: 1000 }, {}, makeIds(), {
      startIntent: wallEndIntent("host", "h1", plan.nodes.h1),
      endIntent: noneIntent({ x: -1000, y: 1000 }),
    });
    expect(result.meta.intents.start).toMatchObject({ kind: "node", nodeId: "h1" });
    expect(newWall(result).a).toBe("h1");
  });

  it("8. mismatched wallId/nodeId becomes none", () => {
    const plan = planWithParallelHosts();
    const result = commitDrawnWall(plan, plan.nodes.a1, { x: -1000, y: 1000 }, {}, makeIds(), {
      startIntent: wallEndIntent("top", "a1", plan.nodes.a1),
      endIntent: noneIntent({ x: -1000, y: 1000 }),
    });
    expect(result.meta.intents.start.kind).toBe("none");
    expect(result.intentWarnings[0].code).toBe("INTENT_REJECTED_WALL_END");
  });

  it("9. wall-end close to endpoint does not split its host", () => {
    const plan = planWithHost();
    const result = commitDrawnWall(plan, { x: 0.25, y: 0 }, { x: -1000, y: 1000 }, {}, makeIds(), {
      startIntent: wallEndIntent("host", "h1", { x: 0.25, y: 0 }),
      endIntent: noneIntent({ x: -1000, y: 1000 }),
    });
    expect(result.plan.walls.filter((item) => item.id === "host")).toHaveLength(1);
    expect(result.meta.startSplitWallIds).toEqual([]);
  });

  it("10. valid start wall-body splits the exact host once", () => {
    const plan = planWithHost();
    const result = commitDrawnWall(plan, { x: 2000, y: 0 }, { x: 2000, y: 2000 }, {}, makeIds(), {
      startIntent: wallBodyIntent("host", { x: 2000, y: 0 }),
      endIntent: noneIntent({ x: 2000, y: 2000 }),
    });
    expect(result.changed).toBe(true);
    expect(result.meta.startSplitWallIds).toHaveLength(2);
    expect(result.plan.walls).toHaveLength(3);
  });

  it("11. valid end wall-body splits the exact host once", () => {
    const plan = planWithHost();
    const result = commitDrawnWall(plan, { x: 2000, y: 2000 }, { x: 2000, y: 0 }, {}, makeIds(), {
      startIntent: noneIntent({ x: 2000, y: 2000 }),
      endIntent: wallBodyIntent("host", { x: 2000, y: 0 }),
    });
    expect(result.meta.endSplitWallIds).toHaveLength(2);
    expect(result.plan.walls).toHaveLength(3);
  });

  it("12. wall-body result uses the exact split node", () => {
    const plan = planWithHost();
    const result = commitDrawnWall(plan, { x: 2000, y: 0 }, { x: 2000, y: 2000 }, {}, makeIds(), {
      startIntent: wallBodyIntent("host", { x: 2000, y: 0 }),
      endIntent: noneIntent({ x: 2000, y: 2000 }),
    });
    const splitNode = nodesAt(result.plan, { x: 2000, y: 0 })[0][0];
    expect(newWall(result).a).toBe(splitNode);
  });

  it("13. wall-body does not split a neighboring wall", () => {
    const plan = planWithHost();
    plan.nodes.n1 = { x: 0, y: 0.4 };
    plan.nodes.n2 = { x: 6000, y: 0.4 };
    plan.walls.push(wall("neighbor", "n1", "n2"));
    const result = commitDrawnWall(plan, { x: 2000, y: 0 }, { x: 2000, y: -2000 }, {}, makeIds(), {
      startIntent: wallBodyIntent("host", { x: 2000, y: 0 }),
      endIntent: noneIntent({ x: 2000, y: -2000 }),
    });
    expect(result.plan.walls.filter((item) => item.id === "neighbor")).toHaveLength(1);
    expect(result.meta.startHostId).toBe("host");
  });

  it("14. both ends on different hosts preserve both split invariants", () => {
    const plan = planWithParallelHosts();
    const result = commitDrawnWall(plan, { x: 2000, y: 0 }, { x: 2000, y: 4000 }, {}, makeIds(), {
      startIntent: wallBodyIntent("bottom", { x: 2000, y: 0 }),
      endIntent: wallBodyIntent("top", { x: 2000, y: 4000 }),
    });
    expect(result.plan.walls).toHaveLength(5);
    expect(result.meta.startHostInvariant.ok).toBe(true);
    expect(result.meta.endHostInvariant.ok).toBe(true);
  });

  it("15. both ends on the same host produce a deterministic duplicate no-op", () => {
    const plan = planWithHost();
    const options = {
      startIntent: wallBodyIntent("host", { x: 1000, y: 0 }),
      endIntent: wallBodyIntent("host", { x: 5000, y: 0 }),
    };
    const a = commitDrawnWall(plan, options.startIntent.point, options.endIntent.point, {}, makeIds(), options);
    const b = commitDrawnWall(plan, options.startIntent.point, options.endIntent.point, {}, makeIds(), options);
    expect(a.changed).toBe(false);
    expect(a.warnings[0].code).toBe("DUPLICATE_WALL");
    expect(a).toEqual(b);
  });

  it("16. same-host intent cannot split or connect to an unrelated nearby wall", () => {
    const plan = planWithHost();
    plan.nodes.u1 = { x: 0, y: 20 };
    plan.nodes.u2 = { x: 6000, y: 20 };
    plan.walls.push(wall("unrelated", "u1", "u2"));
    const options = {
      startIntent: wallBodyIntent("host", { x: 1000, y: 0 }),
      endIntent: wallBodyIntent("host", { x: 5000, y: 0 }),
    };
    const result = commitDrawnWall(plan, options.startIntent.point, options.endIntent.point, {}, makeIds(), options);
    expect(result.changed).toBe(false);
    expect(result.plan).toBe(plan);
    expect(result.plan.walls.filter((item) => item.id === "unrelated")).toHaveLength(1);
  });

  it("17. none at 71 mm from an existing node remains separate at commit", () => {
    const plan = planWithHost();
    const point = { x: 0, y: 71 };
    const result = commitDrawnWall(plan, point, { x: -1000, y: 1000 }, {}, makeIds(), {
      startIntent: noneIntent(point),
      endIntent: noneIntent({ x: -1000, y: 1000 }),
    });
    expect(newWall(result).a).not.toBe("h1");
    expect(result.plan.nodes[newWall(result).a]).toEqual(point);
    expect(result.intentWarnings.map((item) => item.code)).toContain("NON_CONNECTING_NEAR_NODE");
  });

  it("18. a 71 mm none endpoint stays separate after JSON serialize and normalizePlan", () => {
    const plan = planWithHost();
    const point = { x: 0, y: 71 };
    const committed = commitDrawnWall(plan, point, { x: -1000, y: 1000 }, {}, makeIds(), {
      startIntent: noneIntent(point), endIntent: noneIntent({ x: -1000, y: 1000 }),
    });
    const wallBefore = newWall(committed);
    const loaded = normalizePlan(JSON.parse(JSON.stringify(committed.plan)));
    expect(loaded.walls.find((item) => item.id === wallBefore.id).a).toBe(wallBefore.a);
    expect(loaded.nodes[wallBefore.a]).toEqual(point);
  });

  it("19. none near a wall body does not magnetically attach", () => {
    const plan = planWithHost();
    const point = { x: 2000, y: 71 };
    const result = commitDrawnWall(plan, point, { x: 2000, y: 1500 }, {}, makeIds(), {
      startIntent: noneIntent(point), endIntent: noneIntent({ x: 2000, y: 1500 }),
    });
    expect(result.meta.startSplitWallIds).toEqual([]);
    expect(result.plan.walls.filter((item) => item.id === "host")).toHaveLength(1);
    expect(result.plan.nodes[newWall(result).a]).toEqual(point);
  });

  it("20. none with an actual segment intersection still creates a real split", () => {
    const plan = planWithHost();
    const start = { x: 3000, y: -1000 };
    const end = { x: 3000, y: 1000 };
    const result = commitDrawnWall(plan, start, end, {}, makeIds(), {
      startIntent: noneIntent(start), endIntent: noneIntent(end),
    });
    expect(result.meta.firstIntersection.wallId).toBe("host");
    expect(result.meta.endSplitWallIds).toHaveLength(2);
    expect(result.plan.walls).toHaveLength(3);
  });

  it("21. none inside the <=1 mm technical threshold may reuse a node", () => {
    const plan = planWithHost();
    const point = { x: 0.5, y: 0 };
    const result = commitDrawnWall(plan, point, { x: -1000, y: 1000 }, {}, makeIds(), {
      startIntent: noneIntent(point), endIntent: noneIntent({ x: -1000, y: 1000 }),
    });
    expect(newWall(result).a).toBe("h1");
    expect(result.intentWarnings.map((item) => item.code)).not.toContain("NON_CONNECTING_NEAR_NODE");
  });

  it("22. a valid topology node intent beats nearby unrelated geometry", () => {
    const plan = planWithHost();
    plan.nodes.close = { x: 0.4, y: 0 };
    plan.nodes.closeEnd = { x: 0.4, y: -1000 };
    plan.walls.push(wall("close-wall", "close", "closeEnd"));
    const result = commitDrawnWall(plan, plan.nodes.h1, { x: -1000, y: 1000 }, {}, makeIds(), {
      startIntent: nodeIntent("h1", plan.nodes.h1), endIntent: noneIntent({ x: -1000, y: 1000 }),
    });
    expect(newWall(result).a).toBe("h1");
  });

  it("23. duplicate wall remains a no-op", () => {
    const plan = planWithHost();
    const result = commitDrawnWall(plan, plan.nodes.h1, plan.nodes.h2, {}, makeIds(), {
      startIntent: nodeIntent("h1", plan.nodes.h1),
      endIntent: nodeIntent("h2", plan.nodes.h2),
    });
    expect(result.changed).toBe(false);
    expect(result.warnings[0].code).toBe("DUPLICATE_WALL");
  });

  it("24. minimum wall length remains enforced", () => {
    const plan = planWithHost();
    const start = { x: 1000, y: 1000 };
    const end = { x: 1020, y: 1000 };
    const result = commitDrawnWall(plan, start, end, {}, makeIds(), {
      startIntent: noneIntent(start), endIntent: noneIntent(end),
    });
    expect(result.changed).toBe(false);
    expect(result.warnings[0].code).toBe("ZERO_LENGTH_WALL");
  });

  it("25. a real crossing remains normalized", () => {
    const plan = planWithHost();
    const start = { x: 3000, y: -1000 };
    const end = { x: 3000, y: 1000 };
    const result = commitDrawnWall(plan, start, end, {}, makeIds(), {
      startIntent: noneIntent(start), endIntent: noneIntent(end),
    });
    expect(findWallIntersections(resolvePlanWalls(result.plan))).toHaveLength(0);
  });

  it("26. host split invariant is preserved", () => {
    const plan = planWithHost();
    const start = { x: 2500, y: 0 };
    const result = commitDrawnWall(plan, start, { x: 2500, y: 1000 }, {}, makeIds(), {
      startIntent: wallBodyIntent("host", start), endIntent: noneIntent({ x: 2500, y: 1000 }),
    });
    expect(result.meta.startHostInvariant).toMatchObject({ ok: true, issues: [] });
  });

  it("27. a host split creates no duplicate split node", () => {
    const plan = planWithHost();
    const point = { x: 2500, y: 0 };
    const result = commitDrawnWall(plan, point, { x: 2500, y: 1000 }, {}, makeIds(), {
      startIntent: wallBodyIntent("host", point), endIntent: noneIntent({ x: 2500, y: 1000 }),
    });
    expect(nodesAt(result.plan, point)).toHaveLength(1);
  });

  it("28. invalid intent on one side does not discard the valid other side", () => {
    const plan = planWithHost();
    const start = { x: 0, y: 71 };
    const result = commitDrawnWall(plan, start, plan.nodes.h2, {}, makeIds(), {
      startIntent: nodeIntent("missing", start),
      endIntent: nodeIntent("h2", plan.nodes.h2),
    });
    expect(result.changed).toBe(true);
    expect(newWall(result).a).not.toBe("h1");
    expect(newWall(result).b).toBe("h2");
  });

  it("29. intent warning codes have deterministic side order", () => {
    const plan = planWithParallelHosts();
    const start = { x: 0, y: 71 };
    const result = commitDrawnWall(plan, start, plan.nodes.b1, {}, makeIds(), {
      startIntent: nodeIntent("missing", start),
      endIntent: wallEndIntent("bottom", "b1", plan.nodes.b1),
    });
    expect(result.intentWarnings.map((item) => item.code)).toEqual([
      "INTENT_REJECTED_NODE",
      "INTENT_REJECTED_WALL_END",
      "NON_CONNECTING_NEAR_NODE",
    ]);
    expect(result.intentWarnings.map((item) => item.side)).toEqual(["start", "end", "start"]);
  });

  it("30. explicit commit does not mutate its input plan", () => {
    const plan = planWithHost();
    const snapshot = clone(plan);
    const point = { x: 2000, y: 0 };
    commitDrawnWall(plan, point, { x: 2000, y: 1000 }, {}, makeIds(), {
      startIntent: wallBodyIntent("host", point), endIntent: noneIntent({ x: 2000, y: 1000 }),
    });
    expect(plan).toEqual(snapshot);
  });

  it("31. returned plan is serializable and history-compatible", () => {
    const plan = planWithHost();
    const history = new HistoryModel(plan);
    const point = { x: 2000, y: 0 };
    history.commit((current) => commitDrawnWall(current, point, { x: 2000, y: 1000 }, {}, makeIds(), {
      startIntent: wallBodyIntent("host", point), endIntent: noneIntent({ x: 2000, y: 1000 }),
    }).plan);
    expect(() => JSON.stringify(history.current)).not.toThrow();
    history.undo();
    expect(history.current).toEqual(plan);
    history.redo();
    expect(history.current.walls.length).toBe(3);
  });

  it("32. intent and warning metadata are not persisted into plan", () => {
    const plan = planWithHost();
    const point = { x: 0, y: 71 };
    const result = commitDrawnWall(plan, point, { x: -1000, y: 1000 }, {}, makeIds(), {
      startIntent: noneIntent(point), endIntent: noneIntent({ x: -1000, y: 1000 }),
    });
    const serialized = JSON.stringify(result.plan);
    expect(serialized).not.toContain("startIntent");
    expect(serialized).not.toContain("endIntent");
    expect(serialized).not.toContain("intentWarnings");
  });

  it("33. wall-body endpoint protection downgrades to node intent", () => {
    const plan = planWithHost();
    const result = commitDrawnWall(plan, plan.nodes.h1, { x: -1000, y: 1000 }, {}, makeIds(), {
      startIntent: wallBodyIntent("host", plan.nodes.h1), endIntent: noneIntent({ x: -1000, y: 1000 }),
    });
    expect(result.meta.intents.start).toMatchObject({ kind: "node", nodeId: "h1" });
    expect(result.intentWarnings[0].code).toBe("INTENT_DOWNGRADED_ENDPOINT");
    expect(result.meta.startSplitWallIds).toEqual([]);
  });

  it("34. legacy pts-only wall-end downgrades safely", () => {
    const plan = {
      nodes: {},
      walls: [{ id: "legacy", pts: [{ x: 0, y: 0 }, { x: 6000, y: 0 }] }],
      room: { height: 3000 },
    };
    const result = commitDrawnWall(plan, { x: 0, y: 0 }, { x: -1000, y: 1000 }, {}, makeIds(), {
      startIntent: wallEndIntent("legacy", "missing", { x: 0, y: 0 }),
      endIntent: noneIntent({ x: -1000, y: 1000 }),
    });
    expect(result.intentWarnings[0].code).toBe("INTENT_DOWNGRADED_LEGACY_WALL");
    expect(result.meta.intents.start.kind).toBe("none");
  });

  it("35. invalid wall-body host fails closed instead of inferring a nearby host", () => {
    const plan = planWithHost();
    const point = { x: 2000, y: 0 };
    const result = commitDrawnWall(plan, point, { x: 2000, y: 1000 }, {}, makeIds(), {
      startIntent: wallBodyIntent("missing", point), endIntent: noneIntent({ x: 2000, y: 1000 }),
    });
    expect(result.intentWarnings[0].code).toBe("INTENT_REJECTED_WALL_BODY");
    expect(result.meta.startSplitWallIds).toEqual([]);
    expect(result.plan.walls.filter((item) => item.id === "host")).toHaveLength(1);
  });
});
