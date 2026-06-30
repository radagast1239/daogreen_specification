import { describe, expect, it } from "vitest";
import {
  snapAngle, resolveDraftPoint, DEFAULT_ANGLE_TOLERANCE_DEG,
} from "../src/planner/core/snap/index.js";

describe("core/snap angleSnap", () => {
  const from = { x: 0, y: 0 };

  it("snaps to horizontal within tolerance", () => {
    const raw = { x: 4000, y: 120 };
    const result = snapAngle(from, raw, { snapOn: true, angleSnapOn: true, toleranceDeg: DEFAULT_ANGLE_TOLERANCE_DEG });
    expect(result.isSnapped).toBe(true);
    expect(result.snappedAngle).toBe(0);
    expect(result.snappedEnd.y).toBeCloseTo(0, 0);
  });

  it("snaps to vertical within tolerance", () => {
    const raw = { x: 80, y: 3000 };
    const result = snapAngle(from, raw, { snapOn: true, angleSnapOn: true, toleranceDeg: DEFAULT_ANGLE_TOLERANCE_DEG });
    expect(result.isSnapped).toBe(true);
    expect(result.snappedAngle).toBe(90);
  });

  it("resolveDraftPoint returns point and angleSnap", () => {
    const { point, angleSnap } = resolveDraftPoint(from, { x: 2000, y: 0 }, { snapOn: true });
    expect(point.x).toBeGreaterThan(0);
    expect(angleSnap).toBeTruthy();
  });

  it("hard shift forces axis snap", () => {
    const raw = { x: 2000, y: 1500 };
    const result = snapAngle(from, raw, { shiftHard: true, snapOn: true });
    expect(result.isSnapped).toBe(true);
    expect([0, 45, 90, 135, 180]).toContain(result.snappedAngle);
  });
});
