import { describe, expect, it } from "vitest";
import {
  dist, near, angleBetweenDeg, normalizeAngleDeg, projectPointToAngle,
  polygonArea, segmentsIntersectProper, snap, clamp,
} from "../src/planner/core/geometry/index.js";

describe("core/geometry", () => {
  it("dist computes hypotenuse", () => {
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it("near respects threshold", () => {
    expect(near({ x: 0, y: 0 }, { x: 50, y: 0 }, 80)).toBe(true);
    expect(near({ x: 0, y: 0 }, { x: 200, y: 0 }, 80)).toBe(false);
  });

  it("snap rounds to grid step", () => {
    expect(snap(123, 50, true)).toBe(100);
    expect(snap(123, 50, false)).toBe(123);
  });

  it("clamp limits value", () => {
    expect(clamp(150, 0, 100)).toBe(100);
  });

  it("angleBetweenDeg for horizontal segment", () => {
    expect(angleBetweenDeg({ x: 0, y: 0 }, { x: 1000, y: 0 })).toBe(0);
    expect(angleBetweenDeg({ x: 0, y: 0 }, { x: 0, y: 1000 })).toBe(90);
  });

  it("normalizeAngleDeg wraps negative", () => {
    expect(normalizeAngleDeg(-90)).toBe(270);
  });

  it("projectPointToAngle projects along axis", () => {
    const p = projectPointToAngle({ x: 0, y: 0 }, 0, 3000);
    expect(p.x).toBeCloseTo(3000);
    expect(p.y).toBeCloseTo(0);
  });

  it("polygonArea for rectangle", () => {
    const poly = [
      { x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }, { x: 0, y: 3000 },
    ];
    expect(polygonArea(poly)).toBeCloseTo(12e6, 0);
  });

  it("segmentsIntersectProper detects crossing", () => {
    const a = { x: 0, y: 0 }; const b = { x: 100, y: 100 };
    const c = { x: 0, y: 100 }; const d = { x: 100, y: 0 };
    expect(segmentsIntersectProper(a, b, c, d)).toBe(true);
  });
});
