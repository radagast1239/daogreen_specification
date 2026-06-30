import { describe, expect, it } from "vitest";
import { computeWallDimChains } from "../src/planner/core/dimensions/index.js";

describe("core/dimensions", () => {
  const room = { w: 12000, h: 8000, wallThk: 200 };
  const walls = [
    {
      id: "w1",
      thk: 100,
      thicknessSide: "center",
      pts: [{ x: 0, y: 2000 }, { x: 4000, y: 2000 }],
    },
  ];

  it("builds dimension chains for straight wall", () => {
    const { chains, overall, thickness } = computeWallDimChains(walls, room, [], {
      showFinishing: true,
      showGross: true,
    });
    expect(chains.length).toBeGreaterThan(0);
    expect(overall.length).toBeGreaterThan(0);
    expect(thickness.length).toBeGreaterThan(0);
    expect(chains[0].len).toBeCloseTo(4000, -1);
  });

  it("overall span matches wall axis length", () => {
    const { overall } = computeWallDimChains(walls, room);
    expect(overall[0].len).toBeCloseTo(4000, -1);
  });
});
