import { describe, expect, it } from "vitest";
import { dist, angleBetweenDeg, projectOnSegment, segmentsIntersectProper, collinearOverlap } from "../src/planner/core/geometry/index.js";

describe("core/geometry (CAD)", () => {
  it("distance", () => {
    expect(dist({ x: 0, y: 0 }, { x: 3000, y: 4000 })).toBe(5000);
  });

  it("angle", () => {
    expect(angleBetweenDeg({ x: 0, y: 0 }, { x: 100, y: 0 })).toBe(0);
    expect(angleBetweenDeg({ x: 0, y: 0 }, { x: 0, y: 100 })).toBe(90);
  });

  it("projection point to segment", () => {
    const p = projectOnSegment({ x: 50, y: 100 }, { x: 0, y: 0 }, { x: 100, y: 0 });
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(0);
  });

  it("segment intersection", () => {
    expect(segmentsIntersectProper(
      { x: 0, y: 0 }, { x: 100, y: 100 },
      { x: 0, y: 100 }, { x: 100, y: 0 },
    )).toBe(true);
  });

  it("collinear overlap", () => {
    const o = collinearOverlap(
      { x: 100, y: 0 }, { x: 300, y: 0 },
      { x: 200, y: 0 }, { x: 400, y: 0 },
    );
    expect(o).toBeTruthy();
    expect(o.len).toBeCloseTo(100, 0);
  });
});
