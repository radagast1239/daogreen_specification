import { describe, expect, it } from "vitest";
import {
  createWallDraftState,
  wallDraftStart,
  wallDraftAddSegment,
  wallDraftBackspace,
  wallDraftFinishPts,
  wallDraftCancel,
} from "../src/planner/core/walls/wallDraft.js";
import { normalizeWalls } from "../src/planner/core/walls/wallNormalize.js";
import { runSnapEngine } from "../src/planner/core/snap/snapEngine.js";
import { SNAP_TYPES } from "../src/planner/core/snap/snapTypes.js";
import { applyNetworkWallSegMove } from "../src/planner/wallNetwork.js";

function endpointCountAt(walls, p, thr = 12) {
  let n = 0;
  (walls || []).forEach((w) => {
    const pts = w.pts || [];
    if (!pts.length) return;
    if (Math.hypot(pts[0].x - p.x, pts[0].y - p.y) <= thr) n += 1;
    if (Math.hypot(pts[pts.length - 1].x - p.x, pts[pts.length - 1].y - p.y) <= thr) n += 1;
  });
  return n;
}

describe("wall tool CAD behavior", () => {
  it("wall draft keeps continuous chain", () => {
    let s = createWallDraftState();
    s = wallDraftStart(s, { x: 0, y: 0 });
    s = wallDraftAddSegment(s, { x: 3000, y: 0 }).state;
    s = wallDraftAddSegment(s, { x: 3000, y: 2000 }).state;
    const pts = wallDraftFinishPts(s);
    expect(pts).toEqual([{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 2000 }]);
  });

  it("Enter behavior: finish chain returns points", () => {
    let s = createWallDraftState();
    s = wallDraftStart(s, { x: 0, y: 0 });
    s = wallDraftAddSegment(s, { x: 2000, y: 0 }).state;
    expect(wallDraftFinishPts(s)).toHaveLength(2);
  });

  it("Esc behavior: cancels draft chain", () => {
    let s = createWallDraftState();
    s = wallDraftStart(s, { x: 0, y: 0 });
    s = wallDraftAddSegment(s, { x: 2000, y: 0 }).state;
    const cleared = wallDraftCancel(s);
    expect(cleared.pts).toEqual([]);
  });

  it("Backspace removes last point", () => {
    let s = createWallDraftState();
    s = wallDraftStart(s, { x: 0, y: 0 });
    s = wallDraftAddSegment(s, { x: 2000, y: 0 }).state;
    s = wallDraftAddSegment(s, { x: 2000, y: 1200 }).state;
    const out = wallDraftBackspace(s).state;
    expect(out.pts).toEqual([{ x: 0, y: 0 }, { x: 2000, y: 0 }]);
  });

  it("T-joint produces split endpoint node", () => {
    const walls = normalizeWalls([
      { id: "host", thk: 100, pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }] },
      { id: "stem", thk: 100, pts: [{ x: 2000, y: -1200 }, { x: 2000, y: 0 }] },
    ]);
    expect(endpointCountAt(walls, { x: 2000, y: 0 })).toBeGreaterThanOrEqual(3);
  });

  it("X intersection splits both walls at crossing", () => {
    const walls = normalizeWalls([
      { id: "h", thk: 100, pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }] },
      { id: "v", thk: 100, pts: [{ x: 2000, y: -1500 }, { x: 2000, y: 1500 }] },
    ]);
    expect(endpointCountAt(walls, { x: 2000, y: 0 })).toBeGreaterThanOrEqual(4);
  });

  it("duplicate wall is not created after normalize", () => {
    const walls = normalizeWalls([
      { id: "a", thk: 100, pts: [{ x: 0, y: 0 }, { x: 3000, y: 0 }] },
      { id: "b", thk: 100, pts: [{ x: 0, y: 0 }, { x: 3000, y: 0 }] },
    ]);
    expect(walls.length).toBe(1);
  });

  it("Shift fixes angle", () => {
    const r = runSnapEngine({
      point: { x: 1500, y: 1100 },
      mode: "wall",
      plan: { walls: [], room: { w: 10000, h: 8000 } },
      view: { zoom: 0.1 },
      modifiers: { shift: true },
      options: {
        snapOn: true,
        angleSnapOn: true,
        snapGrid: false,
        snapWalls: false,
        from: { x: 0, y: 0 },
      },
    });
    expect(r.angleSnap?.isSnapped).toBe(true);
  });

  it("Alt disables snap", () => {
    const r = runSnapEngine({
      point: { x: 123.7, y: 456.2 },
      mode: "wall",
      plan: { walls: [], room: { w: 10000, h: 8000 } },
      view: { zoom: 0.1 },
      modifiers: { alt: true },
      options: { snapOn: true, snapGrid: true, snapWalls: true, snapStep: 50 },
    });
    expect(r.type).toBe(SNAP_TYPES.GRID);
    expect(r.point).toEqual({ x: 124, y: 456 });
  });

  it("midpoint drag moves segment parallel", () => {
    const plan = {
      nodes: {
        n1: { x: 0, y: 0 },
        n2: { x: 4000, y: 0 },
      },
      walls: [{ id: "w1", a: "n1", b: "n2", thk: 100, role: "partition" }],
    };
    const moved = applyNetworkWallSegMove(plan, "w1", { x: 0, y: 500 }, { x: 4000, y: 500 });
    expect(moved.nodes.n1.x).toBeCloseTo(0);
    expect(moved.nodes.n2.x).toBeCloseTo(4000);
    expect(moved.nodes.n1.y).toBeCloseTo(500);
    expect(moved.nodes.n2.y).toBeCloseTo(500);
  });
});

