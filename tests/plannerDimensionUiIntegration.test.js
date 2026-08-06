/**
 * Dimension UI integration — render geometry + pick + wall command compatibility.
 */
import { describe, expect, it } from "vitest";
import {
  computeAngleArcGeometry,
  computeLinearDimensionGeometry,
  hitTestDimension,
} from "../src/planner/core/dimensions/renderGeometry.js";
import {
  geometryForDimension,
  pickDimensionHit,
} from "../src/planner/dimensionMarkers.jsx";
import {
  createWallDimension,
} from "../src/planner/core/dimensions/anchorOperations.js";
import {
  addWall, moveNode, splitWall, deleteWall,
} from "../src/planner/core/walls/wallCommands.js";
import { materializeWallCommand } from "../src/planner/core/walls/applyWallCommand.js";
import { stripEphemeralPlanFields } from "../src/planner/core/history/planAutosaveBridge.js";

let n = 0;
const makeId = (p) => `ui_${p}${++n}`;

describe("dimension UI render + pick", () => {
  it("linear geometry exposes line, extensions, ticks", () => {
    const g = computeLinearDimensionGeometry({ p1: { x: 0, y: 0 }, p2: { x: 2000, y: 0 }, offset: 100 });
    expect(g.valid).toBe(true);
    expect(g.extensionLines).toHaveLength(2);
    expect(g.ticks).toHaveLength(2);
  });

  it("angle 90 and reversed rays match", () => {
    const a = computeAngleArcGeometry({
      vertex: { x: 0, y: 0 },
      ray1: { x: 1000, y: 0 },
      ray2: { x: 0, y: 1000 },
      radius: 120,
    });
    const b = computeAngleArcGeometry({
      vertex: { x: 0, y: 0 },
      ray1: { x: 0, y: 1000 },
      ray2: { x: 1000, y: 0 },
      radius: 120,
    });
    expect(a.angle).toBeCloseTo(90);
    expect(b.angle).toBe(a.angle);
    expect(b.start).toEqual(a.start);
  });

  it("invalid zero-length geometry does not throw", () => {
    expect(() => geometryForDimension({ id: "bad", mode: "linear", p1: { x: 1, y: 1 }, p2: { x: 1, y: 1 } })).not.toThrow();
    expect(geometryForDimension({ id: "bad", mode: "linear", p1: { x: 1, y: 1 }, p2: { x: 1, y: 1 } }).valid).toBe(false);
    expect(geometryForDimension({ id: "ang", mode: "angle", invalid: true, vertex: { x: 0, y: 0 } }).valid).toBe(false);
  });

  it("hit-area is screen-space invariant across zoom", () => {
    const dim = { id: "d1", mode: "linear", p1: { x: 0, y: 0 }, p2: { x: 1000, y: 0 }, offset: 100 };
    const g100 = geometryForDimension(dim, 1);
    const g25 = geometryForDimension(dim, 0.25);
    const g400 = geometryForDimension(dim, 4);
    const mid = { x: 500, y: 100 };
    expect(hitTestDimension(g100, mid, { zoom: 1 }).hit).toBe(true);
    expect(hitTestDimension(g25, mid, { zoom: 0.25 }).hit).toBe(true);
    expect(hitTestDimension(g400, mid, { zoom: 4 }).hit).toBe(true);
    const far = { x: 500, y: 2000 };
    expect(hitTestDimension(g100, far, { zoom: 1 }).hit).toBe(false);
    expect(hitTestDimension(g25, far, { zoom: 0.25 }).hit).toBe(false);
    expect(hitTestDimension(g400, far, { zoom: 4 }).hit).toBe(false);
  });

  it("pickDimensionHit prefers nearer and stable tie-break", () => {
    const dims = [
      { id: "b", mode: "linear", p1: { x: 0, y: 0 }, p2: { x: 1000, y: 0 }, offset: 100 },
      { id: "a", mode: "linear", p1: { x: 0, y: 0 }, p2: { x: 1000, y: 0 }, offset: 100 },
    ];
    const hit = pickDimensionHit(dims, { x: 500, y: 100 }, { zoom: 1 });
    expect(hit.id).toBe("a");
  });

  it("label/style edits do not change anchors", () => {
    const d = createWallDimension({ id: "m", wallId: "w1", offset: 120 });
    const anchorsBefore = JSON.stringify(d.anchors);
    const edited = { ...d, labelOverride: "X", offset: 200, style: { importance: "important" } };
    expect(JSON.stringify(edited.anchors)).toBe(anchorsBefore);
    expect(edited.offset).toBe(200);
  });
});

describe("dimension UI × wall commands", () => {
  it("split/delete keep manual dims and strip warnings from persist", () => {
    n = 0;
    let plan = { nodes: {}, walls: [], dimensions: [], rooms: [{ id: "r1" }], zones: [{ id: "z1" }] };
    plan = addWall(plan, { x: 0, y: 0 }, { x: 4000, y: 0 }, {}, makeId).plan;
    const w = plan.walls[0];
    plan.dimensions = [
      createWallDimension({ id: "man", wallId: w.id }),
      { id: "amb", anchors: [{ type: "wall", wallId: w.id }] },
    ];
    const mid = {
      x: (plan.nodes[w.a].x + plan.nodes[w.b].x) / 2,
      y: (plan.nodes[w.a].y + plan.nodes[w.b].y) / 2,
    };
    const split = materializeWallCommand(plan, splitWall(plan, w.id, mid, makeId));
    expect(split.plan.dimensions.some((d) => d.id === "man")).toBe(true);
    expect(split.warnings.some((warn) => warn.code === "DIMENSION_ANCHOR_NEEDS_REVIEW")).toBe(true);
    const stripped = stripEphemeralPlanFields(split.plan);
    expect((stripped.validationWarnings || []).some((warn) => warn.source === "wall-command")).toBe(false);

    const del = materializeWallCommand(split.plan, deleteWall(split.plan, w.id));
    expect(del.plan.dimensions.find((d) => d.id === "man")?.invalid).toBe(true);
  });

  it("move updates linear value used by renderer", () => {
    n = 0;
    let plan = { nodes: {}, walls: [], dimensions: [] };
    plan = addWall(plan, { x: 0, y: 0 }, { x: 4000, y: 0 }, {}, makeId).plan;
    const w = plan.walls[0];
    plan.dimensions = [createWallDimension({ id: "m", wallId: w.id, labelOverride: "L", offset: 90 })];
    const moved = materializeWallCommand(plan, moveNode(plan, w.b, { x: 5000, y: 0 })).plan;
    const dim = moved.dimensions.find((d) => d.id === "m");
    const g = geometryForDimension(dim, 1);
    expect(g.valid).toBe(true);
    expect(g.length).toBeCloseTo(5000);
    expect(dim.labelOverride).toBe("L");
    expect(dim.offset).toBe(90);
  });
});
