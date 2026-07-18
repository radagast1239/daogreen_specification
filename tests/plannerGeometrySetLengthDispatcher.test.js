/**
 * PHASE 1B-1A — wall.setLength geometry command (core only, no UI wiring).
 *
 * Изменяет длину существующей стены, сохраняя направление и закрепляя один
 * endpoint (fixedEndpoint: "a" | "b"). Мутация делегирована в тот же внутренний
 * pure helper (applyNodeMoveGeometry), что и node.move — shared-node cascade,
 * глобальный mounted-item refresh и room-sync-один-раз переиспользованы, а не
 * продублированы (см. RESULT — PHASE 1B-1A, "Internal cascade reuse").
 *
 * Import-order fragility: тот же класс, что и у остального command-layer test
 * suite (wallGeometry.js → core/walls/index.js re-export chain) — прогреваем
 * wallGeometry.js первым в beforeAll (см. tests/plannerGeometryCommands.test.js).
 */
import { describe, it, expect, vi, beforeAll } from "vitest";

let executeGeometryCommand;
let createGeometryCommandDispatcher;
let HistoryModel;
let validatePlanIntegrity;
let WALL_SET_LENGTH_WALL_NOT_FOUND;
let WALL_SET_LENGTH_INVALID_LENGTH;
let WALL_SET_LENGTH_INVALID_ANCHOR;
let WALL_SET_LENGTH_DEGENERATE_WALL;
let GEOMETRY_COMMAND_TYPES;

beforeAll(async () => {
  await import("../src/planner/wallGeometry.js");

  const cmdMod = await import("../src/planner/commands/geometryCommands.js");
  executeGeometryCommand = cmdMod.executeGeometryCommand;
  WALL_SET_LENGTH_WALL_NOT_FOUND = cmdMod.WALL_SET_LENGTH_WALL_NOT_FOUND;
  WALL_SET_LENGTH_INVALID_LENGTH = cmdMod.WALL_SET_LENGTH_INVALID_LENGTH;
  WALL_SET_LENGTH_INVALID_ANCHOR = cmdMod.WALL_SET_LENGTH_INVALID_ANCHOR;
  WALL_SET_LENGTH_DEGENERATE_WALL = cmdMod.WALL_SET_LENGTH_DEGENERATE_WALL;
  GEOMETRY_COMMAND_TYPES = cmdMod.GEOMETRY_COMMAND_TYPES;

  const dispatcherMod = await import("../src/planner/ui/geometryCommandDispatcher.js");
  createGeometryCommandDispatcher = dispatcherMod.createGeometryCommandDispatcher;

  const historyMod = await import("../src/planner/core/history/historyModel.js");
  HistoryModel = historyMod.HistoryModel;

  const validationMod = await import("../src/planner/core/validation/validatePlanIntegrity.js");
  validatePlanIntegrity = validationMod.validatePlanIntegrity;
});

// ── fixtures ─────────────────────────────────────────────────────────────

function ids(prefix = "id") {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

/** Single wall a->b, canonical nodes+wall.a/b model. */
function wallPlan(a, b) {
  return {
    room: { w: 8000, h: 6000 },
    nodes: { na: { x: a.x, y: a.y }, nb: { x: b.x, y: b.y } },
    walls: [{ id: "w1", a: "na", b: "nb", thk: 150 }],
    items: [],
    dimensions: [],
    rooms: [],
    zones: [],
  };
}

/** w1: n1(0,0)-n2(3000,0) [horizontal], w2: n2(3000,0)-n3(3000,3000) [vertical] — n2 shared. */
function sharedNodePlan() {
  return {
    room: { w: 8000, h: 6000 },
    nodes: { n1: { x: 0, y: 0 }, n2: { x: 3000, y: 0 }, n3: { x: 3000, y: 3000 } },
    walls: [
      { id: "w1", a: "n1", b: "n2", thk: 100 },
      { id: "w2", a: "n2", b: "n3", thk: 100 },
    ],
    items: [],
    dimensions: [],
    rooms: [],
    zones: [],
  };
}

function door(id, wallId, center, extra = {}) {
  const w = extra.w || 600;
  const h = extra.h || 100;
  return { id, kind: "door", x: center.x - w / 2, y: center.y - h / 2, w, h, wallId, ...extra };
}

/**
 * Локальный тонкий wrapper (тот же подход, что и в plannerGeometryCommands.test.js) —
 * проверяет только, что t0/t1 резолвятся против ЖИВОЙ геометрии стены, не
 * дублирует и не ре-тестирует сам алгоритм resolveAttachedDimension.
 */
function resolveDimensionForTest(dim, plan) {
  const wall = plan.walls.find((w) => w.id === (dim.attachedTo.wallId ?? dim.attachedTo.id));
  const a = plan.nodes[wall.a];
  const b = plan.nodes[wall.b];
  const t0 = Number.isFinite(dim.attachedTo.t0) ? dim.attachedTo.t0 : 0;
  const t1 = Number.isFinite(dim.attachedTo.t1) ? dim.attachedTo.t1 : 1;
  return {
    p1: { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 },
    p2: { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 },
  };
}

/** Real HistoryModel + real dispatcher — эквивалент usePlanHistory + createGeometryCommandDispatcher в PlanPage. */
function makeHarness(initialPlan, extra = {}) {
  const history = new HistoryModel(initialPlan);
  const commitPlan = extra.commitPlan || vi.fn((next) => history.setPlan(() => next));
  const setSelection = vi.fn();
  const setRuntimeDiagnostic = vi.fn();
  const showMessage = vi.fn();
  const roomSyncFn = extra.roomSyncFn
    || vi.fn((p) => ({ rooms: p.rooms || [], zones: p.zones || [], validationWarnings: [] }));
  const dispatcher = createGeometryCommandDispatcher({
    getPlan: () => history.current,
    commitPlan,
    setSelection,
    setRuntimeDiagnostic,
    showMessage,
    makeId: extra.makeId || ids(),
    roomSyncFn,
  });
  return { history, dispatcher, commitPlan, setSelection, setRuntimeDiagnostic, showMessage, roomSyncFn };
}

// ── validation / rejected ──────────────────────────────────────────────────

describe("PHASE 1B-1A — wall.setLength validation", () => {
  it("registers wall.setLength in the command table", () => {
    expect(GEOMETRY_COMMAND_TYPES).toContain("wall.setLength");
  });

  it("rejects a missing wallId", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 1000, y: 0 });
    const result = executeGeometryCommand(plan, { type: "wall.setLength", lengthMm: 500, fixedEndpoint: "a" }, {});
    expect(result).toMatchObject({ ok: false, changed: false, plan, error: { code: WALL_SET_LENGTH_WALL_NOT_FOUND } });
  });

  it("rejects an unknown wallId", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 1000, y: 0 });
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "ghost", lengthMm: 500, fixedEndpoint: "a" }, {});
    expect(result).toMatchObject({ ok: false, changed: false, plan, error: { code: WALL_SET_LENGTH_WALL_NOT_FOUND } });
  });

  it("rejects a wall missing canonical a/b node references (legacy pts-only shape)", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 1000, y: 0 });
    plan.walls = [{ id: "w1", pts: [{ x: 0, y: 0 }, { x: 1000, y: 0 }], thk: 150 }];
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: 500, fixedEndpoint: "a" }, {});
    expect(result.error.code).toBe(WALL_SET_LENGTH_WALL_NOT_FOUND);
  });

  it("rejects an invalid fixedEndpoint", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 1000, y: 0 });
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: 500, fixedEndpoint: "c" }, {});
    expect(result).toMatchObject({ ok: false, changed: false, plan, error: { code: WALL_SET_LENGTH_INVALID_ANCHOR } });
  });

  it("rejects a missing fixedEndpoint", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 1000, y: 0 });
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: 500 }, {});
    expect(result.error.code).toBe(WALL_SET_LENGTH_INVALID_ANCHOR);
  });

  it("rejects zero length", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 1000, y: 0 });
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: 0, fixedEndpoint: "a" }, {});
    expect(result.error.code).toBe(WALL_SET_LENGTH_INVALID_LENGTH);
  });

  it("rejects negative length", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 1000, y: 0 });
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: -100, fixedEndpoint: "a" }, {});
    expect(result.error.code).toBe(WALL_SET_LENGTH_INVALID_LENGTH);
  });

  it("rejects NaN length", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 1000, y: 0 });
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: NaN, fixedEndpoint: "a" }, {});
    expect(result.error.code).toBe(WALL_SET_LENGTH_INVALID_LENGTH);
  });

  it("rejects Infinity length", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 1000, y: 0 });
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: Infinity, fixedEndpoint: "a" }, {});
    expect(result.error.code).toBe(WALL_SET_LENGTH_INVALID_LENGTH);
  });

  it("rejects below the 50mm minimum (49.999mm)", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 1000, y: 0 });
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: 49.999, fixedEndpoint: "a" }, {});
    expect(result.error.code).toBe(WALL_SET_LENGTH_INVALID_LENGTH);
  });

  it("accepts exactly the 50mm minimum", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 1000, y: 0 });
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: 50, fixedEndpoint: "a" }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.plan.nodes.nb).toEqual({ x: 50, y: 0 });
  });

  it("rejects a degenerate zero-length wall (a and b at the same coordinate)", () => {
    const plan = wallPlan({ x: 500, y: 500 }, { x: 500, y: 500 });
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: 1000, fixedEndpoint: "a" }, {});
    expect(result).toMatchObject({ ok: false, changed: false, plan, error: { code: WALL_SET_LENGTH_DEGENERATE_WALL } });
  });

  it("rejected results carry an empty entityChanges and no makeId calls", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 1000, y: 0 });
    let calls = 0;
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: -5, fixedEndpoint: "a" }, { makeId: () => { calls += 1; return `id-${calls}`; } });
    const flat = [...Object.values(result.entityChanges.created), ...Object.values(result.entityChanges.changed), ...Object.values(result.entityChanges.deleted)].flat();
    expect(flat).toEqual([]);
    expect(calls).toBe(0);
  });
});

// ── no-op ────────────────────────────────────────────────────────────────

describe("PHASE 1B-1A — wall.setLength no-op", () => {
  it("requesting the exact current length is a no-op (original plan by reference)", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 3000, y: 4000 }); // length 5000
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: 5000, fixedEndpoint: "a" }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.plan).toBe(plan);
  });

  it("a length within floating-point geometry epsilon of the current length is a no-op", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 3000, y: 4000 + 1e-9 }); // hypot ~5000 + ~8e-10
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: 5000, fixedEndpoint: "b" }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.plan).toBe(plan);
  });
});

// ── geometry correctness ───────────────────────────────────────────────────

describe("PHASE 1B-1A — wall.setLength geometry correctness", () => {
  it("horizontal wall, fixed A: B moves, A unchanged", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: 5000, fixedEndpoint: "a" }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.nodes.na).toEqual({ x: 0, y: 0 });
    expect(result.plan.nodes.nb).toEqual({ x: 5000, y: 0 });
  });

  it("horizontal wall, fixed B: A moves, B unchanged", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: 5000, fixedEndpoint: "b" }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.nodes.nb).toEqual({ x: 4000, y: 0 });
    expect(result.plan.nodes.na).toEqual({ x: -1000, y: 0 });
  });

  it("vertical wall, fixed A: B moves, A unchanged", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 0, y: 3000 });
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: 5000, fixedEndpoint: "a" }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.nodes.na).toEqual({ x: 0, y: 0 });
    expect(result.plan.nodes.nb).toEqual({ x: 0, y: 5000 });
  });

  it("vertical wall, fixed B: A moves, B unchanged", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 0, y: 3000 });
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: 5000, fixedEndpoint: "b" }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.nodes.nb).toEqual({ x: 0, y: 3000 });
    expect(result.plan.nodes.na).toEqual({ x: 0, y: -2000 });
  });

  it("diagonal wall (3-4-5), fixed A: B moves along the same direction, A unchanged", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 3000, y: 4000 }); // length 5000
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: 10000, fixedEndpoint: "a" }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.nodes.na).toEqual({ x: 0, y: 0 });
    expect(result.plan.nodes.nb).toEqual({ x: 6000, y: 8000 });
  });

  it("diagonal wall (3-4-5), fixed B: A moves along the same direction, B unchanged", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 3000, y: 4000 });
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: 10000, fixedEndpoint: "b" }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.nodes.nb).toEqual({ x: 3000, y: 4000 });
    expect(result.plan.nodes.na).toEqual({ x: -3000, y: -4000 });
  });

  it("reversed wall orientation (a on the right, b on the left) still preserves the a->b direction", () => {
    const plan = wallPlan({ x: 4000, y: 0 }, { x: 0, y: 0 }); // a is to the RIGHT of b
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: 6000, fixedEndpoint: "a" }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.nodes.na).toEqual({ x: 4000, y: 0 });
    expect(result.plan.nodes.nb).toEqual({ x: -2000, y: 0 }); // continues further left, not flipped right
  });

  it("success preserves wall/node IDs (no created or deleted entities)", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: 5000, fixedEndpoint: "a" }, { makeId: ids() });
    expect(result.plan.walls.map((w) => w.id)).toEqual(["w1"]);
    expect(Object.keys(result.plan.nodes).sort()).toEqual(["na", "nb"]);
    const flatCreated = Object.values(result.entityChanges.created).flat();
    const flatDeleted = Object.values(result.entityChanges.deleted).flat();
    expect(flatCreated).toEqual([]);
    expect(flatDeleted).toEqual([]);
  });

  it("validatePlanIntegrity stays clean after a successful setLength", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: 5000, fixedEndpoint: "a" }, { makeId: ids() });
    const diagnostics = validatePlanIntegrity(result.plan).diagnostics.filter((d) => d.severity === "error");
    expect(diagnostics).toEqual([]);
  });
});

// ── shared-node topology ───────────────────────────────────────────────────

describe("PHASE 1B-1A — wall.setLength shared-node topology", () => {
  it("moving the shared endpoint from w1 (fixedEndpoint a) cascades to w2 (same node id, no duplicate)", () => {
    const plan = sharedNodePlan();
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: 5000, fixedEndpoint: "a" }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.plan.nodes.n1).toEqual({ x: 0, y: 0 });
    expect(result.plan.nodes.n2).toEqual({ x: 5000, y: 0 });
    expect(result.plan.nodes.n3).toEqual({ x: 3000, y: 3000 });

    const w2 = result.plan.walls.find((w) => w.id === "w2");
    expect(w2.a).toBe("n2"); // same node id — not detached, not duplicated
    expect(result.plan.nodes[w2.a]).toEqual({ x: 5000, y: 0 });

    expect(Object.keys(result.plan.nodes).sort()).toEqual(["n1", "n2", "n3"]); // no new node created
    expect(result.entityChanges.changed.walls.sort()).toEqual(["w1", "w2"]);
    expect(result.entityChanges.changed.nodes).toEqual(["n2"]);

    const diagnostics = validatePlanIntegrity(result.plan).diagnostics.filter((d) => d.severity === "error");
    expect(diagnostics).toEqual([]);
  });

  it("moving the shared endpoint from w2 (fixedEndpoint b) cascades to w1 (same node id, no duplicate)", () => {
    const plan = sharedNodePlan();
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w2", lengthMm: 5000, fixedEndpoint: "b" }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.nodes.n3).toEqual({ x: 3000, y: 3000 });
    expect(result.plan.nodes.n2).toEqual({ x: 3000, y: -2000 });
    expect(result.plan.nodes.n1).toEqual({ x: 0, y: 0 });

    const w1 = result.plan.walls.find((w) => w.id === "w1");
    expect(w1.b).toBe("n2");
    expect(result.plan.nodes[w1.b]).toEqual({ x: 3000, y: -2000 });

    expect(Object.keys(result.plan.nodes).sort()).toEqual(["n1", "n2", "n3"]);
    expect(result.entityChanges.changed.walls.sort()).toEqual(["w1", "w2"]);

    const diagnostics = validatePlanIntegrity(result.plan).diagnostics.filter((d) => d.severity === "error");
    expect(diagnostics).toEqual([]);
  });

  it("shared-node setLength refreshes mounted openings on both the target and neighboring wall", () => {
    // Modest extension (3000 -> 3200, +200mm) on purpose: a drastic shared-node
    // move would rotate w2 sharply enough to push d2 outside the 400mm
    // placeOnWall search radius (refreshWallMountedItems would then leave it
    // untouched, which is correct production behavior but not what this test
    // is checking) — see RESULT — PHASE 1B-1A for the calculation.
    const plan = sharedNodePlan();
    plan.items = [
      door("d1", "w1", { x: 1400, y: 0 }),
      door("d2", "w2", { x: 3000, y: 1200 }, { w: 100, h: 600 }),
    ];
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: 3200, fixedEndpoint: "a" }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.nodes.n2).toEqual({ x: 3200, y: 0 });
    const d1 = result.plan.items.find((it) => it.id === "d1");
    const d2 = result.plan.items.find((it) => it.id === "d2");
    expect(d1.wallId).toBe("w1");
    expect(d2.wallId).toBe("w2");
    // Both openings' wallSeg reflects the moved shared node (n2 -> (3200,0)),
    // matching the existing node.nudge shared-refresh policy (PHASE 1A-2A P2 §4).
    expect(d1.wallSeg.b).toEqual({ x: 3200, y: 0 });
    expect(d2.wallSeg.a).toEqual({ x: 3200, y: 0 });

    const diagnostics = validatePlanIntegrity(result.plan).diagnostics.filter((d) => d.entityType === "opening");
    expect(diagnostics).toEqual([]);
  });
});

// ── openings and dimensions ─────────────────────────────────────────────────

describe("PHASE 1B-1A — wall.setLength openings and dimensions", () => {
  it("an opening on the target wall stays attached with wallSeg reflecting the new endpoint", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    plan.items = [door("d1", "w1", { x: 2000, y: 0 })];
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: 6000, fixedEndpoint: "a" }, { makeId: ids() });
    expect(result.ok).toBe(true);
    const item = result.plan.items.find((it) => it.id === "d1");
    expect(item.wallId).toBe("w1");
    expect(item.wallSeg).toEqual({ a: { x: 0, y: 0 }, b: { x: 6000, y: 0 } });
    const diagnostics = validatePlanIntegrity(result.plan).diagnostics.filter((d) => d.entityType === "opening");
    expect(diagnostics).toEqual([]);
  });

  it("a wall-attached dimension resolves correctly against the new geometry (self-healing, no explicit remap)", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    plan.dimensions = [{ id: "dm1", attachedTo: { type: "wall", wallId: "w1", t0: 0.25, t1: 0.75 } }];
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: 6000, fixedEndpoint: "a" }, { makeId: ids() });
    expect(result.ok).toBe(true);
    // attachedTo/t0/t1/id unchanged — the dimension resolves live from wall geometry.
    expect(result.plan.dimensions[0]).toEqual(plan.dimensions[0]);
    const resolved = resolveDimensionForTest(result.plan.dimensions[0], result.plan);
    expect(resolved.p1).toEqual({ x: 1500, y: 0 });
    expect(resolved.p2).toEqual({ x: 4500, y: 0 });
    // Coordinate-only mutation policy (matches node.move/node.nudge/wall.moveSegment,
    // see refreshMountedItemsForCoordinateChange doc comment): wall-attached
    // dimensions are a read-time view, intentionally not eagerly diffed/listed.
    expect(result.entityChanges.changed.dimensions).toEqual([]);
  });

  it("a free (unattached) dimension is untouched by setLength", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const free = { id: "free1", p1: { x: 10, y: 10 }, p2: { x: 20, y: 20 }, attachedTo: null };
    plan.dimensions = [free];
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: 6000, fixedEndpoint: "a" }, { makeId: ids() });
    expect(result.plan.dimensions[0]).toEqual(free);
  });
});

// ── result contract ─────────────────────────────────────────────────────────

describe("PHASE 1B-1A — wall.setLength result contract", () => {
  it("entityChanges.changed.nodes/walls are populated, created/deleted are empty, flat arrays derive from typed contract", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: 5000, fixedEndpoint: "a" }, { makeId: ids() });
    expect(result.entityChanges.changed.nodes).toEqual(["nb"]);
    expect(result.entityChanges.changed.walls).toEqual(["w1"]);
    const flatCreated = Object.values(result.entityChanges.created).flat();
    const flatDeleted = Object.values(result.entityChanges.deleted).flat();
    expect(flatCreated).toEqual([]);
    expect(flatDeleted).toEqual([]);
    expect(result.changedEntityIds).toEqual(expect.arrayContaining(["nb", "w1"]));
  });

  it("no metadata is written into the plan itself", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: 5000, fixedEndpoint: "a" }, { makeId: ids() });
    expect(result.plan).not.toHaveProperty("entityChanges");
    expect(result.plan).not.toHaveProperty("entityRemap");
    expect(result.plan).not.toHaveProperty("operationResult");
  });
});

// ── room sync ────────────────────────────────────────────────────────────

describe("PHASE 1B-1A — wall.setLength room sync", () => {
  it("a successful setLength triggers the room-sync engine exactly once", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const roomSyncFn = vi.fn((p) => ({ rooms: [], zones: [], validationWarnings: [] }));
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: 5000, fixedEndpoint: "a" }, { makeId: ids(), roomSyncFn });
    expect(result.ok).toBe(true);
    expect(roomSyncFn).toHaveBeenCalledTimes(1);
  });

  it("a no-op setLength never triggers the room-sync engine", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const roomSyncFn = vi.fn((p) => ({ rooms: [], zones: [], validationWarnings: [] }));
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: 4000, fixedEndpoint: "a" }, { makeId: ids(), roomSyncFn });
    expect(result.changed).toBe(false);
    expect(roomSyncFn).not.toHaveBeenCalled();
  });

  it("a rejected setLength never triggers the room-sync engine", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const roomSyncFn = vi.fn((p) => ({ rooms: [], zones: [], validationWarnings: [] }));
    const result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: -1, fixedEndpoint: "a" }, { makeId: ids(), roomSyncFn });
    expect(result.ok).toBe(false);
    expect(roomSyncFn).not.toHaveBeenCalled();
  });

  it("a room-sync engine failure still commits the geometry and surfaces a diagnostic, without throwing", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const throwingRoomSyncFn = () => { throw new Error("controlled room-engine failure"); };
    let result;
    expect(() => {
      result = executeGeometryCommand(plan, { type: "wall.setLength", wallId: "w1", lengthMm: 5000, fixedEndpoint: "a" }, { makeId: ids(), roomSyncFn: throwingRoomSyncFn });
    }).not.toThrow();
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.plan.nodes.nb).toEqual({ x: 5000, y: 0 }); // geometry committed despite room-sync failure
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});

// ── dispatcher / history ─────────────────────────────────────────────────────

describe("PHASE 1B-1A — wall.setLength dispatcher/history", () => {
  it("a valid fixed-A setLength: 1 checkpoint, correct geometry, selection untouched, room sync once", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const { history, dispatcher, setSelection, roomSyncFn } = makeHarness(plan);
    const result = dispatcher({ type: "wall.setLength", wallId: "w1", lengthMm: 5000, fixedEndpoint: "a" });
    expect(result.ok).toBe(true);
    expect(history.past.length).toBe(1);
    expect(history.current.nodes.nb).toEqual({ x: 5000, y: 0 });
    expect(setSelection).not.toHaveBeenCalled();
    expect(roomSyncFn).toHaveBeenCalledTimes(1);
  });

  it("a valid fixed-B setLength: 1 checkpoint, correct geometry, selection untouched", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const { history, dispatcher, setSelection } = makeHarness(plan);
    const result = dispatcher({ type: "wall.setLength", wallId: "w1", lengthMm: 5000, fixedEndpoint: "b" });
    expect(result.ok).toBe(true);
    expect(history.past.length).toBe(1);
    expect(history.current.nodes.na).toEqual({ x: -1000, y: 0 });
    expect(setSelection).not.toHaveBeenCalled();
  });

  it("a valid diagonal setLength: 1 checkpoint, correct geometry, room sync once", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 3000, y: 4000 });
    const { history, dispatcher, roomSyncFn } = makeHarness(plan);
    const result = dispatcher({ type: "wall.setLength", wallId: "w1", lengthMm: 10000, fixedEndpoint: "a" });
    expect(result.ok).toBe(true);
    expect(history.past.length).toBe(1);
    expect(history.current.nodes.nb).toEqual({ x: 6000, y: 8000 });
    expect(roomSyncFn).toHaveBeenCalledTimes(1);
  });

  it("same-length request: 0 checkpoints, original plan reference retained, room sync never runs", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const { history, dispatcher, roomSyncFn } = makeHarness(plan);
    const result = dispatcher({ type: "wall.setLength", wallId: "w1", lengthMm: 4000, fixedEndpoint: "a" });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(false);
    expect(history.past.length).toBe(0);
    expect(history.current).toBe(plan);
    expect(roomSyncFn).not.toHaveBeenCalled();
  });

  it("invalid request: 0 checkpoints, original plan reference retained, room sync never runs", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const { history, dispatcher, roomSyncFn } = makeHarness(plan);
    const result = dispatcher({ type: "wall.setLength", wallId: "w1", lengthMm: 0, fixedEndpoint: "a" });
    expect(result.ok).toBe(false);
    expect(history.past.length).toBe(0);
    expect(history.current).toBe(plan);
    expect(roomSyncFn).not.toHaveBeenCalled();
  });

  it("shared-node setLength: 1 checkpoint, both connected walls updated, room sync once", () => {
    const plan = sharedNodePlan();
    const { history, dispatcher, roomSyncFn } = makeHarness(plan);
    const result = dispatcher({ type: "wall.setLength", wallId: "w1", lengthMm: 5000, fixedEndpoint: "a" });
    expect(result.ok).toBe(true);
    expect(history.past.length).toBe(1);
    expect(history.current.nodes.n2).toEqual({ x: 5000, y: 0 });
    const w2 = history.current.walls.find((w) => w.id === "w2");
    expect(history.current.nodes[w2.a]).toEqual({ x: 5000, y: 0 });
    expect(roomSyncFn).toHaveBeenCalledTimes(1);
  });

  it("room-sync failure: geometry still committed (1 checkpoint), diagnostic surfaced", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const throwingRoomSyncFn = vi.fn(() => { throw new Error("controlled room-engine failure"); });
    const { history, dispatcher, setRuntimeDiagnostic } = makeHarness(plan, { roomSyncFn: throwingRoomSyncFn });
    const result = dispatcher({ type: "wall.setLength", wallId: "w1", lengthMm: 5000, fixedEndpoint: "a" });
    expect(result.ok).toBe(true);
    expect(history.past.length).toBe(1);
    expect(history.current.nodes.nb).toEqual({ x: 5000, y: 0 });
    expect(setRuntimeDiagnostic).toHaveBeenCalled();
  });

  it("commit failure: 0 checkpoints, original plan retained, command executed exactly once", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const history = new HistoryModel(plan);
    const commitPlan = vi.fn(() => { throw new Error("commit failed"); });
    const { dispatcher } = makeHarness(plan, { commitPlan });
    const result = dispatcher({ type: "wall.setLength", wallId: "w1", lengthMm: 5000, fixedEndpoint: "a" });
    expect(result.ok).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.error.code).toBe("GEOMETRY_COMMAND_COMMIT_FAILED");
    // The command DID compute a valid result (spread into the failure) — commit,
    // not computation, is what failed.
    expect(result.plan.nodes.nb).toEqual({ x: 5000, y: 0 });
    expect(commitPlan).toHaveBeenCalledTimes(1);
    expect(history.past.length).toBe(0);
    expect(history.current).toBe(plan);
  });

  it("undo returns the exact original plan reference; redo restores the exact command result reference", () => {
    const plan = wallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const { history, dispatcher } = makeHarness(plan);
    const result = dispatcher({ type: "wall.setLength", wallId: "w1", lengthMm: 5000, fixedEndpoint: "a" });
    expect(result.ok).toBe(true);
    const committed = history.current;
    expect(committed).toBe(result.plan);

    const afterUndo = history.undo();
    expect(afterUndo).toBe(plan); // exact original reference

    const afterRedo = history.redo();
    expect(afterRedo).toBe(committed); // exact same command-result reference, same IDs
  });
});
