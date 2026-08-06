import { describe, expect, it } from "vitest";
import {
  collectSnapCandidates,
  resolveWallPoint,
  runSnapEngine,
  SNAP_TYPES,
} from "../src/planner/core/snap/index.js";

const P = (x, y) => ({ x, y });
const node = (point, nodeId, source = "node-candidate") => ({
  kind: "node",
  type: SNAP_TYPES.VERTEX,
  point,
  nodeId,
  source,
});
const wallEnd = (point, wallId, nodeId = null, source = "wall-end-candidate") => ({
  kind: "wall-end",
  type: SNAP_TYPES.WALL_END,
  point,
  wallId,
  nodeId,
  source,
});
const wallBody = ({ y = 0, wallId = "wb", thk = 100, source = "wall-body-candidate" } = {}) => ({
  kind: "wall-body",
  type: SNAP_TYPES.WALL_LINE,
  point: P(0, y),
  a: P(-5000, y),
  b: P(5000, y),
  hostWallId: wallId,
  wallThicknessMm: thk,
  source,
});
const angle = (point) => ({ type: SNAP_TYPES.ANGLE, point, distance: 0, source: "angle-candidate" });
const grid = (point) => ({ type: SNAP_TYPES.GRID, point, distance: 0, source: "grid-candidate" });

describe("PHASE 2B1 — pure wall point resolver", () => {
  it("1. rejects a node 1400 mm away at zoom 0.08 despite legacy screen-invariant reach", () => {
    const result = resolveWallPoint({ point: P(0, 0), role: "start", zoom: 0.08, candidates: [node(P(1400, 0), "far")] });
    expect(result).toMatchObject({ point: P(0, 0), kind: "raw", connects: false });
  });

  it("2. accepts an 8 px node intention at any zoom where it is also within 85 mm", () => {
    // PHASE 2D1: the screen radius alone is no longer sufficient. 8 px is
    // ~40 mm at zoom 0.2 and 8 mm at zoom 1 — both inside NODE_LINK_THR — so
    // the capture is screen-invariant across the range a user actually draws in.
    for (const zoom of [0.2, 0.5, 1]) {
      const point = P(8 / zoom, 0);
      const result = resolveWallPoint({ point: P(0, 0), role: "start", zoom, candidates: [node(point, `n-${zoom}`)] });
      expect(result.kind).toBe("node");
      expect(result.distancePx).toBeCloseTo(8, 8);
    }
    // At an overview zoom the same 8 px is ~100 mm, beyond the topology
    // tolerance, so it must NOT capture — this is the 2D1 defect fix.
    const overview = resolveWallPoint({
      point: P(0, 0), role: "start", zoom: 0.08, candidates: [node(P(8 / 0.08, 0), "n-far")],
    });
    expect(overview.kind).not.toBe("node");
    expect(overview.connects).toBe(false);
  });

  it("3. has no giant high-zoom magnet: 25 mm is 75 px at zoom 3", () => {
    const result = resolveWallPoint({ point: P(0, 0), role: "start", zoom: 3, candidates: [node(P(25, 0), "n25")] });
    expect(result.kind).toBe("raw");
  });

  it("4. chooses a wall body 5 mm away over an eligible node 200 mm away", () => {
    const result = resolveWallPoint({
      point: P(0, 0),
      role: "start",
      zoom: 0.05,
      candidates: [node(P(200, 0), "n200"), wallBody({ y: 5, thk: 0 })],
    });
    expect(result).toMatchObject({ kind: "wall-body", point: P(0, 5), hostWallId: "wb" });
  });

  it("5. applies node -> wall-end -> wall-body tie-break inside 2 px", () => {
    const result = resolveWallPoint({
      point: P(0, 0),
      role: "start",
      zoom: 1,
      candidates: [wallBody({ y: 0, thk: 0 }), wallEnd(P(1, 0), "we"), node(P(1.9, 0), "n")],
    });
    expect(result).toMatchObject({ kind: "node", nodeId: "n", point: P(1.9, 0) });
  });

  it("6. treats a point inside visible wall mass as a hit and projects to centerline", () => {
    const result = resolveWallPoint({ point: P(123, 40), role: "start", zoom: 1, candidates: [wallBody({ thk: 100 })] });
    expect(result).toMatchObject({
      kind: "wall-body",
      point: P(123, 0),
      connects: true,
      faceDistanceMm: 0,
      axisDistanceMm: 40,
    });
  });

  it("7. accepts a wall body outside visible mass but within 12 px of the face", () => {
    const result = resolveWallPoint({ point: P(0, 100), role: "start", zoom: 0.2, candidates: [wallBody({ thk: 100 })] });
    expect(result).toMatchObject({ kind: "wall-body", point: P(0, 0), faceDistanceMm: 50, faceDistancePx: 10 });
  });

  it("8. rejects a wall body farther than 12 px from the visible face", () => {
    const result = resolveWallPoint({ point: P(0, 120), role: "start", zoom: 0.2, candidates: [wallBody({ thk: 100 })] });
    expect(result.kind).toBe("raw");
  });

  it("8b. rejects wall body beyond half-thickness + 250 mm even at tiny zoom", () => {
    const result = resolveWallPoint({ point: P(0, 301), role: "start", zoom: 0.01, candidates: [wallBody({ thk: 100 })] });
    expect(result.kind).toBe("raw");
  });

  it("9. does not let an angle overwrite an eligible topology candidate", () => {
    const result = resolveWallPoint({
      point: P(0, 0), from: P(-100, -100), role: "end", zoom: 0.08,
      // 80 mm is inside NODE_LINK_THR, so this is a genuinely ELIGIBLE
      // topology candidate — which is what this test is about.
      candidates: [angle(P(0, 0)), node(P(80, 0), "n")],
    });
    expect(result.kind).toBe("node");
  });

  it("10. does not let grid overwrite an eligible topology candidate", () => {
    const result = resolveWallPoint({ point: P(0, 0), role: "start", zoom: 0.08, candidates: [grid(P(0, 0)), node(P(80, 0), "n")] });
    expect(result.kind).toBe("node");
  });

  it("11. applies identical topology eligibility to start and end roles", () => {
    const candidates = [wallEnd(P(100, 0), "w", "n")];
    const start = resolveWallPoint({ point: P(0, 0), role: "start", zoom: 0.08, candidates });
    const end = resolveWallPoint({ point: P(0, 0), from: P(-1000, 0), role: "end", zoom: 0.08, candidates });
    expect(start).toEqual(end);
  });

  it("12. ignores a directional angle candidate for start without from", () => {
    const result = resolveWallPoint({ point: P(13, 17), role: "start", zoom: 1, candidates: [angle(P(10, 10))] });
    expect(result).toMatchObject({ kind: "raw", point: P(13, 17) });
  });

  it("13. Alt returns 1 mm-rounded raw with no topology metadata", () => {
    const result = resolveWallPoint({
      point: P(123.4, 567.8), role: "start", zoom: 1,
      modifiers: { alt: true }, candidates: [node(P(123, 568), "n")],
    });
    expect(result).toMatchObject({
      point: P(123, 568), kind: "raw", nodeId: null, wallId: null, hostWallId: null,
      connects: false, source: "alt-raw",
    });
  });

  it("13b. preserves Shift hard-angle for end while topology still wins", () => {
    const directional = resolveWallPoint({
      point: P(1000, 700), from: P(0, 0), role: "end", zoom: 0.1,
      plan: {}, modifiers: { shift: true }, grid: { enabled: false }, options: { snapWalls: false },
    });
    expect(["axis", "angle"]).toContain(directional.kind);
    expect(directional.connects).toBe(false);

    const plan = {
      nodes: { n1: P(1000, 700), n2: P(2000, 700) },
      walls: [{ id: "w1", a: "n1", b: "n2", thk: 100 }],
    };
    const topology = resolveWallPoint({
      point: P(1000, 700), from: P(0, 0), role: "end", zoom: 0.1,
      plan, modifiers: { shift: true }, grid: { enabled: false }, options: { snapWalls: true },
    });
    expect(topology).toMatchObject({ kind: "node", nodeId: "n1", connects: true });
  });

  it("14. Ctrl preserves fine-grid semantics without changing magnetic limits", () => {
    const base = { point: P(23, 27), role: "start", zoom: 1, plan: {}, options: { snapWalls: false }, grid: { step: 50, fineStep: 10 } };
    const normal = resolveWallPoint(base);
    const fine = resolveWallPoint({ ...base, modifiers: { ctrl: true } });
    expect(normal).toMatchObject({ kind: "grid", point: P(0, 50) });
    expect(fine).toMatchObject({ kind: "grid", point: P(20, 30) });
  });

  it("15. returns raw when every topology candidate is outside its thresholds", () => {
    const result = resolveWallPoint({
      point: P(9, 11), role: "start", zoom: 0.1,
      candidates: [node(P(300, 0), "n"), wallEnd(P(0, 300), "w")],
    });
    expect(result).toMatchObject({ kind: "raw", point: P(9, 11), distanceMm: 0, distancePx: 0 });
  });

  it("16. returns exact deterministic topology ids, connectivity and sources", () => {
    const plan = {
      nodes: { n1: P(100, 0), n2: P(500, 0) },
      walls: [{ id: "w1", a: "n1", b: "n2", thk: 80 }],
    };
    const n = resolveWallPoint({ point: P(99, 0), role: "start", zoom: 1, plan, candidates: [node(P(101, 1), "n1", "existing-node")] });
    const e = resolveWallPoint({ point: P(499, 0), role: "end", from: P(0, 0), zoom: 1, plan, candidates: [wallEnd(P(500, 0), "w1", null, "existing-end")] });
    const b = resolveWallPoint({ point: P(250, 20), role: "start", zoom: 1, plan, candidates: [{ ...wallBody({ wallId: "w1", source: "existing-body" }), a: undefined, b: undefined }] });
    expect(n).toMatchObject({ point: P(100, 0), kind: "node", nodeId: "n1", wallId: null, hostWallId: null, connects: true, source: "existing-node" });
    expect(e).toMatchObject({ point: P(500, 0), kind: "wall-end", nodeId: "n2", wallId: "w1", hostWallId: null, connects: true, source: "existing-end" });
    expect(b).toMatchObject({ point: P(250, 0), kind: "wall-body", nodeId: null, wallId: null, hostWallId: "w1", connects: true, source: "existing-body" });
  });

  it("17. is deterministic when candidate array order changes", () => {
    const candidates = [wallBody({ y: 10, thk: 0 }), wallEnd(P(11, 0), "w-end"), node(P(12, 0), "n")];
    const input = { point: P(0, 0), role: "start", zoom: 0.1 };
    expect(resolveWallPoint({ ...input, candidates })).toEqual(resolveWallPoint({ ...input, candidates: [...candidates].reverse() }));
  });

  it("18. does not mutate plan, candidates or nested points", () => {
    const plan = { nodes: { a: P(-100, 0), b: P(100, 0) }, walls: [{ id: "w", a: "a", b: "b", thk: 100 }] };
    const candidates = [wallBody({ wallId: "w" }), node(P(40, 0), "n")];
    const beforePlan = structuredClone(plan);
    const beforeCandidates = structuredClone(candidates);
    resolveWallPoint({ point: P(0, 20), role: "start", zoom: 1, plan, candidates });
    expect(plan).toEqual(beforePlan);
    expect(candidates).toEqual(beforeCandidates);
  });

  it("19. preserves representative legacy runSnapEngine outputs and candidate order", () => {
    const plan = { walls: [{ id: "w1", thk: 100, pts: [P(0, 0), P(4000, 0)] }], room: { w: 12000, h: 8000 } };
    const input = {
      point: P(20, 10), mode: "wall", plan, view: { zoom: 0.1 }, modifiers: {},
      options: { snapOn: true, snapWalls: true, snapGrid: true, snapStep: 50 },
    };
    const collected = collectSnapCandidates(input);
    expect(collected.candidates.map((candidate) => candidate.type)).toEqual([
      SNAP_TYPES.VERTEX,
      SNAP_TYPES.WALL_LINE,
      SNAP_TYPES.GRID,
    ]);
    const result = runSnapEngine(input);
    expect(result).toMatchObject({ point: P(0, 0), type: SNAP_TYPES.VERTEX, targetId: "w1:0", snapped: true });
  });

  it("20. preserves the legacy screen-invariant zoom regression", () => {
    const plan = { walls: [{ id: "w1", thk: 100, pts: [P(0, 0), P(4000, 0)] }], room: { w: 12000, h: 8000 } };
    for (const zoom of [0.08, 0.2, 0.5]) {
      const result = runSnapEngine({
        point: P(60 / zoom, 0), mode: "wall", plan, view: { zoom },
        options: { snapOn: true, snapWalls: true, snapGrid: false, snapDistancePx: 10 },
      });
      expect(result).toMatchObject({ snapped: true, type: SNAP_TYPES.VERTEX, point: P(0, 0) });
    }
  });
});
