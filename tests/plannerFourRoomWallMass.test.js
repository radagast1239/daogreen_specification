import { describe, it, expect } from "vitest";
import { weldWallNodes } from "../src/planner/wallGeometry.js";
import { buildWallGeometry } from "../src/planner/buildWallGeometry.js";
import { buildWallMassGeometry } from "../src/planner/core/walls/wallMass.js";

// Same four-room diagonal fixture, tested on the visible wall-mass side.
// (Kept in a separate file from the detectRooms tests: importing detectRooms
// together with weldWallNodes/buildWallGeometry in one module graph trips a
// pre-existing ambiguous star-export in the wall barrel.)
const W = (id, ax, ay, bx, by, thk = 100, role = "partition") => ({
  id, thk, role, kind: "new", thicknessSide: "center",
  a: { x: ax, y: ay }, b: { x: bx, y: by }, pts: [{ x: ax, y: ay }, { x: bx, y: by }],
});
function fourRoomWalls() {
  const OW = 150, PW = 100;
  return [
    W("top-l", 0, 0, 2300, 0, OW, "outer"), W("top-r", 2300, 0, 4600, 0, OW, "outer"),
    W("right-t", 4600, 0, 4600, 2400, OW, "outer"), W("right-b", 4600, 2400, 4600, 3200, OW, "outer"),
    W("bot-r", 4600, 3200, 2300, 3200, OW, "outer"), W("bot-l", 2300, 3200, 0, 3200, OW, "outer"),
    W("left-b", 0, 3200, 0, 1500, OW, "outer"), W("left-t", 0, 1500, 0, 0, OW, "outer"),
    W("cp-1", 2300, 0, 2300, 1200, PW, "partition"), W("cp-2", 2300, 1200, 2300, 2000, PW, "partition"),
    W("cp-3", 2300, 2000, 2300, 3200, PW, "partition"),
    W("diag-up", 0, 1500, 2300, 1200, PW, "partition"), W("diag-lo", 2300, 2000, 4600, 2400, PW, "partition"),
  ];
}
const room = { w: 4600, h: 3200, wallThk: 150, height: 2800 };
const massesOf = (walls) => {
  const g = buildWallGeometry(weldWallNodes(walls), room);
  return buildWallMassGeometry(g.polygons, g.expanded);
};

function internalSegmentCount(mass) {
  const inside = (pt) => mass.fillPolygons.some((poly) => pip(pt, poly));
  let n = 0;
  for (const e of mass.boundaryEdges) {
    const mid = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
    const len = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) || 1;
    const nx = -(e.b.y - e.a.y) / len, ny = (e.b.x - e.a.x) / len, d = 4;
    if (inside({ x: mid.x + nx * d, y: mid.y + ny * d }) && inside({ x: mid.x - nx * d, y: mid.y - ny * d })) n++;
  }
  return n;
}
function pip(pt, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi)) c = !c;
  }
  return c;
}
const edgeKey = (e) => {
  const a = `${Math.round(e.a.x)},${Math.round(e.a.y)}`, b = `${Math.round(e.b.x)},${Math.round(e.b.y)}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
};

describe("four-room diagonal split — wall mass", () => {
  it("9. all walls form exactly one connected mass component", () => {
    expect(massesOf(fourRoomWalls())).toHaveLength(1);
  });
  it("10. the mass has exactly 4 holes (the 4 rooms)", () => {
    expect(massesOf(fourRoomWalls())[0].holeCount).toBe(4);
  });
  it("11. no internal visible seam inside the mass", () => {
    expect(internalSegmentCount(massesOf(fourRoomWalls())[0])).toBe(0);
  });
  it("12/22. no self-intersections in the mass boundary", () => {
    expect(massesOf(fourRoomWalls())[0].selfIntersections).toBe(0);
  });
  it("13. no duplicate visible outline segment", () => {
    const edges = massesOf(fourRoomWalls())[0].boundaryEdges;
    const keys = edges.map(edgeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("8. central node produces no micro-hole (holeCount stays 4, not 5+)", () => {
    expect(massesOf(fourRoomWalls())[0].holeCount).toBeLessThanOrEqual(4);
  });
  it("20. reversed endpoints yield an equivalent mass boundary", () => {
    const rev = fourRoomWalls().map((w) => W(w.id, w.b.x, w.b.y, w.a.x, w.a.y, w.thk, w.role));
    const a = new Set(massesOf(fourRoomWalls())[0].boundaryEdges.map(edgeKey));
    const b = new Set(massesOf(rev)[0].boundaryEdges.map(edgeKey));
    expect(b).toEqual(a);
  });
  it("24. builds well within a time budget", () => {
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) massesOf(fourRoomWalls());
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
