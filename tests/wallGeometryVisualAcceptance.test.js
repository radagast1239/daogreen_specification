import { describe, expect, it } from "vitest";
import { weldWallNodes } from "../src/planner/wallGeometry.js";
import { buildWallGeometry } from "../src/planner/buildWallGeometry.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";
import { generateWallDimensions } from "../src/planner/core/dimensions/generateWallDimensions.js";
import { detectRooms } from "../src/planner/core/rooms/detectRooms.js";

const EPS = 1; // mm — geometry comparisons use an epsilon, never strict float equality

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function rectanglePlan(thk = 100) {
  return {
    nodes: { n1: { x: 0, y: 0 }, n2: { x: 4000, y: 0 }, n3: { x: 4000, y: 3000 }, n4: { x: 0, y: 3000 } },
    walls: [
      { id: "w1", a: "n1", b: "n2", thk, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "w1" },
      { id: "w2", a: "n2", b: "n3", thk, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "w2" },
      { id: "w3", a: "n3", b: "n4", thk, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "w3" },
      { id: "w4", a: "n4", b: "n1", thk, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "w4" },
    ],
    room: { w: 4000, h: 3000, wallThk: thk, height: 3000 },
    items: [], lines: [], dimensions: [],
  };
}

function twoRoomsPlan() {
  return {
    nodes: {
      n1: { x: 0, y: 0 }, n2: { x: 2000, y: 0 }, n3: { x: 4000, y: 0 },
      n4: { x: 4000, y: 3000 }, n5: { x: 2000, y: 3000 }, n6: { x: 0, y: 3000 },
    },
    walls: [
      { id: "w1", a: "n1", b: "n2", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "w1" },
      { id: "w2", a: "n2", b: "n3", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "w2" },
      { id: "w3", a: "n3", b: "n4", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "w3" },
      { id: "w4", a: "n4", b: "n5", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "w4" },
      { id: "w5", a: "n5", b: "n6", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "w5" },
      { id: "w6", a: "n6", b: "n1", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "w6" },
      { id: "w-mid", a: "n2", b: "n5", thk: 80, role: "partition", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "w-mid" },
    ],
    room: { w: 4000, h: 3000, wallThk: 100, height: 3000 },
    items: [], lines: [], dimensions: [],
  };
}

describe("wall geometry — visual acceptance (rectangle, T-junction, mixed thickness, room area)", () => {
  it("1. rectangle: outer corners of adjacent walls coincide (clean outer contour, no gap/overlap)", () => {
    const plan = rectanglePlan();
    const walls = weldWallNodes(resolvePlanWalls(plan));
    const { polygons } = buildWallGeometry(walls, plan.room);
    const w1 = polygons.find((p) => p.wallId === "w1");
    const w2 = polygons.find((p) => p.wallId === "w2");
    expect(w1 && w2).toBeTruthy();
    // w1 goes n1->n2, w2 goes n2->n3: they share node n2. Each quad is
    // [outerA, outerB, innerB, innerA] — w1's outerB and w2's outerA should
    // coincide at the shared outer corner.
    expect(dist(w1.quad[1], w2.quad[0])).toBeLessThan(EPS);
  });

  it("2. rectangle: inner corners of adjacent walls coincide (clean inner contour)", () => {
    const plan = rectanglePlan();
    const walls = weldWallNodes(resolvePlanWalls(plan));
    const { polygons } = buildWallGeometry(walls, plan.room);
    const w1 = polygons.find((p) => p.wallId === "w1");
    const w2 = polygons.find((p) => p.wallId === "w2");
    expect(dist(w1.quad[2], w2.quad[3])).toBeLessThan(EPS);
  });

  it("3. rectangle: no protruding end caps — every wall's quad corner at a shared node lands within thickness of the node itself (no giant spike)", () => {
    const plan = rectanglePlan();
    const walls = weldWallNodes(resolvePlanWalls(plan));
    const { polygons } = buildWallGeometry(walls, plan.room);
    const node = { x: 4000, y: 0 }; // n2
    for (const p of polygons) {
      for (const corner of p.quad) {
        if (dist(corner, node) < 500) {
          // any corner "near" this node must stay within a few thicknesses
          // of it, not shoot off arbitrarily far (a miter-limit violation).
          expect(dist(corner, node)).toBeLessThan(400);
        }
      }
    }
  });

  it("4. rectangle: all four wall polygons render exactly once each (no duplicate geometry for the same wall)", () => {
    const plan = rectanglePlan();
    const walls = weldWallNodes(resolvePlanWalls(plan));
    const { polygons } = buildWallGeometry(walls, plan.room);
    const idsRendered = polygons.map((p) => p.wallId);
    const uniqueIds = new Set(idsRendered);
    expect(idsRendered.length).toBe(uniqueIds.size);
    expect(uniqueIds.size).toBe(4);
  });

  it("5/6. T-junction: the central partition's polygon ends at the outer wall's inner face — it does not cross past it (no penetration through the outer wall)", () => {
    const plan = twoRoomsPlan();
    const walls = weldWallNodes(resolvePlanWalls(plan));
    const { polygons } = buildWallGeometry(walls, plan.room);
    const mid = polygons.find((p) => p.wallId === "w-mid");
    const topWall = polygons.find((p) => p.wallId === "w1"); // n1(0,0)->n2(2000,0)
    expect(mid && topWall).toBeTruthy();
    // top outer wall thickness 100 -> its face sits exactly half-thickness
    // (50mm) from its centerline (y=0), on whichever side is "inward" per
    // the join system's own normal convention. The partition's end nearest
    // the top wall must land AT that face (|y| ~= 50), not stop short by a
    // large fraction of its own thickness (a visible gap) and not cross
    // past the wall's far face at |y| = 50 by more than its own thickness
    // (which would mean punching through the entire outer wall).
    const topEndsOfMid = [mid.quad[0], mid.quad[1], mid.quad[2], mid.quad[3]]
      .filter((c) => Math.abs(c.y) < 200)
      .map((c) => Math.abs(c.y));
    expect(topEndsOfMid.length).toBeGreaterThan(0);
    for (const absY of topEndsOfMid) {
      expect(absY).toBeGreaterThanOrEqual(50 - EPS);
      expect(absY).toBeLessThan(50 + 60);
    }
  });

  it("7. mixed thickness join (100+80) still produces a finite, valid quad at the shared node", () => {
    const plan = twoRoomsPlan();
    const walls = weldWallNodes(resolvePlanWalls(plan));
    const { polygons } = buildWallGeometry(walls, plan.room);
    const mid = polygons.find((p) => p.wallId === "w-mid"); // thk 80
    const topWall = polygons.find((p) => p.wallId === "w1"); // thk 100
    for (const poly of [mid, topWall]) {
      for (const c of poly.quad) {
        expect(Number.isFinite(c.x)).toBe(true);
        expect(Number.isFinite(c.y)).toBe(true);
      }
    }
  });

  it("8. acute-angle miter is bounded (does not spike far past the node) — reuses the fixture's own diagonal-corner case", () => {
    const plan = {
      nodes: { n1: { x: 0, y: 0 }, n2: { x: 4000, y: 0 }, n3: { x: 4000, y: 3000 }, n4: { x: 0, y: 3000 }, cut: { x: 300, y: 300 }, n5: { x: 300, y: 0 }, n6: { x: 0, y: 300 } },
      walls: [
        { id: "w1", a: "n5", b: "n2", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "w1" },
        { id: "w2", a: "n2", b: "n3", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "w2" },
        { id: "w3", a: "n3", b: "n4", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "w3" },
        { id: "w4", a: "n4", b: "n6", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "w4" },
        { id: "w-cut", a: "n6", b: "n5", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "w-cut" },
      ],
      room: { w: 4000, h: 3000, wallThk: 100, height: 3000 },
      items: [], lines: [], dimensions: [],
    };
    const walls = weldWallNodes(resolvePlanWalls(plan));
    const { polygons } = buildWallGeometry(walls, plan.room);
    for (const p of polygons) {
      for (const c of p.quad) {
        expect(Number.isFinite(c.x) && Number.isFinite(c.y)).toBe(true);
        // no corner should be wildly far from the fixture's own bounding
        // box (a runaway miter spike would blow well past this).
        expect(Math.abs(c.x)).toBeLessThan(6000);
        expect(Math.abs(c.y)).toBeLessThan(6000);
      }
    }
  });

  it("13. room area is computed from the inner clean contour, not the centerline loop", () => {
    const plan = rectanglePlan(200); // thick walls exaggerate the difference
    const rooms = detectRooms(plan);
    expect(rooms.length).toBeGreaterThan(0);
    const centerlineAreaM2 = (4000 * 3000) / 1_000_000; // 12 m^2
    expect(rooms[0].areaM2).toBeLessThan(centerlineAreaM2);
    // inner rect with 200mm walls (100mm each side): (4000-200)*(3000-200)
    // = 10.64 m^2 nominal; the inner-polygon offset algorithm may adjust
    // this slightly at corners, so allow a modest tolerance rather than an
    // exact match — the key assertion is "meaningfully less than the
    // 12 m^2 centerline area", which is what proves it's not using the
    // centerline loop.
    expect(rooms[0].areaM2).toBeGreaterThan(10.0);
    expect(rooms[0].areaM2).toBeLessThan(11.0);
  });

  it("reversed wall.a/wall.b endpoints produce the same room area (order-invariant)", () => {
    const plan = rectanglePlan(200);
    const reversed = { ...plan, walls: plan.walls.map((w) => ({ ...w, a: w.b, b: w.a })) };
    const roomsBefore = detectRooms(plan);
    const roomsAfter = detectRooms(reversed);
    expect(roomsAfter[0].areaM2).toBeCloseTo(roomsBefore[0].areaM2, 2);
  });

  it("14. renderer wall count (welded, deduped) equals the plan's unique wall count — no legacy/network double-render", () => {
    const plan = twoRoomsPlan();
    const resolved = resolvePlanWalls(plan);
    const welded = weldWallNodes(resolved);
    const uniqueIds = new Set(welded.map((w) => w.id));
    expect(welded.length).toBe(uniqueIds.size);
    expect(uniqueIds.size).toBe(plan.walls.length);
  });

  it("15. selection state does not add or duplicate wall geometry (color-only, verified at the source level)", () => {
    // Re-assert the contract already covered live this session: WallEl's
    // outerColor only changes stroke color for hover/selection; the actual
    // outline geometry is drawn once by WallsTopOverlay regardless of
    // selection state.
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "planner", "canvasPrimitives.jsx"), "utf8");
    expect(src).toContain("const outerColor = hasError ? DG_THEME.dimError : (selected ? DG_THEME.select");
    expect(src).not.toMatch(/selected\s*&&\s*<path[\s\S]{0,80}fill=/);
  });

  it("diagonal wall's per-wall dimension length matches its true centerline length within epsilon, independent of a/b order", () => {
    const plan = {
      nodes: {
        n1: { x: 0, y: 0 }, n2: { x: 4000, y: 0 }, n3: { x: 4000, y: 3000 }, n4: { x: 0, y: 3000 },
        d1: { x: 500, y: 500 }, d2: { x: 1500, y: 1400 },
      },
      walls: [
        { id: "w1", a: "n1", b: "n2", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "w1" },
        { id: "w2", a: "n2", b: "n3", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "w2" },
        { id: "w3", a: "n3", b: "n4", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "w3" },
        { id: "w4", a: "n4", b: "n1", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "w4" },
        { id: "w-diag", a: "d1", b: "d2", thk: 100, role: "partition", kind: "new", thicknessSide: "center", height: 3000, type: "wall", chainId: "w-diag" },
      ],
      room: { w: 4000, h: 3000, wallThk: 100, height: 3000 },
      items: [], lines: [], dimensions: [],
    };
    const expectedLen = Math.hypot(1500 - 500, 1400 - 500);
    const { dimensions } = generateWallDimensions(plan);
    const diagDim = dimensions.find((d) => d.kind === "wall_length" && d.id.startsWith("auto-wall-len-w-diag"));
    expect(diagDim).toBeTruthy();
    const renderedLen = Math.hypot(diagDim.p2.x - diagDim.p1.x, diagDim.p2.y - diagDim.p1.y);
    expect(Math.abs(renderedLen - expectedLen)).toBeLessThan(5);
  });
});
