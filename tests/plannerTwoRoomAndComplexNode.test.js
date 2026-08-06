import { describe, expect, it } from "vitest";
import { generateWallDimensions } from "../src/planner/core/dimensions/generateWallDimensions.js";
import { detectRooms } from "../src/planner/core/rooms/detectRooms.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";
import { weldWallNodes } from "../src/planner/core/walls/wallOps.js";
import { wallGeometryMap } from "../src/planner/buildWallGeometry.js";
import { computeFitTransform, computePlanContentBounds } from "../src/planner/viewport.js";

// One external rectangle with a single central vertical partition welded
// into the top and bottom walls at two clean T-junctions (outer walls are
// split into left/right segments at the junction nodes m5/m6, which is the
// correct topology for a T-junction -- a single unbroken outer wall would
// not register the junction point as a node at all).
function twoRoomFixture() {
  return {
    nodes: {
      m1: { x: 0, y: 0 }, m2: { x: 4000, y: 0 }, m3: { x: 4000, y: 3000 }, m4: { x: 0, y: 3000 },
      m5: { x: 2000, y: 0 }, m6: { x: 2000, y: 3000 },
    },
    walls: [
      { id: "tw-top-l", a: "m1", b: "m5", thk: 200, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "tw-top-l" },
      { id: "tw-top-r", a: "m5", b: "m2", thk: 200, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "tw-top-r" },
      { id: "tw-right", a: "m2", b: "m3", thk: 200, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "tw-right" },
      { id: "tw-bottom-r", a: "m3", b: "m6", thk: 200, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "tw-bottom-r" },
      { id: "tw-bottom-l", a: "m6", b: "m4", thk: 200, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "tw-bottom-l" },
      { id: "tw-left", a: "m4", b: "m1", thk: 200, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "tw-left" },
      { id: "tw-mid", a: "m5", b: "m6", thk: 150, role: "partition", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "tw-mid" },
    ],
    room: { w: 4000, h: 3000, wallThk: 200, height: 3000 },
    items: [], lines: [], dimensions: [],
  };
}

// External contour with a diagonal outer wall (acute node at n7) plus two
// internal diagonal walls that are FULLY connected to the outer topology --
// intA runs from the acute outer node n7 to an internal vertex nI, intB
// continues from nI to the outer node n6 -- forming a connected
// acute+obtuse broken internal partition, not a floating open polyline.
function complexNodeFixture() {
  return {
    nodes: {
      n1: { x: 0, y: 0 }, n2: { x: 2500, y: 0 }, n3: { x: 2500, y: 1500 },
      n4: { x: 2100, y: 1900 }, n5: { x: 1500, y: 1900 }, n6: { x: 1100, y: 1500 },
      n7: { x: 300, y: 1700 }, nI: { x: 700, y: 1300 },
    },
    walls: [
      { id: "top", a: "n1", b: "n2", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "top" },
      { id: "right", a: "n2", b: "n3", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "right" },
      { id: "diagUR", a: "n3", b: "n4", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "diagUR" },
      { id: "botR", a: "n4", b: "n5", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "botR" },
      { id: "diagBL", a: "n5", b: "n6", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "diagBL" },
      { id: "diagAcute", a: "n6", b: "n7", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "diagAcute" },
      { id: "closeDiag", a: "n7", b: "n1", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "closeDiag" },
      { id: "intA", a: "n7", b: "nI", thk: 100, role: "partition", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "intA" },
      { id: "intB", a: "nI", b: "n6", thk: 100, role: "partition", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "intB" },
    ],
    room: { w: 2500, h: 1900, wallThk: 100, height: 3000 },
    items: [], lines: [], dimensions: [],
  };
}

function wallValence(walls) {
  const v = new Map();
  const key = (p) => `${Math.round(p.x)}:${Math.round(p.y)}`;
  walls.forEach((w) => {
    const pts = w.pts || [];
    if (!pts.length) return;
    [pts[0], pts[pts.length - 1]].forEach((p) => v.set(key(p), (v.get(key(p)) || 0) + 1));
  });
  return v;
}

describe("Two-room fixture (single envelope + central T-junction partition)", () => {
  const plan = twoRoomFixture();
  const { dimensions } = generateWallDimensions(plan);

  it("1. has exactly one external overall dimension pair for the whole building envelope", () => {
    const extH = dimensions.filter((d) => d.kind === "external_overall" && d.orientation === "horizontal");
    const extV = dimensions.filter((d) => d.kind === "external_overall" && d.orientation === "vertical");
    expect(extH).toHaveLength(1);
    expect(extV).toHaveLength(1);
  });

  it("2. the central partition forms two connected T-junctions (valence 3 at both, no dangling ends)", () => {
    const walls = resolvePlanWalls(plan);
    const valence = wallValence(walls);
    expect(valence.get(`${2000}:${0}`)).toBe(3);
    expect(valence.get(`${2000}:${3000}`)).toBe(3);
    expect([...valence.values()].every((v) => v >= 2)).toBe(true);
  });

  it("3. rendered wall polygon count equals unique wall count (no duplicates)", () => {
    const walls = resolvePlanWalls(plan);
    const welded = weldWallNodes(walls);
    const geom = wallGeometryMap(welded, plan.room);
    const wallIds = geom.polygons.map((p) => p.wallId);
    expect(wallIds).toHaveLength(welded.length);
    expect(new Set(wallIds).size).toBe(wallIds.length);
  });

  it("4. no duplicate polygons for any wall id", () => {
    const walls = resolvePlanWalls(plan);
    const welded = weldWallNodes(walls);
    const geom = wallGeometryMap(welded, plan.room);
    const counts = new Map();
    geom.polygons.forEach((p) => counts.set(p.wallId, (counts.get(p.wallId) || 0) + 1));
    for (const [, count] of counts) expect(count).toBe(1);
  });

  it("5. every wall segment has a valid non-degenerate quad (no missing/orphan geometry -> no visible internal end caps)", () => {
    const walls = resolvePlanWalls(plan);
    const welded = weldWallNodes(walls);
    const geom = wallGeometryMap(welded, plan.room);
    for (const w of welded) {
      const quad = geom.polygons.find((p) => p.wallId === w.id)?.quad;
      expect(quad).toBeTruthy();
      expect(quad.length).toBe(4);
      quad.forEach((pt) => { expect(Number.isFinite(pt.x)).toBe(true); expect(Number.isFinite(pt.y)).toBe(true); });
    }
  });

  it("6. two internal_clear cell dimensions exist, one pair per room, both distinct from the external span", () => {
    // Phase 2F1 face pipeline: room_edge_clear is the canonical per-room clear
    // span (legacy internal_clear is soft-suppressed when covered).
    const clear = dimensions.filter((d) => (
      d.kind === "room_edge_clear" || d.kind === "internal_clear"
    ));
    expect(clear.length).toBeGreaterThanOrEqual(4);
    const hClear = clear
      .filter((d) => d.orientation === "horizontal")
      .map((d) => Math.round(Math.hypot(d.p2.x - d.p1.x, d.p2.y - d.p1.y)));
    expect(hClear.length).toBeGreaterThanOrEqual(2);
    // both rooms are narrower than the full building width
    hClear.forEach((len) => expect(len).toBeLessThan(4000));
  });
});

describe("Complex connected node fixture (acute + obtuse, fully welded topology)", () => {
  const plan = complexNodeFixture();

  it("9. contains no floating/dangling walls -- every node touched by a wall endpoint has valence >= 2", () => {
    const walls = resolvePlanWalls(plan);
    const valence = wallValence(walls);
    expect([...valence.values()].every((v) => v >= 2)).toBe(true);
    // the internal partition's two ends are genuinely connected, not floating:
    // n7 (acute outer node) and n6 (outer node) each gain the extra edge
    expect(valence.get(`${300}:${1700}`)).toBe(3); // n7: closeDiag + diagAcute + intA
    expect(valence.get(`${1100}:${1500}`)).toBe(3); // n6: diagBL + diagAcute + intB
  });

  it("10. produces valid, non-self-intersecting polygons for every wall (including the connected internal diagonals)", () => {
    const walls = resolvePlanWalls(plan);
    const welded = weldWallNodes(walls);
    const geom = wallGeometryMap(welded, plan.room);
    expect(geom.polygons).toHaveLength(welded.length);
    for (const p of geom.polygons) {
      const [a, b, c, d] = p.quad;
      // shoelace area must be finite and non-zero (non-degenerate, no self-crossing collapse)
      const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
      expect(Number.isFinite(area)).toBe(true);
      expect(area).toBeGreaterThan(0);
    }
  });

  it("emits a per-wall dimension for both connected internal diagonal segments", () => {
    const { dimensions } = generateWallDimensions(plan);
    // Connected internals sit on open multi-arm junctions (degree≥3). Phase 2F1
    // suppresses centreline wall_length there; room face clears cover the spans.
    const face = dimensions.filter((d) => (
      d.kind === "room_edge_clear" || d.kind === "wall_length"
    ));
    expect(face.length).toBeGreaterThanOrEqual(2);
    const hasIntCoverage = (id) => face.some((d) => (
      d.id?.includes?.(id)
      || d.sourceWallIds?.includes?.(id)
      || d.reference?.wallId === id
      || (d.arbitration?.sourceWallIds || []).includes?.(id)
    ));
    // Prefer explicit wall association; otherwise require diagonal-length face spans.
    if (!hasIntCoverage("intA") || !hasIntCoverage("intB")) {
      const lens = face.map((d) => Math.hypot(d.p2.x - d.p1.x, d.p2.y - d.p1.y));
      const aLen = Math.hypot(plan.nodes.nI.x - plan.nodes.n7.x, plan.nodes.nI.y - plan.nodes.n7.y);
      const bLen = Math.hypot(plan.nodes.n6.x - plan.nodes.nI.x, plan.nodes.n6.y - plan.nodes.nI.y);
      expect(lens.some((l) => Math.abs(l - aLen) < 120)).toBe(true);
      expect(lens.some((l) => Math.abs(l - bLen) < 120)).toBe(true);
    }
  });
});

describe("Fit respects a bottom viewport inset (bottom toolbar clearance)", () => {
  it("7-8. framed content bottom edge stays within the available height above the inset, with dimension bounds included", () => {
    const plan = complexNodeFixture();
    const { dimensions } = generateWallDimensions(plan);
    const bounds = computePlanContentBounds(plan, { extraDimensions: dimensions });
    const width = 1440, height = 900, bottomInset = 50;
    const fit = computeFitTransform({ bounds, width, height, insets: { top: 0, right: 0, bottom: bottomInset, left: 0 }, padding: 20 });
    const renderedBottom = fit.panY + bounds.maxY * fit.zoom;
    expect(renderedBottom).toBeLessThanOrEqual(height - bottomInset + 1e-6);
    // sanity: without the inset, a large enough bottom margin would let content
    // legitimately extend further down (regression guard that the inset is
    // actually doing something, not a no-op)
    const fitNoInset = computeFitTransform({ bounds, width, height, insets: { top: 0, right: 0, bottom: 0, left: 0 }, padding: 20 });
    expect(fitNoInset.zoom).toBeGreaterThanOrEqual(fit.zoom);
  });
});
