/**
 * PHASE 2F2.6 — complete-label micro size/weight + thicker arcs.
 * No separate degree-symbol styling.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import {
  buildSelectedWallCornerAngles,
  presentSelectedCornerAngles,
  presentCornerAngle,
  formatCornerAngleDisplay,
} from "../src/planner/core/dimensions/cornerAngleDimensions.js";
import {
  angleFontPx,
  SELECTED_FONT_REF_PX,
  MOVEMENT_FONT_REF_PX,
  ANGLE_FONT_MIN_SELECTED_PX,
  ANGLE_FONT_MIN_MOVEMENT_PX,
  ANGLE_FONT_MAX_SELECTED_PX,
  ANGLE_FONT_MAX_MOVEMENT_PX,
  ANGLE_FONT_WEIGHT,
  ANGLE_FONT_WEIGHT_MIN,
  ANGLE_FONT_WEIGHT_MAX,
  ANGLE_CHIP_OPACITY,
  ANGLE_CHIP_PAD_X_PX,
  ANGLE_CHIP_PAD_Y_PX,
  ANGLE_STROKE_SELECTED_PX,
  ANGLE_STROKE_MOVEMENT_PX,
  ANGLE_SVG_PAINT_STACK,
  selectedCornerArcRadiusMm,
  angleChipLayoutPx,
  angleStrokePx,
} from "../src/planner/core/dimensions/index.js";
import {
  MAGNET_ENTER_DEG,
  MAGNET_RELEASE_DEG,
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

function mag45Plan() {
  const ang = (45 * Math.PI) / 180;
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
    text: a.text,
  }));
}

describe("PHASE 2F2.6 — complete label size/weight", () => {
  it("1-6. complete label fonts bumped; single size/weight for whole string", () => {
    expect(SELECTED_FONT_REF_PX).toBeCloseTo(15.5, 5);
    expect(angleFontPx(0.35, "selected")).toBeCloseTo(15.5, 5);
    expect(ANGLE_FONT_MIN_SELECTED_PX).toBeCloseTo(12, 5);
    expect(ANGLE_FONT_MAX_SELECTED_PX).toBeCloseTo(20, 5);
    expect(angleFontPx(0.12, "selected")).toBeGreaterThanOrEqual(12 - 1e-9);
    expect(angleFontPx(0.9, "selected")).toBeLessThanOrEqual(20 + 1e-9);

    expect(MOVEMENT_FONT_REF_PX).toBeCloseTo(16, 5);
    expect(angleFontPx(0.35, "movement")).toBeCloseTo(16, 5);
    expect(ANGLE_FONT_MIN_MOVEMENT_PX).toBeCloseTo(12.5, 5);
    expect(ANGLE_FONT_MAX_MOVEMENT_PX).toBeCloseTo(20, 5);

    const overlay = fs.readFileSync(
      path.join(ROOT, "src/planner/wallLiveMeasurementOverlay.jsx"),
      "utf8",
    );
    const magnet = fs.readFileSync(
      path.join(ROOT, "src/planner/angleMagnetOverlay.jsx"),
      "utf8",
    );
    expect(overlay.includes("<tspan")).toBe(false);
    expect(magnet.includes("<tspan")).toBe(false);
    // One text node renders the complete value string.
    expect(overlay).toMatch(/\{text\}/);
    expect(magnet).toMatch(/\{text\}/);
  });

  it("7-9. weight 750–800; chip contains complete value; opacity/pad frozen", () => {
    expect(ANGLE_FONT_WEIGHT).toBeGreaterThanOrEqual(ANGLE_FONT_WEIGHT_MIN);
    expect(ANGLE_FONT_WEIGHT).toBeLessThanOrEqual(ANGLE_FONT_WEIGHT_MAX);
    expect(ANGLE_FONT_WEIGHT).toBeGreaterThanOrEqual(750);
    expect(ANGLE_CHIP_OPACITY).toBeCloseTo(0.8, 2);
    expect(ANGLE_CHIP_PAD_X_PX).toBe(4);
    expect(ANGLE_CHIP_PAD_Y_PX).toBe(2);

    const presented = presentSelectedCornerAngles(
      buildSelectedWallCornerAngles(diagPairPlan(), "diag"),
      { zoom: 0.35 },
    );
    for (const p of presented) {
      expect(p.text.includes("°")).toBe(true);
      expect(formatCornerAngleDisplay(p.displayDeg)).toBe(p.text);
      const layout = angleChipLayoutPx(p.text, p.fontPx);
      expect(layout.width).toBeGreaterThan(p.fontPx * 2);
      expect(p.chip.width * 0.35).toBeCloseTo(layout.width, 4);
      expect(p.chip.opacity).toBeCloseTo(0.8, 2);
    }
  });
});

describe("PHASE 2F2.6 — thicker arcs; geometry frozen", () => {
  it("10-12. stroke thicker; radius/sector unchanged by stroke", () => {
    expect(ANGLE_STROKE_SELECTED_PX).toBeGreaterThan(1.9);
    expect(ANGLE_STROKE_SELECTED_PX).toBeLessThanOrEqual(2.25);
    expect(ANGLE_STROKE_MOVEMENT_PX).toBeGreaterThan(2.0);
    expect(ANGLE_STROKE_MOVEMENT_PX).toBeLessThanOrEqual(2.35);
    expect(angleStrokePx("selected")).toBe(ANGLE_STROKE_SELECTED_PX);
    expect(angleStrokePx("movement")).toBe(ANGLE_STROKE_MOVEMENT_PX);

    const angs = buildSelectedWallCornerAngles(diagPairPlan(), "diag");
    const beforeR = selectedCornerArcRadiusMm(0.35, 100);
    const p = presentCornerAngle(angs[0], { zoom: 0.35, mode: "selected" });
    expect(p.radius).toBeCloseTo(beforeR, 5);
    expect(p.sweepDeg).toBe(angs[0].sweepDeg);
    expect(p.startDeg).toBe(angs[0].startDeg);
    expect(p.radiusScreenPx).toBeCloseTo(beforeR * 0.35, 5);
  });

  it("13-14. paired labels collision-free; fingerprints frozen", () => {
    for (const [plan, wall, degs] of [
      [diagPairPlan(), "diag", [62, 118]],
      [perpTPlan(), "branch", [90, 90]],
      [angledTPlan(), "branch", [50, 130]],
      [mag45Plan(), "branch", [45, 135]],
    ]) {
      const fp = JSON.stringify(fingerprint(plan, wall));
      const presented = presentSelectedCornerAngles(
        buildSelectedWallCornerAngles(plan, wall),
        { zoom: 0.35 },
      );
      expect(presented.map((x) => x.displayDeg).sort((a, b) => a - b))
        .toEqual([...degs].sort((a, b) => a - b));
      expect(presented.length).toBe(2);
      const d = Math.hypot(
        presented[0].labelPos.x - presented[1].labelPos.x,
        presented[0].labelPos.y - presented[1].labelPos.y,
      );
      expect(d).toBeGreaterThan(22);
      expect(JSON.stringify(fingerprint(plan, wall))).toBe(fp);
    }
  });

  it("15-16. layer order + magnets unchanged", () => {
    expect(ANGLE_SVG_PAINT_STACK.indexOf("linear-dimensions"))
      .toBeLessThan(ANGLE_SVG_PAINT_STACK.indexOf("angle-arcs"));
    expect(ANGLE_SVG_PAINT_STACK.indexOf("angle-text"))
      .toBeLessThan(ANGLE_SVG_PAINT_STACK.indexOf("endpoint-grips"));
    const overlay = fs.readFileSync(
      path.join(ROOT, "src/planner/wallLiveMeasurementOverlay.jsx"),
      "utf8",
    );
    expect(overlay.indexOf('wall-live-linear-dims'))
      .toBeLessThan(overlay.indexOf('wall-live-corner-angles'));

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
