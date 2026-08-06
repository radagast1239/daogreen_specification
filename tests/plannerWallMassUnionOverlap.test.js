/**
 * Wall mass must be a real union, not a paint-order illusion.
 *
 * Reported defect: drawing closed rectangles inside a room made one hatched band
 * appear to run UNDER another, with a cross of stacked polygons and doubled
 * hatch at the meeting point. Root cause: connected components were built from
 * shared centerline ENDPOINTS only, so two walls that meet purely geometrically
 * (crossing mid-span with no split node, or two collinear walls overlapping
 * along their length) stayed separate masses — each filled and stroked
 * independently, so which one looked "on top" was decided by paint order. And
 * parity edge-cancellation only removes COLLINEAR coincident edges, so the
 * crossing wall's side edges survived straight through the other wall's body.
 *
 * Invariants here: bodies that share area are ONE component, and no surviving
 * boundary edge lies buried inside the mass.
 */
import { describe, it, expect } from "vitest";
import {
  buildWallConnectedComponents,
  buildWallMassGeometry,
  extractWallMassBoundaryEdges,
} from "../src/planner/core/walls/wallMass.js";
import { buildWallGeometry } from "../src/planner/buildWallGeometry.js";
import { weldWallNodes } from "../src/planner/core/walls/wallOps.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";

const W = (id, ax, ay, bx, by, thk = 100, role = "partition") => ({
  id, thk, role, kind: "new", thicknessSide: "center", height: 3000,
  a: { x: ax, y: ay }, b: { x: bx, y: by },
  pts: [{ x: ax, y: ay }, { x: bx, y: by }],
});

const planOf = (walls) => ({
  room: { w: 12000, h: 9000, wallThk: 100, height: 3000 },
  nodes: {}, walls, items: [], lines: [], zones: [], rooms: [], labels: [],
  dimensions: [], structurals: [], validationWarnings: [],
});

function massesOf(plan) {
  const walls = weldWallNodes(resolvePlanWalls(plan));
  const geom = buildWallGeometry(walls, plan.room);
  return {
    masses: buildWallMassGeometry(geom.polygons, geom.expandedWalls || walls),
    geom,
    walls,
  };
}

function pointInLoop(pt, loop) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const xi = loop[i].x, yi = loop[i].y, xj = loop[j].x, yj = loop[j].y;
    if (((yi > pt.y) !== (yj > pt.y))
      && (pt.x < ((xj - xi) * (pt.y - yi)) / ((yj - yi) || 1e-9) + xi)) inside = !inside;
  }
  return inside;
}
function distToSeg(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const L2 = vx * vx + vy * vy || 1;
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
}
function strictlyInside(pt, loop, tol = 0.5) {
  if (!pointInLoop(pt, loop)) return false;
  for (let i = 0; i < loop.length; i++) {
    if (distToSeg(pt, loop[i], loop[(i + 1) % loop.length]) <= tol) return false;
  }
  return true;
}

/** Boundary edges whose midpoint is buried strictly inside any wall body. */
function buriedEdgeCount(mass) {
  let n = 0;
  for (const e of mass.boundaryEdges) {
    const mid = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
    if (mass.fillPolygons.some((poly) => strictlyInside(mid, poly))) n += 1;
  }
  return n;
}

/** A boundary edge sitting inside the body with mass on BOTH sides = end cap. */
function internalEndCapCount(mass) {
  let n = 0;
  const inAny = (p) => mass.fillPolygons.some((poly) => pointInLoop(p, poly));
  for (const e of mass.boundaryEdges) {
    const mid = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
    const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
    const L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;
    if (inAny({ x: mid.x + nx * 3, y: mid.y + ny * 3 })
      && inAny({ x: mid.x - nx * 3, y: mid.y - ny * 3 })) n += 1;
  }
  return n;
}

function duplicateEdgeCount(mass) {
  const es = mass.boundaryEdges;
  let dup = 0;
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  for (let i = 0; i < es.length; i++) {
    for (let j = i + 1; j < es.length; j++) {
      if ((d(es[i].a, es[j].a) < 1 && d(es[i].b, es[j].b) < 1)
        || (d(es[i].a, es[j].b) < 1 && d(es[i].b, es[j].a) < 1)) dup += 1;
    }
  }
  return dup;
}

describe("wall mass union — geometric overlap, not paint order", () => {
  it("1. two walls crossing mid-span with NO shared node form ONE mass", () => {
    const plan = planOf([
      W("h1", 1000, 3000, 7000, 3000),
      W("v1", 4000, 1000, 4000, 5000),
    ]);
    const { masses } = massesOf(plan);
    expect(masses).toHaveLength(1);
  });

  it("2. a crossing leaves no boundary edge buried inside the mass", () => {
    const plan = planOf([
      W("h1", 1000, 3000, 7000, 3000),
      W("v1", 4000, 1000, 4000, 5000),
    ]);
    const [mass] = massesOf(plan).masses;
    expect(buriedEdgeCount(mass)).toBe(0);
    expect(internalEndCapCount(mass)).toBe(0);
    expect(duplicateEdgeCount(mass)).toBe(0);
  });

  it("3. no boundary edge crosses the centre of the crossing", () => {
    // the defect looked like a line running through the other wall's body
    const plan = planOf([
      W("h1", 1000, 3000, 7000, 3000),
      W("v1", 4000, 1000, 4000, 5000),
    ]);
    const [mass] = massesOf(plan).masses;
    const centre = { x: 4000, y: 3000 };
    for (const e of mass.boundaryEdges) {
      expect(distToSeg(centre, e.a, e.b)).toBeGreaterThan(49);
    }
  });

  it("4. collinear overlapping walls become one mass without doubled area", () => {
    const plan = planOf([
      W("a1", 1000, 2000, 5000, 2000),
      W("a2", 3000, 2000, 7000, 2000),
    ]);
    const { masses } = massesOf(plan);
    expect(masses).toHaveLength(1);
    const [mass] = masses;
    expect(mass.selfIntersections).toBe(0);
    expect(buriedEdgeCount(mass)).toBe(0);
  });

  it("5. genuinely separate walls stay separate components", () => {
    const plan = planOf([
      W("a", 0, 0, 2000, 0),
      W("b", 0, 4000, 2000, 4000),
    ]);
    expect(massesOf(plan).masses).toHaveLength(2);
  });

  it("6. free-standing closed rectangles inside a room do not merge", () => {
    const plan = planOf([
      // outer
      W("o1", 0, 0, 12000, 0, 100, "outer"), W("o2", 12000, 0, 12000, 9000, 100, "outer"),
      W("o3", 12000, 9000, 0, 9000, 100, "outer"), W("o4", 0, 9000, 0, 0, 100, "outer"),
      // two free-standing inner rectangles, far apart
      W("a1", 1000, 1000, 4000, 1000), W("a2", 4000, 1000, 4000, 3500),
      W("a3", 4000, 3500, 1000, 3500), W("a4", 1000, 3500, 1000, 1000),
      W("b1", 7000, 5000, 10000, 5000), W("b2", 10000, 5000, 10000, 7500),
      W("b3", 10000, 7500, 7000, 7500), W("b4", 7000, 7500, 7000, 5000),
    ]);
    const { masses } = massesOf(plan);
    expect(masses).toHaveLength(3); // outer ring + 2 independent rectangles
    for (const m of masses) {
      expect(buriedEdgeCount(m)).toBe(0);
      expect(internalEndCapCount(m)).toBe(0);
    }
  });

  it("7. touching rectangles (shared corner node) merge into one mass", () => {
    const plan = planOf([
      W("a1", 1000, 1000, 4000, 1000), W("a2", 4000, 1000, 4000, 3500),
      W("a3", 4000, 3500, 1000, 3500), W("a4", 1000, 3500, 1000, 1000),
      // second rectangle starting exactly at the first one's corner
      W("b1", 4000, 3500, 7000, 3500), W("b2", 7000, 3500, 7000, 6000),
      W("b3", 7000, 6000, 4000, 6000), W("b4", 4000, 6000, 4000, 3500),
    ]);
    const { masses } = massesOf(plan);
    expect(masses).toHaveLength(1);
    expect(buriedEdgeCount(masses[0])).toBe(0);
  });

  it("8. component grouping is symmetric and order-independent", () => {
    const a = [W("h1", 1000, 3000, 7000, 3000), W("v1", 4000, 1000, 4000, 5000)];
    const fwd = massesOf(planOf(a)).masses.length;
    const rev = massesOf(planOf([...a].reverse())).masses.length;
    expect(fwd).toBe(1);
    expect(rev).toBe(1);
  });

  it("9. clipping is a no-op for non-overlapping quads (existing joins untouched)", () => {
    // straight L: quads share their cap edge exactly, nothing is buried
    const quads = [
      [{ x: 0, y: -50 }, { x: 2000, y: -50 }, { x: 2000, y: 50 }, { x: 0, y: 50 }],
      [{ x: 1950, y: 50 }, { x: 2050, y: 50 }, { x: 2050, y: 2000 }, { x: 1950, y: 2000 }],
    ];
    const edges = extractWallMassBoundaryEdges(quads, []);
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) {
      const mid = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
      expect(quads.some((q) => strictlyInside(mid, q))).toBe(false);
    }
  });

  it("10. near-parallel walls closer than their thickness merge, not stack", () => {
    // The reported trigger: internal walls drawn close together. Two 100mm walls
    // 60mm apart overlap as bodies while sharing no node — previously two masses,
    // so the overlap was hatched twice and one band looked like it ran under the
    // other. Sharing area means one mass.
    const plan = planOf([
      W("p1", 1000, 2000, 6000, 2000),
      W("p2", 1000, 2060, 6000, 2060),
    ]);
    const { masses } = massesOf(plan);
    expect(masses).toHaveLength(1);
    const [mass] = masses;
    expect(buriedEdgeCount(mass)).toBe(0);
    // no boundary edge may run through the shared body
    for (const e of mass.boundaryEdges) {
      const mid = { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 };
      const horizontalRun = Math.abs(e.b.x - e.a.x) > Math.abs(e.b.y - e.a.y);
      if (horizontalRun && mid.x > 1500 && mid.x < 5500) {
        // only the two true outer faces may survive across the span
        expect([1950, 2110]).toContain(Math.round(mid.y));
      }
    }
  });

  it("11. endpoint-connected walls are still one component (no regression)", () => {
    const plan = planOf([
      W("a", 0, 0, 3000, 0),
      W("b", 3000, 0, 3000, 3000),
    ]);
    const comps = buildWallConnectedComponents(
      massesOf(plan).geom.polygons,
      massesOf(plan).walls,
    );
    expect(comps).toHaveLength(1);
  });
});
