import { describe, expect, it } from "vitest";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";
import { weldWallNodes } from "../src/planner/core/walls/wallOps.js";
import { buildWallGeometry } from "../src/planner/buildWallGeometry.js";

// NOTE: this file intentionally does NOT import detectRooms (see
// plannerLeafRooms.test.js) -- combining it with weldWallNodes/
// buildWallGeometry in the same module graph triggers a pre-existing
// ambiguous star-export collision between two ../core/walls/*.js files that
// both define a same-named helper, silently making the barrel's export
// `undefined`. Out of scope to fix here; splitting the test files sidesteps it.

const EPS = 1e-6;

// One external rectangle, one central partition welded into two T-junctions.
function twoRoomFixture(reversed = false) {
  const rev = (a, b) => (reversed ? [b, a] : [a, b]);
  const walls = [
    ["tw-top-l", "m1", "m5"], ["tw-top-r", "m5", "m2"], ["tw-right", "m2", "m3"],
    ["tw-bottom-r", "m3", "m6"], ["tw-bottom-l", "m6", "m4"], ["tw-left", "m4", "m1"],
    ["tw-mid", "m5", "m6"],
  ].map(([id, a, b]) => {
    const [ra, rb] = rev(a, b);
    return { id, a: ra, b: rb, thk: id === "tw-mid" ? 150 : 200, role: id === "tw-mid" ? "partition" : "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall" };
  });
  return {
    nodes: {
      m1: { x: 0, y: 0 }, m2: { x: 4000, y: 0 }, m3: { x: 4000, y: 3000 }, m4: { x: 0, y: 3000 },
      m5: { x: 2000, y: 0 }, m6: { x: 2000, y: 3000 },
    },
    walls,
    room: { w: 4000, h: 3000, wallThk: 200, height: 3000 },
    items: [], lines: [], dimensions: [],
  };
}

describe("T-junction visible geometry (branch caps at host inner face)", () => {
  it("9. the partition's outline ends exactly at the host wall's inner face on both ends", () => {
    const plan = twoRoomFixture();
    const walls = weldWallNodes(resolvePlanWalls(plan));
    const geom = buildWallGeometry(walls, plan.room);
    const midPoly = geom.polygons.find((p) => p.wallId === "tw-mid");
    expect(midPoly).toBeTruthy();
    const ys = midPoly.quad.map((p) => p.y);
    // top wall (thk 200) inner face is at y=100, bottom wall inner face at y=2900
    expect(Math.min(...ys)).toBeCloseTo(100, 0);
    expect(Math.max(...ys)).toBeCloseTo(2900, 0);
  });

  it("10. host outer face remains continuous (the two host sub-segments meet exactly at the junction x, not offset)", () => {
    const plan = twoRoomFixture();
    const walls = weldWallNodes(resolvePlanWalls(plan));
    const geom = buildWallGeometry(walls, plan.room);
    const left = geom.polygons.find((p) => p.wallId === "tw-top-l");
    const right = geom.polygons.find((p) => p.wallId === "tw-top-r");
    const leftOuterEnd = left.quad[1]; // outerB
    const rightOuterStart = right.quad[0]; // outerA
    expect(Math.abs(leftOuterEnd.x - rightOuterStart.x)).toBeLessThan(3);
    expect(Math.abs(leftOuterEnd.y - rightOuterStart.y)).toBeLessThan(3);
  });

  it("11. no visible branch cap point lies beyond the host's outer face", () => {
    const plan = twoRoomFixture();
    const walls = weldWallNodes(resolvePlanWalls(plan));
    const geom = buildWallGeometry(walls, plan.room);
    const midPoly = geom.polygons.find((p) => p.wallId === "tw-mid");
    for (const p of midPoly.quad) {
      expect(p.y).toBeGreaterThanOrEqual(100 - EPS);
      expect(p.y).toBeLessThanOrEqual(2900 + EPS);
    }
  });

  it("12. no duplicate visible outline segment is produced for the junction", () => {
    const plan = twoRoomFixture();
    const walls = weldWallNodes(resolvePlanWalls(plan));
    const geom = buildWallGeometry(walls, plan.room);
    const keys = geom.contours.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("13. host wall inner/outer face spans are not shortened or clipped by the partition (hatch continuity proxy)", () => {
    const plan = twoRoomFixture();
    const walls = weldWallNodes(resolvePlanWalls(plan));
    const geom = buildWallGeometry(walls, plan.room);
    const left = geom.polygons.find((p) => p.wallId === "tw-top-l");
    const right = geom.polygons.find((p) => p.wallId === "tw-top-r");
    // outer edge total span should reconstruct the full 0..4000 width (offset by half-thickness)
    const leftOuterLen = Math.hypot(left.quad[1].x - left.quad[0].x, left.quad[1].y - left.quad[0].y);
    const rightOuterLen = Math.hypot(right.quad[1].x - right.quad[0].x, right.quad[1].y - right.quad[0].y);
    expect(leftOuterLen + rightOuterLen).toBeGreaterThan(4000 * 0.9);
  });

  it("14. top and bottom T-junction produce geometrically equivalent (mirrored) caps", () => {
    const plan = twoRoomFixture();
    const walls = weldWallNodes(resolvePlanWalls(plan));
    const geom = buildWallGeometry(walls, plan.room);
    const midPoly = geom.polygons.find((p) => p.wallId === "tw-mid");
    const topYs = midPoly.quad.filter((p) => p.y < 1500).map((p) => p.y);
    const botYs = midPoly.quad.filter((p) => p.y > 1500).map((p) => p.y);
    // both caps sit the same distance in from their respective host's centerline
    const topInset = Math.min(...topYs) - 0;
    const botInset = 3000 - Math.max(...botYs);
    expect(Math.abs(topInset - botInset)).toBeLessThan(2);
  });
});
