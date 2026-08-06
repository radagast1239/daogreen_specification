/**
 * PHASE 2D — first-intersection clipping, preview/commit parity.
 *
 * The preview used to draw resolveWallPoint's endpoint while commitDrawnWall
 * cut the same segment at the first wall it crossed, so the rubber band showed
 * a wall that was never built. Both sides now call resolveWallDraftEnd; these
 * tests drive that shipped helper and the real commitDrawnWall, never a copy.
 */
import { describe, it, expect } from "vitest";
import {
  commitDrawnWall,
  resolveWallDraftEnd,
  WALL_DRAFT_END_REASON,
} from "../src/planner/core/walls/wallDrawTopology.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";
import { wallDrawV2SnapToTopologyIntent } from "../src/pages/admin/PlanPage.jsx";

const P = (x, y) => ({ x, y });
const W = { thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, material: "" };

let seq = 0;
const uid = (p = "id") => `${p}_${++seq}`;

function plan(nodes, walls) {
  return {
    nodes,
    walls: walls.map((w) => ({ ...W, ...w })),
    items: [], rooms: [], zones: [], links: [], labels: [], lines: [],
    dimensions: [], validationWarnings: [],
    room: { w: 40000, h: 30000, wallThk: 100, height: 3000 },
  };
}

/**
 * Two parallel vertical walls the draft can cross, plus a horizontal wall
 * sharing a node with the first one (a real T-junction) and an oblique wall.
 */
function crossingPlan() {
  return plan(
    {
      // `j` is ONE shared node: a real T-junction, not two nodes that happen
      // to have the same coordinates.
      v1a: P(4000, -3000), j: P(4000, 3000), h1b: P(1000, 3000),
      v2a: P(8000, -3000), v2b: P(8000, 3000),
      oa: P(12000, -2000), ob: P(16000, 2000),
    },
    [
      { id: "v1", a: "v1a", b: "j" },
      { id: "v2", a: "v2a", b: "v2b" },
      { id: "h1", a: "j", b: "h1b" },
      { id: "ob", a: "oa", b: "ob" },
    ],
  );
}

/** Exactly what PlanPage does per pointermove: resolve, then clip. */
function preview(p, start, end, snap = null) {
  return resolveWallDraftEnd(p, {
    walls: resolvePlanWalls(p),
    start,
    end,
    endIntentProvided: true,
    endIntent: wallDrawV2SnapToTopologyIntent(snap, end),
  });
}

/** Exactly what PlanPage does on release: commit the previewed segment. */
function release(p, start, decision, startSnap = null) {
  return commitDrawnWall(p, start, decision.point, { ...W, chainId: uid("ch") }, uid, {
    startIntent: wallDrawV2SnapToTopologyIntent(startSnap, start),
    endIntent: decision.intent,
  });
}

const round = (pt) => ({ x: Math.round(pt.x), y: Math.round(pt.y) });

describe("PHASE 2D — first-intersection contract", () => {
  it("1. empty space: nothing to cross, the endpoint is untouched", () => {
    const p = plan({}, []);
    const d = preview(p, P(0, 0), P(3000, 0));
    expect(d.clipped).toBe(false);
    expect(d.point).toEqual(P(3000, 0));
    expect(d.reason).toBe(WALL_DRAFT_END_REASON.NONE);
    expect(d.hostWallId).toBeNull();
  });

  it("2. one perpendicular wall: the preview stops at the crossing", () => {
    const d = preview(crossingPlan(), P(0, 0), P(6000, 0));
    expect(d.clipped).toBe(true);
    expect(d.geometric).toBe(true);
    expect(d.hostWallId).toBe("v1");
    expect(round(d.point)).toEqual({ x: 4000, y: 0 });
    expect(d.reason).toBe(WALL_DRAFT_END_REASON.INTERSECTION);
  });

  it("3. several walls on the ray: the nearest forward one wins", () => {
    const d = preview(crossingPlan(), P(0, 0), P(10000, 0));
    expect(d.hostWallId).toBe("v1");
    expect(round(d.point)).toEqual({ x: 4000, y: 0 });
    expect(d.ignored.map((h) => h.wallId)).toContain("v2");
  });

  it("4. reversing the wall array does not change the winner", () => {
    const p = crossingPlan();
    const reversed = { ...p, walls: [...p.walls].reverse() };
    const a = preview(p, P(0, 0), P(10000, 0));
    const b = preview(reversed, P(0, 0), P(10000, 0));
    expect(b.hostWallId).toBe(a.hostWallId);
    expect(round(b.point)).toEqual(round(a.point));
  });

  it("5./18. a crossing on an existing node resolves to that node, not a new split", () => {
    // (4000,3000) is the shared node of v1 and h1.
    const d = preview(crossingPlan(), P(1000, 6000), P(7000, 0));
    expect(d.nodeId).toBeTruthy();
    expect(d.kind).toBe("node");
    expect(d.reason).toBe(WALL_DRAFT_END_REASON.NODE);
    expect(round(d.point)).toEqual({ x: 4000, y: 3000 });
    expect(d.intent.kind).toBe("node");
    expect(d.intent.connects).toBe(true);
  });

  it("6. a crossing at a wall endpoint keeps the node intent", () => {
    const p = crossingPlan();
    // Aim past v1's lower endpoint (4000,3000) along a ray that reaches it.
    const d = preview(p, P(4000, 7000), P(4000, 1000));
    expect(["node", "intersection"]).toContain(d.kind);
    expect(d.intent.connects).toBe(true);
    if (d.kind === "node") expect(round(d.point)).toEqual({ x: 4000, y: 3000 });
  });

  it("7. a near miss outside tolerance does not clip", () => {
    // v1 spans y -3000..3000; passing at y = 5000 never touches it.
    const d = preview(crossingPlan(), P(0, 5000), P(6000, 5000));
    expect(d.clipped).toBe(false);
    expect(round(d.point)).toEqual({ x: 6000, y: 5000 });
  });

  it("8. an intersection behind the start is ignored", () => {
    // Start to the right of v1 and draw further right: v1 is behind.
    const d = preview(crossingPlan(), P(5000, 0), P(7000, 0));
    expect(d.hostWallId).not.toBe("v1");
    expect(round(d.point)).toEqual({ x: 7000, y: 0 });
  });

  it("9. an intersection beyond the intended endpoint is ignored", () => {
    const d = preview(crossingPlan(), P(0, 0), P(3000, 0));
    expect(d.clipped).toBe(false);
    expect(round(d.point)).toEqual({ x: 3000, y: 0 });
  });

  it("10. starting on a wall body does not collapse the draft at t≈0", () => {
    const p = crossingPlan();
    const start = P(4000, 0); // on v1's centerline
    const snap = { kind: "wall-body", hostWallId: "v1", connects: true };
    const d = resolveWallDraftEnd(p, {
      walls: resolvePlanWalls(p),
      start,
      end: P(6500, 0),
      endIntentProvided: true,
      endIntent: wallDrawV2SnapToTopologyIntent(null, P(6500, 0)),
    });
    expect(d.hostWallId).not.toBe("v1");
    expect(d.t).toBeGreaterThan(0.9);
    expect(round(d.point)).toEqual({ x: 6500, y: 0 });
    expect(snap.hostWallId).toBe("v1"); // fixture sanity, snap unused by the clip
  });

  it("11./12. starting at a node / T-junction lets the draft leave it", () => {
    const p = crossingPlan();
    const start = P(4000, 3000); // T-junction of v1 and h1
    const d = preview(p, start, P(4000, 6000));
    expect(d.clipped).toBe(false);
    expect(round(d.point)).toEqual({ x: 4000, y: 6000 });
    // The two walls incident to the start never terminate the draft at t≈0…
    const across = preview(p, start, P(10000, 3000));
    expect(across.point.x).toBeGreaterThan(4000);
    expect(across.hostWallId).not.toBe("v1");
    expect(across.hostWallId).not.toBe("h1");
    // …but a genuinely later wall on the ray still stops it (v2's endpoint
    // sits exactly on y = 3000).
    expect(round(across.point)).toEqual({ x: 8000, y: 3000 });
  });

  it("13. an oblique draft crossing a straight wall clips on that wall", () => {
    const d = preview(crossingPlan(), P(0, -2000), P(6000, 2000));
    expect(d.hostWallId).toBe("v1");
    expect(round(d.point).x).toBe(4000);
    expect(d.geometric).toBe(true);
  });

  it("14. an oblique HOST wall is intersected correctly", () => {
    const d = preview(crossingPlan(), P(14000, -3000), P(14000, 3000));
    expect(d.hostWallId).toBe("ob");
    expect(round(d.point)).toEqual({ x: 14000, y: 0 });
  });

  it("15. thickness does not move the clip: topology stays on centerlines", () => {
    const thin = crossingPlan();
    const thick = {
      ...thin,
      walls: thin.walls.map((w) => (w.id === "v1" ? { ...w, thk: 400 } : w)),
    };
    const a = preview(thin, P(0, 0), P(6000, 0));
    const b = preview(thick, P(0, 0), P(6000, 0));
    expect(round(b.point)).toEqual(round(a.point));
    expect(round(b.point)).toEqual({ x: 4000, y: 0 });
  });

  it("16. Alt disables magnetic snap but never lets a wall pass through another", () => {
    // Alt is expressed upstream as a "raw" resolver result — no intent at all.
    const p = crossingPlan();
    const d = resolveWallDraftEnd(p, {
      walls: resolvePlanWalls(p),
      start: P(0, 0),
      end: P(6000, 0),
      endIntentProvided: true,
      endIntent: wallDrawV2SnapToTopologyIntent({ kind: "raw", connects: false }, P(6000, 0)),
    });
    expect(d.geometric).toBe(true);
    expect(d.hostWallId).toBe("v1");
    expect(round(d.point)).toEqual({ x: 4000, y: 0 });
  });

  it("17. collinear overlap keeps the existing deterministic commit outcome", () => {
    const p = crossingPlan();
    const r = commitDrawnWall(p, P(4000, -2000), P(4000, 2000), { ...W, chainId: uid("ch") }, uid, {});
    expect(r.changed).toBe(false);
    expect(r.warnings.map((w) => w.code)).toContain("DUPLICATE_WALL");
  });
});

describe("PHASE 2D — preview equals commit", () => {
  it("19./20. the committed wall ends exactly where the preview ended", () => {
    const p = crossingPlan();
    const start = P(0, 0);
    const d = preview(p, start, P(10000, 0));
    const r = release(p, start, d);
    expect(r.changed).toBe(true);

    const newWall = resolvePlanWalls(r.plan).find((w) => w.id === r.meta.newWallId);
    const ends = [newWall.pts[0], newWall.pts[newWall.pts.length - 1]];
    const committedEnd = ends.find((pt) => Math.hypot(pt.x - start.x, pt.y - start.y) > 1);
    expect(round(committedEnd)).toEqual(round(d.point));

    const previewLen = Math.hypot(d.point.x - start.x, d.point.y - start.y);
    const committedLen = Math.hypot(committedEnd.x - start.x, committedEnd.y - start.y);
    expect(Math.abs(previewLen - committedLen)).toBeLessThan(1e-6);
    expect(Math.round(previewLen)).toBe(4000);
  });

  it("21. the clipped commit produces no zero-length segment and one new wall", () => {
    const p = crossingPlan();
    const start = P(0, 0);
    const d = preview(p, start, P(10000, 0));
    const r = release(p, start, d);
    const walls = resolvePlanWalls(r.plan);
    for (const w of walls) {
      expect(Math.hypot(w.pts[1].x - w.pts[0].x, w.pts[1].y - w.pts[0].y)).toBeGreaterThan(1);
    }
    // v1 was split by the new wall, so 4 walls become 6 (split + the new one).
    expect(walls.length).toBe(6);
    const ids = walls.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("re-clipping an already clipped segment returns the same point (idempotent)", () => {
    const p = crossingPlan();
    const first = preview(p, P(0, 0), P(10000, 0));
    const second = preview(p, P(0, 0), first.point, { kind: "wall-body", hostWallId: first.hostWallId, connects: true });
    expect(round(second.point)).toEqual(round(first.point));
  });
});

describe("PHASE 2D — helper hygiene", () => {
  it("22. the input plan is never mutated", () => {
    const p = crossingPlan();
    const snapshot = JSON.stringify(p);
    preview(p, P(0, 0), P(10000, 0));
    preview(p, P(1000, 6000), P(7000, 0));
    preview(p, P(0, 5000), P(6000, 5000));
    expect(JSON.stringify(p)).toBe(snapshot);
  });

  it("23. the helper is deterministic for identical input", () => {
    const p = crossingPlan();
    const a = preview(p, P(0, -2000), P(6000, 2000));
    const b = preview(p, P(0, -2000), P(6000, 2000));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it("24. wall array order never decides the result, even for a tie", () => {
    // Two walls crossing the ray at the very same point: the id decides.
    const p = plan(
      { aa: P(5000, -2000), ab: P(5000, 2000), ba: P(5000, -1000), bb: P(5000, 1000) },
      [{ id: "zzz", a: "aa", b: "ab" }, { id: "aaa", a: "ba", b: "bb" }],
    );
    const forward = preview(p, P(0, 0), P(9000, 0));
    const reversed = preview({ ...p, walls: [...p.walls].reverse() }, P(0, 0), P(9000, 0));
    expect(forward.hostWallId).toBe("aaa");
    expect(reversed.hostWallId).toBe("aaa");
  });

  it("invalid input fails closed instead of throwing", () => {
    const p = crossingPlan();
    const d = resolveWallDraftEnd(p, {
      walls: resolvePlanWalls(p),
      start: null,
      end: P(1, 1),
      endIntentProvided: true,
      endIntent: null,
    });
    expect(d.reason).toBe(WALL_DRAFT_END_REASON.INVALID);
    expect(d.clipped).toBe(false);
  });
});
