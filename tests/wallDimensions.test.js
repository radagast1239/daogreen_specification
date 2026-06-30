import { describe, expect, it } from "vitest";
import { wallSegDimPoints, wallSegDimLength } from "../src/planner/dimensionMarkers.jsx";
import { wallFacePoint } from "../src/planner/wallParallelGeometry.js";

describe("wall dimensions", () => {
  const room = { w: 12000, h: 8000 };
  const wall = { thk: 100, thicknessSide: "center" };
  const a = { x: 0, y: 2000 };
  const b = { x: 4000, y: 2000 };

  it("anchors dimension line on outer face, not axis center", () => {
    const { a: fa, b: fb } = wallSegDimPoints(a, b, wall, room);
    const outerA = wallFacePoint(a, a, b, "outer", wall, room);
    const outerB = wallFacePoint(b, a, b, "outer", wall, room);
    expect(fa.x).toBeCloseTo(outerA.x, 1);
    expect(fa.y).toBeCloseTo(outerA.y, 1);
    expect(fb.x).toBeCloseTo(outerB.x, 1);
    expect(fb.y).toBeCloseTo(outerB.y, 1);
    expect(fa.y).not.toBeCloseTo(a.y, 0);
  });

  it("measures face span length equal to axis for straight wall", () => {
    const pts = wallSegDimPoints(a, b, wall, room);
    expect(wallSegDimLength(pts.a, pts.b)).toBeCloseTo(4000, 1);
  });
});
