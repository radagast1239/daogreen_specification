/**
 * PHASE 2F1 — pass-through candidate scan.
 *
 * Proves the scanner flags walls beyond the first host, ignores valid T ends,
 * ignores intentional noded crossings, and that legacy repair never
 * reintroduces beyond-host geometry. Every case is a constructed fixture.
 */
import { describe, expect, it } from "vitest";
import {
  scanPassThroughCandidates,
  formatPassThroughScanReport,
} from "../src/planner/core/walls/passThroughCandidateScan.js";
import {
  commitWallThroughCanonicalDrawPath,
  resolveWallDraftEnd,
} from "../src/planner/core/walls/wallDrawTopology.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";
import { classifyPlanTopologyAnomalies } from "../src/planner/core/walls/legacyTopologyAudit.js";
import { repairLegacyTopology } from "../src/planner/core/walls/legacyTopologyRepair.js";
import { moveWallSegment } from "../src/planner/core/walls/wallCommands.js";

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
  return (prefix) => `pts_${prefix}_${++n}`;
}

function rectRoom() {
  return {
    nodes: {
      ul: { x: 0, y: 0 },
      ur: { x: 8000, y: 0 },
      lr: { x: 8000, y: 5000 },
      ll: { x: 0, y: 5000 },
    },
    walls: [
      { id: "top", a: "ul", b: "ur", ...props("top") },
      { id: "right", a: "ur", b: "lr", ...props("right") },
      { id: "bot", a: "lr", b: "ll", ...props("bot") },
      { id: "left", a: "ll", b: "ul", ...props("left") },
    ],
    items: [],
    dimensions: [],
    rooms: [],
    zones: [],
  };
}

describe("PHASE 2F1 pass-through candidate scan", () => {
  it("1. detects a wall extending beyond the first host intersection", () => {
    const plan = rectRoom();
    // Malformed: partition recorded past the lower host with no host split.
    plan.nodes.pa = { x: 4000, y: 0 };
    plan.nodes.pb = { x: 4000, y: 6500 }; // 1500 mm beyond y=5000
    plan.walls.push({
      id: "bad",
      a: "pa",
      b: "pb",
      ...props("bad", "partition"),
    });
    const { candidates, primary } = scanPassThroughCandidates(plan);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    expect(primary.wallId).toBe("bad");
    expect(primary.distanceBeyondFirstClipMm).toBeGreaterThan(100);
    expect(
      primary.reasons.some((r) => r.startsWith("E_") || r.startsWith("F_")),
    ).toBe(true);
    expect(primary.firstCanonicalClip.y).toBeCloseTo(5000, 0);
  });

  it("2. does not flag a valid wall ending at the host", () => {
    const plan = rectRoom();
    const makeId = idFactory(10);
    const r = commitWallThroughCanonicalDrawPath(
      plan,
      { x: 4000, y: 0 },
      { x: 4000, y: 5500 },
      props("good", "partition"),
      makeId,
    );
    expect(r.changed).toBe(true);
    const { candidates } = scanPassThroughCandidates(r.plan);
    const bad = candidates.filter((c) => c.role === "partition" && c.distanceBeyondFirstClipMm > 2);
    expect(bad).toEqual([]);
  });

  it("3. does not flag intentional crossings modeled with topology nodes", () => {
    // Open cross: four arms meeting at a shared centre node — intentional.
    const plan = {
      nodes: {
        n: { x: 0, y: 0 },
        e: { x: 3000, y: 0 },
        s: { x: 0, y: 3000 },
        w: { x: -3000, y: 0 },
        c: { x: 0, y: 0 },
      },
      walls: [
        { id: "armE", a: "c", b: "e", ...props("armE", "partition") },
        { id: "armS", a: "c", b: "s", ...props("armS", "partition") },
        { id: "armW", a: "c", b: "w", ...props("armW", "partition") },
        { id: "armN", a: "c", b: "n", ...props("armN", "partition") },
      ],
      items: [],
      dimensions: [],
      rooms: [],
      zones: [],
    };
    // Fix north node distinct from centre
    plan.nodes.n = { x: 0, y: -3000 };
    const { candidates } = scanPassThroughCandidates(plan);
    const trueBeyond = candidates.filter((c) => c.distanceBeyondFirstClipMm > 2);
    expect(trueBeyond).toEqual([]);
  });

  it("4. canonical V2 preview endpoint equals repaired persisted endpoint", () => {
    const plan = rectRoom();
    const makeId = idFactory(20);
    const intended = { x: 4000, y: 6500 };
    const preview = resolveWallDraftEnd(plan, {
      walls: resolvePlanWalls(plan),
      start: { x: 4000, y: 0 },
      end: intended,
      endIntentProvided: true,
      endIntent: {
        kind: "none",
        point: intended,
        nodeId: null,
        wallId: null,
        hostWallId: null,
        connects: false,
      },
    });
    const r = commitWallThroughCanonicalDrawPath(
      plan,
      { x: 4000, y: 0 },
      intended,
      props("repaired", "partition"),
      makeId,
    );
    const part = resolvePlanWalls(r.plan).find((w) => w.role === "partition");
    const end = part.pts[0].y < part.pts[1].y ? part.pts[1] : part.pts[0];
    expect(end.y).toBeCloseTo(preview.point.y, 5);
    expect(end.x).toBeCloseTo(preview.point.x, 5);
    expect(end.y).toBeCloseTo(5000, 5);
  });

  it("5. exactly one partition remains after canonical repair of a beyond-host wall", () => {
    const plan = rectRoom();
    plan.nodes.pa = { x: 4000, y: 0 };
    plan.nodes.pb = { x: 4000, y: 6500 };
    plan.walls.push({ id: "bad", a: "pa", b: "pb", ...props("bad", "partition") });
    // Repair = delete malformed + redraw via canonical path
    const without = {
      ...plan,
      walls: plan.walls.filter((w) => w.id !== "bad"),
      nodes: { ...plan.nodes },
    };
    delete without.nodes.pa;
    delete without.nodes.pb;
    // prune only the free tip; keep host nodes
    without.nodes = {
      ul: plan.nodes.ul,
      ur: plan.nodes.ur,
      lr: plan.nodes.lr,
      ll: plan.nodes.ll,
    };
    const r = commitWallThroughCanonicalDrawPath(
      without,
      { x: 4000, y: 0 },
      { x: 4000, y: 6500 },
      props("fixed", "partition"),
      idFactory(30),
    );
    const parts = r.plan.walls.filter((w) => w.role === "partition");
    expect(parts).toHaveLength(1);
    const { candidates } = scanPassThroughCandidates(r.plan);
    expect(candidates.filter((c) => c.distanceBeyondFirstClipMm > 2)).toEqual([]);
  });

  // Tests 6-7 and 9 (live-project pass-through scan) used to live here. They
  // read one user's transient project from C:/tmp and asserted its wall ids,
  // so they silently passed on every other machine. Scanning the live project
  // is a mega-test concern; the same contract is proven deterministically on a
  // constructed overshoot fixture below.
  it("6-7. repair never reintroduces beyond-host geometry", () => {
    const plan = rectRoom();
    const r = commitWallThroughCanonicalDrawPath(
      plan,
      { x: 3000, y: 0 },
      { x: 3000, y: 9000 }, // deliberate overshoot past the far host
      props("beyond", "partition"),
      idFactory(70),
    );
    const repaired = repairLegacyTopology(r.plan, { makeId: idFactory(90) });
    const after = repaired.plan || repaired;
    const scan = scanPassThroughCandidates(after);
    expect(scan.candidates.filter((c) => c.distanceBeyondFirstClipMm > 2)).toEqual([]);
    // Repair must preserve, not delete, the partition it healed.
    expect(after.walls.some((w) => w.role === "partition")).toBe(true);
    // Keep the report formatter exercised so its contract cannot rot.
    const report = formatPassThroughScanReport({ projectId: "fixture", revision: 1, plan: after, scan });
    expect(typeof report).toBe("string");
    expect(report.length).toBeGreaterThan(0);
  });

  it("8. double-T movement constraints remain accepted on a clean dual-host partition", () => {
    const plan = rectRoom();
    const makeId = idFactory(40);
    const r = commitWallThroughCanonicalDrawPath(
      plan,
      { x: 4000, y: 0 },
      { x: 4000, y: 5500 },
      props("dt", "partition"),
      makeId,
    );
    const part = r.plan.walls.find((w) => w.role === "partition");
    // Vertical pass-through attempt must fail closed / no change.
    const makeIdMove = idFactory(41);
    const moved = moveWallSegment(r.plan, {
      wallId: part.id,
      delta: { x: 500, y: 0 },
      makeId: makeIdMove,
    });
    // Either unchanged or still on both hosts without beyond-host geometry.
    const after = moved.plan || r.plan;
    const scan = scanPassThroughCandidates(after);
    expect(scan.candidates.filter((c) => c.distanceBeyondFirstClipMm > 2)).toEqual([]);
  });

});
