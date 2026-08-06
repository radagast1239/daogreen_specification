/**
 * PHASE 2E — a T-junction branch keeps its full thickness up to the host face.
 *
 * The branch's two face points used to be PROJECTED onto the host's near face
 * (component along the host kept, normal component overwritten), which
 * foreshortens the mouth to thk * sin(incidence). At 90 degrees projection and
 * intersection coincide, so the defect only ever showed on diagonal junctions:
 * a 52-degree branch arrived 79.3 mm wide instead of 100. The faces are now
 * intersected with the host face line instead.
 *
 * Drives the shipped buildWallGeometry, never a copy.
 */
import { describe, it, expect } from "vitest";
import { buildWallGeometry, TEE_CAP_MITER_MUL } from "../src/planner/buildWallGeometry.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";
import {
  assertValidGeometry, assertConsistentWinding, geometryFingerprint,
  perpWidth, pointSet, allFinite, hasSelfIntersection, P, dist,
} from "./helpers/wallPolygonAssertions.js";

const BASE = { role: "outer", kind: "new", thicknessSide: "center", height: 3000, material: "" };
const room = { w: 30000, h: 20000, wallThk: 100, height: 3000 };
const wall = (id, pts, thk = 100) => ({ ...BASE, id, thk, pts });
const polyOf = (walls, id) => buildWallGeometry(walls, room).polygons.find((p) => p.wallId === id);

/** Host split at the node (the shape expandWallsAtTeeJunctions leaves). */
function tee({ host, branch, hostThk = 100, branchThk = 100 }) {
  return [
    wall("h1", [host.a, host.node], hostThk),
    wall("h2", [host.node, host.b], hostThk),
    wall("br", [host.node, branch], branchThk),
  ];
}
const HOST_H = { a: P(0, 0), node: P(3000, 0), b: P(6000, 0) };
const HOST_OBL = { a: P(0, 0), node: P(3000, 2000), b: P(6000, 4000) };

describe("PHASE 2E — the branch arrives at full thickness", () => {
  const cases = {
    "1. vertical branch into a horizontal host": tee({ host: HOST_H, branch: P(3000, 3000) }),
    "2. horizontal branch into a vertical host": [
      wall("h1", [P(0, -3000), P(0, 0)]), wall("h2", [P(0, 0), P(0, 3000)]),
      wall("br", [P(0, 0), P(3000, 0)]),
    ],
    "3a. branch from below": tee({ host: HOST_H, branch: P(3000, -3000) }),
    "3b. branch from the left": tee({ host: HOST_H, branch: P(1500, 2000) }),
    "3c. branch from the right": tee({ host: HOST_H, branch: P(4500, 2000) }),
    "4. oblique branch into a horizontal host": tee({ host: HOST_H, branch: P(5000, 2600) }),
    "5. vertical branch into an oblique host": tee({ host: HOST_OBL, branch: P(3000, 6000) }),
    "6. oblique branch into an oblique host": tee({ host: HOST_OBL, branch: P(1500, 5000) }),
    "7a. thin branch into a thick host": tee({ host: HOST_H, branch: P(5000, 2600), hostThk: 300, branchThk: 100 }),
    "7b. thick branch into a thin host": tee({ host: HOST_H, branch: P(5000, 2600), hostThk: 100, branchThk: 300 }),
  };

  for (const [name, walls] of Object.entries(cases)) {
    it(`${name}: the mouth is as wide as the branch itself`, () => {
      const br = walls.find((w) => w.id === "br");
      const poly = polyOf(walls, "br");
      expect(poly).toBeTruthy();
      const atHost = perpWidth(poly.quad, br.pts[0], br.pts[1], true);
      const atFree = perpWidth(poly.quad, br.pts[0], br.pts[1], false);
      expect(atHost).toBeCloseTo(br.thk, 1);
      expect(atFree).toBeCloseTo(br.thk, 1);
    });
  }

  it("the pre-fix squeeze is really gone: a 52-degree branch is not 100*sin", () => {
    const walls = tee({ host: HOST_H, branch: P(5000, 2600) });
    const poly = polyOf(walls, "br");
    const br = walls.find((w) => w.id === "br");
    const squeezed = 100 * (2600 / Math.hypot(2000, 2600)); // 79.3 — the old value
    const width = perpWidth(poly.quad, br.pts[0], br.pts[1], true);
    expect(width).toBeCloseTo(100, 1);
    expect(Math.abs(width - squeezed)).toBeGreaterThan(15);
  });
});

describe("PHASE 2E — the branch stops at the host face, and the host stays whole", () => {
  it("11./12. the branch never reaches the host centerline", () => {
    for (const branch of [P(3000, 3000), P(5000, 2600), P(1500, 2600)]) {
      const walls = tee({ host: HOST_H, branch });
      const poly = polyOf(walls, "br");
      const nearest = Math.min(...poly.quad.map((p) => Math.abs(p.y)));
      expect(nearest).toBeCloseTo(50, 1);        // the host's near face, not 0
    }
  });

  it("10. the host keeps its own straight faces through the node", () => {
    const walls = tee({ host: HOST_H, branch: P(5000, 2600) });
    for (const id of ["h1", "h2"]) {
      const q = polyOf(walls, id).quad;
      const ys = q.map((p) => Math.round(p.y)).sort((a, b) => a - b);
      expect(ys).toEqual([-50, -50, 50, 50]);
    }
  });

  it("15. the shared topology node is untouched by the renderer", () => {
    const walls = tee({ host: HOST_H, branch: P(5000, 2600) });
    const before = JSON.stringify(walls);
    buildWallGeometry(walls, room);
    expect(JSON.stringify(walls)).toBe(before);
  });
});

describe("PHASE 2E — determinism", () => {
  const fingerprint = geometryFingerprint;

  it("9. reversing the wall array does not change the result", () => {
    const walls = tee({ host: HOST_H, branch: P(5000, 2600) });
    const a = buildWallGeometry(walls, room).polygons;
    const b = buildWallGeometry([...walls].reverse(), room).polygons;
    expect(fingerprint(b)).toBe(fingerprint(a));
  });

  it("8. reversing a wall's own direction keeps the branch full width", () => {
    const walls = tee({ host: HOST_H, branch: P(5000, 2600) })
      .map((w) => ({ ...w, pts: [...w.pts].reverse() }));
    const br = walls.find((w) => w.id === "br");
    const poly = polyOf(walls, "br");
    expect(perpWidth(poly.quad, br.pts[0], br.pts[1], false)).toBeCloseTo(100, 1);
  });

  it("the same input always gives the same output", () => {
    const walls = tee({ host: HOST_OBL, branch: P(1500, 5000) });
    expect(fingerprint(buildWallGeometry(walls, room).polygons))
      .toBe(fingerprint(buildWallGeometry(walls, room).polygons));
  });

  it("a near-parallel branch falls back to a bounded cap instead of a spike", () => {
    // ~3 degrees off the host: the face intersection would run far away.
    const walls = tee({ host: HOST_H, branch: P(9000, 160) });
    const poly = polyOf(walls, "br");
    const node = P(3000, 0);
    const bound = Math.max(100, 100) * TEE_CAP_MITER_MUL;
    for (const p of poly.quad) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
    const capReach = Math.max(dist(node, poly.quad[0]), dist(node, poly.quad[3]));
    expect(capReach).toBeLessThanOrEqual(bound);
  });
});

describe("PHASE 2E — polygon validity", () => {
  // The rules live in tests/helpers/wallPolygonAssertions.js, shared with
  // plannerWallEndCaps and plannerWallCornerJoins so all three judge a quad
  // by exactly the same criteria.
  const all = {
    "plain vertical T": tee({ host: HOST_H, branch: P(3000, 3000) }),
    "oblique branch": tee({ host: HOST_H, branch: P(5000, 2600) }),
    "vertical branch, oblique host": tee({ host: HOST_OBL, branch: P(3000, 6000) }),
    "oblique branch, oblique host": tee({ host: HOST_OBL, branch: P(1500, 5000) }),
    "thin branch, thick host": tee({ host: HOST_H, branch: P(5000, 2600), hostThk: 300, branchThk: 100 }),
  };

  for (const [name, walls] of Object.entries(all)) {
    it(`${name}: every quad is finite, non-degenerate, simple and consistently wound`, () => {
      const { polygons } = buildWallGeometry(walls, room);
      assertValidGeometry(polygons, name);
      assertConsistentWinding(polygons, name);
      for (const p of polygons) expect(p.quad).toHaveLength(4);
    });
  }
});

// ---------------------------------------------------------------------------
// PHASE 2E additions: the cases the first pass did not cover.
// ---------------------------------------------------------------------------

/** The host's centerline direction and unit normal at the node. */
function hostFrame(host) {
  const L = dist(host.a, host.b) || 1;
  const d = { x: (host.b.x - host.a.x) / L, y: (host.b.y - host.a.y) / L };
  return { d, n: { x: -d.y, y: d.x } };
}
/** Signed distance of a point from the host centerline (+/- picks the side). */
const offHost = (pt, host) => {
  const { n } = hostFrame(host);
  return (pt.x - host.node.x) * n.x + (pt.y - host.node.y) * n.y;
};

const BRANCHES = {
  "north": { host: HOST_H, branch: P(3000, -3000) },
  "south": { host: HOST_H, branch: P(3000, 3000) },
  "north-east": { host: HOST_H, branch: P(5200, -2400) },
  "south-west": { host: HOST_H, branch: P(1200, 2400) },
  "oblique into oblique host": { host: HOST_OBL, branch: P(1500, 5000) },
  "vertical into oblique host": { host: HOST_OBL, branch: P(3000, 6000) },
  "thin into thick": { host: HOST_H, branch: P(5000, 2600), hostThk: 300, branchThk: 100 },
  "thick into thin": { host: HOST_H, branch: P(5000, 2600), hostThk: 100, branchThk: 300 },
};

describe("PHASE 2E — the branch stops ON the host face, never behind it", () => {
  for (const [name, spec] of Object.entries(BRANCHES)) {
    it(`${name}: the cap sits exactly on the near host face — no gap, nothing behind it`, () => {
      const walls = tee(spec);
      const hostHalf = (spec.hostThk ?? 100) / 2;
      const poly = polyOf(walls, "br");
      const offsets = poly.quad.map((q) => offHost(q, spec.host));
      // which side of the host the branch is on
      const side = Math.sign(offHost(spec.branch, spec.host)) || 1;
      const capOffsets = [offsets[0], offsets[3]].map((v) => v * side);
      // no gap: both cap points lie ON the host face line (|offset| == hostHalf)
      for (const v of capOffsets) expect(v, `${name} cap not on the host face`).toBeCloseTo(hostHalf, 6);
      // nothing behind the face: no branch corner ever crosses to the far side
      for (const v of offsets) {
        expect(v * side, `${name} branch mass reaches behind the host face`)
          .toBeGreaterThanOrEqual(hostHalf - 1e-6);
      }
    });

    it(`${name}: the host stays visually continuous through the node`, () => {
      const walls = tee(spec);
      const hostHalf = (spec.hostThk ?? 100) / 2;
      for (const id of ["h1", "h2"]) {
        const q = polyOf(walls, id).quad;
        const offs = q.map((p) => offHost(p, spec.host)).map((v) => Math.abs(v));
        // both host sub-segments keep their own straight, full-width band:
        // all four corners sit exactly half a thickness off the centerline
        for (const v of offs) expect(v, `${name} host ${id} bends at the node`).toBeCloseTo(hostHalf, 6);
      }
    });

    it(`${name}: the visible branch width at the host face is the branch thickness`, () => {
      const walls = tee(spec);
      const br = walls.find((w) => w.id === "br");
      const poly = polyOf(walls, "br");
      expect(perpWidth(poly.quad, br.pts[0], br.pts[1], true)).toBeCloseTo(br.thk, 4);
      expect(perpWidth(poly.quad, br.pts[0], br.pts[1], false)).toBeCloseTo(br.thk, 4);
    });

    it(`${name}: reversed wall directions and reversed array give the same geometry`, () => {
      const walls = tee(spec);
      const base = geometryFingerprint(buildWallGeometry(walls, room).polygons);
      expect(geometryFingerprint(buildWallGeometry([...walls].reverse(), room).polygons)).toBe(base);
      const flipped = walls.map((w) => ({ ...w, pts: [...w.pts].reverse() }));
      for (const id of ["h1", "h2", "br"]) {
        expect(pointSet(polyOf(flipped, id).quad), `${name} ${id}`).toBe(pointSet(polyOf(walls, id).quad));
      }
    });

    it(`${name}: all three polygons are valid`, () => {
      const { polygons } = buildWallGeometry(tee(spec), room);
      assertValidGeometry(polygons, name);
      assertConsistentWinding(polygons, name);
    });
  }
});

describe("PHASE 2E — the plan pipeline produces the same T as the raw walls", () => {
  // plan.nodes + wall.a/b is the canonical model; wall.pts is derived. The
  // preview, the committed plan and a reloaded plan all reach
  // buildWallGeometry through resolvePlanWalls, so all of them must agree.
  const nodes = {
    n1: { x: 0, y: 0 }, n2: { x: 3000, y: 0 }, n3: { x: 6000, y: 0 }, n4: { x: 5000, y: 2600 },
  };
  const planWalls = [
    { ...BASE, id: "h1", thk: 100, a: "n1", b: "n2" },
    { ...BASE, id: "h2", thk: 100, a: "n2", b: "n3" },
    { ...BASE, id: "br", thk: 100, a: "n2", b: "n4" },
  ];
  const plan = () => ({ nodes, walls: planWalls, room });
  const fpOf = (p) => geometryFingerprint(buildWallGeometry(resolvePlanWalls(p), room).polygons);

  it("resolvePlanWalls and hand-built pts agree", () => {
    const raw = tee({ host: HOST_H, branch: P(5000, 2600) });
    expect(fpOf(plan())).toBe(geometryFingerprint(buildWallGeometry(raw, room).polygons));
  });

  it("preview parity: an effectivePlan that only adds a draft leaves the T identical", () => {
    const committed = fpOf(plan());
    // a draft wall being previewed elsewhere on the canvas must not disturb
    // the already-committed junction
    const effective = {
      ...plan(),
      nodes: { ...nodes, d1: { x: 20000, y: 15000 }, d2: { x: 24000, y: 15000 } },
      walls: [...planWalls, { ...BASE, id: "draft", thk: 100, a: "d1", b: "d2" }],
    };
    const polys = buildWallGeometry(resolvePlanWalls(effective), room).polygons;
    const teeOnly = polys.filter((p) => p.wallId !== "draft");
    expect(geometryFingerprint(teeOnly)).toBe(committed);
  });

  it("reload parity: a JSON round-trip of the plan reproduces the geometry exactly", () => {
    const before = fpOf(plan());
    expect(fpOf(JSON.parse(JSON.stringify(plan())))).toBe(before);
  });

  it("move parity: moving the junction and moving it back restores the geometry exactly", () => {
    const before = fpOf(plan());
    const moved = { ...plan(), nodes: { ...nodes, n2: { x: 3400, y: 250 } } };
    const movedFp = fpOf(moved);
    expect(movedFp).not.toBe(before);
    // the moved junction is still a well-formed T
    assertValidGeometry(buildWallGeometry(resolvePlanWalls(moved), room).polygons, "moved T");
    const back = { ...plan(), nodes: { ...nodes, n2: { x: 3000, y: 0 } } };
    expect(fpOf(back)).toBe(before);
  });

  it("the pipeline never mutates plan.nodes or plan.walls", () => {
    const p = plan();
    const snapshot = JSON.stringify(p);
    buildWallGeometry(resolvePlanWalls(p), room);
    expect(JSON.stringify(p)).toBe(snapshot);
  });
});

describe("PHASE 2E — near-parallel branches degrade safely", () => {
  // Below roughly 7 degrees of incidence the exact face intersection runs past
  // TEE_CAP_MITER_MUL and the bounded fallback takes over. It must never
  // produce a spike, a NaN or a crossed polygon, and must be repeatable.
  const angles = [12, 10, 8, 6, 4, 3];

  for (const deg of angles) {
    const rad = (deg * Math.PI) / 180;
    const end = P(3000 + 4000 * Math.cos(rad), 4000 * Math.sin(rad));
    const walls = () => tee({ host: HOST_H, branch: end });

    it(`${deg} degrees: bounded, finite, simple and deterministic`, () => {
      const polys = buildWallGeometry(walls(), room).polygons;
      const br = polys.filter((p) => p.wallId === "br");
      expect(br.length).toBeGreaterThan(0);
      const node = P(3000, 0);
      const bound = 100 * TEE_CAP_MITER_MUL;
      for (const p of br) {
        expect(allFinite(p.quad), `${deg} deg — NaN in the cap`).toBe(true);
        expect(hasSelfIntersection(p.quad), `${deg} deg — crossed polygon`).toBe(false);
      }
      // the cap itself (the end at the node) stays within the miter limit
      for (const q of [br[0].quad[0], br[0].quad[3]]) {
        expect(dist(node, q), `${deg} deg — spike`).toBeLessThanOrEqual(bound);
      }
      expect(geometryFingerprint(buildWallGeometry(walls(), room).polygons))
        .toBe(geometryFingerprint(buildWallGeometry(walls(), room).polygons));
      expect(geometryFingerprint(buildWallGeometry([...walls()].reverse(), room).polygons))
        .toBe(geometryFingerprint(buildWallGeometry(walls(), room).polygons));
    });

    it(`${deg} degrees: the mouth is still within a few percent of the branch thickness`, () => {
      const polys = buildWallGeometry(walls(), room).polygons;
      const first = polys.find((p) => p.wallId === "br");
      const w = perpWidth(first.quad, P(3000, 0), end, true);
      // the fallback trades exactness for boundedness, but only marginally:
      // the pre-fix projection gave 100*sin(deg), i.e. 21 mm at 12 degrees
      expect(w, `${deg} deg mouth`).toBeGreaterThan(95);
      expect(w, `${deg} deg mouth`).toBeLessThanOrEqual(100.001);
    });
  }
});

describe("PHASE 2E — a degree-4 crossing is not a bow-tie", () => {
  const cross = [
    wall("hx1", [P(0, 3000), P(3000, 3000)]), wall("hx2", [P(3000, 3000), P(6000, 3000)]),
    wall("vy1", [P(3000, 0), P(3000, 3000)]), wall("vy2", [P(3000, 3000), P(3000, 6000)]),
  ];

  it("every arm keeps full thickness and every polygon is simple", () => {
    const { polygons } = buildWallGeometry(cross, room);
    assertValidGeometry(polygons, "degree-4");
    assertConsistentWinding(polygons, "degree-4");
    for (const w of cross) {
      const poly = polyOf(cross, w.id);
      expect(perpWidth(poly.quad, w.pts[0], w.pts[1], true), `${w.id} start`).toBeCloseTo(100, 4);
      expect(perpWidth(poly.quad, w.pts[0], w.pts[1], false), `${w.id} end`).toBeCloseTo(100, 4);
    }
  });

  it("the crossing is independent of wall array order", () => {
    const base = geometryFingerprint(buildWallGeometry(cross, room).polygons);
    expect(geometryFingerprint(buildWallGeometry([...cross].reverse(), room).polygons)).toBe(base);
    const shuffled = [cross[2], cross[0], cross[3], cross[1]];
    expect(geometryFingerprint(buildWallGeometry(shuffled, room).polygons)).toBe(base);
  });
});
