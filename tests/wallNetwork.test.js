import { describe, expect, it } from "vitest";
import {
  migratePtsWallsToNetwork,
  resolvePlanWalls,
  commitWallEdge,
  movePlanNode,
  deleteWallEdge,
  ensureWallNetwork,
} from "../src/planner/wallNetwork.js";

let n = 0;
const makeId = (p) => `${p}${++n}`;

describe("wallNetwork", () => {
  it("migrates L-shaped pts walls to shared node", () => {
    n = 0;
    const { nodes, walls } = migratePtsWallsToNetwork([
      { id: "h", thk: 100, pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }] },
      { id: "v", thk: 100, pts: [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }] },
    ], makeId);
    expect(walls.length).toBe(2);
    expect(walls[0].b).toBe(walls[1].a);
    expect(Object.keys(nodes).length).toBe(3);
    const resolved = resolvePlanWalls({ nodes, walls });
    expect(resolved[0].pts[1]).toEqual(resolved[1].pts[0]);
  });

  it("movePlanNode updates all walls sharing node", () => {
    n = 0;
    let plan = ensureWallNetwork({
      walls: [
        { id: "h", thk: 100, pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }] },
        { id: "v", thk: 100, pts: [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }] },
      ],
    }, makeId);
    const corner = plan.walls[0].b;
    plan = movePlanNode(plan, corner, { x: 4100, y: 0 });
    const rw = resolvePlanWalls(plan);
    expect(rw[0].pts[1].x).toBe(4100);
    expect(rw[1].pts[0].x).toBe(4100);
  });

  it("commitWallEdge adds edge and deletes cleanly", () => {
    n = 0;
    let plan = { nodes: {}, walls: [], room: { height: 3000 } };
    plan = commitWallEdge(plan, { x: 0, y: 0 }, { x: 5000, y: 0 }, { thk: 100, role: "partition" }, makeId);
    expect(plan.walls.length).toBe(1);
    const wid = plan.walls[0].id;
    plan = deleteWallEdge(plan, wid);
    expect(plan.walls.length).toBe(0);
    expect(Object.keys(plan.nodes).length).toBe(0);
  });
});
