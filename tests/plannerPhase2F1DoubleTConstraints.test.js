/**
 * PHASE 2F1 — double-T (dual parallel host) whole-wall movement contract.
 *
 * A rigid partition teed into two parallel hosts may only translate along their
 * common tangent; the perpendicular component is discarded; finite host spans
 * are intersected and clamped; non-parallel dual attachments are fail-closed.
 */
import { describe, expect, it } from "vitest";
import {
  classifyWallSegmentAttachments,
  moveWallSegment,
  wallSegmentHasMovableDirection,
} from "../src/planner/core/walls/wallCommands.js";
import {
  wallMoveHandleEligibility,
  MOVE_HANDLE_REASON,
} from "../src/planner/core/walls/wallMoveEligibility.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";
import { findUnnodedCrossings } from "../src/planner/core/walls/renderedContours.js";

const props = (chainId, role = "outer") => ({
  thk: 100,
  role,
  kind: "new",
  thicknessSide: "center",
  height: 3000,
  material: "drywall",
  chainId,
  locked: false,
  createdAt: 1,
  updatedAt: 1,
});

function idFactory(seed = 0) {
  let n = seed;
  return (prefix) => `dt_${prefix}_${++n}`;
}

/** S09-shaped: horizontal hosts at y=0 and y=5000, partition at x=4000. */
function parallelDoubleTPlan() {
  return {
    nodes: {
      ul: { x: 0, y: 0 },
      um: { x: 4000, y: 0 },
      ur: { x: 8000, y: 0 },
      ll: { x: 0, y: 5000 },
      lm: { x: 4000, y: 5000 },
      lr: { x: 8000, y: 5000 },
    },
    walls: [
      { id: "top-l", a: "ul", b: "um", ...props("top") },
      { id: "top-r", a: "um", b: "ur", ...props("top") },
      { id: "bot-r", a: "lr", b: "lm", ...props("bot") },
      { id: "bot-l", a: "lm", b: "ll", ...props("bot") },
      { id: "left", a: "ul", b: "ll", ...props("left") },
      { id: "right", a: "ur", b: "lr", ...props("right") },
      { id: "part", a: "um", b: "lm", ...props("part", "partition") },
    ],
    items: [],
    dimensions: [],
    rooms: [],
  };
}

/** One end tee'd into a horizontal host; free lower end. */
function oneEndedTPlan() {
  return {
    nodes: {
      hl: { x: 0, y: 0 },
      hm: { x: 2000, y: 0 },
      hr: { x: 4000, y: 0 },
      tip: { x: 2000, y: 2500 },
    },
    walls: [
      { id: "host-l", a: "hl", b: "hm", ...props("host") },
      { id: "host-r", a: "hm", b: "hr", ...props("host") },
      { id: "branch", a: "hm", b: "tip", ...props("branch", "partition") },
    ],
    items: [],
    dimensions: [],
    rooms: [],
  };
}

/** Dual tee into non-parallel hosts — no rigid translation exists. */
function nonParallelDoubleTPlan() {
  return {
    nodes: {
      h1a: { x: 0, y: 0 },
      h1m: { x: 2000, y: 0 },
      h1b: { x: 4000, y: 0 },
      h2a: { x: 4000, y: 0 },
      h2m: { x: 4000, y: 2000 },
      h2b: { x: 4000, y: 4000 },
    },
    walls: [
      { id: "h1-l", a: "h1a", b: "h1m", ...props("h1") },
      { id: "h1-r", a: "h1m", b: "h1b", ...props("h1") },
      { id: "h2-t", a: "h2a", b: "h2m", ...props("h2") },
      { id: "h2-b", a: "h2m", b: "h2b", ...props("h2") },
      { id: "diag", a: "h1m", b: "h2m", ...props("diag", "partition") },
    ],
    items: [],
    dimensions: [],
    rooms: [],
  };
}

function move(plan, wallId, delta, seed = 0) {
  const expectedEndpointAttachments = classifyWallSegmentAttachments(plan, wallId);
  return moveWallSegment(plan, {
    wallId,
    delta,
    expectedEndpointAttachments,
    makeId: idFactory(seed),
  });
}

function partEnds(plan, wallId = "part") {
  const w = plan.walls.find((x) => x.id === wallId);
  return { a: { ...plan.nodes[w.a] }, b: { ...plan.nodes[w.b] }, aId: w.a, bId: w.b, wall: w };
}

function degree(plan, nodeId) {
  return plan.walls.filter((w) => w.a === nodeId || w.b === nodeId).length;
}

function pointToHostDist(point, hostStart, hostEnd) {
  const dx = hostEnd.x - hostStart.x;
  const dy = hostEnd.y - hostStart.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((point.x - hostStart.x) * dx + (point.y - hostStart.y) * dy) / len2));
  return Math.hypot(point.x - (hostStart.x + dx * t), point.y - (hostStart.y + dy * t));
}

describe("PHASE 2F1 double-T dual-host constraints", () => {
  it("1. parallel double-T moves left", () => {
    const r = move(parallelDoubleTPlan(), "part", { x: -500, y: 0 });
    expect(r.changed).toBe(true);
    expect(r.movement.delta.x).toBeCloseTo(-500, 6);
    expect(r.movement.delta.y).toBeCloseTo(0, 6);
    const { a, b } = partEnds(r.plan);
    expect(a).toEqual({ x: 3500, y: 0 });
    expect(b).toEqual({ x: 3500, y: 5000 });
  });

  it("2. parallel double-T moves right", () => {
    const r = move(parallelDoubleTPlan(), "part", { x: 500, y: 0 });
    expect(r.changed).toBe(true);
    expect(r.movement.delta.x).toBeCloseTo(500, 6);
    expect(r.movement.delta.y).toBeCloseTo(0, 6);
    const { a, b } = partEnds(r.plan);
    expect(a).toEqual({ x: 4500, y: 0 });
    expect(b).toEqual({ x: 4500, y: 5000 });
  });

  it("3. vertical drag returns NO_CHANGE", () => {
    const plan = parallelDoubleTPlan();
    const snap = structuredClone(plan);
    const r = move(plan, "part", { x: 0, y: 400 });
    expect(r.changed).toBe(false);
    expect(r.reason).toBe("NO_CHANGE");
    expect(plan).toEqual(snap);
  });

  it("4. diagonal drag applies only common-tangent projection", () => {
    const r = move(parallelDoubleTPlan(), "part", { x: 400, y: -300 });
    expect(r.changed).toBe(true);
    expect(r.movement.delta.x).toBeCloseTo(400, 6);
    expect(r.movement.delta.y).toBeCloseTo(0, 6);
    const { a, b } = partEnds(r.plan);
    expect(a.y).toBe(0);
    expect(b.y).toBe(5000);
    expect(a.x).toBe(4400);
    expect(b.x).toBe(4400);
  });

  it("5. large drag is clamped to common finite-host interval", () => {
    const r = move(parallelDoubleTPlan(), "part", { x: 6000, y: -2000 });
    // Landing exactly on a host corner collapses the T into a corner merge;
    // clamp keeps a usable interior span (MIN_SEGMENT inset from each end).
    expect(r.changed, r.reason).toBe(true);
    expect(r.movement.delta.y).toBeCloseTo(0, 6);
    expect(r.movement.delta.x).toBeGreaterThan(3000);
    expect(r.movement.delta.x).toBeLessThanOrEqual(4000);
    const { a, b } = partEnds(r.plan);
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.x).toBeGreaterThan(7000);
    expect(a.x).toBeLessThan(8000);
    expect(degree(r.plan, partEnds(r.plan).aId)).toBe(3);
    expect(degree(r.plan, partEnds(r.plan).bId)).toBe(3);
  });

  it("6–7. both endpoints remain on their finite hosts", () => {
    const r = move(parallelDoubleTPlan(), "part", { x: -1200, y: 800 });
    const { a, b } = partEnds(r.plan);
    expect(pointToHostDist(a, { x: 0, y: 0 }, { x: 8000, y: 0 })).toBeLessThan(1e-6);
    expect(pointToHostDist(b, { x: 0, y: 5000 }, { x: 8000, y: 5000 })).toBeLessThan(1e-6);
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.x).toBeLessThanOrEqual(8000);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x).toBeLessThanOrEqual(8000);
  });

  it("8–9. both nodes remain shared topology (degree 3, never degree 1)", () => {
    const r = move(parallelDoubleTPlan(), "part", { x: 700, y: -700 });
    const { aId, bId } = partEnds(r.plan);
    expect(degree(r.plan, aId)).toBe(3);
    expect(degree(r.plan, bId)).toBe(3);
  });

  it("10–11. partition never crosses hosts; length and angle unchanged", () => {
    const before = parallelDoubleTPlan();
    const r = move(before, "part", { x: -300, y: 500 });
    const { a, b } = partEnds(r.plan);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    expect(len).toBeCloseTo(5000, 6);
    expect(Math.abs(a.x - b.x)).toBeLessThan(1e-6);
    expect(a.y).toBe(0);
    expect(b.y).toBe(5000);
    expect(findUnnodedCrossings(resolvePlanWalls(r.plan))).toEqual([]);
  });

  it("12. preview and release use the same moveWallSegment solver result", () => {
    const plan = parallelDoubleTPlan();
    const att = classifyWallSegmentAttachments(plan, "part");
    const preview = moveWallSegment(plan, {
      wallId: "part",
      delta: { x: 250, y: 180 },
      expectedEndpointAttachments: att,
      makeId: idFactory(1),
    });
    const release = moveWallSegment(plan, {
      wallId: "part",
      delta: { x: 250, y: 180 },
      expectedEndpointAttachments: att,
      makeId: idFactory(1),
    });
    expect(preview.changed).toBe(true);
    expect(release.changed).toBe(true);
    expect(preview.movement.delta).toEqual(release.movement.delta);
    expect(partEnds(preview.plan)).toEqual(partEnds(release.plan));
  });

  it("17. non-parallel double constraint is fail-closed", () => {
    const plan = nonParallelDoubleTPlan();
    const att = classifyWallSegmentAttachments(plan, "diag");
    expect(att.start.type).toBe("tee");
    expect(att.end.type).toBe("tee");
    expect(wallSegmentHasMovableDirection(att)).toBe(false);
    const elig = wallMoveHandleEligibility(plan, "diag", { tool: "select" });
    expect(elig.eligible).toBe(false);
    expect(elig.reason).toBe(MOVE_HANDLE_REASON.INCOMPATIBLE_HOST_CONSTRAINTS);
    const snap = structuredClone(plan);
    const r = move(plan, "diag", { x: 100, y: 100 });
    expect(r.changed).toBe(false);
    expect(r.reason).toBe("WALL_MOVE_INCOMPATIBLE_HOST_CONSTRAINTS");
    expect(plan).toEqual(snap);
  });

  it("18. one-ended T contract unchanged (slides on host; outside rejected)", () => {
    const ok = move(oneEndedTPlan(), "branch", { x: 400, y: 0 });
    expect(ok.changed).toBe(true);
    expect(ok.movement.delta).toEqual({ x: 400, y: 0 });
    const tip = ok.plan.nodes[ok.plan.walls.find((w) => w.id === "branch").b];
    expect(tip).toEqual({ x: 2400, y: 2500 });

    const plan = oneEndedTPlan();
    const snap = structuredClone(plan);
    const outside = move(plan, "branch", { x: 5000, y: 0 });
    expect(outside.changed).toBe(false);
    expect(outside.reason).toBe("WALL_MOVE_OUTSIDE_HOST");
    expect(plan).toEqual(snap);
  });

  it("19. ordinary free connected movement unchanged", () => {
    const plan = {
      nodes: { a: { x: 0, y: 0 }, b: { x: 2000, y: 0 } },
      walls: [{ id: "free", a: "a", b: "b", ...props("free", "partition") }],
      items: [],
      dimensions: [],
      rooms: [],
    };
    const r = move(plan, "free", { x: 10, y: 20 });
    expect(r.changed).toBe(true);
    expect(r.plan.nodes.a).toEqual({ x: 10, y: 20 });
    expect(r.plan.nodes.b).toEqual({ x: 2010, y: 20 });
  });
});
