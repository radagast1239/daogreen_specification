/**
 * PHASE 2F2 — true corner angle dimensions (self-contained).
 */
import { describe, it, expect } from "vitest";
import {
  buildSelectedWallCornerAngles,
  collectIncidentRays,
  presentCornerAngle,
  presentSelectedCornerAngles,
  displayCornerAngleDeg,
  formatCornerAngleDisplay,
  nodeAdjacentSectors,
  sectorSumDeg,
  cornerArcRadiusMm,
} from "../src/planner/core/dimensions/cornerAngleDimensions.js";
import { buildLiveWallEditMeasurements } from "../src/planner/core/walls/liveWallMeasurements.js";
import { moveNode } from "../src/planner/core/walls/wallCommands.js";
import {
  resolveSelectedDimensionSemantics,
} from "../src/planner/core/dimensions/selectedDimensionSemantics.js";

const OX = 10_000;
const OY = 20_000;
const PIVOT = { x: OX + 4000, y: OY + 2500 };

function mkPlan(nodes, walls, extra = {}) {
  return {
    nodes: { ...nodes },
    walls: walls.map((w) => ({
      thk: 100,
      thicknessSide: "center",
      ...w,
    })),
    room: extra.room || null,
    rooms: extra.rooms || [],
    ...extra,
  };
}

function closedRoomPlan() {
  const nodes = {
    n1: { x: OX, y: OY },
    n2: { x: OX + 8000, y: OY },
    n3: { x: OX + 8000, y: OY + 5000 },
    n4: { x: OX, y: OY + 5000 },
  };
  const rooms = [{
    id: "r1",
    polygon: [nodes.n1, nodes.n2, nodes.n3, nodes.n4],
  }];
  return mkPlan(nodes, [
    { id: "top", a: "n1", b: "n2" },
    { id: "right", a: "n2", b: "n3" },
    { id: "bottom", a: "n3", b: "n4" },
    { id: "left", a: "n4", b: "n1" },
  ], { rooms });
}

function openLPlan() {
  return mkPlan(
    {
      e1: { x: OX, y: OY },
      e2: { x: OX + 6000, y: OY },
      e3: { x: OX + 6000, y: OY + 4000 },
    },
    [
      { id: "armH", a: "e1", b: "e2" },
      { id: "armV", a: "e2", b: "e3" },
    ],
  );
}

function acuteCornerPlan() {
  // ~53.13° between +x and a steep diagonal
  return mkPlan(
    {
      a: { x: OX, y: OY },
      b: { x: OX + 4000, y: OY },
      c: { x: OX + 3000, y: OY + 4000 },
    },
    [
      { id: "w1", a: "a", b: "b" },
      { id: "w2", a: "b", b: "c" },
    ],
  );
}

function obtuseCornerPlan() {
  // Outgoing rays at 0° and 120° → intended non-reflex sector 120°.
  const j = { x: OX + 4000, y: OY };
  const ang = (120 * Math.PI) / 180;
  return mkPlan(
    {
      a: { x: j.x + 4000, y: j.y },
      b: j,
      c: { x: j.x + Math.cos(ang) * 4000, y: j.y + Math.sin(ang) * 4000 },
    },
    [
      { id: "w1", a: "a", b: "b" },
      { id: "w2", a: "b", b: "c" },
    ],
  );
}

function mirroredCornerPlan() {
  // mirror of open L across vertical through bend
  return mkPlan(
    {
      e1: { x: OX + 6000, y: OY },
      e2: { x: OX, y: OY },
      e3: { x: OX, y: OY + 4000 },
    },
    [
      { id: "armH", a: "e1", b: "e2" },
      { id: "armV", a: "e2", b: "e3" },
    ],
  );
}

function perpTPlan() {
  return mkPlan(
    {
      h1: { x: OX, y: OY },
      t: { x: OX + 4000, y: OY },
      h2: { x: OX + 8000, y: OY },
      b: { x: OX + 4000, y: OY + 3000 },
    },
    [
      { id: "hostL", a: "h1", b: "t", chainId: "host" },
      { id: "hostR", a: "t", b: "h2", chainId: "host" },
      { id: "branch", a: "t", b: "b" },
    ],
  );
}

function angledTPlan() {
  // branch at 60° from +x host → sectors 60 and 120, sum 180
  const ang = (60 * Math.PI) / 180;
  return mkPlan(
    {
      h1: { x: OX, y: OY },
      t: { x: OX + 4000, y: OY },
      h2: { x: OX + 8000, y: OY },
      b: { x: OX + 4000 + Math.cos(ang) * 3000, y: OY + Math.sin(ang) * 3000 },
    },
    [
      { id: "hostL", a: "h1", b: "t", chainId: "host" },
      { id: "hostR", a: "t", b: "h2", chainId: "host" },
      { id: "branch", a: "t", b: "b" },
    ],
  );
}

function hub3Plan() {
  // three rays at 0°, 120°, 240°
  const r = 3000;
  return mkPlan(
    {
      c: { x: OX, y: OY },
      a: { x: OX + r, y: OY },
      b: { x: OX + r * Math.cos((120 * Math.PI) / 180), y: OY + r * Math.sin((120 * Math.PI) / 180) },
      d: { x: OX + r * Math.cos((240 * Math.PI) / 180), y: OY + r * Math.sin((240 * Math.PI) / 180) },
    },
    [
      { id: "wA", a: "c", b: "a" },
      { id: "wB", a: "c", b: "b" },
      { id: "wD", a: "c", b: "d" },
    ],
  );
}

function hub4Plan() {
  const r = 3000;
  return mkPlan(
    {
      c: { x: OX, y: OY },
      n0: { x: OX + r, y: OY },
      n1: { x: OX, y: OY + r },
      n2: { x: OX - r, y: OY },
      n3: { x: OX, y: OY - r },
    },
    [
      { id: "e", a: "c", b: "n0" },
      { id: "s", a: "c", b: "n1" },
      { id: "w", a: "c", b: "n2" },
      { id: "n", a: "c", b: "n3" },
    ],
  );
}

function freeEndpointPlan() {
  return mkPlan(
    { f1: { x: OX, y: OY }, f2: { x: OX + 5000, y: OY } },
    [{ id: "free", a: "f1", b: "f2" }],
  );
}

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
  return {
    ...plan,
    nodes,
    walls: plan.walls.map((w) => ({ ...w })),
    rooms: (plan.rooms || []).map((r) => ({
      ...r,
      polygon: (r.polygon || []).map((p) => {
        const dx = p.x - PIVOT.x;
        const dy = p.y - PIVOT.y;
        return { x: PIVOT.x + dx * c - dy * s, y: PIVOT.y + dx * s + dy * c };
      }),
    })),
  };
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
  rooms: (plan.rooms || []).map((r) => ({
    ...r,
    polygon: (r.polygon || []).map((p) => ({ x: p.x + dx, y: p.y + dy })),
  })),
});

function degs(plan, wallId) {
  return buildSelectedWallCornerAngles(plan, wallId).map((a) => a.displayDeg).sort((a, b) => a - b);
}

function sectorKeys(plan, wallId) {
  return buildSelectedWallCornerAngles(plan, wallId).map((a) => a.sectorKey).sort();
}

describe("PHASE 2F2 — degree-2 corners", () => {
  it("1. degree-2 90° corner", () => {
    const plan = openLPlan();
    expect(degs(plan, "armH")).toEqual([90]);
    expect(degs(plan, "armV")).toEqual([90]);
  });

  it("2. acute corner", () => {
    const plan = acuteCornerPlan();
    const d = degs(plan, "w1")[0];
    expect(d).toBeLessThan(90);
    expect(d).toBeGreaterThan(40);
    expect(d).toBe(displayCornerAngleDeg(
      (Math.acos(
        // vector from b to a = (-4000,0), b to c = (-1000,4000)
        (() => {
          const v1 = { x: -4000, y: 0 };
          const v2 = { x: -1000, y: 4000 };
          const l1 = Math.hypot(v1.x, v1.y);
          const l2 = Math.hypot(v2.x, v2.y);
          return (v1.x / l1) * (v2.x / l2) + (v1.y / l1) * (v2.y / l2);
        })(),
      ) * 180) / Math.PI,
    ));
  });

  it("3. obtuse corner", () => {
    const plan = obtuseCornerPlan();
    const d = degs(plan, "w1")[0];
    expect(d).toBeGreaterThan(90);
    expect(d).toBeLessThan(180);
  });

  it("4. mirrored corner", () => {
    expect(degs(mirroredCornerPlan(), "armH")).toEqual([90]);
    expect(degs(openLPlan(), "armH")).toEqual([90]);
  });

  it("5. endpoint reversal", () => {
    const plan = openLPlan();
    const rev = reverseWall(reverseWall(plan, "armH"), "armV");
    expect(degs(rev, "armH")).toEqual(degs(plan, "armH"));
    expect(sectorKeys(rev, "armV").map((k) => k.split(":").pop()))
      .toEqual(sectorKeys(plan, "armV").map((k) => k.split(":").pop()));
  });

  it("6. rotation 90/180/270", () => {
    const base = degs(closedRoomPlan(), "top");
    expect(base).toEqual([90, 90]);
    for (const deg of [90, 180, 270]) {
      const got = degs(rotatePlan(closedRoomPlan(), deg), "top");
      expect(got.every((d) => d === 90), `rot${deg} values`).toBe(true);
      expect(got.length, `rot${deg} count`).toBe(base.length);
    }
  });

  it("7. wall-array reorder", () => {
    const plan = closedRoomPlan();
    expect(degs(reorderWalls(plan), "top")).toEqual(degs(plan, "top"));
    expect(sectorKeys(reorderWalls(plan), "right")).toEqual(sectorKeys(plan, "right"));
  });

  it("8. translation / off-origin", () => {
    const plan = closedRoomPlan();
    const moved = translatePlan(plan, 1_200_000, -840_000);
    expect(degs(moved, "top")).toEqual(degs(plan, "top"));
  });

  it("9. open-L interior sector (not 270°)", () => {
    const angs = buildSelectedWallCornerAngles(openLPlan(), "armH");
    expect(angs).toHaveLength(1);
    expect(angs[0].displayDeg).toBe(90);
    expect(angs[0].sweepDeg).toBeLessThan(180.5);
  });

  it("10. closed-room interior angle", () => {
    const angs = buildSelectedWallCornerAngles(closedRoomPlan(), "top");
    // both endpoints are 90° room corners
    expect(angs.every((a) => a.displayDeg === 90)).toBe(true);
    expect(angs.every((a) => a.sweepDeg < 180.5)).toBe(true);
    expect(angs.length).toBe(2);
  });
});

describe("PHASE 2F2 — T / hubs", () => {
  it("11. perpendicular T = 90° + 90°", () => {
    for (const id of ["branch", "hostL", "hostR"]) {
      const d = degs(perpTPlan(), id);
      expect(d, id).toEqual([90, 90]);
    }
  });

  it("12. angled T complementary sectors sum to 180°", () => {
    const angs = buildSelectedWallCornerAngles(angledTPlan(), "branch");
    expect(angs).toHaveLength(2);
    const sum = angs.reduce((s, a) => s + a.displayDeg, 0);
    expect(sum).toBeCloseTo(180, 0);
    expect(angs.some((a) => a.displayDeg === 180)).toBe(false);
  });

  it("13. degree-3 non-T adjacent sectors sum to 360°", () => {
    const plan = hub3Plan();
    const secs = nodeAdjacentSectors(plan, "c");
    expect(secs).toHaveLength(3);
    expect(sectorSumDeg(secs)).toBeCloseTo(360, 5);
    const shown = buildSelectedWallCornerAngles(plan, "wA");
    expect(shown.length).toBeGreaterThanOrEqual(1);
    expect(shown.length).toBeLessThanOrEqual(2);
    expect(shown.every((a) => a.displayDeg === 120)).toBe(true);
  });

  it("14. degree-4 selected-wall sector selection", () => {
    const plan = hub4Plan();
    const shown = buildSelectedWallCornerAngles(plan, "e");
    expect(shown.length).toBeLessThanOrEqual(2);
    expect(shown.every((a) => a.displayDeg === 90)).toBe(true);
    // never annotate every hub sector for one selection
    expect(shown.length).toBeLessThan(4);
  });

  it("15. no duplicate sector", () => {
    const keys = sectorKeys(perpTPlan(), "branch");
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("16. no primary 180° host-host T label", () => {
    for (const id of ["branch", "hostL", "hostR"]) {
      const angs = buildSelectedWallCornerAngles(perpTPlan(), id);
      expect(angs.some((a) => Math.abs(a.sweepDeg - 180) < 0.6)).toBe(false);
      expect(angs.some((a) => a.displayDeg === 180)).toBe(false);
    }
  });
});

describe("PHASE 2F2 — live / presentation / precision", () => {
  it("17. live endpoint movement updates value", () => {
    const plan = openLPlan();
    const before = degs(plan, "armV")[0];
    expect(before).toBe(90);
    const moved = moveNode(plan, "e3", { x: OX + 6000 + 2000, y: OY + 4000 });
    // MODE B (selected idle) still reflects committed/preview geometry.
    const selected = buildLiveWallEditMeasurements({
      previewPlan: moved.plan || moved,
      wallId: "armV",
      editKind: "endpoint",
    });
    const after = (selected.cornerAngles || []).map((a) => a.displayDeg);
    expect(after[0]).not.toBe(90);
    expect(after[0]).toBeGreaterThan(90);
    // MODE A (rotate drag) must not attach selected cornerAngles — magnets own that.
    const rotating = buildLiveWallEditMeasurements({
      previewPlan: moved.plan || moved,
      wallId: "armV",
      editKind: "rotate",
    });
    expect(rotating.cornerAngles || []).toEqual([]);
  });

  it("18. whole-wall translation preserves value", () => {
    const plan = openLPlan();
    const before = sectorKeys(plan, "armH");
    const shifted = translatePlan(plan, 500, -300);
    expect(sectorKeys(shifted, "armH")).toEqual(before);
    expect(degs(shifted, "armH")).toEqual([90]);
  });

  it("19. display rounding and no -0.0°", () => {
    expect(formatCornerAngleDisplay(89.999999)).toBe("90.0°");
    expect(formatCornerAngleDisplay(90.04)).toBe("90.0°");
    expect(formatCornerAngleDisplay(90.06)).toBe("90.1°");
    expect(formatCornerAngleDisplay(-0.0001)).toBe("0.0°");
    expect(formatCornerAngleDisplay(359.999)).toBe("0.0°");
    expect(formatCornerAngleDisplay(0)).toBe("0.0°");
    expect(String(displayCornerAngleDeg(-0))).not.toMatch(/-/);
  });

  it("20. pointer invariance", () => {
    const plan = closedRoomPlan();
    const a = sectorKeys(plan, "top");
    const b = sectorKeys(plan, "top"); // recompute — no pointer state in API
    expect(b).toEqual(a);
    const m1 = buildLiveWallEditMeasurements({ previewPlan: plan, wallId: "top", editKind: "endpoint" });
    const m2 = buildLiveWallEditMeasurements({ previewPlan: plan, wallId: "top", editKind: "endpoint" });
    expect((m2.cornerAngles || []).map((x) => x.sectorKey))
      .toEqual((m1.cornerAngles || []).map((x) => x.sectorKey));
  });

  it("21. zoom semantic stability", () => {
    const plan = openLPlan();
    const angs = buildSelectedWallCornerAngles(plan, "armH");
    const keys = angs.map((a) => a.sectorKey);
    // PHASE 2F2.4 — angle LOD hides later than adaptiveGrid overview (0.12).
    for (const z of [0.05, 0.10, 0.4, 0.8, 1.4]) {
      const presented = presentSelectedCornerAngles(angs, { zoom: z });
      if (z < 0.068) {
        expect(presented).toHaveLength(0);
      } else {
        expect(presented.map((p) => p.sectorKey)).toEqual(keys);
      }
    }
  });

  it("22. arc collision does not change sector", () => {
    const plan = openLPlan();
    const [ang] = buildSelectedWallCornerAngles(plan, "armH");
    const base = presentCornerAngle(ang, { zoom: 0.4 });
    const bumped = presentCornerAngle(ang, {
      zoom: 0.4,
      occupancy: [{ point: ang.vertex, clearMm: 80 }],
      labelShiftDeg: 8,
    });
    expect(bumped.sectorKey).toBe(base.sectorKey);
    expect(bumped.sweepDeg).toBe(base.sweepDeg);
    expect(bumped.radius).toBeGreaterThanOrEqual(base.radius);
  });

  it("23. no camera-only writes — pure functions", () => {
    const plan = closedRoomPlan();
    const snap = JSON.stringify(plan);
    buildSelectedWallCornerAngles(plan, "top");
    presentSelectedCornerAngles(buildSelectedWallCornerAngles(plan, "top"), { zoom: 0.3 });
    cornerArcRadiusMm(1.2, 100);
    expect(JSON.stringify(plan)).toBe(snap);
  });

  it("24. accepted linear-dimension fingerprints unchanged", () => {
    const plan = closedRoomPlan();
    const sem = resolveSelectedDimensionSemantics({ plan, wallId: "top", room: plan.room });
    expect(sem.fingerprint).toBeTruthy();
    // Building corner angles must not alter linear selected-dimension semantics.
    buildSelectedWallCornerAngles(plan, "top");
    const again = resolveSelectedDimensionSemantics({ plan, wallId: "top", room: plan.room });
    expect(again.fingerprint).toBe(sem.fingerprint);
  });

  it("free endpoint hides angle", () => {
    expect(buildSelectedWallCornerAngles(freeEndpointPlan(), "free")).toEqual([]);
  });

  it("rays are polar-sorted independent of wall-array order", () => {
    const plan = hub3Plan();
    const a = collectIncidentRays(plan, "c").map((r) => r.wallId);
    const b = collectIncidentRays(reorderWalls(plan), "c").map((r) => r.wallId);
    expect(b).toEqual(a);
  });
});
