import { describe, expect, it } from "vitest";
import {
  formatDimensionValue,
  generateWallDimensions,
  resolvePlanDimensions,
} from "../src/planner/core/dimensions/index.js";

function basePlan() {
  return {
    room: { w: 4000, h: 3000, height: 2700 },
    nodes: {},
    walls: [],
    items: [],
    zones: [],
    dimensions: [],
  };
}

describe("dimension formatting modes", () => {
  it("formats in remplanner mode for normal and room-chain labels", () => {
    expect(formatDimensionValue(850, "remplanner_cm")).toBe("850 мм");
    expect(formatDimensionValue(2350, "remplanner_cm")).toBe("2.35 м");
    expect(formatDimensionValue(2500, "remplanner_cm", { roomChain: true })).toBe("250");
  });

  it("formats in explicit mm/cm/m modes", () => {
    expect(formatDimensionValue(850, "mm")).toBe("850 мм");
    expect(formatDimensionValue(850, "cm")).toBe("85 см");
    expect(formatDimensionValue(2350, "m")).toBe("2.35 м");
  });
});

describe("generateWallDimensions", () => {
  it("builds exterior chains with 300/600 offsets", () => {
    const plan = basePlan();
    plan.walls = [
      { id: "w1", pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }], thk: 100 },
      { id: "w2", pts: [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }], thk: 100 },
      { id: "w3", pts: [{ x: 4000, y: 3000 }, { x: 0, y: 3000 }], thk: 100 },
      { id: "w4", pts: [{ x: 0, y: 3000 }, { x: 0, y: 0 }], thk: 100 },
    ];
    const out = generateWallDimensions(plan, { dimensionDisplayMode: "remplanner_cm" });
    const overall = out.dimensions.filter((d) => d.kind === "external_overall");
    expect(overall.length).toBe(2);
    expect(overall.some((d) => Math.abs(d.offset) === 600)).toBe(true);
    expect(out.dimensions.some((d) => d.kind === "external_segment" && Math.abs(d.offset) === 300)).toBe(true);
  });

  it("generates internal room chain labels in remplanner centimeters", () => {
    const plan = basePlan();
    plan.zones = [{ id: "zn1", x: 0, y: 0, w: 2500, h: 3680, height: 3000 }];
    const out = generateWallDimensions(plan, { dimensionDisplayMode: "remplanner_cm" });
    const rw = out.dimensions.find((d) => d.kind === "room_width");
    const rh = out.dimensions.find((d) => d.kind === "room_height");
    expect(rw?.labelOverride).toBe("250");
    expect(rh?.labelOverride).toBe("368");
  });

  it("creates aisle warning when rack gap is below 700 mm", () => {
    const plan = basePlan();
    plan.items = [
      { id: "r1", kind: "rack", layer: "racks", x: 0, y: 0, w: 1000, h: 600 },
      { id: "r2", kind: "rack", layer: "racks", x: 1600, y: 0, w: 1000, h: 600 },
    ];
    const out = generateWallDimensions(plan, { dimensionDisplayMode: "mm" });
    expect(out.dimensions.some((d) => d.kind === "rack_aisle")).toBe(true);
    expect(out.validationWarnings.length).toBeGreaterThan(0);
    expect(out.validationWarnings[0].text).toContain("600");
  });
});

describe("resolvePlanDimensions manual dimensions", () => {
  it("keeps manual dimensions and updates attached wall references", () => {
    const plan = basePlan();
    plan.walls = [{ id: "w1", pts: [{ x: 0, y: 0 }, { x: 2000, y: 0 }], thk: 100 }];
    plan.dimensions = [{
      id: "d1",
      type: "dimension",
      mode: "linear",
      p1: { x: 0, y: 0 },
      p2: { x: 1000, y: 0 },
      offset: 120,
      orientation: "horizontal",
      attachedTo: { type: "wall", id: "w1", segIndex: 0, t0: 0.25, t1: 0.75 },
      labelOverride: null,
      locked: false,
    }];
    const first = resolvePlanDimensions(plan, { dimensionDisplayMode: "mm" });
    expect(first.manual.length).toBe(1);
    expect(first.manual[0].invalid).toBe(false);
    expect(first.manual[0].p1.x).toBeCloseTo(500, 1);
    expect(first.manual[0].p2.x).toBeCloseTo(1500, 1);

    plan.walls = [{ id: "w1", pts: [{ x: 0, y: 0 }, { x: 3000, y: 0 }], thk: 100 }];
    const second = resolvePlanDimensions(plan, { dimensionDisplayMode: "mm" });
    expect(second.manual[0].p1.x).toBeCloseTo(750, 1);
    expect(second.manual[0].p2.x).toBeCloseTo(2250, 1);
  });

  it("marks manual dimension invalid when attached object disappears", () => {
    const plan = basePlan();
    plan.dimensions = [{
      id: "d2",
      type: "dimension",
      mode: "linear",
      p1: { x: 0, y: 0 },
      p2: { x: 1000, y: 0 },
      offset: 100,
      orientation: "horizontal",
      attachedTo: { type: "item", id: "missing-item", mode: "bbox-width" },
      labelOverride: null,
      locked: false,
    }];
    const out = resolvePlanDimensions(plan, { dimensionDisplayMode: "mm" });
    expect(out.manual[0].invalid).toBe(true);
  });
});
