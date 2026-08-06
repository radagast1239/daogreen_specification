/**
 * PHASE 2F1-M2 — origin independence of wall-mass contours, rooms and dimensions.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateWallDimensions } from "../src/planner/core/dimensions/generateWallDimensions.js";
import { buildRenderedContours } from "../src/planner/core/walls/renderedContours.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";
import { wallGeometryMap } from "../src/planner/buildWallGeometry.js";
import { buildWallMassGeometry } from "../src/planner/core/walls/wallMass.js";
import { commitDrawnWall } from "../src/planner/core/walls/wallDrawTopology.js";

// Self-contained fixture: the gate must assert on every machine, so the plan
// lives in the repository. A missing fixture is a hard failure, never a skip.
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_PATH = path.join(REPO, "tests/fixtures/phase2f1/originIndependencePlan.json");
const PLAN = JSON.parse(fs.readFileSync(PLAN_PATH, "utf8"));
const D = { x: 1234567, y: -987654 };

function translate(plan, dx, dy) {
  return {
    ...plan,
    nodes: Object.fromEntries(
      Object.entries(plan.nodes).map(([id, p]) => [id, { x: p.x + dx, y: p.y + dy }]),
    ),
  };
}
function sub(p, dx, dy) { return { x: p.x - dx, y: p.y - dy }; }
function q(n, s = 10) { return Math.round(n * s) / s; }

function geoDimKey(d, dx = 0, dy = 0) {
  const p1 = sub(d.p1, dx, dy);
  const p2 = sub(d.p2, dx, dy);
  const a = `${q(p1.x)},${q(p1.y)}`;
  const b = `${q(p2.x)},${q(p2.y)}`;
  const anchors = a <= b ? `${a}|${b}` : `${b}|${a}`;
  return `${d.kind}|${Math.round((d.measurementValue || 0) * 100) / 100}|${anchors}`;
}

function loopKey(loop, dx = 0, dy = 0) {
  const pts = (loop || []).map((p) => sub(p, dx, dy));
  let best = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].x < pts[best].x - 1e-9
      || (Math.abs(pts[i].x - pts[best].x) < 1e-9 && pts[i].y < pts[best].y)) best = i;
  }
  const rot = [...pts.slice(best), ...pts.slice(0, best)];
  const fwd = rot.map((p) => `${q(p.x)},${q(p.y)}`).join(">");
  const rev = [rot[0], ...rot.slice(1).reverse()].map((p) => `${q(p.x)},${q(p.y)}`).join(">");
  return fwd <= rev ? fwd : rev;
}

function massFingerprint(plan, dx = 0, dy = 0) {
  const walls = resolvePlanWalls(plan);
  const geom = wallGeometryMap(walls, plan.room);
  const masses = buildWallMassGeometry(geom.polygons, geom.expandedWalls || walls);
  const edges = masses.flatMap((m) => m.boundaryEdges || []).map((e) => {
    const a = `${q(e.a.x - dx)},${q(e.a.y - dy)}`;
    const b = `${q(e.b.x - dx)},${q(e.b.y - dy)}`;
    return a <= b ? `${a}|${b}` : `${b}|${a}`;
  }).sort();
  const holes = [...new Set(
    masses.flatMap((m) => m.holeLoops || []).map((l) => loopKey(l, dx, dy)),
  )].sort();
  return { massCount: masses.length, edgeCount: edges.length, edges, holes };
}

function contourFingerprint(plan, dx = 0, dy = 0) {
  const c = buildRenderedContours(plan);
  return {
    roomCount: (c.roomContours || []).length,
    rooms: (c.roomContours || []).map((r) => loopKey(r.loop, dx, dy)).sort(),
    envCount: (c.envelopes || []).length,
    envSegs: (c.envelopes || []).flatMap((e) => (e.segments || []).map((s) => {
      const a = `${q(s.a.x - dx)},${q(s.a.y - dy)}`;
      const b = `${q(s.b.x - dx)},${q(s.b.y - dy)}`;
      return a <= b ? `${a}|${b}` : `${b}|${a}`;
    })).sort(),
  };
}

function dimFingerprint(plan, dx = 0, dy = 0) {
  const dims = generateWallDimensions(plan, {}).dimensions || [];
  return {
    count: dims.length,
    keys: dims.map((d) => geoDimKey(d, dx, dy)).sort(),
  };
}

function assertOriginEquiv(base, moved, dx, dy) {
  const m0 = massFingerprint(base, 0, 0);
  const m1 = massFingerprint(moved, dx, dy);
  expect(m1.massCount, "mass count").toBe(m0.massCount);
  expect(m1.edgeCount, "edge count").toBe(m0.edgeCount);
  expect(m1.edges, "boundary edges").toEqual(m0.edges);
  expect(m1.holes, "hole loops").toEqual(m0.holes);

  const c0 = contourFingerprint(base, 0, 0);
  const c1 = contourFingerprint(moved, dx, dy);
  expect(c1.roomCount, "room count").toBe(c0.roomCount);
  expect(c1.rooms, "room loops").toEqual(c0.rooms);
  expect(c1.envCount, "envelope count").toBe(c0.envCount);
  expect(c1.envSegs, "envelope segments").toEqual(c0.envSegs);

  const d0 = dimFingerprint(base, 0, 0);
  const d1 = dimFingerprint(moved, dx, dy);
  expect(d1.count, "dimension count").toBe(d0.count);
  expect(d1.keys, "dimension semantics").toEqual(d0.keys);
}

let seq = 0;
const mkId = (p = "id") => `${p}_${++seq}`;
const OUTER = { role: "outer", kind: "new", thicknessSide: "center", thk: 100, height: 3000 };
const PART = { role: "partition", kind: "new", thicknessSide: "center", thk: 100, height: 3000 };
const emptyPlan = () => ({
  room: { w: 30000, h: 24000, wallThk: 100, height: 3000, defaultRoomHeightMm: 3000 },
  nodes: {}, walls: [], items: [], lines: [], zones: [], rooms: [],
  labels: [], dimensions: [], structurals: [], validationWarnings: [],
});
function commit(plan, a, b, props) {
  const r = commitDrawnWall(plan, a, b, { ...props, chainId: mkId("ch") }, mkId);
  return r.changed ? r.plan : plan;
}

describe("PHASE 2F1-M2 origin independence — accepted plan", () => {
  it("1. original accepted plan has 66 dimensions", () => {
    expect(dimFingerprint(PLAN).count).toBe(66);
  });

  it("2. translation +1.2km is normalized-equivalent", () => {
    assertOriginEquiv(PLAN, translate(PLAN, D.x, D.y), D.x, D.y);
  });

  it("3. translation -1.2km is normalized-equivalent", () => {
    assertOriginEquiv(PLAN, translate(PLAN, -D.x, -D.y), -D.x, -D.y);
  });

  it("4. x-only translation", () => {
    assertOriginEquiv(PLAN, translate(PLAN, 1200000, 0), 1200000, 0);
  });

  it("5. y-only translation", () => {
    assertOriginEquiv(PLAN, translate(PLAN, 0, -1200000), 0, -1200000);
  });

  it("6. diagonal translation", () => {
    assertOriginEquiv(PLAN, translate(PLAN, 500000, -500000), 500000, -500000);
  });

  it("7. translation around LINE_Q / micron cell boundaries", () => {
    for (const v of [
      { x: 0, y: 1 }, { x: 0, y: 4 }, { x: 0, y: 5 },
      { x: 1, y: 0 }, { x: 4, y: 0 }, { x: 999.5, y: 0 }, { x: 1000.5, y: 0 },
    ]) {
      assertOriginEquiv(PLAN, translate(PLAN, v.x, v.y), v.x, v.y);
    }
    // 7 vectors x ~270ms of full-pipeline rebuild = ~1.9s isolated. The raised
    // timeout covers worker contention in the full suite, nothing more.
  }, 15000);

  it("8. wall-array reorder combined with translation", () => {
    const shuffled = { ...PLAN, walls: [...PLAN.walls].reverse() };
    const moved = translate(shuffled, D.x, D.y);
    assertOriginEquiv(PLAN, moved, D.x, D.y);
  });

  it("9. endpoint reversal combined with translation", () => {
    const reversed = {
      ...PLAN,
      walls: PLAN.walls.map((w) => ({ ...w, a: w.b, b: w.a })),
    };
    const moved = translate(reversed, D.x, D.y);
    assertOriginEquiv(PLAN, moved, D.x, D.y);
  });
});

describe("PHASE 2F1-M2 origin independence — constructed fixtures", () => {
  it("10. off-origin irregular room", () => {
    let p = emptyPlan();
    p = commit(p, { x: 0, y: 0 }, { x: 6000, y: 0 }, OUTER);
    p = commit(p, { x: 6000, y: 0 }, { x: 6000, y: 4000 }, OUTER);
    p = commit(p, { x: 6000, y: 4000 }, { x: 3000, y: 5000 }, OUTER);
    p = commit(p, { x: 3000, y: 5000 }, { x: 0, y: 4000 }, OUTER);
    p = commit(p, { x: 0, y: 4000 }, { x: 0, y: 0 }, OUTER);
    const dx = 1234567, dy = -987654;
    assertOriginEquiv(p, translate(p, dx, dy), dx, dy);
  });

  it("11. off-origin narrow room", () => {
    let p = emptyPlan();
    p = commit(p, { x: 0, y: 0 }, { x: 8000, y: 0 }, OUTER);
    p = commit(p, { x: 8000, y: 0 }, { x: 8000, y: 900 }, OUTER);
    p = commit(p, { x: 8000, y: 900 }, { x: 0, y: 900 }, OUTER);
    p = commit(p, { x: 0, y: 900 }, { x: 0, y: 0 }, OUTER);
    const dx = 0, dy = -1200000;
    assertOriginEquiv(p, translate(p, dx, dy), dx, dy);
  });

  it("12. off-origin T and double-T", () => {
    let p = emptyPlan();
    // host
    p = commit(p, { x: 0, y: 0 }, { x: 8000, y: 0 }, OUTER);
    p = commit(p, { x: 8000, y: 0 }, { x: 8000, y: 6000 }, OUTER);
    p = commit(p, { x: 8000, y: 6000 }, { x: 0, y: 6000 }, OUTER);
    p = commit(p, { x: 0, y: 6000 }, { x: 0, y: 0 }, OUTER);
    // T branch
    p = commit(p, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, PART);
    // second T
    p = commit(p, { x: 0, y: 3000 }, { x: 4000, y: 3000 }, PART);
    const dx = 1234567, dy = 0;
    assertOriginEquiv(p, translate(p, dx, dy), dx, dy);
  });

  it("13. off-origin host split/heal still yields equal dims under translation", () => {
    let p = emptyPlan();
    p = commit(p, { x: 0, y: 0 }, { x: 6000, y: 0 }, OUTER);
    p = commit(p, { x: 6000, y: 0 }, { x: 6000, y: 4000 }, OUTER);
    p = commit(p, { x: 6000, y: 4000 }, { x: 0, y: 4000 }, OUTER);
    p = commit(p, { x: 0, y: 4000 }, { x: 0, y: 0 }, OUTER);
    p = commit(p, { x: 3000, y: 0 }, { x: 3000, y: 4000 }, PART);
    const dx = 100000, dy = -100000;
    assertOriginEquiv(p, translate(p, dx, dy), dx, dy);
  });

  it("15. ±1 mm translations on each axis", () => {
    for (const v of [
      { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
      { x: 1, y: 1 }, { x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 },
    ]) {
      assertOriginEquiv(PLAN, translate(PLAN, v.x, v.y), v.x, v.y);
    }
    // 8 vectors x ~265ms of full-pipeline rebuild = ~2.1s isolated. The raised
    // timeout covers worker contention in the full suite, nothing more.
  }, 15000);

  // PHASE 2F1-M2 REGRESSION — the fixture that broke M2, rebuilt so it does not
  // depend on the C:/tmp accepted plan. A STRAIGHT open chain is the worst case:
  // its centroid lies on its own centreline, so both physical faces are exactly
  // equidistant from it, and the wall sits on the far side of room.h/2 so a
  // -987654 mm translation crosses the fixed reference point that
  // wallSegmentOffsetSide measures against. Before the fix the two collinear
  // segments swapped the face they were measured on (y=36050 <-> y=35950) while
  // the record COUNT stayed 66 — matching counts are not equivalence.
  it("16. off-origin straight open chain keeps the same measured faces", () => {
    let p = emptyPlan();
    p = commit(p, { x: 0, y: 36000 }, { x: 3000, y: 36000 }, OUTER);
    p = commit(p, { x: 3000, y: 36000 }, { x: 6000, y: 36000 }, OUTER);
    assertOriginEquiv(p, translate(p, D.x, D.y), D.x, D.y);
    assertOriginEquiv(p, translate(p, 0, -D.y), 0, -D.y);
    assertOriginEquiv(p, translate(p, 1, -1), 1, -1);
  });

  it("17. off-origin open L chain keeps the same measured faces", () => {
    let p = emptyPlan();
    p = commit(p, { x: 0, y: 36000 }, { x: 6000, y: 36000 }, OUTER);
    p = commit(p, { x: 6000, y: 36000 }, { x: 6000, y: 40000 }, OUTER);
    assertOriginEquiv(p, translate(p, D.x, D.y), D.x, D.y);
    assertOriginEquiv(p, translate(p, 0, -D.y), 0, -D.y);
  });

  it("18. off-origin straight open chain — reorder and endpoint reversal", () => {
    let p = emptyPlan();
    p = commit(p, { x: 0, y: 36000 }, { x: 3000, y: 36000 }, OUTER);
    p = commit(p, { x: 3000, y: 36000 }, { x: 6000, y: 36000 }, OUTER);
    const reordered = { ...p, walls: [...p.walls].reverse() };
    const reversed = { ...p, walls: p.walls.map((w) => ({ ...w, a: w.b, b: w.a })) };
    assertOriginEquiv(p, translate(reordered, D.x, D.y), D.x, D.y);
    assertOriginEquiv(p, translate(reversed, D.x, D.y), D.x, D.y);
  });

  it("14. room and wall-mass equivalence before dimension generation", () => {
    const moved = translate(PLAN, D.x, D.y);
    const m0 = massFingerprint(PLAN);
    const m1 = massFingerprint(moved, D.x, D.y);
    const c0 = contourFingerprint(PLAN);
    const c1 = contourFingerprint(moved, D.x, D.y);
    expect(m1).toEqual(m0);
    expect(c1.roomCount).toBe(c0.roomCount);
    expect(c1.rooms).toEqual(c0.rooms);
  });
});
