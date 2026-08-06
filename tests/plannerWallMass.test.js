import { describe, it, expect } from "vitest";
import { weldWallNodes } from "../src/planner/wallGeometry.js";
import { buildWallGeometry } from "../src/planner/buildWallGeometry.js";
import {
  buildWallMassGeometry, buildWallConnectedComponents,
  extractWallMassBoundaryEdges, countMassHoles,
} from "../src/planner/core/walls/wallMass.js";

const EPS = 1;
const room = { w: 20000, h: 20000, wallThk: 100, height: 3000 };
const W = (id, ax, ay, bx, by, thk = 100, role = "partition") => ({
  id, thk, role, kind: "new", thicknessSide: "center",
  a: { x: ax, y: ay }, b: { x: bx, y: by }, pts: [{ x: ax, y: ay }, { x: bx, y: by }],
});
const massOf = (walls) => {
  const g = buildWallGeometry(weldWallNodes(walls), room);
  return { geom: g, masses: buildWallMassGeometry(g.polygons, g.expandedWalls || walls) };
};

// undirected edge multiset key for "no duplicate visible outline" checks
const edgeKey = (e) => {
  const a = `${Math.round(e.a.x)},${Math.round(e.a.y)}`;
  const b = `${Math.round(e.b.x)},${Math.round(e.b.y)}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
};

// count boundary edges that lie strictly inside the union of the fill
// polygons (an "internal visible segment") — must be zero.
function internalSegmentCount(mass) {
  const inside = (pt) => mass.fillPolygons.some((poly) => pointIn(pt, poly));
  let n = 0;
  for (const e of mass.boundaryEdges) {
    const mid = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
    const len = Math.hypot(e.b.x - e.a.x, e.b.y - e.a.y) || 1;
    const nx = -(e.b.y - e.a.y) / len, ny = (e.b.x - e.a.x) / len;
    const d = 4;
    if (inside({ x: mid.x + nx * d, y: mid.y + ny * d }) && inside({ x: mid.x - nx * d, y: mid.y - ny * d })) n += 1;
  }
  return n;
}
function pointIn(pt, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi)) c = !c;
  }
  return c;
}

const L = [W("h", 3000, 5000, 7000, 5000), W("v", 7000, 5000, 7000, 8500)];
const TEE = [W("hl", 3000, 5000, 6000, 5000, 200, "outer"), W("hr", 6000, 5000, 9000, 5000, 200, "outer"), W("br", 6000, 5000, 6000, 8500, 150, "partition")];
const THREE = [W("a", 6000, 6000, 3200, 6000), W("b", 6000, 6000, 8600, 4600), W("c", 6000, 6000, 6600, 9000)];
const MIXED = [W("m1", 6000, 6000, 3000, 6000, 100), W("m2", 6000, 6000, 8600, 4600, 150), W("m3", 6000, 6000, 6600, 9000, 250)];
const CROSS = [W("left", 6000, 6000, 3000, 6000, 120), W("right", 6000, 6000, 9000, 6000, 120), W("up", 6000, 6000, 6000, 3000, 120), W("down", 6000, 6000, 6000, 9000, 120)];
const DISCONNECTED = [W("a", 0, 0, 1000, 0), W("b", 5000, 5000, 6000, 5000)];
const twoRoom = () => [
  W("t1", 2000, 2000, 5000, 2000, 200, "outer"), W("t2", 5000, 2000, 8000, 2000, 200, "outer"),
  W("r", 8000, 2000, 8000, 7000, 200, "outer"), W("b2", 8000, 7000, 5000, 7000, 200, "outer"),
  W("b1", 5000, 7000, 2000, 7000, 200, "outer"), W("l", 2000, 7000, 2000, 2000, 200, "outer"),
  W("mid", 5000, 2000, 5000, 7000, 150, "partition"),
];
const threeRoom = () => [
  W("t1", 0, 0, 3000, 0, 200, "outer"), W("t2", 3000, 0, 6000, 0, 200, "outer"), W("t3", 6000, 0, 9000, 0, 200, "outer"),
  W("r", 9000, 0, 9000, 4000, 200, "outer"), W("b3", 9000, 4000, 6000, 4000, 200, "outer"),
  W("b2", 6000, 4000, 3000, 4000, 200, "outer"), W("b1", 3000, 4000, 0, 4000, 200, "outer"), W("l", 0, 4000, 0, 0, 200, "outer"),
  W("m1", 3000, 0, 3000, 4000, 150, "partition"), W("m2", 6000, 0, 6000, 4000, 150, "partition"),
];

describe("unified wall mass — connectivity & components", () => {
  it("1. connected L walls form one mass component", () => {
    expect(massOf(L).masses).toHaveLength(1);
  });
  it("10. disconnected walls remain separate components", () => {
    const g = buildWallGeometry(weldWallNodes(DISCONNECTED), room);
    expect(buildWallConnectedComponents(g.polygons, g.expandedWalls).length).toBe(2);
    expect(buildWallMassGeometry(g.polygons, g.expandedWalls)).toHaveLength(2);
  });
  it("16. deterministic under wall order shuffle", () => {
    const a = massOf(THREE).masses[0];
    const shuffled = [THREE[2], THREE[0], THREE[1]];
    const b = massOf(shuffled).masses[0];
    expect(new Set(a.boundaryEdges.map(edgeKey))).toEqual(new Set(b.boundaryEdges.map(edgeKey)));
  });
  it("17. reversed a/b endpoints equivalent boundary", () => {
    const rev = THREE.map((w) => W(w.id, w.b.x, w.b.y, w.a.x, w.a.y, w.thk, w.role));
    const a = new Set(massOf(THREE).masses[0].boundaryEdges.map(edgeKey));
    const b = new Set(massOf(rev).masses[0].boundaryEdges.map(edgeKey));
    expect(b).toEqual(a);
  });
});

describe("unified wall mass — no internal seams", () => {
  it.each([["L", L], ["T-junction", TEE], ["3-way", THREE], ["mixed", MIXED], ["cross", CROSS]])(
    "2/3/4/6/7/9. %s node has no internal visible boundary segment", (_n, walls) => {
      const { masses } = massOf(walls);
      expect(masses).toHaveLength(1);
      expect(internalSegmentCount(masses[0])).toBe(0);
    },
  );
  it("5. T-junction host outer face is one continuous edge (branch cap absent)", () => {
    const { masses } = massOf(TEE);
    // the host outer face runs along y = 5000 - 100 = 4900 across the full span
    const onHostOuter = masses[0].boundaryEdges.filter(
      (e) => Math.abs(e.a.y - 4900) < EPS && Math.abs(e.b.y - 4900) < EPS,
    );
    const span = onHostOuter.reduce((s, e) => s + Math.abs(e.b.x - e.a.x), 0);
    expect(span).toBeGreaterThan(5900); // ~full 3000..9000 continuous
  });
  it("13/21. no duplicate visible outline segment", () => {
    for (const walls of [L, TEE, THREE, MIXED, CROSS]) {
      const edges = massOf(walls).masses[0].boundaryEdges;
      const keys = edges.map(edgeKey);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe("unified wall mass — validity", () => {
  it("8/15. mixed thickness union has no self-intersection", () => {
    expect(massOf(MIXED).masses[0].selfIntersections).toBe(0);
  });
  it("11. wall polygons (fill) all have positive area", () => {
    const { masses } = massOf(MIXED);
    for (const poly of masses[0].fillPolygons) {
      let a = 0;
      for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p.x * q.y - q.x * p.y; }
      expect(Math.abs(a) / 2).toBeGreaterThan(0);
    }
  });
  it("14. boundary edges enclose (union area > 0, one fill path per mass)", () => {
    const { masses } = massOf(CROSS);
    expect(masses[0].fillPath.length).toBeGreaterThan(0);
    expect(masses[0].boundaryEdges.length).toBeGreaterThanOrEqual(4);
  });
  it("safe on corrupt / zero-length walls", () => {
    const bad = [W("z", 100, 100, 100, 100), W("ok", 0, 0, 2000, 0)];
    expect(() => massOf(bad)).not.toThrow();
  });
});

describe("unified wall mass — room holes", () => {
  it("11r. one rectangular room produces one hole", () => {
    const rect = [
      W("t", 0, 0, 4000, 0, 200, "outer"), W("r", 4000, 0, 4000, 3000, 200, "outer"),
      W("b", 4000, 3000, 0, 3000, 200, "outer"), W("l", 0, 3000, 0, 0, 200, "outer"),
    ];
    expect(massOf(rect).masses[0].holeCount).toBe(1);
  });
  it("12. two-room fixture produces two holes", () => {
    expect(massOf(twoRoom()).masses[0].holeCount).toBe(2);
  });
  it("13. three-room fixture produces three holes", () => {
    expect(massOf(threeRoom()).masses[0].holeCount).toBe(3);
  });
  it("open Y (no enclosure) produces zero holes", () => {
    expect(massOf(THREE).masses[0].holeCount).toBe(0);
  });
});
