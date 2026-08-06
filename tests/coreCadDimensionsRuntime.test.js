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
  // Regression for the old facade-chain behaviour: a plain rectangle used to
  // fragment its exterior into a chain of 300/600-offset segments instead of one
  // overall span per axis. The current contract is a single external_overall per
  // axis, with no automatic chain kind and no fragmentation from internal walls.
  it("exterior is a single overall span per axis, not a chain, and is unaffected by internal partitions", () => {
    const outerWalls = [
      { id: "w1", pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }], thk: 100 },
      { id: "w2", pts: [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }], thk: 100 },
      { id: "w3", pts: [{ x: 4000, y: 3000 }, { x: 0, y: 3000 }], thk: 100 },
      { id: "w4", pts: [{ x: 0, y: 3000 }, { x: 0, y: 0 }], thk: 100 },
    ];

    const plan = basePlan();
    plan.walls = outerWalls;
    const out = generateWallDimensions(plan, { dimensionDisplayMode: "remplanner_cm" });
    const linear = out.dimensions.filter((d) => d.mode === "linear");

    // no duplicate spans (still a valid invariant of the new generator)
    const keys = linear.map((d) => `${d.kind}:${d.orientation}:${Math.round(Math.min(d.p1.x, d.p2.x))}-${Math.round(Math.max(d.p1.x, d.p2.x))}-${Math.round(Math.min(d.p1.y, d.p2.y))}-${Math.round(Math.max(d.p1.y, d.p2.y))}`);
    expect(keys.length).toBe(new Set(keys).size);

    // automatic facade chaining is gone: no chain kind at all
    expect(out.dimensions.some((d) => d.kind === "external_chain")).toBe(false);

    // exactly one horizontal and one vertical overall
    const ext = out.dimensions.filter((d) => d.kind === "external_overall");
    expect(ext.filter((d) => d.orientation === "horizontal")).toHaveLength(1);
    expect(ext.filter((d) => d.orientation === "vertical")).toHaveLength(1);
    const extH = ext.find((d) => d.orientation === "horizontal");
    const extV = ext.find((d) => d.orientation === "vertical");
    const spanOf = (d) => Math.hypot(d.p2.x - d.p1.x, d.p2.y - d.p1.y);
    expect(Math.round(spanOf(extH))).toBe(4100); // outer face to outer face (4000 + thk)
    expect(Math.round(spanOf(extV))).toBe(3100);

    // adding an internal partition must not change the overall span or fragment it
    const withPartition = basePlan();
    withPartition.walls = [
      ...outerWalls,
      { id: "w5", pts: [{ x: 2000, y: 0 }, { x: 2000, y: 3000 }], thk: 100 },
    ];
    const out2 = generateWallDimensions(withPartition, { dimensionDisplayMode: "remplanner_cm" });
    const ext2 = out2.dimensions.filter((d) => d.kind === "external_overall");
    expect(ext2.filter((d) => d.orientation === "horizontal")).toHaveLength(1);
    expect(ext2.filter((d) => d.orientation === "vertical")).toHaveLength(1);
    const ext2H = ext2.find((d) => d.orientation === "horizontal");
    const ext2V = ext2.find((d) => d.orientation === "vertical");
    expect(Math.round(spanOf(ext2H))).toBe(Math.round(spanOf(extH)));
    expect(Math.round(spanOf(ext2V))).toBe(Math.round(spanOf(extV)));
    expect(out2.dimensions.some((d) => d.kind === "external_chain")).toBe(false);
  });

  it("no room_meta/room_width/room_height dims generated (labels handled by ZoneEl)", () => {
    const plan = basePlan();
    plan.zones = [{ id: "zn1", x: 0, y: 0, w: 2500, h: 3680, height: 3000 }];
    const out = generateWallDimensions(plan, { dimensionDisplayMode: "remplanner_cm" });
    expect(out.dimensions.find((d) => d.kind === "room_meta")).toBeUndefined();
    expect(out.dimensions.find((d) => d.kind === "room_width")).toBeUndefined();
    expect(out.dimensions.find((d) => d.kind === "room_height")).toBeUndefined();
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
