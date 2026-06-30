import { describe, expect, it } from "vitest";
import { runSnapEngine } from "../src/planner/core/snap/snapEngine.js";
import { SNAP_TYPES } from "../src/planner/core/snap/snapTypes.js";
import { pickBestSnap } from "../src/planner/core/snap/snapPriority.js";

describe("core/snap engine", () => {
  const view = { zoom: 0.1 };
  const plan = {
    walls: [{ id: "w1", thk: 100, pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }] }],
    room: { w: 12000, h: 8000 },
  };

  it("snap to grid", () => {
    const r = runSnapEngine({
      point: { x: 123, y: 456 },
      mode: "wall",
      plan,
      view,
      modifiers: {},
      options: { snapOn: true, snapGrid: true, snapWalls: false, snapStep: 50 },
    });
    expect(r.point.x % 50).toBe(0);
    expect(r.point.y % 50).toBe(0);
  });

  it("vertex priority over grid", () => {
    const candidates = [
      { point: { x: 100, y: 50 }, type: SNAP_TYPES.GRID, distance: 5 },
      { point: { x: 0, y: 0 }, type: SNAP_TYPES.VERTEX, distance: 12 },
    ];
    const best = pickBestSnap(candidates);
    expect(best.type).toBe(SNAP_TYPES.VERTEX);
  });

  it("snap to wall midpoint", () => {
    const r = runSnapEngine({
      point: { x: 2000, y: 30 },
      mode: "wall",
      plan,
      view,
      modifiers: {},
      options: {
        snapOn: true, snapWalls: true, snapGrid: false,
        snapDistancePx: 50, from: { x: 2000, y: 500 },
      },
    });
    expect(r.snapped).toBe(true);
    expect(r.point.y).toBeCloseTo(0, 0);
  });

  it("angle snap to 90°", () => {
    const r = runSnapEngine({
      point: { x: 50, y: 2000 },
      mode: "wall",
      plan,
      view,
      modifiers: { shift: false },
      options: {
        snapOn: true, angleSnapOn: true, snapWalls: false, snapGrid: false,
        toleranceDeg: 8, from: { x: 0, y: 0 },
      },
    });
    expect(r.angleSnap?.isSnapped || r.type === SNAP_TYPES.ANGLE || r.type === SNAP_TYPES.PERPENDICULAR).toBe(true);
  });

  it("Alt disables snap except 1mm round", () => {
    const r = runSnapEngine({
      point: { x: 123.4, y: 567.8 },
      mode: "wall",
      plan,
      view,
      modifiers: { alt: true },
      options: { snapOn: true, snapGrid: true, snapStep: 50 },
    });
    expect(r.point.x).toBe(123);
    expect(r.point.y).toBe(568);
    expect(r.type).toBe(SNAP_TYPES.GRID);
  });
});
