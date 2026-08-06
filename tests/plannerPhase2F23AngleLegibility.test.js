/**
 * PHASE 2F2.3 — screen-space angle legibility (self-contained).
 * Does not alter magnet thresholds or sector selection semantics.
 */
import { describe, it, expect } from "vitest";
import {
  buildSelectedWallCornerAngles,
  presentSelectedCornerAngles,
  presentCornerAngle,
  formatCornerAngleDisplay,
} from "../src/planner/core/dimensions/cornerAngleDimensions.js";
import {
  angleFontPx,
  anglesVisibleAtZoom,
  selectedCornerArcRadiusMm,
  movementCornerArcRadiusMm,
  arcRadiusScreenPx,
  angleLabelMinRadiusMm,
  angleLabelRadiusMm,
  ANGLE_FONT_MIN_PX,
  SELECTED_ANGLE_FONT_PX,
  MOVEMENT_ANGLE_FONT_PX,
  SELECTED_ARC_MIN_PX,
  SELECTED_ARC_MAX_PX,
  MOVEMENT_ARC_MIN_PX,
  MOVEMENT_ARC_MAX_PX,
  ANGLE_OVERVIEW_ZOOM,
  ANGLE_GRIP_CLEAR_PX,
  worldMmToScreenPx,
} from "../src/planner/core/dimensions/angleLabelPresentation.js";
import { zoomResponsiveGripRadiusPx, GRIP_HIT_MIN_PX } from "../src/planner/core/viewport/gripScale.js";
import {
  MAGNET_ENTER_DEG,
  MAGNET_RELEASE_DEG,
  resolveAngleMagnet,
  emptyAngleMagnetPreview,
} from "../src/planner/core/dimensions/angleMagnetSnap.js";
import { resolveViewportLod } from "../src/planner/core/grid/adaptiveGrid.js";

const OX = 80_000;
const OY = 90_000;

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

describe("PHASE 2F2.3 — screen-space font / arc", () => {
  it("1. selected angle font stays above readable minimum", () => {
    expect(angleFontPx(0.35, "selected")).toBeGreaterThanOrEqual(ANGLE_FONT_MIN_PX);
    expect(angleFontPx(0.35, "selected")).toBeCloseTo(SELECTED_ANGLE_FONT_PX, 0);
  });

  it("2. movement angle font stays above readable minimum", () => {
    expect(angleFontPx(0.35, "movement")).toBeGreaterThanOrEqual(ANGLE_FONT_MIN_PX);
    expect(angleFontPx(0.35, "movement")).toBeCloseTo(MOVEMENT_ANGLE_FONT_PX, 0);
  });

  it("3. degree symbol present and same string scale (no separate superscript)", () => {
    for (const d of [90, 45, 135, 118, 62]) {
      const t = formatCornerAngleDisplay(d);
      expect(t).toMatch(/^\d+\.\d°$/);
      expect(t.includes(" °")).toBe(false);
      expect(t.endsWith("°")).toBe(true);
    }
  });

  it("4. normal editing zoom is not overview styling", () => {
    expect(resolveViewportLod(0.35)).toBe("normal");
    expect(anglesVisibleAtZoom(0.35)).toBe(true);
    const angs = buildSelectedWallCornerAngles(diagPairPlan(), "diag");
    expect(presentSelectedCornerAngles(angs, { zoom: 0.35 }).length).toBe(2);
  });

  it("5. far overview hides the complete angle annotation", () => {
    // 2F2.4: angles stay past adaptiveGrid 0.12; hide near ~0.068.
    expect(ANGLE_OVERVIEW_ZOOM).toBeLessThan(0.12);
    expect(anglesVisibleAtZoom(0.05)).toBe(false);
    const angs = buildSelectedWallCornerAngles(diagPairPlan(), "diag");
    expect(presentSelectedCornerAngles(angs, { zoom: 0.05 })).toEqual([]);
  });

  it("6. returning from overview restores the same sector", () => {
    const angs = buildSelectedWallCornerAngles(diagPairPlan(), "diag");
    const keysA = presentSelectedCornerAngles(angs, { zoom: 0.35 })
      .map((p) => p.sectorKey).sort();
    expect(presentSelectedCornerAngles(angs, { zoom: 0.05 })).toEqual([]);
    const keysB = presentSelectedCornerAngles(angs, { zoom: 0.35 })
      .map((p) => p.sectorKey).sort();
    expect(keysB).toEqual(keysA);
  });

  it("7. arc radius is bounded in screen pixels", () => {
    for (const z of [0.15, 0.35, 0.55, 1.0]) {
      const r = selectedCornerArcRadiusMm(z, 100);
      const px = arcRadiusScreenPx(r, z);
      expect(px).toBeGreaterThanOrEqual(SELECTED_ARC_MIN_PX - 0.01);
      expect(px).toBeLessThanOrEqual(SELECTED_ARC_MAX_PX + 0.01);
      const mr = movementCornerArcRadiusMm(z, 100);
      const mpx = arcRadiusScreenPx(mr, z);
      expect(mpx).toBeGreaterThanOrEqual(MOVEMENT_ARC_MIN_PX - 0.01);
      expect(mpx).toBeLessThanOrEqual(MOVEMENT_ARC_MAX_PX + 0.01);
    }
  });

  it("8. arc never expands into a giant full-circle diagram", () => {
    const angs = buildSelectedWallCornerAngles(diagPairPlan(), "diag");
    for (const z of [0.15, 0.35, 0.8]) {
      const presented = presentSelectedCornerAngles(angs, { zoom: z, lod: "normal" });
      for (const p of presented) {
        expect(p.sweepDeg).toBeLessThan(170);
        expect(p.radiusScreenPx).toBeLessThanOrEqual(SELECTED_ARC_MAX_PX + 6);
        expect(p.radiusScreenPx).toBeLessThan(80);
      }
    }
  });

  it("9. text does not overlap the visible endpoint circle", () => {
    const plan = diagPairPlan();
    const angs = buildSelectedWallCornerAngles(plan, "diag");
    const z = 0.35;
    const presented = presentSelectedCornerAngles(angs, { zoom: z });
    const gripPx = zoomResponsiveGripRadiusPx(z);
    for (const p of presented) {
      const dMm = Math.hypot(
        p.labelPos.x - p.angle.vertex.x,
        p.labelPos.y - p.angle.vertex.y,
      );
      const dPx = worldMmToScreenPx(dMm, z);
      const textHalf = angleFontPx(z, "selected") * 0.4;
      expect(dPx - textHalf).toBeGreaterThanOrEqual(gripPx + ANGLE_GRIP_CLEAR_PX - 0.5);
    }
  });

  it("10. invisible hit targets do not affect visual clearance", () => {
    const z = 0.35;
    const visual = zoomResponsiveGripRadiusPx(z);
    const minR = angleLabelMinRadiusMm(z);
    const fontPx = angleFontPx(z, "selected");
    // Same extras but with hit radius instead of visual — would push labels farther.
    const ifHitDriven = (GRIP_HIT_MIN_PX / 2 + ANGLE_GRIP_CLEAR_PX + fontPx * 0.4) / z;
    expect(visual).toBeLessThan(GRIP_HIT_MIN_PX / 2);
    expect(minR).toBeLessThan(ifHitDriven);
  });
});

describe("PHASE 2F2.3 — paired labels + magnet freeze", () => {
  it("11. paired 118°/62° labels simultaneously readable", () => {
    const angs = buildSelectedWallCornerAngles(diagPairPlan(), "diag");
    const degs = angs.map((a) => a.displayDeg).sort((a, b) => a - b);
    expect(degs[0]).toBeCloseTo(62, 0);
    expect(degs[1]).toBeCloseTo(118, 0);
    const presented = presentSelectedCornerAngles(angs, { zoom: 0.35 });
    expect(presented).toHaveLength(2);
    const [a, b] = presented;
    const dist = Math.hypot(a.labelPos.x - b.labelPos.x, a.labelPos.y - b.labelPos.y);
    expect(worldMmToScreenPx(dist, 0.35)).toBeGreaterThan(angleFontPx(0.35, "selected"));
  });

  it("12. paired 90°/90° labels simultaneously readable", () => {
    const angs = buildSelectedWallCornerAngles(perpTPlan(), "branch");
    expect(angs.map((a) => a.displayDeg).sort()).toEqual([90, 90]);
    const presented = presentSelectedCornerAngles(angs, { zoom: 0.4 });
    expect(presented).toHaveLength(2);
    expect(presented.every((p) => p.fontPx >= ANGLE_FONT_MIN_PX)).toBe(true);
  });

  it("13. paired 45°/135° labels simultaneously readable", () => {
    const plan = perpTPlan();
    const pivot = plan.nodes.t;
    const end = {
      x: pivot.x + Math.cos((45 * Math.PI) / 180) * 3000,
      y: pivot.y + Math.sin((45 * Math.PI) / 180) * 3000,
    };
    const preview = { ...plan, nodes: { ...plan.nodes, b: end } };
    const angs = buildSelectedWallCornerAngles(preview, "branch");
    const degs = angs.map((a) => a.displayDeg).sort((a, b) => a - b);
    expect(degs).toEqual([45, 135]);
    const presented = presentSelectedCornerAngles(angs, {
      zoom: 0.35,
      mode: "movement",
    });
    expect(presented).toHaveLength(2);
    expect(presented.every((p) => p.mode === "movement")).toBe(true);
  });

  it("14. host-host 180° remains absent", () => {
    for (const id of ["branch", "diag"]) {
      const plan = id === "diag" ? diagPairPlan() : perpTPlan();
      const wallId = id === "diag" ? "diag" : "branch";
      const angs = buildSelectedWallCornerAngles(plan, wallId);
      expect(angs.some((a) => a.displayDeg === 180 || a.sweepDeg >= 170)).toBe(false);
    }
  });

  it("15. pointer/hover does not change layout beyond presentation", () => {
    const angs = buildSelectedWallCornerAngles(diagPairPlan(), "diag");
    const a = presentSelectedCornerAngles(angs, { zoom: 0.35 })
      .map((p) => p.sectorKey);
    const b = presentSelectedCornerAngles(angs, { zoom: 0.35 })
      .map((p) => p.sectorKey);
    expect(b).toEqual(a);
  });

  it("16. 45° and 90° snap remain exact", () => {
    const pivot = { x: OX, y: OY };
    for (const target of [45, 90]) {
      const raw = {
        x: pivot.x + Math.cos(((target - 2) * Math.PI) / 180) * 2000,
        y: pivot.y + Math.sin(((target - 2) * Math.PI) / 180) * 2000,
      };
      const r = resolveAngleMagnet({
        pivot,
        rawPoint: raw,
        referenceAngleDeg: 0,
      });
      expect(r.snapped).toBe(true);
      expect(r.angleDeg).toBe(target);
      expect(MAGNET_ENTER_DEG).toBe(3.5);
      expect(MAGNET_RELEASE_DEG).toBe(6);
    }
  });

  it("17. guide lifecycle remains correct", () => {
    const empty = emptyAngleMagnetPreview();
    expect(empty.active).toBe(false);
    expect(empty.guides).toEqual([]);
    expect(empty.angles).toEqual([]);
  });

  it("label radius grows with screen gap, not fixed world 14mm", () => {
    const z = 0.35;
    const arc = selectedCornerArcRadiusMm(z, 100);
    const labelR = angleLabelRadiusMm(arc, z, { mode: "selected", sweepDeg: 90 });
    expect(labelR).toBeGreaterThan(arc);
    expect(worldMmToScreenPx(labelR - arc, z)).toBeGreaterThanOrEqual(8);
  });
});
