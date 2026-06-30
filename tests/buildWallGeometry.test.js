import { describe, expect, it } from "vitest";
import { weldWallNodes } from "../src/planner/wallGeometry.js";
import { buildWallGeometry, slabFromMiterQuad } from "../src/planner/buildWallGeometry.js";

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
    const hCorner = h.quad[1];
    const vCorner = v.quad[0];
    expect(Math.hypot(hCorner.x - vCorner.x, hCorner.y - vCorner.y)).toBeLessThan(1.5);
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
    const outerAEnd = pa.quad[1];
    const outerBStart = pb.quad[0];
    expect(Math.hypot(outerAEnd.x - outerBStart.x, outerAEnd.y - outerBStart.y)).toBeLessThan(120);
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
