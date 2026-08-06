/**
 * PHASE 2E — free wall ends (end caps).
 *
 * A wall with nothing attached to an end must finish there as a clean butt:
 * full thickness right up to the last millimetre, cut square across its own
 * centerline, identical at both ends and at any angle. The user-visible bug
 * this locks out is a diagonal wall that LOOKS tapered near its free end.
 *
 * Drives the shipped buildWallGeometry (the canonical builder behind
 * wallGeometryMap -> buildWallMassGeometry -> WallMassLayer), never a copy.
 */
import { describe, it, expect } from "vitest";
import { buildWallGeometry } from "../src/planner/buildWallGeometry.js";
import {
  assertValidPolygon, assertConsistentWinding, geometryFingerprint,
  perpWidth, capSpan, capVsCenterline, pointSet, polygonArea,
  uniquePointCount, duplicateConsecutiveIndex, hasSelfIntersection, allFinite,
  P, dist,
} from "./helpers/wallPolygonAssertions.js";

const BASE = { role: "outer", kind: "new", thicknessSide: "center", height: 3000, material: "" };
const wall = (id, pts, thk = 100) => ({ ...BASE, id, thk, pts });
const room = { w: 30000, h: 20000, wallThk: 100, height: 3000 };
const geomOf = (walls) => buildWallGeometry(walls, room);
const polyOf = (walls, id) => geomOf(walls).polygons.find((p) => p.wallId === id);

/** One free-standing wall, nothing else in the plan — both ends are caps. */
const free = (a, b, thk = 100) => [wall("w", [a, b], thk)];

const ORIENTATIONS = {
  "1. horizontal": [P(4000, 6000), P(12000, 6000)],
  "2. vertical": [P(6000, 3000), P(6000, 11000)],
  "3a. oblique 45deg": [P(3000, 3000), P(9000, 9000)],
  "3b. oblique 30deg": [P(3000, 12000), P(11000, 16619)],
  "3c. oblique 117deg": [P(14000, 4000), P(9000, 13000)],
};

describe("PHASE 2E end caps — the wall keeps its thickness to the very end", () => {
  for (const [name, [a, b]] of Object.entries(ORIENTATIONS)) {
    it(`${name}: both caps are exactly one thickness wide`, () => {
      const poly = polyOf(free(a, b), "w");
      expect(poly).toBeTruthy();
      // 1./2./3. the perpendicular width at each end is the nominal thickness
      expect(perpWidth(poly.quad, a, b, true)).toBeCloseTo(100, 6);
      expect(perpWidth(poly.quad, a, b, false)).toBeCloseTo(100, 6);
      // the required raw measurement: the distance BETWEEN the two face
      // endpoints of a cap is the thickness too (a free cap is not mitred, so
      // span and perpendicular width coincide)
      expect(capSpan(poly.quad, true)).toBeCloseTo(100, 6);
      expect(capSpan(poly.quad, false)).toBeCloseTo(100, 6);
    });

    it(`${name}: 5./6. neither end tapers`, () => {
      const poly = polyOf(free(a, b), "w");
      const L = dist(a, b);
      // sample the band's perpendicular width along the whole wall by
      // interpolating the two faces: a taper would show as a width that
      // changes from end to end.
      const [oa, ob, ib, ia] = poly.quad;
      const n = { x: -(b.y - a.y) / L, y: (b.x - a.x) / L };
      const widths = [];
      for (let t = 0; t <= 1.0001; t += 0.05) {
        const o = { x: oa.x + (ob.x - oa.x) * t, y: oa.y + (ob.y - oa.y) * t };
        const i = { x: ia.x + (ib.x - ia.x) * t, y: ia.y + (ib.y - ia.y) * t };
        widths.push(Math.abs((i.x - o.x) * n.x + (i.y - o.y) * n.y));
      }
      // 2. width is constant end to end (this is the "no taper" statement)
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThan(1e-6);
      expect(widths[0]).toBeCloseTo(100, 6);
      expect(widths[widths.length - 1]).toBeCloseTo(100, 6);
    });

    it(`${name}: 7. the cap is perpendicular to the centerline`, () => {
      const poly = polyOf(free(a, b), "w");
      expect(Math.abs(capVsCenterline(poly.quad, a, b, true))).toBeLessThan(1e-9);
      expect(Math.abs(capVsCenterline(poly.quad, a, b, false))).toBeLessThan(1e-9);
    });

    it(`${name}: 8. both ends are the same width`, () => {
      const poly = polyOf(free(a, b), "w");
      expect(perpWidth(poly.quad, a, b, true)).toBeCloseTo(perpWidth(poly.quad, a, b, false), 9);
    });

    it(`${name}: 4. reversing the wall's own direction gives the same band`, () => {
      const fwd = polyOf(free(a, b), "w");
      const rev = polyOf(free(b, a), "w");
      expect(pointSet(rev.quad)).toBe(pointSet(fwd.quad));
      expect(perpWidth(rev.quad, b, a, true)).toBeCloseTo(100, 6);
      expect(perpWidth(rev.quad, b, a, false)).toBeCloseTo(100, 6);
    });

    it(`${name}: 11.-15. the polygon is valid`, () => {
      const { polygons } = geomOf(free(a, b));
      assertValidPolygon(polygons[0].quad, name);          // 11./12./13./14.
      assertConsistentWinding(polygons, name);             // 15.
    });
  }
});

describe("PHASE 2E end caps — thickness and length variations", () => {
  // 9. different thicknesses
  for (const thk of [60, 100, 150, 250, 400]) {
    it(`9. a ${thk} mm wall caps at ${thk} mm, horizontal and oblique`, () => {
      for (const [a, b] of [[P(2000, 2000), P(9000, 2000)], [P(2000, 9000), P(8000, 14000)]]) {
        const poly = polyOf(free(a, b, thk), "w");
        expect(perpWidth(poly.quad, a, b, true)).toBeCloseTo(thk, 6);
        expect(perpWidth(poly.quad, a, b, false)).toBeCloseTo(thk, 6);
        expect(capSpan(poly.quad, true)).toBeCloseTo(thk, 6);
        assertValidPolygon(poly.quad, `thk ${thk}`);
      }
    });
  }

  // 10. a short but valid wall — nothing collapses when length ~ thickness
  for (const [label, a, b] of [
    ["10a. 300 mm horizontal", P(5000, 5000), P(5300, 5000)],
    ["10b. 200 mm oblique", P(5000, 5000), P(5141.4, 5141.4)],
    ["10c. 120 mm (just over the 100 mm thickness)", P(5000, 5000), P(5120, 5000)],
  ]) {
    it(`${label} still caps at full thickness`, () => {
      const poly = polyOf(free(a, b), "w");
      expect(poly).toBeTruthy();
      expect(perpWidth(poly.quad, a, b, true)).toBeCloseTo(100, 6);
      expect(perpWidth(poly.quad, a, b, false)).toBeCloseTo(100, 6);
      assertValidPolygon(poly.quad, label);
      expect(polygonArea(poly.quad)).toBeCloseTo(dist(a, b) * 100, 3);
    });
  }
});

describe("PHASE 2E end caps — validity spelled out", () => {
  const sample = () => geomOf(free(P(3000, 3000), P(9000, 9000))).polygons[0].quad;

  it("11. every coordinate is finite", () => {
    expect(allFinite(sample())).toBe(true);
  });
  it("12. the polygon has a non-zero area", () => {
    expect(polygonArea(sample())).toBeCloseTo(Math.hypot(6000, 6000) * 100, 3);
  });
  it("13. the polygon does not self-intersect", () => {
    expect(hasSelfIntersection(sample())).toBe(false);
  });
  it("14. no duplicate consecutive vertices, and 4 distinct corners", () => {
    expect(duplicateConsecutiveIndex(sample())).toBe(-1);
    expect(uniquePointCount(sample())).toBe(4);
  });
  it("15. a multi-segment wall keeps one winding for all its segments", () => {
    // a 3-segment polyline that crosses the room centre, which is what flips
    // the outer/inner labelling if anything is going to
    const walls = [wall("s", [P(1000, 10000), P(10000, 10000), P(20000, 10000), P(28000, 10000)])];
    const { polygons } = geomOf(walls);
    expect(polygons).toHaveLength(3);
    assertConsistentWinding(polygons, "multi-segment");
    for (const p of polygons) {
      assertValidPolygon(p.quad, p.key);
      expect(perpWidth(p.quad, p.quad[0], p.quad[1], true)).toBeCloseTo(100, 6);
    }
  });
});

describe("PHASE 2E end caps — 16. geometry does not depend on wall array order", () => {
  const plan = () => [
    wall("a", [P(2000, 2000), P(8000, 2000)]),
    wall("b", [P(3000, 6000), P(9000, 11000)], 150),
    wall("c", [P(14000, 3000), P(14000, 12000)], 250),
    wall("d", [P(18000, 4000), P(23000, 9000)]),
  ];

  it("reversing the array leaves every quad identical", () => {
    const fwd = geomOf(plan()).polygons;
    const rev = geomOf([...plan()].reverse()).polygons;
    expect(geometryFingerprint(rev)).toBe(geometryFingerprint(fwd));
  });

  it("every rotation of the array leaves every quad identical", () => {
    const base = geometryFingerprint(geomOf(plan()).polygons);
    for (let i = 1; i < 4; i++) {
      const rotated = plan();
      rotated.push(...rotated.splice(0, i));
      expect(geometryFingerprint(geomOf(rotated).polygons), `rotation ${i}`).toBe(base);
    }
  });

  it("array order does not change any cap width either", () => {
    for (const walls of [plan(), [...plan()].reverse()]) {
      for (const p of geomOf(walls).polygons) {
        const w = walls.find((x) => x.id === p.wallId);
        expect(perpWidth(p.quad, w.pts[0], w.pts[1], true)).toBeCloseTo(w.thk, 6);
        expect(perpWidth(p.quad, w.pts[0], w.pts[1], false)).toBeCloseTo(w.thk, 6);
      }
    }
  });

  it("the builder never mutates the walls it is given", () => {
    const walls = plan();
    const before = JSON.stringify(walls);
    geomOf(walls);
    expect(JSON.stringify(walls)).toBe(before);
  });
});
