/**
 * PHASE 2E FOLLOW-UP 1 — degree-3 NON-T hubs, and node clustering.
 *
 * A node where a horizontal, a vertical and a diagonal wall meet is not an
 * ordinary T: no pair is collinear, so there is no host chain. Those nodes go
 * through the generic angular sector walk, and that walk bisected each sector
 * with normalize(dirCur + dirNext) — which points into the wedge only while
 * the wedge is under 180 degrees. Sectors around a node sum to a full turn, so
 * a three-way hub whose arms are not evenly spread has one REFLEX sector, and
 * for that one the bisector pointed the wrong way: faceFacingInto then mitered
 * the wrong pair of faces, tearing a triangular gap out of one side of the hub
 * and stacking the mass twice on the other.
 *
 * Measured on the plan the user drew: the hub at (8000,5000) has sectors of
 * 33.7 / 56.3 / 270 degrees and was broken; a hub at (2000,5000) whose sectors
 * are 116.6 / 153.4 / 90 — all convex — rendered correctly. That contrast is
 * what identified the cause.
 *
 * Coverage here is measured against the PAINTED mass (wall quads plus the
 * node-core polygon), because that is what the user sees.
 */
import { describe, it, expect } from "vitest";
import { buildWallGeometry } from "../src/planner/buildWallGeometry.js";
import { buildWallMassGeometry } from "../src/planner/core/walls/wallMass.js";
import {
  assertValidGeometry, assertConsistentWinding, geometryFingerprint,
  nodeDiscCoverage, perpWidth, pointSet, P, dist,
} from "./helpers/wallPolygonAssertions.js";

const BASE = { role: "partition", kind: "new", thicknessSide: "center", height: 3000, material: "" };
const wall = (id, pts, thk = 100) => ({ ...BASE, id, thk, pts });
const room = { w: 30000, h: 20000, wallThk: 100, height: 3000 };

const build = (walls) => {
  const geom = buildWallGeometry(walls, room);
  const masses = buildWallMassGeometry(geom.polygons, geom.expanded || walls);
  const painted = masses.flatMap((m) => (m.fillPolygons || []).map((q, i) => ({ key: `f${i}`, quad: q })));
  return { geom, masses, painted };
};

/** The mass must fill the whole inscribed disc of a node exactly once. */
function expectSolidHub(walls, node, thk = 100, label = "hub") {
  const { painted } = build(walls);
  const cov = nodeDiscCoverage(painted, node, thk / 2 - 0.5);
  const slack = cov.total * 0.005;
  expect(cov.uncovered, `${label} triangular gap: ${JSON.stringify(cov)}`).toBeLessThan(slack);
  expect(cov.doubled, `${label} doubled mass: ${JSON.stringify(cov)}`).toBeLessThan(slack);
}

/** No boundary segment may have painted mass on BOTH sides. */
function expectNoInternalOutline(walls, label = "mass") {
  const { masses, painted } = build(walls);
  const inMass = (pt) => painted.some((f) => {
    let inside = false; const poly = f.quad;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if ((poly[i].y > pt.y) !== (poly[j].y > pt.y)
        && pt.x < ((poly[j].x - poly[i].x) * (pt.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x) inside = !inside;
    }
    return inside;
  });
  for (const m of masses) {
    for (const e of m.boundaryEdges) {
      const L = dist(e.a, e.b) || 1;
      const nx = -(e.b.y - e.a.y) / L; const ny = (e.b.x - e.a.x) / L;
      for (const t of [0.25, 0.5, 0.75]) {
        const mx = e.a.x + (e.b.x - e.a.x) * t; const my = e.a.y + (e.b.y - e.a.y) * t;
        const both = inMass(P(mx + nx * 0.6, my + ny * 0.6)) && inMass(P(mx - nx * 0.6, my - ny * 0.6));
        expect(both, `${label}: internal outline at (${mx.toFixed(1)},${my.toFixed(1)}) len=${L.toFixed(1)}`).toBe(false);
      }
    }
  }
}

/** horizontal + vertical + diagonal meeting at `node`. */
function hub(node, { hDir = 1, vDir = 1, diag = P(1, 1), thk = 100, len = 4000 } = {}) {
  const dl = Math.hypot(diag.x, diag.y) || 1;
  return [
    wall("h", [node, P(node.x + hDir * len, node.y)], thk),
    wall("v", [node, P(node.x, node.y + vDir * len)], thk),
    wall("d", [node, P(node.x + (diag.x / dl) * len, node.y + (diag.y / dl) * len)], thk),
  ];
}

const NODE = P(9000, 7000);

describe("PHASE 2E FOLLOW-UP — three-way hub: horizontal + vertical + diagonal", () => {
  // 5./6./7. all four rotations and both reflections of the arm pattern
  const QUADRANTS = {
    "1. h+ v+ diag into the 90deg sector": { hDir: 1, vDir: 1, diag: P(1, 1) },
    "2. h+ v+ diag OUTSIDE the sector": { hDir: 1, vDir: 1, diag: P(-1, -1) },
    "3. h- v+ (rotation)": { hDir: -1, vDir: 1, diag: P(-1, 1) },
    "4. h- v- (rotation)": { hDir: -1, vDir: -1, diag: P(-1, -1) },
    "5. h+ v- (rotation)": { hDir: 1, vDir: -1, diag: P(1, -1) },
    "6. X reflection": { hDir: -1, vDir: 1, diag: P(1, 1) },
    "7. Y reflection": { hDir: 1, vDir: -1, diag: P(1, 1) },
    "8. acute sector (diagonal at 34deg)": { hDir: 1, vDir: 1, diag: P(3, 2) },
    "9. obtuse sector (diagonal at 162deg)": { hDir: 1, vDir: 1, diag: P(-3, 1) },
  };

  for (const [name, opts] of Object.entries(QUADRANTS)) {
    it(`${name}: 15./16. solid hub — no triangular gap, no doubled triangle`, () => {
      expectSolidHub(hub(NODE, opts), NODE, opts.thk ?? 100, name);
    });

    it(`${name}: 17. no internal diagonal outline`, () => {
      expectNoInternalOutline(hub(NODE, opts), name);
    });

    it(`${name}: 14. no arm tapers as it reaches the hub`, () => {
      const walls = hub(NODE, opts);
      const { geom } = build(walls);
      for (const w of walls) {
        const p = geom.polygons.find((q) => q.wallId === w.id);
        expect(perpWidth(p.quad, w.pts[0], w.pts[1], true), `${name} ${w.id} at hub`).toBeCloseTo(w.thk, 4);
        expect(perpWidth(p.quad, w.pts[0], w.pts[1], false), `${name} ${w.id} free end`).toBeCloseTo(w.thk, 4);
      }
    });

    it(`${name}: 18./19. bounded join, valid polygons`, () => {
      const walls = hub(NODE, opts);
      const { geom } = build(walls);
      assertValidGeometry(geom.polygons, name);
      assertConsistentWinding(geom.polygons, name);
      for (const p of geom.polygons) {
        for (const q of p.quad) {
          if (dist(NODE, q) < 2000) expect(dist(NODE, q), `${name} spike`).toBeLessThanOrEqual(400);
        }
      }
    });

    it(`${name}: 8./9. reversed directions and reversed array give the same mass`, () => {
      const walls = hub(NODE, opts);
      const base = geometryFingerprint(buildWallGeometry(walls, room).polygons);
      expect(geometryFingerprint(buildWallGeometry([...walls].reverse(), room).polygons)).toBe(base);
      const flipped = walls.map((w) => ({ ...w, pts: [...w.pts].reverse() }));
      for (const w of walls) {
        expect(pointSet(buildWallGeometry(flipped, room).polygons.find((p) => p.wallId === w.id).quad))
          .toBe(pointSet(buildWallGeometry(walls, room).polygons.find((p) => p.wallId === w.id).quad));
      }
    });
  }

  it("10./11. equal and mixed thickness hubs are both solid", () => {
    expectSolidHub(hub(NODE), NODE, 100, "equal");
    const mixed = [
      wall("h", [NODE, P(NODE.x + 4000, NODE.y)], 300),
      wall("v", [NODE, P(NODE.x, NODE.y + 4000)], 100),
      wall("d", [NODE, P(NODE.x + 2800, NODE.y + 2800)], 200),
    ];
    expectSolidHub(mixed, NODE, 100, "mixed");
    expectNoInternalOutline(mixed, "mixed");
  });

  it("26. the builder never mutates its input", () => {
    const walls = hub(NODE);
    const before = JSON.stringify(walls);
    build(walls);
    expect(JSON.stringify(walls)).toBe(before);
  });

  it("22./23. commit and reload parity", () => {
    const walls = hub(NODE);
    const base = geometryFingerprint(buildWallGeometry(walls, room).polygons);
    const reloaded = JSON.parse(JSON.stringify(walls));
    expect(geometryFingerprint(buildWallGeometry(reloaded, room).polygons)).toBe(base);
  });

  it("24./25. move preview and undo/redo parity", () => {
    const walls = hub(NODE);
    const base = geometryFingerprint(buildWallGeometry(walls, room).polygons);
    const moved = hub(P(NODE.x + 900, NODE.y - 400));
    expect(geometryFingerprint(buildWallGeometry(moved, room).polygons)).not.toBe(base);
    expect(geometryFingerprint(buildWallGeometry(hub(NODE), room).polygons)).toBe(base);
  });
});

describe("PHASE 2E FOLLOW-UP — near-degenerate hubs fail closed, not violently", () => {
  // Two arms of the same thickness less than ~20 degrees apart physically
  // OVERLAP near the node: there is no join that gives both their full width,
  // because the walls occupy the same ground. That is section 6 category C
  // (insufficient geometric separation). The contract for those is not a
  // perfect hub, it is a deterministic, bounded, finite result.
  for (const [name, diag] of [["9.5deg from the horizontal arm", P(6, 1)], ["14deg from the vertical arm", P(-1, 4)]]) {
    it(`${name}: bounded, finite, simple and deterministic`, () => {
      const walls = hub(NODE, { diag });
      const { geom } = build(walls);
      assertValidGeometry(geom.polygons, name);
      for (const p of geom.polygons) {
        for (const q of p.quad) {
          expect(Number.isFinite(q.x) && Number.isFinite(q.y)).toBe(true);
          if (dist(NODE, q) < 2000) expect(dist(NODE, q), `${name} spike`).toBeLessThanOrEqual(400);
        }
      }
      const base = geometryFingerprint(geom.polygons);
      expect(geometryFingerprint(buildWallGeometry(walls, room).polygons)).toBe(base);
      expect(geometryFingerprint(buildWallGeometry([...walls].reverse(), room).polygons)).toBe(base);
    });
  }
});

describe("PHASE 2E FOLLOW-UP — degree-4 and higher hubs stay solid too", () => {
  it("a five-arm star has no gap and no doubled mass", () => {
    const arms = [0, 62, 130, 205, 290].map((deg, i) => {
      const r = (deg * Math.PI) / 180;
      return wall(`a${i}`, [NODE, P(NODE.x + 4000 * Math.cos(r), NODE.y + 4000 * Math.sin(r))]);
    });
    expectSolidHub(arms, NODE, 100, "5-arm");
    expectNoInternalOutline(arms, "5-arm");
  });
});

describe("PHASE 2E FOLLOW-UP — endpoint clustering is by distance, not grid cell", () => {
  // buildWallGeometry used to bucket endpoints with round(x/85)_round(y/85).
  // Two endpoints in one cell were fused however far apart; two a hair apart
  // across a cell edge were split. On the user's plan that fused (4033,-14)
  // with (4000,0) — 35.8 mm apart, different walls — and joined every arm in
  // the bucket about one arbitrary point, tilting the bands off their own
  // centerlines.
  const bandIsParallel = (walls, label) => {
    const geom = buildWallGeometry(walls, room);
    for (const w of geom.expanded || walls) {
      for (let i = 0; i < w.pts.length - 1; i++) {
        const p = geom.polygons.find((q) => q.wallId === w.id && q.segIdx === i);
        if (!p) continue;
        const L = dist(w.pts[i], w.pts[i + 1]) || 1;
        const nx = -(w.pts[i + 1].y - w.pts[i].y) / L; const ny = (w.pts[i + 1].x - w.pts[i].x) / L;
        const o = p.quad.map((q) => (q.x - w.pts[i].x) * nx + (q.y - w.pts[i].y) * ny);
        const spread = Math.max(Math.abs(o[0] - o[1]), Math.abs(o[2] - o[3]));
        expect(spread, `${label} ${p.key}: band is not parallel to its own centerline`).toBeLessThan(0.001);
      }
    }
  };

  it("two endpoints 36 mm apart in one 85 mm cell are NOT fused into one node", () => {
    // (4033,-14) and (4000,0) share the old grid cell but belong to different
    // walls; the horizontal wall must keep its own straight band.
    const walls = [
      wall("far", [P(1000, -14), P(4033, -14)]),
      wall("hostR", [P(4000, 0), P(8000, 0)]),
      wall("branch", [P(4000, 0), P(4000, 4000)]),
    ];
    bandIsParallel(walls, "grid-cell collision");
  });

  it("hand-drawn endpoints a few mm off the node never tilt a band", () => {
    for (const off of [2, 6, 10, 20, 40, 80]) {
      const walls = [
        wall("h1", [P(1000, 5000), P(5000, 5000)]),
        wall("h2", [P(5000 + off, 5000), P(9000, 5000)]),
        wall("br", [P(5000, 5000 + off), P(5000, 9000)]),
      ];
      bandIsParallel(walls, `offset ${off}mm`);
    }
  });

  it("clustering is independent of wall array order", () => {
    const walls = [
      wall("h1", [P(1000, 5000), P(5000, 5000)]),
      wall("h2", [P(5006, 5000), P(9000, 5000)]),
      wall("br", [P(5000, 5004), P(5000, 9000)]),
    ];
    const base = geometryFingerprint(buildWallGeometry(walls, room).polygons);
    expect(geometryFingerprint(buildWallGeometry([...walls].reverse(), room).polygons)).toBe(base);
    const rot = [...walls]; rot.push(...rot.splice(0, 1));
    expect(geometryFingerprint(buildWallGeometry(rot, room).polygons)).toBe(base);
  });
});
