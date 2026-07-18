/**
 * PHASE 1B-1B — classifyWallLengthDimension / resolveFixedEndpointForPoint
 * (leaf UI helper, no React/DOM).
 */
import { describe, it, expect } from "vitest";
import {
  classifyWallLengthDimension,
  resolveFixedEndpointForPoint,
  WALL_PARTIAL_DIMENSION_MESSAGE,
  ITEM_DIMENSION_MESSAGE,
} from "../src/planner/ui/wallLengthDimensionMapping.js";

function wallPlan(a, b, extraWalls = [], extraNodes = {}) {
  return {
    room: { w: 8000, h: 6000 },
    nodes: { na: { x: a.x, y: a.y }, nb: { x: b.x, y: b.y }, ...extraNodes },
    walls: [{ id: "w1", a: "na", b: "nb", thk: 150 }, ...extraWalls],
    items: [],
    dimensions: [],
    rooms: [],
    zones: [],
  };
}

describe("PHASE 1B-1B — classifyWallLengthDimension: dimension type routing", () => {
  it("manual (unattached) dimension", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const dim = { id: "d1", attachedTo: null };
    expect(classifyWallLengthDimension(dim, plan)).toEqual({ kind: "manual" });
  });

  it("dimension with no attachedTo key at all is treated as manual", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    expect(classifyWallLengthDimension({ id: "d1" }, plan)).toEqual({ kind: "manual" });
  });

  it("item-attached dimension", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const dim = { id: "d1", attachedTo: { type: "item", id: "rack-1" } };
    expect(classifyWallLengthDimension(dim, plan)).toEqual({ kind: "item" });
  });

  it("unknown attachedTo.type falls back to manual (safe default, unchanged existing UX)", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const dim = { id: "d1", attachedTo: { type: "rack_pair", ids: ["a", "b"] } };
    expect(classifyWallLengthDimension(dim, plan)).toEqual({ kind: "manual" });
  });
});

describe("PHASE 1B-1B — classifyWallLengthDimension: full-wall detection", () => {
  it("t0=0,t1=1 on a horizontal wall: full-wall, point1=a, point2=b", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const dim = { id: "d1", attachedTo: { type: "wall", wallId: "w1", segIndex: 0, t0: 0, t1: 1 } };
    const result = classifyWallLengthDimension(dim, plan);
    expect(result).toMatchObject({ kind: "wall-full", wallId: "w1", currentLengthMm: 4000, point1Endpoint: "a", point2Endpoint: "b" });
  });

  it("t0=1,t1=0 (reversed dimension direction): full-wall, point1=b, point2=a", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const dim = { id: "d1", attachedTo: { type: "wall", wallId: "w1", segIndex: 0, t0: 1, t1: 0 } };
    const result = classifyWallLengthDimension(dim, plan);
    expect(result).toMatchObject({ kind: "wall-full", point1Endpoint: "b", point2Endpoint: "a" });
  });

  it("diagonal wall: currentLengthMm computed via hypot", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 3000, y: 4000 });
    const dim = { id: "d1", attachedTo: { type: "wall", wallId: "w1", segIndex: 0, t0: 0, t1: 1 } };
    const result = classifyWallLengthDimension(dim, plan);
    expect(result.kind).toBe("wall-full");
    expect(result.currentLengthMm).toBe(5000);
  });

  it("reversed wall orientation (a on the right of b) still maps point1/point2 correctly", () => {
    const plan = wallPlan({ x: 4000, y: 0 }, { x: 0, y: 0 });
    const dim = { id: "d1", attachedTo: { type: "wall", wallId: "w1", segIndex: 0, t0: 0, t1: 1 } };
    const result = classifyWallLengthDimension(dim, plan);
    expect(result).toMatchObject({ kind: "wall-full", point1Endpoint: "a", point2Endpoint: "b", currentLengthMm: 4000 });
  });

  it("resolves the wall via attachedTo.id when both id and wallId are present, matching resolveAttachedDimension's own precedence", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 }, [{ id: "w2", a: "na", b: "nb", thk: 100 }]);
    const dim = { id: "d1", attachedTo: { type: "wall", id: "w1", wallId: "w2", segIndex: 0, t0: 0, t1: 1 } };
    const result = classifyWallLengthDimension(dim, plan);
    expect(result.wallId).toBe("w1");
  });
});

describe("PHASE 1B-1B — classifyWallLengthDimension: partial/unsupported cases", () => {
  it("partial t0/t1 range is not treated as full-wall", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const dim = { id: "d1", attachedTo: { type: "wall", wallId: "w1", segIndex: 0, t0: 0.25, t1: 0.75 } };
    expect(classifyWallLengthDimension(dim, plan)).toEqual({ kind: "wall-partial" });
  });

  it("missing wallId reference", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const dim = { id: "d1", attachedTo: { type: "wall", wallId: "ghost", segIndex: 0, t0: 0, t1: 1 } };
    expect(classifyWallLengthDimension(dim, plan)).toEqual({ kind: "wall-partial" });
  });

  it("wall missing canonical a/b (legacy pts-only shape)", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    plan.walls = [{ id: "w1", pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }], thk: 150 }];
    const dim = { id: "d1", attachedTo: { type: "wall", wallId: "w1", segIndex: 0, t0: 0, t1: 1 } };
    expect(classifyWallLengthDimension(dim, plan)).toEqual({ kind: "wall-partial" });
  });

  it("missing t0/t1 (loosely-associated attachment)", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const dim = { id: "d1", attachedTo: { type: "wall", wallId: "w1" } };
    expect(classifyWallLengthDimension(dim, plan)).toEqual({ kind: "wall-partial" });
  });

  it("segIndex !== 0 (legacy multi-segment wall) is treated as ambiguous, not full-wall", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const dim = { id: "d1", attachedTo: { type: "wall", wallId: "w1", segIndex: 1, t0: 0, t1: 1 } };
    expect(classifyWallLengthDimension(dim, plan)).toEqual({ kind: "wall-partial" });
  });

  it("degenerate wall (non-finite node coordinates)", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    plan.nodes.nb = { x: NaN, y: 0 };
    const dim = { id: "d1", attachedTo: { type: "wall", wallId: "w1", segIndex: 0, t0: 0, t1: 1 } };
    expect(classifyWallLengthDimension(dim, plan)).toEqual({ kind: "wall-partial" });
  });

  it("exposes the exact required user-facing messages", () => {
    expect(WALL_PARTIAL_DIMENSION_MESSAGE).toBe("Изменение длины участка стены пока не поддерживается. Выберите размер всей стены.");
    expect(ITEM_DIMENSION_MESSAGE).toBe("Изменение размера предмета по размерной линии пока не поддерживается.");
  });
});

describe("PHASE 1B-1B — default anchor policy (node degree)", () => {
  it("shared A, free B: default fixed endpoint is A", () => {
    // w2 also uses na -> na has degree 2 (shared), nb has degree 1 (free).
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 }, [{ id: "w2", a: "na", b: "nc", thk: 100 }], { nc: { x: 0, y: 3000 } });
    const dim = { id: "d1", attachedTo: { type: "wall", wallId: "w1", segIndex: 0, t0: 0, t1: 1 } };
    const result = classifyWallLengthDimension(dim, plan);
    expect(result.defaultFixedEndpoint).toBe("a");
  });

  it("shared B, free A: default fixed endpoint is B", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 }, [{ id: "w2", a: "nb", b: "nc", thk: 100 }], { nc: { x: 4000, y: 3000 } });
    const dim = { id: "d1", attachedTo: { type: "wall", wallId: "w1", segIndex: 0, t0: 0, t1: 1 } };
    const result = classifyWallLengthDimension(dim, plan);
    expect(result.defaultFixedEndpoint).toBe("b");
  });

  it("both endpoints free: default falls back to point 1", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const dim = { id: "d1", attachedTo: { type: "wall", wallId: "w1", segIndex: 0, t0: 1, t1: 0 } }; // point1 = b
    const result = classifyWallLengthDimension(dim, plan);
    expect(result.point1Endpoint).toBe("b");
    expect(result.defaultFixedEndpoint).toBe("b");
  });

  it("both endpoints shared: default falls back to point 1", () => {
    const plan = wallPlan(
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      [
        { id: "w2", a: "na", b: "nc", thk: 100 },
        { id: "w3", a: "nb", b: "nd", thk: 100 },
      ],
      { nc: { x: 0, y: 3000 }, nd: { x: 4000, y: 3000 } },
    );
    const dim = { id: "d1", attachedTo: { type: "wall", wallId: "w1", segIndex: 0, t0: 0, t1: 1 } }; // point1 = a
    const result = classifyWallLengthDimension(dim, plan);
    expect(result.point1Endpoint).toBe("a");
    expect(result.defaultFixedEndpoint).toBe("a");
  });
});

describe("PHASE 1B-1B — resolveFixedEndpointForPoint", () => {
  it("maps point 1 and point 2 to their respective endpoints", () => {
    const classification = { kind: "wall-full", point1Endpoint: "a", point2Endpoint: "b" };
    expect(resolveFixedEndpointForPoint(1, classification)).toBe("a");
    expect(resolveFixedEndpointForPoint(2, classification)).toBe("b");
  });

  it("respects a reversed point1/point2 mapping", () => {
    const classification = { kind: "wall-full", point1Endpoint: "b", point2Endpoint: "a" };
    expect(resolveFixedEndpointForPoint(1, classification)).toBe("b");
    expect(resolveFixedEndpointForPoint(2, classification)).toBe("a");
  });

  it("returns null for a non-wall-full classification", () => {
    expect(resolveFixedEndpointForPoint(1, { kind: "wall-partial" })).toBeNull();
    expect(resolveFixedEndpointForPoint(1, { kind: "manual" })).toBeNull();
    expect(resolveFixedEndpointForPoint(1, { kind: "item" })).toBeNull();
  });
});
