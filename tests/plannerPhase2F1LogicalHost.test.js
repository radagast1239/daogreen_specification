/**
 * PHASE 2F1 blocker B — a host split by a T is ONE logical wall.
 *
 * Covers required cases 10-26: selection identity, highlight span, grips,
 * the single central handle, reported length, rigid chain movement with the
 * branch staying attached, one history entry / one write, Undo/Redo/reload
 * parity, delete heal, two branches, and the fail-closed grouping rules.
 *
 * Everything drives the SHIPPED commands (commitDrawnWall / deleteWall /
 * moveLogicalWallChain), not hand-built intermediate states.
 */
import { describe, it, expect } from "vitest";
import { commitDrawnWall } from "../src/planner/core/walls/wallDrawTopology.js";
import { deleteWall, moveLogicalWallChain, setLogicalWallChainProps } from "../src/planner/core/walls/wallCommands.js";
import {
  resolveLogicalWallChain,
  logicalChainEndpointGrips,
  logicalChainWallIds,
  sameLogicalWall,
  LOGICAL_CHAIN_REASON,
} from "../src/planner/core/walls/logicalWallChain.js";
import { logicalChainMoveHandleEligibility } from "../src/planner/core/walls/wallMoveEligibility.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";

let seq = 0;
const makeId = (p = "id") => `${p}_${++seq}`;
const WBASE = {
  thk: 100, role: "partition", kind: "new", thicknessSide: "center",
  height: 3000, material: "", type: "wall",
};

const basePlan = (nodes, walls) => ({
  nodes,
  walls,
  items: [], rooms: [], zones: [], links: [], labels: [], lines: [],
  dimensions: [], validationWarnings: [],
  room: { w: 12000, h: 9000, wallThk: 100, height: 3000 },
});

/** One straight 6000mm host, exactly as the user starts. */
const oneHost = () => basePlan(
  { hA: { x: 0, y: 0 }, hB: { x: 6000, y: 0 } },
  [{ ...WBASE, id: "host", a: "hA", b: "hB", chainId: "host" }],
);

/** Draw a branch into the host body at x — through the REAL command. */
function drawBranch(plan, x = 3000, y = 3000) {
  const known = new Set(plan.walls.map((w) => w.id));
  const r = commitDrawnWall(plan, { x, y: 0 }, { x, y }, { ...WBASE }, makeId);
  expect(r.changed, `draw failed: ${r.reason}`).toBe(true);
  const branch = r.plan.walls.find((w) => {
    if (known.has(w.id)) return false;
    const A = r.plan.nodes[w.a];
    const B = r.plan.nodes[w.b];
    return A.y !== 0 || B.y !== 0;
  });
  expect(branch, "no new branch wall was created").toBeTruthy();
  return { plan: r.plan, branchId: branch.id };
}

const hostSegments = (plan) => plan.walls.filter((w) => w.chainId === "host");
const nodeAt = (plan, x, y, eps = 1) => Object.entries(plan.nodes || {})
  .find(([, p]) => Math.abs(p.x - x) <= eps && Math.abs(p.y - y) <= eps)?.[0] || null;
const pointOf = (plan, nodeId) => plan.nodes[nodeId];

describe("PHASE 2F1 — logical host wall over a T split", () => {
  it("10. a T-split host exposes ONE logical selection identity", () => {
    const { plan } = drawBranch(oneHost());
    const halves = hostSegments(plan);
    expect(halves.length).toBe(2);

    const a = resolveLogicalWallChain(plan, halves[0].id);
    const b = resolveLogicalWallChain(plan, halves[1].id);
    expect(a.segmentCount).toBe(2);
    expect(a.logicalId).toBe(b.logicalId);
    expect(a.reason).toBe(LOGICAL_CHAIN_REASON.OK);
    expect(sameLogicalWall(plan, halves[0].id, halves[1].id)).toBe(true);
  });

  it("11. clicking the LEFT segment selects the full chain", () => {
    const { plan } = drawBranch(oneHost());
    const left = hostSegments(plan)
      .sort((x, y) => pointOf(plan, x.a).x - pointOf(plan, y.a).x)[0];
    expect(logicalChainWallIds(plan, left.id).sort())
      .toEqual(hostSegments(plan).map((w) => w.id).sort());
  });

  it("12. clicking the RIGHT segment selects the full chain", () => {
    const { plan } = drawBranch(oneHost());
    const right = hostSegments(plan)
      .sort((x, y) => pointOf(plan, y.a).x - pointOf(plan, x.a).x)[0];
    expect(logicalChainWallIds(plan, right.id).sort())
      .toEqual(hostSegments(plan).map((w) => w.id).sort());
  });

  it("13. the highlight spans every chain segment, and nothing else", () => {
    const { plan, branchId } = drawBranch(oneHost());
    const ids = logicalChainWallIds(plan, hostSegments(plan)[0].id);
    for (const half of hostSegments(plan)) expect(ids).toContain(half.id);
    expect(ids).not.toContain(branchId);
  });

  it("14-15. no host endpoint grip at the internal T junction; exactly two outer grips", () => {
    const { plan } = drawBranch(oneHost());
    const chain = resolveLogicalWallChain(plan, hostSegments(plan)[0].id);
    const junction = nodeAt(plan, 3000, 0);
    expect(chain.internalNodeIds).toEqual([junction]);

    const grips = logicalChainEndpointGrips(plan, hostSegments(plan)[0].id);
    expect(grips).toHaveLength(2);
    expect(grips.every((g) => g.grip.visible)).toBe(true);
    expect(grips.map((g) => g.nodeId).sort())
      .toEqual([nodeAt(plan, 0, 0), nodeAt(plan, 6000, 0)].sort());
    expect(grips.some((g) => g.nodeId === junction)).toBe(false);
  });

  it("16-17. one central handle at the FULL-chain midpoint, one total length", () => {
    const { plan } = drawBranch(oneHost());
    for (const half of hostSegments(plan)) {
      const handle = logicalChainMoveHandleEligibility(plan, half.id, { tool: "select" });
      expect(handle.eligible).toBe(true);
      expect(handle.segmentCount).toBe(2);
      expect(handle.point.x).toBeCloseTo(3000, 6);
      expect(handle.point.y).toBeCloseTo(0, 6);
      expect(handle.logicalId).toBe(resolveLogicalWallChain(plan, half.id).logicalId);
      expect(resolveLogicalWallChain(plan, half.id).totalLengthMm).toBeCloseTo(6000, 6);
    }
  });

  it("18-19. moving the central handle translates the WHOLE chain and keeps the branch attached", () => {
    const { plan, branchId } = drawBranch(oneHost());
    const chainBefore = resolveLogicalWallChain(plan, hostSegments(plan)[0].id);
    const branchFarBefore = { ...pointOf(plan, plan.walls.find((w) => w.id === branchId).b) };

    const moved = moveLogicalWallChain(plan, {
      wallId: hostSegments(plan)[0].id,
      delta: { x: 0, y: -500 },
      makeId,
    });
    expect(moved.changed, moved.reason).toBe(true);
    expect(moved.reason).toBe("WALL_CHAIN_MOVED");

    const next = moved.plan;
    const chainAfter = resolveLogicalWallChain(next, hostSegments(next)[0].id);
    expect(chainAfter.segmentCount).toBe(2);
    // Rigid: same total length and direction, both outer ends moved.
    expect(chainAfter.totalLengthMm).toBeCloseTo(chainBefore.totalLengthMm, 6);
    expect(chainAfter.a.y).toBeCloseTo(chainBefore.a.y - 500, 6);
    expect(chainAfter.b.y).toBeCloseTo(chainBefore.b.y - 500, 6);
    expect(chainAfter.a.x).toBeCloseTo(chainBefore.a.x, 6);
    expect(chainAfter.b.x).toBeCloseTo(chainBefore.b.x, 6);
    // Internal junction travelled with the host.
    expect(pointOf(next, chainAfter.internalNodeIds[0]).y).toBeCloseTo(-500, 6);

    // Branch still connected at that junction, stretched through it.
    const branch = next.walls.find((w) => w.id === branchId);
    expect(branch).toBeTruthy();
    const branchNodes = [branch.a, branch.b];
    expect(branchNodes).toContain(chainAfter.internalNodeIds[0]);
    const branchFarAfter = pointOf(next, branchNodes.find((n) => n !== chainAfter.internalNodeIds[0]));
    expect(branchFarAfter.x).toBeCloseTo(branchFarBefore.x, 6);
    expect(branchFarAfter.y).toBeCloseTo(branchFarBefore.y, 6);
  });

  it("20. one gesture is one transaction — a single result plan, no intermediate states", () => {
    const { plan } = drawBranch(oneHost());
    const moved = moveLogicalWallChain(plan, {
      wallId: hostSegments(plan)[0].id,
      delta: { x: 0, y: -500 },
      makeId,
    });
    expect(moved.changed).toBe(true);
    // One command, one plan, one movement record covering the whole chain.
    expect(moved.movement.chainWallIds.sort())
      .toEqual(hostSegments(plan).map((w) => w.id).sort());
    expect(moved.movement.delta).toEqual({ x: 0, y: -500 });
    expect(plan.nodes).not.toBe(moved.plan.nodes);
    // The base plan is untouched — Undo can restore it exactly.
    expect(pointOf(plan, nodeAt(plan, 0, 0)).y).toBe(0);
  });

  it("21. Undo/Redo/reload parity — the command never mutates its input", () => {
    const { plan } = drawBranch(oneHost());
    const before = JSON.stringify(plan);
    const moved = moveLogicalWallChain(plan, {
      wallId: hostSegments(plan)[0].id,
      delta: { x: 0, y: -500 },
      makeId,
    });
    expect(JSON.stringify(plan)).toBe(before);

    // Redo from the same base reproduces the same geometry exactly.
    const again = moveLogicalWallChain(JSON.parse(before), {
      wallId: hostSegments(plan)[0].id,
      delta: { x: 0, y: -500 },
      makeId,
    });
    const coords = (p) => Object.values(p.nodes).map((n) => `${n.x}:${n.y}`).sort().join("|");
    expect(coords(again.plan)).toBe(coords(moved.plan));

    // Reload (JSON round trip) resolves the same logical chain.
    const reloaded = JSON.parse(JSON.stringify(moved.plan));
    const chainA = resolveLogicalWallChain(moved.plan, hostSegments(moved.plan)[0].id);
    const chainB = resolveLogicalWallChain(reloaded, hostSegments(reloaded)[0].id);
    expect(chainB.wallIds).toEqual(chainA.wallIds);
    expect(chainB.logicalId).toBe(chainA.logicalId);
    expect(chainB.totalLengthMm).toBeCloseTo(chainA.totalLengthMm, 6);
  });

  it("22. deleting the branch PHYSICALLY heals the host back to one wall", () => {
    const { plan, branchId } = drawBranch(oneHost());
    expect(hostSegments(plan).length).toBe(2);
    const del = deleteWall(plan, branchId);
    expect(del.changed).toBe(true);
    const healed = del.plan;
    expect(healed.walls.filter((w) => w.chainId === "host").length).toBe(1);
    expect(nodeAt(healed, 3000, 0)).toBeNull();
    const chain = resolveLogicalWallChain(healed, healed.walls.find((w) => w.chainId === "host").id);
    expect(chain.segmentCount).toBe(1);
    const only = resolvePlanWalls(healed).find((w) => w.chainId === "host");
    const len = Math.hypot(
      only.pts[only.pts.length - 1].x - only.pts[0].x,
      only.pts[only.pts.length - 1].y - only.pts[0].y,
    );
    expect(Math.round(len)).toBe(6000);
  });

  it("23. two T branches still expose ONE logical host", () => {
    const first = drawBranch(oneHost(), 2000);
    const second = drawBranch(first.plan, 4000);
    const plan = second.plan;
    expect(hostSegments(plan).length).toBe(3);

    const chain = resolveLogicalWallChain(plan, hostSegments(plan)[0].id);
    expect(chain.segmentCount).toBe(3);
    expect(chain.totalLengthMm).toBeCloseTo(6000, 6);
    expect(chain.internalNodeIds).toHaveLength(2);
    expect(logicalChainEndpointGrips(plan, hostSegments(plan)[0].id)).toHaveLength(2);
    const handle = logicalChainMoveHandleEligibility(plan, hostSegments(plan)[2].id, { tool: "select" });
    expect(handle.eligible).toBe(true);
    expect(handle.point.x).toBeCloseTo(3000, 6);
  });

  it("24. removing ONE of two branches must not merge through the remaining junction", () => {
    const first = drawBranch(oneHost(), 2000);
    const second = drawBranch(first.plan, 4000);
    const del = deleteWall(second.plan, first.branchId);
    expect(del.changed).toBe(true);
    // The 2000 junction dissolves; the 4000 junction still carries a branch.
    expect(del.plan.walls.filter((w) => w.chainId === "host").length).toBe(2);
    expect(nodeAt(del.plan, 2000, 0)).toBeNull();
    expect(nodeAt(del.plan, 4000, 0)).toBeTruthy();
    const chain = resolveLogicalWallChain(del.plan, del.plan.walls.find((w) => w.chainId === "host").id);
    expect(chain.segmentCount).toBe(2);
    expect(chain.totalLengthMm).toBeCloseTo(6000, 6);
  });

  it("25. removing the FINAL branch produces one physical host wall", () => {
    const first = drawBranch(oneHost(), 2000);
    const second = drawBranch(first.plan, 4000);
    const afterFirst = deleteWall(second.plan, first.branchId);
    const afterSecond = deleteWall(afterFirst.plan, second.branchId);
    expect(afterSecond.changed).toBe(true);
    expect(afterSecond.plan.walls.filter((w) => w.chainId === "host").length).toBe(1);
    expect(nodeAt(afterSecond.plan, 4000, 0)).toBeNull();
  });

  it("26. a different chainId or incompatible properties prevents accidental grouping", () => {
    const { plan } = drawBranch(oneHost());
    const [first, secondHalf] = hostSegments(plan);

    const foreign = {
      ...plan,
      walls: plan.walls.map((w) => (w.id === secondHalf.id ? { ...w, chainId: "somebody_elses" } : w)),
    };
    expect(resolveLogicalWallChain(foreign, first.id).segmentCount).toBe(1);
    expect(sameLogicalWall(foreign, first.id, secondHalf.id)).toBe(false);

    const thicker = {
      ...plan,
      walls: plan.walls.map((w) => (w.id === secondHalf.id ? { ...w, thk: 250 } : w)),
    };
    expect(resolveLogicalWallChain(thicker, first.id).segmentCount).toBe(1);

    // Two collinear walls that merely touch, with no lineage, are NOT one wall.
    const touching = basePlan(
      { t1: { x: 0, y: 0 }, t2: { x: 3000, y: 0 }, t3: { x: 6000, y: 0 } },
      [
        { ...WBASE, id: "w1", a: "t1", b: "t2" },
        { ...WBASE, id: "w2", a: "t2", b: "t3" },
      ],
    );
    expect(resolveLogicalWallChain(touching, "w1").segmentCount).toBe(1);
    expect(resolveLogicalWallChain(touching, "w1").reason).toBe(LOGICAL_CHAIN_REASON.NO_LINEAGE);
  });

  it("does not dissolve a real corner that shares a chainId (polyline draw)", () => {
    const corner = basePlan(
      { c1: { x: 0, y: 0 }, c2: { x: 3000, y: 0 }, c3: { x: 3000, y: 3000 } },
      [
        { ...WBASE, id: "cw1", a: "c1", b: "c2", chainId: "poly" },
        { ...WBASE, id: "cw2", a: "c2", b: "c3", chainId: "poly" },
      ],
    );
    expect(resolveLogicalWallChain(corner, "cw1").segmentCount).toBe(1);
  });

  it("property commands apply atomically to every chain segment, and only to it", () => {
    const { plan, branchId } = drawBranch(oneHost());
    const r = setLogicalWallChainProps(plan, {
      wallId: hostSegments(plan)[0].id,
      props: { thk: 250, role: "outer" },
    });
    expect(r.changed).toBe(true);
    for (const w of r.plan.walls.filter((x) => x.chainId === "host")) {
      expect(w.thk).toBe(250);
      expect(w.role).toBe("outer");
    }
    const branch = r.plan.walls.find((w) => w.id === branchId);
    expect(branch.thk).toBe(WBASE.thk);
    expect(branch.role).toBe(WBASE.role);
  });

  it("a wall that was never split still behaves exactly as one segment", () => {
    const plan = oneHost();
    const chain = resolveLogicalWallChain(plan, "host");
    expect(chain.segmentCount).toBe(1);
    expect(chain.logicalId).toBe("host");
    expect(chain.internalNodeIds).toEqual([]);
    const moved = moveLogicalWallChain(plan, { wallId: "host", delta: { x: 0, y: 250 }, makeId });
    expect(moved.changed).toBe(true);
    expect(moved.reason).toBe("WALL_SEGMENT_MOVED");
  });
});
