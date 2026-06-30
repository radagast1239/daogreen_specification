import { describe, expect, it } from "vitest";
import {
  createWallDraftState, wallDraftStart, wallDraftAddSegment, wallDraftFinishPts,
} from "../src/planner/core/walls/wallDraft.js";
import { normalizeWalls, DEFAULT_MERGE_VERTEX_MM, wallsCollinearOverlap } from "../src/planner/core/walls/wallNormalize.js";
import { createWallChain, normalizeWall } from "../src/planner/core/walls/wallModel.js";
import { weldWallNodes, breakWallAt } from "../src/planner/core/walls/wallOps.js";

describe("core/walls CAD", () => {
  function seededRand(seed = 1) {
    let x = seed >>> 0;
    return () => {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return ((x >>> 0) % 10_000) / 10_000;
    };
  }

  function overlapCount(walls) {
    let overlaps = 0;
    for (let i = 0; i < walls.length; i++) {
      for (let j = i + 1; j < walls.length; j++) {
        const a0 = walls[i].pts?.[0];
        const a1 = walls[i].pts?.[walls[i].pts.length - 1];
        const b0 = walls[j].pts?.[0];
        const b1 = walls[j].pts?.[walls[j].pts.length - 1];
        if (!a0 || !a1 || !b0 || !b1) continue;
        if (wallsCollinearOverlap(a0, a1, b0, b1)) overlaps += 1;
      }
    }
    return overlaps;
  }

  it("wall draft creates continuous chain", () => {
    let s = createWallDraftState();
    s = wallDraftStart(s, { x: 0, y: 0 });
    s = wallDraftAddSegment(s, { x: 4000, y: 0 }).state;
    s = wallDraftAddSegment(s, { x: 4000, y: 3000 }).state;
    const pts = wallDraftFinishPts(s);
    expect(pts).toHaveLength(3);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[2]).toEqual({ x: 4000, y: 3000 });
  });

  it("close points merge", () => {
    const walls = [
      { id: "a", thk: 100, pts: [{ x: 0, y: 0 }, { x: 4000, y: 3 }] },
      { id: "b", thk: 100, pts: [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }] },
    ];
    const out = weldWallNodes(walls, DEFAULT_MERGE_VERTEX_MM);
    expect(out[0].pts[1].x).toBeCloseTo(out[1].pts[0].x, 0);
    expect(out[0].pts[1].y).toBeCloseTo(out[1].pts[0].y, 0);
  });

  it("T-joint splits existing segment", () => {
    const wall = { id: "w", thk: 100, pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }] };
    const parts = breakWallAt(wall, { x: 2000, y: 0 });
    expect(parts).toHaveLength(2);
    expect(parts[0].pts).toHaveLength(2);
    expect(parts[1].pts).toHaveLength(2);
  });

  it("overlapping wall does not duplicate after normalize", () => {
    const w = { id: "w1", thk: 100, pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }] };
    const dup = { id: "w2", thk: 100, pts: [{ x: 1000, y: 0 }, { x: 3000, y: 0 }] };
    const out = normalizeWalls([w, dup]);
    expect(out.length).toBeGreaterThan(0);
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a0 = out[i].pts[0];
        const a1 = out[i].pts[out[i].pts.length - 1];
        const b0 = out[j].pts[0];
        const b1 = out[j].pts[out[j].pts.length - 1];
        expect(wallsCollinearOverlap(a0, a1, b0, b1)).toBeNull();
      }
    }
  });

  it("wall keeps thickness", () => {
    const w = createWallChain(
      [{ x: 0, y: 0 }, { x: 4000, y: 0 }],
      { thk: 250, material: "bearing" },
      () => "wl1",
    );
    expect(w.thk).toBe(250);
    expect(normalizeWall(w).type).toBe("wall");
  });

  it("normalizeWalls is stable on dense random networks", () => {
    const rnd = seededRand(42);
    for (let n = 0; n < 30; n++) {
      const walls = [];
      const count = 18 + Math.floor(rnd() * 14);
      for (let i = 0; i < count; i++) {
        const x1 = Math.round(rnd() * 8000);
        const y1 = Math.round(rnd() * 5000);
        let x2 = Math.round(rnd() * 8000);
        let y2 = Math.round(rnd() * 5000);
        if (Math.hypot(x2 - x1, y2 - y1) < 350) x2 += 600;
        walls.push({ id: `r-${n}-${i}`, thk: 100, pts: [{ x: x1, y: y1 }, { x: x2, y: y2 }] });
      }
      const beforeOverlap = overlapCount(walls);
      const once = normalizeWalls(walls);
      expect(once.length).toBeGreaterThan(0);
      expect(once.length).toBeLessThanOrEqual(count * 8);
      once.forEach((w) => {
        const p0 = w.pts?.[0];
        const p1 = w.pts?.[w.pts.length - 1];
        expect(Number.isFinite(p0?.x)).toBe(true);
        expect(Number.isFinite(p0?.y)).toBe(true);
        expect(Number.isFinite(p1?.x)).toBe(true);
        expect(Number.isFinite(p1?.y)).toBe(true);
      });
      const afterOverlap = overlapCount(once);
      expect(afterOverlap).toBeLessThanOrEqual(Math.max(2, beforeOverlap + 4));
    }
  });
});
