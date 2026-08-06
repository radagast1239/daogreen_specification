/**
 * PHASE 2F1-LIVE4 — physical face anchors, open-L exterior, grip contract.
 */
import { describe, it, expect } from "vitest";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";
import { generateWallDimensions } from "../src/planner/core/dimensions/generateWallDimensions.js";
import { buildLiveWallEditMeasurements, parseLengthInput } from "../src/planner/core/walls/liveWallMeasurements.js";
import {
  resolveSelectedWallPhysicalSpans,
  openChainExteriorOffsetForWall,
  compareWallPhysicalSpans,
} from "../src/planner/core/walls/selectedWallPhysicalSpans.js";
import {
  dodgeDimensionAwayFromOccupancy,
  filterDimensionsForActiveInteraction,
} from "../src/planner/core/dimensions/activeDimensionArbitration.js";
import { anchorsOnCenterline } from "../src/planner/core/walls/wallFaceReferences.js";

function distToSeg(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** Vertical host + 3000 mm horizontal branch (T-like attachment at host body). */
function attachedHorizontalPlan() {
  return {
    room: { w: 20000, h: 16000, wallThk: 100, height: 3000 },
    nodes: {
      v0: { id: "v0", x: 0, y: -2000 },
      v1: { id: "v1", x: 0, y: 2000 },
      h1: { id: "h1", x: 3000, y: 0 },
    },
    walls: [
      { id: "host", a: "v0", b: "v1", thk: 200, height: 3000, material: "drywall", role: "outer", kind: "new", thicknessSide: "center" },
      { id: "branch", a: "v0", b: "h1", thk: 100, height: 3000, material: "drywall", role: "outer", kind: "new", thicknessSide: "center" },
    ],
    items: [], lines: [], zones: [], rooms: [], dimensions: [],
  };
}

/** Fix branch to attach mid-host: insert junction node. */
function tAttachmentPlan() {
  return {
    room: { w: 20000, h: 16000, wallThk: 100, height: 3000 },
    nodes: {
      v0: { id: "v0", x: 0, y: -2000 },
      j: { id: "j", x: 0, y: 0 },
      v1: { id: "v1", x: 0, y: 2000 },
      h1: { id: "h1", x: 3000, y: 0 },
    },
    walls: [
      { id: "hostA", a: "v0", b: "j", thk: 200, height: 3000, material: "drywall", role: "outer", kind: "new", thicknessSide: "center" },
      { id: "hostB", a: "j", b: "v1", thk: 200, height: 3000, material: "drywall", role: "outer", kind: "new", thicknessSide: "center" },
      { id: "branch", a: "j", b: "h1", thk: 100, height: 3000, material: "drywall", role: "outer", kind: "new", thicknessSide: "center" },
    ],
    items: [], lines: [], zones: [], rooms: [], dimensions: [],
  };
}

function openLPlan() {
  return {
    room: { w: 20000, h: 16000, wallThk: 100, height: 3000 },
    nodes: {
      a: { id: "a", x: 0, y: 0 },
      b: { id: "b", x: 4000, y: 0 },
      c: { id: "c", x: 4000, y: 3000 },
    },
    walls: [
      { id: "wh", a: "a", b: "b", thk: 100, height: 3000, material: "drywall", role: "outer", kind: "new", thicknessSide: "center" },
      { id: "wv", a: "b", b: "c", thk: 100, height: 3000, material: "drywall", role: "outer", kind: "new", thicknessSide: "center" },
    ],
    items: [], lines: [], zones: [], rooms: [], dimensions: [],
  };
}

function mirroredLPlan() {
  return {
    room: { w: 20000, h: 16000, wallThk: 100, height: 3000 },
    nodes: {
      a: { id: "a", x: 0, y: 0 },
      b: { id: "b", x: 4000, y: 0 },
      c: { id: "c", x: 4000, y: -3000 },
    },
    walls: [
      { id: "wh", a: "a", b: "b", thk: 100, height: 3000, material: "drywall", role: "outer", kind: "new", thicknessSide: "center" },
      { id: "wv", a: "b", b: "c", thk: 100, height: 3000, material: "drywall", role: "outer", kind: "new", thicknessSide: "center" },
    ],
    items: [], lines: [], zones: [], rooms: [], dimensions: [],
  };
}

describe("PHASE 2F1-LIVE4 physical anchors", () => {
  it("1/3. attached / T branch face anchors are not on host centreline", () => {
    const plan = tAttachmentPlan();
    const resolved = { ...plan, walls: resolvePlanWalls(plan) };
    const spans = resolveSelectedWallPhysicalSpans(resolved, "branch");
    expect(spans).toBeTruthy();
    expect(spans.quadsUsed).toBeGreaterThan(0);
    // Anchors must leave the host centreline (x=0) by ~half branch thk or more
    // at the free end; at the junction they meet the host FACE, not x=0 midpoint
    // of a 200mm host (centreline). Distance from host axis x=0 should be > 40
    // for at least the face points that sit on the branch faces.
    const hostAxis = { a: { x: 0, y: -2000 }, b: { x: 0, y: 2000 } };
    for (const face of [spans.faceA, spans.faceB]) {
      const d1 = distToSeg(face.a, hostAxis.a, hostAxis.b);
      const d2 = distToSeg(face.b, hostAxis.a, hostAxis.b);
      // Free end is far; junction end sits on host face (~100mm for thk=200).
      const nearHost = Math.min(d1, d2);
      const far = Math.max(d1, d2);
      expect(far).toBeGreaterThan(1000);
      // Not both on centreline.
      expect(nearHost + far).toBeGreaterThan(40);
      expect(anchorsOnCenterline(face.a, face.b, {
        start: { x: 0, y: 0 },
        end: { x: 3000, y: 0 },
      }, 4)).toBe(false);
    }
  });

  it("2. corner / unequal thickness still yields face spans", () => {
    const plan = attachedHorizontalPlan();
    plan.walls[0].thk = 250;
    plan.walls[1].thk = 80;
    const resolved = { ...plan, walls: resolvePlanWalls(plan) };
    const spans = resolveSelectedWallPhysicalSpans(resolved, "branch");
    expect(spans.faceA.lengthMm).toBeGreaterThan(50);
    expect(spans.faceB.lengthMm).toBeGreaterThan(50);
  });

  it("4/5. selected live labels use physical faces; reverse preserves", () => {
    const plan = tAttachmentPlan();
    const resolved = { ...plan, walls: resolvePlanWalls(plan) };
    const live = buildLiveWallEditMeasurements({
      previewPlan: resolved,
      wallId: "branch",
      editKind: "endpoint",
    });
    expect(live.labels.some((l) => l.kind === "face")).toBe(true);
    expect(live.labels.some((l) => l.a?.x === 0 && l.b?.x === 3000 && l.a?.y === 0 && l.b?.y === 0)).toBe(false);

    const rev = {
      ...resolved,
      walls: resolved.walls.map((w) => (
        w.id === "branch" ? { ...w, a: w.b, b: w.a } : w
      )),
    };
    const revResolved = { ...rev, walls: resolvePlanWalls(rev) };
    const spans = resolveSelectedWallPhysicalSpans(revResolved, "branch");
    expect(spans.faceA.lengthMm).toBeGreaterThan(50);
  });

  it("4b. preview/selected/finalized comparison helper", () => {
    const plan = tAttachmentPlan();
    const resolved = { ...plan, walls: resolvePlanWalls(plan) };
    const selected = resolveSelectedWallPhysicalSpans(resolved, "branch");
    const preview = resolveSelectedWallPhysicalSpans(resolved, "branch");
    const { dimensions } = generateWallDimensions(resolved);
    const cmp = compareWallPhysicalSpans({
      selected,
      preview,
      finalizedDims: dimensions,
    });
    expect(cmp.selectedMatchesPreview).toBe(true);
    expect(cmp.lengthsAgree).toBe(true);
  });
});

describe("PHASE 2F1-LIVE4 open L exterior", () => {
  it("7. right-turn L: horizontal above, vertical right", () => {
    const plan = openLPlan();
    const resolved = { ...plan, walls: resolvePlanWalls(plan) };
    const h = openChainExteriorOffsetForWall(resolved, "wh");
    const v = openChainExteriorOffsetForWall(resolved, "wv");
    expect(h.reason).toBe("open_chain");
    expect(v.reason).toBe("open_chain");

    // World-space: label side = sign(offset) * leftNormal(pts).
    // SVG Y-down: left of L→R is DOWN, so exterior ABOVE needs offset < 0.
    // Left of downward V is LEFT, so exterior RIGHT needs offset < 0.
    const wh = resolved.walls.find((w) => w.id === "wh");
    const wv = resolved.walls.find((w) => w.id === "wv");
    const sideOf = (wall, offsetMm) => {
      const a = wall.pts[0];
      const b = wall.pts[wall.pts.length - 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      const s = Math.sign(offsetMm) || 1;
      return { x: nx * s, y: ny * s };
    };
    const hs = sideOf(wh, h.offsetMm);
    const vs = sideOf(wv, v.offsetMm);
    expect(hs.y).toBeLessThan(0); // above
    expect(vs.x).toBeGreaterThan(0); // right

    const { dimensions } = generateWallDimensions(resolved);
    const dh = dimensions.find((d) => String(d.id).includes("wh"));
    const dv = dimensions.find((d) => String(d.id).includes("wv"));
    expect(dh).toBeTruthy();
    expect(dv).toBeTruthy();
    expect(sideOf(wh, dh.offset).y).toBeLessThan(0);
    expect(sideOf(wv, dv.offset).x).toBeGreaterThan(0);
  });

  it("8/9. mirrored L + reorder preserve exterior", () => {
    const plan = mirroredLPlan();
    const resolved = { ...plan, walls: resolvePlanWalls(plan) };
    const h = openChainExteriorOffsetForWall(resolved, "wh");
    const v = openChainExteriorOffsetForWall(resolved, "wv");
    expect(h.reason).toBe("open_chain");
    // Mirrored (upward vertical): exterior should leave the elbow
    expect(h.offsetMm).not.toBe(0);
    expect(v.offsetMm).not.toBe(0);

    const reordered = {
      ...resolved,
      walls: [...resolved.walls].reverse(),
    };
    const h2 = openChainExteriorOffsetForWall(reordered, "wh");
    expect(Math.sign(h2.offsetMm)).toBe(Math.sign(h.offsetMm));
  });
});

describe("PHASE 2F1-LIVE4 selection / grips / perf helpers", () => {
  it("5. selecting suppresses background wall_length for that wall", () => {
    const dims = [
      { id: "auto-wall-len-branch-1", kind: "wall_length", wallId: "branch", p1: { x: 0, y: 0 }, p2: { x: 3000, y: 0 } },
      { id: "auto-wall-len-other-1", kind: "wall_length", wallId: "other", p1: { x: 0, y: 5 }, p2: { x: 1, y: 5 } },
    ];
    const filtered = filterDimensionsForActiveInteraction(dims, {
      mode: "select_editor",
      wallId: "branch",
    });
    expect(filtered.some((d) => d.wallId === "branch")).toBe(false);
    expect(filtered.some((d) => d.wallId === "other")).toBe(true);
  });

  it("11/12. occupancy dodge clears grip cluster", () => {
    const hit = dodgeDimensionAwayFromOccupancy({
      dimMid: { x: 1500, y: 0 },
      occupancy: [
        { point: { x: 1500, y: 0 }, clearPx: 40 },
        { point: { x: 1500, y: -36 }, clearPx: 28 },
        { point: { x: 1500, y: 36 }, clearPx: 28 },
      ],
      zoom: 1,
      currentOffsetMm: 160,
      minClearPx: 28,
    });
    expect(hit.collided).toBe(true);
    expect(hit.offsetMm).toBeGreaterThan(160);
  });

  it("15. exact draw bareAsMm still 3000", () => {
    expect(parseLengthInput("3000", { bareAsMm: true }).mm).toBe(3000);
  });

  it("equal faces collapse to one primary face label", () => {
    const plan = {
      room: { w: 10000, h: 8000, wallThk: 100, height: 3000 },
      nodes: { a: { id: "a", x: 0, y: 0 }, b: { id: "b", x: 3000, y: 0 } },
      walls: [{
        id: "free", a: "a", b: "b", thk: 100, height: 3000, material: "drywall",
        role: "outer", kind: "new", thicknessSide: "center",
      }],
      items: [], lines: [], zones: [], rooms: [], dimensions: [],
    };
    const resolved = { ...plan, walls: resolvePlanWalls(plan) };
    const live = buildLiveWallEditMeasurements({
      previewPlan: resolved,
      wallId: "free",
      editKind: "endpoint",
    });
    const faceLabels = live.labels.filter((l) => l.kind === "face");
    expect(faceLabels.length).toBe(1);
  });
});
