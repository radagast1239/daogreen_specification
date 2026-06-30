import { describe, expect, it } from "vitest";
import { stemTeeGapsOnSegment, teeOutlineTrimAtPoint, otherWallsAtPoint } from "../src/planner/wallJoins.js";
import { weldWallNodes } from "../src/planner/wallGeometry.js";

describe("wallJoins", () => {
  it("creates gap on host wall where stem ends", () => {
    const host = { id: "h", thk: 100, pts: [{ x: 0, y: 2000 }, { x: 8000, y: 2000 }] };
    const stem = { id: "v", thk: 100, pts: [{ x: 4000, y: 2000 }, { x: 4000, y: 5000 }] };
    const walls = weldWallNodes([host, stem]);
    const gaps = stemTeeGapsOnSegment(walls[0].pts[0], walls[0].pts[1], "h", walls);
    expect(gaps.length).toBeGreaterThan(0);
  });

  it("trims stem outline at tee host", () => {
    const host = { id: "h", thk: 100, pts: [{ x: 0, y: 2000 }, { x: 8000, y: 2000 }] };
    const stem = { id: "v", thk: 100, pts: [{ x: 4000, y: 2000 }, { x: 4000, y: 5000 }] };
    const walls = weldWallNodes([host, stem]);
    const trim = teeOutlineTrimAtPoint(stem.pts[0], stem.pts[1], stem.pts[0], walls, "v");
    expect(trim).not.toBeNull();
    expect(trim.t0).toBeGreaterThan(0);
  });

  it("does not treat L corner as tee", () => {
    const walls = weldWallNodes([
      { id: "h", thk: 100, pts: [{ x: 0, y: 2000 }, { x: 4000, y: 2000 }] },
      { id: "v", thk: 100, pts: [{ x: 4000, y: 2000 }, { x: 4000, y: 5000 }] },
    ]);
    const corner = walls[0].pts[1];
    expect(otherWallsAtPoint(walls, corner, "h")).toBe(1);
    expect(teeOutlineTrimAtPoint(walls[0].pts[0], walls[0].pts[1], corner, walls, "h")).toBeNull();
  });
});
