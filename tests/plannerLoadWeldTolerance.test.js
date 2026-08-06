import { describe, expect, it } from "vitest";
import { normalizePlan, PLAN_LOAD_WELD_MM } from "../src/planner/planNormalize.js";
import { normalizeWallNetwork } from "../src/planner/core/walls/wallCommands.js";

const clone = (value) => JSON.parse(JSON.stringify(value));

function networkPlan(gapMm, overrides = {}) {
  return {
    nodes: {
      a: { x: 0, y: 0 },
      b: { x: 1000, y: 0 },
      c: { x: 1000, y: gapMm },
      d: { x: 2000, y: gapMm },
    },
    walls: [
      { id: "w1", a: "a", b: "b", thk: 100 },
      { id: "w2", a: "c", b: "d", thk: 100 },
    ],
    ...overrides,
  };
}

function nodeIds(plan) {
  return Object.keys(plan.nodes || {}).sort();
}

function edgeFingerprint(plan) {
  return (plan.walls || []).map((wall) => ({
    id: wall.id,
    a: wall.a,
    b: wall.b,
    from: plan.nodes[wall.a],
    to: plan.nodes[wall.b],
  })).sort((left, right) => left.id.localeCompare(right.id));
}

describe("plan-load node weld tolerance", () => {
  it("1. welds 0.5 mm persisted drift during ordinary load", () => {
    const plan = normalizePlan(networkPlan(0.5));
    expect(nodeIds(plan)).toEqual(["a", "b", "d"]);
    expect(plan.walls[1].a).toBe("b");
  });

  it("2. welds exactly 1 mm because the load boundary is inclusive", () => {
    expect(PLAN_LOAD_WELD_MM).toBe(1);
    const plan = normalizePlan(networkPlan(1));
    expect(nodeIds(plan)).toEqual(["a", "b", "d"]);
    expect(plan.walls[1].a).toBe("b");
  });

  it("3. preserves nodes separated by 1.01 mm", () => {
    const plan = normalizePlan(networkPlan(1.01));
    expect(nodeIds(plan)).toEqual(["a", "b", "c", "d"]);
    expect(plan.walls[1].a).toBe("c");
  });

  it("4. preserves nodes separated by 40 mm", () => {
    expect(nodeIds(normalizePlan(networkPlan(40)))).toEqual(["a", "b", "c", "d"]);
  });

  it("5. preserves nodes separated by 71 mm", () => {
    expect(nodeIds(normalizePlan(networkPlan(71)))).toEqual(["a", "b", "c", "d"]);
  });

  it("6. preserves nodes separated by 85 mm", () => {
    expect(nodeIds(normalizePlan(networkPlan(85)))).toEqual(["a", "b", "c", "d"]);
  });

  it("7. preserves nodes separated by 86 mm", () => {
    expect(nodeIds(normalizePlan(networkPlan(86)))).toEqual(["a", "b", "c", "d"]);
  });

  it("8. keeps two parallel walls 71 mm apart as four nodes and two distinct edges", () => {
    const raw = {
      nodes: {
        a1: { x: 0, y: 0 }, b1: { x: 1000, y: 0 },
        a2: { x: 0, y: 71 }, b2: { x: 1000, y: 71 },
      },
      walls: [
        { id: "parallel-1", a: "a1", b: "b1", thk: 100 },
        { id: "parallel-2", a: "a2", b: "b2", thk: 100 },
      ],
    };
    const plan = normalizePlan(raw);
    expect(nodeIds(plan)).toEqual(["a1", "a2", "b1", "b2"]);
    expect(plan.walls).toHaveLength(2);
    expect(new Set(plan.walls.map((wall) => `${wall.a}:${wall.b}`)).size).toBe(2);
    expect(edgeFingerprint(plan)).toMatchObject([
      { id: "parallel-1", from: { x: 0, y: 0 }, to: { x: 1000, y: 0 } },
      { id: "parallel-2", from: { x: 0, y: 71 }, to: { x: 1000, y: 71 } },
    ]);
  });

  it("9. remaps genuine sub-millimetre duplicates without leaving zero-length walls", () => {
    const plan = normalizePlan(networkPlan(0.25));
    expect(plan.walls.map((wall) => [wall.a, wall.b])).toEqual([["a", "b"], ["b", "d"]]);
    expect(plan.walls.every((wall) => wall.a !== wall.b)).toBe(true);
    expect(nodeIds(plan)).toEqual(["a", "b", "d"]);
  });

  it("10. keeps explicit repair welding at the 85 mm interaction tolerance", () => {
    let id = 0;
    const repaired = normalizeWallNetwork(networkPlan(71), (prefix) => `${prefix}${++id}`).plan;
    expect(nodeIds(repaired)).toEqual(["a", "b", "d"]);
    expect(repaired.walls[1].a).toBe("b");
  });

  it("11. ordinary load does not inherit the 85 mm repair weld", () => {
    const loaded = normalizePlan(networkPlan(84.999));
    expect(nodeIds(loaded)).toEqual(["a", "b", "c", "d"]);
    expect(loaded.walls[1].a).toBe("c");
  });

  it("12. preserves separated node and wall IDs", () => {
    const loaded = normalizePlan(networkPlan(71));
    expect(nodeIds(loaded)).toEqual(["a", "b", "c", "d"]);
    expect(loaded.walls.map(({ id, a, b }) => ({ id, a, b }))).toEqual([
      { id: "w1", a: "a", b: "b" },
      { id: "w2", a: "c", b: "d" },
    ]);
  });

  it("13. does not mutate the persisted input plan", () => {
    const raw = networkPlan(0.5);
    const snapshot = clone(raw);
    normalizePlan(raw);
    expect(raw).toEqual(snapshot);
  });

  it("14. preserves the canonical wall fingerprint with a 71 mm gap after serialize/reload", () => {
    const once = normalizePlan(networkPlan(71));
    const fingerprint = edgeFingerprint(once);
    const reloaded = normalizePlan(JSON.parse(JSON.stringify(once)));
    expect(edgeFingerprint(reloaded)).toEqual(fingerprint);
    expect(nodeIds(reloaded)).toEqual(["a", "b", "c", "d"]);
  });

  it("15. loads a legacy pts-only plan without weld metadata", () => {
    const legacy = {
      walls: [{ id: "legacy", pts: [{ x: 0, y: 0 }, { x: 2000, y: 0 }] }],
    };
    const loaded = normalizePlan(legacy);
    expect(loaded.walls).toHaveLength(1);
    expect(nodeIds(loaded)).toHaveLength(2);
    expect(loaded.walls[0]).toMatchObject({ id: "legacy", thk: 100, role: "partition" });
    expect(loaded).not.toHaveProperty("planLoadWeldMm");
  });
});
