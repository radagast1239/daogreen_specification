import { describe, expect, it } from "vitest";
import { computeWallDimChains } from "../src/planner/wallDimChains.js";

describe("wall dim chains", () => {
  const room = { w: 12000, h: 8000, wallThk: 100 };

  it("builds chain segments along a straight wall", () => {
    const walls = [{
      id: "w1",
      thk: 100,
      thicknessSide: "center",
      pts: [{ x: 0, y: 2000 }, { x: 4000, y: 2000 }],
    }];
    const { chains, overall } = computeWallDimChains(walls, room, []);
    expect(chains.length).toBeGreaterThan(0);
    expect(overall.length).toBe(1);
    expect(Math.round(overall[0].len)).toBeCloseTo(4000, -2);
  });

  it("splits chain at door opening", () => {
    const walls = [{
      id: "w1",
      thk: 100,
      thicknessSide: "center",
      pts: [{ x: 0, y: 2000 }, { x: 4000, y: 2000 }],
    }];
    const items = [{
      id: "d1",
      kind: "door",
      x: 1750,
      y: 1940,
      w: 900,
      h: 120,
      wallId: "w1",
    }];
    const { chains } = computeWallDimChains(walls, room, items);
    const finishing = chains.filter((c) => c.kind === "finishing");
    expect(finishing.length).toBeGreaterThan(1);
  });
});
