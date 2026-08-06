/**
 * PHASE 2F1 — fixture-specific legacy topology: classify, then repair only
 * what is provable.
 *
 * The reported defects were NOT universal. The real project's audit
 * (C:\tmp\phase2f1-dimensions\good-vs-bad-room-topology.txt) showed most rooms
 * structurally sound and two distinct old-data problems:
 *
 *   room c3h0 — partition d_part with BOTH endpoints lying on a host body but
 *               sharing no node: it moved through its neighbours.
 *   node xc   — two collinear walls the user drew separately, which therefore
 *               never merge when their branches go. That is correct.
 *
 * Fixtures 1-9 are the permanent reproductions required by the phase; the
 * bad-room extract is sanitized but structurally faithful to what is stored.
 */
import { describe, it, expect } from "vitest";
import {
  classifyPlanTopologyAnomalies, classifyPairProvenance, TOPOLOGY_CLASS,
} from "../src/planner/core/walls/legacyTopologyAudit.js";
import {
  repairLegacyTopology, REPAIR_ACTION,
} from "../src/planner/core/walls/legacyTopologyRepair.js";
import {
  classifyWallSegmentAttachments, moveWallSegment, deleteWall,
} from "../src/planner/core/walls/wallCommands.js";
import { generateWallDimensions } from "../src/planner/core/dimensions/generateWallDimensions.js";
import { dimensionKeySet } from "../src/planner/core/dimensions/dimensionCanonicalKeys.js";

let seq = 0;
const makeId = (p = "id") => `${p}_t${++seq}`;
const W = {
  thk: 100, role: "outer", kind: "new", thicknessSide: "center",
  height: 3000, material: "", type: "wall", locked: false,
};
const P = { ...W, role: "partition" };

const basePlan = (nodes, walls) => ({
  nodes,
  walls,
  items: [], rooms: [], zones: [], links: [], labels: [], lines: [],
  dimensions: [], validationWarnings: [],
  room: { w: 24000, h: 9000, wallThk: 100, height: 3000 },
});

const degreeOf = (plan, nodeId) => (plan.walls || [])
  .filter((w) => w.a === nodeId || w.b === nodeId).length;
const classesOf = (plan) => new Set(classifyPlanTopologyAnomalies(plan).anomalies.map((a) => a.class));
const clone = (p) => JSON.parse(JSON.stringify(p));

/* ------------------------------------------------------------ fixtures */

/** 1. known-good connected room — one node per corner, nothing else */
const FIXTURE_GOOD_ROOM = () => basePlan(
  { g1: { x: 0, y: 0 }, g2: { x: 4000, y: 0 }, g3: { x: 4000, y: 3000 }, g4: { x: 0, y: 3000 } },
  [
    { ...W, id: "g_t", a: "g1", b: "g2", chainId: "g_t" },
    { ...W, id: "g_r", a: "g2", b: "g3", chainId: "g_r" },
    { ...W, id: "g_b", a: "g3", b: "g4", chainId: "g_b" },
    { ...W, id: "g_l", a: "g4", b: "g1", chainId: "g_l" },
  ],
);

/** 2. known-good LIVE T split — halves share the host's lineage, branch attached */
const FIXTURE_LIVE_T = () => basePlan(
  {
    t1: { x: 0, y: 0 }, tm: { x: 3000, y: 0 }, t2: { x: 6000, y: 0 },
    tb: { x: 3000, y: 2500 },
  },
  [
    { ...W, id: "host", a: "t1", b: "tm", chainId: "host" },
    { ...W, id: "host_far", a: "tm", b: "t2", chainId: "host" },
    { ...P, id: "branch", a: "tm", b: "tb", chainId: "branch" },
  ],
);

/** 3. the exact bad room as persisted: d_part free at BOTH ends, on two bodies */
const FIXTURE_BAD_ROOM_AS_STORED = () => basePlan(
  {
    d1: { x: 12000, y: 0 }, dm1: { x: 16000, y: 0 },
    d3: { x: 20000, y: 4000 }, d4: { x: 12000, y: 4000 },
    pTop: { x: 13991, y: 0 }, pBot: { x: 13991, y: 4000 },
  },
  [
    { ...W, id: "d_t1", a: "d1", b: "dm1", chainId: "d_t1" },
    { ...W, id: "d_l", a: "d4", b: "d1", chainId: "d_l" },
    { ...W, id: "d_bottom", a: "d3", b: "d4", chainId: "d_b2" },
    { ...P, id: "d_part", a: "pTop", b: "pBot", chainId: "d_part" },
  ],
);

/** 4. true orphan split — one original host, branch long gone */
const FIXTURE_ORPHAN_SPLIT = () => basePlan(
  { o1: { x: 0, y: 0 }, om: { x: 3000, y: 0 }, o2: { x: 6000, y: 0 } },
  [
    { ...W, id: "orphan", a: "o1", b: "om", chainId: "orphan" },
    { ...W, id: "orphan_far", a: "om", b: "o2", chainId: "orphan" },
  ],
);

/** 5. two intentionally independent collinear walls (each its own chain root) */
const FIXTURE_INDEPENDENT_COLLINEAR = () => basePlan(
  { i1: { x: 0, y: 0 }, im: { x: 3000, y: 0 }, i2: { x: 6000, y: 0 } },
  [
    { ...W, id: "left_wall", a: "i1", b: "im", chainId: "left_wall" },
    { ...W, id: "right_wall", a: "im", b: "i2", chainId: "right_wall" },
  ],
);

/** 6. coincident coordinates, two different node ids */
const FIXTURE_COINCIDENT_NODES = () => basePlan(
  {
    c1: { x: 0, y: 0 }, cA: { x: 3000, y: 0 },
    cB: { x: 3000, y: 0 }, c2: { x: 3000, y: 2500 },
  },
  [
    { ...W, id: "c_h", a: "c1", b: "cA", chainId: "c_h" },
    { ...P, id: "c_v", a: "cB", b: "c2", chainId: "c_v" },
  ],
);

/** 7. two bodies crossing with no node anywhere near the intersection */
const FIXTURE_UNNODED_CROSSING = () => basePlan(
  {
    u1: { x: 0, y: 1000 }, u2: { x: 4000, y: 1000 },
    u3: { x: 2000, y: 0 }, u4: { x: 2000, y: 2500 },
  },
  [
    { ...W, id: "u_h", a: "u1", b: "u2", chainId: "u_h" },
    { ...W, id: "u_v", a: "u3", b: "u4", chainId: "u_v" },
  ],
);

/** 8. same lineage, different thickness — merge must stay blocked */
const FIXTURE_PROPERTY_MISMATCH = () => basePlan(
  { p1: { x: 0, y: 0 }, pm: { x: 3000, y: 0 }, p2: { x: 6000, y: 0 } },
  [
    { ...W, id: "pm_a", a: "p1", b: "pm", chainId: "shared" },
    { ...W, id: "pm_b", a: "pm", b: "p2", chainId: "shared", thk: 250 },
  ],
);

/** 9. unrelated lineage on both halves, neither self-rooted */
const FIXTURE_LINEAGE_MISMATCH = () => basePlan(
  { m1: { x: 0, y: 0 }, mm: { x: 3000, y: 0 }, m2: { x: 6000, y: 0 } },
  [
    { ...W, id: "lm_a", a: "m1", b: "mm", chainId: "some_other_chain" },
    { ...W, id: "lm_b", a: "mm", b: "m2", chainId: "a_third_chain" },
  ],
);

/* --------------------------------------------------------------- tests */

describe("PHASE 2F1 — legacy topology classification", () => {
  it("3. the exact malformed bad room is classified correctly", () => {
    const plan = FIXTURE_BAD_ROOM_AS_STORED();
    const { anomalies } = classifyPlanTopologyAnomalies(plan);
    const unnoded = anomalies.filter((a) => a.class === TOPOLOGY_CLASS.UNNODED_CROSSING);
    expect(unnoded).toHaveLength(2);
    expect(unnoded.every((a) => a.subtype === "endpoint_on_body")).toBe(true);
    expect(unnoded.map((a) => a.hostWallId).sort()).toEqual(["d_bottom", "d_t1"]);
    expect(unnoded.every((a) => a.branchWallId === "d_part")).toBe(true);
    expect(unnoded.every((a) => a.repairable)).toBe(true);
    // Both partition ends are FREE — that is the whole defect.
    expect(degreeOf(plan, "pTop")).toBe(1);
    expect(degreeOf(plan, "pBot")).toBe(1);
  });

  it("classifies every permanent fixture into its own category", () => {
    expect(classesOf(FIXTURE_GOOD_ROOM()).size).toBe(0);
    expect(classesOf(FIXTURE_LIVE_T())).toContain(TOPOLOGY_CLASS.LEGITIMATE_LIVE_T_SPLIT);
    expect(classesOf(FIXTURE_ORPHAN_SPLIT())).toContain(TOPOLOGY_CLASS.ORPHAN_HOST_SPLIT);
    expect(classesOf(FIXTURE_INDEPENDENT_COLLINEAR()))
      .toContain(TOPOLOGY_CLASS.INDEPENDENT_COLLINEAR_WALLS);
    expect(classesOf(FIXTURE_COINCIDENT_NODES()))
      .toContain(TOPOLOGY_CLASS.COINCIDENT_BUT_DISTINCT_NODES);
    expect(classesOf(FIXTURE_UNNODED_CROSSING())).toContain(TOPOLOGY_CLASS.UNNODED_CROSSING);
    expect(classesOf(FIXTURE_PROPERTY_MISMATCH())).toContain(TOPOLOGY_CLASS.PROPERTY_MISMATCH);
    expect(classesOf(FIXTURE_LINEAGE_MISMATCH())).toContain(TOPOLOGY_CLASS.LINEAGE_MISMATCH);
  });

  it("lineage provenance separates a split host from two separate walls", () => {
    const split = FIXTURE_ORPHAN_SPLIT();
    const [a, b] = split.walls;
    expect(classifyPairProvenance(a, b).provenance).toBe("split");

    const indep = FIXTURE_INDEPENDENT_COLLINEAR();
    expect(classifyPairProvenance(indep.walls[0], indep.walls[1]).provenance).toBe("independent");

    const mismatch = FIXTURE_LINEAGE_MISMATCH();
    expect(classifyPairProvenance(mismatch.walls[0], mismatch.walls[1]).provenance).toBe("unknown");
  });
});

describe("PHASE 2F1 — bounded legacy repair", () => {
  it("1. good rooms are geometry-equivalent after normalization/repair", () => {
    const plan = FIXTURE_GOOD_ROOM();
    const before = clone(plan);
    const result = repairLegacyTopology(plan, { makeId });
    expect(result.changed).toBe(false);
    expect(result.repairs).toEqual([]);
    expect(result.plan).toEqual(before);
  });

  it("2. a known-good live T split is left completely alone", () => {
    const plan = FIXTURE_LIVE_T();
    const before = clone(plan);
    const result = repairLegacyTopology(plan, { makeId });
    expect(result.changed).toBe(false);
    expect(result.plan).toEqual(before);
    expect(degreeOf(result.plan, "tm")).toBe(3);
  });

  it("4. a proven orphan split heals, keeping geometry and properties", () => {
    const plan = FIXTURE_ORPHAN_SPLIT();
    const result = repairLegacyTopology(plan, { makeId });
    expect(result.changed).toBe(true);
    expect(result.repairs[0].action).toBe(REPAIR_ACTION.MERGE_ORPHAN_HOST_SPLIT);
    expect(result.plan.walls).toHaveLength(1);
    const merged = result.plan.walls[0];
    expect(merged.id).toBe("orphan");
    expect(merged.chainId).toBe("orphan");
    expect(merged.thk).toBe(W.thk);
    expect([merged.a, merged.b].sort()).toEqual(["o1", "o2"]);
    expect(result.plan.nodes.om).toBeUndefined();
    expect(result.plan.nodes.o1).toEqual({ x: 0, y: 0 });
    expect(result.plan.nodes.o2).toEqual({ x: 6000, y: 0 });
  });

  it("5. independent collinear walls never merge", () => {
    const plan = FIXTURE_INDEPENDENT_COLLINEAR();
    const before = clone(plan);
    const result = repairLegacyTopology(plan, { makeId });
    expect(result.changed).toBe(false);
    expect(result.plan).toEqual(before);
    expect(result.plan.walls.map((w) => w.id).sort()).toEqual(["left_wall", "right_wall"]);
  });

  it("6. coincident but unrelated nodes are never welded blindly", () => {
    const plan = FIXTURE_COINCIDENT_NODES();
    const before = clone(plan);
    const result = repairLegacyTopology(plan, { makeId });
    expect(result.changed).toBe(false);
    expect(result.plan).toEqual(before);
    expect(result.plan.nodes.cA).toBeTruthy();
    expect(result.plan.nodes.cB).toBeTruthy();
    expect(result.skipped.some((s) => s.class === TOPOLOGY_CLASS.COINCIDENT_BUT_DISTINCT_NODES))
      .toBe(true);
  });

  it("7. a proven missing connection is repaired — the visible join becomes real", () => {
    const plan = FIXTURE_BAD_ROOM_AS_STORED();
    const result = repairLegacyTopology(plan, { makeId });
    expect(result.changed).toBe(true);
    expect(result.repairs).toHaveLength(2);
    expect(result.repairs.every((r) => r.action === REPAIR_ACTION.WELD_ENDPOINT_TO_HOST)).toBe(true);

    const next = result.plan;
    // The partition now shares a real node with both hosts.
    expect(degreeOf(next, "pTop")).toBe(3);
    expect(degreeOf(next, "pBot")).toBe(3);
    // Coordinates are untouched.
    expect(next.nodes.pTop).toEqual({ x: 13991, y: 0 });
    expect(next.nodes.pBot).toEqual({ x: 13991, y: 4000 });
    expect(next.nodes.d1).toEqual({ x: 12000, y: 0 });
    // Each host became two halves that PROVABLY belong to one original wall.
    const topHalves = next.walls.filter((w) => w.chainId === "d_t1");
    expect(topHalves).toHaveLength(2);
    expect(topHalves.every((w) => w.thk === W.thk && w.role === "outer")).toBe(true);
    expect(classifyPlanTopologyAnomalies(next).anomalies
      .filter((a) => a.class === TOPOLOGY_CLASS.UNNODED_CROSSING)).toEqual([]);
  });

  it("13-15. repair is idempotent, so reload does no work and cannot loop", () => {
    const first = repairLegacyTopology(FIXTURE_BAD_ROOM_AS_STORED(), { makeId });
    expect(first.changed).toBe(true);
    const second = repairLegacyTopology(first.plan, { makeId });
    expect(second.changed).toBe(false);
    expect(second.repairs).toEqual([]);
    expect(second.plan).toEqual(first.plan);
    const third = repairLegacyTopology(second.plan, { makeId });
    expect(third.changed).toBe(false);
    expect(third.plan).toEqual(first.plan);
  });

  it("11-12. property or lineage mismatch blocks the merge, with the reason kept", () => {
    for (const make of [FIXTURE_PROPERTY_MISMATCH, FIXTURE_LINEAGE_MISMATCH]) {
      const plan = make();
      const before = clone(plan);
      const result = repairLegacyTopology(plan, { makeId });
      expect(result.changed).toBe(false);
      expect(result.plan).toEqual(before);
    }
    const pm = classifyPlanTopologyAnomalies(FIXTURE_PROPERTY_MISMATCH()).anomalies
      .find((a) => a.class === TOPOLOGY_CLASS.PROPERTY_MISMATCH);
    expect(pm.propertyMismatch).toContain("thk");
  });
});

describe("PHASE 2F1 — movement no longer passes through a connected host", () => {
  it("8. a partition on a host built from two separately drawn walls stays attached", () => {
    // This is the exact structure that produced the defect: the two host halves
    // are physically identical but were drawn separately, so they carry
    // different chainIds.
    const plan = basePlan(
      {
        h1: { x: 0, y: 0 }, hm: { x: 4000, y: 0 }, h2: { x: 8000, y: 0 },
        b1: { x: 0, y: 4000 }, bm: { x: 4000, y: 4000 }, b2: { x: 8000, y: 4000 },
      },
      [
        { ...W, id: "top_left", a: "h1", b: "hm", chainId: "top_left" },
        { ...W, id: "top_right", a: "hm", b: "h2", chainId: "top_right" },
        { ...W, id: "bot_left", a: "b1", b: "bm", chainId: "bot_left" },
        { ...W, id: "bot_right", a: "bm", b: "b2", chainId: "bot_right" },
        { ...P, id: "part", a: "hm", b: "bm", chainId: "part" },
      ],
    );
    const att = classifyWallSegmentAttachments(plan, "part");
    // Lineage must NOT decide whether a branch has a host to slide along.
    expect(att.start.type).toBe("tee");
    expect(att.end.type).toBe("tee");

    const moved = moveWallSegment(plan, { wallId: "part", delta: { x: -1500, y: 0 }, makeId });
    expect(moved.changed, moved.reason).toBe(true);
    const part = moved.plan.walls.find((w) => w.id === "part");
    expect(degreeOf(moved.plan, part.a)).toBe(3);
    expect(degreeOf(moved.plan, part.b)).toBe(3);
    // It slid ALONG the hosts, keeping its length and direction.
    const A = moved.plan.nodes[part.a];
    const B = moved.plan.nodes[part.b];
    expect(A.x).toBeCloseTo(2500, 6);
    expect(B.x).toBeCloseTo(2500, 6);
    expect(Math.abs(B.y - A.y)).toBeCloseTo(4000, 6);
    // The separately drawn halves were NOT fused by the move.
    expect(moved.plan.walls.some((w) => w.id === "top_right")).toBe(true);
    expect(moved.plan.walls.some((w) => w.id === "bot_right")).toBe(true);
  });

  it("a free-floating partition is exactly what the repair removes", () => {
    const stored = FIXTURE_BAD_ROOM_AS_STORED();
    const before = classifyWallSegmentAttachments(stored, "d_part");
    expect(before.start.type).toBe("free");
    expect(before.end.type).toBe("free");

    const repaired = repairLegacyTopology(stored, { makeId }).plan;
    const after = classifyWallSegmentAttachments(repaired, "d_part");
    expect(after.start.type).toBe("tee");
    expect(after.end.type).toBe("tee");
  });
});

describe("PHASE 2F1 — heal only the correct host", () => {
  it("9. a live branch prevents a premature heal", () => {
    const plan = FIXTURE_LIVE_T();
    const result = repairLegacyTopology(plan, { makeId });
    expect(result.changed).toBe(false);
    expect(plan.walls.filter((w) => w.chainId === "host")).toHaveLength(2);
  });

  it("10. removing the final proven branch heals the host", () => {
    const plan = FIXTURE_LIVE_T();
    const res = deleteWall(plan, "branch");
    expect(res.changed).toBe(true);
    expect(res.plan.walls.filter((w) => w.chainId === "host")).toHaveLength(1);
    expect(res.plan.nodes.tm).toBeUndefined();
  });

  it("removing a branch between two SEPARATELY drawn walls invents no merge", () => {
    const plan = basePlan(
      {
        s1: { x: 0, y: 0 }, sm: { x: 3000, y: 0 }, s2: { x: 6000, y: 0 },
        sb: { x: 3000, y: 2500 },
      },
      [
        { ...W, id: "sep_left", a: "s1", b: "sm", chainId: "sep_left" },
        { ...W, id: "sep_right", a: "sm", b: "s2", chainId: "sep_right" },
        { ...P, id: "sep_branch", a: "sm", b: "sb", chainId: "sep_branch" },
      ],
    );
    const res = deleteWall(plan, "sep_branch");
    expect(res.changed).toBe(true);
    expect(res.plan.walls.map((w) => w.id).sort()).toEqual(["sep_left", "sep_right"]);
    expect(res.plan.nodes.sm).toBeTruthy();
    // And a later load still refuses to merge them.
    expect(repairLegacyTopology(res.plan, { makeId }).changed).toBe(false);
  });

  it("16. Undo/Redo semantics: repair never mutates the plan it is given", () => {
    const plan = FIXTURE_BAD_ROOM_AS_STORED();
    const snapshot = JSON.stringify(plan);
    repairLegacyTopology(plan, { makeId });
    expect(JSON.stringify(plan)).toBe(snapshot);
  });
});

describe("PHASE 2F1 — dimension stability across the repair", () => {
  it("17. good-room dimensions are unchanged by the repair pass", () => {
    const plan = FIXTURE_GOOD_ROOM();
    const before = dimensionKeySet(generateWallDimensions(plan, {}).dimensions);
    const repaired = repairLegacyTopology(plan, { makeId }).plan;
    const after = dimensionKeySet(generateWallDimensions(repaired, {}).dimensions);
    expect(after).toBe(before);
    expect(before.length).toBeGreaterThan(0);
  });

  it("18. bad-room dimensions regenerate only from the repaired topology", () => {
    const stored = FIXTURE_BAD_ROOM_AS_STORED();
    const repaired = repairLegacyTopology(stored, { makeId }).plan;
    const dims = generateWallDimensions(repaired, {}).dimensions;

    const liveWallIds = new Set(repaired.walls.map((w) => w.id));
    for (const d of dims) {
      for (const id of d.sourceWallIds || []) {
        expect(liveWallIds.has(id), `stale reference to ${id}`).toBe(true);
      }
    }
    // Deterministic: the same repaired plan yields the same key set.
    const again = dimensionKeySet(generateWallDimensions(repaired, {}).dimensions);
    expect(again).toBe(dimensionKeySet(dims));
  });
});
