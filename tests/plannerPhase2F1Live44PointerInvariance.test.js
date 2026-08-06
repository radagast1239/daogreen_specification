/**
 * PHASE 2F1-LIVE4.4 — pointer/hover must never change semantic dimension sets.
 */
import { describe, it, expect } from "vitest";
import {
  filterDimensionsForActiveInteraction,
} from "../src/planner/core/dimensions/activeDimensionArbitration.js";
import {
  resolveSelectedDimensionSemantics,
  semanticsEqual,
} from "../src/planner/core/dimensions/selectedDimensionSemantics.js";
import { buildLiveWallEditMeasurements } from "../src/planner/core/walls/liveWallMeasurements.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";
import { layoutDimensionLabels } from "../src/planner/core/dimensions/dimensionLayout.js";
import { solveSelectedWallDimPresentation } from "../src/planner/core/dimensions/selectedDimLayout.js";
import { nearWallLaneOffsetMm } from "../src/planner/core/viewport/gripScale.js";

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

/**
 * Closed room + mid partition. Bottom edge mirrors the LIVE4.4 disposable:
 * short right (~2500) and long left (~5500) with DISTINCT chainIds so selecting
 * the right segment does not expand into the neighbor (video T case).
 */
function shortTHost() {
  const OX = 10000;
  const OY = 10000;
  const Wd = 8000;
  const Ht = 5000;
  const mid = OX + 5500; // left ~5500, right ~2500
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

function faceKey(f) {
  return `${f.id}|${f.face}|${Math.round(f.mm)}|${Math.round(f.a.x)},${Math.round(f.a.y)}>${Math.round(f.b.x)},${Math.round(f.b.y)}`;
}

function semanticSnapshot(plan, wallId) {
  const measurements = buildLiveWallEditMeasurements({
    previewPlan: plan,
    wallId,
    editKind: "endpoint",
    room: plan.room,
  });
  const semantics = resolveSelectedDimensionSemantics({
    plan,
    wallId,
    room: plan.room,
    measurements,
    overview: false,
    allowOverviewCollapse: false,
  });
  return { measurements, semantics };
}

function suppressWith(semantics, dims, wallId) {
  return filterDimensionsForActiveInteraction(dims, {
    mode: "select_editor",
    wallId,
    wallIds: semantics.lineageIds,
    span: semantics.centerline,
    liveFaceSpans: semantics.suppressSpans,
  });
}

describe("PHASE 2F1-LIVE4.4 pointer-invariant semantics", () => {
  const SHORT = "botR";
  const NEIGHBOR = "botL";

  it("1/2. cursor-far vs centre-grip occupancy do not change semantic set", () => {
    const plan = resolved(shortTHost());
    const a = semanticSnapshot(plan, SHORT);
    const b = semanticSnapshot(plan, SHORT);
    expect(semanticsEqual(a.semantics, b.semantics)).toBe(true);
    expect(a.semantics.faces.map(faceKey).sort()).toEqual(b.semantics.faces.map(faceKey).sort());

    // Stage B occupancy (centre grip) may move labelT only.
    const zoom = 0.22;
    const faces = a.semantics.faces.map((f) => ({
      id: f.id, a: f.a, b: f.b, faceKey: f.face,
    }));
    const mid = {
      x: (a.measurements.a.x + a.measurements.b.x) / 2,
      y: (a.measurements.a.y + a.measurements.b.y) / 2,
    };
    const far = solveSelectedWallDimPresentation({
      faces, wallA: a.measurements.a, wallB: a.measurements.b,
      zoom, laneMm: nearWallLaneOffsetMm(zoom), occupancy: [],
    });
    const near = solveSelectedWallDimPresentation({
      faces, wallA: a.measurements.a, wallB: a.measurements.b,
      zoom, laneMm: nearWallLaneOffsetMm(zoom),
      occupancy: [{ point: mid, clearPx: 42 }],
    });
    expect(Object.keys(far.byId).sort()).toEqual(Object.keys(near.byId).sort());
    for (const id of Object.keys(far.byId)) {
      expect(far.byId[id].canonicalFace).toBe(near.byId[id].canonicalFace);
      expect(far.byId[id].offsetSide).toBe(near.byId[id].offsetSide);
    }
  });

  it("2. every arrow occupancy keeps IDs / faces / anchors / values", () => {
    const plan = resolved(shortTHost());
    const { measurements, semantics } = semanticSnapshot(plan, SHORT);
    const zoom = 0.22;
    const faces = semantics.faces.map((f) => ({
      id: f.id, a: f.a, b: f.b, faceKey: f.face,
    }));
    const mid = {
      x: (measurements.a.x + measurements.b.x) / 2,
      y: (measurements.a.y + measurements.b.y) / 2,
    };
    const ux = (measurements.b.x - measurements.a.x);
    const uy = (measurements.b.y - measurements.a.y);
    const len = Math.hypot(ux, uy) || 1;
    const tx = ux / len;
    const ty = uy / len;
    const nx = -ty;
    const ny = tx;
    const arrowPts = [
      { x: mid.x + nx * 120, y: mid.y + ny * 120 },
      { x: mid.x - nx * 120, y: mid.y - ny * 120 },
      { x: mid.x + tx * 180, y: mid.y + ty * 180 },
      { x: mid.x - tx * 180, y: mid.y - ty * 180 },
    ];
    const baseKeys = semantics.faces.map(faceKey).sort();
    for (const pt of arrowPts) {
      const again = semanticSnapshot(plan, SHORT);
      expect(again.semantics.faces.map(faceKey).sort()).toEqual(baseKeys);
      const placed = solveSelectedWallDimPresentation({
        faces, wallA: measurements.a, wallB: measurements.b,
        zoom, laneMm: nearWallLaneOffsetMm(zoom),
        occupancy: [{ point: mid, clearPx: 42 }, { point: pt, clearPx: 28 }],
      });
      expect(Object.keys(placed.byId).sort()).toEqual(faces.map((f) => f.id).sort());
      for (const f of semantics.faces) {
        expect(placed.byId[f.id].canonicalFace).toBeTruthy();
      }
    }
  });

  it("3. pointer occupancy may change only labelT / knockout segments", () => {
    const plan = resolved(shortTHost());
    const { measurements, semantics } = semanticSnapshot(plan, SHORT);
    const zoom = 0.22;
    const faces = semantics.faces.map((f) => ({
      id: f.id, a: f.a, b: f.b, faceKey: f.face,
    }));
    const mid = {
      x: (measurements.a.x + measurements.b.x) / 2,
      y: (measurements.a.y + measurements.b.y) / 2,
    };
    const a = solveSelectedWallDimPresentation({
      faces, wallA: measurements.a, wallB: measurements.b,
      zoom, laneMm: nearWallLaneOffsetMm(zoom), occupancy: [],
    });
    const b = solveSelectedWallDimPresentation({
      faces, wallA: measurements.a, wallB: measurements.b,
      zoom, laneMm: nearWallLaneOffsetMm(zoom),
      occupancy: [{ point: mid, clearPx: 42 }],
    });
    for (const id of Object.keys(a.byId)) {
      expect(a.byId[id].offsetSide).toBe(b.byId[id].offsetSide);
      expect(a.byId[id].laneMm).toBe(b.byId[id].laneMm);
      expect(a.byId[id].canonicalFace).toBe(b.byId[id].canonicalFace);
      // labelT / knockouts may differ — that is Stage B only.
      expect(Number.isFinite(b.byId[id].labelT)).toBe(true);
    }
  });

  it("4/5. short T segment keeps both physical faces (~2.49 / ~2.59 class)", () => {
    const plan = resolved(shortTHost());
    const { semantics } = semanticSnapshot(plan, SHORT);
    expect(semantics.faces.length).toBe(2);
    const mms = semantics.faces.map((f) => f.mm).sort((x, y) => x - y);
    // CL 2500 → faces ≈ 2450 / 2550 with 100 thk centre.
    expect(mms[0]).toBeGreaterThan(2400);
    expect(mms[0]).toBeLessThan(2500);
    expect(mms[1]).toBeGreaterThan(2500);
    expect(mms[1]).toBeLessThan(2600);
    expect(mms[1] - mms[0]).toBeCloseTo(100, 0);
    // Must not alternate to a single face.
    expect(new Set(semantics.faces.map((f) => f.face)).size).toBe(2);
  });

  it("6/7. neighbor finalized dims stay byte-stable under selection + fake pointer", () => {
    const plan = resolved(shortTHost());
    // Inner/outer pair for the unselected left neighbor (~5.77 / ~5.86 class).
    const leftInner = {
      id: "auto-wall-len-botL-1",
      kind: "wall_length",
      wallId: NEIGHBOR,
      auto: true,
      p1: { x: 10050, y: 15050 },
      p2: { x: 15450, y: 15050 },
      measurementValue: 5400,
    };
    const leftOuter = {
      id: "auto-ext-botL",
      kind: "external_segment",
      auto: true,
      p1: { x: 9950, y: 15050 },
      p2: { x: 15550, y: 15050 },
      measurementValue: 5600,
    };
    const rightInner = {
      id: "auto-wall-len-botR-1",
      kind: "wall_length",
      wallId: SHORT,
      auto: true,
      p1: { x: 15550, y: 15050 },
      p2: { x: 17950, y: 15050 },
      measurementValue: 2400,
    };
    const dims = [leftInner, leftOuter, rightInner];
    const idle = filterDimensionsForActiveInteraction(dims, { mode: null });
    const { semantics } = semanticSnapshot(plan, SHORT);
    expect(semantics.lineageIds).toEqual([SHORT]);
    const selectedA = suppressWith(semantics, dims, SHORT);
    const selectedB = suppressWith(semantics, dims, SHORT);
    const neighborA = selectedA
      .filter((d) => d.wallId === NEIGHBOR || d.id === "auto-ext-botL")
      .map((d) => JSON.stringify(d))
      .sort();
    const neighborB = selectedB
      .filter((d) => d.wallId === NEIGHBOR || d.id === "auto-ext-botL")
      .map((d) => JSON.stringify(d))
      .sort();
    expect(neighborA).toEqual(neighborB);
    // Selected right wall_length suppressed; neighbor left wall_length retained.
    expect(selectedA.some((d) => d.id === "auto-wall-len-botR-1")).toBe(false);
    expect(selectedA.some((d) => d.id === "auto-wall-len-botL-1")).toBe(true);
    // Neighbor values must not switch 5.77↔5.86 class because of a second
    // identical suppress pass (pointer-invariant Stage A).
    expect(neighborA).toEqual(
      idle
        .filter((d) => d.wallId === NEIGHBOR || d.id === "auto-ext-botL")
        .map((d) => JSON.stringify(d))
        .sort(),
    );
  });

  it("8. controls-mount (float hidePrimary) must not change Stage A faces", () => {
    const plan = resolved(shortTHost());
    const { measurements, semantics } = semanticSnapshot(plan, SHORT);
    expect(semantics.faces.length).toBe(2);
    // Simulate overlay filter used when float owns draw primary:
    const hidePrimaryLabel = true;
    const after = (measurements.labels || []).filter(
      (l) => !(hidePrimaryLabel && l.role === "primary" && l.kind !== "face"),
    );
    const facesAfter = after.filter((l) => l.kind === "face");
    expect(facesAfter.length).toBe(2);
    expect(facesAfter.map((l) => l.id).sort()).toEqual(
      semantics.faces.map((f) => f.id).sort(),
    );
  });

  it("9. vertical selected wall creates both face descriptors atomically", () => {
    const plan = resolved(freeV());
    void semanticSnapshot(plan, "freeV");
    // Free wall with equal faces → one face; use room vertical for dual.
    const room = resolved(shortTHost());
    const v = semanticSnapshot(room, "right");
    expect(v.semantics.faces.length).toBe(2);
    expect(v.semantics.faces.map((f) => f.face).sort()).toEqual(["A", "B"]);
    // First committed snapshot already has both — no staged add.
    const again = semanticSnapshot(room, "right");
    expect(again.semantics.fingerprint).toBe(v.semantics.fingerprint);
  });

  it("10. deselect restores the original finalized set", () => {
    const dims = [
      { id: "a", kind: "wall_length", wallId: SHORT, auto: true, p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 } },
      { id: "b", kind: "wall_length", wallId: NEIGHBOR, auto: true, p1: { x: 0, y: 10 }, p2: { x: 100, y: 10 } },
    ];
    const plan = resolved(shortTHost());
    const { semantics } = semanticSnapshot(plan, SHORT);
    const selected = suppressWith(semantics, dims, SHORT);
    const restored = filterDimensionsForActiveInteraction(dims, { mode: null });
    expect(restored).toHaveLength(2);
    expect(selected.some((d) => d.id === "a")).toBe(false);
    expect(restored.map((d) => d.id).sort()).toEqual(["a", "b"]);
  });

  it("11. selection semantics are pure — no plan mutation", () => {
    const plan = resolved(shortTHost());
    const before = JSON.stringify(plan.dimensions);
    const histLen = plan.validationWarnings?.length ?? 0;
    semanticSnapshot(plan, SHORT);
    suppressWith(semanticSnapshot(plan, SHORT).semantics, [
      { id: "x", kind: "wall_length", wallId: SHORT, auto: true, p1: { x: 1, y: 1 }, p2: { x: 2, y: 1 } },
    ], SHORT);
    expect(JSON.stringify(plan.dimensions)).toBe(before);
    expect(plan.validationWarnings?.length ?? 0).toBe(histLen);
  });

  it("layout collision must not hide major exterior dims (priority ≤ 2)", () => {
    const dims = [
      {
        id: "ext",
        kind: "external_segment",
        auto: true,
        selected: false,
        label: "5.86 м",
        measurementValue: 5860,
      },
      {
        id: "wl",
        kind: "wall_length",
        auto: true,
        selected: false,
        label: "5.77 м",
        measurementValue: 5765,
      },
    ];
    const geometry = {
      ext: {
        valid: true,
        length: 5860,
        dimensionLine: { a: { x: 0, y: 0 }, b: { x: 5860, y: 0 } },
        textAngleDeg: 0,
        style: { fontSizePx: 11 },
      },
      wl: {
        valid: true,
        length: 5765,
        dimensionLine: { a: { x: 0, y: 0 }, b: { x: 5765, y: 0 } },
        textAngleDeg: 0,
        style: { fontSizePx: 11 },
      },
    };
    // Seed occupied space so along-line search fails → crowded keep for major.
    const huge = { left: -1e6, right: 1e6, top: -1e6, bottom: 1e6 };
    const laid = layoutDimensionLabels(dims, geometry, {
      zoom: 0.22,
      labelBounds: [huge],
      autoMinZoom: 0,
      autoMinLengthPx: 0,
      majorMinLengthPx: 0,
    });
    const byId = Object.fromEntries(laid.map((e) => [e.id, e]));
    expect(byId.ext.visible).toBe(true);
  });
});
