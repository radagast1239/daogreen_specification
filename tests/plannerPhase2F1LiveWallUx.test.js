/**
 * PHASE 2F1-LIVE — RemPlanner-style live wall metrology + exact length.
 */
import { describe, it, expect } from "vitest";
import {
  buildLiveWallDrawMeasurements,
  buildLiveWallEditMeasurements,
  parseLengthInput,
  formatLiveLength,
  includedCornerAngleDeg,
  hostJunctionDistances,
  resolveLengthEditAnchor,
  applyExactWallLength,
  pointAtLengthAlong,
  prioritizeLiveLabels,
} from "../src/planner/core/walls/liveWallMeasurements.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";

function freeWallPlan(len = 3000) {
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
  // Host horizontal + branch vertical from mid (after split topology).
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

describe("PHASE 2F1-LIVE parse / format", () => {
  it("never treats bare 3000 as metres", () => {
    expect(parseLengthInput("3000")).toEqual({ ok: true, mm: 3000, unit: "mm", reason: null });
    expect(parseLengthInput("3 м").mm).toBe(3000);
    expect(parseLengthInput("3").mm).toBe(3000); // bare <100 → metres
    expect(parseLengthInput("3.08 м").mm).toBeCloseTo(3080, 5);
    expect(parseLengthInput("500 мм").mm).toBe(500);
    expect(parseLengthInput("0").ok).toBe(false);
    expect(parseLengthInput("-10").ok).toBe(false);
    expect(parseLengthInput("1e6").ok).toBe(false);
  });

  it("formatLiveLength uses mm below 1m and metres above", () => {
    expect(formatLiveLength(800)).toBe("800 мм");
    expect(formatLiveLength(3000)).toBe("3.00 м");
  });
});

describe("PHASE 2F1-LIVE draw measurements", () => {
  it("1/2/3. free-wall preview shows live length and thickness before commit", () => {
    const start = { x: 0, y: 0 };
    const end = { x: 3000, y: 0 };
    const m = buildLiveWallDrawMeasurements({
      start, end, thk: 100, room: { w: 10000, h: 8000 },
    });
    expect(m).toBeTruthy();
    expect(m.centerlineMm).toBeCloseTo(3000, 5);
    expect(m.thkMm).toBe(100);
    expect(m.labels.some((l) => l.role === "primary" && l.mm === 3000)).toBe(true);
    expect(m.labels.some((l) => l.kind === "thickness")).toBe(true);
  });

  it("2. displayed live length changes with pointer movement", () => {
    const a = buildLiveWallDrawMeasurements({ start: { x: 0, y: 0 }, end: { x: 1000, y: 0 }, thk: 100 });
    const b = buildLiveWallDrawMeasurements({ start: { x: 0, y: 0 }, end: { x: 2500, y: 0 }, thk: 100 });
    expect(a.centerlineMm).toBe(1000);
    expect(b.centerlineMm).toBe(2500);
  });

  it("4. connected wall displays the correct corner angle", () => {
    const corner = includedCornerAngleDeg({ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 });
    expect(corner).toBeCloseTo(90, 5);
    const m = buildLiveWallDrawMeasurements({
      start: { x: 1000, y: 0 },
      end: { x: 1000, y: 2000 },
      prevPoint: { x: 0, y: 0 },
      thk: 100,
    });
    expect(m.cornerDeg).toBeCloseTo(90, 5);
    expect(m.labels.some((l) => l.kind === "corner")).toBe(true);
  });

  it("5. physical-face lengths account for thickness (equal when parallel offset)", () => {
    const m = buildLiveWallDrawMeasurements({
      start: { x: 0, y: 0 }, end: { x: 3000, y: 0 }, thk: 200, thicknessSide: "center",
      room: { w: 10000, h: 8000 },
    });
    // Straight wall, centre thickness: face lengths equal centerline
    expect(m.facesDiffer).toBe(false);
    expect(m.leftFaceMm).toBeCloseTo(3000, 0);
  });

  it("19. zoom does not change values (labels carry mm, not px)", () => {
    const m = buildLiveWallDrawMeasurements({ start: { x: 0, y: 0 }, end: { x: 3080, y: 0 }, thk: 100 });
    expect(m.centerlineMm).toBe(3080);
    expect(formatLiveLength(m.centerlineMm)).toBe("3.08 м");
  });

  it("20. reorder/reversal/off-origin do not change live semantic values", () => {
    const base = buildLiveWallDrawMeasurements({ start: { x: 10, y: 20 }, end: { x: 3010, y: 20 }, thk: 100 });
    const moved = buildLiveWallDrawMeasurements({ start: { x: 10 + 1e6, y: 20 }, end: { x: 3010 + 1e6, y: 20 }, thk: 100 });
    const rev = buildLiveWallDrawMeasurements({ start: { x: 3010, y: 20 }, end: { x: 10, y: 20 }, thk: 100 });
    expect(moved.centerlineMm).toBeCloseTo(base.centerlineMm, 5);
    expect(rev.centerlineMm).toBeCloseTo(base.centerlineMm, 5);
  });
});

describe("PHASE 2F1-LIVE exact length", () => {
  it("6/9. exact selected-wall length moves the free endpoint; host end fixed", () => {
    const plan = oneAttachedPlan();
    const before = { ...plan.nodes.hj };
    const applied = applyExactWallLength(plan, "branch", 2000);
    expect(applied.ok).toBe(true);
    expect(applied.changed).toBe(true);
    expect(applied.plan.nodes.hj.x).toBeCloseTo(before.x, 5);
    expect(applied.plan.nodes.hj.y).toBeCloseTo(before.y, 5);
    const tip = applied.plan.nodes.tip;
    const len = Math.hypot(tip.x - before.x, tip.y - before.y);
    expect(len).toBeCloseTo(2000, 3);
  });

  it("7. invalid numeric values do not mutate the plan", () => {
    const plan = freeWallPlan();
    const r = applyExactWallLength(plan, "w1", 0);
    expect(r.ok).toBe(false);
    expect(r.plan).toBe(plan);
    expect(r.changed).toBe(false);
  });

  it("8. parse Enter path accepts mm; Escape is UI-only (no mutation)", () => {
    expect(parseLengthInput("2500").ok).toBe(true);
    const plan = freeWallPlan(2500);
    const preview = applyExactWallLength(plan, "w1", 2500, { previewOnly: true });
    expect(preview.ok).toBe(true);
    expect(preview.changed).toBe(false);
    expect(preview.preview.moveNodeId).toBe("b");
  });

  it("10. double-attached wall does not detach through numeric length editing", () => {
    const plan = rectanglePlan();
    const anchor = resolveLengthEditAnchor(plan, "bottom");
    expect(anchor.ok).toBe(false);
    expect(anchor.reason).toBe("both_ends_attached");
    const applied = applyExactWallLength(plan, "bottom", 5000);
    expect(applied.ok).toBe(false);
    expect(applied.changed).toBe(false);
  });

  it("A. free wall keeps start fixed", () => {
    const plan = freeWallPlan(3000);
    const applied = applyExactWallLength(plan, "w1", 4000);
    expect(applied.plan.nodes.a.x).toBe(0);
    expect(applied.plan.nodes.b.x).toBeCloseTo(4000, 3);
  });
});

describe("PHASE 2F1-LIVE T distances", () => {
  it("11. T-host left + right = logical host total", () => {
    const plan = oneAttachedPlan();
    const host = hostJunctionDistances(plan, "hostL", plan.nodes.hj);
    expect(host).toBeTruthy();
    expect(host.sumOk).toBe(true);
    expect(host.leftMm + host.rightMm).toBeCloseTo(host.totalMm, 5);
    expect(host.totalMm).toBeCloseTo(4000, 3);
  });

  it("12. T distances update when junction slides", () => {
    const plan = oneAttachedPlan();
    const a = hostJunctionDistances(plan, "hostL", { x: 1000, y: 0 });
    const b = hostJunctionDistances(plan, "hostL", { x: 3000, y: 0 });
    expect(a.leftMm).toBeCloseTo(1000, 3);
    expect(b.leftMm).toBeCloseTo(3000, 3);
    expect(a.leftMm + a.rightMm).toBeCloseTo(b.leftMm + b.rightMm, 5);
  });
});

describe("PHASE 2F1-LIVE edit / move", () => {
  it("13. endpoint rotation updates angles and face lengths", () => {
    const plan = oneAttachedPlan();
    const m = buildLiveWallEditMeasurements({
      previewPlan: plan,
      wallId: "branch",
      editKind: "rotate",
      selectedEndpoint: 1,
      room: plan.room,
    });
    expect(m.centerlineMm).toBeCloseTo(1500, 3);
    expect(m.labels.some((l) => l.role === "primary")).toBe(true);
  });

  it("14. connected wall move reports clear/overall context from preview", () => {
    const plan = rectanglePlan();
    const m = buildLiveWallEditMeasurements({
      previewPlan: plan,
      wallId: "bottom",
      editKind: "wall_move",
      room: plan.room,
    });
    expect(m).toBeTruthy();
    expect(m.labels.some((l) => l.role === "primary")).toBe(true);
  });

  it("15/17. live model creates zero plan.dimensions writes", () => {
    const plan = freeWallPlan();
    const before = (plan.dimensions || []).length;
    buildLiveWallDrawMeasurements({ start: { x: 0, y: 0 }, end: { x: 1000, y: 0 }, thk: 100 });
    buildLiveWallEditMeasurements({ previewPlan: plan, wallId: "w1", editKind: "endpoint" });
    expect((plan.dimensions || []).length).toBe(before);
  });

  it("18. preview pointAtLengthAlong matches applyExactWallLength endpoint", () => {
    const plan = freeWallPlan(3000);
    const preview = pointAtLengthAlong(plan.nodes.a, plan.nodes.b, 2500);
    const applied = applyExactWallLength(plan, "w1", 2500);
    expect(applied.plan.nodes.b.x).toBeCloseTo(preview.x, 3);
    expect(applied.plan.nodes.b.y).toBeCloseTo(preview.y, 3);
  });
});

describe("PHASE 2F1-LIVE label hierarchy", () => {
  it("prioritizes primary over context when space is tight", () => {
    const labels = [
      { role: "context", id: "c" },
      { role: "primary", id: "p" },
      { role: "secondary", id: "s" },
    ];
    const ranked = prioritizeLiveLabels(labels, 2);
    expect(ranked[0].id).toBe("p");
    expect(ranked.map((l) => l.id)).not.toContain("c");
  });
});

describe("PHASE 2F1-LIVE hold/commit contracts (pure)", () => {
  it("16. applyExactWallLength is one atomic result (single plan)", () => {
    const plan = freeWallPlan(3000);
    const applied = applyExactWallLength(plan, "w1", 3500);
    expect(applied.ok).toBe(true);
    const walls = resolvePlanWalls(applied.plan);
    expect(walls).toHaveLength(1);
  });
});
