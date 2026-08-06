/**
 * PHASE 2E FOLLOW-UP 1 (M4) — a T-junction must not permanently split its host.
 *
 * Reproduced through the REAL commands before any code was written:
 *   commitDrawnWall into the middle of a 6000 mm host -> host becomes two
 *   records ("host" 0..3000 and a new "wl_*" 3000..6000, both keeping
 *   chainId "host") plus the branch, and the plan shows two 3000 mm
 *   wall-length labels. deleteWall then removed only the branch: the halves
 *   stayed separate, a redundant degree-2 node stayed behind, and the two
 *   labels remained. For the user one wall had permanently become two.
 *
 * deleteWall now heals that in the same atomic operation. These tests drive
 * the shipped commitDrawnWall / deleteWall and the shipped pure helper.
 */
import { describe, it, expect } from "vitest";
import { commitDrawnWall } from "../src/planner/core/walls/wallDrawTopology.js";
import { deleteWall } from "../src/planner/core/walls/wallCommands.js";
import { healCollinearHostAtNode, HOST_HEAL_REASON } from "../src/planner/core/walls/wallHostHeal.js";
import { tryMergeWallEdge, resolvePlanWalls } from "../src/planner/wallNetwork.js";
import { generateWallDimensions } from "../src/planner/core/dimensions/generateWallDimensions.js";

// The helper takes the merge primitive as an argument instead of importing it:
// it lives in CAD Core and wallNetwork.js does not, so a direct import would
// breach the dependency boundary (tests/plannerDependencyBoundary.test.js).
// deleteWall passes exactly this same function.
const healAt = (plan, nodeId) =>
  healCollinearHostAtNode(plan, { nodeId, mergeWallEdge: tryMergeWallEdge });

let seq = 0;
const makeId = (p = "id") => `${p}_${++seq}`;
const WBASE = { thk: 100, role: "partition", kind: "new", thicknessSide: "center", height: 3000, material: "", type: "wall" };

const basePlan = (nodes, walls) => ({
  nodes, walls,
  items: [], rooms: [], zones: [], links: [], labels: [], lines: [],
  dimensions: [], validationWarnings: [],
  room: { w: 12000, h: 9000, wallThk: 100, height: 3000 },
});

/** one straight 6000 mm host, exactly as the user starts */
const oneHost = () => basePlan(
  { hA: { x: 0, y: 0 }, hB: { x: 6000, y: 0 } },
  [{ ...WBASE, id: "host", a: "hA", b: "hB", chainId: "host" }],
);

/** Centreline segment lengths — heal proof (open T has no room auto dims). */
const wallLengths = (plan) => resolvePlanWalls(plan)
  .map((w) => {
    const a = w.pts[0];
    const b = w.pts[w.pts.length - 1];
    return Math.round(Math.hypot(b.x - a.x, b.y - a.y));
  })
  .sort((a, b) => a - b);

const degreeOf = (plan, nodeId) => (plan.walls || [])
  .filter((w) => w.a === nodeId || w.b === nodeId).length;

/** draw a branch into the host body at x, through the real command */
function drawBranch(plan, x = 3000, y = 3000) {
  const known = new Set(plan.walls.map((w) => w.id));
  const r = commitDrawnWall(plan, { x, y: 0 }, { x, y }, { ...WBASE }, makeId);
  expect(r.changed, `draw failed: ${r.reason}`).toBe(true);
  // the NEW off-axis wall, not just any wall with y != 0 (earlier branches
  // are still there when several are drawn)
  const branch = r.plan.walls.find((w) => {
    if (known.has(w.id)) return false;
    const A = r.plan.nodes[w.a]; const B = r.plan.nodes[w.b];
    return A.y !== 0 || B.y !== 0;
  });
  expect(branch, "no new branch wall was created").toBeTruthy();
  return { plan: r.plan, branchId: branch.id };
}

describe("M4 — draw a branch into a host", () => {
  it("1./2./3. the host splits into two records that SHARE one lineage", () => {
    const { plan } = drawBranch(oneHost());
    const halves = plan.walls.filter((w) => plan.nodes[w.a].y === 0 && plan.nodes[w.b].y === 0);
    expect(halves).toHaveLength(2);
    expect(new Set(halves.map((w) => w.chainId))).toEqual(new Set(["host"]));
    for (const f of ["thk", "role", "kind", "height", "material", "thicknessSide"]) {
      expect(halves[0][f], f).toBe(halves[1][f]);
    }
    expect(degreeOf(plan, halves[0].b === halves[1].a ? halves[0].b : halves[0].a)).toBe(3);
  });
});

describe("M4 — deleting the last branch heals the host", () => {
  it("5./6./7./8./9. one wall, no redundant node, one total length, same endpoints", () => {
    const start = oneHost();
    const before = wallLengths(start);
    const { plan: withT, branchId } = drawBranch(start);
    expect(wallLengths(withT)).toEqual([3000, 3000, 3000]); // two halves + branch

    const del = deleteWall(withT, branchId);
    expect(del.changed).toBe(true);
    const after = del.plan;

    expect(after.walls, "host did not heal back to one wall").toHaveLength(1);   // 5.
    expect(Object.keys(after.nodes)).toHaveLength(2);                            // 6.
    expect(after.walls[0].a).toBe("hA");                                         // 7.
    expect(after.walls[0].b).toBe("hB");
    expect(after.nodes.hA).toEqual({ x: 0, y: 0 });
    expect(after.nodes.hB).toEqual({ x: 6000, y: 0 });
    expect(wallLengths(after), "one total wall length").toEqual(before);          // 9.
    expect(wallLengths(after)).toEqual([6000]);
    for (const f of ["thk", "role", "kind", "height", "material", "thicknessSide", "chainId"]) {
      expect(after.walls[0][f], f).toBe(start.walls[0][f]);                       // 8.
    }
  });

  it("20. the healed plan has no orphan node, duplicate edge or zero-length wall", () => {
    const { plan: withT, branchId } = drawBranch(oneHost());
    const after = deleteWall(withT, branchId).plan;
    const used = new Set(after.walls.flatMap((w) => [w.a, w.b]));
    expect([...Object.keys(after.nodes)].filter((n) => !used.has(n))).toEqual([]);
    const keys = after.walls.map((w) => [w.a, w.b].sort().join("|"));
    expect(new Set(keys).size).toBe(keys.length);
    for (const w of after.walls) {
      const A = after.nodes[w.a]; const B = after.nodes[w.b];
      expect(Math.hypot(B.x - A.x, B.y - A.y)).toBeGreaterThan(1);
    }
  });

  it("21. deleteWall does not mutate the plan it is given", () => {
    const { plan: withT, branchId } = drawBranch(oneHost());
    const snapshot = JSON.stringify(withT);
    deleteWall(withT, branchId);
    expect(JSON.stringify(withT)).toBe(snapshot);
  });

  it("22. the result does not depend on wall array order", () => {
    const { plan: withT, branchId } = drawBranch(oneHost());
    const a = deleteWall(withT, branchId).plan;
    const b = deleteWall({ ...withT, walls: [...withT.walls].reverse() }, branchId).plan;
    const fp = (p) => p.walls.map((w) => `${p.nodes[w.a].x},${p.nodes[w.a].y}->${p.nodes[w.b].x},${p.nodes[w.b].y}`).sort().join(";");
    expect(fp(b)).toBe(fp(a));
    expect(a.walls).toHaveLength(1);
  });

  it("10./11./12. undo restores the exact T, redo heals again, reload is stable", () => {
    const start = oneHost();
    const { plan: withT, branchId } = drawBranch(start);
    const snapshotT = JSON.stringify(withT);              // this is what undo restores
    const healed = deleteWall(withT, branchId).plan;
    expect(healed.walls).toHaveLength(1);
    // undo == the untouched base plan object, still intact because the command is pure
    expect(JSON.stringify(withT)).toBe(snapshotT);
    // redo: replaying the same delete on the restored state heals identically
    const again = deleteWall(JSON.parse(snapshotT), branchId).plan;
    expect(again.walls).toHaveLength(1);
    expect(wallLengths(again)).toEqual([6000]);
    // reload parity
    expect(wallLengths(JSON.parse(JSON.stringify(healed)))).toEqual([6000]);
  });
});

describe("M4 — the heal only fires when it is provably the same wall", () => {
  it("14./15. with two branches, deleting one does NOT heal through the other", () => {
    let p = oneHost();
    const first = drawBranch(p, 2000, 2500); p = first.plan;
    const second = drawBranch(p, 4000, 2500); p = second.plan;
    const wallsWithBoth = p.walls.length;
    const afterOne = deleteWall(p, first.branchId).plan;
    // the second branch still needs its own node: only the first junction heals
    expect(afterOne.walls.length).toBe(wallsWithBoth - 2);   // branch removed + two halves merged
    expect(afterOne.walls.filter((w) => afterOne.nodes[w.a].y === 0 && afterOne.nodes[w.b].y === 0)).toHaveLength(2);
    // deleting the last branch heals the rest
    const afterBoth = deleteWall(afterOne, second.branchId).plan;
    expect(afterBoth.walls).toHaveLength(1);
    expect(wallLengths(afterBoth)).toEqual([6000]);
  });

  it("16. incompatible thickness fails closed", () => {
    const { plan: withT, branchId } = drawBranch(oneHost());
    const halves = withT.walls.filter((w) => withT.nodes[w.a].y === 0 && withT.nodes[w.b].y === 0);
    const tweaked = { ...withT, walls: withT.walls.map((w) => (w.id === halves[1].id ? { ...w, thk: 250 } : w)) };
    const after = deleteWall(tweaked, branchId).plan;
    expect(after.walls).toHaveLength(2);
    // probe the helper on the post-delete plan, where the node really is degree 2
    const node = halves[0].b === halves[1].a ? halves[0].b : halves[0].a;
    expect(healAt(after, node).reason).toBe(HOST_HEAL_REASON.PROPERTY_MISMATCH);
  });

  it("17. incompatible role fails closed", () => {
    const { plan: withT, branchId } = drawBranch(oneHost());
    const halves = withT.walls.filter((w) => withT.nodes[w.a].y === 0 && withT.nodes[w.b].y === 0);
    const tweaked = { ...withT, walls: withT.walls.map((w) => (w.id === halves[1].id ? { ...w, role: "outer" } : w)) };
    expect(deleteWall(tweaked, branchId).plan.walls).toHaveLength(2);
  });

  it("lineage mismatch fails closed — two walls the user drew separately never fuse", () => {
    // same geometry as a split host, but no shared chainId
    const p = basePlan(
      { a: { x: 0, y: 0 }, m: { x: 3000, y: 0 }, b: { x: 6000, y: 0 }, t: { x: 3000, y: 2000 } },
      [
        { ...WBASE, id: "w1", a: "a", b: "m", chainId: "w1" },
        { ...WBASE, id: "w2", a: "m", b: "b", chainId: "w2" },
        { ...WBASE, id: "br", a: "m", b: "t", chainId: "br" },
      ],
    );
    expect(deleteWall(p, "br").plan.walls).toHaveLength(2);
    expect(healAt(deleteWall(p, "br").plan, "m").reason)
      .toBe(HOST_HEAL_REASON.LINEAGE_MISMATCH);
  });

  it("18. a real corner is never dissolved", () => {
    const p = basePlan(
      { a: { x: 0, y: 0 }, m: { x: 3000, y: 0 }, b: { x: 3000, y: 3000 }, t: { x: 5000, y: 1500 } },
      [
        { ...WBASE, id: "c1", a: "a", b: "m", chainId: "corner" },
        { ...WBASE, id: "c2", a: "m", b: "b", chainId: "corner" },
        { ...WBASE, id: "br", a: "m", b: "t", chainId: "br" },
      ],
    );
    const after = deleteWall(p, "br").plan;
    expect(after.walls, "the corner must survive as two walls").toHaveLength(2);
    expect(healAt(after, "m").reason).toBe(HOST_HEAL_REASON.NOT_COLLINEAR);
  });

  it("19. a degree-4 node never merges", () => {
    const p = basePlan(
      { a: { x: 0, y: 0 }, m: { x: 3000, y: 0 }, b: { x: 6000, y: 0 }, up: { x: 3000, y: 2000 }, dn: { x: 3000, y: -2000 } },
      [
        { ...WBASE, id: "h1", a: "a", b: "m", chainId: "host" },
        { ...WBASE, id: "h2", a: "m", b: "b", chainId: "host" },
        { ...WBASE, id: "u", a: "m", b: "up", chainId: "u" },
        { ...WBASE, id: "d", a: "m", b: "dn", chainId: "d" },
      ],
    );
    const after = deleteWall(p, "u").plan;   // still degree 3 -> no heal
    expect(after.walls).toHaveLength(3);
    expect(healAt(p, "m").reason).toBe(HOST_HEAL_REASON.DEGREE_NOT_TWO);
  });

  it("the pure helper never mutates its input", () => {
    const { plan: withT, branchId } = drawBranch(oneHost());
    const after = deleteWall(withT, branchId).plan;
    const snapshot = JSON.stringify(after);
    healAt(after, "hA");
    expect(JSON.stringify(after)).toBe(snapshot);
  });
});
