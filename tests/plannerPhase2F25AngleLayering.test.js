/**
 * PHASE 2F2.5 — angle layering + typography polish (presentation only).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import {
  buildSelectedWallCornerAngles,
  presentSelectedCornerAngles,
  formatCornerAngleDisplay,
} from "../src/planner/core/dimensions/cornerAngleDimensions.js";
import {
  angleFontPx,
  ANGLE_FONT_MIN_PX,
  ANGLE_FONT_MIN_MOVEMENT_PX,
  ANGLE_FONT_MAX_SELECTED_PX,
  ANGLE_FONT_MAX_MOVEMENT_PX,
  SELECTED_FONT_REF_PX,
  MOVEMENT_FONT_REF_PX,
  ANGLE_FONT_WEIGHT,
  ANGLE_FONT_WEIGHT_MIN,
  ANGLE_CHIP_OPACITY,
  ANGLE_CHIP_OPACITY_MIN,
  ANGLE_CHIP_OPACITY_MAX,
  ANGLE_SVG_PAINT_STACK,
  angleChipLayoutPx,
  MAGNET_ENTER_DEG,
  MAGNET_RELEASE_DEG,
} from "../src/planner/core/dimensions/index.js";
import { ANGLE_HALO_STROKE_PX } from "../src/planner/core/dimensions/angleLabelPresentation.js";
import {
  MAGNET_ENTER_DEG as ENTER,
  MAGNET_RELEASE_DEG as RELEASE,
  resolveAngleMagnet,
} from "../src/planner/core/dimensions/angleMagnetSnap.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

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

function angledTPlan() {
  const ang = (50 * Math.PI) / 180;
  return mkPlan(
    {
      h1: { x: OX, y: OY },
      t: { x: OX + 4000, y: OY },
      h2: { x: OX + 8000, y: OY },
      b: {
        x: OX + 4000 + Math.cos(ang) * 2500,
        y: OY + Math.sin(ang) * 2500,
      },
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

describe("PHASE 2F2.5 — SVG paint order (DOM authoritative)", () => {
  it("1-5. live overlay paints linear dims before angles; PlanPage stack correct", () => {
    const overlay = fs.readFileSync(
      path.join(ROOT, "src/planner/wallLiveMeasurementOverlay.jsx"),
      "utf8",
    );
    const planPage = fs.readFileSync(
      path.join(ROOT, "src/pages/admin/PlanPage.jsx"),
      "utf8",
    );
    const linearIdx = overlay.indexOf('data-ui="wall-live-linear-dims"');
    const angleIdx = overlay.indexOf('data-ui="wall-live-corner-angles"');
    expect(linearIdx).toBeGreaterThan(0);
    expect(angleIdx).toBeGreaterThan(linearIdx);
    // Chip before text inside AngleValueLabel.
    const chipIdx = overlay.indexOf('data-ui="corner-angle-chip"');
    const textIdx = overlay.indexOf('data-ui="corner-angle-text"');
    expect(chipIdx).toBeGreaterThan(0);
    expect(textIdx).toBeGreaterThan(chipIdx);

    const runtimeDim = planPage.indexOf('data-ui="runtime-linear-dimensions"');
    const liveMeas = planPage.indexOf('resetKey="wall-live-measurements"');
    const grips = planPage.indexOf("resetKey={`endpoint-grips-");
    expect(runtimeDim).toBeGreaterThan(0);
    expect(liveMeas).toBeGreaterThan(runtimeDim);
    expect(grips).toBeGreaterThan(liveMeas);

    expect(ANGLE_SVG_PAINT_STACK.indexOf("linear-dimensions"))
      .toBeLessThan(ANGLE_SVG_PAINT_STACK.indexOf("angle-arcs"));
    expect(ANGLE_SVG_PAINT_STACK.indexOf("angle-chips"))
      .toBeLessThan(ANGLE_SVG_PAINT_STACK.indexOf("angle-text"));
    expect(ANGLE_SVG_PAINT_STACK.indexOf("angle-text"))
      .toBeLessThan(ANGLE_SVG_PAINT_STACK.indexOf("endpoint-grips"));
  });
});

describe("PHASE 2F2.5 — typography + chip", () => {
  it("6-9. selected/movement fonts bumped and bounded", () => {
    // 2F2.6 may bump refs further; keep 2F2.5 contract as lower bounds.
    expect(SELECTED_FONT_REF_PX).toBeGreaterThanOrEqual(14.5);
    expect(angleFontPx(0.35, "selected")).toBeGreaterThanOrEqual(14.5);
    expect(ANGLE_FONT_MIN_PX).toBeGreaterThanOrEqual(11.4);
    expect(ANGLE_FONT_MIN_PX).toBeLessThanOrEqual(13);
    expect(ANGLE_FONT_MAX_SELECTED_PX).toBeLessThanOrEqual(20.5);
    expect(angleFontPx(0.9, "selected")).toBeLessThanOrEqual(ANGLE_FONT_MAX_SELECTED_PX + 1e-9);
    expect(angleFontPx(0.12, "selected")).toBeGreaterThanOrEqual(ANGLE_FONT_MIN_PX - 1e-9);

    expect(MOVEMENT_FONT_REF_PX).toBeGreaterThanOrEqual(15);
    expect(angleFontPx(0.35, "movement")).toBeGreaterThanOrEqual(15);
    expect(ANGLE_FONT_MIN_MOVEMENT_PX).toBeGreaterThanOrEqual(11.5);
    expect(angleFontPx(0.9, "movement")).toBeLessThanOrEqual(ANGLE_FONT_MAX_MOVEMENT_PX + 1e-9);
  });

  it("10-12. bold weight, compact chip, degree in same unit", () => {
    expect(ANGLE_FONT_WEIGHT).toBeGreaterThanOrEqual(ANGLE_FONT_WEIGHT_MIN);
    expect(ANGLE_FONT_WEIGHT).toBeLessThanOrEqual(800);
    expect(ANGLE_HALO_STROKE_PX).toBeLessThanOrEqual(2.5);
    expect(ANGLE_CHIP_OPACITY).toBeGreaterThanOrEqual(ANGLE_CHIP_OPACITY_MIN);
    expect(ANGLE_CHIP_OPACITY).toBeLessThanOrEqual(ANGLE_CHIP_OPACITY_MAX);
    expect(ANGLE_CHIP_OPACITY).toBeGreaterThan(0.75);
    expect(ANGLE_CHIP_OPACITY).toBeLessThan(0.9);

    const angs = buildSelectedWallCornerAngles(diagPairPlan(), "diag");
    const presented = presentSelectedCornerAngles(angs, { zoom: 0.35 });
    expect(presented.length).toBe(2);
    for (const p of presented) {
      expect(p.text.includes("°")).toBe(true);
      expect(formatCornerAngleDisplay(p.displayDeg)).toBe(p.text);
      expect(p.chip).toBeTruthy();
      expect(p.chip.opacity).toBeCloseTo(ANGLE_CHIP_OPACITY, 2);
      expect(p.chip.pointerEvents).toBe("none");
      const layout = angleChipLayoutPx(p.text, p.fontPx);
      expect(layout.height).toBeLessThan(p.fontPx * 2.2);
    }
  });

  it("13-14. paired labels readable; fingerprints frozen", () => {
    for (const [plan, wall, expectDegs] of [
      [diagPairPlan(), "diag", [118, 62]],
      [perpTPlan(), "branch", [90, 90]],
      [angledTPlan(), "branch", [130, 50]],
    ]) {
      const fp = fingerprint(plan, wall);
      const presented = presentSelectedCornerAngles(
        buildSelectedWallCornerAngles(plan, wall),
        { zoom: 0.35 },
      );
      expect(presented.map((p) => p.displayDeg).sort((a, b) => a - b))
        .toEqual([...expectDegs].sort((a, b) => a - b));
      expect(presented.length).toBe(2);
      const a = presented[0].labelPos;
      const b = presented[1].labelPos;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      expect(d).toBeGreaterThan(20);
      expect(JSON.stringify(fingerprint(plan, wall))).toBe(JSON.stringify(fp));
    }
  });

  it("15-16. magnets + hysteresis unchanged", () => {
    expect(ENTER).toBe(3.5);
    expect(RELEASE).toBe(6.0);
    expect(MAGNET_ENTER_DEG).toBe(3.5);
    expect(MAGNET_RELEASE_DEG).toBe(6.0);
    const pivot = { x: 0, y: 0 };
    for (const target of [45, 90]) {
      const rad = (target * Math.PI) / 180;
      const raw = { x: Math.cos(rad) * 1000, y: Math.sin(rad) * 1000 };
      const r = resolveAngleMagnet({ pivot, rawPoint: raw, referenceAngleDeg: 0 });
      expect(r.snapped).toBe(true);
      expect(r.angleDeg).toBe(target);
    }
  });
});
