import { describe, expect, it } from "vitest";
import {
  weldWallNodes, setWallSegmentLength, wallSegmentLengthAt,
  findWallIntersections, angleAt, draftChainArea,
} from "../src/planner/core/walls/index.js";

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

describe("core/walls", () => {
  it("setWallSegmentLength sets exact length", () => {
    const wall = { id: "w", thk: 100, pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
    const next = setWallSegmentLength(wall, 4000);
    expect(wallSegmentLengthAt(next, 1)).toBeCloseTo(4000, 0);
  });

  it("weldWallNodes merges close endpoints", () => {
    const walls = [
      { id: "a", thk: 100, pts: [{ x: 0, y: 0 }, { x: 4000, y: 3 }] },
      { id: "b", thk: 100, pts: [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }] },
    ];
    const welded = weldWallNodes(walls);
    expect(welded[0].pts[1].x).toBeCloseTo(welded[1].pts[0].x, 0);
    expect(welded[0].pts[1].y).toBeCloseTo(welded[1].pts[0].y, 0);
  });

  it("nested rectangles do not intersect", () => {
    const outer = weldWallNodes(rectWalls(0, 0, 10000, 8000, "o"));
    const inner = weldWallNodes(rectWalls(3000, 2000, 2750, 2950, "i"));
    expect(findWallIntersections([...outer, ...inner])).toEqual([]);
  });

  it("angleAt returns corner angle at node", () => {
    const walls = [
      { id: "h", pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }] },
      { id: "v", pts: [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }] },
    ];
    expect(angleAt({ x: 4000, y: 0 }, walls)).toContain(90);
  });

  it("draftChainArea for closing rectangle", () => {
    const pts = [
      { x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 },
      { x: 0, y: 3000 }, { x: 0, y: 0 },
    ];
    expect(draftChainArea(pts)).toBeCloseTo(12, 0);
  });
});
