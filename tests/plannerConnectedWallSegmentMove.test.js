import { describe, expect, it } from "vitest";
import {
  classifyWallSegmentAttachments,
  moveWallSegment,
} from "../src/planner/core/walls/wallCommands.js";
import { movePlanNode, resolvePlanWalls } from "../src/planner/wallNetwork.js";
import { findUnnodedCrossings } from "../src/planner/core/walls/renderedContours.js";
import { detectRooms } from "../src/planner/core/rooms/detectRooms.js";

const props = (chainId) => ({
  thk: 100,
  role: "partition",
  kind: "new",
  thicknessSide: "center",
  height: 3000,
  material: "drywall",
  chainId,
  locked: false,
  createdAt: 1,
  updatedAt: 1,
});

function idFactory(seed = 0) {
  let n = seed;
  return (prefix) => `move_${prefix}_${++n}`;
}

function twoHostPlan() {
  return {
    nodes: {
      leftTop: { x: 0, y: 0 },
      n_msc6v2duc43lq: { x: 0, y: 2000 },
      leftBottom: { x: 0, y: 4000 },
      rightTop: { x: 4000, y: 0 },
      n_msc6t3h4nsncd: { x: 4000, y: 2000 },
      rightBottom: { x: 4000, y: 4000 },
    },
    walls: [
      { id: "left-host-a", a: "leftTop", b: "n_msc6v2duc43lq", ...props("left-host") },
      { id: "left-host-b", a: "n_msc6v2duc43lq", b: "leftBottom", ...props("left-host") },
      { id: "right-host-a", a: "rightTop", b: "n_msc6t3h4nsncd", ...props("right-host") },
      { id: "right-host-b", a: "n_msc6t3h4nsncd", b: "rightBottom", ...props("right-host") },
      {
        id: "wl_msc6v2duh13mn",
        a: "n_msc6v2duc43lq",
        b: "n_msc6t3h4nsncd",
        ...props("moved-wall"),
      },
      { id: "top", a: "leftTop", b: "rightTop", ...props("top") },
      { id: "bottom", a: "leftBottom", b: "rightBottom", ...props("bottom") },
    ],
    items: [],
    dimensions: [],
    rooms: [],
  };
}

function freePlan() {
  return {
    nodes: { a: { x: 0, y: 0 }, b: { x: 2000, y: 0 } },
    walls: [{ id: "selected", a: "a", b: "b", ...props("selected") }],
    items: [], dimensions: [], rooms: [],
  };
}

function move(plan, wallId = "wl_msc6v2duh13mn", delta = { x: 0, y: 500 }, seed = 0) {
  const expectedEndpointAttachments = classifyWallSegmentAttachments(plan, wallId);
  return moveWallSegment(plan, { wallId, delta, expectedEndpointAttachments, makeId: idFactory(seed) });
}

function incidentCount(plan, nodeId) {
  return plan.walls.filter((wall) => wall.a === nodeId || wall.b === nodeId).length;
}

function topologyProblems(plan) {
  const used = new Set(plan.walls.flatMap((wall) => [wall.a, wall.b]));
  const edges = plan.walls.map((wall) => [wall.a, wall.b].sort().join("|"));
  return {
    crossings: findUnnodedCrossings(resolvePlanWalls(plan)),
    orphans: Object.keys(plan.nodes).filter((id) => !used.has(id)),
    duplicates: edges.filter((edge, index) => edges.indexOf(edge) !== index),
    zero: plan.walls.filter((wall) => wall.a === wall.b),
  };
}

function geometryFingerprint(plan) {
  return resolvePlanWalls(plan).map((wall) => {
    const pts = [wall.pts[0], wall.pts[wall.pts.length - 1]]
      .map((point) => `${point.x.toFixed(4)},${point.y.toFixed(4)}`)
      .sort();
    return pts.join("|");
  }).sort();
}

describe("moveWallSegment — atomic topology-safe connected move", () => {
  it("1. translates a free segment normally", () => {
    const result = move(freePlan(), "selected", { x: 100, y: 250 });
    expect(result.changed).toBe(true);
    const wall = resolvePlanWalls(result.plan)[0];
    expect(wall.pts).toEqual([{ x: 100, y: 250 }, { x: 2100, y: 250 }]);
  });

  it("2. supports one free endpoint and one T-host endpoint", () => {
    const plan = twoHostPlan();
    plan.walls = plan.walls.filter((wall) => !["right-host-a", "right-host-b", "top", "bottom"].includes(wall.id));
    plan.nodes = Object.fromEntries(Object.entries(plan.nodes).filter(([id]) => !["rightTop", "rightBottom"].includes(id)));
    const result = move(plan);
    expect(result.changed).toBe(true);
    expect(result.movement.startAttachment.type).toBe("tee");
    expect(result.movement.endAttachment.type).toBe("free");
  });

  it("3. reattaches both endpoints to different parallel hosts", () => {
    const result = move(twoHostPlan());
    expect(result.changed).toBe(true);
    const selected = result.plan.walls.find((wall) => wall.id === "wl_msc6v2duh13mn");
    expect(result.plan.nodes[selected.a]).toEqual({ x: 0, y: 2500 });
    expect(result.plan.nodes[selected.b]).toEqual({ x: 4000, y: 2500 });
    expect(incidentCount(result.plan, selected.a)).toBe(3);
    expect(incidentCount(result.plan, selected.b)).toBe(3);
  });

  it("4. heals both old host splits", () => {
    const result = move(twoHostPlan());
    expect(result.plan.nodes.n_msc6v2duc43lq).toBeUndefined();
    expect(result.plan.nodes.n_msc6t3h4nsncd).toBeUndefined();
    expect(result.movement.healedHosts).toHaveLength(2);
  });

  it("5. creates exact new host split nodes", () => {
    const result = move(twoHostPlan());
    expect(result.movement.createdSplitNodes).toHaveLength(2);
    result.movement.createdSplitNodes.forEach(({ nodeId }) => {
      expect(incidentCount(result.plan, nodeId)).toBe(3);
    });
  });

  it("6. leaves host centerlines unchanged", () => {
    const result = move(twoHostPlan());
    const hosts = resolvePlanWalls(result.plan).filter((wall) => wall.chainId === "left-host" || wall.chainId === "right-host");
    expect(hosts.every((wall) => wall.pts[0].x === wall.pts[1].x)).toBe(true);
  });

  it("7. leaves unrelated host endpoints unchanged", () => {
    const result = move(twoHostPlan());
    expect(result.plan.nodes.leftTop).toEqual({ x: 0, y: 0 });
    expect(result.plan.nodes.leftBottom).toEqual({ x: 0, y: 4000 });
    expect(result.plan.nodes.rightTop).toEqual({ x: 4000, y: 0 });
    expect(result.plan.nodes.rightBottom).toEqual({ x: 4000, y: 4000 });
  });

  it("8. preserves selected length and angle under pure translation", () => {
    const before = resolvePlanWalls(twoHostPlan()).find((wall) => wall.id === "wl_msc6v2duh13mn");
    const after = resolvePlanWalls(move(twoHostPlan()).plan).find((wall) => wall.id === "wl_msc6v2duh13mn");
    expect(after.pts[1].x - after.pts[0].x).toBe(before.pts[1].x - before.pts[0].x);
    expect(after.pts[1].y - after.pts[0].y).toBe(before.pts[1].y - before.pts[0].y);
  });

  it("9-12. produces no unnoded crossing, orphan, duplicate edge, or zero wall", () => {
    expect(topologyProblems(move(twoHostPlan()).plan)).toEqual({ crossings: [], orphans: [], duplicates: [], zero: [] });
  });

  it("13. fails closed at a degree-4 endpoint", () => {
    const plan = twoHostPlan();
    plan.nodes.branch = { x: -1000, y: 2000 };
    plan.walls.push({ id: "extra-branch", a: "branch", b: "n_msc6v2duc43lq", ...props("extra") });
    const snapshot = structuredClone(plan);
    const result = move(plan);
    expect(result.changed).toBe(false);
    expect(result.reason).toBe("WALL_MOVE_UNSAFE_MULTI_JUNCTION");
    expect(result.plan).toBe(plan);
    expect(plan).toEqual(snapshot);
  });

  it("14. refuses to heal a host carrying an opening/dependent item", () => {
    const plan = twoHostPlan();
    plan.items = [{ id: "door", wallId: "left-host-a" }];
    const result = move(plan);
    expect(result.changed).toBe(false);
    expect(result.reason).toBe("WALL_MOVE_UNSAFE_HOST_HEAL");
  });

  it("15. handles an ambiguous same-host attachment deterministically", () => {
    const plan = twoHostPlan();
    const attachments = classifyWallSegmentAttachments(plan, "wl_msc6v2duh13mn");
    attachments.end.hostWallIds = [...attachments.start.hostWallIds];
    const result = moveWallSegment(plan, {
      wallId: "wl_msc6v2duh13mn", delta: { x: 0, y: 500 },
      expectedEndpointAttachments: attachments, makeId: idFactory(),
    });
    expect(result.changed).toBe(false);
    expect(result.reason).toBe("WALL_MOVE_ATTACHMENT_MISMATCH");
  });

  it("16. clamps a dual-tee destination to the shared finite-host interval", () => {
    const plan = twoHostPlan();
    const snapshot = structuredClone(plan);
    // Hosts span y∈[0,4000]; partition at y=2000. Requested +2500 would leave
    // both hosts — dual-tee clamp keeps a usable interior T (not a corner).
    const result = move(plan, "wl_msc6v2duh13mn", { x: 0, y: 2500 });
    expect(plan).toEqual(snapshot);
    expect(result.changed, result.reason).toBe(true);
    expect(result.movement.delta.x).toBeCloseTo(0, 6);
    expect(result.movement.delta.y).toBeGreaterThan(1500);
    expect(result.movement.delta.y).toBeLessThan(2000);
    const wall = result.plan.walls.find((w) => w.id === "wl_msc6v2duh13mn");
    const y = result.plan.nodes[wall.a].y;
    expect(y).toBeCloseTo(result.plan.nodes[wall.b].y, 6);
    expect(y).toBeGreaterThan(3500);
    expect(y).toBeLessThan(4000);
  });

  it("17. normalizes a genuine new crossing exactly into shared topology", () => {
    const plan = freePlan();
    plan.nodes.c = { x: 1000, y: 1000 };
    plan.nodes.d = { x: 1000, y: 3000 };
    plan.walls.push({ id: "crossed", a: "c", b: "d", ...props("crossed") });
    const result = move(plan, "selected", { x: 0, y: 2000 });
    expect(result.changed).toBe(true);
    expect(findUnnodedCrossings(resolvePlanWalls(result.plan))).toEqual([]);
    expect(Object.values(result.plan.nodes)).toContainEqual({ x: 1000, y: 2000 });
  });

  it("18. rejects a duplicate destination with no partial changes", () => {
    const plan = freePlan();
    plan.nodes.c = { x: 0, y: 500 };
    plan.nodes.d = { x: 2000, y: 500 };
    plan.walls.push({ id: "existing", a: "c", b: "d", ...props("existing") });
    const result = move(plan, "selected", { x: 0, y: 500 });
    expect(result.changed).toBe(false);
    expect(result.reason).toBe("DUPLICATE_WALL");
    expect(result.plan).toBe(plan);
  });

  it("19. never mutates the input plan", () => {
    const plan = twoHostPlan();
    const snapshot = structuredClone(plan);
    move(plan);
    expect(plan).toEqual(snapshot);
  });

  it("20. repeated connected moves remain valid", () => {
    const first = move(twoHostPlan());
    const second = move(first.plan, "wl_msc6v2duh13mn", { x: 0, y: 250 }, 100);
    expect(second.changed).toBe(true);
    expect(topologyProblems(second.plan)).toEqual({ crossings: [], orphans: [], duplicates: [], zero: [] });
  });

  it("21. moving back restores equivalent geometry", () => {
    const original = twoHostPlan();
    const moved = move(original);
    const restored = move(moved.plan, "wl_msc6v2duh13mn", { x: 0, y: -500 }, 100);
    expect(restored.changed).toBe(true);
    expect(geometryFingerprint(restored.plan)).toEqual(geometryFingerprint(original));
  });

  it("22. returns an Undo/Redo-safe serializable plan", () => {
    const result = move(twoHostPlan());
    expect(JSON.parse(JSON.stringify(result.plan))).toEqual(result.plan);
    expect(JSON.parse(JSON.stringify(result.movement))).toEqual(result.movement);
  });

  it("23. rejects stale pointerdown attachment expectations", () => {
    const plan = twoHostPlan();
    const expected = classifyWallSegmentAttachments(plan, "wl_msc6v2duh13mn");
    const changedBase = structuredClone(plan);
    changedBase.walls = changedBase.walls.filter((wall) => wall.id !== "left-host-b");
    const result = moveWallSegment(changedBase, {
      wallId: "wl_msc6v2duh13mn", delta: { x: 0, y: 500 }, expectedEndpointAttachments: expected, makeId: idFactory(),
    });
    expect(result.changed).toBe(false);
    expect(result.reason).toBe("WALL_MOVE_ATTACHMENT_MISMATCH");
  });

  it("24. reproduces the old shared-node corruption but the command preserves hosts", () => {
    const plan = twoHostPlan();
    const oldA = movePlanNode(plan, "n_msc6v2duc43lq", { x: 0, y: 2500 });
    const oldResult = movePlanNode(oldA, "n_msc6t3h4nsncd", { x: 4000, y: 2500 });
    expect(oldResult.nodes.n_msc6v2duc43lq).not.toEqual(plan.nodes.n_msc6v2duc43lq);
    expect(resolvePlanWalls(oldResult).filter((wall) => wall.chainId === "left-host").some((wall) => wall.pts[0].x !== wall.pts[1].x || wall.pts[0].y === 2500 || wall.pts[1].y === 2500)).toBe(true);
    const fixed = move(plan);
    expect(fixed.plan.nodes.leftTop).toEqual(plan.nodes.leftTop);
    expect(fixed.plan.nodes.leftBottom).toEqual(plan.nodes.leftBottom);
  });

  it("25. keeps the saved manual regression wall and endpoint identity in movement evidence", () => {
    const result = move(twoHostPlan());
    expect(result.movement.wallId).toBe("wl_msc6v2duh13mn");
    expect(result.movement.startAttachment.nodeId).toBe("n_msc6v2duc43lq");
    expect(result.movement.endAttachment.nodeId).toBe("n_msc6t3h4nsncd");
    expect(findUnnodedCrossings(resolvePlanWalls(result.plan))).toEqual([]);
  });

  it("26. remains valid for release-only room recomputation", () => {
    const result = move(twoHostPlan());
    const rooms = detectRooms({ ...result.plan, walls: resolvePlanWalls(result.plan) });
    expect(rooms).toHaveLength(2);
  });

  it("22-25. centre-handle on rectangle edge translates shared nodes; neighbors stretch", () => {
    const plan = {
      nodes: {
        a1: { x: 0, y: 0 }, a2: { x: 4000, y: 0 }, a3: { x: 4000, y: 3000 }, a4: { x: 0, y: 3000 },
      },
      walls: [
        { id: "a_t", a: "a1", b: "a2", ...props("a_t") },
        { id: "a_r", a: "a2", b: "a3", ...props("a_r") },
        { id: "a_b", a: "a3", b: "a4", ...props("a_b") },
        { id: "a_l", a: "a4", b: "a1", ...props("a_l") },
      ],
      items: [], dimensions: [], rooms: [],
    };
    const result = move(plan, "a_t", { x: 0, y: -500 });
    expect(result.changed).toBe(true);
    expect(result.plan.nodes.a1).toEqual({ x: 0, y: -500 });
    expect(result.plan.nodes.a2).toEqual({ x: 4000, y: -500 });
    expect(result.plan.nodes.a3).toEqual({ x: 4000, y: 3000 });
    expect(result.plan.nodes.a4).toEqual({ x: 0, y: 3000 });
    expect(result.plan.walls.find((w) => w.id === "a_t").a).toBe("a1");
    expect(result.plan.walls.find((w) => w.id === "a_t").b).toBe("a2");
    const left = resolvePlanWalls(result.plan).find((w) => w.id === "a_l");
    const right = resolvePlanWalls(result.plan).find((w) => w.id === "a_r");
    const leftLen = Math.hypot(left.pts[1].x - left.pts[0].x, left.pts[1].y - left.pts[0].y);
    const rightLen = Math.hypot(right.pts[1].x - right.pts[0].x, right.pts[1].y - right.pts[0].y);
    expect(leftLen).toBe(3500);
    expect(rightLen).toBe(3500);
    const top = resolvePlanWalls(result.plan).find((w) => w.id === "a_t");
    expect(Math.hypot(top.pts[1].x - top.pts[0].x, top.pts[1].y - top.pts[0].y)).toBe(4000);
  });
});
