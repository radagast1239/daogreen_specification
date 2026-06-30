import { describe, expect, it } from "vitest";
import { weldWallNodes, filterRoomLoops, findClosedLoops } from "../src/planner/wallGeometry.js";
import { collectWallParts } from "../src/planner/wallRender.jsx";

function rectWalls(ox, oy, w, h, prefix = "w") {
  const p0 = { x: ox, y: oy };
  const p1 = { x: ox + w, y: oy };
  const p2 = { x: ox + w, y: oy + h };
  const p3 = { x: ox, y: oy + h };
  return [
    { id: `${prefix}0`, role: "partition", thk: 100, pts: [p0, p1] },
    { id: `${prefix}1`, role: "partition", thk: 100, pts: [p1, p2] },
    { id: `${prefix}2`, role: "partition", thk: 100, pts: [p2, p3] },
    { id: `${prefix}3`, role: "partition", thk: 100, pts: [p3, p0] },
  ];
}

function slabThickness(poly) {
  const o0 = poly[0];
  const o1 = poly[1];
  const i0 = poly[3];
  const dx = o1.x - o0.x;
  const dy = o1.y - o0.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  return Math.abs((i0.x - o0.x) * nx + (i0.y - o0.y) * ny);
}

describe("wallRender constant thickness", () => {
  it("keeps parallel wall thickness at L corner", () => {
    const room = { w: 10000, h: 8000 };
    const walls = weldWallNodes([
      { id: "h", thk: 100, role: "partition", pts: [{ x: 0, y: 2000 }, { x: 4000, y: 2000 }] },
      { id: "v", thk: 100, role: "partition", pts: [{ x: 4000, y: 2000 }, { x: 4000, y: 5000 }] },
    ]);
    const wall = walls.find((w) => w.id === "h");
    const { slabs } = collectWallParts(wall, [], room, walls);
    expect(slabs.length).toBeGreaterThan(0);
    const thicks = slabs.map((s) => slabThickness(s.poly));
    thicks.forEach((t) => expect(Math.abs(t - 100)).toBeLessThan(2));
  });
});

describe("merge T-junction room cells", () => {
  it("merges spurious face loops inside one room", () => {
    const outer = weldWallNodes(rectWalls(0, 0, 8000, 6000, "o"));
    const walls = weldWallNodes([
      ...outer,
      { id: "t1", role: "partition", thk: 100, pts: [{ x: 4000, y: 0 }, { x: 4000, y: 2500 }] },
      { id: "t2", role: "partition", thk: 100, pts: [{ x: 4000, y: 3500 }, { x: 4000, y: 6000 }] },
    ]);
    const raw = findClosedLoops(walls);
    const loops = filterRoomLoops(raw, walls);
    expect(loops.length).toBe(1);
  });
});
