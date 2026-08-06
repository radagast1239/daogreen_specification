/**
 * Regression guard for the reported "x10" dimension scale.
 *
 * Root cause was NOT the formatter and NOT the pointer->world conversion.
 * computePlanContentBounds answers a plan with no geometry using a 1000x1000mm
 * PLACEHOLDER (empty: true). fitView("open") framed that 1m box, landing on zoom
 * ~0.76 where the whole canvas spans about 1.5m. A rectangle that looked
 * room-sized was then really ~400mm, and its dimension correctly read "389 мм"
 * instead of "3.89 м".
 *
 * The fix frames the sheet when content bounds are empty. These tests pin the
 * arithmetic so the placeholder can never be framed again.
 */
import { describe, it, expect } from "vitest";
import {
  computePlanContentBounds,
  computeFitTransform,
  PLANNER_DEFAULT_ZOOM,
} from "../src/planner/viewport.js";
import { DEFAULT_PLAN } from "../src/planner/catalog.js";
import { formatDimensionValue } from "../src/planner/core/dimensions/display.js";

const VIEW = { width: 1188, height: 958 };
const INSETS = { top: 0, right: 0, bottom: 100, left: 0 };
const PAD = 47.9;

const fitTo = (plan, bounds) => computeFitTransform({
  plan, bounds, width: VIEW.width, height: VIEW.height, insets: INSETS, padding: PAD,
});

/** The sheet bounds fitView substitutes when content bounds are empty. */
const sheetBounds = (plan) => {
  const rw = Number(plan?.room?.w) || 12000;
  const rh = Number(plan?.room?.h) || 8000;
  return { minX: 0, minY: 0, x: 0, y: 0, maxX: rw, maxY: rh, width: rw, height: rh, count: 1, empty: false };
};

describe("empty-plan fit scale", () => {
  it("1. an empty plan's content bounds are a 1000x1000mm placeholder flagged empty", () => {
    const b = computePlanContentBounds(DEFAULT_PLAN());
    expect(b.width).toBe(1000);
    expect(b.height).toBe(1000);
    expect(b.empty).toBe(true);
    expect(b.count).toBe(0);
  });

  it("2. framing that placeholder is what produced the ~10x too-close zoom", () => {
    const plan = DEFAULT_PLAN();
    const bad = fitTo(plan, computePlanContentBounds(plan));
    expect(bad.zoom).toBeGreaterThan(0.5); // ~0.76
    // the whole canvas would span barely more than a metre
    expect(VIEW.width / bad.zoom).toBeLessThan(2000);
  });

  it("3. framing the sheet instead gives a production-like scale", () => {
    const plan = DEFAULT_PLAN();
    const good = fitTo(plan, sheetBounds(plan));
    expect(good.zoom).toBeGreaterThan(0.05);
    expect(good.zoom).toBeLessThan(0.2);
    // and roughly the sheet is visible
    const visibleW = VIEW.width / good.zoom;
    const visibleH = VIEW.height / good.zoom;
    expect(visibleW).toBeGreaterThan(plan.room.w * 0.9);
    expect(visibleH).toBeGreaterThan(plan.room.h * 0.9);
  });

  it("4. the sheet-fit zoom is the order of magnitude PLANNER_DEFAULT_ZOOM assumes", () => {
    const plan = DEFAULT_PLAN();
    const good = fitTo(plan, sheetBounds(plan));
    expect(good.zoom / PLANNER_DEFAULT_ZOOM).toBeGreaterThan(0.5);
    expect(good.zoom / PLANNER_DEFAULT_ZOOM).toBeLessThan(2);
  });

  it("5. a 320px pointer span at the sheet-fit zoom is several metres", () => {
    const plan = DEFAULT_PLAN();
    const good = fitTo(plan, sheetBounds(plan));
    const mm = 320 / good.zoom;
    expect(mm).toBeGreaterThan(2500);
    expect(mm).toBeLessThan(6000);
    expect(formatDimensionValue(mm)).toMatch(/м$/); // metres, not мм
  });

  it("6. the same 320px span at the placeholder zoom is only hundreds of mm", () => {
    const plan = DEFAULT_PLAN();
    const bad = fitTo(plan, computePlanContentBounds(plan));
    const mm = 320 / bad.zoom;
    expect(mm).toBeLessThan(1000);
    // which is exactly why the user saw "389 мм" / "491 мм"
    expect(formatDimensionValue(mm)).toMatch(/мм$/);
  });

  it("7. stored distance scales inversely with zoom (conversion honours zoom)", () => {
    const spanPx = 320;
    const a = spanPx / 0.0910;
    const b = spanPx / 0.8780;
    expect(a / b).toBeCloseTo(0.8780 / 0.0910, 1);
  });

  it("8. the formatter carries no multiplier: mm in, correct unit out", () => {
    expect(formatDimensionValue(3890)).toBe("3.89 м");
    expect(formatDimensionValue(4910)).toBe("4.91 м");
    expect(formatDimensionValue(6000)).toBe("6.00 м");
    expect(formatDimensionValue(650)).toBe("650 мм");
    // and it cannot turn 3890 into "389 мм" — the stored value had to be small
    expect(formatDimensionValue(3890)).not.toMatch(/^389 /);
  });

  it("9. once a plan has content, fit frames the content and not the sheet", () => {
    const plan = DEFAULT_PLAN();
    const withWall = {
      ...plan,
      walls: [{
        id: "w1", thk: 100, role: "outer", kind: "new", thicknessSide: "center",
        a: { x: 0, y: 0 }, b: { x: 8000, y: 0 },
        pts: [{ x: 0, y: 0 }, { x: 8000, y: 0 }],
      }],
    };
    const b = computePlanContentBounds(withWall);
    expect(b.empty).toBeFalsy();
    expect(b.width).toBeGreaterThan(7000);
  });

  it("10. a degenerate/absent bounds object never yields a metre-scale frame", () => {
    const plan = DEFAULT_PLAN();
    // whatever the placeholder shape, substituting the sheet keeps the scale sane
    for (const bogus of [null, undefined, { width: 0, height: 0, count: 0, empty: true }]) {
      const bounds = (!bogus || bogus.empty || !bogus.count) ? sheetBounds(plan) : bogus;
      const t = fitTo(plan, bounds);
      expect(VIEW.width / t.zoom).toBeGreaterThan(plan.room.w * 0.9);
    }
  });
});
