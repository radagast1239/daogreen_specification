import { describe, expect, it } from "vitest";
import {
  findWallIntersections,
  findWallOverlaps,
  filterRoomLoops,
  findClosedLoops,
  weldWallNodes,
  syncZonesFromWalls,
} from "../src/planner/wallGeometry.js";

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

describe("nested partition rooms", () => {
  const outer = weldWallNodes(rectWalls(0, 0, 10000, 8000, "o"));
  const inner = weldWallNodes(rectWalls(3000, 2000, 2750, 2950, "i"));
  const walls = [...outer, ...inner];

  it("detects inner and outer closed loops", () => {
    const raw = findClosedLoops(walls);
    const loops = filterRoomLoops(raw, walls);
    expect(loops.length).toBeGreaterThanOrEqual(2);
    const areas = loops.map((poly) => {
      let a = 0;
      for (let i = 0; i < poly.length; i++) {
        const j = (i + 1) % poly.length;
        a += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
      }
      return Math.abs(a / 2);
    });
    expect(Math.min(...areas)).toBeLessThan(Math.max(...areas) * 0.5);
  });

  it("does not flag nested rectangle walls as intersecting", () => {
    expect(findWallIntersections(walls)).toEqual([]);
  });

  it("does not flag nested rectangle walls as overlapping", () => {
    expect(findWallOverlaps(walls)).toEqual([]);
  });
});

describe("room loop dedupe", () => {
  it("collapses duplicate cycles for a simple rectangle", () => {
    const walls = weldWallNodes(rectWalls(0, 0, 10000, 8000, "o"));
    const raw = findClosedLoops(walls);
    const loops = filterRoomLoops(raw, walls);
    expect(loops.length).toBe(1);
  });

  it("collapses T-junction cells inside one room to a single envelope", () => {
    const walls = weldWallNodes([
      ...rectWalls(0, 0, 11000, 11000, "o"),
      { id: "v", role: "partition", thk: 100, pts: [{ x: 5500, y: 500 }, { x: 5500, y: 6500 }] },
    ]);
    const raw = findClosedLoops(walls);
    expect(raw.length).toBeGreaterThanOrEqual(2);
    expect(filterRoomLoops(raw, walls).length).toBe(1);
    const { auto } = syncZonesFromWalls({ walls, room: { w: 12000, h: 12000, height: 3000 }, zones: [], items: [] });
    expect(auto.length).toBe(1);
  });
});

describe("T-junction", () => {
  it("allows partition ending on another wall mid-span", () => {
    const base = weldWallNodes([
      { id: "h", role: "partition", thk: 100, pts: [{ x: 0, y: 2000 }, { x: 8000, y: 2000 }] },
      { id: "v", role: "partition", thk: 100, pts: [{ x: 4000, y: 2000 }, { x: 4000, y: 5000 }] },
    ]);
    expect(findWallIntersections(base)).toEqual([]);
  });

  it("allows collinear segment on existing wall (shared edge)", () => {
    const base = weldWallNodes([
      ...rectWalls(0, 0, 10000, 8000, "o"),
      { id: "inner-top", role: "partition", thk: 100, pts: [{ x: 3000, y: 0 }, { x: 5750, y: 0 }] },
    ]);
    expect(findWallOverlaps(base)).toEqual([]);
  });
});
