import { describe, expect, it } from "vitest";
import {
  computeAngleArcGeometry, computeDimensionLabelPosition, computeLinearDimensionGeometry,
  hitTestDimension, normalizeDimensionStyle,
} from "../src/planner/core/dimensions/index.js";

const vertex = { x: 0, y: 0 };
const ray = (degrees, length = 1000) => ({
  x: Math.cos(degrees * Math.PI / 180) * length,
  y: Math.sin(degrees * Math.PI / 180) * length,
});
const angle = (degrees) => computeAngleArcGeometry({ vertex, ray1: ray(0), ray2: ray(degrees), radius: 100 });

describe("dimension rendering geometry", () => {
  it.each([0, 45, 90, 135, 180])("computes %d° minor arc", (degrees) => {
    const got = angle(degrees);
    expect(got.valid).toBe(true);
    expect(got.angle).toBeCloseTo(degrees, 8);
    expect(got.points[0]).toEqual(got.start);
    expect(got.points.at(-1).x).toBeCloseTo(got.end.x, 8);
    expect(got.points.at(-1).y).toBeCloseTo(got.end.y, 8);
  });

  it("reversed rays produce the same canonical arc", () => {
    const a = computeAngleArcGeometry({ vertex, ray1: ray(20), ray2: ray(155), radius: 100 });
    const b = computeAngleArcGeometry({ vertex, ray1: ray(155), ray2: ray(20), radius: 100 });
    expect({ angle: b.angle, start: b.start, end: b.end, points: b.points }).toEqual({ angle: a.angle, start: a.start, end: a.end, points: a.points });
  });

  it("computes horizontal and vertical dimension lines and extensions", () => {
    const h = computeLinearDimensionGeometry({ p1: { x: 0, y: 0 }, p2: { x: 1000, y: 0 }, offset: 100 });
    const v = computeLinearDimensionGeometry({ p1: { x: 0, y: 0 }, p2: { x: 0, y: 1000 }, offset: 100 });
    expect(h.dimensionLine).toEqual({ a: { x: 0, y: 100 }, b: { x: 1000, y: 100 } });
    expect(v.dimensionLine).toEqual({ a: { x: -100, y: 0 }, b: { x: -100, y: 1000 } });
    expect(h.extensionLines).toHaveLength(2);
  });

  it("computes true diagonal length and readable label rotation", () => {
    const got = computeLinearDimensionGeometry({ mode: "diagonal", p1: vertex, p2: { x: 3000, y: 4000 } });
    expect(got.type).toBe("diagonal");
    expect(got.length).toBe(5000);
    expect(got.textAngleDeg).toBeCloseTo(53.130102);
  });

  it("reversed linear anchors preserve length and physical dimension line", () => {
    const a = computeLinearDimensionGeometry({ p1: { x: 0, y: 0 }, p2: { x: 1000, y: 0 }, offset: 100 });
    const b = computeLinearDimensionGeometry({ p1: { x: 1000, y: 0 }, p2: { x: 0, y: 0 }, offset: -100 });
    expect(b.length).toBe(a.length);
    expect([b.dimensionLine.a, b.dimensionLine.b]).toEqual([a.dimensionLine.b, a.dimensionLine.a]);
  });

  it("places label at dimension offset", () => {
    const geometry = computeLinearDimensionGeometry({ p1: vertex, p2: { x: 1000, y: 0 }, offset: 200 });
    const label = computeDimensionLabelPosition(geometry, { label: "1000" });
    expect(label.position).toEqual({ x: 500, y: 200 });
  });

  // LIVE4.5 contract: a label never escapes perpendicular to its dimension line.
  // Perpendicular escape was what produced zoom-dependent label drift, so an
  // intersecting wall must leave the label exactly on the dimension line.
  it("keeps a label on the dimension line even when a wall intersects it", () => {
    const geometry = computeLinearDimensionGeometry({ p1: vertex, p2: { x: 1000, y: 0 }, offset: 100 });
    const label = computeDimensionLabelPosition(geometry, { label: "1000", walls: [{ pts: [{ x: 0, y: 100 }, { x: 1000, y: 100 }] }] });
    expect(label.shifted).toBe(false);
    expect(label.alongDisplacementMm).toBe(0);
    expect(label.position).toEqual({ x: 500, y: 100 });
    expect(label.position).toEqual(label.lineMidpoint);
  });

  it("displaces a label only along the dimension line, never across it", () => {
    const geometry = computeLinearDimensionGeometry({ p1: vertex, p2: { x: 0, y: 1000 }, offset: 100 });
    const label = computeDimensionLabelPosition(geometry, { label: "1000", alongDisplacementMm: 120 });
    expect(label.shifted).toBe(true);
    // Vertical wall -> dimension line runs along y; displacement must not touch x.
    expect(label.position.x).toBe(label.lineMidpoint.x);
    expect(label.position.y).toBeCloseTo(label.lineMidpoint.y + 120, 9);
  });

  it.each([0.25, 1, 4])("hit area is screen invariant at zoom %s", (zoom) => {
    const geometry = computeLinearDimensionGeometry({ p1: vertex, p2: { x: 1000, y: 0 }, offset: 0, zoom });
    const inside = hitTestDimension(geometry, { x: 500, y: 8 / zoom }, { zoom });
    const outside = hitTestDimension(geometry, { x: 500, y: 12 / zoom }, { zoom });
    expect(inside.hit).toBe(true);
    expect(inside.screenDistancePx).toBeCloseTo(8);
    expect(outside.hit).toBe(false);
  });

  // LIVE4.5 contract: "short" is a model-millimetre property of the wall, not a
  // screen-pixel one, and a short dimension still centres its label on the
  // dimension line (the knockout renders it legibly instead of pushing it out).
  it("short dimensions keep geometry and keep the label on the dimension line", () => {
    const got = computeLinearDimensionGeometry({ p1: vertex, p2: { x: 20, y: 0 }, offset: 0, zoom: 1 });
    expect(got.valid).toBe(true);
    expect(got.short).toBe(true);
    expect(got.labelBase).toEqual({
      x: (got.dimensionLine.a.x + got.dimensionLine.b.x) / 2,
      y: (got.dimensionLine.a.y + got.dimensionLine.b.y) / 2,
    });
  });

  it.each([0.25, 1, 4])("shortness is zoom-independent at zoom %s", (zoom) => {
    expect(computeLinearDimensionGeometry({ p1: vertex, p2: { x: 20, y: 0 }, offset: 0, zoom }).short).toBe(true);
    expect(computeLinearDimensionGeometry({ p1: vertex, p2: { x: 1000, y: 0 }, offset: 0, zoom }).short).toBe(false);
  });

  it("invalid and zero-length inputs do not throw", () => {
    expect(() => computeLinearDimensionGeometry({ p1: null, p2: vertex })).not.toThrow();
    expect(computeLinearDimensionGeometry({ p1: vertex, p2: vertex })).toMatchObject({ valid: false, code: "DIMENSION_ZERO_LENGTH" });
    expect(computeAngleArcGeometry({ vertex, ray1: vertex, ray2: ray(90) })).toMatchObject({ valid: false, code: "DIMENSION_ZERO_LENGTH_RAY" });
    expect(hitTestDimension({ valid: false }, vertex)).toEqual({ hit: false, distance: Infinity });
  });

  it("normalizes style without mutating input", () => {
    const input = { hitSlopPx: 12, arcSegments: 999, color: "red" };
    const snapshot = structuredClone(input);
    const got = normalizeDimensionStyle(input);
    expect(got).toMatchObject({ hitSlopPx: 12, arcSegments: 256, color: "red" });
    expect(input).toEqual(snapshot);
  });

  it("geometry is deterministic and inputs are not mutated", () => {
    const input = { p1: { x: 10, y: 20 }, p2: { x: 300, y: 420 }, offset: -75, zoom: 4, style: { tickSizePx: 10 } };
    const snapshot = structuredClone(input);
    expect(computeLinearDimensionGeometry(input)).toEqual(computeLinearDimensionGeometry(input));
    expect(input).toEqual(snapshot);
  });

  it("angle hit-testing follows the arc", () => {
    const geometry = angle(90);
    expect(hitTestDimension(geometry, ray(45, 100), { zoom: 1 }).hit).toBe(true);
    expect(hitTestDimension(geometry, ray(45, 120), { zoom: 1 }).hit).toBe(false);
  });

  it("performance stays within core budget", () => {
    const started = performance.now();
    for (let i = 0; i < 10000; i++) {
      computeLinearDimensionGeometry({ p1: vertex, p2: { x: 1000 + i, y: i % 500 }, offset: 120, zoom: 1 });
    }
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
