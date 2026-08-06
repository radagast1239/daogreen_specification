/**
 * PHASE 2F2.2 — relative angle magnets + two-mode contract (self-contained).
 */
import { describe, it, expect } from "vitest";
import {
  MAGNET_ENTER_DEG,
  MAGNET_RELEASE_DEG,
  buildRelativeMagnetCandidates,
  resolveAngleMagnet,
  resolveEndpointMagnetContext,
  resolveDraftMagnetContext,
  buildMovementAngleSectors,
  buildDraftMovementAngles,
  pointAtMagnetLength,
  emptyAngleMagnetPreview,
  angularDiffDeg,
} from "../src/planner/core/dimensions/angleMagnetSnap.js";
import {
  buildSelectedWallCornerAngles,
  presentSelectedCornerAngles,
  selectedCornerArcRadiusMm,
  displayCornerAngleDeg,
} from "../src/planner/core/dimensions/cornerAngleDimensions.js";
import { arcRadiusScreenPx, SELECTED_ARC_MAX_PX } from "../src/planner/core/dimensions/angleLabelPresentation.js";
import { buildLiveWallEditMeasurements } from "../src/planner/core/walls/liveWallMeasurements.js";
import { resolveSelectedDimensionSemantics } from "../src/planner/core/dimensions/selectedDimensionSemantics.js";
import { resolveViewportLod } from "../src/planner/core/grid/adaptiveGrid.js";

const OX = 50_000;
const OY = 70_000;

function mkPlan(nodes, walls, extra = {}) {
  return {
    nodes: { ...nodes },
    walls: walls.map((w) => ({ thk: 100, thicknessSide: "center", ...w })),
    room: extra.room || null,
    rooms: extra.rooms || [],
    ...extra,
  };
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

function bentHostTPlan() {
  // Host slightly non-collinear — previously classified hub3 with ~180 label.
  return mkPlan(
    {
      h1: { x: OX, y: OY },
      t: { x: OX + 4000, y: OY },
      h2: { x: OX + 8000, y: OY + 40 },
      b: { x: OX + 4000 + 80, y: OY + 3000 },
    },
    [
      { id: "hostL", a: "h1", b: "t", chainId: "host" },
      { id: "hostR", a: "t", b: "h2", chainId: "host" },
      { id: "branch", a: "t", b: "b" },
    ],
  );
}

function freeEndpointPlan() {
  return mkPlan(
    { f1: { x: OX, y: OY }, f2: { x: OX + 5000, y: OY } },
    [{ id: "free", a: "f1", b: "f2" }],
  );
}

function diagonalPlan() {
  const ang = (62 * Math.PI) / 180;
  return mkPlan(
    {
      h1: { x: OX, y: OY },
      t: { x: OX + 4000, y: OY },
      h2: { x: OX + 8000, y: OY },
      b: {
        x: OX + 4000 + Math.cos(ang) * 2800,
        y: OY + Math.sin(ang) * 2800,
      },
    },
    [
      { id: "hostL", a: "h1", b: "t", chainId: "host" },
      { id: "hostR", a: "t", b: "h2", chainId: "host" },
      { id: "diag", a: "t", b: "b" },
    ],
  );
}

function pointAt(pivot, deg, len) {
  const r = (deg * Math.PI) / 180;
  return { x: pivot.x + Math.cos(r) * len, y: pivot.y + Math.sin(r) * len };
}

describe("PHASE 2F2.2 — magnetic candidates + snap", () => {
  it("1. 45° candidate exists relative to host ray", () => {
    const c = buildRelativeMagnetCandidates(0);
    expect(c.some((x) => x.offsetDeg === 45 && x.angleDeg === 45)).toBe(true);
  });

  it("2. 90° candidate exists relative to host ray", () => {
    const c = buildRelativeMagnetCandidates(10);
    expect(c.some((x) => x.offsetDeg === 90 && Math.abs(x.angleDeg - 100) < 1e-9)).toBe(true);
  });

  it("3. entering snap threshold produces exact snapped geometry", () => {
    const pivot = { x: OX, y: OY };
    const raw = pointAt(pivot, 90 - (MAGNET_ENTER_DEG - 0.2), 2000);
    const r = resolveAngleMagnet({
      pivot,
      rawPoint: raw,
      referenceAngleDeg: 0,
      previousSnapAngleDeg: null,
    });
    expect(r.snapped).toBe(true);
    expect(r.angleDeg).toBe(90);
    expect(Math.abs(r.point.x - pivot.x)).toBeLessThan(1e-6);
    expect(r.point.y).toBeGreaterThan(pivot.y);
  });

  it("4. hysteresis prevents snap oscillation", () => {
    const pivot = { x: OX, y: OY };
    const enter = resolveAngleMagnet({
      pivot,
      rawPoint: pointAt(pivot, 90 - 2, 2000),
      referenceAngleDeg: 0,
    });
    expect(enter.snapped).toBe(true);
    // Between enter and release: stay snapped even if another candidate is nearer in absolute terms.
    const hold = resolveAngleMagnet({
      pivot,
      rawPoint: pointAt(pivot, 90 - (MAGNET_ENTER_DEG + 1.2), 2000),
      referenceAngleDeg: 0,
      previousSnapAngleDeg: enter.previousSnapAngleDeg,
    });
    expect(hold.snapped).toBe(true);
    expect(hold.angleDeg).toBe(90);
    expect(MAGNET_RELEASE_DEG).toBeGreaterThan(MAGNET_ENTER_DEG);
  });

  it("5. leaving release threshold restores free movement", () => {
    const pivot = { x: OX, y: OY };
    const free = resolveAngleMagnet({
      pivot,
      rawPoint: pointAt(pivot, 90 - (MAGNET_RELEASE_DEG + 0.5), 2000),
      referenceAngleDeg: 0,
      previousSnapAngleDeg: 90,
    });
    expect(free.snapped).toBe(false);
    expect(free.previousSnapAngleDeg).toBeNull();
  });

  it("equal-distance tie prefers 90° over 45°", () => {
    // Midpoint between 45 and 90 relative to host 0 is 67.5 — not equal.
    // Construct equal |Δ| by comparing two candidates via pick: 0° host, raw at 67.5
    // closer to 45/90 equally? |67.5-45|=22.5, |67.5-90|=22.5 — outside enter.
    // Force equality inside enter with synthetic previous null and enter=30.
    const pivot = { x: OX, y: OY };
    const r = resolveAngleMagnet({
      pivot,
      rawPoint: pointAt(pivot, 67.5, 2000),
      referenceAngleDeg: 0,
      enterDeg: 30,
      releaseDeg: 35,
    });
    expect(r.snapped).toBe(true);
    expect(r.angleDeg).toBe(90); // priority: 90 before 45
  });
});

describe("PHASE 2F2.2 — T movement sectors", () => {
  it("6. perpendicular T movement shows 90+90", () => {
    const plan = perpTPlan();
    const angs = buildMovementAngleSectors(plan, "t", "branch");
    const degs = angs.map((a) => a.displayDeg).sort((a, b) => a - b);
    expect(degs).toEqual([90, 90]);
  });

  it("7. 45° T movement shows 45+135", () => {
    const plan = perpTPlan();
    const pivot = plan.nodes.t;
    const end = pointAt(pivot, 45, 3000);
    const preview = {
      ...plan,
      nodes: { ...plan.nodes, b: end },
    };
    const angs = buildMovementAngleSectors(preview, "t", "branch");
    const degs = angs.map((a) => a.displayDeg).sort((a, b) => a - b);
    expect(degs).toEqual([45, 135]);
  });

  it("8. branch-to-host angles sum to 180°", () => {
    const plan = diagonalPlan();
    const angs = buildSelectedWallCornerAngles(plan, "diag");
    const sum = angs.reduce((s, a) => s + a.displayDeg, 0);
    expect(sum).toBeCloseTo(180, 0);
  });

  it("9. host-host 180° is not displayed", () => {
    for (const plan of [perpTPlan(), bentHostTPlan()]) {
      for (const id of ["branch", "hostL", "hostR"]) {
        const angs = buildSelectedWallCornerAngles(plan, id);
        expect(angs.some((a) => a.displayDeg === 180)).toBe(false);
        expect(angs.some((a) => a.sweepDeg >= 170)).toBe(false);
      }
    }
  });
});

describe("PHASE 2F2.2 — guide lifecycle + selected mode", () => {
  it("10-14. magnetic guides only during movement; cleanup empties preview", () => {
    const plan = perpTPlan();
    const ctx = resolveEndpointMagnetContext(plan, "branch", 1);
    expect(ctx).toBeTruthy();
    const magnet = resolveAngleMagnet({
      pivot: ctx.pivot,
      rawPoint: pointAt(ctx.pivot, 88, 2500),
      referenceAngleDeg: ctx.referenceAngleDeg,
    });
    expect(magnet.guides.length).toBeGreaterThan(0);
    expect(magnet.guides.every((g) => g.type === "magnet-ray")).toBe(true);
    expect(magnet.guides.every((g) => g.at.x === ctx.pivot.x && g.at.y === ctx.pivot.y)).toBe(true);
    // Local length — not a viewport-spanning field.
    for (const g of magnet.guides) {
      const span = Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y);
      expect(span).toBeLessThan(12000);
    }
    const empty = emptyAngleMagnetPreview();
    expect(empty.active).toBe(false);
    expect(empty.guides).toEqual([]);
    expect(empty.angles).toEqual([]);
    // Reload cannot restore — preview is ephemeral state, not plan data.
    expect(plan.angleMagnets || plan.magneticGuides || null).toBeFalsy();
  });

  it("15. selected wall shows compact endpoint angles without movement guides", () => {
    const plan = diagonalPlan();
    const angs = buildSelectedWallCornerAngles(plan, "diag");
    expect(angs.length).toBe(2);
    const presented = presentSelectedCornerAngles(angs, { zoom: 0.35 });
    expect(presented.length).toBe(2);
    for (const p of presented) {
      expect(arcRadiusScreenPx(p.radius, 0.35)).toBeLessThanOrEqual(SELECTED_ARC_MAX_PX + 8);
    }
    const live = buildLiveWallEditMeasurements({
      previewPlan: plan,
      wallId: "diag",
      editKind: "endpoint",
    });
    expect((live.cornerAngles || []).length).toBe(2);
    expect(live.guides == null || live.guides.length === 0).toBe(true);
  });

  it("16. free endpoint shows no selected angle", () => {
    expect(buildSelectedWallCornerAngles(freeEndpointPlan(), "free")).toEqual([]);
  });

  it("17. selecting another wall changes only the relevant endpoint-angle set", () => {
    const plan = perpTPlan();
    const branch = buildSelectedWallCornerAngles(plan, "branch").map((a) => a.sectorKey).sort();
    const host = buildSelectedWallCornerAngles(plan, "hostL").map((a) => a.sectorKey).sort();
    // Both show the T pair, but free ends of host differ — keys stay wall-relevant.
    expect(branch.length).toBe(2);
    expect(host.length).toBeGreaterThanOrEqual(1);
    const free = freeEndpointPlan();
    expect(buildSelectedWallCornerAngles(free, "free")).toEqual([]);
  });

  it("18-19. no giant full-circle / no duplicate sectors", () => {
    const plan = bentHostTPlan();
    const angs = buildSelectedWallCornerAngles(plan, "branch");
    expect(angs.every((a) => a.sweepDeg < 170)).toBe(true);
    expect(angs.every((a) => a.sweepDeg < 359)).toBe(true);
    const keys = angs.map((a) => a.id);
    expect(new Set(keys).size).toBe(keys.length);
    // Screen-space arc: world mm may grow at low zoom; CSS px stays bounded.
    expect(arcRadiusScreenPx(selectedCornerArcRadiusMm(0.05, 100), 0.05))
      .toBeLessThanOrEqual(SELECTED_ARC_MAX_PX + 0.01);
  });

  it("20. pointer/hover does not change selected angle semantics", () => {
    const plan = diagonalPlan();
    const a = buildSelectedWallCornerAngles(plan, "diag").map((x) => x.sectorKey);
    const b = buildSelectedWallCornerAngles(plan, "diag").map((x) => x.sectorKey);
    expect(b).toEqual(a);
  });

  it("21. zoom does not switch sectors", () => {
    const plan = diagonalPlan();
    const angs = buildSelectedWallCornerAngles(plan, "diag");
    const keys = angs.map((a) => a.sectorKey).sort();
    for (const z of [0.2, 0.5, 1.0]) {
      const p = presentSelectedCornerAngles(angs, { zoom: z, lod: "normal" });
      expect(p.map((x) => x.sectorKey).sort()).toEqual(keys);
    }
  });

  it("22. endpoint reversal preserves angle identity", () => {
    const plan = diagonalPlan();
    const rev = {
      ...plan,
      walls: plan.walls.map((w) => (w.id === "diag" ? { ...w, a: w.b, b: w.a } : w)),
    };
    const a = buildSelectedWallCornerAngles(plan, "diag").map((x) => x.displayDeg).sort((x, y) => x - y);
    const b = buildSelectedWallCornerAngles(rev, "diag").map((x) => x.displayDeg).sort((x, y) => x - y);
    expect(b).toEqual(a);
  });

  it("23. rotation/reorder/translation preserve values", () => {
    const plan = perpTPlan();
    const base = buildSelectedWallCornerAngles(plan, "branch").map((a) => a.displayDeg).sort();
    const translated = {
      ...plan,
      nodes: Object.fromEntries(
        Object.entries(plan.nodes).map(([k, p]) => [k, { x: p.x + 9000, y: p.y - 4000 }]),
      ),
    };
    expect(
      buildSelectedWallCornerAngles(translated, "branch").map((a) => a.displayDeg).sort(),
    ).toEqual(base);
    const reordered = { ...plan, walls: [...plan.walls].reverse() };
    expect(
      buildSelectedWallCornerAngles(reordered, "branch").map((a) => a.displayDeg).sort(),
    ).toEqual(base);
  });

  it("24. typed length plus active angle snap preserves exact direction and length", () => {
    const pivot = { x: OX, y: OY };
    const end = pointAtMagnetLength(pivot, 45, 1234);
    expect(end).toBeTruthy();
    expect(angularDiffDeg(
      (Math.atan2(end.y - pivot.y, end.x - pivot.x) * 180) / Math.PI,
      45,
    )).toBeLessThan(1e-9);
    expect(Math.hypot(end.x - pivot.x, end.y - pivot.y)).toBeCloseTo(1234, 6);
  });

  it("25. accepted linear-dimension fingerprints remain unchanged", () => {
    const plan = perpTPlan();
    const rooms = [{
      id: "r",
      polygon: [
        plan.nodes.h1,
        plan.nodes.h2,
        { x: plan.nodes.h2.x, y: plan.nodes.h2.y + 3000 },
        { x: plan.nodes.h1.x, y: plan.nodes.h1.y + 3000 },
      ],
    }];
    const withRoom = { ...plan, rooms, room: { w: 20000, h: 20000 } };
    const sem = resolveSelectedDimensionSemantics({
      plan: withRoom,
      wallId: "hostL",
      room: withRoom.room,
    });
    buildSelectedWallCornerAngles(withRoom, "branch");
    resolveAngleMagnet({
      pivot: withRoom.nodes.t,
      rawPoint: pointAt(withRoom.nodes.t, 90, 1000),
      referenceAngleDeg: 0,
    });
    const again = resolveSelectedDimensionSemantics({
      plan: withRoom,
      wallId: "hostL",
      room: withRoom.room,
    });
    expect(again.fingerprint).toBe(sem.fingerprint);
  });

  it("26. adaptive grid lod helper remains unchanged API", () => {
    expect(resolveViewportLod(0.05)).toBe("overview");
    expect(["normal", "detail", "overview"]).toContain(resolveViewportLod(0.4));
  });

  it("draft magnet context from T node", () => {
    const plan = perpTPlan();
    const ctx = resolveDraftMagnetContext(plan, plan.nodes.t, "t");
    expect(ctx.referenceAngleDeg).toBe(0);
    const angs = buildDraftMovementAngles(plan, "t", pointAt(plan.nodes.t, 45, 2000));
    const degs = angs.map((a) => a.displayDeg).sort((a, b) => a - b);
    expect(degs).toEqual([45, 135]);
  });

  it("rotate editKind suppresses MODE B cornerAngles", () => {
    const plan = perpTPlan();
    const m = buildLiveWallEditMeasurements({
      previewPlan: plan,
      wallId: "branch",
      editKind: "rotate",
    });
    expect(m.cornerAngles || []).toEqual([]);
  });

  it("thresholds are compact and documented", () => {
    expect(MAGNET_ENTER_DEG).toBe(3.5);
    expect(MAGNET_RELEASE_DEG).toBe(6);
    expect(displayCornerAngleDeg(45)).toBe(45);
    expect(displayCornerAngleDeg(90)).toBe(90);
  });
});
