import { describe, expect, it } from "vitest";
import {
  createWallDraftState,
  wallDraftStart,
  wallDraftAddSegment,
  wallDraftFinishMeta,
  wallDraftCloseLoop,
} from "../src/planner/core/walls/wallDraft.js";
import { nudgeWallInPlan, resolvePlanWalls } from "../src/planner/wallNetwork.js";
import { commitWallChain } from "../src/planner/core/walls/wallCommit.js";
import { hitTestWallBody, pickWallBodyHit, wallInteractionAt } from "../src/planner/core/walls/wallOps.js";
import { generateWallDimensions } from "../src/planner/core/dimensions/generateWallDimensions.js";

let idSeq = 0;
const makeId = (p) => `${p}-${++idSeq}`;

describe("WALL-BUGFIX-001 closed room draft", () => {
  it("wall draft close creates final closing segment", () => {
    let s = createWallDraftState();
    s = wallDraftStart(s, { x: 0, y: 0 });
    s = wallDraftAddSegment(s, { x: 4000, y: 0 }).state;
    s = wallDraftAddSegment(s, { x: 4000, y: 3000 }).state;
    s = wallDraftAddSegment(s, { x: 0, y: 3000 }).state;
    const closed = wallDraftCloseLoop(s, { x: 0, y: 0 });
    expect(closed.closed).toBe(true);
    const meta = wallDraftFinishMeta(closed.state);
    expect(meta.closed).toBe(true);
    expect(meta.pts).toEqual([
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000, y: 3000 },
      { x: 0, y: 3000 },
    ]);
    const plan = commitWallChain(
      { nodes: {}, walls: [], room: { w: 10000, h: 8000 } },
      meta.pts,
      { thk: 100, role: "outer" },
      makeId,
      { closed: true },
    );
    expect(plan.walls.length).toBe(4);
    const resolved = resolvePlanWalls(plan);
    expect(resolved.length).toBe(4);
  });

  it("close to first point reuses first node without duplicate within snap tolerance", () => {
    let s = createWallDraftState();
    s = wallDraftStart(s, { x: 0, y: 0 });
    s = wallDraftAddSegment(s, { x: 2000, y: 0 }).state;
    s = wallDraftAddSegment(s, { x: 2000, y: 2000 }).state;
    s = wallDraftCloseLoop(s, { x: 5, y: 5 }).state;
    const meta = wallDraftFinishMeta(s);
    expect(meta.pts.length).toBe(3);
    expect(meta.pts[0].x).toBe(0);
    expect(meta.pts[0].y).toBe(0);
    const last = meta.pts[meta.pts.length - 1];
    expect(Math.hypot(last.x - meta.pts[0].x, last.y - meta.pts[0].y)).toBeGreaterThan(100);
  });
});

describe("WALL-BUGFIX-001 wall body hit-test", () => {
  const walls = [
    { id: "w1", thk: 100, pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }] },
  ];

  it("point inside wall body selects wall", () => {
    expect(hitTestWallBody({ x: 2000, y: 35 }, walls[0], walls, null)).toBeTruthy();
    const pick = pickWallBodyHit({ x: 2000, y: 35 }, walls, null);
    expect(pick?.wall.id).toBe("w1");
    const hit = wallInteractionAt(walls[0], { x: 2000, y: 35 }, 1, { allWalls: walls, room: null });
    expect(hit.kind === "wall" || hit.kind === "segment").toBe(true);
  });

  it("point on wall border selects wall", () => {
    const hit = wallInteractionAt(walls[0], { x: 2000, y: 48 }, 1, { allWalls: walls, room: null });
    expect(["wall", "segment"]).toContain(hit.kind);
  });

  it("point outside wall body does not select wall", () => {
    expect(hitTestWallBody({ x: 2000, y: 250 }, walls[0], walls, null)).toBeNull();
    const hit = wallInteractionAt(walls[0], { x: 2000, y: 250 }, 1, { allWalls: walls, room: null });
    expect(hit.kind).toBe("none");
  });

  it("point at wall centerline (y=0) selects wall", () => {
    expect(hitTestWallBody({ x: 2000, y: 0 }, walls[0], walls, null)).toBeTruthy();
  });

  it("point near outer face (y=-45) selects wall", () => {
    expect(hitTestWallBody({ x: 2000, y: -45 }, walls[0], walls, null)).toBeTruthy();
  });

  it("point outside outer face (y=-60) does not select wall", () => {
    expect(hitTestWallBody({ x: 2000, y: -60 }, walls[0], walls, null)).toBeNull();
  });

  it("pickWallBodyHit detects center click and returns correct wall", () => {
    const pick = pickWallBodyHit({ x: 2000, y: 0 }, walls, null);
    expect(pick?.wall.id).toBe("w1");
  });
});

describe("WALL-BUGFIX-001 wall nudge", () => {
  const basePlan = () => ({
    nodes: {
      n1: { x: 0, y: 0 },
      n2: { x: 4000, y: 0 },
      n3: { x: 4000, y: 3000 },
    },
    walls: [
      { id: "w1", a: "n1", b: "n2", thk: 100 },
      { id: "w2", a: "n2", b: "n3", thk: 100 },
    ],
    room: {},
  });

  it("nudge selected wall right changes both node.x by +10", () => {
    const out = nudgeWallInPlan(basePlan(), "w1", undefined, 10, 0, (v) => v);
    expect(out.nodes.n1.x).toBe(10);
    expect(out.nodes.n2.x).toBe(4010);
  });

  it("nudge selected wall left changes both node.x by -10", () => {
    const out = nudgeWallInPlan(basePlan(), "w1", undefined, -10, 0, (v) => v);
    expect(out.nodes.n1.x).toBe(-10);
    expect(out.nodes.n2.x).toBe(3990);
  });

  it("nudge selected wall down changes both node.y by +10", () => {
    const out = nudgeWallInPlan(basePlan(), "w1", undefined, 0, 10, (v) => v);
    expect(out.nodes.n1.y).toBe(10);
    expect(out.nodes.n2.y).toBe(10);
  });

  it("nudge selected wall up changes both node.y by -10", () => {
    const out = nudgeWallInPlan(basePlan(), "w1", undefined, 0, -10, (v) => v);
    expect(out.nodes.n1.y).toBe(-10);
    expect(out.nodes.n2.y).toBe(-10);
  });

  it("nudge segment selection (-1) moves wall cardinally", () => {
    const out = nudgeWallInPlan(basePlan(), "w1", -1, 10, 0, (v) => v);
    expect(out.nodes.n1.x).toBe(10);
    expect(out.nodes.n2.x).toBe(4010);
  });

  it("connected walls stay connected by same node ids", () => {
    const out = nudgeWallInPlan(basePlan(), "w1", undefined, 10, 0, (v) => v);
    const w2 = out.walls.find((w) => w.id === "w2");
    expect(w2.a).toBe("n2");
    expect(out.nodes.n2.x).toBe(4010);
    expect(out.nodes.n3.x).toBe(4000);
  });
});

describe("WALL-BUGFIX-001 dimension dedupe", () => {
  it("duplicate dimension for same span is removed", () => {
    const plan = {
      room: { w: 4000, h: 3000 },
      walls: [
        { id: "w1", pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }], thk: 100 },
        { id: "w2", pts: [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }], thk: 100 },
        { id: "w3", pts: [{ x: 4000, y: 3000 }, { x: 0, y: 3000 }], thk: 100 },
        { id: "w4", pts: [{ x: 0, y: 3000 }, { x: 0, y: 0 }], thk: 100 },
      ],
      items: [],
      zones: [],
    };
    const out = generateWallDimensions(plan);
    // wall_length dims are intentionally per-wall (top+bottom can share span), exclude them.
    // PHASE 2F1: external_segment + external_overall intentionally share the same
    // span at different offsets — include kind so the pair is not treated as a duplicate.
    const horiz = out.dimensions.filter((d) => d.orientation === "horizontal" && d.mode === "linear" && d.kind !== "wall_length");
    const keys = horiz.map((d) => {
      const y = Math.round(((d.p1?.y || 0) + (d.p2?.y || 0)) / 2);
      return `${d.kind}:y${y}:${Math.round(Math.min(d.p1.x, d.p2.x))}-${Math.round(Math.max(d.p1.x, d.p2.x))}-${Math.round(Math.hypot(d.p2.x - d.p1.x, d.p2.y - d.p1.y))}`;
    });
    expect(keys.length).toBe(new Set(keys).size);
  });

  it("tiny wall thickness artifact dimension under 100mm is not shown", () => {
    const plan = {
      room: { w: 4000, h: 3000 },
      walls: [
        { id: "w1", pts: [{ x: 0, y: 0 }, { x: 4000, y: 0 }], thk: 100 },
        { id: "w2", pts: [{ x: 4000, y: 0 }, { x: 4000, y: 49 }], thk: 100 },
      ],
      items: [],
      zones: [],
    };
    const out = generateWallDimensions(plan);
    const tiny = out.dimensions.filter((d) => {
      const len = Math.hypot(d.p2.x - d.p1.x, d.p2.y - d.p1.y);
      return len > 0 && len < 100 && (d.kind === "external_segment" || d.kind === "external_overall");
    });
    expect(tiny.length).toBe(0);
  });

  it("single short wall (150 mm) produces no external_segment (removed in WALL-DIMENSIONS-003)", () => {
    const plan = {
      room: { w: 4000, h: 3000 },
      walls: [{ id: "w1", pts: [{ x: 0, y: 0 }, { x: 150, y: 0 }], thk: 100 }],
      items: [],
      zones: [],
    };
    const out = generateWallDimensions(plan);
    const segs = out.dimensions.filter((d) => d.kind === "external_segment");
    expect(segs.length).toBe(0);
  });
});
