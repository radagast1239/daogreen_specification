/**
 * PHASE 2F1-LIVE4 addendum — adaptive grid, grip scale, camera zoom, open-L.
 */
import { describe, it, expect } from "vitest";
import {
  GRID_STEP_FAMILY,
  chooseMinorGridStepMm,
  chooseMajorGridStepMm,
  resolveAdaptiveGrid,
  adaptiveGridCssBackground,
  cursorCenteredZoomView,
  resolveViewportLod,
} from "../src/planner/core/grid/adaptiveGrid.js";
import {
  zoomResponsiveGripRadiusPx,
  gripHitRadiusWorld,
  dimensionClearanceMmForActiveCluster,
  GRIP_HIT_MIN_PX,
} from "../src/planner/core/viewport/gripScale.js";
import { openChainExteriorOffsetForWall } from "../src/planner/core/walls/selectedWallPhysicalSpans.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";
import { generateWallDimensions } from "../src/planner/core/dimensions/generateWallDimensions.js";

describe("LIVE4 adaptive grid", () => {
  it("1/5. hierarchical minor/major from 1–2–5 family", () => {
    const minor = chooseMinorGridStepMm(0.25);
    expect(GRID_STEP_FAMILY).toContain(minor);
    const major = chooseMajorGridStepMm(minor);
    expect(major % minor === 0 || major / minor === 5 || major / minor === 10).toBe(true);
    const g = resolveAdaptiveGrid({ zoom: 0.25, panX: 0, panY: 0 }, {});
    expect(g.visible).toBe(true);
    expect(g.majorMm).toBeGreaterThan(g.minorMm);
  });

  it("2. world anchored during pan (CSS position tracks pan)", () => {
    const a = resolveAdaptiveGrid({ zoom: 0.5, panX: 0, panY: 0 }, {});
    const b = resolveAdaptiveGrid({ zoom: 0.5, panX: 120, panY: -40 }, {});
    const ca = adaptiveGridCssBackground(a);
    const cb = adaptiveGridCssBackground(b);
    expect(ca.backgroundPosition).not.toBe(cb.backgroundPosition);
    expect(cb.backgroundPosition.includes("120") || cb.backgroundPosition !== ca.backgroundPosition).toBe(true);
  });

  it("3. cursor-centred zoom preserves world under cursor", () => {
    const view = { zoom: 0.4, panX: 100, panY: 80 };
    const screenX = 640;
    const screenY = 360;
    const before = {
      x: (screenX - view.panX) / view.zoom,
      y: (screenY - view.panY) / view.zoom,
    };
    const next = cursorCenteredZoomView(view, {
      screenX, screenY, nextZoom: 0.8,
    });
    const after = {
      x: (screenX - next.panX) / next.zoom,
      y: (screenY - next.panY) / next.zoom,
    };
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(next.worldUnderCursor.x).toBeCloseTo(before.x, 6);
  });

  it("4. CSS grid descriptor is O(1) (no line array)", () => {
    const g = resolveAdaptiveGrid({ zoom: 1, panX: 10, panY: 20 }, {});
    const css = adaptiveGridCssBackground(g);
    expect(typeof css.backgroundImage).toBe("string");
    expect(css.backgroundImage.includes("linear-gradient")).toBe(true);
    // No per-cell nodes — just style fields.
    expect(Object.keys(css).sort()).toEqual([
      "backgroundImage",
      "backgroundPosition",
      "backgroundRepeat",
      "backgroundSize",
    ].sort());
  });

  it("minor step spacing stays near useful px band", () => {
    for (const z of [0.08, 0.2, 0.5, 1, 1.5]) {
      const step = chooseMinorGridStepMm(z);
      const px = step * z;
      expect(px).toBeGreaterThan(8);
      expect(px).toBeLessThan(80);
    }
  });
});

describe("LIVE4 grip scale / LOD", () => {
  it("6/7. visible grip radius changes with zoom", () => {
    const far = zoomResponsiveGripRadiusPx(0.12);
    const near = zoomResponsiveGripRadiusPx(1.2);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeGreaterThanOrEqual(5);
    expect(near).toBeLessThanOrEqual(15);
  });

  it("8. hit target retains safe minimum in world space", () => {
    const hitFar = gripHitRadiusWorld(0.2, GRIP_HIT_MIN_PX);
    const hitNear = gripHitRadiusWorld(1, GRIP_HIT_MIN_PX);
    expect(hitFar * 0.2).toBeCloseTo(GRIP_HIT_MIN_PX / 2, 5);
    expect(hitNear).toBeCloseTo(GRIP_HIT_MIN_PX / 2, 5);
  });

  it("9. LIVE4.1 near-wall clearance: world mm grows out, screen px stays bounded", () => {
    const far = dimensionClearanceMmForActiveCluster(0.2);
    const near = dimensionClearanceMmForActiveCluster(1);
    expect(far).toBeGreaterThan(near);
    expect(far * 0.2).toBeLessThanOrEqual(40.01);
    expect(near).toBeLessThanOrEqual(40.01);
  });

  it("13/14. LOD thresholds", () => {
    expect(resolveViewportLod(0.05)).toBe("overview");
    expect(resolveViewportLod(0.3)).toBe("normal");
    expect(resolveViewportLod(0.9)).toBe("detail");
  });
});

describe("LIVE4 open L exterior (path-only)", () => {
  function openLInBusyPlan() {
    // Free L plus a distant closed rectangle — must not pollute L centroid.
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

  it("open L stays outside even when other rooms exist", () => {
    const plan = openLInBusyPlan();
    const resolved = { ...plan, walls: resolvePlanWalls(plan) };
    const h = openChainExteriorOffsetForWall(resolved, "wh");
    const v = openChainExteriorOffsetForWall(resolved, "wv");
    expect(h.reason).toBe("open_chain");
    expect(v.reason).toBe("open_chain");
    expect(h.chainWallIds).toEqual(expect.arrayContaining(["wh", "wv"]));
    expect(h.chainWallIds.length).toBe(2);

    const wh = resolved.walls.find((w) => w.id === "wh");
    const wv = resolved.walls.find((w) => w.id === "wv");
    const sideOf = (wall, offsetMm) => {
      const a = wall.pts[0];
      const b = wall.pts[wall.pts.length - 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      const s = Math.sign(offsetMm) || 1;
      return { x: nx * s, y: ny * s };
    };
    expect(sideOf(wh, h.offsetMm).y).toBeLessThan(0);
    expect(sideOf(wv, v.offsetMm).x).toBeGreaterThan(0);

    const { dimensions } = generateWallDimensions(resolved);
    const dh = dimensions.find((d) => String(d.id).includes("wh"));
    const dv = dimensions.find((d) => String(d.id).includes("wv"));
    expect(sideOf(wh, dh.offset).y).toBeLessThan(0);
    expect(sideOf(wv, dv.offset).x).toBeGreaterThan(0);
  });
});
