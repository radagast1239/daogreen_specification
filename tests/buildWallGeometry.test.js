import { describe, expect, it } from "vitest";
import { weldWallNodes } from "../src/planner/wallGeometry.js";
import { buildWallGeometry, slabFromMiterQuad } from "../src/planner/buildWallGeometry.js";
import { nodeDiscCoverage } from "./helpers/wallPolygonAssertions.js";

// A wall's quad is emitted as [outerA, outerB, innerB, innerA], and which face
// buildWallGeometry calls "outer" is decided by wallSegmentOffsetSide, i.e.
// relative to the ROOM CENTRE. Two walls meeting at a corner can therefore
// carry OPPOSITE labels, in which case wallA.quad[1] and wallB.quad[0] are the
// two DIFFERENT ends of the same miter, a full thickness*sqrt(2) apart, even
// though the corner is perfectly shared. Compare the corner as a point SET.
const cornerSet = (pts, digits = 1) =>
  pts.map((p) => `${p.x.toFixed(digits)},${p.y.toFixed(digits)}`).sort().join(" ");

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

describe("buildWallGeometry miter", () => {
  it("shares corner point at L-junction between two walls", () => {
    const room = { w: 10000, h: 8000 };
    const walls = weldWallNodes([
      { id: "h", thk: 100, role: "partition", pts: [{ x: 0, y: 2000 }, { x: 4000, y: 2000 }] },
      { id: "v", thk: 100, role: "partition", pts: [{ x: 4000, y: 2000 }, { x: 4000, y: 5000 }] },
    ]);
    const { polygons } = buildWallGeometry(walls, room);
    const h = polygons.find((p) => p.wallId === "h");
    const v = polygons.find((p) => p.wallId === "v");
    expect(h).toBeTruthy();
    expect(v).toBeTruthy();
    // both walls contribute the SAME pair of corner points at the node
    expect(cornerSet([v.quad[0], v.quad[3]])).toBe(cornerSet([h.quad[1], h.quad[2]]));
    // and those are the true miter of two 100 mm bands at a right angle: the
    // convex corner outside the elbow and the concave one inside it
    expect(cornerSet([h.quad[1], h.quad[2]])).toBe(cornerSet([
      { x: 4050, y: 1950 }, { x: 3950, y: 2050 },
    ]));
    // PHASE 2E: the two bands must TILE the corner, not overlap on one
    // diagonal while leaving a bite on the other
    const cov = nodeDiscCoverage(polygons, { x: 4000, y: 2000 }, 49.5);
    expect(cov.uncovered, JSON.stringify(cov)).toBe(0);
    expect(cov.doubled, JSON.stringify(cov)).toBe(0);
    expect(Math.abs(slabThickness(h.quad) - 100)).toBeLessThan(3);
    expect(Math.abs(slabThickness(v.quad) - 100)).toBeLessThan(3);
  });

  it("slabFromMiterQuad keeps thickness along segment", () => {
    const quad = [
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000, y: 100 },
      { x: 0, y: 100 },
    ];
    const slice = slabFromMiterQuad(quad, 0.2, 0.8);
    expect(Math.abs(slabThickness(slice) - 100)).toBeLessThan(2);
  });

  it("bevel fallback keeps each wall face at acute corner", () => {
    const room = { w: 10000, h: 8000 };
    const walls = weldWallNodes([
      { id: "a", thk: 100, role: "partition", pts: [{ x: 0, y: 0 }, { x: 3000, y: 0 }] },
      { id: "b", thk: 100, role: "partition", pts: [{ x: 3000, y: 0 }, { x: 1000, y: 2500 }] },
    ]);
    const { polygons } = buildWallGeometry(walls, room);
    const pa = polygons.find((p) => p.wallId === "a");
    const pb = polygons.find((p) => p.wallId === "b");
    expect(pa && pb).toBeTruthy();
    expect(Math.abs(slabThickness(pa.quad) - 100)).toBeLessThan(5);
    expect(Math.abs(slabThickness(pb.quad) - 100)).toBeLessThan(5);
    // the two walls share the identical corner pair, and the miter limit keeps
    // both points near the node instead of letting the acute join run away
    expect(cornerSet([pb.quad[0], pb.quad[3]])).toBe(cornerSet([pa.quad[1], pa.quad[2]]));
    for (const p of [pa.quad[1], pa.quad[2]]) {
      expect(Math.hypot(p.x - 3000, p.y - 0)).toBeLessThanOrEqual(400);
    }
    const cov = nodeDiscCoverage(polygons, { x: 3000, y: 0 }, 49.5);
    expect(cov.uncovered, JSON.stringify(cov)).toBe(0);
    expect(cov.doubled, JSON.stringify(cov)).toBe(0);
  });

  it("aligns outer corners on rectangle room walls", () => {
    const room = { w: 10000, h: 8000 };
    const walls = weldWallNodes([
      { id: "t", thk: 100, role: "outer", pts: [{ x: 0, y: 0 }, { x: 10000, y: 0 }] },
      { id: "r", thk: 100, role: "outer", pts: [{ x: 10000, y: 0 }, { x: 10000, y: 8000 }] },
      { id: "b", thk: 100, role: "outer", pts: [{ x: 10000, y: 8000 }, { x: 0, y: 8000 }] },
      { id: "l", thk: 100, role: "outer", pts: [{ x: 0, y: 8000 }, { x: 0, y: 0 }] },
    ]);
    const { polygons } = buildWallGeometry(walls, room);
    const top = polygons.find((p) => p.wallId === "t");
    const right = polygons.find((p) => p.wallId === "r");
    const tr = top.quad[1];
    const rt = right.quad[0];
    expect(Math.hypot(tr.x - rt.x, tr.y - rt.y)).toBeLessThan(1.5);
  });
});
