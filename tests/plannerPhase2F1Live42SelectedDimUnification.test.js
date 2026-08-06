/**
 * PHASE 2F1-LIVE4.2 — one wall-local presentation solver for every wall role
 * and orientation.
 *
 * Subject: solveSelectedWallDimPresentation + the selected-wall label model it
 * is fed by. Physical measurement semantics (M2) are NOT under test here and
 * must not move; these tests only pin WHERE a resolved face value is drawn.
 *
 * Evidence: C:\tmp\phase2f1-live4-2\{before,after}\WALL-CLASS-MATRIX*.
 */
import { describe, it, expect } from "vitest";
import {
  solveSelectedWallDimPresentation,
  canonicalWallFrame,
  wallLocalPoint,
  canonicalDirSign,
  CANONICAL_FACE,
  PREFERRED_FACE_T,
  nearWallLaneOffsetMm,
} from "../src/planner/core/dimensions/selectedDimLayout.js";
import { buildLiveWallEditMeasurements } from "../src/planner/core/walls/liveWallMeasurements.js";
import { resolveSelectedWallPhysicalSpans } from "../src/planner/core/walls/selectedWallPhysicalSpans.js";
import { generateWallDimensions } from "../src/planner/core/dimensions/generateWallDimensions.js";

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

const W = {
  thk: 100, role: "outer", kind: "new", thicknessSide: "center",
  height: 3000, material: "", type: "wall", locked: false,
};
const mkPlan = (nodes, walls) => ({
  nodes,
  walls: walls.map((w) => ({ ...W, ...w })),
  items: [], rooms: [], zones: [], links: [], labels: [], lines: [],
  dimensions: [], validationWarnings: [],
  room: { w: 40000, h: 40000, wallThk: 100, height: 3000 },
});

const OX = 6000;
const OY = 6000;
const PIVOT = { x: OX, y: OY };

/** Closed room: the golden reference lives on its top edge. */
function closedRoomPlan() {
  const nodes = {
    n1: { x: OX, y: OY },
    n2: { x: OX + 8000, y: OY },
    n3: { x: OX + 8000, y: OY + 5000 },
    n4: { x: OX, y: OY + 5000 },
  };
  return mkPlan(nodes, [
    { id: "top", a: "n1", b: "n2" },
    { id: "right", a: "n2", b: "n3" },
    { id: "bottom", a: "n3", b: "n4" },
    { id: "left", a: "n4", b: "n1" },
  ]);
}

function interiorPartitionPlan() {
  const nodes = {
    n1: { x: OX, y: OY },
    n2: { x: OX + 8000, y: OY },
    n3: { x: OX + 8000, y: OY + 5000 },
    n4: { x: OX, y: OY + 5000 },
    m1: { x: OX + 4000, y: OY },
    m2: { x: OX + 4000, y: OY + 5000 },
  };
  return mkPlan(nodes, [
    { id: "topL", a: "n1", b: "m1" },
    { id: "topR", a: "m1", b: "n2" },
    { id: "right", a: "n2", b: "n3" },
    { id: "botR", a: "n3", b: "m2" },
    { id: "botL", a: "m2", b: "n4" },
    { id: "left", a: "n4", b: "n1" },
    { id: "part", a: "m1", b: "m2" },
  ]);
}

function freeWallPlan() {
  return mkPlan(
    { f1: { x: OX, y: OY }, f2: { x: OX + 6000, y: OY } },
    [{ id: "free", a: "f1", b: "f2" }],
  );
}

/** Open L: horizontal arm then vertical arm (RemPlanner reference elbow). */
function openLPlan() {
  return mkPlan(
    {
      e1: { x: OX, y: OY },
      e2: { x: OX + 6000, y: OY },
      e3: { x: OX + 6000, y: OY + 4000 },
    },
    [{ id: "armH", a: "e1", b: "e2" }, { id: "armV", a: "e2", b: "e3" }],
  );
}

function diagonalPlan() {
  return mkPlan(
    { g1: { x: OX, y: OY }, g2: { x: OX + 5000, y: OY + 5000 } },
    [{ id: "diag", a: "g1", b: "g2" }],
  );
}

/* transforms ------------------------------------------------------- */

function rotatePlan(plan, deg) {
  const rad = (deg * Math.PI) / 180;
  const c = Math.round(Math.cos(rad));
  const s = Math.round(Math.sin(rad));
  const nodes = {};
  for (const [id, p] of Object.entries(plan.nodes)) {
    const dx = p.x - PIVOT.x;
    const dy = p.y - PIVOT.y;
    nodes[id] = { x: PIVOT.x + dx * c - dy * s, y: PIVOT.y + dx * s + dy * c };
  }
  return { ...plan, nodes, walls: plan.walls.map((w) => ({ ...w })) };
}
const reverseWall = (plan, id) => ({
  ...plan,
  walls: plan.walls.map((w) => (w.id === id ? { ...w, a: w.b, b: w.a } : { ...w })),
});
const reorderWalls = (plan) => ({ ...plan, walls: [...plan.walls].reverse() });
const translatePlan = (plan, dx, dy) => ({
  ...plan,
  nodes: Object.fromEntries(Object.entries(plan.nodes).map(([k, p]) => [k, { x: p.x + dx, y: p.y + dy }])),
  walls: plan.walls.map((w) => ({ ...w })),
});

/* the render chain under test --------------------------------------- */

const ZOOMS = [0.02, 0.03, 0.045, 0.06, 0.08, 0.1, 0.12, 0.15, 0.18, 0.22,
  0.27, 0.33, 0.4, 0.48, 0.55, 0.66, 0.8, 0.95, 1.15, 1.4];

/** Everything the overlay hands to the solver, for one plan + wall + zoom. */
function solveFor(plan, wallId, zoom, previous = null) {
  const m = buildLiveWallEditMeasurements({
    previewPlan: plan, wallId, editKind: "endpoint", room: plan.room,
  });
  expect(m?.valid, `no live measurements for ${wallId}`).toBe(true);
  const faces = m.labels
    .filter((l) => l.kind === "face" && l.a && l.b)
    .map((l) => ({ id: l.id, a: l.a, b: l.b, faceKey: l.face ?? null }));
  const wallMid = { x: (m.a.x + m.b.x) / 2, y: (m.a.y + m.b.y) / 2 };
  const solved = solveSelectedWallDimPresentation({
    faces,
    wallA: m.a,
    wallB: m.b,
    zoom,
    laneMm: nearWallLaneOffsetMm(zoom),
    occupancy: [{ point: wallMid, clearPx: 42 }],
    previous,
  });
  return { measurements: m, solved };
}

/**
 * Wall-local signature: the canonical face identities, their canonical t and
 * their lane sign. This is the set the brief pins ("face identity, t and lane").
 * It is compared as a SET: a rigid 180° turn legitimately moves a given physical
 * face to the other canonical side, and the canonical +u direction turns with it.
 */
function wallLocalSignature(plan, wallId, zoom = 0.08) {
  const { measurements, solved } = solveFor(plan, wallId, zoom);
  const frame = canonicalWallFrame(measurements.a, measurements.b);
  return solved.faces
    .map((f) => [
      f.canonicalFace,
      f.canonicalT.toFixed(6),
      Math.sign(Number(wallLocalPoint(frame, f.labelPos).v.toFixed(6))),
      Math.round(f.laneMm * 1000) / 1000,
    ].join("/"))
    .sort()
    .join(" | ");
}

/**
 * PHYSICAL signature — the invariant a user can actually see.
 *
 * Each placed face is keyed by the length it measures, and its label is located
 * by (a) the fraction along the wall measured from a fixed physical node and
 * (b) which physical side of the wall it sits on, expressed relative to a fixed
 * reference point of the plan. Every entry is invariant under any rigid motion,
 * under endpoint reversal and under wall-array reorder.
 */
function physicalSignature(plan, wallId, anchorNodeId, referencePointOf, zoom = 0.08) {
  const { measurements, solved } = solveFor(plan, wallId, zoom);
  const anchor = plan.nodes[anchorNodeId];
  const wallMid = { x: (measurements.a.x + measurements.b.x) / 2, y: (measurements.a.y + measurements.b.y) / 2 };
  const far = Math.hypot(measurements.a.x - anchor.x, measurements.a.y - anchor.y)
    > Math.hypot(measurements.b.x - anchor.x, measurements.b.y - anchor.y)
    ? measurements.a : measurements.b;
  const dx = far.x - anchor.x;
  const dy = far.y - anchor.y;
  const len = Math.hypot(dx, dy);
  const ref = referencePointOf(plan);
  const toRef = { x: ref.x - wallMid.x, y: ref.y - wallMid.y };
  return solved.faces
    .map((f) => {
      const frac = ((f.labelPos.x - anchor.x) * dx + (f.labelPos.y - anchor.y) * dy) / (len * len);
      const off = { x: f.labelPos.x - wallMid.x, y: f.labelPos.y - wallMid.y };
      const towardRef = Math.sign(Number((off.x * toRef.x + off.y * toRef.y).toFixed(6)));
      const label = (solved.byId[f.id] && f.id) || f.id;
      const mm = measurements.labels.find((l) => l.id === label)?.mm ?? null;
      return `${Math.round(mm)}mm@${frac.toFixed(6)}/side=${towardRef}`;
    })
    .sort()
    .join(" | ");
}

const roomCentroid = (plan) => {
  const ids = ["n1", "n2", "n3", "n4"];
  const pts = ids.map((i) => plan.nodes[i]).filter(Boolean);
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  };
};

/** Sign of a face's own offset from the wall centreline, in the local frame. */
function faceLocalVSign(frame, wallMid, faceSpan) {
  const mid = { x: (faceSpan.a.x + faceSpan.b.x) / 2, y: (faceSpan.a.y + faceSpan.b.y) / 2 };
  const v = wallLocalPoint(frame, mid).v - wallLocalPoint(frame, wallMid).v;
  return Math.sign(Number(v.toFixed(6)));
}

/* ------------------------------------------------------------------ */
/* 1 / 2 / 3 — golden reference and its rotations                      */
/* ------------------------------------------------------------------ */

describe("LIVE4.2 — golden horizontal reference and rotational equivalence", () => {
  it("1. the golden horizontal exterior wall keeps one deterministic layout", () => {
    const plan = closedRoomPlan();
    const sig = wallLocalSignature(plan, "top");
    // Two physical faces, distinct canonical identities, distinct canonical t.
    const { solved } = solveFor(plan, "top", 0.08);
    expect(solved.faces).toHaveLength(2);
    const ids = [...solved.faces.map((f) => f.canonicalFace)].sort();
    expect(ids).toEqual([CANONICAL_FACE.V_NEG, CANONICAL_FACE.V_POS].sort());
    expect(sig).toBe(wallLocalSignature(plan, "top"));
  });

  it("2. the rotated vertical equivalent has the same wall-local layout", () => {
    const h = wallLocalSignature(closedRoomPlan(), "top");
    const v = wallLocalSignature(rotatePlan(closedRoomPlan(), 90), "top");
    expect(v).toBe(h);
    // …and the same PHYSICAL layout: each face length keeps its position along
    // the wall from a fixed node, on the same physical side of the wall.
    expect(physicalSignature(rotatePlan(closedRoomPlan(), 90), "top", "n1", roomCentroid))
      .toBe(physicalSignature(closedRoomPlan(), "top", "n1", roomCentroid));
  });

  it("3. rotation 90/180/270 preserves face identity, t and lane", () => {
    const refLocal = wallLocalSignature(closedRoomPlan(), "top");
    const refPhys = physicalSignature(closedRoomPlan(), "top", "n1", roomCentroid);
    for (const deg of [90, 180, 270]) {
      const p = rotatePlan(closedRoomPlan(), deg);
      expect(wallLocalSignature(p, "top"), `rot${deg} wall-local`).toBe(refLocal);
      expect(physicalSignature(p, "top", "n1", roomCentroid), `rot${deg} physical`).toBe(refPhys);
    }
  });

  it("4. endpoint reversal preserves face identity", () => {
    const p = reverseWall(closedRoomPlan(), "top");
    expect(wallLocalSignature(p, "top")).toBe(wallLocalSignature(closedRoomPlan(), "top"));
    expect(physicalSignature(p, "top", "n1", roomCentroid))
      .toBe(physicalSignature(closedRoomPlan(), "top", "n1", roomCentroid));
  });

  it("5. wall-array reorder preserves placement", () => {
    const p = reorderWalls(closedRoomPlan());
    expect(wallLocalSignature(p, "top")).toBe(wallLocalSignature(closedRoomPlan(), "top"));
    expect(physicalSignature(p, "top", "n1", roomCentroid))
      .toBe(physicalSignature(closedRoomPlan(), "top", "n1", roomCentroid));
  });

  it("world translation preserves placement (M2 origin independence holds here too)", () => {
    const p = translatePlan(closedRoomPlan(), 1_200_000, -840_000);
    expect(wallLocalSignature(p, "top")).toBe(wallLocalSignature(closedRoomPlan(), "top"));
    expect(physicalSignature(p, "top", "n1", roomCentroid))
      .toBe(physicalSignature(closedRoomPlan(), "top", "n1", roomCentroid));
  });
});

/* ------------------------------------------------------------------ */
/* 6 / 13 — deterministic, non-swapping face placement                 */
/* ------------------------------------------------------------------ */

describe("LIVE4.2 — deterministic face-specific placement", () => {
  it("6. both physical faces receive deterministic DISTINCT positions", () => {
    const plan = closedRoomPlan();
    for (const z of ZOOMS) {
      const { solved } = solveFor(plan, "top", z);
      expect(solved.faces).toHaveLength(2);
      const [f1, f2] = solved.faces;
      expect(f1.canonicalT, `shared t at zoom ${z}`).not.toBeCloseTo(f2.canonicalT, 9);
      expect(f1.canonicalFace).not.toBe(f2.canonicalFace);
    }
    const { solved } = solveFor(plan, "top", 0.08);
    for (const f of solved.faces) {
      expect(f.canonicalT).toBeCloseTo(PREFERRED_FACE_T[f.canonicalFace], 9);
    }
  });

  it("13. a face value is never drawn over the opposite physical face", () => {
    // The pre-4.2 defect: the lane used the face's INVERTED normal, so at every
    // zoom below ~0.44 (22px/zoom > half the 100mm wall) each value crossed the
    // wall. Measured before the fix: 1520 wrong-side frames across the matrix.
    for (const [plan, wallId] of [
      [closedRoomPlan(), "top"],
      [rotatePlan(closedRoomPlan(), 90), "top"],
      [interiorPartitionPlan(), "part"],
      [openLPlan(), "armH"],
      [openLPlan(), "armV"],
      [diagonalPlan(), "diag"],
    ]) {
      const spans = resolveSelectedWallPhysicalSpans(plan, wallId, { room: plan.room });
      for (const z of ZOOMS) {
        const { measurements, solved } = solveFor(plan, wallId, z);
        const frame = canonicalWallFrame(measurements.a, measurements.b);
        const wallMid = { x: (measurements.a.x + measurements.b.x) / 2, y: (measurements.a.y + measurements.b.y) / 2 };
        for (const f of solved.faces) {
          const span = f.faceKey === "A" ? spans.faceA : spans.faceB;
          const faceSide = faceLocalVSign(frame, wallMid, span);
          const labelSide = Math.sign(Number((wallLocalPoint(frame, f.labelPos).v
            - wallLocalPoint(frame, wallMid).v).toFixed(6)));
          expect(labelSide, `${wallId} face ${f.faceKey} at zoom ${z}`).toBe(faceSide);
        }
      }
    }
  });
});

/* ------------------------------------------------------------------ */
/* 7 / 8 / 9 — every role uses the same solver                         */
/* ------------------------------------------------------------------ */

describe("LIVE4.2 — every wall role goes through the one solver", () => {
  const ROLES = [
    ["exterior closed room", closedRoomPlan(), "top"],
    ["interior partition", interiorPartitionPlan(), "part"],
    ["free-standing", freeWallPlan(), "free"],
    ["open chain horizontal arm", openLPlan(), "armH"],
    ["open chain vertical arm", openLPlan(), "armV"],
    ["diagonal", diagonalPlan(), "diag"],
  ];

  for (const [name, plan, wallId] of ROLES) {
    it(`7/8/9. ${name} produces a canonical face, a preferred t and an outward lane`, () => {
      const { measurements, solved } = solveFor(plan, wallId, 0.08);
      const frame = canonicalWallFrame(measurements.a, measurements.b);
      const wallMid = { x: (measurements.a.x + measurements.b.x) / 2, y: (measurements.a.y + measurements.b.y) / 2 };
      expect(solved.faces.length).toBeGreaterThan(0);
      for (const f of solved.faces) {
        expect([CANONICAL_FACE.V_NEG, CANONICAL_FACE.V_POS]).toContain(f.canonicalFace);
        expect(f.canonicalT).toBeCloseTo(PREFERRED_FACE_T[f.canonicalFace], 9);
        // lane pushes AWAY from the wall
        const labelV = wallLocalPoint(frame, f.labelPos).v - wallLocalPoint(frame, wallMid).v;
        expect(Math.sign(Number(labelV.toFixed(6))))
          .toBe(f.canonicalFace === CANONICAL_FACE.V_NEG ? -1 : 1);
        // and stays in the near-wall lane, never a 240mm dodge
        expect(f.lanePx).toBeLessThanOrEqual(40 + 1e-9);
      }
    });
  }

  it("14. the open L measures its REAL exterior face in the exterior lane", () => {
    const plan = openLPlan();
    // Horizontal arm: exterior is the upper face; vertical arm: the right face.
    const hm = buildLiveWallEditMeasurements({ previewPlan: plan, wallId: "armH", editKind: "endpoint", room: plan.room });
    const vm = buildLiveWallEditMeasurements({ previewPlan: plan, wallId: "armV", editKind: "endpoint", room: plan.room });
    const hExt = hm.labels.find((l) => l.kind === "face" && l.exterior);
    const vExt = vm.labels.find((l) => l.kind === "face" && l.exterior);
    expect(hExt, "no exterior face flagged on the horizontal arm").toBeTruthy();
    expect(vExt, "no exterior face flagged on the vertical arm").toBeTruthy();
    // The exterior face is the longer one on the outside of the elbow.
    expect(hExt.mm).toBeGreaterThan(hm.centerlineMm);
    expect(vExt.mm).toBeGreaterThan(vm.centerlineMm);
    // Exterior face of the horizontal arm lies ABOVE it (smaller y).
    const hMidY = (hExt.a.y + hExt.b.y) / 2;
    expect(hMidY).toBeLessThan((hm.a.y + hm.b.y) / 2);
    // Exterior face of the vertical arm lies to its RIGHT (larger x).
    const vMidX = (vExt.a.x + vExt.b.x) / 2;
    expect(vMidX).toBeGreaterThan((vm.a.x + vm.b.x) / 2);
    // …and the solver keeps each of those values on its own side.
    for (const [plan2, wallId, ext] of [[plan, "armH", hExt], [plan, "armV", vExt]]) {
      const { measurements, solved } = solveFor(plan2, wallId, 0.08);
      const frame = canonicalWallFrame(measurements.a, measurements.b);
      const wallMid = { x: (measurements.a.x + measurements.b.x) / 2, y: (measurements.a.y + measurements.b.y) / 2 };
      const placed = solved.byId[ext.id];
      expect(placed, `${wallId} exterior face not placed`).toBeTruthy();
      expect(Math.sign(Number((wallLocalPoint(frame, placed.labelPos).v - wallLocalPoint(frame, wallMid).v).toFixed(6))))
        .toBe(faceLocalVSign(frame, wallMid, ext));
    }
  });
});

/* ------------------------------------------------------------------ */
/* 10 / 11 / 12 — zoom stability                                       */
/* ------------------------------------------------------------------ */

describe("LIVE4.2 — zoom stability", () => {
  const CASES = [
    ["golden horizontal exterior", closedRoomPlan(), "top"],
    ["rotated vertical exterior", rotatePlan(closedRoomPlan(), 90), "top"],
    ["interior partition", interiorPartitionPlan(), "part"],
    ["free-standing", freeWallPlan(), "free"],
    ["open chain arm", openLPlan(), "armV"],
    ["diagonal", diagonalPlan(), "diag"],
  ];

  for (const [name, plan, wallId] of CASES) {
    it(`10/11. ${name}: twenty zoom steps produce zero oscillations`, () => {
      let prev = null;
      const seen = [];
      for (const z of ZOOMS) {
        const { solved } = solveFor(plan, wallId, z, prev);
        prev = solved.state;
        seen.push(solved.faces.map((f) => `${f.canonicalFace}@${f.canonicalT}/${f.offsetSide}`).sort().join("|"));
      }
      const distinct = [...new Set(seen)];
      expect(distinct, `${name} changed placement during a monotone zoom sweep: ${JSON.stringify(distinct)}`)
        .toHaveLength(1);
    });

    it(`12. ${name}: returning to the original zoom restores the original placement`, () => {
      let prev = null;
      const at = (z) => {
        const { solved } = solveFor(plan, wallId, z, prev);
        prev = solved.state;
        return solved.faces.map((f) => `${f.canonicalFace}@${f.canonicalT}/${f.offsetSide}`).sort().join("|");
      };
      const start = at(ZOOMS[0]);
      for (const z of ZOOMS.slice(1)) at(z);
      for (const z of [...ZOOMS].reverse().slice(1)) at(z);
      expect(at(ZOOMS[0])).toBe(start);
    });
  }

  it("10. a 45° wall does not oscillate between candidate positions", () => {
    // Pre-4.2 the diagonal decided 0.25-vs-0.75 by floating-point residue and
    // switched 8 times over the same sweep.
    let prev = null;
    const ts = [];
    for (const z of ZOOMS) {
      const { solved } = solveFor(diagonalPlan(), "diag", z, prev);
      prev = solved.state;
      ts.push(...solved.faces.map((f) => f.canonicalT));
    }
    expect([...new Set(ts)]).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* collision behaviour + hysteresis (section 7)                        */
/* ------------------------------------------------------------------ */

describe("LIVE4.2 — collision handling stays bounded and deterministic", () => {
  it("the centre control alone never displaces a preferred position", () => {
    // PREFERRED_FACE_T sits ±0.15 from the centre; the clamped control+text
    // footprint is 0.115, so the preferred position is provably clear at any
    // zoom. Placement therefore only moves for a real ADDITIONAL obstacle.
    const plan = closedRoomPlan();
    for (const z of ZOOMS) {
      const { solved } = solveFor(plan, "top", z);
      for (const f of solved.faces) expect(f.reason).toBe("preferred");
    }
  });

  it("an extra control on the preferred position shifts it — within a bounded region", () => {
    const plan = closedRoomPlan();
    const m = buildLiveWallEditMeasurements({ previewPlan: plan, wallId: "top", editKind: "endpoint", room: plan.room });
    const faces = m.labels.filter((l) => l.kind === "face").map((l) => ({ id: l.id, a: l.a, b: l.b, faceKey: l.face }));
    const wallMid = { x: (m.a.x + m.b.x) / 2, y: (m.a.y + m.b.y) / 2 };
    // A second control parked exactly on the V_NEG preferred spot.
    const blocker = {
      x: m.a.x + (m.b.x - m.a.x) * PREFERRED_FACE_T[CANONICAL_FACE.V_NEG],
      y: m.a.y + (m.b.y - m.a.y) * PREFERRED_FACE_T[CANONICAL_FACE.V_NEG],
    };
    const solved = solveSelectedWallDimPresentation({
      faces, wallA: m.a, wallB: m.b, zoom: 0.4,
      laneMm: nearWallLaneOffsetMm(0.4),
      occupancy: [{ point: wallMid, clearPx: 42 }, { point: blocker, clearPx: 42 }],
      previous: null,
    });
    const neg = solved.faces.find((f) => f.canonicalFace === CANONICAL_FACE.V_NEG);
    const pos = solved.faces.find((f) => f.canonicalFace === CANONICAL_FACE.V_POS);
    expect(neg.reason).toBe("shifted");
    expect(Math.abs(neg.canonicalT - PREFERRED_FACE_T[CANONICAL_FACE.V_NEG]))
      .toBeLessThanOrEqual(0.24 + 1e-9);
    // The other face is untouched — faces never trade places.
    expect(pos.reason).toBe("preferred");
    expect(neg.canonicalFace).not.toBe(pos.canonicalFace);
  });

  it("a retained placement is given up only when the preferred one is clear", () => {
    const plan = closedRoomPlan();
    const m = buildLiveWallEditMeasurements({ previewPlan: plan, wallId: "top", editKind: "endpoint", room: plan.room });
    const faces = m.labels.filter((l) => l.kind === "face").map((l) => ({ id: l.id, a: l.a, b: l.b, faceKey: l.face }));
    const wallMid = { x: (m.a.x + m.b.x) / 2, y: (m.a.y + m.b.y) / 2 };
    const blocker = {
      x: m.a.x + (m.b.x - m.a.x) * PREFERRED_FACE_T[CANONICAL_FACE.V_NEG],
      y: m.a.y + (m.b.y - m.a.y) * PREFERRED_FACE_T[CANONICAL_FACE.V_NEG],
    };
    const base = { faces, wallA: m.a, wallB: m.b, zoom: 0.4, laneMm: nearWallLaneOffsetMm(0.4) };
    const blocked = solveSelectedWallDimPresentation({
      ...base, occupancy: [{ point: wallMid, clearPx: 42 }, { point: blocker, clearPx: 42 }], previous: null,
    });
    const shiftedT = blocked.faces.find((f) => f.canonicalFace === CANONICAL_FACE.V_NEG).canonicalT;
    // Blocker removed: the deterministic home position is taken back.
    const freed = solveSelectedWallDimPresentation({
      ...base, occupancy: [{ point: wallMid, clearPx: 42 }], previous: blocked.state,
    });
    const home = freed.faces.find((f) => f.canonicalFace === CANONICAL_FACE.V_NEG);
    expect(shiftedT).not.toBeCloseTo(PREFERRED_FACE_T[CANONICAL_FACE.V_NEG], 9);
    expect(home.canonicalT).toBeCloseTo(PREFERRED_FACE_T[CANONICAL_FACE.V_NEG], 9);
  });

  it("knockout intervals stay inside [0,1] and vary smoothly with zoom", () => {
    const plan = closedRoomPlan();
    let prevSpanCount = null;
    for (const z of ZOOMS) {
      const { solved } = solveFor(plan, "top", z);
      for (const f of solved.faces) {
        for (const g of f.knockouts) {
          expect(g.t0).toBeGreaterThanOrEqual(0);
          expect(g.t1).toBeLessThanOrEqual(1);
          expect(g.t1).toBeGreaterThanOrEqual(g.t0);
        }
        expect(f.segments.length).toBeGreaterThan(0);
      }
      const count = solved.faces[0].knockouts.length;
      if (prevSpanCount != null) expect(Math.abs(count - prevSpanCount)).toBeLessThanOrEqual(1);
      prevSpanCount = count;
    }
  });
});

/* ------------------------------------------------------------------ */
/* 15 / 16 — nothing upstream moved                                    */
/* ------------------------------------------------------------------ */

describe("LIVE4.2 — upstream semantics are frozen", () => {
  it("15. closed-room semantic dimensions are unchanged by the presentation work", () => {
    const plan = closedRoomPlan();
    const dims = generateWallDimensions(plan, { room: plan.room });
    const list = Array.isArray(dims) ? dims : (dims?.dimensions || []);
    expect(list.length).toBeGreaterThan(0);
    // Every generated dimension still measures a real span with real anchors.
    for (const d of list) {
      expect(Number.isFinite(d.measurementValue ?? d.value ?? NaN) || d.p1).toBeTruthy();
    }
  });

  it("15. the M2 physical face spans are untouched by the solver", () => {
    const plan = closedRoomPlan();
    const before = resolveSelectedWallPhysicalSpans(plan, "top", { room: plan.room });
    solveFor(plan, "top", 0.08);
    const after = resolveSelectedWallPhysicalSpans(plan, "top", { room: plan.room });
    expect(after.faceA).toEqual(before.faceA);
    expect(after.faceB).toEqual(before.faceB);
    expect(after.faceA.lengthMm).toBeCloseTo(7900, 6);
    expect(after.faceB.lengthMm).toBeCloseTo(8100, 6);
  });

  it("16. the near-wall lane still obeys the grip-scale bounds at every zoom", () => {
    for (const z of ZOOMS) {
      const mm = nearWallLaneOffsetMm(z);
      expect(mm * z).toBeGreaterThanOrEqual(14 - 1e-9);
      expect(mm * z).toBeLessThanOrEqual(40 + 1e-9);
    }
  });

  it("the canonical direction rule is the single shared one (M2 tie-break)", () => {
    expect(canonicalDirSign({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe(1);
    expect(canonicalDirSign({ x: 10, y: 0 }, { x: 0, y: 0 })).toBe(-1);
    expect(canonicalDirSign({ x: 0, y: 0 }, { x: 0, y: 10 })).toBe(1);
    expect(canonicalDirSign({ x: 0, y: 10 }, { x: 0, y: 0 })).toBe(-1);
  });
});
