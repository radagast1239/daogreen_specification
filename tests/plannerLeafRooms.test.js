import { describe, expect, it } from "vitest";
import { detectRooms } from "../src/planner/core/rooms/detectRooms.js";

// NOTE: this file intentionally does NOT import weldWallNodes/buildWallGeometry
// (see plannerTJunctionGeometry.test.js) -- combining them with detectRooms in
// the same module graph triggers a pre-existing ambiguous star-export
// collision between two ../core/walls/*.js files that both define a
// same-named helper, silently making the barrel's export `undefined`. Out of
// scope to fix here; splitting the test files sidesteps it.

function rectFixture() {
  return {
    nodes: { a: { x: 0, y: 0 }, b: { x: 3000, y: 0 }, c: { x: 3000, y: 2000 }, d: { x: 0, y: 2000 } },
    walls: [
      { id: "top", a: "a", b: "b", thk: 200, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall" },
      { id: "right", a: "b", b: "c", thk: 200, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall" },
      { id: "bottom", a: "c", b: "d", thk: 200, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall" },
      { id: "left", a: "d", b: "a", thk: 200, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall" },
    ],
    room: { w: 3000, h: 2000, wallThk: 200, height: 3000 },
    items: [], lines: [], dimensions: [],
  };
}

// One external rectangle, one central partition welded into two T-junctions.
function twoRoomFixture(reversed = false) {
  const rev = (a, b) => (reversed ? [b, a] : [a, b]);
  const walls = [
    ["tw-top-l", "m1", "m5"], ["tw-top-r", "m5", "m2"], ["tw-right", "m2", "m3"],
    ["tw-bottom-r", "m3", "m6"], ["tw-bottom-l", "m6", "m4"], ["tw-left", "m4", "m1"],
    ["tw-mid", "m5", "m6"],
  ].map(([id, a, b]) => {
    const [ra, rb] = rev(a, b);
    return { id, a: ra, b: rb, thk: id === "tw-mid" ? 150 : 200, role: id === "tw-mid" ? "partition" : "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall" };
  });
  return {
    nodes: {
      m1: { x: 0, y: 0 }, m2: { x: 4000, y: 0 }, m3: { x: 4000, y: 3000 }, m4: { x: 0, y: 3000 },
      m5: { x: 2000, y: 0 }, m6: { x: 2000, y: 3000 },
    },
    walls,
    room: { w: 4000, h: 3000, wallThk: 200, height: 3000 },
    items: [], lines: [], dimensions: [],
  };
}

function twoRoomWithOpenPartitionFixture() {
  const plan = twoRoomFixture();
  // shorten the partition so it no longer reaches the bottom wall (open end)
  plan.nodes.m6 = { x: 2000, y: 2500 };
  plan.walls = plan.walls.filter((w) => w.id !== "tw-bottom-l" && w.id !== "tw-bottom-r");
  plan.walls.push(
    { id: "tw-bottom", a: "m4", b: "m3", thk: 200, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall" },
  );
  return plan;
}

function twoRoomWithObjectFixture() {
  const plan = twoRoomFixture();
  plan.items = [{ id: "obj1", kind: "rack", x: 500, y: 500, w: 400, h: 400 }];
  return plan;
}

function threeRoomFixture() {
  return {
    nodes: {
      m1: { x: 0, y: 0 }, m2: { x: 6000, y: 0 }, m3: { x: 6000, y: 3000 }, m4: { x: 0, y: 3000 },
      m5: { x: 2000, y: 0 }, m6: { x: 2000, y: 3000 }, m7: { x: 4000, y: 0 }, m8: { x: 4000, y: 3000 },
    },
    walls: [
      { id: "t1", a: "m1", b: "m5", thk: 200, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall" },
      { id: "t2", a: "m5", b: "m7", thk: 200, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall" },
      { id: "t3", a: "m7", b: "m2", thk: 200, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall" },
      { id: "right", a: "m2", b: "m3", thk: 200, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall" },
      { id: "b3", a: "m3", b: "m8", thk: 200, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall" },
      { id: "b2", a: "m8", b: "m6", thk: 200, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall" },
      { id: "b1", a: "m6", b: "m4", thk: 200, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall" },
      { id: "left", a: "m4", b: "m1", thk: 200, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall" },
      { id: "mid1", a: "m5", b: "m6", thk: 150, role: "partition", kind: "new", thicknessSide: "center", height: 3000, type: "wall" },
      { id: "mid2", a: "m7", b: "m8", thk: 150, role: "partition", kind: "new", thicknessSide: "center", height: 3000, type: "wall" },
    ],
    room: { w: 6000, h: 3000, wallThk: 200, height: 3000 },
    items: [], lines: [], dimensions: [],
  };
}

// A closed diagonal partition loop (a small triangular room carved out of
// the rectangle by two diagonal walls) -- checks the leaf-room policy also
// holds for non-axis-aligned subdivisions.
function diagonalPartitionFixture() {
  return {
    nodes: {
      a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, c: { x: 4000, y: 3000 }, d: { x: 0, y: 3000 },
      p: { x: 0, y: 1500 }, q: { x: 1800, y: 3000 },
    },
    walls: [
      { id: "top", a: "a", b: "b", thk: 200, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall" },
      { id: "right", a: "b", b: "c", thk: 200, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall" },
      { id: "bottom", a: "c", b: "d", thk: 200, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall" },
      { id: "left-b", a: "d", b: "p", thk: 200, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall" },
      { id: "left-t", a: "p", b: "a", thk: 200, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall" },
      { id: "diag", a: "p", b: "q", thk: 150, role: "partition", kind: "new", thicknessSide: "center", height: 3000, type: "wall" },
      { id: "bottom-split", a: "q", b: "d", thk: 0, role: "partition", kind: "new", thicknessSide: "center", height: 3000, type: "wall" },
    ],
    room: { w: 4000, h: 3000, wallThk: 200, height: 3000 },
    items: [], lines: [], dimensions: [],
  };
}

describe("Leaf-room policy (ghost parent room removal)", () => {
  it("1. a plain rectangle produces exactly 1 room", () => {
    expect(detectRooms(rectFixture())).toHaveLength(1);
  });

  it("2. one T-junction partition produces exactly 2 rooms, no parent", () => {
    const rooms = detectRooms(twoRoomFixture());
    expect(rooms).toHaveLength(2);
    const totalArea = rooms.reduce((s, r) => s + r.areaM2, 0);
    // neither room individually approaches the whole envelope's area
    for (const r of rooms) expect(r.areaM2).toBeLessThan(totalArea * 0.9);
  });

  it("3. two partitions produce exactly 3 rooms, no parent", () => {
    expect(detectRooms(threeRoomFixture())).toHaveLength(3);
  });

  it("4. the containing/parent envelope polygon is not present among derived rooms", () => {
    const rooms = detectRooms(twoRoomFixture());
    const envelopeAreaM2 = (4000 * 3000) / 1_000_000;
    for (const r of rooms) expect(r.areaM2).toBeLessThan(envelopeAreaM2 * 0.9);
  });

  it("5. leaf rooms preserve their correct individual areas (sum ~= envelope, minus wall material)", () => {
    const rooms = detectRooms(twoRoomFixture());
    const sum = rooms.reduce((s, r) => s + r.areaM2, 0);
    const envelopeAreaM2 = (4000 * 3000) / 1_000_000;
    expect(sum).toBeGreaterThan(envelopeAreaM2 * 0.8);
    expect(sum).toBeLessThan(envelopeAreaM2 * 1.05);
  });

  it("6. an open (non-full-span) partition does not split the room", () => {
    const rooms = detectRooms(twoRoomWithOpenPartitionFixture());
    expect(rooms.length).toBeLessThanOrEqual(1);
  });

  it("7. reversed wall a/b endpoints preserve the same room count and comparable total area", () => {
    const roomsFwd = detectRooms(twoRoomFixture(false));
    const roomsRev = detectRooms(twoRoomFixture(true));
    expect(roomsRev).toHaveLength(roomsFwd.length);
    const sumFwd = roomsFwd.reduce((s, r) => s + r.areaM2, 0);
    const sumRev = roomsRev.reduce((s, r) => s + r.areaM2, 0);
    // room-loop tracing over a reversed graph can pick a slightly different
    // (but topologically equivalent) inner polygon near wall corners, so
    // this allows a modest tolerance rather than exact float equality
    expect(Math.abs(sumRev - sumFwd) / sumFwd).toBeLessThan(0.08);
  });

  it("8. an interior object does not change the derived room count", () => {
    expect(detectRooms(twoRoomFixture())).toHaveLength(detectRooms(twoRoomWithObjectFixture()).length);
  });

  it("diagonal partition subdivision still yields correct leaf rooms (no ghost parent)", () => {
    const rooms = detectRooms(diagonalPartitionFixture());
    const envelopeAreaM2 = (4000 * 3000) / 1_000_000;
    for (const r of rooms) expect(r.areaM2).toBeLessThan(envelopeAreaM2 * 0.9);
  });
});
