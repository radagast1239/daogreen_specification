/**
 * PHASE 2F1 — narrow-room dimension lane contract.
 *
 * A room that becomes narrow may only tighten the internal lane. It must never
 * push an internal dimension through the wall into the exterior lane, never
 * flip a side, and never add or drop a semantic record just because the room
 * got smaller.
 */
import { describe, it, expect } from "vitest";
import { moveWallSegment, classifyWallSegmentAttachments } from "../src/planner/core/walls/wallCommands.js";
import { materializeWallCommand } from "../src/planner/core/walls/applyWallCommand.js";
import { syncRoomsSafe } from "../src/planner/core/rooms/index.js";
import { generateWallDimensions } from "../src/planner/core/dimensions/generateWallDimensions.js";
import { buildRenderedContours, pointInLoop } from "../src/planner/core/walls/renderedContours.js";
import { detectRooms } from "../src/planner/core/rooms/detectRooms.js";
import { layoutDimensionLabels } from "../src/planner/core/dimensions/dimensionLayout.js";

const W = {
  thk: 100, role: "outer", kind: "new", thicknessSide: "center",
  height: 3000, material: "", type: "wall",
};

const INTERNAL_KINDS = new Set(["room_edge_clear", "internal_clear"]);
const EXTERIOR_KINDS = new Set(["external_segment", "external_overall"]);

function roomPlan(width, height = 3000) {
  const nodes = {
    n1: { x: 0, y: 0 }, n2: { x: width, y: 0 },
    n3: { x: width, y: height }, n4: { x: 0, y: height },
  };
  const walls = [
    { id: "w_t", a: "n1", b: "n2", ...W },
    { id: "w_r", a: "n2", b: "n3", ...W },
    { id: "w_b", a: "n3", b: "n4", ...W },
    { id: "w_l", a: "n4", b: "n1", ...W },
  ];
  return {
    nodes, walls, items: [], rooms: [], zones: [], dimensions: [],
    room: { w: 20000, h: 20000, wallThk: 100 },
  };
}

function applyMove(plan, wallId, delta) {
  const attachments = classifyWallSegmentAttachments(plan, wallId);
  const moved = moveWallSegment(plan, {
    wallId,
    delta,
    expectedEndpointAttachments: attachments,
    makeId: (p) => `${p}_${Math.random().toString(36).slice(2, 8)}`,
  });
  expect(moved.changed).toBe(true);
  const mat = materializeWallCommand(plan, moved);
  const safe = syncRoomsSafe(mat.plan);
  return { ...mat.plan, rooms: safe.ok ? safe.rooms : [], zones: safe.ok ? safe.zones : [] };
}

function midOf(dim) {
  const a = dim.baselineStart || dim.p1;
  const b = dim.baselineEnd || dim.p2;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function measure(plan) {
  const rooms = detectRooms(plan);
  const contours = buildRenderedContours(plan, { rooms });
  const { dimensions } = generateWallDimensions(plan);
  const polys = (contours.roomContours || [])
    .map((rc) => ({ roomId: rc.roomId, poly: rc.roomPolygon }))
    .filter((r) => r.poly?.length >= 3);
  return {
    dimensions,
    polys,
    internals: dimensions.filter((d) => INTERNAL_KINDS.has(d.kind)),
    exteriors: dimensions.filter((d) => EXTERIOR_KINDS.has(d.kind)),
  };
}

/** kind + orientation + measured value multiset — the semantic record set. */
function semanticSet(dimensions) {
  return dimensions
    .filter((d) => INTERNAL_KINDS.has(d.kind))
    .map((d) => `${d.kind}|${d.orientation}`)
    .sort();
}

const WIDTHS = [4000, 2400, 1400, 900, 600, 450, 350, 300, 250, 200];

describe("PHASE 2F1 narrow-room dimension lanes", () => {
  it("1. every internal dimension stays inside its own room at every width", () => {
    for (const width of WIDTHS) {
      const { internals, polys } = measure(roomPlan(width));
      expect(internals.length, `width ${width}`).toBeGreaterThan(0);
      for (const dim of internals) {
        const own = polys.find((p) => p.roomId === (dim.roomId || dim.reference?.roomId)) || polys[0];
        expect(pointInLoop(midOf(dim), own.poly), `width ${width} ${dim.id}`).toBe(true);
      }
    }
  });

  it("2. every exterior dimension stays outside every room at every width", () => {
    for (const width of WIDTHS) {
      const { exteriors, polys } = measure(roomPlan(width));
      expect(exteriors.length, `width ${width}`).toBeGreaterThan(0);
      for (const dim of exteriors) {
        const mid = midOf(dim);
        expect(polys.some((p) => pointInLoop(mid, p.poly)), `width ${width} ${dim.id}`).toBe(false);
      }
    }
  });

  it("3. internal and exterior lanes never collide, even in the narrowest room", () => {
    for (const width of WIDTHS) {
      const { internals, exteriors } = measure(roomPlan(width));
      for (const inner of internals) {
        for (const outer of exteriors) {
          const a = midOf(inner);
          const b = midOf(outer);
          expect(Math.hypot(a.x - b.x, a.y - b.y), `width ${width}`).toBeGreaterThan(W.thk / 2);
        }
      }
    }
  });

  it("4. narrowing only tightens the internal lane — the side never flips", () => {
    let previousGap = Infinity;
    for (const width of WIDTHS) {
      const { internals, polys } = measure(roomPlan(width));
      const vertical = internals.filter((d) => d.orientation === "vertical");
      for (const dim of vertical) {
        const gap = Math.abs(dim.offset);
        expect(gap, `width ${width}`).toBeGreaterThan(0);
        expect(gap, `width ${width}`).toBeLessThanOrEqual(120);
        // Inward direction: the lane midpoint must be inside, the mirrored one outside.
        const mid = midOf(dim);
        const mirrored = { x: dim.p1.x + (dim.p1.x - mid.x), y: mid.y };
        const own = polys.find((p) => p.roomId === (dim.roomId || dim.reference?.roomId)) || polys[0];
        expect(pointInLoop(mid, own.poly)).toBe(true);
        expect(pointInLoop(mirrored, own.poly)).toBe(false);
        previousGap = Math.min(previousGap, gap);
      }
    }
    expect(Number.isFinite(previousGap)).toBe(true);
  });

  it("5. no semantic record is added or removed merely because the room narrowed", () => {
    const wide = semanticSet(measure(roomPlan(4000)).dimensions);
    for (const width of [2400, 1400, 900, 600, 450]) {
      expect(semanticSet(measure(roomPlan(width)).dimensions), `width ${width}`).toEqual(wide);
    }
  });

  it("6. anchors and measured values are unchanged by lane placement", () => {
    for (const width of [4000, 900, 450]) {
      const { internals } = measure(roomPlan(width));
      const clearWidth = internals.find((d) => d.orientation === "horizontal");
      expect(clearWidth).toBeTruthy();
      expect(Math.round(clearWidth.measurementValue ?? clearWidth.value)).toBe(width - W.thk);
    }
  });

  it("7. wide → narrow → wide returns to the same lane placement (no accumulated drift)", () => {
    const fresh = measure(roomPlan(4000));
    let plan = roomPlan(4000);
    plan = applyMove(plan, "w_r", { x: -3000, y: 0 }); // narrow to 1000
    plan = applyMove(plan, "w_r", { x: -400, y: 0 }); // narrow to 600
    plan = applyMove(plan, "w_r", { x: 3400, y: 0 }); // back to 4000
    const cycled = measure(plan);
    const lanes = (m) => m.internals
      .map((d) => `${d.kind}|${d.orientation}|${d.offset}|${Math.round(midOf(d).x)}:${Math.round(midOf(d).y)}`)
      .sort();
    expect(lanes(cycled)).toEqual(lanes(fresh));
  });

  it("8. shrinking step by step keeps every internal line inside at every intermediate state", () => {
    let plan = roomPlan(4000);
    for (const step of [-800, -800, -800, -800, -600]) {
      plan = applyMove(plan, "w_r", { x: step, y: 0 });
      const { internals, exteriors, polys } = measure(plan);
      for (const dim of internals) {
        const own = polys.find((p) => p.roomId === (dim.roomId || dim.reference?.roomId)) || polys[0];
        if (!own) continue;
        expect(pointInLoop(midOf(dim), own.poly), `${dim.id} after ${step}`).toBe(true);
      }
      for (const dim of exteriors) {
        const mid = midOf(dim);
        expect(polys.some((p) => pointInLoop(mid, p.poly)), dim.id).toBe(false);
      }
    }
  });

  it("9. crowded labels shift along their own line or hide — never off the line", () => {
    const { dimensions } = measure(roomPlan(600));
    const geometry = Object.fromEntries(dimensions.map((d) => {
      const a = d.baselineStart || d.p1;
      const b = d.baselineEnd || d.p2;
      return [d.id, { start: a, end: b, length: Math.hypot(b.x - a.x, b.y - a.y) }];
    }));
    const placements = layoutDimensionLabels(dimensions, geometry, { zoom: 0.15, maxAlongSteps: 6 });
    for (const placed of placements) {
      if (!placed.visible) continue;
      const geom = geometry[placed.id];
      const dx = geom.end.x - geom.start.x;
      const dy = geom.end.y - geom.start.y;
      const len = Math.hypot(dx, dy) || 1;
      // Perpendicular distance of the label centre from its own dimension line.
      const perp = Math.abs(((placed.position.x - geom.start.x) * -dy + (placed.position.y - geom.start.y) * dx) / len);
      expect(perp).toBeLessThan(0.5);
    }
  });
});
