/**
 * PHASE 2F2.4 — RemPlanner-style zoom-responsive angles + translucent chips.
 */
import { describe, it, expect } from "vitest";
import {
  buildSelectedWallCornerAngles,
  presentSelectedCornerAngles,
  formatCornerAngleDisplay,
} from "../src/planner/core/dimensions/cornerAngleDimensions.js";
import {
  angleFontPx,
  anglesVisibleAtZoom,
  selectedCornerArcRadiusMm,
  movementCornerArcRadiusMm,
  arcRadiusScreenPx,
  angleChipLayoutPx,
  angleChipRectWorld,
  ANGLE_FONT_MIN_PX,
  ANGLE_LOD_HIDE_ZOOM,
  ANGLE_LOD_SHOW_ZOOM,
  ANGLE_CHIP_OPACITY,
  ANGLE_CHIP_OPACITY_MIN,
  ANGLE_CHIP_OPACITY_MAX,
  ANGLE_GRIP_CLEAR_PX,
  SELECTED_ARC_MIN_PX,
  SELECTED_ARC_MAX_PX,
  MOVEMENT_ARC_MIN_PX,
  MOVEMENT_ARC_MAX_PX,
  worldMmToScreenPx,
  zoomResponsivePx,
} from "../src/planner/core/dimensions/angleLabelPresentation.js";
import { zoomResponsiveGripRadiusPx, GRIP_HIT_MIN_PX } from "../src/planner/core/viewport/gripScale.js";
import {
  MAGNET_ENTER_DEG,
  MAGNET_RELEASE_DEG,
  resolveAngleMagnet,
  emptyAngleMagnetPreview,
} from "../src/planner/core/dimensions/angleMagnetSnap.js";

const OX = 110_000;
const OY = 120_000;

function mkPlan(nodes, walls) {
  return {
    nodes: { ...nodes },
    walls: walls.map((w) => ({ thk: 100, thicknessSide: "center", ...w })),
    rooms: [],
  };
}

function diagPairPlan() {
  const ang = (62 * Math.PI) / 180;
  return mkPlan(
    {
      h1: { x: OX, y: OY },
      t: { x: OX + 4000, y: OY },
      h2: { x: OX + 8000, y: OY },
      b: {
        x: OX + 4000 + Math.cos(ang) * 2800,
        y: OY + Math.sin(ang) * 2800,
      },
    },
    [
      { id: "hostL", a: "h1", b: "t", chainId: "host" },
      { id: "hostR", a: "t", b: "h2", chainId: "host" },
      { id: "diag", a: "t", b: "b" },
    ],
  );
}

function perpTPlan() {
  return mkPlan(
    {
      h1: { x: OX, y: OY },
      t: { x: OX + 4000, y: OY },
      h2: { x: OX + 8000, y: OY },
      b: { x: OX + 4000, y: OY + 3000 },
    },
    [
      { id: "hostL", a: "h1", b: "t", chainId: "host" },
      { id: "hostR", a: "t", b: "h2", chainId: "host" },
      { id: "branch", a: "t", b: "b" },
    ],
  );
}

function fingerprint(plan, wallId) {
  return buildSelectedWallCornerAngles(plan, wallId).map((a) => ({
    id: a.id,
    sectorKey: a.sectorKey,
    nodeId: a.nodeId,
    wallIds: [...a.wallIds].sort(),
    startDeg: a.startDeg,
    sweepDeg: a.sweepDeg,
    displayDeg: a.displayDeg,
  }));
}

describe("PHASE 2F2.4 — semantics frozen + zoom scale", () => {
  it("1. semantic angle fingerprints are unchanged by presentation", () => {
    const plan = diagPairPlan();
    const before = JSON.stringify(fingerprint(plan, "diag"));
    presentSelectedCornerAngles(buildSelectedWallCornerAngles(plan, "diag"), { zoom: 0.35 });
    presentSelectedCornerAngles(buildSelectedWallCornerAngles(plan, "diag"), { zoom: 0.8 });
    expect(JSON.stringify(fingerprint(plan, "diag"))).toBe(before);
  });

  it("2. selected text size increases monotonically with zoom within clamps", () => {
    const zs = [0.12, 0.2, 0.35, 0.55, 0.9];
    const fonts = zs.map((z) => angleFontPx(z, "selected"));
    for (let i = 1; i < fonts.length; i++) {
      expect(fonts[i]).toBeGreaterThanOrEqual(fonts[i - 1] - 1e-9);
    }
    expect(fonts[fonts.length - 1]).toBeLessThanOrEqual(20 + 1e-9);
  });

  it("3. selected text size decreases monotonically when zooming out", () => {
    const zs = [0.9, 0.55, 0.35, 0.2, 0.12];
    const fonts = zs.map((z) => angleFontPx(z, "selected"));
    for (let i = 1; i < fonts.length; i++) {
      expect(fonts[i]).toBeLessThanOrEqual(fonts[i - 1] + 1e-9);
    }
  });

  it("4. movement text follows the same bounded scaling contract", () => {
    const a = angleFontPx(0.2, "movement");
    const b = angleFontPx(0.35, "movement");
    const c = angleFontPx(0.8, "movement");
    expect(a).toBeLessThanOrEqual(b + 1e-9);
    expect(b).toBeLessThanOrEqual(c + 1e-9);
    expect(a).toBeGreaterThanOrEqual(ANGLE_FONT_MIN_PX - 1e-9);
    expect(c).toBeLessThanOrEqual(20 + 1e-9);
  });

  it("4b. selected arcs scale with zoom; vertex grip occupancy does not pin max", () => {
    const angs = buildSelectedWallCornerAngles(diagPairPlan(), "diag");
    const vertex = angs[0].vertex;
    const fakeGripOcc = [{ point: { ...vertex }, clearMm: 80 }];
    const atFar = presentSelectedCornerAngles(angs, { zoom: 0.14, occupancy: fakeGripOcc });
    const atNorm = presentSelectedCornerAngles(angs, { zoom: 0.35, occupancy: fakeGripOcc });
    const atClose = presentSelectedCornerAngles(angs, { zoom: 0.9, occupancy: fakeGripOcc });
    expect(atNorm[0].radiusScreenPx).toBeLessThan(SELECTED_ARC_MAX_PX - 0.5);
    expect(atNorm[0].radiusScreenPx).toBeGreaterThan(SELECTED_ARC_MIN_PX - 0.5);
    expect(atFar[0].radiusScreenPx).toBeLessThanOrEqual(atNorm[0].radiusScreenPx + 1e-6);
    expect(atNorm[0].radiusScreenPx).toBeLessThanOrEqual(atClose[0].radiusScreenPx + 1e-6);
    expect(atClose[0].radiusScreenPx).toBeLessThanOrEqual(SELECTED_ARC_MAX_PX + 1e-6);
    expect(arcRadiusScreenPx(selectedCornerArcRadiusMm(0.35, 100), 0.35)).toBeCloseTo(30, 5);
    expect(arcRadiusScreenPx(movementCornerArcRadiusMm(0.35, 100), 0.35)).toBeGreaterThanOrEqual(MOVEMENT_ARC_MIN_PX);
    expect(arcRadiusScreenPx(movementCornerArcRadiusMm(0.35, 100), 0.35)).toBeLessThanOrEqual(MOVEMENT_ARC_MAX_PX);
  });

  it("5. text never drops below the readable minimum while visible", () => {
    for (const z of [0.09, 0.12, 0.2, 0.35, 0.8]) {
      if (!anglesVisibleAtZoom(z)) continue;
      expect(angleFontPx(z, "selected")).toBeGreaterThanOrEqual(ANGLE_FONT_MIN_PX - 1e-9);
      const angs = buildSelectedWallCornerAngles(diagPairPlan(), "diag");
      const p = presentSelectedCornerAngles(angs, { zoom: z });
      expect(p.every((x) => x.fontPx >= ANGLE_FONT_MIN_PX - 1e-9)).toBe(true);
    }
  });

  it("6. true overview hides the complete annotation", () => {
    expect(anglesVisibleAtZoom(ANGLE_LOD_HIDE_ZOOM - 0.01)).toBe(false);
    const angs = buildSelectedWallCornerAngles(diagPairPlan(), "diag");
    expect(presentSelectedCornerAngles(angs, { zoom: 0.05 })).toEqual([]);
  });

  it("7. zooming back restores the same sector + LOD hysteresis", () => {
    const angs = buildSelectedWallCornerAngles(diagPairPlan(), "diag");
    const keys = presentSelectedCornerAngles(angs, { zoom: 0.35 }).map((p) => p.sectorKey).sort();
    // Still visible slightly below old adaptiveGrid overview when wasVisible.
    expect(anglesVisibleAtZoom(0.10, { wasVisible: true })).toBe(true);
    expect(anglesVisibleAtZoom(0.07, { wasVisible: false })).toBe(false);
    expect(ANGLE_LOD_SHOW_ZOOM).toBeGreaterThan(ANGLE_LOD_HIDE_ZOOM);
    expect(presentSelectedCornerAngles(angs, { zoom: 0.05 })).toEqual([]);
    expect(
      presentSelectedCornerAngles(angs, { zoom: 0.35 }).map((p) => p.sectorKey).sort(),
    ).toEqual(keys);
  });
});

describe("PHASE 2F2.4 — chip + collisions + magnets frozen", () => {
  it("8-12. translucent background chip exists and is subtle", () => {
    const angs = buildSelectedWallCornerAngles(diagPairPlan(), "diag");
    const presented = presentSelectedCornerAngles(angs, { zoom: 0.35 });
    expect(presented.length).toBe(2);
    for (const p of presented) {
      expect(p.chip).toBeTruthy();
      expect(p.chip.pointerEvents).toBe("none");
      expect(p.chip.opacity).toBeGreaterThanOrEqual(ANGLE_CHIP_OPACITY_MIN);
      expect(p.chip.opacity).toBeLessThanOrEqual(ANGLE_CHIP_OPACITY_MAX);
      expect(p.chip.opacity).toBeCloseTo(ANGLE_CHIP_OPACITY, 2);
      // Chip tightly follows text — not a large card.
      const layout = angleChipLayoutPx(p.text, p.fontPx);
      expect(layout.width).toBeLessThan(p.fontPx * p.text.length * 0.9);
      expect(layout.height).toBeLessThan(p.fontPx * 2.2);
      expect(p.text.includes("°")).toBe(true);
      expect(formatCornerAngleDisplay(p.displayDeg)).toBe(p.text);
      const world = angleChipRectWorld(p.labelPos, p.text, p.fontPx, 0.35);
      expect(world.width * 0.35).toBeCloseTo(layout.width, 5);
    }
  });

  it("13-15. clearance uses visible grip; dim lines masked by chip only", () => {
    const z = 0.35;
    const presented = presentSelectedCornerAngles(
      buildSelectedWallCornerAngles(diagPairPlan(), "diag"),
      { zoom: z },
    );
    const gripPx = zoomResponsiveGripRadiusPx(z);
    for (const p of presented) {
      const dPx = worldMmToScreenPx(
        Math.hypot(p.labelPos.x - p.angle.vertex.x, p.labelPos.y - p.angle.vertex.y),
        z,
      );
      expect(dPx).toBeGreaterThan(gripPx + ANGLE_GRIP_CLEAR_PX);
      // Chip sits at label — presentation layer above dim lines (overlay order).
      expect(p.chip).toBeTruthy();
    }
    const visual = zoomResponsiveGripRadiusPx(z);
    expect(visual).toBeLessThan(GRIP_HIT_MIN_PX / 2);
  });

  it("16-18. paired labels remain readable", () => {
    const diag = presentSelectedCornerAngles(
      buildSelectedWallCornerAngles(diagPairPlan(), "diag"),
      { zoom: 0.35 },
    );
    expect(diag.map((p) => p.displayDeg).sort((a, b) => a - b)).toEqual([62, 118]);
    expect(diag).toHaveLength(2);
    const d = worldMmToScreenPx(
      Math.hypot(
        diag[0].labelPos.x - diag[1].labelPos.x,
        diag[0].labelPos.y - diag[1].labelPos.y,
      ),
      0.35,
    );
    expect(d).toBeGreaterThan(angleFontPx(0.35, "selected"));

    const perp = presentSelectedCornerAngles(
      buildSelectedWallCornerAngles(perpTPlan(), "branch"),
      { zoom: 0.4 },
    );
    expect(perp.map((p) => p.displayDeg).sort()).toEqual([90, 90]);

    const pivot = perpTPlan().nodes.t;
    const end = {
      x: pivot.x + Math.cos((45 * Math.PI) / 180) * 3000,
      y: pivot.y + Math.sin((45 * Math.PI) / 180) * 3000,
    };
    const preview = { ...perpTPlan(), nodes: { ...perpTPlan().nodes, b: end } };
    const mag = presentSelectedCornerAngles(
      buildSelectedWallCornerAngles(preview, "branch"),
      { zoom: 0.35, mode: "movement" },
    );
    expect(mag.map((p) => p.displayDeg).sort((a, b) => a - b)).toEqual([45, 135]);
  });

  it("19-20. no host-host 180 / no giant circle", () => {
    const angs = buildSelectedWallCornerAngles(diagPairPlan(), "diag");
    expect(angs.every((a) => a.displayDeg !== 180 && a.sweepDeg < 170)).toBe(true);
    for (const z of [0.15, 0.35, 0.8]) {
      const p = presentSelectedCornerAngles(angs, { zoom: z });
      for (const x of p) {
        expect(x.radiusScreenPx).toBeLessThanOrEqual(SELECTED_ARC_MAX_PX + 8);
        expect(x.radiusScreenPx).toBeGreaterThanOrEqual(SELECTED_ARC_MIN_PX - 1);
      }
      const arc = arcRadiusScreenPx(selectedCornerArcRadiusMm(z), z);
      expect(arc).toBeGreaterThanOrEqual(SELECTED_ARC_MIN_PX - 0.01);
      expect(arc).toBeLessThanOrEqual(SELECTED_ARC_MAX_PX + 0.01);
      const marc = arcRadiusScreenPx(movementCornerArcRadiusMm(z), z);
      expect(marc).toBeGreaterThanOrEqual(MOVEMENT_ARC_MIN_PX - 0.01);
      expect(marc).toBeLessThanOrEqual(MOVEMENT_ARC_MAX_PX + 0.01);
    }
  });

  it("21-23. magnets / hysteresis / guide lifecycle frozen", () => {
    expect(MAGNET_ENTER_DEG).toBe(3.5);
    expect(MAGNET_RELEASE_DEG).toBe(6);
    const pivot = { x: OX, y: OY };
    for (const target of [45, 90]) {
      const raw = {
        x: pivot.x + Math.cos(((target - 2) * Math.PI) / 180) * 2000,
        y: pivot.y + Math.sin(((target - 2) * Math.PI) / 180) * 2000,
      };
      const r = resolveAngleMagnet({ pivot, rawPoint: raw, referenceAngleDeg: 0 });
      expect(r.snapped).toBe(true);
      expect(r.angleDeg).toBe(target);
    }
    const empty = emptyAngleMagnetPreview();
    expect(empty.guides).toEqual([]);
    expect(empty.active).toBe(false);
  });

  it("zoomResponsivePx is monotonic and bounded", () => {
    const a = zoomResponsivePx(0.2, 13.5, 10.5, 18);
    const b = zoomResponsivePx(0.35, 13.5, 10.5, 18);
    const c = zoomResponsivePx(1.0, 13.5, 10.5, 18);
    expect(a).toBeLessThanOrEqual(b);
    expect(b).toBeLessThanOrEqual(c);
    expect(a).toBeGreaterThanOrEqual(10.5);
    expect(c).toBeLessThanOrEqual(18);
  });
});
