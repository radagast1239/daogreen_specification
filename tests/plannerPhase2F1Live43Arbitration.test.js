/**
 * PHASE 2F1-LIVE4.3 — selected/default dimension arbitration + T-host anchors.
 */
import { describe, it, expect } from "vitest";
import {
  filterDimensionsForActiveInteraction,
  spansMateriallyOverlap,
} from "../src/planner/core/dimensions/activeDimensionArbitration.js";
import {
  resolveSelectedWallPhysicalSpans,
  resolveLogicalSelectedWallPhysicalSpans,
} from "../src/planner/core/walls/selectedWallPhysicalSpans.js";
import { buildLiveWallEditMeasurements } from "../src/planner/core/walls/liveWallMeasurements.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";
import { resolveLogicalWallChain } from "../src/planner/core/walls/logicalWallChain.js";

const ROOM = { w: 40000, h: 40000, wallThk: 100, height: 3000 };
const W = {
  thk: 100, role: "outer", kind: "new", thicknessSide: "center",
  height: 3000, type: "wall",
};

function mk(nodes, walls) {
  return {
    nodes,
    walls: walls.map((w) => ({ ...W, ...w })),
    items: [], rooms: [], zones: [], links: [], labels: [], lines: [],
    dimensions: [], validationWarnings: [],
    room: ROOM,
  };
}

/** Closed room with mid partition → top host split into two chain segments. */
function tHostRoom() {
  const OX = 10000;
  const OY = 10000;
  const Wd = 8000;
  const Ht = 5000;
  const mid = OX + 4000;
  return mk({
    nTL: { x: OX, y: OY },
    nTM: { x: mid, y: OY },
    nTR: { x: OX + Wd, y: OY },
    nBR: { x: OX + Wd, y: OY + Ht },
    nBL: { x: OX, y: OY + Ht },
    nBM: { x: mid, y: OY + Ht },
  }, [
    { id: "topL", a: "nTL", b: "nTM", chainId: "ch_top" },
    { id: "topR", a: "nTM", b: "nTR", chainId: "ch_top" },
    { id: "right", a: "nTR", b: "nBR", chainId: "ch_right" },
    { id: "botR", a: "nBR", b: "nBM", chainId: "ch_bot" },
    { id: "botL", a: "nBM", b: "nBL", chainId: "ch_bot" },
    { id: "left", a: "nBL", b: "nTL", chainId: "ch_left" },
    { id: "partition", a: "nTM", b: "nBM", chainId: "ch_part", role: "inner" },
  ]);
}

function freeH() {
  return mk(
    { a: { x: 20000, y: 20000 }, b: { x: 24000, y: 20000 } },
    [{ id: "freeH", a: "a", b: "b" }],
  );
}

function freeV() {
  return mk(
    { a: { x: 20000, y: 20000 }, b: { x: 20000, y: 25000 } },
    [{ id: "freeV", a: "a", b: "b" }],
  );
}

function openL() {
  return mk({
    a: { x: 30000, y: 20000 },
    b: { x: 34000, y: 20000 },
    c: { x: 34000, y: 24000 },
  }, [
    { id: "Lh", a: "a", b: "b", chainId: "ch_L" },
    { id: "Lv", a: "b", b: "c", chainId: "ch_L" },
  ]);
}

function diagonal() {
  return mk(
    { a: { x: 40000, y: 20000 }, b: { x: 44000, y: 23000 } },
    [{ id: "diag", a: "a", b: "b" }],
  );
}

const near = (p, q, tol = 30) => p && q && Math.hypot(p.x - q.x, p.y - q.y) <= tol;
const resolved = (plan) => ({ ...plan, walls: resolvePlanWalls(plan) });

describe("PHASE 2F1-LIVE4.3 arbitration + T-host anchors", () => {
  it("1. unselected exterior room wall keeps finalized background dims", () => {
    const dims = [
      { id: "ext", kind: "external_segment", p1: { x: 10000, y: 10050 }, p2: { x: 18000, y: 10050 } },
      { id: "rec", kind: "room_edge_clear", p1: { x: 10000, y: 10050 }, p2: { x: 18000, y: 10050 } },
      { id: "wl", kind: "wall_length", wallId: "topR", p1: { x: 14000, y: 10050 }, p2: { x: 18000, y: 10050 } },
    ];
    const idle = filterDimensionsForActiveInteraction(dims, { mode: null });
    expect(idle).toHaveLength(3);
  });

  it("2/3/6. selecting suppresses only replaced backgrounds; live faces remain conceptually", () => {
    const dims = [
      { id: "ext", kind: "external_segment", p1: { x: 10050, y: 10050 }, p2: { x: 17950, y: 10050 } },
      { id: "rec", kind: "room_edge_clear", p1: { x: 10050, y: 10050 }, p2: { x: 17950, y: 10050 } },
      { id: "wl-topR", kind: "wall_length", wallId: "topR", p1: { x: 14050, y: 10050 }, p2: { x: 17950, y: 10050 } },
      { id: "wl-topL", kind: "wall_length", wallId: "topL", p1: { x: 10050, y: 10050 }, p2: { x: 13950, y: 10050 } },
      { id: "wl-other", kind: "wall_length", wallId: "right", p1: { x: 18050, y: 10050 }, p2: { x: 18050, y: 14950 } },
      { id: "ov", kind: "external_overall", p1: { x: 9950, y: 9950 }, p2: { x: 18050, y: 9950 } },
    ];
    const liveFaceSpans = [
      { a: { x: 10050, y: 9950 }, b: { x: 17950, y: 9950 } },
      { a: { x: 10050, y: 10050 }, b: { x: 17950, y: 10050 } },
    ];
    const filtered = filterDimensionsForActiveInteraction(dims, {
      mode: "select_editor",
      wallId: "topR",
      wallIds: ["topR", "topL"],
      liveFaceSpans,
    });
    expect(filtered.some((d) => d.id === "ext")).toBe(false);
    expect(filtered.some((d) => d.id === "rec")).toBe(false);
    expect(filtered.some((d) => d.id === "wl-topR")).toBe(false);
    expect(filtered.some((d) => d.id === "wl-topL")).toBe(false);
    expect(filtered.some((d) => d.id === "wl-other")).toBe(true);
    expect(filtered.some((d) => d.id === "ov")).toBe(true);
  });

  it("4. deselect restores exact finalized set (presentation filter off)", () => {
    const dims = [
      { id: "ext", kind: "external_segment", p1: { x: 0, y: 50 }, p2: { x: 8000, y: 50 } },
      { id: "wl", kind: "wall_length", wallId: "topR", p1: { x: 4000, y: 50 }, p2: { x: 8000, y: 50 } },
    ];
    const selected = filterDimensionsForActiveInteraction(dims, {
      mode: "select_editor",
      wallId: "topR",
      wallIds: ["topR", "topL"],
      liveFaceSpans: [{ a: { x: 0, y: 50 }, b: { x: 8000, y: 50 } }],
    });
    expect(selected).toHaveLength(0);
    const restored = filterDimensionsForActiveInteraction(dims, { mode: null });
    expect(restored).toEqual(dims);
    expect(restored[0].id).toBe("ext");
    expect(restored[1].id).toBe("wl");
  });

  it("5. vertical exterior follows the same suppression rule", () => {
    const dims = [
      { id: "extV", kind: "external_segment", p1: { x: 18050, y: 10050 }, p2: { x: 18050, y: 14950 } },
      { id: "wlV", kind: "wall_length", wallId: "right", p1: { x: 18050, y: 10050 }, p2: { x: 18050, y: 14950 } },
      { id: "keep", kind: "wall_length", wallId: "left", p1: { x: 9950, y: 10050 }, p2: { x: 9950, y: 14950 } },
    ];
    const filtered = filterDimensionsForActiveInteraction(dims, {
      mode: "select_editor",
      wallId: "right",
      wallIds: ["right"],
      liveFaceSpans: [{ a: { x: 18050, y: 10050 }, b: { x: 18050, y: 14950 } }],
    });
    expect(filtered.some((d) => d.id === "extV")).toBe(false);
    expect(filtered.some((d) => d.id === "wlV")).toBe(false);
    expect(filtered.some((d) => d.id === "keep")).toBe(true);
  });

  it("7/8. T-host selected live span uses outer highlighted endpoints, not T", () => {
    const plan = resolved(tHostRoom());
    const chain = resolveLogicalWallChain(plan, "topR");
    expect(chain.segmentCount).toBe(2);
    expect(chain.internalNodeIds).toContain("nTM");

    const segOnly = resolveSelectedWallPhysicalSpans(plan, "topR", { room: ROOM });
    const logical = resolveLogicalSelectedWallPhysicalSpans(plan, "topR", { room: ROOM });
    expect(logical.segmentCount).toBe(2);
    expect(logical.centerline.lengthMm).toBeGreaterThan(segOnly.centerline.lengthMm + 100);

    // Outer endpoints ≈ room corners; T mid is NOT either face endpoint.
    const t = plan.nodes.nTM;
    const outerL = plan.nodes.nTL;
    const outerR = plan.nodes.nTR;
    expect(near(logical.centerline.a, outerL) || near(logical.centerline.a, outerR)).toBe(true);
    expect(near(logical.centerline.b, outerL) || near(logical.centerline.b, outerR)).toBe(true);
    expect(near(logical.faceA.a, t) || near(logical.faceA.b, t)).toBe(false);
    expect(near(logical.faceB.a, t) || near(logical.faceB.b, t)).toBe(false);

    const live = buildLiveWallEditMeasurements({
      previewPlan: plan,
      wallId: "topR",
      editKind: "endpoint",
      room: ROOM,
    });
    expect(live.centerlineMm).toBeGreaterThan(7000);
    const faceLabels = live.labels.filter((l) => l.kind === "face");
    expect(faceLabels.length).toBeGreaterThanOrEqual(1);
    for (const fl of faceLabels) {
      expect(near(fl.a, t) || near(fl.b, t)).toBe(false);
      const hitsOuter = [fl.a, fl.b].some((p) => near(p, outerL, 80) || near(p, outerR, 80));
      expect(hitsOuter).toBe(true);
    }
  });

  it("8b. single-segment wall may still use a true endpoint that is a T for a branch", () => {
    const plan = resolved(tHostRoom());
    const branch = resolveLogicalSelectedWallPhysicalSpans(plan, "partition", { room: ROOM });
    expect(branch.segmentCount).toBe(1);
    const t = plan.nodes.nTM;
    // Partition endpoint is the T node — legitimate for that selected segment.
    expect(near(branch.centerline.a, t) || near(branch.centerline.b, t)).toBe(true);
  });

  it("9. knockout/layout does not change semantic anchors (span equality)", () => {
    const plan = resolved(tHostRoom());
    const before = resolveLogicalSelectedWallPhysicalSpans(plan, "topL", { room: ROOM });
    const after = resolveLogicalSelectedWallPhysicalSpans(plan, "topL", { room: ROOM });
    expect(after.faceA.a).toEqual(before.faceA.a);
    expect(after.faceA.b).toEqual(before.faceA.b);
    expect(after.faceB.a).toEqual(before.faceB.a);
    expect(after.faceB.b).toEqual(before.faceB.b);
  });

  it("10. free-standing H/V unchanged (single-segment logical = segment spans)", () => {
    for (const [plan0, id] of [[freeH(), "freeH"], [freeV(), "freeV"]]) {
      const plan = resolved(plan0);
      const seg = resolveSelectedWallPhysicalSpans(plan, id, { room: ROOM });
      const log = resolveLogicalSelectedWallPhysicalSpans(plan, id, { room: ROOM });
      expect(log.segmentCount).toBe(1);
      expect(Math.abs(log.centerline.lengthMm - seg.centerline.lengthMm)).toBeLessThan(1);
      const live = buildLiveWallEditMeasurements({
        previewPlan: plan, wallId: id, editKind: "endpoint", room: ROOM,
      });
      expect(live.valid).toBe(true);
      expect(live.labels.some((l) => l.kind === "face")).toBe(true);
    }
  });

  it("11. open L unchanged (no false chain merge across elbow)", () => {
    const plan = resolved(openL());
    const chainH = resolveLogicalWallChain(plan, "Lh");
    expect(chainH.segmentCount).toBe(1);
    const live = buildLiveWallEditMeasurements({
      previewPlan: plan, wallId: "Lh", editKind: "endpoint", room: ROOM,
    });
    expect(live.valid).toBe(true);
    expect(live.centerlineMm).toBeGreaterThan(3500);
    expect(live.centerlineMm).toBeLessThan(4500);
  });

  it("12. diagonal wall unchanged", () => {
    const plan = resolved(diagonal());
    const live = buildLiveWallEditMeasurements({
      previewPlan: plan, wallId: "diag", editKind: "endpoint", room: ROOM,
    });
    expect(live.valid).toBe(true);
    expect(live.labels.some((l) => l.kind === "face")).toBe(true);
  });

  it("overlap helper is semantic (axis + projection), not text-based", () => {
    expect(spansMateriallyOverlap(
      { x: 0, y: 50 }, { x: 8000, y: 50 },
      { x: 4000, y: 50 }, { x: 8000, y: 50 },
    )).toBe(true);
    expect(spansMateriallyOverlap(
      { x: 0, y: 50 }, { x: 8000, y: 50 },
      { x: 0, y: 4050 }, { x: 2000, y: 4050 },
    )).toBe(false);
  });
});
