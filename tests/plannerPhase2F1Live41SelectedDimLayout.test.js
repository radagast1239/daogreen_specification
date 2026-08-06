/**
 * PHASE 2F1-LIVE4.1 — near-wall selected dims + open-L exterior face values.
 */
import { describe, it, expect } from "vitest";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";
import {
  nearWallLaneOffsetMm,
  dimensionClearanceMmForActiveCluster,
  NEAR_LANE_MAX_PX,
  NEAR_LANE_MIN_PX,
} from "../src/planner/core/viewport/gripScale.js";
import {
  chooseLabelTAlongWall,
  buildDimLineKnockouts,
  dimLineSegmentsFromKnockouts,
  layoutSelectedFaceDimension,
} from "../src/planner/core/dimensions/selectedDimLayout.js";
import {
  openChainExteriorOffsetForWall,
  openChainExteriorFaceSpan,
} from "../src/planner/core/walls/selectedWallPhysicalSpans.js";
import { generateWallDimensions } from "../src/planner/core/dimensions/generateWallDimensions.js";

function openLInBusyPlan() {
  return {
    room: { w: 40000, h: 30000, wallThk: 100, height: 3000 },
    nodes: {
      a: { id: "a", x: 20000, y: 10000 },
      b: { id: "b", x: 24000, y: 10000 },
      c: { id: "c", x: 24000, y: 13000 },
      r1: { id: "r1", x: 0, y: 0 },
      r2: { id: "r2", x: 4000, y: 0 },
      r3: { id: "r3", x: 4000, y: 3000 },
      r4: { id: "r4", x: 0, y: 3000 },
    },
    walls: [
      { id: "wh", a: "a", b: "b", thk: 100, height: 3000, role: "outer", kind: "new", thicknessSide: "center" },
      { id: "wv", a: "b", b: "c", thk: 100, height: 3000, role: "outer", kind: "new", thicknessSide: "center" },
      { id: "w1", a: "r1", b: "r2", thk: 100, height: 3000, role: "outer", kind: "new", thicknessSide: "center" },
      { id: "w2", a: "r2", b: "r3", thk: 100, height: 3000, role: "outer", kind: "new", thicknessSide: "center" },
      { id: "w3", a: "r3", b: "r4", thk: 100, height: 3000, role: "outer", kind: "new", thicknessSide: "center" },
      { id: "w4", a: "r4", b: "r1", thk: 100, height: 3000, role: "outer", kind: "new", thicknessSide: "center" },
    ],
    items: [], lines: [], zones: [], rooms: [], dimensions: [],
  };
}

describe("LIVE4.1 near-wall lane", () => {
  it("lane stays within 14–40 screen px across zooms", () => {
    for (const z of [0.15, 0.25, 0.55, 1, 1.5]) {
      const mm = nearWallLaneOffsetMm(z);
      const px = mm * z;
      expect(px).toBeGreaterThanOrEqual(NEAR_LANE_MIN_PX - 0.01);
      expect(px).toBeLessThanOrEqual(NEAR_LANE_MAX_PX + 0.01);
    }
  });

  it("clearance no longer floors at 200+ mm", () => {
    const far = dimensionClearanceMmForActiveCluster(0.2, {
      clusterRadiusPx: 56,
      textPadPx: 22,
      minMm: 240,
    });
    expect(far).toBeLessThan(220); // was max(240, 390)=390
    expect(far * 0.2).toBeLessThanOrEqual(NEAR_LANE_MAX_PX + 0.01);
  });

  it("labelT shifts off mid when cluster occupies centre", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 4000, y: 0 };
    const mid = { x: 2000, y: 0 };
    const t = chooseLabelTAlongWall({
      a, b, zoom: 0.5, occupyWorld: mid, clearPx: 30,
    });
    expect([0.25, 0.75]).toContain(t);
  });

  it("knockout splits dim line into multiple segments", () => {
    const dimA = { x: 0, y: 100 };
    const dimB = { x: 4000, y: 100 };
    const gaps = buildDimLineKnockouts({
      dimA,
      dimB,
      zoom: 0.5,
      labelT: 0.25,
      labelHalfPx: 30,
      clusterWorld: { x: 2000, y: 100 },
      clusterRadiusPx: 40,
    });
    expect(gaps.length).toBeGreaterThanOrEqual(1);
    const segs = dimLineSegmentsFromKnockouts(dimA, dimB, gaps);
    expect(segs.length).toBeGreaterThanOrEqual(2);
  });

  it("layoutSelectedFaceDimension keeps lanePx ≤ max", () => {
    const layout = layoutSelectedFaceDimension({
      a: { x: 0, y: 0 },
      b: { x: 3000, y: 0 },
      zoom: 0.4,
      offsetSide: -1,
      midWorld: { x: 1500, y: 0 },
    });
    expect(layout.lanePx).toBeLessThanOrEqual(NEAR_LANE_MAX_PX + 0.01);
    expect(layout.segments.length).toBeGreaterThanOrEqual(1);
  });
});

describe("LIVE4.1 open-L exterior face value", () => {
  it("picks face farther from elbow centroid", () => {
    const plan = openLInBusyPlan();
    const resolved = { ...plan, walls: resolvePlanWalls(plan) };
    const h = openChainExteriorFaceSpan(resolved, "wh");
    expect(h?.reason).toBe("open_chain");
    expect(h.lengthMm).toBeGreaterThan(0);
    // Horizontal a→b at y=10000, vertical down to y=13000 → elbow below.
    // Exterior for horizontal is above (smaller y) = face with mid farther from centroid.
    const midY = (h.a.y + h.b.y) / 2;
    expect(midY).toBeLessThan(h.chainCentroid.y);
  });

  it("closed room walls are not open_chain", () => {
    const plan = openLInBusyPlan();
    const resolved = { ...plan, walls: resolvePlanWalls(plan) };
    const closed = openChainExteriorOffsetForWall(resolved, "w1");
    expect(closed?.reason).toBe("closed_loop");
    expect(openChainExteriorFaceSpan(resolved, "w1")).toBeNull();
  });

  it("generated open-L wall_length uses exterior face length", () => {
    const plan = openLInBusyPlan();
    const resolved = { ...plan, walls: resolvePlanWalls(plan) };
    const { dimensions: dims } = generateWallDimensions(resolved, {});
    const whDim = (dims || []).find((d) => (
      d.kind === "wall_length" && (d.reference?.wallId === "wh" || String(d.id).includes("-wh-"))
    ));
    expect(whDim).toBeTruthy();
    const face = openChainExteriorFaceSpan(resolved, "wh");
    expect(Math.abs(whDim.measurementValue - face.lengthMm)).toBeLessThan(2);
    // Lane outside: offset sign matches open exterior.
    expect(Math.sign(whDim.offset)).toBe(Math.sign(face.offsetMm));
  });
});
