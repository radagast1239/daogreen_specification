/**
 * PHASE 2E — two-arm corner joins (L corners).
 *
 * The defect these lock out: at a corner the two bands were mitred across the
 * WRONG DIAGONAL, so the corner square was half empty (the "clipped corner")
 * and half covered twice (the "doubled hatch" / bulging corner). It happened
 * whenever the two arms' outer/inner labels — which buildWallGeometry takes
 * from wallSegmentOffsetSide, i.e. relative to the ROOM CENTRE — landed on
 * opposite geometric sides, because the old face pairing broke the resulting
 * exact tie arbitrarily. On a 6000x4000 rectangle at the origin inside a
 * 30000x20000 room that is two of the four corners.
 *
 * Every fixture here therefore uses a room the walls do NOT enclose, which is
 * the configuration that exposes it. Drives the shipped buildWallGeometry.
 */
import { describe, it, expect } from "vitest";
import { buildWallGeometry } from "../src/planner/buildWallGeometry.js";
import {
  assertValidGeometry, assertConsistentWinding, assertNoSpike,
  cornerSquareCoverage, nodeDiscCoverage, geometryFingerprint, shapeFingerprint,
  joinPointsAt, perpWidth, pointSet, polygonArea, allFinite,
  P, dist,
} from "./helpers/wallPolygonAssertions.js";

const BASE = { role: "partition", kind: "new", thicknessSide: "center", height: 3000, material: "" };
const wall = (id, pts, thk = 100) => ({ ...BASE, id, thk, pts });
// deliberately off-centre: the walls never enclose (15000, 10000)
const room = { w: 30000, h: 20000, wallThk: 100, height: 3000 };
const geomOf = (walls) => buildWallGeometry(walls, room);
const polyOf = (walls, id) => geomOf(walls).polygons.find((p) => p.wallId === id);

/** Two walls meeting at `node`; each keeps its own thickness. */
const corner = (far1, node, far2, thk1 = 100, thk2 = 100) => [
  wall("a", [far1, node], thk1),
  wall("b", [node, far2], thk2),
];

/** The two corner points a wall contributes AT `node` (whichever end that is). */
function joinAt(walls, id, node) {
  const w = walls.find((x) => x.id === id);
  const poly = polyOf(walls, id);
  expect(poly, `${id} produced no polygon`).toBeTruthy();
  const atStart = dist(w.pts[0], node) < dist(w.pts[w.pts.length - 1], node);
  return joinPointsAt(poly.quad, atStart);
}
const asSet = (pts, digits = 1) =>
  pts.map((q) => `${q.x.toFixed(digits)},${q.y.toFixed(digits)}`).sort().join(" ");

function rectangle(ox = 0, oy = 0, w = 6000, h = 4000, thk = 100) {
  return [
    wall("t", [P(ox, oy), P(ox + w, oy)], thk),
    wall("r", [P(ox + w, oy), P(ox + w, oy + h)], thk),
    wall("b", [P(ox + w, oy + h), P(ox, oy + h)], thk),
    wall("l", [P(ox, oy + h), P(ox, oy)], thk),
  ];
}
const RECT_CORNERS = {
  "1. top-left": { node: P(0, 0), ids: ["t", "l"], outer: P(-50, -50), inner: P(50, 50) },
  "2. bottom-left": { node: P(0, 4000), ids: ["b", "l"], outer: P(-50, 4050), inner: P(50, 3950) },
  "3. top-right": { node: P(6000, 0), ids: ["t", "r"], outer: P(6050, -50), inner: P(5950, 50) },
  "4. bottom-right": { node: P(6000, 4000), ids: ["b", "r"], outer: P(6050, 4050), inner: P(5950, 3950) },
};

describe("PHASE 2E corners — the four 90 degree corners of a rectangle", () => {
  for (const [name, c] of Object.entries(RECT_CORNERS)) {
    it(`${name}: both walls meet on the SAME two corner points`, () => {
      const walls = rectangle();
      const [p1, p2] = c.ids.map((id) => joinAt(walls, id, c.node));
      // 14. zero gap: the two walls do not merely come close, they share the
      // identical pair of points
      expect(asSet(p2)).toBe(asSet(p1));
    });

    it(`${name}: 18./19. the corner reaches its true outer and inner points`, () => {
      // The exact mitre of two 100 mm bands at a right angle. If the corner
      // were cut on the wrong diagonal these two points would be missing and
      // the anti-diagonal pair would appear instead — that is the clipped
      // lower corner and the bulging upper corner the user reported.
      const walls = rectangle();
      const pts = joinAt(walls, c.ids[0], c.node);
      expect(asSet(pts)).toBe(asSet([c.outer, c.inner]));
    });

    it(`${name}: the corner square is tiled exactly — no bite, no double hatch`, () => {
      const { polygons } = geomOf(rectangle());
      const cov = cornerSquareCoverage(polygons, c.node, 100);
      expect(cov.uncovered, `${name} leaves an uncovered bite`).toBe(0);
      // a handful of samples land exactly on the shared miter diagonal and
      // count in both quads; anything more is a real overlap
      expect(cov.doubled, `${name} double-covers the corner`).toBeLessThan(20);
    });

    it(`${name}: 15./16. neither join point spikes`, () => {
      const walls = rectangle();
      for (const id of c.ids) assertNoSpike(joinAt(walls, id, c.node), c.node, 400, `${name} ${id}`);
      // a right-angle miter of 100 mm walls sits exactly thk/sqrt(2) out
      for (const id of c.ids) {
        for (const p of joinAt(walls, id, c.node)) expect(dist(c.node, p)).toBeCloseTo(70.7107, 3);
      }
    });
  }

  it("20. every rectangle polygon is valid and keeps its thickness", () => {
    const walls = rectangle();
    const { polygons } = geomOf(walls);
    expect(polygons).toHaveLength(4);
    assertValidGeometry(polygons, "rectangle");
    assertConsistentWinding(polygons, "rectangle");
    for (const p of polygons) {
      const w = walls.find((x) => x.id === p.wallId);
      expect(perpWidth(p.quad, w.pts[0], w.pts[1], true), `${p.key} start`).toBeCloseTo(100, 6);
      expect(perpWidth(p.quad, w.pts[0], w.pts[1], false), `${p.key} end`).toBeCloseTo(100, 6);
    }
  });

  it("the rectangle comes out the same wherever it sits relative to the room centre", () => {
    // the same rectangle translated so that it DOES enclose the room centre:
    // the shapes must be congruent, i.e. the defect was never about position
    const off = geomOf(rectangle(0, 0)).polygons;
    const on = geomOf(rectangle(12000, 8000)).polygons;
    const shift = (polys, dx, dy) => polys.map((p) => ({
      ...p, quad: p.quad.map((q) => P(q.x + dx, q.y + dy)),
    }));
    // shapes only: the quad's vertex ORDER encodes the outer/inner label,
    // which is assigned relative to the room centre and so legitimately
    // differs between the two placements. The bands must be congruent.
    expect(shapeFingerprint(shift(off, 12000, 8000))).toBe(shapeFingerprint(on));
  });
});

const CORNERS = {
  "5. horizontal + vertical": corner(P(0, 2000), P(4000, 2000), P(4000, 5000)),
  "6. horizontal + oblique": corner(P(0, 0), P(4000, 0), P(7000, 3000)),
  "7. vertical + oblique": corner(P(0, 0), P(0, 4000), P(3000, 7000)),
  "8. oblique + oblique": corner(P(0, 0), P(3000, 2000), P(5000, 5000)),
  "9. acute (~39 deg)": corner(P(0, 0), P(3000, 0), P(1000, 2500)),
  "10. obtuse (~135 deg)": corner(P(0, 0), P(4000, 0), P(7000, 3000)),
  "10b. obtuse (~160 deg)": corner(P(0, 0), P(4000, 0), P(7900, 1400)),
  "11a. thin into thick (100/300)": corner(P(0, 0), P(4000, 0), P(4000, 4000), 100, 300),
  "11b. thick into thin (300/100)": corner(P(0, 0), P(4000, 0), P(4000, 4000), 300, 100),
  "11c. oblique, mixed thickness": corner(P(0, 0), P(4000, 0), P(7000, 3000), 150, 250),
};

describe("PHASE 2E corners — every corner kind", () => {
  for (const [name, walls] of Object.entries(CORNERS)) {
    const node = walls[0].pts[1];

    it(`${name}: 14. the two walls share the identical corner pair (zero gap)`, () => {
      expect(asSet(joinAt(walls, "b", node))).toBe(asSet(joinAt(walls, "a", node)));
    });

    it(`${name}: 15./16. the join is bounded — no spike`, () => {
      const limit = Math.max(walls[0].thk, walls[1].thk) * 4;
      assertNoSpike(joinAt(walls, "a", node), node, limit, name);
      assertNoSpike(joinAt(walls, "b", node), node, limit, name);
    });

    it(`${name}: each wall keeps its own thickness through the corner`, () => {
      for (const w of walls) {
        const poly = polyOf(walls, w.id);
        expect(perpWidth(poly.quad, w.pts[0], w.pts[1], true), `${name} ${w.id} start`).toBeCloseTo(w.thk, 4);
        expect(perpWidth(poly.quad, w.pts[0], w.pts[1], false), `${name} ${w.id} end`).toBeCloseTo(w.thk, 4);
      }
    });

    it(`${name}: 20. both polygons are valid`, () => {
      const { polygons } = geomOf(walls);
      assertValidGeometry(polygons, name);
      assertConsistentWinding(polygons, name);
    });

    it(`${name}: 12. reversing each wall's own direction changes nothing`, () => {
      const rev = walls.map((w) => ({ ...w, pts: [...w.pts].reverse() }));
      for (const id of ["a", "b"]) {
        expect(pointSet(polyOf(rev, id).quad), `${name} ${id}`).toBe(pointSet(polyOf(walls, id).quad));
      }
    });

    it(`${name}: 13. reversing the wall array changes nothing`, () => {
      expect(geometryFingerprint(geomOf([...walls].reverse()).polygons))
        .toBe(geometryFingerprint(geomOf(walls).polygons));
    });

    it(`${name}: 18./19. no uncovered bite and no double hatch at the corner`, () => {
      // the inscribed disc, which is inside the mass at ANY corner angle
      const { polygons } = geomOf(walls);
      const r = Math.min(walls[0].thk, walls[1].thk) / 2 - 0.5;
      const cov = nodeDiscCoverage(polygons, node, r);
      // tolerance is for samples that land exactly ON the shared miter seam,
      // where an even-odd test is arbitrary — a corner cut across the wrong
      // diagonal loses about HALF the disc, three orders of magnitude more
      const slack = cov.total * 0.005;
      expect(cov.uncovered, `${name} clipped: ${JSON.stringify(cov)}`).toBeLessThan(slack);
      expect(cov.doubled, `${name} double-hatched: ${JSON.stringify(cov)}`).toBeLessThan(slack);
    });
  }
});

describe("PHASE 2E corners — 17. the miter limit and its bevel fallback", () => {
  // ~5 degree wedge: the true miter would sit 50/sin(2.5deg) = 1146 mm from
  // the node. The limiter must cut that down to a bevel near the node.
  const sliver = corner(P(0, 0), P(4000, 0), P(0, 350));
  const node = P(4000, 0);

  it("a near-collinear wedge bevels instead of spiking", () => {
    const pts = [...joinAt(sliver, "a", node), ...joinAt(sliver, "b", node)];
    for (const p of pts) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      expect(dist(node, p)).toBeLessThanOrEqual(400);   // the miter limit
      expect(dist(node, p)).toBeLessThan(200);          // and far below 1146
    }
  });

  it("the bevel is deterministic — same input, same points", () => {
    const a = geometryFingerprint(geomOf(sliver).polygons);
    expect(geometryFingerprint(geomOf(sliver).polygons)).toBe(a);
    expect(geometryFingerprint(geomOf([...sliver].reverse()).polygons)).toBe(a);
    const rev = sliver.map((w) => ({ ...w, pts: [...w.pts].reverse() }));
    for (const id of ["a", "b"]) {
      expect(pointSet(polyOf(rev, id).quad)).toBe(pointSet(polyOf(sliver, id).quad));
    }
  });

  it("the bevelled polygons are still valid", () => {
    assertValidGeometry(geomOf(sliver).polygons, "5 degree wedge");
  });

  it("an even tighter ~2 degree wedge still bevels rather than spiking", () => {
    // true miter here would be 50/sin(1deg) = 2865 mm from the node
    const tighter = corner(P(0, 0), P(4000, 0), P(0, 140));
    for (const id of ["a", "b"]) {
      const pts = joinAt(tighter, id, node);
      for (const p of pts) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        expect(dist(node, p)).toBeLessThanOrEqual(400);
      }
      const quad = polyOf(tighter, id).quad;
      expect(allFinite(quad)).toBe(true);
      expect(polygonArea(quad)).toBeGreaterThan(0);
    }
    expect(geometryFingerprint(geomOf(tighter).polygons))
      .toBe(geometryFingerprint(geomOf([...tighter].reverse()).polygons));
  });

  // A wall that folds back on itself within a fraction of a degree is not a
  // corner at all: expandWallsAtTeeJunctions sees the returning arm running
  // inside the NODE_LINK_THR band of the outgoing one and welds it as a T
  // instead. That path is covered by plannerWallTJunctionJoins' near-parallel
  // case, so there is nothing for the corner join to do here.
});

describe("PHASE 2E corners — a chain of corners stays consistent", () => {
  // an open polyline through every corner kind at once, off-centre in the room
  const chain = [
    wall("w1", [P(1000, 1000), P(7000, 1000)]),
    wall("w2", [P(7000, 1000), P(7000, 5000)], 150),
    wall("w3", [P(7000, 5000), P(11000, 8000)], 150),
    wall("w4", [P(11000, 8000), P(4000, 9500)], 250),
    wall("w5", [P(4000, 9500), P(2000, 5000)], 250),
  ];

  it("every join is shared, bounded and valid", () => {
    const { polygons } = geomOf(chain);
    assertValidGeometry(polygons, "chain");
    assertConsistentWinding(polygons, "chain");
    for (let i = 0; i < chain.length - 1; i++) {
      const node = chain[i].pts[1];
      const limit = Math.max(chain[i].thk, chain[i + 1].thk) * 4;
      const p1 = joinAt(chain, chain[i].id, node);
      const p2 = joinAt(chain, chain[i + 1].id, node);
      expect(asSet(p2), `node ${i}`).toBe(asSet(p1));
      assertNoSpike(p1, node, limit, `chain node ${i}`);
    }
  });

  it("every wall keeps its thickness at both ends of every segment", () => {
    for (const w of chain) {
      const poly = polyOf(chain, w.id);
      expect(perpWidth(poly.quad, w.pts[0], w.pts[1], true), `${w.id} start`).toBeCloseTo(w.thk, 4);
      expect(perpWidth(poly.quad, w.pts[0], w.pts[1], false), `${w.id} end`).toBeCloseTo(w.thk, 4);
    }
  });

  it("13. the chain is independent of array order", () => {
    const base = geometryFingerprint(geomOf(chain).polygons);
    expect(geometryFingerprint(geomOf([...chain].reverse()).polygons)).toBe(base);
    const shuffled = [chain[2], chain[0], chain[4], chain[1], chain[3]];
    expect(geometryFingerprint(geomOf(shuffled).polygons)).toBe(base);
  });
});
