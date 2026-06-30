/**
 * ЗАДАЧА 005 — wall.pts не источник истины.
 * Проверяем, что resolvePlanWalls работает для обоих форматов планов.
 */
import { describe, it, expect } from "vitest";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";

describe("resolvePlanWalls — wall data model contract", () => {
  it("legacy: returns wall.pts as-is when plan has no nodes", () => {
    const plan = {
      walls: [
        { id: "w1", thk: 100, pts: [{ x: 0, y: 0 }, { x: 3000, y: 0 }] },
      ],
    };
    const resolved = resolvePlanWalls(plan);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].pts[0]).toEqual({ x: 0, y: 0 });
    expect(resolved[0].pts[1]).toEqual({ x: 3000, y: 0 });
  });

  it("network: derives pts from a/b + nodes, ignores stored wall.pts", () => {
    const plan = {
      nodes: {
        nA: { x: 0, y: 0 },
        nB: { x: 5000, y: 0 },
      },
      walls: [
        {
          id: "w1",
          thk: 100,
          a: "nA",
          b: "nB",
          // pts here is intentionally stale / wrong to confirm it is ignored
          pts: [{ x: 99, y: 99 }, { x: 99, y: 99 }],
        },
      ],
    };
    const resolved = resolvePlanWalls(plan);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].pts[0]).toEqual({ x: 0, y: 0 });
    expect(resolved[0].pts[1]).toEqual({ x: 5000, y: 0 });
  });

  it("network: wall without matching nodes is excluded", () => {
    const plan = {
      nodes: { nA: { x: 0, y: 0 } },
      walls: [{ id: "w1", thk: 100, a: "nA", b: "nMissing" }],
    };
    const resolved = resolvePlanWalls(plan);
    expect(resolved).toHaveLength(0);
  });
});
