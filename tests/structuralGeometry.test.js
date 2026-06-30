import { describe, it, expect } from "vitest";
import { itemHitsStructural, structuralSegmentRect, structuralColumnRect } from "../src/planner/structuralGeometry.js";

describe("structuralGeometry", () => {
  it("detects item overlap with beam segment", () => {
    const beam = { kind: "beam", width: 200, a: { x: 0, y: 0 }, b: { x: 5000, y: 0 } };
    const item = { x: 2400, y: -50, w: 2000, h: 740 };
    expect(itemHitsStructural(item, beam)).toBe(true);
  });

  it("allows placement away from beam", () => {
    const beam = { kind: "beam", width: 200, a: { x: 0, y: 0 }, b: { x: 5000, y: 0 } };
    const item = { x: 2400, y: 800, w: 2000, h: 740 };
    expect(itemHitsStructural(item, beam)).toBe(false);
  });

  it("builds column footprint", () => {
    const fp = structuralColumnRect({ x: 1000, y: 1000 }, 400);
    expect(fp.w).toBe(400);
    expect(fp.polygon).toHaveLength(4);
  });

  it("builds segment footprint", () => {
    const fp = structuralSegmentRect({ x: 0, y: 0 }, { x: 3000, y: 0 }, 500);
    expect(fp.polygon).toHaveLength(4);
  });
});
