import { describe, it, expect } from "vitest";
import { resolveWallPtsList } from "../src/planner/core/walls/wallOps.js";

describe("resolveWallPtsList — network priority over legacy pts", () => {
  it("legacy: wall with only pts resolves from pts", () => {
    const walls = [{ id: "w1", thk: 100, pts: [{ x: 0, y: 0 }, { x: 3000, y: 0 }] }];
    const result = resolveWallPtsList(walls, {});
    expect(result).toHaveLength(1);
    expect(result[0].pts[0]).toEqual({ x: 0, y: 0 });
    expect(result[0].pts[1]).toEqual({ x: 3000, y: 0 });
  });

  it("network: wall with a/b resolves from nodes", () => {
    const walls = [{ id: "w1", thk: 100, a: "nA", b: "nB" }];
    const nodes = { nA: { x: 0, y: 0 }, nB: { x: 5000, y: 0 } };
    const result = resolveWallPtsList(walls, nodes);
    expect(result).toHaveLength(1);
    expect(result[0].pts[0]).toEqual({ x: 0, y: 0 });
    expect(result[0].pts[1]).toEqual({ x: 5000, y: 0 });
  });

  it("network wins: wall with both a/b and stale pts resolves from nodes, not pts", () => {
    const walls = [{
      id: "w1", thk: 100,
      a: "nA", b: "nB",
      pts: [{ x: 99, y: 99 }, { x: 99, y: 99 }],
    }];
    const nodes = { nA: { x: 100, y: 200 }, nB: { x: 400, y: 200 } };
    const result = resolveWallPtsList(walls, nodes);
    expect(result[0].pts[0]).toEqual({ x: 100, y: 200 });
    expect(result[0].pts[1]).toEqual({ x: 400, y: 200 });
  });

  it("mixed plan: resolves both legacy and network walls", () => {
    const walls = [
      { id: "legacy", thk: 100, pts: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] },
      { id: "network", thk: 100, a: "nA", b: "nB" },
    ];
    const nodes = { nA: { x: 2000, y: 0 }, nB: { x: 3000, y: 0 } };
    const result = resolveWallPtsList(walls, nodes);
    expect(result).toHaveLength(2);
    const leg = result.find((w) => w.id === "legacy");
    const net = result.find((w) => w.id === "network");
    expect(leg.pts[0]).toEqual({ x: 0, y: 0 });
    expect(net.pts[0]).toEqual({ x: 2000, y: 0 });
  });

  it("does not mutate input walls or nodes", () => {
    const wall = { id: "w1", thk: 100, a: "nA", b: "nB" };
    const nodes = { nA: { x: 0, y: 0 }, nB: { x: 1000, y: 0 } };
    const wallsBefore = JSON.stringify(wall);
    const nodesBefore = JSON.stringify(nodes);
    resolveWallPtsList([wall], nodes);
    expect(JSON.stringify(wall)).toBe(wallsBefore);
    expect(JSON.stringify(nodes)).toBe(nodesBefore);
  });

  it("wall without a/b and without pts is excluded", () => {
    const walls = [{ id: "w1", thk: 100 }];
    const result = resolveWallPtsList(walls, {});
    expect(result).toHaveLength(0);
  });
});
