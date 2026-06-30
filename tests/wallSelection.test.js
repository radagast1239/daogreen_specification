import { describe, expect, it } from "vitest";
import { DEFAULT_PLAN } from "../src/planner/catalog.js";
import { collectPlannerWarnings } from "../src/planner/geometry.js";
import { resolvePlanWalls, commitWallEdge } from "../src/planner/wallNetwork.js";
import { weldWallNodes } from "../src/planner/wallGeometry.js";
import { wallGeometryMap } from "../src/planner/buildWallGeometry.js";
import { collectWallParts } from "../src/planner/wallRender.jsx";

let n = 0;
const makeId = (p) => `${p}${++n}`;

describe("wall selection render path", () => {
  it("does not throw when wall is selected (network plan)", () => {
    n = 0;
    let plan = { ...DEFAULT_PLAN(), nodes: {}, walls: [] };
    plan = commitWallEdge(
      plan,
      { x: 1000, y: 2000 },
      { x: 5000, y: 2000 },
      { thk: 100, role: "partition", kind: "new" },
      makeId,
    );
    plan = commitWallEdge(
      plan,
      { x: 5000, y: 2000 },
      { x: 5000, y: 6000 },
      { thk: 100, role: "partition", kind: "new" },
      makeId,
    );
    const resolved = resolvePlanWalls(plan);
    expect(resolved.length).toBe(2);
    const wallId = resolved[0].id;
    const sel = { coll: "walls", id: wallId };

    expect(() => collectPlannerWarnings(plan, sel, {})).not.toThrow();

    const welded = weldWallNodes(resolved);
    expect(() => wallGeometryMap(welded, plan.room)).not.toThrow();
    welded.forEach((w) => {
      expect(() => collectWallParts(w, [], plan.room, welded)).not.toThrow();
    });
  });
});
