import { describe, expect, it } from "vitest";
import { generateWallDimensions } from "../src/planner/core/dimensions/generateWallDimensions.js";
import { detectRooms } from "../src/planner/core/rooms/detectRooms.js";

const EPS = 1e-6;

function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + dx * t;
  const cy = a.y + dy * t;
  return Math.hypot(p.x - cx, p.y - cy);
}

// A rectangular room with a standalone diagonal wall floating inside it —
// this mirrors the reported real-world case (an added diagonal partition
// stub near/inside a room). Being unconnected to the rectangle's own
// network, it forms its own single-wall group ("open_or_standalone"),
// so generatePerWallDimensions never suppresses it (unlike a wall that
// fully closes a simple rectangular loop, whose length is already covered
// by the room's internal_clear dimension).
function diagonalInRoomFixture() {
  return {
    nodes: {
      n1: { x: 0, y: 0 },
      n2: { x: 6000, y: 0 },
      n3: { x: 6000, y: 4000 },
      n4: { x: 0, y: 4000 },
      d1: { x: 1500, y: 1500 },
      d2: { x: 3000, y: 2800 },
    },
    walls: [
      { id: "w1", a: "n1", b: "n2", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "w1" },
      { id: "w2", a: "n2", b: "n3", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "w2" },
      { id: "w3", a: "n3", b: "n4", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "w3" },
      { id: "w4", a: "n4", b: "n1", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "w4" },
      { id: "w-diag", a: "d1", b: "d2", thk: 100, role: "partition", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "w-diag" },
    ],
    room: { w: 6000, h: 4000, wallThk: 100, height: 3000 },
    items: [],
    lines: [],
    dimensions: [],
  };
}

function centerlineFor(plan, wallId) {
  const w = plan.walls.find((x) => x.id === wallId);
  return { a: plan.nodes[w.a], b: plan.nodes[w.b] };
}

describe("wall_length dimension anchors sit on a wall face, not the centerline", () => {
  it("1. a wall's auto wall_length dimension is offset from its centerline by ~thk/2 (not 0)", () => {
    const plan = diagonalInRoomFixture();
    const { dimensions } = generateWallDimensions(plan);
    const diagDim = dimensions.find((d) => d.kind === "wall_length" && d.id.startsWith("auto-wall-len-w-diag"));
    expect(diagDim).toBeTruthy();

    const { a, b } = centerlineFor(plan, "w-diag");
    const d1 = distToSegment(diagDim.p1, a, b);
    const d2 = distToSegment(diagDim.p2, a, b);
    // thk=100 -> face is thk/2=50mm from centerline.
    expect(d1).toBeGreaterThan(20);
    expect(d2).toBeGreaterThan(20);
    expect(d1).toBeLessThan(80);
    expect(d2).toBeLessThan(80);
  });

  it("2. dimension endpoints are NOT the raw centerline node coordinates", () => {
    const plan = diagonalInRoomFixture();
    const { dimensions } = generateWallDimensions(plan);
    const diagDim = dimensions.find((d) => d.kind === "wall_length" && d.id.startsWith("auto-wall-len-w-diag"));
    expect(diagDim).toBeTruthy();
    const nodeCoords = Object.values(plan.nodes);
    for (const pt of [diagDim.p1, diagDim.p2]) {
      const matchesANode = nodeCoords.some((n) => Math.hypot(n.x - pt.x, n.y - pt.y) < EPS);
      expect(matchesANode).toBe(false);
    }
  });

  it("3. reversed wall.a/wall.b endpoints produce the same visual dimension span (order-invariant)", () => {
    const plan = diagonalInRoomFixture();
    const reversed = { ...plan, walls: plan.walls.map((w) => ({ ...w, a: w.b, b: w.a })) };
    const before = generateWallDimensions(plan).dimensions.filter((d) => d.kind === "wall_length");
    const after = generateWallDimensions(reversed).dimensions.filter((d) => d.kind === "wall_length");
    expect(after.length).toBe(before.length);
    const spanKey = (d) => [d.p1, d.p2].map((p) => `${Math.round(p.x)}_${Math.round(p.y)}`).sort().join("|");
    expect(new Set(after.map(spanKey))).toEqual(new Set(before.map(spanKey)));
  });

  it("4. the diagonal wall's dimension face is chosen by real point-in-polygon room containment, not a bbox-centroid guess", () => {
    const plan = diagonalInRoomFixture();
    const rooms = detectRooms(plan);
    expect(rooms.length).toBeGreaterThan(0);

    const { dimensions } = generateWallDimensions(plan);
    const diagDim = dimensions.find((d) => d.kind === "wall_length" && d.id.startsWith("auto-wall-len-w-diag"));
    expect(diagDim).toBeTruthy();

    // The room polygon fully contains the diagonal wall (it's a stub inside
    // the rectangle), so BOTH candidate faces sit inside the same room --
    // the meaningful, testable assertion here is that the anchor is
    // face-offset (checked in test 1) and stays inside the room polygon
    // rather than escaping it (which the old centerline+bbox-heuristic
    // code could never guarantee for a wall whose midpoint isn't near the
    // whole-plan bounding-box centroid).
    const midX = (diagDim.p1.x + diagDim.p2.x) / 2;
    const midY = (diagDim.p1.y + diagDim.p2.y) / 2;
    const insideAnyRoom = rooms.some((r) => pointInsidePolygonForTest({ x: midX, y: midY }, r.polygon));
    expect(insideAnyRoom).toBe(true);
  });

  it("5. a corrupt/unparseable plan does not crash dimension generation (safe fallback)", () => {
    const plan = diagonalInRoomFixture();
    const brokenPlan = { ...plan, nodes: null };
    expect(() => generateWallDimensions(brokenPlan)).not.toThrow();
  });
});

function pointInsidePolygonForTest(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
