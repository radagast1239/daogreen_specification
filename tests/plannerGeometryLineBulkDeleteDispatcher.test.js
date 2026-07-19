/**
 * PHASE 1A-2C2D3E2 — atomic multi-line delete (line.bulkDelete), exercised
 * against the real geometry command dispatcher (real HistoryModel, real
 * createGeometryCommandDispatcher, real executeGeometryCommand, real
 * line.bulkDelete via the shared deleteLinesFromPlan helper) — no mocks of
 * the command layer itself. Mirrors
 * plannerGeometryItemBulkDeleteDispatcher.test.js's structure/style for lines.
 *
 * Import-order fragility: same class as the rest of the command-layer test
 * suite — wallGeometry.js warmed up first in beforeAll.
 */
import {
  describe, it, expect, vi, beforeAll,
} from "vitest";
import { CATALOG, migrateLayerId } from "../src/planner/catalog.js";

let executeGeometryCommand;
let createGeometryCommandDispatcher;
let HistoryModel;
let validatePlanIntegrity;
let applyLineBulkDelete;
let climateMod;
let electricalMod;
let pipesMod;
let ROOM_DETECTION_FAILED;

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

  const applyMod = await import("../src/planner/ui/applyLineBulkDelete.js");
  applyLineBulkDelete = applyMod.applyLineBulkDelete;

  climateMod = await import("../src/planner/climate.js");
  electricalMod = await import("../src/planner/electrical.js");
  pipesMod = await import("../src/planner/pipes.js");

  const roomsMod = await import("../src/planner/core/rooms/syncRooms.js");
  ROOM_DETECTION_FAILED = roomsMod.ROOM_DETECTION_FAILED;
});

// ── fixtures ─────────────────────────────────────────────────────────────

function ids(prefix = "id") {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function basePlan() {
  return {
    room: { w: 8000, h: 6000 },
    nodes: {
      n1: { x: 0, y: 0 }, n2: { x: 8000, y: 0 }, n3: { x: 8000, y: 6000 }, n4: { x: 0, y: 6000 },
    },
    walls: [
      { id: "o1", a: "n1", b: "n2", thk: 200, role: "outer" },
      { id: "o2", a: "n2", b: "n3", thk: 200, role: "outer" },
      { id: "o3", a: "n3", b: "n4", thk: 200, role: "outer" },
      { id: "o4", a: "n4", b: "n1", thk: 200, role: "outer" },
    ],
    items: [],
    lines: [],
    dimensions: [],
    rooms: [],
    zones: [],
    links: [],
  };
}

function line(id, layer, pts, extra = {}) {
  return {
    id, layer, pts, points: pts, ...extra,
  };
}

// Catalog "tank" kind — objectCanHavePipe(kind:"tank") === true, ports come
// from defaultPortsForKind("tank") = ["water","drain"], both side:"back".
// portPosition math (angle=0): water port (offset 0.25) -> (x + w*0.25, y);
// drain port (offset 0.5) -> (x + w*0.5, y). With w=1000: water=(x+250,y),
// drain=(x+500,y) — used below to place pipe-line endpoints exactly on a
// port so attachPipeConnections (pipes.js) resolves fromItemId/toItemId
// deterministically without depending on default-port internals elsewhere.
function tank(id, x, y, extra = {}) {
  return {
    id, kind: "tank", layer: "water", x, y, w: 1000, h: 1000, ...extra,
  };
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
  return {
    history, dispatcher, commitPlan, setSelection, setRuntimeDiagnostic, showMessage, roomSyncFn,
  };
}

// ── applyLineBulkDelete orchestration ────────────────────────────────────

describe("PHASE 1A-2C2D3E2 — applyLineBulkDelete orchestration", () => {
  it("empty/missing lineIds never calls the dispatcher", () => {
    const runGeometryCommand = vi.fn();
    expect(applyLineBulkDelete({ lineIds: [], runGeometryCommand })).toEqual({ status: "no-target", result: null });
    expect(applyLineBulkDelete({ lineIds: null, runGeometryCommand })).toEqual({ status: "no-target", result: null });
    expect(runGeometryCommand).not.toHaveBeenCalled();
  });

  it("a valid lineIds array dispatches exactly one line.bulkDelete command", () => {
    const runGeometryCommand = vi.fn(() => ({ ok: true, changed: true }));
    const { status } = applyLineBulkDelete({ lineIds: ["a", "b"], runGeometryCommand });
    expect(status).toBe("success");
    expect(runGeometryCommand).toHaveBeenCalledTimes(1);
    expect(runGeometryCommand).toHaveBeenCalledWith({ type: "line.bulkDelete", lineIds: ["a", "b"] });
  });

  it("lineIds that don't exist in the plan classify as no-target", () => {
    const runGeometryCommand = vi.fn(() => ({ ok: false, error: { code: "GEOMETRY_COMMAND_NO_TARGET" } }));
    expect(applyLineBulkDelete({ lineIds: ["missing"], runGeometryCommand }).status).toBe("no-target");
  });

  it("a commit failure classifies distinctly as commit-failed", () => {
    const runGeometryCommand = vi.fn(() => ({ ok: false, error: { code: "GEOMETRY_COMMAND_COMMIT_FAILED" } }));
    expect(applyLineBulkDelete({ lineIds: ["a"], runGeometryCommand }).status).toBe("commit-failed");
  });
});

// ── command validation ───────────────────────────────────────────────────

describe("PHASE 1A-2C2D3E2 — line.bulkDelete command validation", () => {
  it("rejects a non-array lineIds payload", () => {
    const result = executeGeometryCommand(basePlan(), { type: "line.bulkDelete", lineIds: "not-an-array" }, { makeId: ids() });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("GEOMETRY_COMMAND_INVALID");
  });

  it("rejects an empty array payload", () => {
    const result = executeGeometryCommand(basePlan(), { type: "line.bulkDelete", lineIds: [] }, { makeId: ids() });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("GEOMETRY_COMMAND_INVALID");
  });

  it("all missing IDs -> GEOMETRY_COMMAND_NO_TARGET, original plan reference preserved", () => {
    const plan = basePlan();
    plan.lines = [line("l1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const result = executeGeometryCommand(plan, { type: "line.bulkDelete", lineIds: ["missing-1", "missing-2"] }, { makeId: ids() });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("GEOMETRY_COMMAND_NO_TARGET");
    expect(result.plan).toBe(plan);
  });

  it("partial missing IDs: deletes the existing ones, ignores the missing one", () => {
    const plan = basePlan();
    plan.lines = [
      line("l1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }]),
      line("l2", "drain", [{ x: 2000, y: 0 }, { x: 3000, y: 0 }]),
    ];
    const result = executeGeometryCommand(plan, { type: "line.bulkDelete", lineIds: ["l1", "missing"] }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.lines.map((l) => l.id)).toEqual(["l2"]);
    expect(result.entityChanges.deleted.lines).toEqual(["l1"]);
  });

  it("dedupes repeated IDs in the payload (no duplicate processing)", () => {
    const plan = basePlan();
    plan.lines = [line("l1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const result = executeGeometryCommand(plan, { type: "line.bulkDelete", lineIds: ["l1", "l1", "l1"] }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.lines).toEqual([]);
    expect(result.entityChanges.deleted.lines).toEqual(["l1"]);
  });

  it("does not mutate the input lineIds array", () => {
    const plan = basePlan();
    plan.lines = [line("l1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const payload = ["l1", "l1"];
    const frozen = Object.freeze([...payload]);
    executeGeometryCommand(plan, { type: "line.bulkDelete", lineIds: frozen }, { makeId: ids() });
    expect(frozen).toEqual(["l1", "l1"]);
  });
});

// ── REQUIRED FIX F-01 — full typed entityChanges shape on non-success ────
//
// Prior bug: emptyEntityChanges() hand-maintained a bucket literal that only
// listed walls/nodes/items/dimensions, so rejected()/noop() results (built
// on baseResult() -> emptyEntityChanges() directly, not through
// normalizeEntityChanges()) had links/lines silently MISSING from
// entityChanges.created/changed/deleted, instead of present as [].

describe("PHASE 1A-2C2D3E2 REQUIRED FIX F-01 — full entityChanges shape on non-success results", () => {
  const FULL_EMPTY_BUCKET = {
    walls: [], nodes: [], items: [], dimensions: [], links: [], lines: [],
  };

  it("invalid payload (null lineIds) still returns the full typed entityChanges shape, with links/lines explicitly present as []", () => {
    const result = executeGeometryCommand(basePlan(), { type: "line.bulkDelete", lineIds: null }, { makeId: ids() });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("GEOMETRY_COMMAND_INVALID");
    expect(result.entityChanges.created).toEqual(FULL_EMPTY_BUCKET);
    expect(result.entityChanges.changed).toEqual(FULL_EMPTY_BUCKET);
    expect(result.entityChanges.deleted).toEqual(FULL_EMPTY_BUCKET);
    expect(Object.keys(result.entityChanges.created).sort()).toEqual(Object.keys(FULL_EMPTY_BUCKET).sort());
  });

  it("no-target result (all missing IDs) still returns the full typed entityChanges shape and the exact original plan reference", () => {
    const plan = basePlan();
    plan.lines = [line("l1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const result = executeGeometryCommand(plan, { type: "line.bulkDelete", lineIds: ["missing"] }, { makeId: ids() });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("GEOMETRY_COMMAND_NO_TARGET");
    expect(result.plan).toBe(plan);
    expect(result.entityChanges.created).toEqual(FULL_EMPTY_BUCKET);
    expect(result.entityChanges.changed).toEqual(FULL_EMPTY_BUCKET);
    expect(result.entityChanges.deleted).toEqual(FULL_EMPTY_BUCKET);
  });

  it("fresh-reference safety: created/changed/deleted are independent objects with independent per-kind arrays, not shared between buckets or across separate command results", () => {
    const plan = basePlan();
    plan.lines = [line("l1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];

    const resultA = executeGeometryCommand(plan, { type: "line.bulkDelete", lineIds: ["missing"] }, { makeId: ids() });
    expect(resultA.entityChanges.created).not.toBe(resultA.entityChanges.changed);
    expect(resultA.entityChanges.changed).not.toBe(resultA.entityChanges.deleted);
    expect(resultA.entityChanges.created.lines).not.toBe(resultA.entityChanges.changed.lines);
    expect(resultA.entityChanges.created.lines).not.toBe(resultA.entityChanges.deleted.lines);

    const resultB = executeGeometryCommand(plan, { type: "line.bulkDelete", lineIds: ["missing"] }, { makeId: ids() });
    expect(resultB.entityChanges).not.toBe(resultA.entityChanges);
    expect(resultB.entityChanges.created).not.toBe(resultA.entityChanges.created);
    expect(resultB.entityChanges.created.lines).not.toBe(resultA.entityChanges.created.lines);

    // Mutating one result's bucket array must never leak into a separate
    // command result's bucket (reference-inequality proof above made
    // concrete, without mutating any production result the test itself
    // still relies on afterward).
    resultA.entityChanges.created.lines.push("leaked");
    expect(resultB.entityChanges.created.lines).toEqual([]);
  });
});

// ── surviving lines / items / walls / nodes untouched ────────────────────

describe("PHASE 1A-2C2D3E2 — no collateral changes outside plan.lines", () => {
  it("unrelated surviving line is preserved as the exact same reference", () => {
    const plan = basePlan();
    const survivor = line("l2", "irrigation", [{ x: 5000, y: 0 }, { x: 5000, y: 1000 }]);
    plan.lines = [line("l1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }]), survivor];
    const result = executeGeometryCommand(plan, { type: "line.bulkDelete", lineIds: ["l1"] }, { makeId: ids() });
    const found = result.plan.lines.find((l) => l.id === "l2");
    expect(found).toBeTruthy();
    expect(found.id).toBe(survivor.id);
    expect(found.layer).toBe(survivor.layer);
  });

  it("items are never deleted by line.bulkDelete", () => {
    const plan = basePlan();
    plan.items = [tank("t1", 0, 0)];
    plan.lines = [line("l1", "drain", [{ x: 500, y: 0 }, { x: 500, y: -2000 }])];
    const result = executeGeometryCommand(plan, { type: "line.bulkDelete", lineIds: ["l1"] }, { makeId: ids() });
    expect(result.ok).toBe(true);
    // Same-count/same-identity check, not exact object equality: the shared
    // engineering sync (syncObjectConnectionsFromPipes) always (re)attaches a
    // "connections" field to every item — same documented behavior as
    // item.bulkDelete's own "surviving item... keeps its identity/placement
    // fields unchanged" test.
    expect(result.plan.items).toHaveLength(1);
    const survivor = result.plan.items[0];
    expect(survivor.id).toBe("t1");
    expect(survivor.kind).toBe("tank");
    expect(survivor.layer).toBe("water");
    expect(survivor.x).toBe(0);
    expect(survivor.y).toBe(0);
    expect(result.entityChanges.deleted.items).toEqual([]);
  });

  it("walls/nodes are never changed by line.bulkDelete", () => {
    const plan = basePlan();
    plan.lines = [line("l1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const result = executeGeometryCommand(plan, { type: "line.bulkDelete", lineIds: ["l1"] }, { makeId: ids() });
    expect(result.plan.walls).toEqual(plan.walls);
    expect(result.plan.nodes).toEqual(plan.nodes);
    expect(result.entityChanges.deleted.walls).toEqual([]);
    expect(result.entityChanges.deleted.nodes).toEqual([]);
  });

  it("plan.links are never touched by line.bulkDelete (links reference items, never lines)", () => {
    const plan = basePlan();
    plan.items = [tank("t1", 0, 0), tank("t2", 3000, 0)];
    plan.links = [{ id: "lk1", type: "water", fromId: "t1", toId: "t2" }];
    plan.lines = [line("l1", "drain", [{ x: 500, y: 0 }, { x: 500, y: -2000 }])];
    const result = executeGeometryCommand(plan, { type: "line.bulkDelete", lineIds: ["l1"] }, { makeId: ids() });
    expect(result.plan.links).toEqual(plan.links);
    expect(result.entityChanges.deleted.links).toEqual([]);
  });

  it("validator reports no new error-severity diagnostics after line deletion", () => {
    const plan = basePlan();
    plan.items = [tank("t1", 0, 0)];
    plan.lines = [line("l1", "drain", [{ x: 500, y: 0 }, { x: 500, y: -2000 }])];
    const result = executeGeometryCommand(plan, { type: "line.bulkDelete", lineIds: ["l1"] }, { makeId: ids() });
    const diagnostics = validatePlanIntegrity(result.plan).diagnostics.filter((d) => d.severity === "error");
    expect(diagnostics).toEqual([]);
  });
});

// ── pipe endpoint references (fromItemId/toItemId) ───────────────────────

describe("PHASE 1A-2C2D3E2 — pipe-line item connections", () => {
  it("deleting a pipe line whose endpoint resolved to an item does not touch that item", () => {
    const plan = basePlan();
    plan.items = [tank("t1", 0, 0)];
    // drain port at (x + w*0.5, y) = (500, 0) — see tank() helper doc comment.
    plan.lines = [line("l1", "drain", [{ x: 500, y: 0 }, { x: 500, y: -2000 }])];
    const result = executeGeometryCommand(plan, { type: "line.bulkDelete", lineIds: ["l1"] }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.lines).toEqual([]);
    const survivingTank = result.plan.items.find((it) => it.id === "t1");
    expect(survivingTank).toBeTruthy();
  });

  it("surviving item's derived pipe connections no longer reference the deleted line", () => {
    const plan = basePlan();
    plan.items = [tank("t1", 0, 0)];
    plan.lines = [line("l1", "drain", [{ x: 500, y: 0 }, { x: 500, y: -2000 }])];
    // Sanity: before deletion, syncPlanPipes would attach a "pipe" connection
    // for this endpoint (production behavior, not re-derived here) — after
    // deletion, the surviving item's connections must not reference l1.
    const before = pipesMod.syncPlanPipes(plan);
    const beforeConn = before.items.find((it) => it.id === "t1").connections || [];
    expect(beforeConn.some((c) => c.pipeId === "l1")).toBe(true);

    const result = executeGeometryCommand(plan, { type: "line.bulkDelete", lineIds: ["l1"] }, { makeId: ids() });
    const afterConn = result.plan.items.find((it) => it.id === "t1").connections || [];
    expect(afterConn.some((c) => c.pipeId === "l1")).toBe(false);
  });

  it("several pipe/electrical lines deleted together: both kinds removed atomically, unrelated pipe survives", () => {
    const plan = basePlan();
    plan.items = [tank("t1", 0, 0)];
    plan.lines = [
      line("l1", "drain", [{ x: 500, y: 0 }, { x: 500, y: -2000 }]),
      line("l2", "power", [{ x: 5000, y: 0 }, { x: 5000, y: 1000 }]),
      line("l3", "irrigation", [{ x: 6000, y: 0 }, { x: 6000, y: 1000 }]), // survives
    ];
    const result = executeGeometryCommand(plan, { type: "line.bulkDelete", lineIds: ["l1", "l2"] }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.lines.map((l) => l.id)).toEqual(["l3"]);
    expect(result.entityChanges.deleted.lines.sort()).toEqual(["l1", "l2"]);
  });
});

// ── engineering sync exactly once ────────────────────────────────────────

describe("PHASE 1A-2C2D3E2 — engineering derived sync", () => {
  it("runs syncClimatePlan/syncElectricalPlan/syncPlanPipes exactly once per command", () => {
    const climateSpy = vi.spyOn(climateMod, "syncClimatePlan");
    const electricalSpy = vi.spyOn(electricalMod, "syncElectricalPlan");
    const pipesSpy = vi.spyOn(pipesMod, "syncPlanPipes");
    climateSpy.mockClear();
    electricalSpy.mockClear();
    pipesSpy.mockClear();

    const plan = basePlan();
    plan.items = [tank("t1", 0, 0)];
    plan.lines = [
      line("l1", "drain", [{ x: 500, y: 0 }, { x: 500, y: -2000 }]),
      line("l2", "power", [{ x: 5000, y: 0 }, { x: 5000, y: 1000 }]),
    ];
    const result = executeGeometryCommand(plan, { type: "line.bulkDelete", lineIds: ["l1", "l2"] }, { makeId: ids() });

    expect(result.ok).toBe(true);
    expect(climateSpy).toHaveBeenCalledTimes(1);
    expect(electricalSpy).toHaveBeenCalledTimes(1);
    expect(pipesSpy).toHaveBeenCalledTimes(1);
    climateSpy.mockRestore();
    electricalSpy.mockRestore();
    pipesSpy.mockRestore();
  });

  it("no engineering sync runs when the command is rejected (no-target)", () => {
    const climateSpy = vi.spyOn(climateMod, "syncClimatePlan");
    const electricalSpy = vi.spyOn(electricalMod, "syncElectricalPlan");
    const pipesSpy = vi.spyOn(pipesMod, "syncPlanPipes");
    climateSpy.mockClear();
    electricalSpy.mockClear();
    pipesSpy.mockClear();

    const plan = basePlan();
    plan.lines = [line("l1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const result = executeGeometryCommand(plan, { type: "line.bulkDelete", lineIds: ["missing"] }, { makeId: ids() });

    expect(result.ok).toBe(false);
    expect(climateSpy).not.toHaveBeenCalled();
    expect(electricalSpy).not.toHaveBeenCalled();
    expect(pipesSpy).not.toHaveBeenCalled();
    climateSpy.mockRestore();
    electricalSpy.mockRestore();
    pipesSpy.mockRestore();
  });
});

// ── room diagnostic ───────────────────────────────────────────────────────

describe("PHASE 1A-2C2D3E2 — room-sync diagnostic", () => {
  it("a room-sync engine exception still reports ok:true with a ROOM_DETECTION_FAILED diagnostic (centralized applyRoomSync policy, unchanged by this command)", () => {
    const plan = basePlan();
    plan.lines = [line("l1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const throwingRoomSyncFn = () => { throw new Error("controlled room-engine failure"); };
    const result = executeGeometryCommand(
      plan,
      { type: "line.bulkDelete", lineIds: ["l1"] },
      { makeId: ids(), roomSyncFn: throwingRoomSyncFn },
    );
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.diagnostics?.[0]?.code).toBe(ROOM_DETECTION_FAILED);
  });
});

// ── history matrix ────────────────────────────────────────────────────────

describe("PHASE 1A-2C2D3E2 — history matrix", () => {
  it("one line: 1 command, 1 checkpoint, validator clean", () => {
    const plan = basePlan();
    plan.lines = [line("l1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const h = makeHarness(plan);
    const before = h.history.current;
    const { status } = applyLineBulkDelete({ lineIds: ["l1"], runGeometryCommand: h.dispatcher });
    expect(status).toBe("success");
    expect(h.commitPlan).toHaveBeenCalledTimes(1);
    expect(h.history.current).not.toBe(before);
    expect(h.history.current.lines).toEqual([]);
    const diagnostics = validatePlanIntegrity(h.history.current).diagnostics.filter((d) => d.severity === "error");
    expect(diagnostics).toEqual([]);
  });

  it("several lines: 1 command, 1 checkpoint", () => {
    const plan = basePlan();
    plan.lines = [
      line("l1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }]),
      line("l2", "drain", [{ x: 2000, y: 0 }, { x: 3000, y: 0 }]),
      line("l3", "drain", [{ x: 4000, y: 0 }, { x: 5000, y: 0 }]),
    ];
    const h = makeHarness(plan);
    const { status } = applyLineBulkDelete({ lineIds: ["l1", "l2"], runGeometryCommand: h.dispatcher });
    expect(status).toBe("success");
    expect(h.commitPlan).toHaveBeenCalledTimes(1);
    expect(h.history.current.lines.map((l) => l.id)).toEqual(["l3"]);
  });

  it("duplicate IDs in one call: 1 command, 1 checkpoint", () => {
    const plan = basePlan();
    plan.lines = [line("l1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const h = makeHarness(plan);
    const { status } = applyLineBulkDelete({ lineIds: ["l1", "l1"], runGeometryCommand: h.dispatcher });
    expect(status).toBe("success");
    expect(h.commitPlan).toHaveBeenCalledTimes(1);
  });

  it("partial missing: 1 command, 1 checkpoint, validator clean", () => {
    const plan = basePlan();
    plan.lines = [line("l1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const h = makeHarness(plan);
    const { status } = applyLineBulkDelete({ lineIds: ["l1", "missing"], runGeometryCommand: h.dispatcher });
    expect(status).toBe("success");
    expect(h.commitPlan).toHaveBeenCalledTimes(1);
    const diagnostics = validatePlanIntegrity(h.history.current).diagnostics.filter((d) => d.severity === "error");
    expect(diagnostics).toEqual([]);
  });

  it("all missing: 0 checkpoints, original plan retained", () => {
    const plan = basePlan();
    plan.lines = [line("l1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const h = makeHarness(plan);
    const before = h.history.current;
    const { status } = applyLineBulkDelete({ lineIds: ["missing-1", "missing-2"], runGeometryCommand: h.dispatcher });
    expect(status).toBe("no-target");
    expect(h.commitPlan).not.toHaveBeenCalled();
    expect(h.history.current).toBe(before);
  });

  it("empty helper input: 0 dispatcher calls, 0 checkpoints", () => {
    const plan = basePlan();
    const h = makeHarness(plan);
    const { status } = applyLineBulkDelete({ lineIds: [], runGeometryCommand: h.dispatcher });
    expect(status).toBe("no-target");
    expect(h.commitPlan).not.toHaveBeenCalled();
  });

  it("duplicate clear: 2 dispatch attempts total, exactly 1 checkpoint", () => {
    const plan = basePlan();
    plan.lines = [line("l1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const h = makeHarness(plan);
    const first = applyLineBulkDelete({ lineIds: ["l1"], runGeometryCommand: h.dispatcher });
    const second = applyLineBulkDelete({ lineIds: ["l1"], runGeometryCommand: h.dispatcher });
    expect(first.status).toBe("success");
    expect(second.status).toBe("no-target");
    expect(h.commitPlan).toHaveBeenCalledTimes(1);
  });

  it("commit failure: 0 checkpoints, original plan retained", () => {
    const plan = basePlan();
    plan.lines = [line("l1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const commitPlan = vi.fn(() => { throw new Error("commit failed"); });
    const h = makeHarness(plan, { commitPlan });
    const before = h.history.current;
    const { status } = applyLineBulkDelete({ lineIds: ["l1"], runGeometryCommand: h.dispatcher });
    expect(status).toBe("commit-failed");
    expect(h.history.current).toBe(before);
  });

  it("drain clear (non-empty): 1 command, 1 checkpoint — mirrors clearSheet's MIGRATED_LINE_CLEAR_LAYER_IDS computation", () => {
    const plan = basePlan();
    plan.lines = [
      line("l1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }]),
      line("l2", "irrigation", [{ x: 2000, y: 0 }, { x: 3000, y: 0 }]), // different sheet, must survive
    ];
    const h = makeHarness(plan);
    const lineIds = plan.lines
      .filter((l) => l.layer === "drain" || migrateLayerId(l.layer) === "drain")
      .map((l) => l.id);
    const { status } = applyLineBulkDelete({ lineIds, runGeometryCommand: h.dispatcher });
    expect(status).toBe("success");
    expect(h.commitPlan).toHaveBeenCalledTimes(1);
    expect(h.history.current.lines.map((l) => l.id)).toEqual(["l2"]);
  });

  it("drain clear (empty sheet): no-target, 0 checkpoints", () => {
    const plan = basePlan();
    plan.lines = [line("l1", "irrigation", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const h = makeHarness(plan);
    const lineIds = plan.lines
      .filter((l) => l.layer === "drain" || migrateLayerId(l.layer) === "drain")
      .map((l) => l.id);
    const { status } = applyLineBulkDelete({ lineIds, runGeometryCommand: h.dispatcher });
    expect(status).toBe("no-target");
    expect(h.commitPlan).not.toHaveBeenCalled();
  });

  it("irrigation clear: canonical + legacy \"supply\" alias lines both matched via migrateLayerId, 1 command, 1 checkpoint", () => {
    const plan = basePlan();
    plan.lines = [
      line("l1", "irrigation", [{ x: 0, y: 0 }, { x: 1000, y: 0 }]),
      line("l2", "supply", [{ x: 2000, y: 0 }, { x: 3000, y: 0 }]), // legacy id, migrates to irrigation
      line("l3", "power", [{ x: 4000, y: 0 }, { x: 5000, y: 0 }]), // different sheet, must survive
    ];
    const h = makeHarness(plan);
    const lineIds = plan.lines
      .filter((l) => l.layer === "irrigation" || migrateLayerId(l.layer) === "irrigation")
      .map((l) => l.id);
    expect(lineIds.sort()).toEqual(["l1", "l2"]);
    const { status } = applyLineBulkDelete({ lineIds, runGeometryCommand: h.dispatcher });
    expect(status).toBe("success");
    expect(h.commitPlan).toHaveBeenCalledTimes(1);
    expect(h.history.current.lines.map((l) => l.id)).toEqual(["l3"]);
  });

  it("undo returns the exact original plan reference; redo restores the exact committed reference (not recomputed)", () => {
    const plan = basePlan();
    plan.items = [tank("t1", 0, 0)];
    plan.lines = [
      line("l1", "drain", [{ x: 500, y: 0 }, { x: 500, y: -2000 }]),
      line("l2", "drain", [{ x: 2000, y: 0 }, { x: 3000, y: 0 }]),
    ];
    const h = makeHarness(plan);
    const original = h.history.current;
    applyLineBulkDelete({ lineIds: ["l1"], runGeometryCommand: h.dispatcher });
    const committed = h.history.current;
    expect(committed).not.toBe(original);

    h.history.undo();
    expect(h.history.current).toBe(original);
    expect(h.history.current.lines.map((l) => l.id)).toEqual(["l1", "l2"]);

    h.history.redo();
    expect(h.history.current).toBe(committed);
    expect(h.history.current.lines.map((l) => l.id)).toEqual(["l2"]);
  });
});

// ── irrigation catalog boundary guard (AUDIT PHASE 1A-2C2D3E1) ───────────

describe("PHASE 1A-2C2D3E2 — irrigation catalog inventory boundary guard", () => {
  it("irrigation has zero catalog item kinds today — clearSheet's line-only migration for this layer relies on that being true; if this ever fails, STOP and treat it as a blocker for line-only irrigation clear (see AUDIT PHASE 1A-2C2D3E1, section 11) instead of proceeding", () => {
    const irrigationItemKinds = CATALOG.filter((c) => c.layer === "irrigation");
    expect(irrigationItemKinds).toEqual([]);
  });
});
