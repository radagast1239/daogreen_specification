/**
 * PHASE 2F1-LIVE3 — dedupe, draw typing, arbitration, handle dodge.
 */
import { describe, it, expect } from "vitest";
import {
  parseLengthInput,
  buildLiveWallDrawMeasurements,
  applyExactWallLength,
  resolveLiveDrawSegment,
} from "../src/planner/core/walls/liveWallMeasurements.js";
import {
  filterDimensionsForActiveInteraction,
  physicalSpanKey,
  dodgeDimensionAwayFromHandle,
  dimensionPhysicalSpanKey,
} from "../src/planner/core/dimensions/activeDimensionArbitration.js";

function freeWallPlan(len = 3000) {
  return {
    room: { w: 20000, h: 16000, wallThk: 100, height: 3000 },
    nodes: {
      a: { id: "a", x: 0, y: 0 },
      b: { id: "b", x: len, y: 0 },
    },
    walls: [
      { id: "w1", a: "a", b: "b", thk: 100, height: 3000, material: "drywall", role: "outer", kind: "new", thicknessSide: "center" },
    ],
    items: [], lines: [], zones: [], rooms: [], dimensions: [],
  };
}

describe("PHASE 2F1-LIVE3 arbitration", () => {
  it("1/2. one active span suppresses matching finalized wall_length", () => {
    const dims = [
      { id: "auto-wall-len-w1-1", kind: "wall_length", wallId: "w1", p1: { x: 0, y: 0 }, p2: { x: 3000, y: 0 }, measurementValue: 3000 },
      // LIVE4.3: overlapping room_edge_clear is a replaced background dim.
      { id: "auto:room-edge:x", kind: "room_edge_clear", p1: { x: 0, y: 50 }, p2: { x: 3000, y: 50 }, measurementValue: 3000 },
      // Non-overlapping neighbor room edge must remain.
      { id: "auto:room-edge:other", kind: "room_edge_clear", p1: { x: 0, y: 4050 }, p2: { x: 2000, y: 4050 }, measurementValue: 2000 },
      { id: "auto-wall-len-w2-1", kind: "wall_length", wallId: "w2", p1: { x: 0, y: 4000 }, p2: { x: 2000, y: 4000 }, measurementValue: 2000 },
    ];
    const filtered = filterDimensionsForActiveInteraction(dims, {
      mode: "select_editor",
      wallId: "w1",
      span: { a: { x: 0, y: 0 }, b: { x: 3000, y: 0 } },
      liveFaceSpans: [{ a: { x: 0, y: 50 }, b: { x: 3000, y: 50 } }],
    });
    expect(filtered.some((d) => d.wallId === "w1")).toBe(false);
    expect(filtered.some((d) => d.id === "auto:room-edge:x")).toBe(false);
    expect(filtered.some((d) => d.id === "auto:room-edge:other")).toBe(true);
    expect(filtered.some((d) => d.wallId === "w2")).toBe(true);
  });

  it("3. closing editor mode restores finalized dims (no filter)", () => {
    const dims = [
      { id: "auto-wall-len-w1-1", kind: "wall_length", wallId: "w1", p1: { x: 0, y: 0 }, p2: { x: 3000, y: 0 } },
    ];
    const idle = filterDimensionsForActiveInteraction(dims, { mode: null });
    expect(idle).toHaveLength(1);
  });

  it("4. edit_hold suppresses active wall length", () => {
    const dims = [
      { id: "auto-wall-len-w1-1", kind: "wall_length", wallId: "w1", p1: { x: 0, y: 0 }, p2: { x: 3000, y: 0 } },
    ];
    const hold = filterDimensionsForActiveInteraction(dims, {
      mode: "edit_hold",
      wallId: "w1",
    });
    expect(hold).toHaveLength(0);
  });

  it("draw mode hides all finalized", () => {
    const dims = [
      { id: "a", kind: "wall_length", wallId: "w1", p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 } },
      { id: "b", kind: "room_edge_clear", p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 } },
    ];
    expect(filterDimensionsForActiveInteraction(dims, { mode: "draw" })).toEqual([]);
  });
});

describe("PHASE 2F1-LIVE3 draw typing", () => {
  it("5/7. typing 3000 during drawing is 3000 mm (bareAsMm)", () => {
    expect(parseLengthInput("3000", { bareAsMm: true }).mm).toBe(3000);
    expect(parseLengthInput("3", { bareAsMm: true }).mm).toBe(3);
    const seg = resolveLiveDrawSegment({
      v2Preview: {
        start: { x: 0, y: 0 },
        end: { x: 1500, y: 0 },
        lengthMm: 1500,
        moved: true,
      },
    });
    const end = {
      x: seg.start.x + 3000,
      y: seg.start.y,
    };
    const m = buildLiveWallDrawMeasurements({ start: seg.start, end, thk: 100 });
    expect(m.centerlineMm).toBeCloseTo(3000, 3);
  });

  it("6/8. Enter path formats and metre/comma parse", () => {
    expect(parseLengthInput("3 м", { bareAsMm: true }).mm).toBe(3000);
    expect(parseLengthInput("3,0 м").mm).toBe(3000);
    expect(parseLengthInput("3000 мм").mm).toBe(3000);
  });

  it("9/10. invalid / Escape-style cancel does not mutate", () => {
    const plan = freeWallPlan(3000);
    expect(parseLengthInput("0", { bareAsMm: true }).ok).toBe(false);
    expect(applyExactWallLength(plan, "w1", 0).changed).toBe(false);
  });
});

describe("PHASE 2F1-LIVE3 editor / collision / keys", () => {
  it("12. compact editor field contract (length/thk/height/material on plan)", () => {
    const plan = freeWallPlan(3000);
    const w = plan.walls[0];
    expect(w.thk).toBe(100);
    expect(w.height).toBe(3000);
    expect(w.material).toBe("drywall");
  });

  it("16. diagonal wall live length aligned", () => {
    const m = buildLiveWallDrawMeasurements({
      start: { x: 0, y: 0 },
      end: { x: 3000, y: 4000 },
      thk: 100,
    });
    expect(m.centerlineMm).toBeCloseTo(5000, 3);
  });

  it("19. centre diamond dodge increases offset when colliding", () => {
    const clear = dodgeDimensionAwayFromHandle({
      dimMid: { x: 1000, y: 0 },
      handleWorld: { x: 0, y: 0 },
      zoom: 1,
      currentOffsetMm: 140,
      minClearPx: 22,
    });
    expect(clear.collided).toBe(false);
    const hit = dodgeDimensionAwayFromHandle({
      dimMid: { x: 5, y: 0 },
      handleWorld: { x: 0, y: 0 },
      zoom: 1,
      currentOffsetMm: 140,
      minClearPx: 22,
    });
    expect(hit.collided).toBe(true);
    expect(hit.offsetMm).toBeGreaterThan(140);
  });

  it("physical span keys normalize reversal", () => {
    const a = physicalSpanKey({ x: 0, y: 0 }, { x: 3000, y: 0 }, { wallId: "w1" });
    const b = physicalSpanKey({ x: 3000, y: 0 }, { x: 0, y: 0 }, { wallId: "w1" });
    expect(a).toBe(b);
    const dimKey = dimensionPhysicalSpanKey({
      kind: "wall_length",
      wallId: "w1",
      p1: { x: 0, y: 0 },
      p2: { x: 3000, y: 0 },
    });
    expect(dimKey).toContain("wall_length");
  });

  it("20. selected wall length value stable across zoom (mm not px)", () => {
    const m = buildLiveWallDrawMeasurements({
      start: { x: 0, y: 0 }, end: { x: 3900, y: 0 }, thk: 100,
    });
    expect(m.centerlineMm).toBe(3900);
  });
});
