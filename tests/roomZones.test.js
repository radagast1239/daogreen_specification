import { describe, expect, it } from "vitest";
import { findClosedLoops, filterRoomLoops } from "../src/planner/wallGeometry.js";

describe("filterRoomLoops", () => {
  const outerWalls = [
    { id: "w1", pts: [{ x: 0, y: 0 }, { x: 12000, y: 0 }], thk: 120 },
    { id: "w2", pts: [{ x: 12000, y: 0 }, { x: 12000, y: 8000 }], thk: 120 },
    { id: "w3", pts: [{ x: 12000, y: 8000 }, { x: 0, y: 8000 }], thk: 120 },
    { id: "w4", pts: [{ x: 0, y: 8000 }, { x: 0, y: 0 }], thk: 120 },
  ];

  it("collapses spurious multi-loops in one undivided room to a single envelope", () => {
    const loops = findClosedLoops(outerWalls);
    const filtered = filterRoomLoops(loops, outerWalls);
    expect(filtered.length).toBe(1);
  });

  it("keeps separate rooms when an internal partition exists", () => {
    const walls = [
      ...outerWalls,
      { id: "p1", pts: [{ x: 6000, y: 0 }, { x: 6000, y: 8000 }], thk: 100, role: "partition" },
    ];
    const loops = findClosedLoops(walls);
    const filtered = filterRoomLoops(loops, walls);
    expect(filtered.length).toBeGreaterThanOrEqual(2);
  });
});
