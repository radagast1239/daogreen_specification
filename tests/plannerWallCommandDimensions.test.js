/**
 * Dimension remapping/invalidation wired through wallCommands leaf ops.
 * Covers critical geometry×dimension cases without PlanPage/autosave.
 */
import { describe, it, expect } from "vitest";
import {
  addWall, moveNode, splitWall, deleteWall, deleteNode, mergeNodes, connectWallEndpoint,
} from "../src/planner/core/walls/wallCommands.js";
import {
  createWallDimension, createDiagonalDimension, createAngleDimension,
} from "../src/planner/core/dimensions/index.js";
import { ensureWallNetwork } from "../src/planner/wallNetwork.js";
import { loadPlannerFixture } from "./fixtures/planner/loadFixture.js";
import { materializeWallCommand } from "../src/planner/core/walls/applyWallCommand.js";
import { stripEphemeralPlanFields } from "../src/planner/core/history/planAutosaveBridge.js";

let n = 0;
const makeId = (p) => `cmd_${p}${++n}`;

function networkPlan(fixtureName) {
  n = 0;
  return ensureWallNetwork(loadPlannerFixture(fixtureName), makeId);
}

function rectWithDims(extraDims = []) {
  const plan = networkPlan("rectangle-room");
  const w = plan.walls[0];
  return {
    ...plan,
    dimensions: [
      createWallDimension({ id: "wall-man", wallId: w.id, labelOverride: "L", offset: 140 }),
      ...extraDims,
    ],
  };
}

describe("wallCommands × dimension anchors", () => {
  it("1. split remaps endpoint anchors and keeps dimension id", () => {
    const plan = networkPlan("rectangle-room");
    const w = plan.walls[0];
    const mid = {
      x: (plan.nodes[w.a].x + plan.nodes[w.b].x) / 2,
      y: (plan.nodes[w.a].y + plan.nodes[w.b].y) / 2,
    };
    const withDim = {
      ...plan,
      dimensions: [{
        id: "ep",
        mode: "linear",
        anchors: [
          { type: "wall_endpoint", wallId: w.id, endpoint: "a", nodeId: w.a },
          { type: "wall_endpoint", wallId: w.id, endpoint: "b", nodeId: w.b },
        ],
      }],
    };
    const r = splitWall(withDim, w.id, mid, makeId);
    expect(r.changed).toBe(true);
    const dim = r.plan.dimensions.find((d) => d.id === "ep");
    expect(dim).toBeTruthy();
    expect(dim.anchors.map((a) => a.wallId)).toEqual([w.id, r.affectedWallIds[1]]);
    expect(r.affectedDimensionIds).toContain("ep");
  });

  it("2. split whole-wall projection remaps safely; ambiguous wall anchor needs review", () => {
    const plan = networkPlan("rectangle-room");
    const w = plan.walls[0];
    const mid = {
      x: (plan.nodes[w.a].x + plan.nodes[w.b].x) / 2,
      y: (plan.nodes[w.a].y + plan.nodes[w.b].y) / 2,
    };
    const withDim = {
      ...plan,
      dimensions: [
        createWallDimension({ id: "proj", wallId: w.id }),
        { id: "amb", anchors: [{ type: "wall", wallId: w.id }] },
      ],
    };
    const r = splitWall(withDim, w.id, mid, makeId);
    const proj = r.plan.dimensions.find((d) => d.id === "proj");
    expect(proj.anchors.map((a) => a.wallId)).toEqual([w.id, r.affectedWallIds[1]]);
    const amb = r.plan.dimensions.find((d) => d.id === "amb");
    expect(amb.invalid).toBe(true);
    expect(r.warnings.some((w) => w.code === "DIMENSION_ANCHOR_NEEDS_REVIEW" && w.dimensionId === "amb")).toBe(true);
    expect(r.plan.dimensions.filter((d) => d.id === "proj" || d.id === "amb")).toHaveLength(2);
  });

  it("3. moveNode updates shared-wall dimensions; free/item untouched", () => {
    const plan = networkPlan("rectangle-room");
    const w = plan.walls[0];
    const nodeId = w.a;
    const free = { id: "free", anchors: [{ type: "free", point: { x: 11, y: 22 } }], p1: { x: 11, y: 22 }, p2: { x: 33, y: 44 } };
    const item = { id: "item-d", anchors: [{ type: "item", itemId: "door" }] };
    const withDim = {
      ...plan,
      items: [...(plan.items || []), { id: "door", x: 100, y: 100, w: 900, h: 100 }],
      dimensions: [
        createWallDimension({ id: "wm", wallId: w.id, labelOverride: "keep", style: { c: 1 }, offset: 99 }),
        free,
        item,
      ],
    };
    const target = { x: plan.nodes[nodeId].x + 500, y: plan.nodes[nodeId].y + 250 };
    const r = moveNode(withDim, nodeId, target);
    const wm = r.plan.dimensions.find((d) => d.id === "wm");
    expect(wm).toMatchObject({ id: "wm", labelOverride: "keep", style: { c: 1 }, offset: 99 });
    expect(wm.value).toBeCloseTo(Math.hypot(
      r.plan.nodes[w.b].x - r.plan.nodes[w.a].x,
      r.plan.nodes[w.b].y - r.plan.nodes[w.a].y,
    ));
    expect(r.plan.dimensions.find((d) => d.id === "free")).toMatchObject({ p1: free.p1, p2: free.p2 });
    expect(r.plan.dimensions.find((d) => d.id === "item-d").anchors[0].itemId).toBe("door");
  });

  it("4. deleteWall keeps manual (invalid+warning) and drops eligible auto", () => {
    const plan = networkPlan("rectangle-room");
    const w = plan.walls[0];
    const withDim = {
      ...plan,
      dimensions: [
        createWallDimension({ id: "man", wallId: w.id }),
        { id: "auto1", auto: true, mode: "linear", anchors: [{ type: "wall", wallId: w.id }] },
        createWallDimension({ id: "other", wallId: plan.walls[1].id }),
      ],
    };
    const r = deleteWall(withDim, w.id);
    expect(r.plan.dimensions.map((d) => d.id).sort()).toEqual(["man", "other"]);
    expect(r.plan.dimensions.find((d) => d.id === "man").invalid).toBe(true);
    expect(r.warnings.some((w) => w.code === "DIMENSION_ANCHOR_INVALID" && w.dimensionId === "man")).toBe(true);
    expect(r.affectedDimensionIds).toEqual(expect.arrayContaining(["man", "auto1"]));
  });

  it("5. deleteNode warns on lost diagonal anchors without random rebind", () => {
    const plan = networkPlan("rectangle-room");
    const w = plan.walls[0];
    const withDim = {
      ...plan,
      dimensions: [createDiagonalDimension({ id: "diag", fromNodeId: w.a, toNodeId: w.b })],
    };
    const r = deleteNode(withDim, w.a);
    const diag = r.plan.dimensions.find((d) => d.id === "diag");
    expect(diag).toBeTruthy();
    expect(diag.invalid).toBe(true);
    expect(diag.anchors.some((a) => a.nodeId === w.a)).toBe(true);
    expect(r.warnings.some((w) => w.dimensionId === "diag")).toBe(true);
  });

  it("6. mergeNodes remaps anchors, dedupes auto, keeps manual", () => {
    n = 0;
    let plan = { nodes: {}, walls: [], dimensions: [] };
    plan = addWall(plan, { x: 0, y: 0 }, { x: 4000, y: 0 }, {}, makeId).plan;
    // 200mm > NODE_LINK_THR so the second start is a distinct node
    plan = addWall(plan, { x: 4000, y: 200 }, { x: 4000, y: 3000 }, {}, makeId).plan;
    const keep = plan.walls[0].b;
    const drop = plan.walls[1].a;
    expect(keep).not.toBe(drop);
    const anchors = [{ type: "node", nodeId: keep }, { type: "node", nodeId: drop }];
    plan = {
      ...plan,
      dimensions: [
        createDiagonalDimension({ id: "man", fromNodeId: keep, toNodeId: drop }),
        { id: "a1", auto: true, mode: "linear", kind: "wall_length", source: "walls", anchors },
        { id: "a2", auto: true, mode: "linear", kind: "wall_length", source: "walls", anchors: [...anchors].reverse() },
      ],
    };
    const r = mergeNodes(plan, keep, drop);
    expect(r.plan.nodes[drop]).toBeUndefined();
    const man = r.plan.dimensions.find((d) => d.id === "man");
    expect(man.anchors.map((a) => a.nodeId)).toEqual([keep, keep]);
    expect(r.plan.dimensions.filter((d) => d.auto)).toHaveLength(1);
    expect(r.plan.dimensions.some((d) => d.id === "man")).toBe(true);
  });

  it("7. connectWallEndpoint preserves dim ids and avoids duplicates", () => {
    n = 0;
    let plan = { nodes: {}, walls: [], dimensions: [] };
    plan = addWall(plan, { x: 0, y: 0 }, { x: 6000, y: 0 }, {}, makeId).plan;
    const host = plan.walls[0];
    plan = addWall(plan, { x: 3000, y: 2000 }, { x: 3000, y: 50 }, {}, makeId).plan;
    const floating = plan.walls[1];
    const tip = floating.b;
    plan = {
      ...plan,
      dimensions: [createWallDimension({ id: "host-d", wallId: host.id })],
    };
    const r = connectWallEndpoint(plan, tip, host.id, { x: 3000, y: 0 }, makeId);
    expect(r.changed).toBe(true);
    const ids = r.plan.dimensions.map((d) => d.id);
    expect(ids).toEqual([...new Set(ids)]);
    expect(ids).toContain("host-d");
  });

  it("8. door/window attachment survives split", () => {
    const plan = networkPlan("rectangle-room");
    const w = plan.walls[0];
    const a = plan.nodes[w.a];
    const b = plan.nodes[w.b];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const withItem = {
      ...plan,
      items: [{ id: "door1", type: "door", wallId: w.id, x: mid.x, y: mid.y, w: 900, h: 100 }],
      dimensions: [createWallDimension({ id: "wm", wallId: w.id })],
    };
    const r = splitWall(withItem, w.id, mid, makeId);
    expect(r.plan.items.some((it) => it.id === "door1")).toBe(true);
    expect(r.plan.dimensions.find((d) => d.id === "wm")).toBeTruthy();
  });

  it("9. diagonal + angle update after moveNode", () => {
    const plan = networkPlan("rectangle-room");
    const walls = plan.walls;
    // find a shared corner used by two walls
    const counts = {};
    for (const w of walls) {
      counts[w.a] = (counts[w.a] || 0) + 1;
      counts[w.b] = (counts[w.b] || 0) + 1;
    }
    const vertex = Object.keys(counts).find((id) => counts[id] >= 2);
    const touching = walls.filter((w) => w.a === vertex || w.b === vertex);
    const ray1 = touching[0].a === vertex ? touching[0].b : touching[0].a;
    const ray2 = touching[1].a === vertex ? touching[1].b : touching[1].a;
    const withDim = {
      ...plan,
      dimensions: [
        createDiagonalDimension({ id: "diag", fromNodeId: ray1, toNodeId: ray2 }),
        createAngleDimension({ id: "ang", vertexNodeId: vertex, rayNodeId1: ray1, rayNodeId2: ray2 }),
      ],
    };
    const beforeAng = withDim.dimensions[1];
    const r = moveNode(withDim, ray1, {
      x: plan.nodes[ray1].x + 400,
      y: plan.nodes[ray1].y + 100,
    });
    const diag = r.plan.dimensions.find((d) => d.id === "diag");
    const ang = r.plan.dimensions.find((d) => d.id === "ang");
    expect(diag.value).not.toBe(Math.hypot(
      plan.nodes[ray2].x - plan.nodes[ray1].x,
      plan.nodes[ray2].y - plan.nodes[ray1].y,
    ));
    expect(Number.isFinite(ang.angle ?? ang.value)).toBe(true);
    expect(ang.id).toBe("ang");
    expect(beforeAng).toBeTruthy();
  });

  it("10. corrupt anchors do not crash wall commands", () => {
    const plan = rectWithDims([{ id: "bad", anchors: [{ type: "node" }] }]);
    expect(() => moveNode(plan, plan.walls[0].a, { x: 10, y: 10 })).not.toThrow();
    expect(() => deleteWall(plan, plan.walls[0].id)).not.toThrow();
    expect(() => splitWall(plan, plan.walls[0].id, {
      x: (plan.nodes[plan.walls[0].a].x + plan.nodes[plan.walls[0].b].x) / 2,
      y: (plan.nodes[plan.walls[0].a].y + plan.nodes[plan.walls[0].b].y) / 2,
    }, makeId)).not.toThrow();
  });

  it("11. materialize keeps dimensions; wall-command warnings strip from persist", () => {
    const base = networkPlan("rectangle-room");
    const w = base.walls[0];
    const mid = {
      x: (base.nodes[w.a].x + base.nodes[w.b].x) / 2,
      y: (base.nodes[w.a].y + base.nodes[w.b].y) / 2,
    };
    const withDim = {
      ...base,
      dimensions: [
        createWallDimension({ id: "proj", wallId: w.id }),
        { id: "amb", anchors: [{ type: "wall", wallId: w.id }] },
      ],
    };
    const cmd = splitWall(withDim, w.id, mid, makeId);
    const mat = materializeWallCommand(withDim, cmd);
    expect(mat.plan.dimensions.some((d) => d.id === "proj")).toBe(true);
    expect(mat.plan.validationWarnings.some((warn) => warn.source === "wall-command")).toBe(true);
    const stripped = stripEphemeralPlanFields(mat.plan);
    expect((stripped.validationWarnings || []).some((warn) => warn.source === "wall-command")).toBe(false);
    expect(stripped.dimensions.some((d) => d.id === "proj")).toBe(true);
  });

  it("12. additive result fields present on every mutating command", () => {
    const plan = rectWithDims();
    const w = plan.walls[0];
    const mid = {
      x: (plan.nodes[w.a].x + plan.nodes[w.b].x) / 2,
      y: (plan.nodes[w.a].y + plan.nodes[w.b].y) / 2,
    };
    for (const r of [
      moveNode(plan, w.a, { x: plan.nodes[w.a].x + 10, y: plan.nodes[w.a].y }),
      splitWall(plan, w.id, mid, makeId),
      deleteWall(plan, w.id),
    ]) {
      expect(r).toEqual(expect.objectContaining({
        plan: expect.any(Object),
        changed: expect.any(Boolean),
        affectedNodeIds: expect.any(Array),
        affectedWallIds: expect.any(Array),
        affectedDimensionIds: expect.any(Array),
        warnings: expect.any(Array),
      }));
    }
  });
});
