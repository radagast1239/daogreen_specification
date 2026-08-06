import { describe, expect, it } from "vitest";
import { weldWallNodes } from "../src/planner/wallGeometry.js";
import { buildWallGeometry } from "../src/planner/buildWallGeometry.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";

const EPS_AREA = 500; // mm^2 sampling tolerance for overlap/gap probes
const room = { w: 20000, h: 20000, wallThk: 100, height: 3000 };

function build(plan) {
  const walls = weldWallNodes(resolvePlanWalls(plan));
  return buildWallGeometry(walls, plan.room || room);
}

function shoelace(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}
function polyArea(poly) { return Math.abs(shoelace(poly)); }

function segmentsIntersect(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4;
}
// True if a simple quad's two diagonals-as-edges cross (i.e. it's authored
// as a bowtie / self-intersecting): check non-adjacent edge pairs.
function selfIntersects(poly) {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      const c = poly[j], d = poly[(j + 1) % n];
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > p.y) !== (yj > p.y)) && (p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function bounds(poly) {
  const xs = poly.map(p => p.x), ys = poly.map(p => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}
function pairwiseOverlapArea(pa, pb, samples = 50) {
  const ba = bounds(pa), bb = bounds(pb);
  const x0 = Math.max(ba.minX, bb.minX), x1 = Math.min(ba.maxX, bb.maxX);
  const y0 = Math.max(ba.minY, bb.minY), y1 = Math.min(ba.maxY, bb.maxY);
  if (x1 <= x0 || y1 <= y0) return 0;
  let hit = 0;
  for (let i = 0; i < samples; i++) for (let j = 0; j < samples; j++) {
    const p = { x: x0 + (x1 - x0) * (i + 0.5) / samples, y: y0 + (y1 - y0) * (j + 0.5) / samples };
    // shrink each polygon slightly toward its centroid so that merely
    // TOUCHING along a shared edge does not count as overlap
    if (pointInPoly(p, shrink(pa, 1.5)) && pointInPoly(p, shrink(pb, 1.5))) hit++;
  }
  return hit * ((x1 - x0) / samples) * ((y1 - y0) / samples);
}
function shrink(poly, mm) {
  const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
  return poly.map(p => {
    const dx = p.x - cx, dy = p.y - cy, len = Math.hypot(dx, dy) || 1;
    return { x: p.x - (dx / len) * mm, y: p.y - (dy / len) * mm };
  });
}
function maxPairwiseOverlap(polys) {
  let max = 0;
  for (let i = 0; i < polys.length; i++) for (let j = i + 1; j < polys.length; j++) {
    max = Math.max(max, pairwiseOverlapArea(polys[i].quad, polys[j].quad));
  }
  return max;
}
// A quad is [outerA, outerB, innerB, innerA]; the node-end (join) corners
// are quad[0] (outerA) and quad[3] (innerA) when the wall's `a` endpoint is
// at the node. Rather than assume which end, measure the DISTANCE of each
// quad corner from the node and take only the two nearest (those are the
// node-side miter corners; the other two are the far, un-joined end).
function longestMiterFromNode(polys, node) {
  let max = 0;
  for (const p of polys) {
    const dists = p.quad.map((pt) => Math.hypot(pt.x - node.x, pt.y - node.y)).sort((a, b) => a - b);
    max = Math.max(max, dists[1]); // second-nearest = the farther of the two node-side corners
  }
  return max;
}

// ---- Fixtures ----------------------------------------------------------

// Fixture A — 3-way node: a horizontal wall, a wall going up-right (acute
// sector with the horizontal), and one going down (obtuse sectors). Equal
// thickness. Node at origin.
function fixtureA(reversed = false) {
  const mk = (id, ax, ay, bx, by, thk = 100) => {
    const [a, b] = reversed ? [{ x: bx, y: by }, { x: ax, y: ay }] : [{ x: ax, y: ay }, { x: bx, y: by }];
    return { id, thk, role: "partition", kind: "new", thicknessSide: "center", pts: [a, b], a, b };
  };
  return {
    walls: [
      mk("w1", 0, 0, -3000, 0),
      mk("w2", 0, 0, 2600, -1500),
      mk("w3", 0, 0, 500, 3000),
    ],
    room,
  };
}

// Fixture B — 3-way mixed thickness 100/150/250, diagonal directions.
function fixtureB() {
  const mk = (id, ax, ay, bx, by, thk) => ({ id, thk, role: "partition", kind: "new", thicknessSide: "center", pts: [{ x: ax, y: ay }, { x: bx, y: by }], a: { x: ax, y: ay }, b: { x: bx, y: by } });
  return {
    walls: [
      mk("w1", 0, 0, -2600, -1500, 100),
      mk("w2", 0, 0, 2600, -1500, 150),
      mk("w3", 0, 0, 0, 3000, 250),
    ],
    room,
  };
}

// Fixture C — 4-way cross.
function fixtureC() {
  const mk = (id, ax, ay, bx, by, thk = 120) => ({ id, thk, role: "partition", kind: "new", thicknessSide: "center", pts: [{ x: ax, y: ay }, { x: bx, y: by }], a: { x: ax, y: ay }, b: { x: bx, y: by } });
  return {
    walls: [
      mk("left", 0, 0, -3000, 0),
      mk("right", 0, 0, 3000, 0),
      mk("up", 0, 0, 0, -3000),
      mk("down", 0, 0, 0, 3000),
    ],
    room,
  };
}

// Fixture E — existing T-junction (regression).
function fixtureE() {
  return {
    nodes: {
      m1: { x: 0, y: 0 }, m2: { x: 4000, y: 0 }, m3: { x: 4000, y: 3000 }, m4: { x: 0, y: 3000 },
      m5: { x: 2000, y: 0 }, m6: { x: 2000, y: 3000 },
    },
    walls: [
      { id: "tw-top-l", a: "m1", b: "m5", thk: 200, role: "outer", kind: "new", thicknessSide: "center", pts: [{ x: 0, y: 0 }, { x: 2000, y: 0 }] },
      { id: "tw-top-r", a: "m5", b: "m2", thk: 200, role: "outer", kind: "new", thicknessSide: "center", pts: [{ x: 2000, y: 0 }, { x: 4000, y: 0 }] },
      { id: "tw-right", a: "m2", b: "m3", thk: 200, role: "outer", kind: "new", thicknessSide: "center", pts: [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }] },
      { id: "tw-bottom-r", a: "m3", b: "m6", thk: 200, role: "outer", kind: "new", thicknessSide: "center", pts: [{ x: 4000, y: 3000 }, { x: 2000, y: 3000 }] },
      { id: "tw-bottom-l", a: "m6", b: "m4", thk: 200, role: "outer", kind: "new", thicknessSide: "center", pts: [{ x: 2000, y: 3000 }, { x: 0, y: 3000 }] },
      { id: "tw-left", a: "m4", b: "m1", thk: 200, role: "outer", kind: "new", thicknessSide: "center", pts: [{ x: 0, y: 3000 }, { x: 0, y: 0 }] },
      { id: "tw-mid", a: "m5", b: "m6", thk: 150, role: "partition", kind: "new", thicknessSide: "center", pts: [{ x: 2000, y: 0 }, { x: 2000, y: 3000 }] },
    ],
    room: { w: 4000, h: 3000, wallThk: 200, height: 3000 },
  };
}

// ---- Tests -------------------------------------------------------------

describe("multiway join — 3-way equal thickness (fixture A)", () => {
  it("3. no pairwise polygon overlap beyond epsilon", () => {
    const { polygons } = build(fixtureA());
    expect(maxPairwiseOverlap(polygons)).toBeLessThan(EPS_AREA);
  });
  it("4/11. every wall polygon has positive, non-degenerate area", () => {
    const { polygons } = build(fixtureA());
    expect(polygons).toHaveLength(3);
    for (const p of polygons) expect(polyArea(p.quad)).toBeGreaterThan(1000);
  });
  it("no polygon self-intersects", () => {
    const { polygons } = build(fixtureA());
    for (const p of polygons) expect(selfIntersects(p.quad)).toBe(false);
  });
  it("12. no giant miter spike (all corners within a thickness-relative bound of the node)", () => {
    const { polygons } = build(fixtureA());
    // max thickness 100 -> corners should stay within a few multiples
    expect(longestMiterFromNode(polygons, { x: 0, y: 0 })).toBeLessThan(100 * 6);
  });
  it("2/20. reversed wall endpoints produce the same polygon set (order-invariant)", () => {
    const fwd = build(fixtureA(false)).polygons;
    const rev = build(fixtureA(true)).polygons;
    const areaOf = (polys) => polys.map(p => Math.round(polyArea(p.quad))).sort((a, b) => a - b);
    expect(areaOf(rev)).toEqual(areaOf(fwd));
  });
  it("1/20. wall array order does not change the result", () => {
    const plan = fixtureA();
    const shuffled = { ...plan, walls: [plan.walls[2], plan.walls[0], plan.walls[1]] };
    const areaOf = (polys) => polys.map(p => Math.round(polyArea(p.quad))).sort((a, b) => a - b);
    expect(areaOf(build(shuffled).polygons)).toEqual(areaOf(build(plan).polygons));
  });
});

describe("multiway join — mixed thickness 100/150/250 (fixture B)", () => {
  it("7. no pairwise overlap beyond epsilon", () => {
    expect(maxPairwiseOverlap(build(fixtureB()).polygons)).toBeLessThan(EPS_AREA);
  });
  it("8. no polygon self-intersects, all positive area", () => {
    const { polygons } = build(fixtureB());
    for (const p of polygons) {
      expect(selfIntersects(p.quad)).toBe(false);
      expect(polyArea(p.quad)).toBeGreaterThan(1000);
    }
  });
  it("each wall keeps its own thickness at the far (non-node) end", () => {
    const { polygons } = build(fixtureB());
    const expected = { w1: 100, w2: 150, w3: 250 };
    for (const p of polygons) {
      // far edge = quad[1]..quad[2] (outerB..innerB)
      const t = Math.hypot(p.quad[1].x - p.quad[2].x, p.quad[1].y - p.quad[2].y);
      expect(Math.abs(t - expected[p.wallId])).toBeLessThan(3);
    }
  });
});

describe("multiway join — 4-way cross (fixture C)", () => {
  it("9/10/11. four valid, non-overlapping, positive-area polygons", () => {
    const { polygons } = build(fixtureC());
    expect(polygons).toHaveLength(4);
    for (const p of polygons) {
      expect(polyArea(p.quad)).toBeGreaterThan(1000);
      expect(selfIntersects(p.quad)).toBe(false);
    }
    expect(maxPairwiseOverlap(polygons)).toBeLessThan(EPS_AREA);
  });
  it("13. contour keys are unique (no duplicate outline segment)", () => {
    const { contours } = build(fixtureC());
    const keys = contours.map(c => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("multiway join — T-junction regression preserved (fixture E)", () => {
  it("14. branch still caps at the host inner faces (y in [100, 2900]), host outer continuous", () => {
    const { polygons } = build(fixtureE());
    const mid = polygons.find(p => p.wallId === "tw-mid");
    const ys = mid.quad.map(p => p.y);
    expect(Math.min(...ys)).toBeCloseTo(100, 0);
    expect(Math.max(...ys)).toBeCloseTo(2900, 0);
    // host outer corners meet at the junction x (continuous outer face)
    const left = polygons.find(p => p.wallId === "tw-top-l");
    const right = polygons.find(p => p.wallId === "tw-top-r");
    expect(Math.hypot(left.quad[1].x - right.quad[0].x, left.quad[1].y - right.quad[0].y)).toBeLessThan(3);
  });
  it("T-junction has no branch/host polygon overlap beyond epsilon", () => {
    expect(maxPairwiseOverlap(build(fixtureE()).polygons)).toBeLessThan(EPS_AREA);
  });
});

describe("multiway join — robustness", () => {
  it("21. zero-length / corrupt walls are handled without throwing and skipped", () => {
    const plan = {
      walls: [
        { id: "ok", thk: 100, role: "partition", pts: [{ x: 0, y: 0 }, { x: 1000, y: 0 }], a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } },
        { id: "zero", thk: 100, role: "partition", pts: [{ x: 0, y: 0 }, { x: 0, y: 0 }], a: { x: 0, y: 0 }, b: { x: 0, y: 0 } },
        { id: "nan", thk: 100, role: "partition", pts: [{ x: NaN, y: 0 }, { x: 1000, y: 0 }], a: { x: NaN, y: 0 }, b: { x: 1000, y: 0 } },
      ],
      room,
    };
    expect(() => build(plan)).not.toThrow();
    const { polygons } = build(plan);
    for (const p of polygons) for (const pt of p.quad) {
      expect(Number.isFinite(pt.x)).toBe(true);
      expect(Number.isFinite(pt.y)).toBe(true);
    }
  });
  it("22. 500-node grid of walls builds within a reasonable time budget", () => {
    const walls = [];
    let id = 0;
    for (let gx = 0; gx < 22; gx++) {
      for (let gy = 0; gy < 22; gy++) {
        const x = gx * 1000, y = gy * 1000;
        if (gx < 21) walls.push({ id: `h${id++}`, thk: 100, role: "partition", pts: [{ x, y }, { x: x + 1000, y }], a: { x, y }, b: { x: x + 1000, y } });
        if (gy < 21) walls.push({ id: `v${id++}`, thk: 100, role: "partition", pts: [{ x, y }, { x, y: y + 1000 }], a: { x, y }, b: { x, y: y + 1000 } });
      }
    }
    expect(walls.length).toBeGreaterThan(800);
    const t0 = Date.now();
    const { polygons } = build({ walls, room: { w: 22000, h: 22000, wallThk: 100, height: 3000 } });
    const elapsed = Date.now() - t0;
    expect(polygons.length).toBe(walls.length);
    // Generous ceiling: this asserts "no accidental quadratic blowup", not a
    // tight perf target — a shared CI box under full-suite load is slow, so
    // the bound is well above the ~1.5s isolated run.
    expect(elapsed).toBeLessThan(12000);
  });
});
