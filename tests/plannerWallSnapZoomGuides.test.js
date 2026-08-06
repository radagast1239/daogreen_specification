/**
 * PHASE 2D1 — zoom-bounded node snap and single active guide.
 *
 * At an overview zoom 12 px is ~250 mm, so the old model cap let a corner or
 * T-junction capture the cursor from a quarter of a metre away and the user
 * could not pick an arbitrary point along a wall. Node and wall-end now also
 * respect NODE_LINK_THR, the same tolerance the commit path uses.
 */
import { describe, it, expect } from "vitest";
import {
  resolveWallPoint,
  WALL_POINT_MAX_DISTANCE_PX,
  WALL_POINT_MAX_DISTANCE_MM,
  WALL_POINT_NODE_MAX_DISTANCE_MM,
} from "../src/planner/core/snap/wallPointResolver.js";
import { NODE_LINK_THR } from "../src/planner/core/walls/wallOps.js";

const P = (x, y) => ({ x, y });
const W = { thk: 100, role: "partition", kind: "new", thicknessSide: "center", height: 3000, material: "" };

/** Long horizontal host split at a T, with a branch and open body regions. */
function hostPlan() {
  return {
    nodes: { a: P(0, 0), j: P(6000, 0), b: P(12000, 0), t: P(6000, -3000) },
    walls: [
      { id: "h1", a: "a", b: "j", ...W },
      { id: "h2", a: "j", b: "b", ...W },
      { id: "br", a: "j", b: "t", ...W },
    ],
    items: [], rooms: [], zones: [], dimensions: [], validationWarnings: [],
    room: { w: 30000, h: 20000, wallThk: 100, height: 3000 },
  };
}
const OPTS = {
  snapOn: true, snapWalls: true, snapGrid: true, angleSnapOn: true,
  toleranceDeg: 5, snapDistancePx: 10, wallThk: 100, snapStep: 50,
  chainStart: null, prevSegAngleDeg: null,
};
function resolve(raw, zoom, { plan = hostPlan(), from = null, role = "start", modifiers = {} } = {}) {
  return resolveWallPoint({
    point: raw, from, role, zoom, plan,
    candidateContext: { view: { zoom }, draft: { pts: [], chainStart: null } },
    modifiers, grid: { enabled: true, step: 50, fineStep: 10 }, options: OPTS,
  });
}
/** Point `d` mm from endpoint `b`, diagonally off the wall. */
const offEnd = (d) => P(12000 + d / Math.SQRT2, -d / Math.SQRT2);
const isTopoNode = (r) => r.kind === "node" || r.kind === "wall-end";

const OVERVIEW = 0.048;
const NORMAL = 0.2;
const CLOSE = 0.8;
const HIGH = 2.5;

describe("PHASE 2D1 — node / wall-end eligibility", () => {
  it("the node cap is the topology tolerance, not the wall-body model cap", () => {
    expect(WALL_POINT_NODE_MAX_DISTANCE_MM).toBe(NODE_LINK_THR);
    expect(WALL_POINT_NODE_MAX_DISTANCE_MM).toBe(85);
    expect(WALL_POINT_MAX_DISTANCE_MM).toBe(250);
    expect(WALL_POINT_MAX_DISTANCE_PX).toBe(12);
  });

  it("1.-3. a node within 85 mm and within the screen radius is captured", () => {
    for (const d of [20, 40, 80]) {
      const r = resolve(offEnd(d), OVERVIEW);
      expect(isTopoNode(r)).toBe(true);
      expect(r.connects).toBe(true);
      expect(r.point).toEqual(P(12000, 0));
      expect(r.distanceMm).toBeLessThanOrEqual(NODE_LINK_THR);
    }
  });

  it("4. the 85 mm boundary is inclusive and deterministic", () => {
    const r = resolve(offEnd(85), OVERVIEW);
    expect(isTopoNode(r)).toBe(true);
    expect(r.distanceMm).toBeLessThanOrEqual(NODE_LINK_THR + 1e-9);
    // …and repeatable
    expect(resolve(offEnd(85), OVERVIEW).kind).toBe(r.kind);
  });

  it("5.-8. a node beyond 85 mm is NEVER captured, at any zoom", () => {
    for (const zoom of [OVERVIEW, NORMAL, CLOSE, HIGH]) {
      for (const d of [90, 100, 150, 250]) {
        const r = resolve(offEnd(d), zoom);
        expect(isTopoNode(r)).toBe(false);
        expect(r.connects).toBe(false);
        expect(r.nodeId).toBeNull();
      }
    }
  });

  it("9. overview zoom no longer turns 12 px into a 150-250 mm magnet", () => {
    // 150 mm is only ~7 px at overview, so the screen radius alone would have
    // accepted it; the model bound is what rejects it now.
    const r = resolve(offEnd(150), OVERVIEW);
    expect(r.distanceMm * OVERVIEW).toBeLessThan(WALL_POINT_MAX_DISTANCE_PX);
    expect(isTopoNode(r)).toBe(false);
  });

  it("6b. high zoom does not create a huge screen magnet", () => {
    const r = resolve(offEnd(80), HIGH); // 80 mm = 200 px
    expect(isTopoNode(r)).toBe(false);
  });
});

describe("PHASE 2D1 — wall-body stays selectable", () => {
  it("13.-15. points along the host resolve to wall-body, including near an endpoint", () => {
    for (const zoom of [OVERVIEW, NORMAL, CLOSE]) {
      for (const off of [90, 150, 300, 500, 1500]) {
        const r = resolve(P(12000 - off, 0), zoom);
        expect(r.kind).toBe("wall-body");
        expect(r.connects).toBe(true);
        expect(Math.round(r.point.y)).toBe(0);          // exactly on the centerline
        expect(Math.round(r.point.x)).toBe(12000 - off); // free choice along the wall
      }
    }
  });

  it("14. several distinct attachment points resolve independently at overview zoom", () => {
    const xs = [3000, 4500, 7200, 9000, 10800].map((x) => Math.round(resolve(P(x, 0), OVERVIEW).point.x));
    expect(new Set(xs).size).toBe(xs.length);
    expect(xs).toEqual([3000, 4500, 7200, 9000, 10800]);
  });

  it("18. a farther node never beats a nearer wall-body", () => {
    // 120 mm from the endpoint, sitting exactly on the wall: body distance ~0.
    const r = resolve(P(12000 - 120, 0), OVERVIEW);
    expect(r.kind).toBe("wall-body");
  });

  it("16./17. oblique walls and reversed orientation resolve equivalently", () => {
    const base = {
      nodes: { p: P(0, 0), q: P(4000, 3000) },
      walls: [{ id: "ob", a: "p", b: "q", ...W }],
      items: [], rooms: [], zones: [], dimensions: [], validationWarnings: [],
      room: { w: 30000, h: 20000, wallThk: 100, height: 3000 },
    };
    const reversed = { ...base, walls: [{ id: "ob", a: "q", b: "p", ...W }] };
    const mid = P(2000, 1500);
    const r1 = resolve(mid, NORMAL, { plan: base });
    const r2 = resolve(mid, NORMAL, { plan: reversed });
    expect(r1.kind).toBe("wall-body");
    expect(r2.kind).toBe("wall-body");
    expect(Math.round(r1.point.x)).toBe(Math.round(r2.point.x));
    expect(Math.round(r1.point.y)).toBe(Math.round(r2.point.y));
  });

  it("20. wall array order does not change the winner", () => {
    const plan = hostPlan();
    const shuffled = { ...plan, walls: [...plan.walls].reverse() };
    const a = resolve(P(9000, 0), NORMAL, { plan });
    const b = resolve(P(9000, 0), NORMAL, { plan: shuffled });
    expect(a.kind).toBe(b.kind);
    expect(a.point).toEqual(b.point);
  });
});

describe("PHASE 2D1 — active guides only", () => {
  const guideList = (r) => {
    const g = r.guides;
    if (!g) return [];
    return Array.isArray(g) ? g : (Array.isArray(g.items) ? g.items : [g]);
  };

  it("23.-25. the result carries at most the winning candidate's guide", () => {
    for (const raw of [offEnd(40), P(9000, 0), P(9000, -4000)]) {
      const r = resolve(raw, NORMAL);
      expect(guideList(r).length).toBeLessThanOrEqual(1);
    }
  });

  it("26. a topology winner never carries several competing guides", () => {
    const r = resolve(P(6000 - 300, 0), NORMAL); // near the T junction, on the body
    expect(r.kind).toBe("wall-body");
    expect(guideList(r).length).toBeLessThanOrEqual(1);
  });

  it("27. each resolve returns a fresh result; nothing accumulates", () => {
    const first = resolve(P(9000, 0), NORMAL);
    const second = resolve(P(3000, 0), NORMAL);
    expect(second).not.toBe(first);
    expect(guideList(second).length).toBeLessThanOrEqual(1);
    expect(second.point).not.toEqual(first.point);
  });

  it("33. Alt disables magnetic capture and its guides", () => {
    const r = resolve(offEnd(20), OVERVIEW, { modifiers: { alt: true } });
    expect(r.kind).toBe("raw");
    expect(r.connects).toBe(false);
    expect(r.nodeId).toBeNull();
    expect(r.hostWallId).toBeNull();
    expect(guideList(r).length).toBe(0);
  });
});

describe("PHASE 2D1 — purity", () => {
  it("34.-36. the resolver mutates neither the plan nor the candidates", () => {
    const plan = hostPlan();
    const snapshot = JSON.stringify(plan);
    for (const raw of [offEnd(30), P(9000, 0), P(1000, -2000)]) {
      resolve(raw, OVERVIEW, { plan });
    }
    expect(JSON.stringify(plan)).toBe(snapshot);
  });

  it("21. axis/angle/grid never overwrite an eligible topology winner", () => {
    // A point on the wall body that is also on a 45-degree ray from `from`.
    const r = resolve(P(9000, 0), NORMAL, { role: "end", from: P(6000, -3000) });
    expect(r.kind).toBe("wall-body");
    expect(r.connects).toBe(true);
  });

  it("22. with no eligible topology candidate the directional/grid contract stands", () => {
    const r = resolve(P(3000, -4000), NORMAL);
    expect(["grid", "axis", "angle", "raw"]).toContain(r.kind);
    expect(r.connects).toBe(false);
  });
});
