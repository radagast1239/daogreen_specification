/**
 * PHASE 2F1-LIVE2 — zero-value fix + floating editor geometry contracts.
 */
import { describe, it, expect } from "vitest";
import {
  buildLiveWallDrawMeasurements,
  buildLiveWallEditMeasurements,
  resolveLiveDrawSegment,
  assertLiveMeasurementModel,
  parseLengthInput,
  formatLiveLength,
  placeFloatingEditorScreen,
  resolveLengthEditAnchor,
  applyExactWallLength,
  hostJunctionDistances,
  includedCornerAngleDeg,
} from "../src/planner/core/walls/liveWallMeasurements.js";

function freeWallPlan(len = 3900) {
  return {
    room: { w: 20000, h: 16000, wallThk: 100, height: 3000 },
    nodes: {
      a: { id: "a", x: 0, y: 0 },
      b: { id: "b", x: len, y: 0 },
    },
    walls: [
      { id: "w1", a: "a", b: "b", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000 },
    ],
    items: [], lines: [], zones: [], rooms: [], dimensions: [],
  };
}

function oneAttachedPlan() {
  return {
    room: { w: 20000, h: 16000, wallThk: 100, height: 3000 },
    nodes: {
      h0: { id: "h0", x: 0, y: 0 },
      hj: { id: "hj", x: 2000, y: 0 },
      h1: { id: "h1", x: 4000, y: 0 },
      tip: { id: "tip", x: 2000, y: 1500 },
    },
    walls: [
      { id: "hostL", a: "h0", b: "hj", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, chainId: "host" },
      { id: "hostR", a: "hj", b: "h1", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, chainId: "host" },
      { id: "branch", a: "hj", b: "tip", thk: 100, role: "partition", kind: "new", thicknessSide: "center", height: 3000 },
    ],
    items: [], lines: [], zones: [], rooms: [], dimensions: [],
  };
}

function rectanglePlan() {
  return {
    room: { w: 20000, h: 16000, wallThk: 100, height: 3000 },
    nodes: {
      n1: { id: "n1", x: 0, y: 0 },
      n2: { id: "n2", x: 4000, y: 0 },
      n3: { id: "n3", x: 4000, y: 3000 },
      n4: { id: "n4", x: 0, y: 3000 },
    },
    walls: [
      { id: "bottom", a: "n1", b: "n2", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000 },
      { id: "right", a: "n2", b: "n3", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000 },
      { id: "top", a: "n3", b: "n4", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000 },
      { id: "left", a: "n4", b: "n1", thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000 },
    ],
    items: [], lines: [], zones: [], rooms: [], dimensions: [],
  };
}

describe("PHASE 2F1-LIVE2 resolveLiveDrawSegment", () => {
  it("1. a 3.9 m V2 preview never resolves to 0 mm (last+cursor bug)", () => {
    const v2Preview = {
      start: { x: 52000, y: 22000 },
      end: { x: 55900, y: 22000 },
      lengthMm: 3900,
      moved: true,
    };
    // Cursor equals end — the LIVE1 bug path.
    const seg = resolveLiveDrawSegment({
      v2Preview,
      draft: [],
      cursor: { ...v2Preview.end },
    });
    expect(seg.valid).toBe(true);
    expect(seg.lengthMm).toBeCloseTo(3900, 3);
    const m = buildLiveWallDrawMeasurements({
      start: seg.start,
      end: seg.end,
      thk: 100,
    });
    expect(m.centerlineMm).toBeCloseTo(3900, 3);
    expect(formatLiveLength(m.centerlineMm)).toBe("3.90 м");
    expect(m.labels.some((l) => l.text === "0 мм")).toBe(false);
    expect(assertLiveMeasurementModel(m).ok).toBe(true);
  });

  it("2. free-wall live length updates before pointerup (chain path)", () => {
    const a = resolveLiveDrawSegment({
      draft: [{ x: 0, y: 0 }],
      cursor: { x: 1000, y: 0 },
    });
    const b = resolveLiveDrawSegment({
      draft: [{ x: 0, y: 0 }],
      cursor: { x: 3900, y: 0 },
    });
    expect(a.lengthMm).toBe(1000);
    expect(b.lengthMm).toBe(3900);
  });

  it("3. clipped preview length uses the clipped endpoint", () => {
    const seg = resolveLiveDrawSegment({
      v2Preview: {
        start: { x: 0, y: 0 },
        end: { x: 2500, y: 0 },
        lengthMm: 2500,
        moved: true,
      },
    });
    expect(seg.end.x).toBe(2500);
    expect(seg.lengthMm).toBe(2500);
  });

  it("4. undefined angle is hidden, not shown as 0.0°", () => {
    const m = buildLiveWallDrawMeasurements({
      start: { x: 0, y: 0 },
      end: { x: 3900, y: 0 },
      thk: 100,
    });
    expect(m.cornerDeg).toBeNull();
    expect(m.labels.some((l) => l.kind === "corner" || l.kind === "direction")).toBe(false);
    expect(m.labels.some((l) => l.text === "0.0°")).toBe(false);
  });

  it("5. connected wall displays the actual angle", () => {
    expect(includedCornerAngleDeg({ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 })).toBeCloseTo(90, 5);
    const m = buildLiveWallDrawMeasurements({
      start: { x: 1000, y: 0 },
      end: { x: 1000, y: 2000 },
      prevPoint: { x: 0, y: 0 },
      thk: 100,
    });
    expect(m.cornerDeg).toBeCloseTo(90, 5);
    expect(m.labels.some((l) => l.kind === "corner" && /90/.test(l.text))).toBe(true);
  });
});

describe("PHASE 2F1-LIVE2 selection / edit sources", () => {
  it("6. selected committed wall displays its actual length", () => {
    const plan = freeWallPlan(3900);
    const m = buildLiveWallEditMeasurements({
      previewPlan: plan,
      wallId: "w1",
      editKind: "endpoint",
    });
    expect(m.centerlineMm).toBeCloseTo(3900, 3);
    expect(formatLiveLength(m.centerlineMm)).toBe("3.90 м");
  });

  it("7. whole-wall move uses effectivePlan geometry", () => {
    const base = freeWallPlan(3000);
    const moved = {
      ...base,
      nodes: {
        a: { id: "a", x: 0, y: 500 },
        b: { id: "b", x: 3000, y: 500 },
      },
    };
    const m = buildLiveWallEditMeasurements({
      previewPlan: moved,
      basePlan: base,
      wallId: "w1",
      editKind: "wall_move",
    });
    expect(m.a.y).toBe(500);
    expect(m.centerlineMm).toBeCloseTo(3000, 3);
  });

  it("8. endpoint drag uses effectivePlan geometry", () => {
    const base = freeWallPlan(3000);
    const rotated = {
      ...base,
      nodes: { a: base.nodes.a, b: { id: "b", x: 0, y: 3000 } },
    };
    const m = buildLiveWallEditMeasurements({
      previewPlan: rotated,
      wallId: "w1",
      editKind: "rotate",
      selectedEndpoint: 1,
    });
    expect(m.centerlineMm).toBeCloseTo(3000, 3);
    expect(m.b.x).toBe(0);
  });

  it("9/23. T-branch distances use effectivePlan and sum to host total", () => {
    const plan = oneAttachedPlan();
    const slid = {
      ...plan,
      nodes: { ...plan.nodes, tip: { id: "tip", x: 2000, y: 1800 }, hj: { id: "hj", x: 2500, y: 0 } },
      walls: plan.walls,
    };
    // Keep topology: move junction along host
    slid.nodes.hj = { id: "hj", x: 2500, y: 0 };
    slid.nodes.tip = { id: "tip", x: 2500, y: 1800 };
    const host = hostJunctionDistances(slid, "hostL", slid.nodes.hj);
    expect(host.sumOk).toBe(true);
    expect(host.leftMm + host.rightMm).toBeCloseTo(host.totalMm, 5);
    const m = buildLiveWallEditMeasurements({
      previewPlan: slid,
      wallId: "branch",
      editKind: "t_slide",
    });
    expect(m.host).toBeTruthy();
    expect(m.centerlineMm).toBeCloseTo(1800, 3);
  });
});

describe("PHASE 2F1-LIVE2 floating editor / numeric", () => {
  it("10. floating editor placement is near the selected wall midpoint", () => {
    const mid = { x: 2000, y: 1000 };
    const pos = placeFloatingEditorScreen({
      anchorWorld: mid,
      view: { panX: 100, panY: 50, zoom: 0.5 },
      svgRect: { left: 0, top: 0, right: 1600, bottom: 900 },
      width: 200,
      height: 78,
    });
    expect(pos).toBeTruthy();
    expect(pos.left).toBeGreaterThan(0);
    expect(Math.abs(pos.left - (100 + 2000 * 0.5 + 28))).toBeLessThan(250);
  });

  it("12. length input accepts mm and metre formats", () => {
    expect(parseLengthInput("3000").mm).toBe(3000);
    expect(parseLengthInput("3000 мм").mm).toBe(3000);
    expect(parseLengthInput("3 м").mm).toBe(3000);
    expect(parseLengthInput("3.0 м").mm).toBe(3000);
    expect(parseLengthInput("3,0 м").mm).toBe(3000);
  });

  it("13. invalid input does not mutate geometry", () => {
    const plan = freeWallPlan(3900);
    expect(applyExactWallLength(plan, "w1", 0).changed).toBe(false);
    expect(parseLengthInput("0").ok).toBe(false);
  });

  it("14/15. Enter applies one transaction; Escape is preview-only restore", () => {
    const plan = freeWallPlan(3900);
    const applied = applyExactWallLength(plan, "w1", 3000);
    expect(applied.ok).toBe(true);
    expect(applied.changed).toBe(true);
    const preview = applyExactWallLength(plan, "w1", 3000, { previewOnly: true });
    expect(preview.changed).toBe(false);
    expect(preview.plan).toBe(plan);
  });

  it("16. free-wall anchor remains fixed", () => {
    const plan = freeWallPlan(3900);
    const applied = applyExactWallLength(plan, "w1", 3000);
    expect(applied.plan.nodes.a.x).toBe(0);
    expect(applied.plan.nodes.b.x).toBeCloseTo(3000, 3);
  });

  it("17. one-end attachment remains fixed", () => {
    const plan = oneAttachedPlan();
    const before = { ...plan.nodes.hj };
    const applied = applyExactWallLength(plan, "branch", 2000);
    expect(applied.plan.nodes.hj).toEqual(before);
  });

  it("18. double-attached edit is disabled without detachment", () => {
    const plan = rectanglePlan();
    expect(resolveLengthEditAnchor(plan, "bottom").ok).toBe(false);
    expect(applyExactWallLength(plan, "bottom", 5000).changed).toBe(false);
  });

  it("20. preview value equals committed geometry", () => {
    const plan = freeWallPlan(3900);
    const preview = applyExactWallLength(plan, "w1", 3000, { previewOnly: true });
    const committed = applyExactWallLength(plan, "w1", 3000);
    expect(committed.plan.nodes.b.x).toBeCloseTo(preview.preview.point.x, 5);
  });

  it("21/22. zoom/pan/off-origin change placement only, not values", () => {
    const m0 = buildLiveWallDrawMeasurements({ start: { x: 0, y: 0 }, end: { x: 3900, y: 0 }, thk: 100 });
    const m1 = buildLiveWallDrawMeasurements({ start: { x: 1e6, y: 0 }, end: { x: 1e6 + 3900, y: 0 }, thk: 100 });
    expect(m1.centerlineMm).toBeCloseTo(m0.centerlineMm, 5);
    const p0 = placeFloatingEditorScreen({
      anchorWorld: { x: 0, y: 0 },
      view: { panX: 0, panY: 0, zoom: 1 },
      svgRect: { left: 0, top: 0, right: 1000, bottom: 800 },
    });
    const p1 = placeFloatingEditorScreen({
      anchorWorld: { x: 0, y: 0 },
      view: { panX: 40, panY: 10, zoom: 2 },
      svgRect: { left: 0, top: 0, right: 1000, bottom: 800 },
    });
    expect(p1.left).not.toBe(p0.left);
  });

  it("24. endpoint rotation updates length and angle labels", () => {
    const plan = oneAttachedPlan();
    const m = buildLiveWallEditMeasurements({
      previewPlan: plan,
      wallId: "branch",
      editKind: "rotate",
      selectedEndpoint: 1,
    });
    expect(m.labels.some((l) => l.role === "primary")).toBe(true);
    expect(m.centerlineMm).toBeGreaterThan(0);
  });

  it("25. connected wall move reports primary length from preview", () => {
    const plan = rectanglePlan();
    const m = buildLiveWallEditMeasurements({
      previewPlan: plan,
      wallId: "bottom",
      editKind: "wall_move",
    });
    expect(m.centerlineMm).toBeCloseTo(4000, 3);
  });

  it("sub-threshold draw hides labels (no zero paint)", () => {
    const m = buildLiveWallDrawMeasurements({
      start: { x: 0, y: 0 },
      end: { x: 0.2, y: 0 },
      thk: 100,
    });
    expect(m.labels).toEqual([]);
    expect(m.valid).toBe(false);
  });
});
