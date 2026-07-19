/**
 * PHASE 1A-2C2D3E4C — atomic combined item+line delete (itemLine.bulkDelete),
 * exercised against the real geometry command dispatcher (real HistoryModel,
 * real createGeometryCommandDispatcher, real executeGeometryCommand, real
 * itemLine.bulkDelete via the shared deleteItemsAndLinesFromPlan orchestration
 * calling the already-accepted computeItemRemoval/computeLineRemoval
 * primitives) — no mocks of the command layer itself, and no re-derived
 * cleanup algorithm.
 *
 * Import-order fragility: same class as the rest of the command-layer test
 * suite — wallGeometry.js warmed up first in beforeAll.
 */
import {
  describe, it, expect, vi, beforeAll,
} from "vitest";

let executeGeometryCommand;
let createGeometryCommandDispatcher;
let HistoryModel;
let validatePlanIntegrity;
let applyItemLineBulkDelete;
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

  const applyMod = await import("../src/planner/ui/applyItemLineBulkDelete.js");
  applyItemLineBulkDelete = applyMod.applyItemLineBulkDelete;

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

function rack(id, x, y, extra = {}) {
  return {
    id, kind: "rack", layer: "racks", x, y, w: 1220, h: 600, ...extra,
  };
}

// Catalog "tank" kind — objectCanHavePipe(kind:"tank") === true, ports come
// from defaultPortsForKind("tank") = ["water","drain"], both side:"back".
// portPosition math (angle=0): drain port (offset 0.5) -> (x + w*0.5, y).
// With w=1000: drain port = (x+500, y) — used to place pipe-line endpoints
// exactly on a port so attachPipeConnections (pipes.js) resolves
// fromItemId/toItemId deterministically.
function tank(id, x, y, extra = {}) {
  return {
    id, kind: "tank", layer: "water", x, y, w: 1000, h: 1000, ...extra,
  };
}

function line(id, layer, pts, extra = {}) {
  return {
    id, layer, pts, points: pts, ...extra,
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

const FULL_EMPTY_BUCKET = {
  walls: [], nodes: [], items: [], dimensions: [], links: [], lines: [],
};

// ── command validation ───────────────────────────────────────────────────

describe("PHASE 1A-2C2D3E4C — itemLine.bulkDelete command validation", () => {
  it("rejects a missing itemIds field", () => {
    const result = executeGeometryCommand(basePlan(), { type: "itemLine.bulkDelete", lineIds: [] }, { makeId: ids() });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("GEOMETRY_COMMAND_INVALID");
  });

  it("rejects a missing lineIds field", () => {
    const result = executeGeometryCommand(basePlan(), { type: "itemLine.bulkDelete", itemIds: [] }, { makeId: ids() });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("GEOMETRY_COMMAND_INVALID");
  });

  it("rejects a non-array itemIds payload", () => {
    const result = executeGeometryCommand(basePlan(), { type: "itemLine.bulkDelete", itemIds: "not-an-array", lineIds: [] }, { makeId: ids() });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("GEOMETRY_COMMAND_INVALID");
  });

  it("rejects a non-array lineIds payload", () => {
    const result = executeGeometryCommand(basePlan(), { type: "itemLine.bulkDelete", itemIds: [], lineIds: "not-an-array" }, { makeId: ids() });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("GEOMETRY_COMMAND_INVALID");
  });

  it("rejects both-empty arrays", () => {
    const result = executeGeometryCommand(basePlan(), { type: "itemLine.bulkDelete", itemIds: [], lineIds: [] }, { makeId: ids() });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("GEOMETRY_COMMAND_INVALID");
  });

  it("does not mutate frozen input arrays", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)];
    plan.lines = [line("l1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const itemPayload = Object.freeze(["r1"]);
    const linePayload = Object.freeze(["l1"]);
    executeGeometryCommand(plan, { type: "itemLine.bulkDelete", itemIds: itemPayload, lineIds: linePayload }, { makeId: ids() });
    expect(itemPayload).toEqual(["r1"]);
    expect(linePayload).toEqual(["l1"]);
  });
});

// ── target resolution ─────────────────────────────────────────────────────

describe("PHASE 1A-2C2D3E4C — target resolution", () => {
  it("deletes one item and one line together", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)];
    plan.lines = [line("l1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const result = executeGeometryCommand(plan, { type: "itemLine.bulkDelete", itemIds: ["r1"], lineIds: ["l1"] }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.items).toEqual([]);
    expect(result.plan.lines).toEqual([]);
  });

  it("deletes several items and several lines together", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0), rack("r2", 2000, 0), rack("r3", 4000, 0)];
    plan.lines = [
      line("l1", "power", [{ x: 0, y: 0 }, { x: 1000, y: 0 }]),
      line("l2", "power", [{ x: 2000, y: 0 }, { x: 3000, y: 0 }]),
    ];
    const result = executeGeometryCommand(plan, { type: "itemLine.bulkDelete", itemIds: ["r1", "r2"], lineIds: ["l1", "l2"] }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.items.map((it) => it.id)).toEqual(["r3"]);
    expect(result.plan.lines).toEqual([]);
  });

  it("items only (empty lineIds) succeeds", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)];
    const result = executeGeometryCommand(plan, { type: "itemLine.bulkDelete", itemIds: ["r1"], lineIds: [] }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.items).toEqual([]);
    expect(result.entityChanges.deleted.items).toEqual(["r1"]);
    expect(result.entityChanges.deleted.lines).toEqual([]);
  });

  it("lines only (empty itemIds) succeeds", () => {
    const plan = basePlan();
    plan.lines = [line("l1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const result = executeGeometryCommand(plan, { type: "itemLine.bulkDelete", itemIds: [], lineIds: ["l1"] }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.lines).toEqual([]);
    expect(result.entityChanges.deleted.lines).toEqual(["l1"]);
    expect(result.entityChanges.deleted.items).toEqual([]);
  });

  it("partial missing IDs in both arrays: deletes the existing ones, ignores the missing ones", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)];
    plan.lines = [line("l1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const result = executeGeometryCommand(
      plan,
      { type: "itemLine.bulkDelete", itemIds: ["r1", "missing-item"], lineIds: ["l1", "missing-line"] },
      { makeId: ids() },
    );
    expect(result.ok).toBe(true);
    expect(result.plan.items).toEqual([]);
    expect(result.plan.lines).toEqual([]);
    expect(result.entityChanges.deleted.items).toEqual(["r1"]);
    expect(result.entityChanges.deleted.lines).toEqual(["l1"]);
  });

  it("all missing in both arrays -> GEOMETRY_COMMAND_NO_TARGET, original plan reference preserved", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)];
    plan.lines = [line("l1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const result = executeGeometryCommand(
      plan,
      { type: "itemLine.bulkDelete", itemIds: ["missing-item"], lineIds: ["missing-line"] },
      { makeId: ids() },
    );
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("GEOMETRY_COMMAND_NO_TARGET");
    expect(result.plan).toBe(plan);
  });

  it("dedupes repeated IDs in both payloads", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)];
    plan.lines = [line("l1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const result = executeGeometryCommand(
      plan,
      { type: "itemLine.bulkDelete", itemIds: ["r1", "r1"], lineIds: ["l1", "l1", "l1"] },
      { makeId: ids() },
    );
    expect(result.ok).toBe(true);
    expect(result.entityChanges.deleted.items).toEqual(["r1"]);
    expect(result.entityChanges.deleted.lines).toEqual(["l1"]);
  });

  it("the same literal string ID in itemIds and lineIds is treated independently (namespaced collections)", () => {
    const plan = basePlan();
    plan.items = [rack("shared-1", 0, 0)];
    plan.lines = [line("shared-1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const result = executeGeometryCommand(
      plan,
      { type: "itemLine.bulkDelete", itemIds: ["shared-1"], lineIds: ["shared-1"] },
      { makeId: ids() },
    );
    expect(result.ok).toBe(true);
    expect(result.plan.items).toEqual([]);
    expect(result.plan.lines).toEqual([]);
    expect(result.entityChanges.deleted.items).toEqual(["shared-1"]);
    expect(result.entityChanges.deleted.lines).toEqual(["shared-1"]);
  });
});

// ── item structural cleanup ────────────────────────────────────────────────

describe("PHASE 1A-2C2D3E4C — item structural cleanup", () => {
  it("removes a link whose fromId references a deleted item", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0), rack("r2", 2000, 0)];
    plan.links = [{ id: "lk1", type: "power", fromId: "r1", toId: "r2" }];
    const result = executeGeometryCommand(plan, { type: "itemLine.bulkDelete", itemIds: ["r1"], lineIds: [] }, { makeId: ids() });
    expect(result.plan.links).toEqual([]);
    expect(result.entityChanges.deleted.links).toEqual(["lk1"]);
  });

  it("a persisted auto item-dimension attached to a deleted item is deleted, not detached", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)];
    plan.dimensions = [{
      id: "auto1", auto: true, kind: "opening", p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 }, attachedTo: { type: "item", id: "r1" },
    }];
    const result = executeGeometryCommand(plan, { type: "itemLine.bulkDelete", itemIds: ["r1"], lineIds: [] }, { makeId: ids() });
    expect(result.plan.dimensions).toEqual([]);
    expect(result.entityChanges.deleted.dimensions).toEqual(["auto1"]);
    expect(result.entityChanges.changed.dimensions).toEqual([]);
  });

  it("a manual item-dimension attached to a deleted item is detached with live-resolved p1/p2, and produces a dimension warning", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 1000, 500, { w: 1220, h: 600 })];
    plan.dimensions = [{
      id: "manual1", auto: false, kind: "manual", p1: { x: 1, y: 1 }, p2: { x: 2, y: 2 }, attachedTo: { type: "item", id: "r1", mode: "bbox-width" },
    }];
    const result = executeGeometryCommand(plan, { type: "itemLine.bulkDelete", itemIds: ["r1"], lineIds: [] }, { makeId: ids() });
    const dim = result.plan.dimensions.find((d) => d.id === "manual1");
    expect(dim.attachedTo).toBeNull();
    expect(dim.p1).toEqual({ x: 1000, y: 500 });
    expect(dim.p2).toEqual({ x: 1000 + 1220, y: 500 });
    expect(result.entityChanges.changed.dimensions).toEqual(["manual1"]);
    expect(result.warnings.some((w) => w.entityId === "manual1")).toBe(true);
  });
});

// ── line/engineering behavior ─────────────────────────────────────────────

describe("PHASE 1A-2C2D3E4C — line and engineering sync behavior", () => {
  it("deleted line is absent, unrelated line preserved", () => {
    const plan = basePlan();
    const survivor = line("l2", "power", [{ x: 5000, y: 0 }, { x: 5000, y: 1000 }]);
    plan.lines = [line("l1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }]), survivor];
    const result = executeGeometryCommand(plan, { type: "itemLine.bulkDelete", itemIds: [], lineIds: ["l1"] }, { makeId: ids() });
    const found = result.plan.lines.find((l) => l.id === "l2");
    expect(found).toBeTruthy();
    expect(found.layer).toBe(survivor.layer);
  });

  it("surviving item's derived pipe connections no longer reference a deleted line deleted in the same combined command", () => {
    const plan = basePlan();
    plan.items = [tank("t1", 0, 0)];
    plan.lines = [line("l1", "drain", [{ x: 500, y: 0 }, { x: 500, y: -2000 }])];
    const before = pipesMod.syncPlanPipes(plan);
    expect((before.items.find((it) => it.id === "t1").connections || []).some((c) => c.pipeId === "l1")).toBe(true);

    const result = executeGeometryCommand(plan, { type: "itemLine.bulkDelete", itemIds: [], lineIds: ["l1"] }, { makeId: ids() });
    const afterConn = result.plan.items.find((it) => it.id === "t1").connections || [];
    expect(afterConn.some((c) => c.pipeId === "l1")).toBe(false);
  });

  it("runs syncClimatePlan/syncElectricalPlan/syncPlanPipes exactly once per combined command", () => {
    const climateSpy = vi.spyOn(climateMod, "syncClimatePlan");
    const electricalSpy = vi.spyOn(electricalMod, "syncElectricalPlan");
    const pipesSpy = vi.spyOn(pipesMod, "syncPlanPipes");
    climateSpy.mockClear();
    electricalSpy.mockClear();
    pipesSpy.mockClear();

    const plan = basePlan();
    plan.items = [rack("r1", 0, 0), rack("r2", 2000, 0)];
    plan.lines = [line("l1", "power", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const result = executeGeometryCommand(plan, { type: "itemLine.bulkDelete", itemIds: ["r1"], lineIds: ["l1"] }, { makeId: ids() });

    expect(result.ok).toBe(true);
    expect(climateSpy).toHaveBeenCalledTimes(1);
    expect(electricalSpy).toHaveBeenCalledTimes(1);
    expect(pipesSpy).toHaveBeenCalledTimes(1);
    climateSpy.mockRestore();
    electricalSpy.mockRestore();
    pipesSpy.mockRestore();
  });

  it("no engineering sync runs when the command is rejected (all missing)", () => {
    const climateSpy = vi.spyOn(climateMod, "syncClimatePlan");
    const electricalSpy = vi.spyOn(electricalMod, "syncElectricalPlan");
    const pipesSpy = vi.spyOn(pipesMod, "syncPlanPipes");
    climateSpy.mockClear();
    electricalSpy.mockClear();
    pipesSpy.mockClear();

    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)];
    plan.lines = [line("l1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const result = executeGeometryCommand(
      plan,
      { type: "itemLine.bulkDelete", itemIds: ["missing"], lineIds: ["missing"] },
      { makeId: ids() },
    );

    expect(result.ok).toBe(false);
    expect(climateSpy).not.toHaveBeenCalled();
    expect(electricalSpy).not.toHaveBeenCalled();
    expect(pipesSpy).not.toHaveBeenCalled();
    climateSpy.mockRestore();
    electricalSpy.mockRestore();
    pipesSpy.mockRestore();
  });

  it("surviving item keeps its identity/placement fields unchanged", () => {
    const plan = basePlan();
    const survivor = rack("r2", 2000, 500, { w: 1220, h: 600 });
    plan.items = [rack("r1", 0, 0), survivor];
    plan.lines = [line("l1", "power", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const result = executeGeometryCommand(plan, { type: "itemLine.bulkDelete", itemIds: ["r1"], lineIds: ["l1"] }, { makeId: ids() });
    const after = result.plan.items.find((it) => it.id === "r2");
    expect(after.id).toBe(survivor.id);
    expect(after.kind).toBe(survivor.kind);
    expect(after.layer).toBe(survivor.layer);
    expect(after.x).toBe(survivor.x);
    expect(after.y).toBe(survivor.y);
    expect(after.w).toBe(survivor.w);
    expect(after.h).toBe(survivor.h);
  });

  it("walls/nodes are never changed by the combined command", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)];
    plan.lines = [line("l1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const result = executeGeometryCommand(plan, { type: "itemLine.bulkDelete", itemIds: ["r1"], lineIds: ["l1"] }, { makeId: ids() });
    expect(result.plan.walls).toEqual(plan.walls);
    expect(result.plan.nodes).toEqual(plan.nodes);
    expect(result.entityChanges.deleted.walls).toEqual([]);
    expect(result.entityChanges.deleted.nodes).toEqual([]);
  });
});

// ── entityChanges contract ────────────────────────────────────────────────

describe("PHASE 1A-2C2D3E4C — entityChanges contract", () => {
  it("exhaustive full typed shape: deleted items/lines/links/dimensions, changed manual dimensions, no duplicates/overlap, no metadata inside result.plan", () => {
    const plan = basePlan();
    plan.items = [
      rack("r1", 0, 0, { w: 1220, h: 600 }),
      rack("r2", 2000, 0),
    ];
    plan.lines = [
      line("l1", "power", [{ x: 0, y: 0 }, { x: 1000, y: 0 }]),
      line("l2", "power", [{ x: 5000, y: 0 }, { x: 6000, y: 0 }]), // survives
    ];
    plan.links = [
      { id: "lk1", type: "power", fromId: "r1", toId: "r2" }, // dangling (r1 deleted)
    ];
    plan.dimensions = [
      { id: "auto1", auto: true, attachedTo: { type: "item", id: "r1" } },
      {
        id: "manual1", auto: false, kind: "manual", p1: { x: 1, y: 1 }, p2: { x: 2, y: 2 }, attachedTo: { type: "item", id: "r1", mode: "bbox-width" },
      },
    ];
    const result = executeGeometryCommand(plan, { type: "itemLine.bulkDelete", itemIds: ["r1"], lineIds: ["l1"] }, { makeId: ids() });

    expect(result.ok).toBe(true);
    expect(result.entityChanges.deleted.items).toEqual(["r1"]);
    expect(result.entityChanges.deleted.lines).toEqual(["l1"]);
    expect(result.entityChanges.deleted.links).toEqual(["lk1"]);
    expect(result.entityChanges.deleted.dimensions).toEqual(["auto1"]);
    expect(result.entityChanges.changed.dimensions).toEqual(["manual1"]);
    expect(result.entityChanges.created).toEqual(FULL_EMPTY_BUCKET);
    expect(result.entityChanges.changed.walls).toEqual([]);
    expect(result.entityChanges.changed.nodes).toEqual([]);
    expect(result.entityChanges.changed.items).toEqual([]);
    expect(result.entityChanges.changed.lines).toEqual([]);
    expect(result.entityChanges.changed.links).toEqual([]);
    expect(result.entityChanges.deleted.walls).toEqual([]);
    expect(result.entityChanges.deleted.nodes).toEqual([]);

    for (const bucket of ["created", "changed", "deleted"]) {
      const flat = Object.values(result.entityChanges[bucket]).flat();
      expect(flat.length).toBe(new Set(flat).size);
    }
    for (const kind of ["walls", "nodes", "items", "dimensions", "links", "lines"]) {
      const overlap = result.entityChanges.changed[kind].filter((id) => result.entityChanges.deleted[kind].includes(id));
      expect(overlap).toEqual([]);
    }
    const flatDeleted = Object.values(result.entityChanges.deleted).flat();
    const flatChanged = Object.values(result.entityChanges.changed).flat();
    expect(new Set(result.deletedEntityIds)).toEqual(new Set(flatDeleted));
    expect(new Set(result.changedEntityIds)).toEqual(new Set(flatChanged));
    expect(result.plan).not.toHaveProperty("entityChanges");
    expect(result.plan).not.toHaveProperty("warnings");

    const diagnostics = validatePlanIntegrity(result.plan).diagnostics.filter((d) => d.severity === "error");
    expect(diagnostics).toEqual([]);
  });

  it("missing IDs are omitted from entityChanges (no stray entries)", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)];
    plan.lines = [line("l1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const result = executeGeometryCommand(
      plan,
      { type: "itemLine.bulkDelete", itemIds: ["r1", "missing-item"], lineIds: ["l1", "missing-line"] },
      { makeId: ids() },
    );
    expect(result.entityChanges.deleted.items).toEqual(["r1"]);
    expect(result.entityChanges.deleted.lines).toEqual(["l1"]);
  });
});

// ── history / dispatcher ──────────────────────────────────────────────────

describe("PHASE 1A-2C2D3E4C — history matrix", () => {
  it("mixed item+line: 1 command, 1 checkpoint", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)];
    plan.lines = [line("l1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const h = makeHarness(plan);
    const { status } = applyItemLineBulkDelete({ itemIds: ["r1"], lineIds: ["l1"], runGeometryCommand: h.dispatcher });
    expect(status).toBe("success");
    expect(h.commitPlan).toHaveBeenCalledTimes(1);
    expect(h.history.current.items).toEqual([]);
    expect(h.history.current.lines).toEqual([]);
  });

  it("items-only: 1 command, 1 checkpoint", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)];
    const h = makeHarness(plan);
    const { status } = applyItemLineBulkDelete({ itemIds: ["r1"], lineIds: [], runGeometryCommand: h.dispatcher });
    expect(status).toBe("success");
    expect(h.commitPlan).toHaveBeenCalledTimes(1);
    expect(h.history.current.items).toEqual([]);
  });

  it("lines-only: 1 command, 1 checkpoint", () => {
    const plan = basePlan();
    plan.lines = [line("l1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const h = makeHarness(plan);
    const { status } = applyItemLineBulkDelete({ itemIds: [], lineIds: ["l1"], runGeometryCommand: h.dispatcher });
    expect(status).toBe("success");
    expect(h.commitPlan).toHaveBeenCalledTimes(1);
    expect(h.history.current.lines).toEqual([]);
  });

  it("all missing: 0 checkpoints, original plan retained", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)];
    const h = makeHarness(plan);
    const before = h.history.current;
    const { status } = applyItemLineBulkDelete({ itemIds: ["missing"], lineIds: ["missing"], runGeometryCommand: h.dispatcher });
    expect(status).toBe("no-target");
    expect(h.commitPlan).not.toHaveBeenCalled();
    expect(h.history.current).toBe(before);
  });

  it("duplicate clear: 2 dispatch attempts total, exactly 1 checkpoint", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)];
    const h = makeHarness(plan);
    const first = applyItemLineBulkDelete({ itemIds: ["r1"], lineIds: [], runGeometryCommand: h.dispatcher });
    const second = applyItemLineBulkDelete({ itemIds: ["r1"], lineIds: [], runGeometryCommand: h.dispatcher });
    expect(first.status).toBe("success");
    expect(second.status).toBe("no-target");
    expect(h.commitPlan).toHaveBeenCalledTimes(1);
  });

  it("commit failure: 0 checkpoints, original plan retained", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)];
    const commitPlan = vi.fn(() => { throw new Error("commit failed"); });
    const h = makeHarness(plan, { commitPlan });
    const before = h.history.current;
    const { status } = applyItemLineBulkDelete({ itemIds: ["r1"], lineIds: [], runGeometryCommand: h.dispatcher });
    expect(status).toBe("commit-failed");
    expect(h.history.current).toBe(before);
  });

  it("a room-sync engine exception still reports ok:true with a ROOM_DETECTION_FAILED diagnostic, and still one checkpoint", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)];
    plan.lines = [line("l1", "drain", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const throwingRoomSyncFn = () => { throw new Error("controlled room-engine failure"); };
    const result = executeGeometryCommand(
      plan,
      { type: "itemLine.bulkDelete", itemIds: ["r1"], lineIds: ["l1"] },
      { makeId: ids(), roomSyncFn: throwingRoomSyncFn },
    );
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.diagnostics?.[0]?.code).toBe(ROOM_DETECTION_FAILED);
  });

  it("undo returns the exact original plan reference; redo restores the exact committed reference (not recomputed)", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0), rack("r2", 2000, 0)];
    plan.lines = [line("l1", "power", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    plan.links = [{ id: "lk1", type: "power", fromId: "r1", toId: "r2" }];
    const h = makeHarness(plan);
    const original = h.history.current;
    applyItemLineBulkDelete({ itemIds: ["r1"], lineIds: ["l1"], runGeometryCommand: h.dispatcher });
    const committed = h.history.current;
    expect(committed).not.toBe(original);

    h.history.undo();
    expect(h.history.current).toBe(original);
    expect(h.history.current.items.map((it) => it.id)).toEqual(["r1", "r2"]);
    expect(h.history.current.lines.map((l) => l.id)).toEqual(["l1"]);
    expect(h.history.current.links).toEqual([{ id: "lk1", type: "power", fromId: "r1", toId: "r2" }]);

    const climateSpy = vi.spyOn(climateMod, "syncClimatePlan");
    climateSpy.mockClear();
    h.history.redo();
    expect(h.history.current).toBe(committed);
    expect(h.history.current.items.map((it) => it.id)).toEqual(["r2"]);
    expect(h.history.current.lines).toEqual([]);
    expect(climateSpy).not.toHaveBeenCalled();
    climateSpy.mockRestore();
  });
});

// ── leaf helper ────────────────────────────────────────────────────────────

describe("PHASE 1A-2C2D3E4C — applyItemLineBulkDelete orchestration", () => {
  it("both empty/missing never calls the dispatcher", () => {
    const runGeometryCommand = vi.fn();
    expect(applyItemLineBulkDelete({ itemIds: [], lineIds: [], runGeometryCommand })).toEqual({ status: "no-target", result: null });
    expect(applyItemLineBulkDelete({ itemIds: null, lineIds: null, runGeometryCommand })).toEqual({ status: "no-target", result: null });
    expect(runGeometryCommand).not.toHaveBeenCalled();
  });

  it("items-only dispatches exactly one command with the expected payload", () => {
    const runGeometryCommand = vi.fn(() => ({ ok: true, changed: true }));
    const { status } = applyItemLineBulkDelete({ itemIds: ["a"], lineIds: [], runGeometryCommand });
    expect(status).toBe("success");
    expect(runGeometryCommand).toHaveBeenCalledTimes(1);
    expect(runGeometryCommand).toHaveBeenCalledWith({ type: "itemLine.bulkDelete", itemIds: ["a"], lineIds: [] });
  });

  it("lines-only dispatches exactly one command with the expected payload", () => {
    const runGeometryCommand = vi.fn(() => ({ ok: true, changed: true }));
    const { status } = applyItemLineBulkDelete({ itemIds: [], lineIds: ["b"], runGeometryCommand });
    expect(status).toBe("success");
    expect(runGeometryCommand).toHaveBeenCalledTimes(1);
    expect(runGeometryCommand).toHaveBeenCalledWith({ type: "itemLine.bulkDelete", itemIds: [], lineIds: ["b"] });
  });

  it("mixed input dispatches exactly one command with the expected payload", () => {
    const runGeometryCommand = vi.fn(() => ({ ok: true, changed: true }));
    const { status } = applyItemLineBulkDelete({ itemIds: ["a"], lineIds: ["b"], runGeometryCommand });
    expect(status).toBe("success");
    expect(runGeometryCommand).toHaveBeenCalledTimes(1);
    expect(runGeometryCommand).toHaveBeenCalledWith({ type: "itemLine.bulkDelete", itemIds: ["a"], lineIds: ["b"] });
  });

  it("IDs that don't exist in the plan classify as no-target", () => {
    const runGeometryCommand = vi.fn(() => ({ ok: false, error: { code: "GEOMETRY_COMMAND_NO_TARGET" } }));
    expect(applyItemLineBulkDelete({ itemIds: ["missing"], lineIds: [], runGeometryCommand }).status).toBe("no-target");
  });

  it("a commit failure classifies distinctly as commit-failed", () => {
    const runGeometryCommand = vi.fn(() => ({ ok: false, error: { code: "GEOMETRY_COMMAND_COMMIT_FAILED" } }));
    expect(applyItemLineBulkDelete({ itemIds: ["a"], lineIds: [], runGeometryCommand }).status).toBe("commit-failed");
  });

  it("an unexpected dispatcher exception (null result) classifies as geometry-rejected", () => {
    const runGeometryCommand = vi.fn(() => null);
    expect(applyItemLineBulkDelete({ itemIds: ["a"], lineIds: [], runGeometryCommand }).status).toBe("geometry-rejected");
  });
});

// ── REQUIRED FIX F-01 — omitted vs malformed collection handling ─────────
//
// Prior bug: applyItemLineBulkDelete used `Array.isArray(value) ? value : []`
// for BOTH fields, so an explicitly-passed-but-malformed collection (a bare
// string/number/object/null/boolean instead of an array — a realistic
// caller bug, e.g. forgetting to wrap a single dragged-item ID in an array)
// was silently coerced to [] and the operation proceeded as a PARTIAL
// delete of the other, valid collection, reporting status:"success" —
// masking the caller's mistake instead of rejecting it. Only a genuinely
// OMITTED (undefined) field should default to [].

describe("PHASE 1A-2C2D3E4C REQUIRED FIX F-01 — omitted vs malformed collection handling", () => {
  it("omitted lineIds (undefined) + valid itemIds: dispatches once, lineIds normalized to []", () => {
    const runGeometryCommand = vi.fn(() => ({ ok: true, changed: true }));
    const { status } = applyItemLineBulkDelete({ itemIds: ["i1"], runGeometryCommand });
    expect(status).toBe("success");
    expect(runGeometryCommand).toHaveBeenCalledTimes(1);
    expect(runGeometryCommand).toHaveBeenCalledWith({ type: "itemLine.bulkDelete", itemIds: ["i1"], lineIds: [] });
  });

  it("omitted itemIds (undefined) + valid lineIds: dispatches once, itemIds normalized to []", () => {
    const runGeometryCommand = vi.fn(() => ({ ok: true, changed: true }));
    const { status } = applyItemLineBulkDelete({ lineIds: ["l1"], runGeometryCommand });
    expect(status).toBe("success");
    expect(runGeometryCommand).toHaveBeenCalledTimes(1);
    expect(runGeometryCommand).toHaveBeenCalledWith({ type: "itemLine.bulkDelete", itemIds: [], lineIds: ["l1"] });
  });

  it("malformed string itemIds + valid non-empty lineIds: no-target, zero dispatcher calls (does NOT silently delete only the lines)", () => {
    const runGeometryCommand = vi.fn();
    const result = applyItemLineBulkDelete({ itemIds: "i1", lineIds: ["l1"], runGeometryCommand });
    expect(result).toEqual({ status: "no-target", result: null });
    expect(runGeometryCommand).not.toHaveBeenCalled();
  });

  it("valid non-empty itemIds + malformed string lineIds: no-target, zero dispatcher calls (does NOT silently delete only the items)", () => {
    const runGeometryCommand = vi.fn();
    const result = applyItemLineBulkDelete({ itemIds: ["i1"], lineIds: "l1", runGeometryCommand });
    expect(result).toEqual({ status: "no-target", result: null });
    expect(runGeometryCommand).not.toHaveBeenCalled();
  });

  it("null itemIds + valid lineIds: zero dispatcher calls (null is not the same as omitted/undefined)", () => {
    const runGeometryCommand = vi.fn();
    applyItemLineBulkDelete({ itemIds: null, lineIds: ["l1"], runGeometryCommand });
    expect(runGeometryCommand).not.toHaveBeenCalled();
  });

  it("valid itemIds + object lineIds: zero dispatcher calls", () => {
    const runGeometryCommand = vi.fn();
    applyItemLineBulkDelete({ itemIds: ["i1"], lineIds: {}, runGeometryCommand });
    expect(runGeometryCommand).not.toHaveBeenCalled();
  });

  it("both malformed (number itemIds, boolean lineIds): zero dispatcher calls", () => {
    const runGeometryCommand = vi.fn();
    applyItemLineBulkDelete({ itemIds: 1, lineIds: true, runGeometryCommand });
    expect(runGeometryCommand).not.toHaveBeenCalled();
  });

  it("does not mutate the input arrays while normalizing", () => {
    const runGeometryCommand = vi.fn(() => ({ ok: true, changed: true }));
    const itemIds = Object.freeze(["i1"]);
    applyItemLineBulkDelete({ itemIds, runGeometryCommand });
    expect(itemIds).toEqual(["i1"]);
  });
});
