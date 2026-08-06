/**
 * PHASE 2F1-LIVE4.5 — compact visual knockouts; semantics frozen.
 */
import { describe, it, expect } from "vitest";
import {
  buildDimLineKnockouts,
  dimLineSegmentsFromKnockouts,
  solveSelectedWallDimPresentation,
  INTERACTION_OCCUPANCY_PX,
  VISUAL_KNOCKOUT_MARGIN_PX,
  TEXT_KNOCKOUT_PAD_PX,
  visibleCentreKnockoutRadiusPx,
  visualKnockoutIntervalsAlongDimPx,
  PREFERRED_FACE_T,
} from "../src/planner/core/dimensions/selectedDimLayout.js";
import {
  GRIP_HIT_MIN_PX,
  NUDGE_ARROW_HIT_R_PX,
  NUDGE_ARROW_RING_PX,
  zoomResponsiveGripRadiusPx,
} from "../src/planner/core/viewport/gripScale.js";
import {
  resolveSelectedDimensionSemantics,
  semanticsEqual,
} from "../src/planner/core/dimensions/selectedDimensionSemantics.js";
import { buildLiveWallEditMeasurements } from "../src/planner/core/walls/liveWallMeasurements.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";

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

/** Short right bottom segment + long left neighbor (LIVE4.4 disposable shape). */
function shortTHost() {
  const OX = 10000;
  const OY = 10000;
  const mid = OX + 5500;
  return mk({
    nTL: { x: OX, y: OY },
    nTM: { x: mid, y: OY },
    nTR: { x: OX + 8000, y: OY },
    nBR: { x: OX + 8000, y: OY + 5000 },
    nBL: { x: OX, y: OY + 5000 },
    nBM: { x: mid, y: OY + 5000 },
  }, [
    { id: "topL", a: "nTL", b: "nTM", chainId: "ch_top" },
    { id: "topR", a: "nTM", b: "nTR", chainId: "ch_top" },
    { id: "right", a: "nTR", b: "nBR", chainId: "ch_right" },
    { id: "botR", a: "nBR", b: "nBM", chainId: "ch_botR" },
    { id: "botL", a: "nBM", b: "nBL", chainId: "ch_botL" },
    { id: "left", a: "nBL", b: "nTL", chainId: "ch_left" },
    { id: "partition", a: "nTM", b: "nBM", chainId: "ch_part", role: "inner" },
  ]);
}

function freeV() {
  return mk(
    { a: { x: 20000, y: 20000 }, b: { x: 20000, y: 25000 } },
    [{ id: "freeV", a: "a", b: "b" }],
  );
}

const resolved = (plan) => ({ ...plan, walls: resolvePlanWalls(plan) });

function removedPx(dimA, dimB, knockouts, zoom) {
  const full = Math.hypot(dimB.x - dimA.x, dimB.y - dimA.y);
  const segs = dimLineSegmentsFromKnockouts(dimA, dimB, knockouts);
  const painted = segs.reduce((s, g) => s + Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y), 0);
  return Math.max(0, full - painted) * zoom;
}

function controlGapHalfPx(knockouts, labelT) {
  // Mid-cluster gap: knockout interval covering t≈0.5 that is not the label.
  const mid = knockouts.find((g) => g.t0 <= 0.5 && g.t1 >= 0.5);
  if (!mid) return 0;
  // If merged with label, still report half-width of the merged hole.
  return ((mid.t1 - mid.t0) / 2);
}

describe("LIVE4.5 visual vs interaction knockout", () => {
  it("keeps invisible hit target contract ≥ 32 px", () => {
    expect(GRIP_HIT_MIN_PX).toBeGreaterThanOrEqual(32);
    expect(NUDGE_ARROW_HIT_R_PX * 2).toBeGreaterThanOrEqual(32);
    expect(INTERACTION_OCCUPANCY_PX).toBeGreaterThanOrEqual(32);
  });

  it("visual centre knockout is visible chrome + margin, not hit 32/42", () => {
    for (const z of [0.12, 0.22, 0.55, 1]) {
      const visual = visibleCentreKnockoutRadiusPx(z);
      const centre = zoomResponsiveGripRadiusPx(z);
      expect(visual).toBeCloseTo(centre + VISUAL_KNOCKOUT_MARGIN_PX, 6);
      expect(visual).toBeLessThan(GRIP_HIT_MIN_PX);
      expect(visual).toBeLessThan(INTERACTION_OCCUPANCY_PX);
    }
  });

  it("invisible hit / interaction clearPx does not enlarge visual line knockout", () => {
    const dimA = { x: 0, y: 100 };
    const dimB = { x: 2500, y: 100 };
    const mid = { x: 1250, y: 100 };
    const z = 0.22;
    const visual = buildDimLineKnockouts({
      dimA, dimB, zoom: z, labelT: 0.65,
      labelHalfPx: TEXT_KNOCKOUT_PAD_PX + 18,
      clusterWorld: mid,
      visualClearPx: visibleCentreKnockoutRadiusPx(z),
    });
    const inflated = buildDimLineKnockouts({
      dimA, dimB, zoom: z, labelT: 0.65,
      labelHalfPx: TEXT_KNOCKOUT_PAD_PX + 18,
      clusterWorld: mid,
      clusterRadiusPx: INTERACTION_OCCUPANCY_PX, // old bug path
      visualClearPx: null,
      visualIntervalsPx: null,
      lanePx: null,
    });
    // Force old path: pass only clusterRadiusPx without visualClearPx/lane
    const oldStyle = buildDimLineKnockouts({
      dimA, dimB, zoom: z, labelT: 0.65,
      labelHalfPx: TEXT_KNOCKOUT_PAD_PX + 18,
      clusterWorld: mid,
      clusterRadiusPx: 42,
    });
    const remVisual = removedPx(dimA, dimB, visual, z);
    const remOld = removedPx(dimA, dimB, oldStyle, z);
    expect(remVisual).toBeLessThan(remOld - 20);
    expect(inflated); // keep reference
  });

  it("cursor hotspot is not an input to knockout intervals", () => {
    const dimA = { x: 0, y: 0 };
    const dimB = { x: 3000, y: 0 };
    const mid = { x: 1500, y: 0 };
    const z = 0.3;
    const a = buildDimLineKnockouts({
      dimA, dimB, zoom: z, labelT: 0.35,
      clusterWorld: mid,
      visualClearPx: visibleCentreKnockoutRadiusPx(z),
    });
    const b = buildDimLineKnockouts({
      dimA, dimB, zoom: z, labelT: 0.35,
      clusterWorld: mid,
      visualClearPx: visibleCentreKnockoutRadiusPx(z),
      // cursor must be ignored even if smuggled in
      cursorWorld: { x: 900, y: 400 },
    });
    expect(a).toEqual(b);
  });

  it("horizontal control gap bounded by visible centre + margin", () => {
    const z = 0.22;
    const dimA = { x: 0, y: 100 };
    const dimB = { x: 2500, y: 100 };
    const mid = { x: 1250, y: 100 };
    const visualR = visibleCentreKnockoutRadiusPx(z);
    const gaps = buildDimLineKnockouts({
      dimA, dimB, zoom: z, labelT: 0.65,
      labelHalfPx: TEXT_KNOCKOUT_PAD_PX + 18,
      clusterWorld: mid,
      visualClearPx: visualR,
    });
    const cluster = gaps.find((g) => g.t0 <= 0.5 && g.t1 >= 0.5)
      || gaps.find((g) => Math.abs((g.t0 + g.t1) / 2 - 0.5) < 0.2);
    expect(cluster).toBeTruthy();
    const halfT = (cluster.t1 - cluster.t0) / 2;
    const halfPx = halfT * 2500 * z;
    // Merged-with-label holes may be larger; isolate control-only:
    const controlOnly = buildDimLineKnockouts({
      dimA, dimB, zoom: z, labelT: 0.05,
      labelHalfPx: 1,
      clusterWorld: mid,
      visualClearPx: visualR,
    });
    const c = controlOnly.find((g) => g.t0 <= 0.5 && g.t1 >= 0.5);
    const cHalfPx = ((c.t1 - c.t0) / 2) * 2500 * z;
    expect(cHalfPx).toBeLessThanOrEqual(visualR + 0.5);
    expect(cHalfPx).toBeGreaterThanOrEqual(visualR - 0.5);
    expect(halfPx).toBeGreaterThan(0);
  });

  it("vertical control gap obeys the same wall-local bound", () => {
    const z = 0.22;
    const visualR = visibleCentreKnockoutRadiusPx(z);
    const dimA = { x: 100, y: 0 };
    const dimB = { x: 100, y: 2500 };
    const mid = { x: 100, y: 1250 };
    const controlOnly = buildDimLineKnockouts({
      dimA, dimB, zoom: z, labelT: 0.05,
      labelHalfPx: 1,
      clusterWorld: mid,
      visualClearPx: visualR,
    });
    const c = controlOnly.find((g) => g.t0 <= 0.5 && g.t1 >= 0.5);
    const cHalfPx = ((c.t1 - c.t0) / 2) * 2500 * z;
    expect(cHalfPx).toBeCloseTo(visualR, 5);
  });

  it("text knockout uses compact pad only", () => {
    expect(TEXT_KNOCKOUT_PAD_PX).toBeGreaterThanOrEqual(4);
    expect(TEXT_KNOCKOUT_PAD_PX).toBeLessThanOrEqual(7);
    const z = 0.5;
    const dimA = { x: 0, y: 0 };
    const dimB = { x: 4000, y: 0 };
    const gaps = buildDimLineKnockouts({
      dimA, dimB, zoom: z, labelT: 0.35,
      labelHalfPx: TEXT_KNOCKOUT_PAD_PX + 20,
      clusterWorld: null,
    });
    expect(gaps).toHaveLength(1);
    const halfPx = ((gaps[0].t1 - gaps[0].t0) / 2) * 4000 * z;
    // ~20 glyph half + 5 pad → well under old 28–42 interaction radii
    expect(halfPx).toBeLessThan(40);
  });

  it("dimension line resumes on both sides of the controls", () => {
    const dimA = { x: 0, y: 0 };
    const dimB = { x: 3000, y: 0 };
    const mid = { x: 1500, y: 0 };
    const z = 0.4;
    const gaps = buildDimLineKnockouts({
      dimA, dimB, zoom: z, labelT: 0.35,
      clusterWorld: mid,
      visualClearPx: visibleCentreKnockoutRadiusPx(z),
    });
    const segs = dimLineSegmentsFromKnockouts(dimA, dimB, gaps);
    expect(segs.length).toBeGreaterThanOrEqual(2);
    expect(segs[0].a.x).toBeCloseTo(dimA.x, 5);
    expect(segs[segs.length - 1].b.x).toBeCloseTo(dimB.x, 5);
  });

  it("2D visual intervals ignore hit disks far from the dim lane", () => {
    const z = 0.22;
    // Dim lane far from wall mid → no visible disk reaches the line.
    const far = visualKnockoutIntervalsAlongDimPx({ zoom: z, lanePx: 80 });
    expect(far.length).toBe(0);
    // At the wall mid, visible disks contribute — but the solver falls back to
    // centre-only when the lane is empty of hits, and never uses hit r=16/32.
    const onWall = visualKnockoutIntervalsAlongDimPx({ zoom: z, lanePx: 0 });
    expect(onWall.length).toBeGreaterThanOrEqual(1);
    for (const iv of onWall) {
      expect(Math.abs(iv.t1 - iv.t0)).toBeLessThanOrEqual(
        2 * (NUDGE_ARROW_RING_PX + 11 + VISUAL_KNOCKOUT_MARGIN_PX) + 1,
      );
    }
    // Realistic face lane (~thk/2 + near lane) → compact centre fallback path.
    const dimA = { x: 0, y: 0 };
    const dimB = { x: 2500, y: 0 };
    const mid = { x: 1250, y: 0 };
    const faceLane = buildDimLineKnockouts({
      dimA, dimB, zoom: z, labelT: 0.05, labelHalfPx: 1,
      clusterWorld: mid,
      visualClearPx: visibleCentreKnockoutRadiusPx(z),
      lanePx: 33,
    });
    const c = faceLane.find((g) => g.t0 <= 0.5 && g.t1 >= 0.5);
    const halfPx = ((c.t1 - c.t0) / 2) * 2500 * z;
    expect(halfPx).toBeLessThanOrEqual(visibleCentreKnockoutRadiusPx(z) + 1);
  });
});

describe("LIVE4.5 semantics frozen + dual faces", () => {
  it("semantic fingerprint identical across presentation occupancy variants", () => {
    const plan = resolved(shortTHost());
    const wallId = "botR";
    const wall = plan.walls.find((w) => w.id === wallId);
    const a = wall.pts[0];
    const b = wall.pts[wall.pts.length - 1];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const live = buildLiveWallEditMeasurements({
      previewPlan: plan, wallId, editKind: "endpoint",
    });
    const base = resolveSelectedDimensionSemantics({
      plan,
      selectedWallId: wallId,
      liveMeasurements: live,
    });
    const faces = (base.faces || []).map((f) => ({
      id: f.id, a: f.a, b: f.b, faceKey: f.face,
    }));
    solveSelectedWallDimPresentation({
      faces, wallA: a, wallB: b,
      zoom: 0.22,
      occupancy: [{ point: mid, clearPx: INTERACTION_OCCUPANCY_PX, visualClearPx: 22 }],
    });
    const again = resolveSelectedDimensionSemantics({
      plan,
      selectedWallId: wallId,
      liveMeasurements: buildLiveWallEditMeasurements({
        previewPlan: plan, wallId, editKind: "endpoint",
      }),
    });
    expect(semanticsEqual(base, again)).toBe(true);
    expect(again.fingerprint).toBe(base.fingerprint);
  });

  it("both short-T face values remain visible in every pointer-state occupancy", () => {
    const plan = resolved(shortTHost());
    const wall = plan.walls.find((w) => w.id === "botR");
    const a = wall.pts[0];
    const b = wall.pts[wall.pts.length - 1];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const live = buildLiveWallEditMeasurements({
      previewPlan: plan, wallId: "botR", editKind: "endpoint",
    });
    const faces = (live.labels || [])
      .filter((l) => l.kind === "face")
      .map((l) => ({ id: l.id, a: l.a, b: l.b, faceKey: l.face }));
    expect(faces.length).toBe(2);
    const texts = (live.labels || []).filter((l) => l.kind === "face").map((l) => l.text);
    expect(texts.some((t) => /2[.,]4\d/.test(t) || /2[.,]5\d/.test(t))).toBe(true);

    for (const occ of [
      [{ point: mid, clearPx: INTERACTION_OCCUPANCY_PX, visualClearPx: 22 }],
      [{ point: mid, clearPx: INTERACTION_OCCUPANCY_PX, visualClearPx: 22 },
        { point: { x: mid.x + 40, y: mid.y }, clearPx: 32, visualClearPx: 11 }],
      [],
    ]) {
      const solved = solveSelectedWallDimPresentation({
        faces, wallA: a, wallB: b, zoom: 0.22, occupancy: occ,
      });
      expect(Object.keys(solved.byId).length).toBe(2);
      for (const id of Object.keys(solved.byId)) {
        expect(solved.byId[id].segments.length).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("vertical wall exposes both physical faces with compact gaps", () => {
    const plan = resolved(shortTHost());
    const wall = plan.walls.find((w) => w.id === "right");
    const a = wall.pts[0];
    const b = wall.pts[wall.pts.length - 1];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const live = buildLiveWallEditMeasurements({
      previewPlan: plan, wallId: "right", editKind: "endpoint",
    });
    const faces = (live.labels || [])
      .filter((l) => l.kind === "face")
      .map((l) => ({ id: l.id, a: l.a, b: l.b, faceKey: l.face }));
    expect(faces.length).toBe(2);
    const mm = (live.labels || []).filter((l) => l.kind === "face").map((l) => l.mm);
    // ~4900 / ~5100 physical faces on a 5000 CL / 100 thk wall
    expect(Math.min(...mm)).toBeGreaterThan(4800);
    expect(Math.max(...mm)).toBeLessThan(5200);
    const solved = solveSelectedWallDimPresentation({
      faces, wallA: a, wallB: b, zoom: 0.2,
      occupancy: [{
        point: mid,
        clearPx: INTERACTION_OCCUPANCY_PX,
        visualClearPx: visibleCentreKnockoutRadiusPx(0.2),
      }],
    });
    for (const e of solved.faces) {
      const rem = removedPx(e.dimA, e.dimB, e.knockouts, 0.2);
      // Old path removed ~180 px/face on short walls; compact must stay lower.
      expect(rem).toBeLessThan(160);
      expect(e.visualClearPx).toBeLessThan(GRIP_HIT_MIN_PX);
    }
  });

  it("stable label t values do not switch over 20 zoom steps", () => {
    const plan = resolved(shortTHost());
    const wall = plan.walls.find((w) => w.id === "botR");
    const a = wall.pts[0];
    const b = wall.pts[wall.pts.length - 1];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const live = buildLiveWallEditMeasurements({
      previewPlan: plan, wallId: "botR", editKind: "endpoint",
    });
    const faces = (live.labels || [])
      .filter((l) => l.kind === "face")
      .map((l) => ({ id: l.id, a: l.a, b: l.b, faceKey: l.face }));
    let prev = null;
    const zooms = Array.from({ length: 20 }, (_, i) => 0.12 + i * 0.03);
    const series = [];
    for (const z of zooms) {
      const solved = solveSelectedWallDimPresentation({
        faces, wallA: a, wallB: b, zoom: z, previous: prev,
        occupancy: [{
          point: mid,
          clearPx: INTERACTION_OCCUPANCY_PX,
          visualClearPx: visibleCentreKnockoutRadiusPx(z),
        }],
      });
      prev = solved.state;
      series.push(
        Object.fromEntries(
          solved.faces.map((f) => [f.canonicalFace, f.canonicalT]),
        ),
      );
    }
    const first = series[0];
    for (const s of series) {
      for (const face of Object.keys(first)) {
        expect(s[face]).toBeCloseTo(first[face], 9);
      }
    }
    expect(Object.values(PREFERRED_FACE_T)).toContain(first["v-"]);
    expect(Object.values(PREFERRED_FACE_T)).toContain(first["v+"]);
  });

  it("line does not pass under the visible centre control interval", () => {
    const z = 0.22;
    const dimA = { x: 0, y: 0 };
    const dimB = { x: 2500, y: 0 };
    const mid = { x: 1250, y: 0 };
    const visualR = visibleCentreKnockoutRadiusPx(z);
    const gaps = buildDimLineKnockouts({
      dimA, dimB, zoom: z, labelT: 0.35,
      clusterWorld: mid,
      visualClearPx: visualR,
    });
    const segs = dimLineSegmentsFromKnockouts(dimA, dimB, gaps);
    for (const s of segs) {
      const t0 = s.a.x / 2500;
      const t1 = s.b.x / 2500;
      const midT = 0.5;
      const halfT = (visualR / z) / 2500;
      const overlaps = Math.max(t0, midT - halfT) < Math.min(t1, midT + halfT) - 1e-9;
      expect(overlaps).toBe(false);
    }
  });
});

// Keep a local reference used by the horizontal gap test documentation.
void controlGapHalfPx;
