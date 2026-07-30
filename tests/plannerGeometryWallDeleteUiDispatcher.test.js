/**
 * PHASE 1A-2C2B — routing the single-wall UI delete path through the
 * existing wall.delete command (applyWallDelete), exercised against the
 * real geometry command dispatcher (real HistoryModel, real
 * createGeometryCommandDispatcher, real executeGeometryCommand, real
 * wall.delete) — no mocks of the command layer itself.
 *
 * PlanPage.jsx's deleteHits wall branch is not rendered here (no React
 * Testing Library harness exists elsewhere in this suite) — a local
 * `makeDeleteHitsWallHarness` reproduces its exact selection-clearing policy
 * (clear on success/noop/no-target, preserve on geometry-rejected/
 * commit-failed) using the real applyWallDelete + real dispatcher, mirroring
 * the established pattern from plannerWallLengthEditDispatcher.test.js.
 *
 * Import-order fragility: same class as the rest of the command-layer test
 * suite — wallGeometry.js warmed up first in beforeAll.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";

let executeGeometryCommand;
let createGeometryCommandDispatcher;
let HistoryModel;
let validatePlanIntegrity;
let applyWallDelete;

beforeAll(async () => {
  await import("../src/planner/wallGeometry.js");

  const cmdMod = await import("../src/planner/commands/geometryCommands.js");
  executeGeometryCommand = cmdMod.executeGeometryCommand;

  const dispatcherMod = await import("../src/planner/ui/geometryCommandDispatcher.js");
  createGeometryCommandDispatcher = dispatcherMod.createGeometryCommandDispatcher;

  const historyMod = await import("../src/planner/core/history/historyModel.js");
  HistoryModel = historyMod.HistoryModel;

  const validationMod = await import("../src/planner/core/validation/validatePlanIntegrity.js");
  validatePlanIntegrity = validationMod.validatePlanIntegrity;

  const applyMod = await import("../src/planner/ui/applyWallDelete.js");
  applyWallDelete = applyMod.applyWallDelete;
});

// ── fixtures ─────────────────────────────────────────────────────────────

function ids(prefix = "id") {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

/** Isolated wall, no neighbors — both endpoints become orphans on delete. */
function singleWallPlan(a = { x: 0, y: 0 }, b = { x: 4000, y: 0 }) {
  return {
    room: { w: 6000, h: 4000 },
    nodes: { na: { ...a }, nb: { ...b } },
    walls: [{ id: "w1", a: "na", b: "nb", thk: 150 }],
    items: [],
    dimensions: [],
    rooms: [],
    zones: [],
  };
}

/** Closed rectangle: n1(0,0)-n2(4000,0)-n3(4000,3000)-n4(0,3000). w1's endpoints are shared with w4/w2. */
function rectPlan() {
  return {
    room: { w: 4000, h: 3000, wallThk: 100, defaultRoomHeightMm: 3000, height: 3000 },
    nodes: {
      n1: { x: 0, y: 0 },
      n2: { x: 4000, y: 0 },
      n3: { x: 4000, y: 3000 },
      n4: { x: 0, y: 3000 },
    },
    walls: [
      { id: "w1", a: "n1", b: "n2", thk: 100 },
      { id: "w2", a: "n2", b: "n3", thk: 100 },
      { id: "w3", a: "n3", b: "n4", thk: 100 },
      { id: "w4", a: "n4", b: "n1", thk: 100 },
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

/**
 * Reproduces PlanPage.jsx's deleteHits wall branch exactly (PHASE 1A-2C2B):
 * clear selection on success/noop/no-target, preserve it on
 * geometry-rejected/commit-failed — no false-success cleanup.
 */
function makeDeleteHitsWallHarness(dispatcher) {
  let selection = null;
  return {
    setSelection(sel) { selection = sel; },
    get selection() { return selection; },
    deleteWall(wallId) {
      const outcome = applyWallDelete({ wallId, runGeometryCommand: dispatcher });
      if (outcome.status === "success" || outcome.status === "noop" || outcome.status === "no-target") {
        selection = null;
      }
      return outcome;
    },
  };
}

// ── applyWallDelete orchestration ───────────────────────────────────────────

describe("PHASE 1A-2C2B — applyWallDelete orchestration", () => {
  it("missing wallId never calls the dispatcher", () => {
    const spy = vi.fn();
    const result = applyWallDelete({ wallId: null, runGeometryCommand: spy });
    expect(result.status).toBe("no-target");
    expect(spy).not.toHaveBeenCalled();
  });

  it("a valid wallId dispatches exactly one wall.delete command", () => {
    const plan = rectPlan();
    const { dispatcher, history } = makeHarness(plan);
    const spy = vi.fn(dispatcher);
    const result = applyWallDelete({ wallId: "w1", runGeometryCommand: spy });
    expect(result.status).toBe("success");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ type: "wall.delete", wallId: "w1" });
    expect(history.past.length).toBe(1);
  });

  it("a wallId not present in the plan classifies as no-target", () => {
    const plan = rectPlan();
    const { dispatcher, history } = makeHarness(plan);
    const result = applyWallDelete({ wallId: "does-not-exist", runGeometryCommand: dispatcher });
    expect(result.status).toBe("no-target");
    expect(result.result.ok).toBe(false);
    expect(history.past.length).toBe(0);
  });

  it("a commit failure classifies distinctly as commit-failed", () => {
    const plan = rectPlan();
    const commitPlan = vi.fn(() => { throw new Error("commit failed"); });
    const { dispatcher } = makeHarness(plan, { commitPlan });
    const result = applyWallDelete({ wallId: "w1", runGeometryCommand: dispatcher });
    expect(result.status).toBe("commit-failed");
    expect(commitPlan).toHaveBeenCalledTimes(1);
  });

  it("a room-sync diagnostic failure still reports success (geometry committed)", () => {
    const plan = rectPlan();
    const throwingRoomSyncFn = vi.fn(() => { throw new Error("controlled room-engine failure"); });
    const { dispatcher, history, setRuntimeDiagnostic } = makeHarness(plan, { roomSyncFn: throwingRoomSyncFn });
    const result = applyWallDelete({ wallId: "w1", runGeometryCommand: dispatcher });
    expect(result.status).toBe("success");
    expect(history.past.length).toBe(1);
    expect(setRuntimeDiagnostic).toHaveBeenCalled();
  });

  it("[classification-only, defensive] a non-no-target rejection classifies as geometry-rejected", () => {
    // wall.delete itself has no other realistic rejection path beyond
    // no-target — this proves the classifier's fallback branch works,
    // using a stub dispatcher rather than claiming this is reachable in
    // production for this specific command.
    const stubDispatcher = () => ({ ok: false, changed: false, error: { code: "GEOMETRY_COMMAND_INVALID", message: "stub" } });
    const result = applyWallDelete({ wallId: "w1", runGeometryCommand: stubDispatcher });
    expect(result.status).toBe("geometry-rejected");
  });

  it("a dispatcher returning null (unexpected internal exception) classifies as geometry-rejected", () => {
    const result = applyWallDelete({ wallId: "w1", runGeometryCommand: () => null });
    expect(result.status).toBe("geometry-rejected");
    expect(result.result).toBeNull();
  });
});

// ── referential integrity ───────────────────────────────────────────────────

describe("PHASE 1A-2C2B — referential integrity via the real command", () => {
  it("a wall with no dependencies (no mounted items/dimensions, no orphan nodes) deletes cleanly", () => {
    const plan = rectPlan(); // w1's endpoints n1/n2 are shared with w4/w2 — no orphans
    const { dispatcher, history } = makeHarness(plan);
    const result = applyWallDelete({ wallId: "w1", runGeometryCommand: dispatcher });
    expect(result.status).toBe("success");
    expect(history.current.walls.find((w) => w.id === "w1")).toBeUndefined();
    const diagnostics = validatePlanIntegrity(history.current).diagnostics.filter((d) => d.severity === "error");
    expect(diagnostics).toEqual([]);
  });

  it("orphan nodes are pruned when the wall has no neighbors", () => {
    const plan = singleWallPlan();
    const { dispatcher, history } = makeHarness(plan);
    const result = applyWallDelete({ wallId: "w1", runGeometryCommand: dispatcher });
    expect(result.status).toBe("success");
    expect(Object.keys(history.current.nodes)).toEqual([]);
    const diagnostics = validatePlanIntegrity(history.current).diagnostics.filter((d) => d.severity === "error");
    expect(diagnostics).toEqual([]);
  });

  it("a node shared with another wall is preserved, not orphaned", () => {
    const plan = rectPlan();
    const { dispatcher, history } = makeHarness(plan);
    const result = applyWallDelete({ wallId: "w1", runGeometryCommand: dispatcher });
    expect(result.status).toBe("success");
    // n1 (shared with w4) and n2 (shared with w2) both survive.
    expect(Object.keys(history.current.nodes).sort()).toEqual(["n1", "n2", "n3", "n4"]);
    expect(history.current.walls.find((w) => w.id === "w4").b).toBe("n1");
    expect(history.current.walls.find((w) => w.id === "w2").a).toBe("n2");
    const diagnostics = validatePlanIntegrity(history.current).diagnostics.filter((d) => d.severity === "error");
    expect(diagnostics).toEqual([]);
  });

  it("an opening near a surviving wall is re-placed onto it (not left dangling): wallId/wallSeg/x/y/angle all consistent", () => {
    const plan = rectPlan();
    plan.items = [door("d1", "w1", { x: 100, y: 0 })]; // near corner n1, close to w4 (x=0 axis)
    const { dispatcher, history } = makeHarness(plan);
    const result = applyWallDelete({ wallId: "w1", runGeometryCommand: dispatcher });
    expect(result.status).toBe("success");
    const item = history.current.items.find((it) => it.id === "d1");
    expect(item).toBeTruthy();
    expect(item.wallId).not.toBe("w1");
    const survivingWall = history.current.walls.find((w) => w.id === item.wallId);
    expect(survivingWall).toBeTruthy(); // points at a real, surviving wall
    expect(item.wallSeg).toBeTruthy();
    expect(Number.isFinite(item.x)).toBe(true);
    expect(Number.isFinite(item.y)).toBe(true);
    expect(Number.isFinite(item.angle)).toBe(true);
    // wallSeg matches the surviving wall's actual current endpoints.
    const nodeA = history.current.nodes[survivingWall.a];
    const nodeB = history.current.nodes[survivingWall.b];
    expect([item.wallSeg.a, item.wallSeg.b]).toEqual(expect.arrayContaining([nodeA, nodeB]));
    const diagnostics = validatePlanIntegrity(history.current).diagnostics.filter((d) => d.entityType === "opening");
    expect(diagnostics).toEqual([]);
  });

  it("an opening with no nearby wall is deleted, not left with a dangling wallId", () => {
    const plan = singleWallPlan();
    plan.items = [door("d1", "w1", { x: 3000, y: 0 })];
    const { dispatcher, history } = makeHarness(plan);
    const result = applyWallDelete({ wallId: "w1", runGeometryCommand: dispatcher });
    expect(result.status).toBe("success");
    expect(history.current.items.find((it) => it.id === "d1")).toBeUndefined();
    const diagnostics = validatePlanIntegrity(history.current).diagnostics.filter((d) => d.entityType === "opening");
    expect(diagnostics).toEqual([]);
  });

  it("a partial manual wall-attached dimension is detached with live p1/p2 and a warning", () => {
    const plan = rectPlan();
    plan.dimensions = [{ id: "dm1", p1: { x: 1, y: 1 }, p2: { x: 2, y: 2 }, attachedTo: { type: "wall", wallId: "w1", t0: 0.1, t1: 0.4 } }];
    const { dispatcher, history } = makeHarness(plan);
    const result = applyWallDelete({ wallId: "w1", runGeometryCommand: dispatcher });
    expect(result.status).toBe("success");
    const dim = history.current.dimensions.find((d) => d.id === "dm1");
    expect(dim.attachedTo).toBeNull();
    expect(dim.p1).toEqual({ x: 400, y: 0 }); // t0=0.1 along (0,0)-(4000,0)
    expect(dim.p2).toEqual({ x: 1600, y: 0 }); // t1=0.4
    expect(result.result.warnings.some((w) => w.entityId === "dm1")).toBe(true);
    const diagnostics = validatePlanIntegrity(history.current).diagnostics.filter((d) => d.severity === "error");
    expect(diagnostics).toEqual([]);
  });

  it("a manual wall-attached dimension with reversed t0/t1 (t0 > t1) still detaches with the correct live p1/p2", () => {
    const plan = rectPlan();
    plan.dimensions = [{ id: "dm2", p1: { x: 1, y: 1 }, p2: { x: 2, y: 2 }, attachedTo: { type: "wall", wallId: "w1", t0: 0.4, t1: 0.1 } }];
    const { dispatcher, history } = makeHarness(plan);
    const result = applyWallDelete({ wallId: "w1", runGeometryCommand: dispatcher });
    expect(result.status).toBe("success");
    const dim = history.current.dimensions.find((d) => d.id === "dm2");
    expect(dim.attachedTo).toBeNull();
    expect(dim.p1).toEqual({ x: 1600, y: 0 }); // t0=0.4
    expect(dim.p2).toEqual({ x: 400, y: 0 }); // t1=0.1
    const diagnostics = validatePlanIntegrity(history.current).diagnostics.filter((d) => d.severity === "error");
    expect(diagnostics).toEqual([]);
  });

  it("PHASE 1A-2C2B corrective F-01: a persisted auto dimension attached to the deleted wall is removed, not detached or left dangling", () => {
    // resolvePlanDimensions (core/dimensions/runtime.js) always filters out
    // persisted auto entries and regenerates the auto set fresh from live
    // geometry — a persisted auto:true row is never read as authoritative.
    // Leaving it in place after its wall is deleted produced a real dangling
    // attachedTo.wallId, caught by validatePlanIntegrity as
    // DIMENSION_WALL_NOT_FOUND (severity:error) — the prior "left untouched"
    // expectation here was the bug, not an intentional policy.
    const plan = rectPlan();
    plan.dimensions = [{ id: "auto1", auto: true, attachedTo: { type: "wall", wallId: "w1", t0: 0, t1: 1 } }];
    const { dispatcher, history } = makeHarness(plan);
    const result = applyWallDelete({ wallId: "w1", runGeometryCommand: dispatcher });
    expect(result.status).toBe("success");
    expect(history.current.dimensions.find((d) => d.id === "auto1")).toBeUndefined();
    expect(result.result.entityChanges.deleted.dimensions).toEqual(["auto1"]);
    expect(result.result.entityChanges.changed.dimensions).toEqual([]);
    // Removing a derived/auto entry is not a "manual detach" — no warning.
    expect(result.result.warnings).toEqual([]);
    const diagnostics = validatePlanIntegrity(history.current).diagnostics.filter((d) => d.severity === "error");
    expect(diagnostics).toEqual([]);
  });

  it("PHASE 1A-2C2B corrective: manual + auto dimensions on the same deleted wall are handled independently (manual detached, auto deleted)", () => {
    const plan = rectPlan();
    plan.dimensions = [
      { id: "manual1", p1: { x: 1, y: 1 }, p2: { x: 2, y: 2 }, attachedTo: { type: "wall", wallId: "w1", t0: 0.1, t1: 0.4 } },
      { id: "auto1", auto: true, attachedTo: { type: "wall", wallId: "w1", t0: 0, t1: 1 } },
    ];
    const { dispatcher, history } = makeHarness(plan);
    const result = applyWallDelete({ wallId: "w1", runGeometryCommand: dispatcher });
    expect(result.status).toBe("success");
    const manual = history.current.dimensions.find((d) => d.id === "manual1");
    expect(manual.attachedTo).toBeNull();
    expect(manual.p1).toEqual({ x: 400, y: 0 });
    expect(history.current.dimensions.find((d) => d.id === "auto1")).toBeUndefined();
    expect(result.result.entityChanges.changed.dimensions).toEqual(["manual1"]);
    expect(result.result.entityChanges.deleted.dimensions).toEqual(["auto1"]);
    const diagnostics = validatePlanIntegrity(history.current).diagnostics.filter((d) => d.severity === "error");
    expect(diagnostics).toEqual([]);
  });

  it("an auto dimension attached to a DIFFERENT (surviving) wall is left completely untouched", () => {
    const plan = rectPlan();
    plan.dimensions = [{ id: "auto2", auto: true, attachedTo: { type: "wall", wallId: "w2", t0: 0, t1: 1 } }];
    const { dispatcher, history } = makeHarness(plan);
    const result = applyWallDelete({ wallId: "w1", runGeometryCommand: dispatcher });
    expect(result.status).toBe("success");
    const dim = history.current.dimensions.find((d) => d.id === "auto2");
    expect(dim.attachedTo).toEqual({ type: "wall", wallId: "w2", t0: 0, t1: 1 });
    expect(result.result.entityChanges.deleted.dimensions).toEqual([]);
  });

  it("a malformed auto attachment (missing t0/t1) attached to the deleted wall is still removed, not left dangling", () => {
    const plan = rectPlan();
    plan.dimensions = [{ id: "auto3", auto: true, attachedTo: { type: "wall", wallId: "w1" } }];
    const { dispatcher, history } = makeHarness(plan);
    const result = applyWallDelete({ wallId: "w1", runGeometryCommand: dispatcher });
    expect(result.status).toBe("success");
    expect(history.current.dimensions.find((d) => d.id === "auto3")).toBeUndefined();
    expect(result.result.entityChanges.deleted.dimensions).toEqual(["auto3"]);
  });

  it("PHASE 1A-2C2B corrective F-02: links referencing a dangling (undeliverable) opening are removed", () => {
    const plan = singleWallPlan();
    plan.items = [door("d1", "w1", { x: 3000, y: 0 }), { id: "surv1", kind: "rack", x: 2000, y: 1000, w: 500, h: 500 }];
    plan.links = [
      { id: "lk1", type: "power", fromId: "d1", toId: "surv1" },
      { id: "lk2", type: "power", fromId: "surv1", toId: "d1" },
      { id: "lk3", type: "power", fromId: "surv1", toId: "surv1" }, // unrelated, must survive
    ];
    const { dispatcher, history } = makeHarness(plan);
    const result = applyWallDelete({ wallId: "w1", runGeometryCommand: dispatcher });
    expect(result.status).toBe("success");
    expect(history.current.items.find((it) => it.id === "d1")).toBeUndefined(); // dangling opening removed
    const linkIds = history.current.links.map((l) => l.id).sort();
    expect(linkIds).toEqual(["lk3"]); // both links referencing d1 removed, unrelated link survives
    expect(result.result.entityChanges.deleted.links.sort()).toEqual(["lk1", "lk2"]);
    const diagnostics = validatePlanIntegrity(history.current).diagnostics.filter((d) => d.entityType === "link" || d.entityType === "route");
    expect(diagnostics).toEqual([]);
  });

  it("F-02: multiple links referencing one dangling item are all removed; two dangling items in one delete remove all their links", () => {
    const plan = singleWallPlan();
    plan.items = [
      door("d1", "w1", { x: 3000, y: 0 }, { w: 200 }),
      door("d2", "w1", { x: 3500, y: 0 }, { w: 200 }),
      { id: "surv1", kind: "rack", x: 2000, y: 1000, w: 500, h: 500 },
    ];
    plan.links = [
      { id: "lk1", type: "power", fromId: "d1", toId: "surv1" },
      { id: "lk2", type: "power", fromId: "d1", toId: "surv1" }, // duplicate-ish, both reference d1
      { id: "lk3", type: "power", fromId: "d2", toId: "surv1" },
    ];
    const { dispatcher, history } = makeHarness(plan);
    const result = applyWallDelete({ wallId: "w1", runGeometryCommand: dispatcher });
    expect(result.status).toBe("success");
    expect(history.current.items.find((it) => it.id === "d1")).toBeUndefined();
    expect(history.current.items.find((it) => it.id === "d2")).toBeUndefined();
    expect(history.current.links).toEqual([]);
    expect(result.result.entityChanges.deleted.links.sort()).toEqual(["lk1", "lk2", "lk3"]);
  });

  it("F-02: links on a re-placed (reattached) opening are preserved, not removed", () => {
    const plan = rectPlan();
    plan.items = [door("d1", "w1", { x: 100, y: 0 }), { id: "surv1", kind: "rack", x: 2000, y: 1500, w: 500, h: 500 }];
    plan.links = [{ id: "lk1", type: "power", fromId: "d1", toId: "surv1" }];
    const { dispatcher, history } = makeHarness(plan);
    const result = applyWallDelete({ wallId: "w1", runGeometryCommand: dispatcher });
    expect(result.status).toBe("success");
    const item = history.current.items.find((it) => it.id === "d1");
    expect(item).toBeTruthy();
    expect(item.wallId).not.toBe("w1"); // reattached, not dangling
    expect(history.current.links).toEqual([{ id: "lk1", type: "power", fromId: "d1", toId: "surv1" }]);
    expect(result.result.entityChanges.deleted.links).toEqual([]);
    const diagnostics = validatePlanIntegrity(history.current).diagnostics.filter((d) => d.severity === "error" || d.entityType === "link" || d.entityType === "route");
    expect(diagnostics).toEqual([]);
  });
});

// ── entityChanges contract ───────────────────────────────────────────────────

describe("PHASE 1A-2C2B — entityChanges contract", () => {
  it("deleted.walls/nodes/items and changed.items/dimensions are populated correctly, no duplicates, no plan leak", () => {
    const plan = singleWallPlan();
    plan.items = [door("d1", "w1", { x: 3000, y: 0 })]; // will be deleted (dangling)
    plan.dimensions = [{ id: "dm1", p1: { x: 1, y: 1 }, p2: { x: 2, y: 2 }, attachedTo: { type: "wall", wallId: "w1", t0: 0, t1: 1 } }];
    const { dispatcher } = makeHarness(plan);
    const outcome = applyWallDelete({ wallId: "w1", runGeometryCommand: dispatcher });
    const result = outcome.result;
    expect(result.entityChanges.deleted.walls).toEqual(["w1"]);
    expect(result.entityChanges.deleted.nodes.sort()).toEqual(["na", "nb"]);
    expect(result.entityChanges.deleted.items).toEqual(["d1"]);
    expect(result.entityChanges.changed.dimensions).toEqual(["dm1"]);
    const flatChanged = [...new Set(Object.values(result.entityChanges.changed).flat())];
    expect(flatChanged.length).toBe(new Set(flatChanged).size); // no duplicates
    expect(result.changedEntityIds).toEqual(expect.arrayContaining(["dm1"]));
    expect(result.deletedEntityIds).toEqual(expect.arrayContaining(["w1", "na", "nb", "d1"]));
    expect(result.plan).not.toHaveProperty("entityChanges");
    expect(result.plan).not.toHaveProperty("warnings");
  });

  it("PHASE 1A-2C2B corrective — combined scenario: deleted.{walls,nodes,items,dimensions,links} and changed.{items,dimensions} all populated, no duplicates anywhere, flat arrays consistent", () => {
    const plan = singleWallPlan();
    plan.items = [
      door("d1", "w1", { x: 3000, y: 0 }), // dangling, will be deleted
      { id: "surv1", kind: "rack", x: 2000, y: 1000, w: 500, h: 500 }, // untouched
    ];
    plan.dimensions = [
      { id: "manual1", p1: { x: 1, y: 1 }, p2: { x: 2, y: 2 }, attachedTo: { type: "wall", wallId: "w1", t0: 0.2, t1: 0.6 } },
      { id: "auto1", auto: true, attachedTo: { type: "wall", wallId: "w1", t0: 0, t1: 1 } },
    ];
    plan.links = [{ id: "lk1", type: "power", fromId: "d1", toId: "surv1" }];
    const { dispatcher } = makeHarness(plan);
    const outcome = applyWallDelete({ wallId: "w1", runGeometryCommand: dispatcher });
    const result = outcome.result;

    expect(result.entityChanges.deleted.walls).toEqual(["w1"]);
    expect(result.entityChanges.deleted.nodes.sort()).toEqual(["na", "nb"]);
    expect(result.entityChanges.deleted.items).toEqual(["d1"]);
    expect(result.entityChanges.deleted.dimensions).toEqual(["auto1"]);
    expect(result.entityChanges.deleted.links).toEqual(["lk1"]);
    expect(result.entityChanges.changed.items).toEqual([]);
    expect(result.entityChanges.changed.dimensions).toEqual(["manual1"]);
    expect(result.entityChanges.created).toEqual({
      walls: [], nodes: [], items: [], dimensions: [], links: [], lines: [],
    });

    for (const bucket of ["created", "changed", "deleted"]) {
      const flat = Object.values(result.entityChanges[bucket]).flat();
      expect(flat.length).toBe(new Set(flat).size); // no duplicates within any bucket
    }
    const flatDeleted = Object.values(result.entityChanges.deleted).flat();
    const flatChanged = Object.values(result.entityChanges.changed).flat();
    expect(new Set(result.deletedEntityIds)).toEqual(new Set(flatDeleted));
    expect(new Set(result.changedEntityIds)).toEqual(new Set(flatChanged));
    expect(result.createdEntityIds).toEqual([]);

    const diagnostics = validatePlanIntegrity(result.plan).diagnostics.filter((d) => d.severity === "error");
    expect(diagnostics).toEqual([]);
  });
});

// ── history matrix (real dispatcher, real HistoryModel) ─────────────────────

describe("PHASE 1A-2C2B — history matrix", () => {
  it("normal wall delete: 1 command, 1 checkpoint, selection cleared", () => {
    const plan = rectPlan();
    const { dispatcher, history } = makeHarness(plan);
    const harness = makeDeleteHitsWallHarness(dispatcher);
    harness.setSelection({ coll: "walls", ids: ["w1"] });
    const outcome = harness.deleteWall("w1");
    expect(outcome.status).toBe("success");
    expect(history.past.length).toBe(1);
    expect(harness.selection).toBeNull();
  });

  it("wall with orphan nodes: 1 command, 1 checkpoint, selection cleared", () => {
    const plan = singleWallPlan();
    const { dispatcher, history } = makeHarness(plan);
    const harness = makeDeleteHitsWallHarness(dispatcher);
    harness.setSelection({ coll: "walls", ids: ["w1"] });
    harness.deleteWall("w1");
    expect(history.past.length).toBe(1);
    expect(Object.keys(history.current.nodes)).toEqual([]);
    expect(harness.selection).toBeNull();
  });

  it("wall with a shared node: 1 command, 1 checkpoint, selection cleared", () => {
    const plan = rectPlan();
    const { dispatcher, history } = makeHarness(plan);
    const harness = makeDeleteHitsWallHarness(dispatcher);
    harness.setSelection({ coll: "walls", ids: ["w1"] });
    harness.deleteWall("w1");
    expect(history.past.length).toBe(1);
    expect(history.current.nodes.n1).toBeTruthy(); // shared with w4, preserved
    expect(harness.selection).toBeNull();
  });

  it("opening reattach: 1 command, 1 checkpoint, selection cleared", () => {
    const plan = rectPlan();
    plan.items = [door("d1", "w1", { x: 100, y: 0 })];
    const { dispatcher, history } = makeHarness(plan);
    const harness = makeDeleteHitsWallHarness(dispatcher);
    harness.setSelection({ coll: "walls", ids: ["w1"] });
    harness.deleteWall("w1");
    expect(history.past.length).toBe(1);
    expect(history.current.items.find((it) => it.id === "d1").wallId).not.toBe("w1");
    expect(harness.selection).toBeNull();
  });

  it("dangling opening delete: 1 command, 1 checkpoint, selection cleared", () => {
    const plan = singleWallPlan();
    plan.items = [door("d1", "w1", { x: 3000, y: 0 })];
    const { dispatcher, history } = makeHarness(plan);
    const harness = makeDeleteHitsWallHarness(dispatcher);
    harness.setSelection({ coll: "walls", ids: ["w1"] });
    harness.deleteWall("w1");
    expect(history.past.length).toBe(1);
    expect(history.current.items).toEqual([]);
    expect(harness.selection).toBeNull();
  });

  it("dimension detach: 1 command, 1 checkpoint, selection cleared", () => {
    const plan = rectPlan();
    plan.dimensions = [{ id: "dm1", p1: { x: 1, y: 1 }, p2: { x: 2, y: 2 }, attachedTo: { type: "wall", wallId: "w1", t0: 0.1, t1: 0.4 } }];
    const { dispatcher, history } = makeHarness(plan);
    const harness = makeDeleteHitsWallHarness(dispatcher);
    harness.setSelection({ coll: "walls", ids: ["w1"] });
    harness.deleteWall("w1");
    expect(history.past.length).toBe(1);
    expect(history.current.dimensions[0].attachedTo).toBeNull();
    expect(harness.selection).toBeNull();
  });

  it("missing wall: 1 dispatcher call, 0 checkpoints, stale selection cleared", () => {
    const plan = rectPlan();
    const { dispatcher, history } = makeHarness(plan);
    const spy = vi.fn(dispatcher);
    const harness = makeDeleteHitsWallHarness(spy);
    harness.setSelection({ coll: "walls", ids: ["ghost"] });
    const outcome = harness.deleteWall("ghost");
    expect(outcome.status).toBe("no-target");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(history.past.length).toBe(0);
    expect(harness.selection).toBeNull();
  });

  it("duplicate delete of the same wallId: 2 dispatcher calls total, exactly 1 checkpoint, selection cleared both times", () => {
    const plan = rectPlan();
    const { dispatcher, history } = makeHarness(plan);
    const spy = vi.fn(dispatcher);
    const harness = makeDeleteHitsWallHarness(spy);
    harness.setSelection({ coll: "walls", ids: ["w1"] });
    const first = harness.deleteWall("w1"); // real delete
    expect(first.status).toBe("success");
    harness.setSelection({ coll: "walls", ids: ["w1"] }); // simulate a stale trailing repeat re-arming selection
    const second = harness.deleteWall("w1"); // wall no longer exists
    expect(second.status).toBe("no-target");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(history.past.length).toBe(1);
    expect(harness.selection).toBeNull();
    expect(() => second).not.toThrow();
  });

  it("room-sync diagnostic: 1 command, 1 checkpoint, selection cleared", () => {
    const plan = rectPlan();
    const throwingRoomSyncFn = vi.fn(() => { throw new Error("controlled room-engine failure"); });
    const { dispatcher, history, setRuntimeDiagnostic } = makeHarness(plan, { roomSyncFn: throwingRoomSyncFn });
    const harness = makeDeleteHitsWallHarness(dispatcher);
    harness.setSelection({ coll: "walls", ids: ["w1"] });
    const outcome = harness.deleteWall("w1");
    expect(outcome.status).toBe("success");
    expect(history.past.length).toBe(1);
    expect(harness.selection).toBeNull();
    expect(setRuntimeDiagnostic).toHaveBeenCalled();
  });

  it("commit failure: 0 checkpoints, selection preserved, geometry unchanged", () => {
    const plan = rectPlan();
    const commitPlan = vi.fn(() => { throw new Error("commit failed"); });
    const { dispatcher, history } = makeHarness(plan, { commitPlan });
    const harness = makeDeleteHitsWallHarness(dispatcher);
    const selBefore = { coll: "walls", ids: ["w1"] };
    harness.setSelection(selBefore);
    const outcome = harness.deleteWall("w1");
    expect(outcome.status).toBe("commit-failed");
    expect(history.past.length).toBe(0);
    expect(history.current).toBe(plan);
    expect(harness.selection).toBe(selBefore); // preserved, not cleared
  });

  it("undo returns the exact original plan reference; redo restores the exact committed result (same IDs, same reattachment)", () => {
    const plan = rectPlan();
    plan.items = [door("d1", "w1", { x: 100, y: 0 })];
    const { dispatcher, history } = makeHarness(plan);
    const outcome = applyWallDelete({ wallId: "w1", runGeometryCommand: dispatcher });
    expect(outcome.status).toBe("success");
    const committed = history.current;
    expect(committed).toBe(outcome.result.plan);

    const afterUndo = history.undo();
    expect(afterUndo).toBe(plan);
    expect(afterUndo.walls.some((w) => w.id === "w1")).toBe(true); // wall is back

    const afterRedo = history.redo();
    expect(afterRedo).toBe(committed); // exact same reference — same reattachment result, not recomputed
    expect(afterRedo.items.find((it) => it.id === "d1").wallId).not.toBe("w1");
  });
});
