import { describe, expect, it } from "vitest";
import {
  clampPlannerZoom, computeFitTransform, computePlanContentBounds,
  createViewportInsets, shouldAutoFitPlan,
} from "../src/planner/viewport.js";

const rect = { nodes: { a: { x: 0, y: 0 }, b: { x: 10000, y: 0 }, c: { x: 10000, y: 6000 }, d: { x: 0, y: 6000 } },
  walls: [{ a: "a", b: "b" }, { a: "b", b: "c" }, { a: "c", b: "d" }, { a: "d", b: "a" }] };

describe("Planner viewport bounds", () => {
  it("handles an empty plan with a useful deterministic default", () => {
    expect(computePlanContentBounds({})).toEqual(computePlanContentBounds({}));
    expect(computePlanContentBounds({})).toMatchObject({ width: 1000, height: 1000, empty: true });
  });
  it("handles a single node and zero-size geometry", () => {
    const b = computePlanContentBounds({ nodes: { only: { x: 25, y: -10 } } });
    expect(b).toMatchObject({ minX: 25, maxX: 25, minY: -10, maxY: -10, count: 1 });
    expect(computeFitTransform({ bounds: b, width: 1280, height: 720 }).zoom).toBe(3);
  });
  it("collects rectangle network nodes", () => expect(computePlanContentBounds(rect)).toMatchObject({ minX: 0, minY: 0, maxX: 10000, maxY: 6000 }));
  it("collects rotated irregular and diagonal geometry", () => {
    const b = computePlanContentBounds({ walls: [{ pts: [{ x: -1200, y: 900 }, { x: 3500, y: -2200 }, { x: 7800, y: 4100 }] }], items: [{ x: 8000, y: 5000, w: 2000, h: 1000, angle: 45 }] });
    expect(b.minX).toBe(-1200); expect(b.minY).toBe(-2200); expect(b.maxX).toBeGreaterThan(10000);
  });
  it("supports legacy pts and mixed legacy/network walls", () => {
    const b = computePlanContentBounds({ nodes: { a: { x: 5000, y: 5000 }, b: { x: 7000, y: 6000 } }, walls: [{ pts: [{ x: -50, y: 20 }, { x: 100, y: 40 }] }, { a: "a", b: "b" }] });
    expect(b).toMatchObject({ minX: -50, maxX: 7000, maxY: 6000 });
  });
  it("includes openings outside centerline and rotated object extents", () => {
    const b = computePlanContentBounds({ walls: [{ pts: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] }], doors: [{ x: 900, y: -400, w: 600, h: 200, angle: 30 }], windows: [{ x: -500, y: 100, w: 200, h: 800 }] });
    expect(b.minX).toBeLessThanOrEqual(-500); expect(b.maxX).toBeGreaterThan(1400);
  });
  it("includes dimension offset and extension endpoints", () => {
    const b = computePlanContentBounds({ dimensions: [{ p1: { x: 0, y: 0 }, p2: { x: 1000, y: 0 }, offset: -450 }] });
    expect(b).toMatchObject({ minY: -450, maxX: 1000 });
  });
  it("includes extraDimensions (runtime auto-generated wall/overall dims are not part of plan.dimensions)", () => {
    const walls = { nodes: { a: { x: 0, y: 0 }, b: { x: 2500, y: 0 }, c: { x: 2500, y: 1900 }, d: { x: 0, y: 1900 } },
      walls: [{ a: "a", b: "b" }, { a: "b", b: "c" }, { a: "c", b: "d" }, { a: "d", b: "a" }] };
    const withoutExtra = computePlanContentBounds(walls);
    const extraDimensions = [{ p1: { x: 0, y: 0 }, p2: { x: 2500, y: 0 }, offset: -600 }];
    const withExtra = computePlanContentBounds(walls, { extraDimensions });
    expect(withExtra.minY).toBeLessThan(withoutExtra.minY);
    expect(withExtra.minY).toBe(-600);
  });
  it("includes imported background only when it has real bounds", () => {
    const b = computePlanContentBounds({ room: { backdrop: { dataUrl: "data:image/png", x: -100, y: -200, w: 5000, h: 3000 } } });
    expect(b).toMatchObject({ minX: -100, minY: -200, maxX: 4900, maxY: 2800 });
    expect(computePlanContentBounds({ room: { backdrop: { dataUrl: "x" } } }).empty).toBe(true);
  });
  it("ignores corrupt coordinates without throwing", () => {
    const b = computePlanContentBounds({ nodes: { bad: { x: NaN, y: Infinity }, good: { x: 1, y: 2 } }, walls: [null, { pts: [{ x: "no", y: 3 }] }] });
    expect(b).toMatchObject({ minX: 1, minY: 2, count: 1 });
  });
});

describe("Planner fit transform", () => {
  it.each([[1920, 1080], [1440, 900], [1280, 720], [390, 844], [768, 1024]])("fits and centers at %dx%d", (width, height) => {
    const fit = computeFitTransform({ plan: rect, width, height, padding: 32 });
    const centerX = fit.panX + 5000 * fit.zoom, centerY = fit.panY + 3000 * fit.zoom;
    expect(centerX).toBeCloseTo(width / 2); expect(centerY).toBeCloseTo(height / 2);
    expect(fit.zoom).toBeGreaterThanOrEqual(.01); expect(fit.zoom).toBeLessThanOrEqual(3);
  });
  it("centers in available area with a 340px inspector", () => {
    const fit = computeFitTransform({ plan: rect, width: 1920, height: 1080, insets: { inspector: 340 } });
    expect(fit.panX + 5000 * fit.zoom).toBeCloseTo((1920 - 340) / 2);
  });
  it("accounts for the left rail and top bar", () => {
    const insets = createViewportInsets({ leftRail: 72, topbar: 56 });
    const fit = computeFitTransform({ plan: rect, width: 1280, height: 720, insets });
    expect(fit.panX + 5000 * fit.zoom).toBeCloseTo(72 + (1280 - 72) / 2);
    expect(fit.panY + 3000 * fit.zoom).toBeCloseTo(56 + (720 - 56) / 2);
  });
  it("keeps padding in screen pixels", () => {
    const a = computeFitTransform({ plan: rect, width: 1920, height: 1080, padding: 50 });
    const b = computeFitTransform({ plan: { walls: [{ pts: [{ x: 0, y: 0 }, { x: 20000, y: 0 }, { x: 20000, y: 12000 }] }] }, width: 1920, height: 1080, padding: 50 });
    expect(a.zoom).toBeCloseTo(b.zoom * 2);
  });
  it("clamps minimum and maximum zoom", () => {
    expect(clampPlannerZoom(-1)).toBe(.01); expect(clampPlannerZoom(99)).toBe(3);
    expect(computeFitTransform({ bounds: { minX: 0, minY: 0, width: 1e9, height: 1e9 }, width: 390, height: 844 }).zoom).toBe(.01);
  });
  it("returns stable output", () => {
    const args = { plan: rect, width: 1440, height: 900, insets: { right: 340 }, reason: "open" };
    expect(computeFitTransform(args)).toEqual(computeFitTransform(args));
  });
});

describe("Planner auto-fit policy", () => {
  it("fits once per identity, not on ordinary renders", () => {
    expect(shouldAutoFitPlan({}, { identity: "A", hasGeometry: true }, "open")).toBe(true);
    expect(shouldAutoFitPlan({ identity: "A", hasGeometry: true, fitted: true }, { identity: "A", hasGeometry: true }, "render")).toBe(false);
  });
  it("manual viewport prevents unwanted re-fit and resize", () => {
    expect(shouldAutoFitPlan({ identity: "A", manual: true }, { identity: "A", hasGeometry: true }, "resize")).toBe(false);
  });
  it("project A to B triggers fit", () => expect(shouldAutoFitPlan({ identity: "A", fitted: true }, { identity: "B", hasGeometry: true }, "open")).toBe(true));
  it("B to A in a new session triggers fit", () => expect(shouldAutoFitPlan({}, { identity: "A", hasGeometry: true }, "open")).toBe(true));
  it("fits when geometry first appears and on explicit import/fit", () => {
    expect(shouldAutoFitPlan({ identity: "A", hasGeometry: false }, { identity: "A", hasGeometry: true }, "edit")).toBe(true);
    expect(shouldAutoFitPlan({ identity: "A", manual: true }, { identity: "A" }, "fit-button")).toBe(true);
    expect(shouldAutoFitPlan({ identity: "A", manual: true }, { identity: "A" }, "import")).toBe(true);
  });
  it("does not fit after selection, autosave, inspector, wall or node edits", () => {
    for (const reason of ["selection", "autosave", "inspector", "wall-edit", "move-node", "resize"]) {
      expect(shouldAutoFitPlan({ identity: "A", fitted: true }, { identity: "A", hasGeometry: true }, reason)).toBe(false);
    }
  });
  it("stays linear on a large plan", () => {
    const walls = Array.from({ length: 25000 }, (_, i) => ({ pts: [{ x: i, y: i % 1000 }, { x: i + 10, y: (i + 1) % 1000 }] }));
    const start = performance.now(); const b = computePlanContentBounds({ walls });
    expect(b.count).toBe(50000); expect(performance.now() - start).toBeLessThan(1000);
  });
});
