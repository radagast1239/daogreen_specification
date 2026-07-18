/**
 * PHASE 1A-2C2D3B — atomic multi-item delete (item.bulkDelete), exercised
 * against the real geometry command dispatcher (real HistoryModel, real
 * createGeometryCommandDispatcher, real executeGeometryCommand, real
 * item.bulkDelete via the shared deleteItemsFromPlan helper) — no mocks of
 * the command layer itself.
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
let applyItemBulkDelete;
let climateMod;
let electricalMod;
let pipesMod;

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

  const applyMod = await import("../src/planner/ui/applyItemBulkDelete.js");
  applyItemBulkDelete = applyMod.applyItemBulkDelete;

  climateMod = await import("../src/planner/climate.js");
  electricalMod = await import("../src/planner/electrical.js");
  pipesMod = await import("../src/planner/pipes.js");
});

// ── fixtures ─────────────────────────────────────────────────────────────

function ids(prefix = "id") {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function rack(id, x, y, extra = {}) {
  return {
    id, kind: "rack", layer: "racks", x, y, w: 1220, h: 600, ...extra,
  };
}

// PHASE 1A-2C2D3D2 — real room-layer catalog kinds (door/window/opening),
// matching catalog.js's actual { layer: "room" } entries, not a generic
// "rack" stand-in — proves item.bulkDelete works for the real room-clear
// item shapes, not just an arbitrary fixture kind.
function roomItem(id, kind, x, y, extra = {}) {
  return {
    id, kind, layer: "room", x, y, w: 900, h: 120, ...extra,
  };
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
    dimensions: [],
    rooms: [],
    zones: [],
    links: [],
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

// ── applyItemBulkDelete orchestration ────────────────────────────────────

describe("PHASE 1A-2C2D3B — applyItemBulkDelete orchestration", () => {
  it("empty/missing itemIds never calls the dispatcher", () => {
    const runGeometryCommand = vi.fn();
    expect(applyItemBulkDelete({ itemIds: [], runGeometryCommand })).toEqual({ status: "no-target", result: null });
    expect(applyItemBulkDelete({ itemIds: null, runGeometryCommand })).toEqual({ status: "no-target", result: null });
    expect(runGeometryCommand).not.toHaveBeenCalled();
  });

  it("a valid itemIds array dispatches exactly one item.bulkDelete command", () => {
    const runGeometryCommand = vi.fn(() => ({ ok: true, changed: true }));
    const { status } = applyItemBulkDelete({ itemIds: ["a", "b"], runGeometryCommand });
    expect(status).toBe("success");
    expect(runGeometryCommand).toHaveBeenCalledTimes(1);
    expect(runGeometryCommand).toHaveBeenCalledWith({ type: "item.bulkDelete", itemIds: ["a", "b"] });
  });

  it("itemIds that don't exist in the plan classify as no-target", () => {
    const runGeometryCommand = vi.fn(() => ({ ok: false, error: { code: "GEOMETRY_COMMAND_NO_TARGET" } }));
    expect(applyItemBulkDelete({ itemIds: ["missing"], runGeometryCommand }).status).toBe("no-target");
  });

  it("a commit failure classifies distinctly as commit-failed", () => {
    const runGeometryCommand = vi.fn(() => ({ ok: false, error: { code: "GEOMETRY_COMMAND_COMMIT_FAILED" } }));
    expect(applyItemBulkDelete({ itemIds: ["a"], runGeometryCommand }).status).toBe("commit-failed");
  });

  it("a room-sync diagnostic failure still reports success", () => {
    const runGeometryCommand = vi.fn(() => ({ ok: true, changed: true }));
    expect(applyItemBulkDelete({ itemIds: ["a"], runGeometryCommand }).status).toBe("success");
  });
});

// ── command validation ───────────────────────────────────────────────────

describe("PHASE 1A-2C2D3B — item.bulkDelete command validation", () => {
  it("rejects a non-array itemIds payload", () => {
    const result = executeGeometryCommand(basePlan(), { type: "item.bulkDelete", itemIds: "not-an-array" }, { makeId: ids() });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("GEOMETRY_COMMAND_INVALID");
  });

  it("rejects an empty array payload", () => {
    const result = executeGeometryCommand(basePlan(), { type: "item.bulkDelete", itemIds: [] }, { makeId: ids() });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("GEOMETRY_COMMAND_INVALID");
  });

  it("all missing IDs -> GEOMETRY_COMMAND_NO_TARGET, original plan reference preserved", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)];
    const result = executeGeometryCommand(plan, { type: "item.bulkDelete", itemIds: ["missing-1", "missing-2"] }, { makeId: ids() });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("GEOMETRY_COMMAND_NO_TARGET");
    expect(result.plan).toBe(plan);
  });

  it("partial missing IDs: deletes the existing ones, ignores the missing one", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0), rack("r2", 2000, 0)];
    const result = executeGeometryCommand(plan, { type: "item.bulkDelete", itemIds: ["r1", "missing"] }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.items.map((it) => it.id)).toEqual(["r2"]);
    expect(result.entityChanges.deleted.items).toEqual(["r1"]);
  });

  it("dedupes repeated IDs in the payload (no duplicate processing)", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)];
    const result = executeGeometryCommand(plan, { type: "item.bulkDelete", itemIds: ["r1", "r1", "r1"] }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.items).toEqual([]);
    expect(result.entityChanges.deleted.items).toEqual(["r1"]);
  });

  it("does not mutate the input itemIds array", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)];
    const payload = ["r1", "r1"];
    const frozen = Object.freeze([...payload]);
    executeGeometryCommand(plan, { type: "item.bulkDelete", itemIds: frozen }, { makeId: ids() });
    expect(frozen).toEqual(["r1", "r1"]);
  });
});

// ── locked items ──────────────────────────────────────────────────────────

describe("PHASE 1A-2C2D3B — locked item behavior preserved", () => {
  it("a locked item is deleted the same as any other when explicitly targeted (locked is a move-guard only, not a delete-guard, matching existing deleteHits behavior)", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0, { locked: true })];
    const result = executeGeometryCommand(plan, { type: "item.bulkDelete", itemIds: ["r1"] }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.items).toEqual([]);
    expect(result.entityChanges.deleted.items).toEqual(["r1"]);
  });
});

// ── links cleanup ─────────────────────────────────────────────────────────

describe("PHASE 1A-2C2D3B — links cleanup", () => {
  it("removes a link whose fromId references a deleted item", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0), rack("r2", 2000, 0)];
    plan.links = [{ id: "lk1", type: "power", fromId: "r1", toId: "r2" }];
    const result = executeGeometryCommand(plan, { type: "item.bulkDelete", itemIds: ["r1"] }, { makeId: ids() });
    expect(result.plan.links).toEqual([]);
    expect(result.entityChanges.deleted.links).toEqual(["lk1"]);
  });

  it("removes a link whose toId references a deleted item", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0), rack("r2", 2000, 0)];
    plan.links = [{ id: "lk1", type: "power", fromId: "r2", toId: "r1" }];
    const result = executeGeometryCommand(plan, { type: "item.bulkDelete", itemIds: ["r1"] }, { makeId: ids() });
    expect(result.plan.links).toEqual([]);
    expect(result.entityChanges.deleted.links).toEqual(["lk1"]);
  });

  it("a link between two items that are BOTH deleted in the same call is removed exactly once", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0), rack("r2", 2000, 0), rack("r3", 4000, 0)];
    plan.links = [{ id: "lk1", type: "power", fromId: "r1", toId: "r2" }];
    const result = executeGeometryCommand(plan, { type: "item.bulkDelete", itemIds: ["r1", "r2"] }, { makeId: ids() });
    expect(result.plan.links).toEqual([]);
    expect(result.entityChanges.deleted.links).toEqual(["lk1"]);
  });

  it("unrelated link is preserved as the exact same reference", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0), rack("r2", 2000, 0), rack("r3", 4000, 0)];
    const unrelated = { id: "lk1", type: "power", fromId: "r2", toId: "r3" };
    plan.links = [unrelated];
    const result = executeGeometryCommand(plan, { type: "item.bulkDelete", itemIds: ["r1"] }, { makeId: ids() });
    expect(result.plan.links).toEqual([unrelated]);
    expect(result.plan.links[0]).toBe(unrelated);
    expect(result.entityChanges.deleted.links).toEqual([]);
  });

  it("multiple links to one deleted item are all removed", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0), rack("r2", 2000, 0), rack("r3", 4000, 0)];
    plan.links = [
      { id: "lk1", type: "power", fromId: "r1", toId: "r2" },
      { id: "lk2", type: "power", fromId: "r3", toId: "r1" },
    ];
    const result = executeGeometryCommand(plan, { type: "item.bulkDelete", itemIds: ["r1"] }, { makeId: ids() });
    expect(result.plan.links).toEqual([]);
    expect(result.entityChanges.deleted.links.sort()).toEqual(["lk1", "lk2"]);
  });
});

// ── item-attached dimensions ─────────────────────────────────────────────

describe("PHASE 1A-2C2D3B — item-attached dimensions", () => {
  it("a persisted auto item-dimension attached to a deleted item is deleted, not detached", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)];
    plan.dimensions = [{
      id: "auto1", auto: true, kind: "opening", p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 }, attachedTo: { type: "item", id: "r1" },
    }];
    const result = executeGeometryCommand(plan, { type: "item.bulkDelete", itemIds: ["r1"] }, { makeId: ids() });
    expect(result.plan.dimensions).toEqual([]);
    expect(result.entityChanges.deleted.dimensions).toEqual(["auto1"]);
    expect(result.entityChanges.changed.dimensions).toEqual([]);
  });

  it("a manual bbox-width dimension attached to a deleted item is detached with live-resolved p1/p2", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 1000, 500, { w: 1220, h: 600 })];
    plan.dimensions = [{
      id: "manual1", auto: false, kind: "manual", p1: { x: 1, y: 1 }, p2: { x: 2, y: 2 }, attachedTo: { type: "item", id: "r1", mode: "bbox-width" },
    }];
    const result = executeGeometryCommand(plan, { type: "item.bulkDelete", itemIds: ["r1"] }, { makeId: ids() });
    const dim = result.plan.dimensions.find((d) => d.id === "manual1");
    expect(dim).toBeTruthy();
    expect(dim.attachedTo).toBeNull();
    expect(dim.kind).toBe("manual");
    expect(dim.auto).toBe(false);
    expect(dim.p1).toEqual({ x: 1000, y: 500 });
    expect(dim.p2).toEqual({ x: 1000 + 1220, y: 500 });
    expect(result.entityChanges.changed.dimensions).toEqual(["manual1"]);
    expect(result.entityChanges.deleted.dimensions).toEqual([]);
    expect(result.warnings.some((w) => w.entityId === "manual1")).toBe(true);
  });

  it("a manual bbox-height dimension attached to a deleted item is detached with live-resolved p1/p2", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 1000, 500, { w: 1220, h: 600 })];
    plan.dimensions = [{
      id: "manual2", auto: false, kind: "manual", p1: { x: 1, y: 1 }, p2: { x: 2, y: 2 }, attachedTo: { type: "item", id: "r1", mode: "bbox-height" },
    }];
    const result = executeGeometryCommand(plan, { type: "item.bulkDelete", itemIds: ["r1"] }, { makeId: ids() });
    const dim = result.plan.dimensions.find((d) => d.id === "manual2");
    expect(dim.attachedTo).toBeNull();
    expect(dim.p1).toEqual({ x: 1000, y: 500 });
    expect(dim.p2).toEqual({ x: 1000, y: 500 + 600 });
    expect(result.entityChanges.changed.dimensions).toEqual(["manual2"]);
  });

  it("dimension on a surviving item is untouched", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0), rack("r2", 2000, 0, { w: 1220, h: 600 })];
    const survivorDim = {
      id: "manual3", auto: false, kind: "manual", p1: { x: 9, y: 9 }, p2: { x: 8, y: 8 }, attachedTo: { type: "item", id: "r2", mode: "bbox-width" },
    };
    plan.dimensions = [survivorDim];
    const result = executeGeometryCommand(plan, { type: "item.bulkDelete", itemIds: ["r1"] }, { makeId: ids() });
    expect(result.plan.dimensions).toEqual([survivorDim]);
    expect(result.plan.dimensions[0]).toBe(survivorDim);
    expect(result.entityChanges.changed.dimensions).toEqual([]);
    expect(result.entityChanges.deleted.dimensions).toEqual([]);
  });

  it("wall-attached dimension is untouched by item deletion", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)];
    const wallDim = {
      id: "wdim1", auto: false, kind: "manual", p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 }, attachedTo: { type: "wall", wallId: "o1", t0: 0, t1: 0.1 },
    };
    plan.dimensions = [wallDim];
    const result = executeGeometryCommand(plan, { type: "item.bulkDelete", itemIds: ["r1"] }, { makeId: ids() });
    expect(result.plan.dimensions).toEqual([wallDim]);
    expect(result.plan.dimensions[0]).toBe(wallDim);
  });

  it("legacy itemId alias on attachedTo is honored the same as id", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)];
    plan.dimensions = [{
      id: "auto2", auto: true, attachedTo: { type: "item", itemId: "r1" },
    }];
    const result = executeGeometryCommand(plan, { type: "item.bulkDelete", itemIds: ["r1"] }, { makeId: ids() });
    expect(result.plan.dimensions).toEqual([]);
    expect(result.entityChanges.deleted.dimensions).toEqual(["auto2"]);
  });

  it("a malformed auto item-dimension attached to a deleted item is still removed", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)];
    plan.dimensions = [{ id: "auto3", auto: true, attachedTo: { type: "item", id: "r1" } }];
    const result = executeGeometryCommand(plan, { type: "item.bulkDelete", itemIds: ["r1"] }, { makeId: ids() });
    expect(result.plan.dimensions).toEqual([]);
  });

  it("a malformed unrelated dimension (bad attachedTo shape, item not deleted) is left as-is, not silently repaired", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0), rack("r2", 2000, 0)];
    const malformed = { id: "bad1", auto: false, attachedTo: { type: "item", id: "does-not-exist" } };
    plan.dimensions = [malformed];
    const result = executeGeometryCommand(plan, { type: "item.bulkDelete", itemIds: ["r1"] }, { makeId: ids() });
    expect(result.plan.dimensions).toEqual([malformed]);
    expect(result.plan.dimensions[0]).toBe(malformed);
  });

  it("free (unattached) dimensions are untouched", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)];
    const free = {
      id: "free1", auto: false, kind: "manual", p1: { x: 0, y: 0 }, p2: { x: 500, y: 0 }, attachedTo: null,
    };
    plan.dimensions = [free];
    const result = executeGeometryCommand(plan, { type: "item.bulkDelete", itemIds: ["r1"] }, { makeId: ids() });
    expect(result.plan.dimensions).toEqual([free]);
    expect(result.plan.dimensions[0]).toBe(free);
  });
});

// ── combined scenario / entityChanges contract ───────────────────────────

describe("PHASE 1A-2C2D3B — combined scenario", () => {
  it("items + links + auto/manual dimensions all cleaned up atomically, no duplicates, no overlap, no plan leak", () => {
    const plan = basePlan();
    plan.items = [
      rack("r1", 0, 0, { w: 1220, h: 600 }),
      rack("r2", 2000, 0),
      rack("r3", 4000, 0),
    ];
    plan.links = [
      { id: "lk1", type: "power", fromId: "r1", toId: "r3" }, // dangling (r1 deleted)
      { id: "lk2", type: "power", fromId: "r2", toId: "r3" }, // unrelated (r2, r3 survive)
    ];
    plan.dimensions = [
      { id: "auto1", auto: true, attachedTo: { type: "item", id: "r1" } },
      {
        id: "manual1", auto: false, kind: "manual", p1: { x: 1, y: 1 }, p2: { x: 2, y: 2 }, attachedTo: { type: "item", id: "r1", mode: "bbox-width" },
      },
    ];
    const result = executeGeometryCommand(plan, { type: "item.bulkDelete", itemIds: ["r1"] }, { makeId: ids() });

    expect(result.ok).toBe(true);
    expect(result.entityChanges.deleted.items).toEqual(["r1"]);
    expect(result.entityChanges.deleted.links).toEqual(["lk1"]);
    expect(result.entityChanges.deleted.dimensions).toEqual(["auto1"]);
    expect(result.entityChanges.changed.dimensions).toEqual(["manual1"]);
    expect(result.entityChanges.created).toEqual({
      walls: [], nodes: [], items: [], dimensions: [], links: [],
    });

    for (const bucket of ["created", "changed", "deleted"]) {
      const flat = Object.values(result.entityChanges[bucket]).flat();
      expect(flat.length).toBe(new Set(flat).size);
    }
    for (const kind of ["walls", "nodes", "items", "dimensions", "links"]) {
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
});

// ── engineering sync exactly once ────────────────────────────────────────

describe("PHASE 1A-2C2D3B — engineering derived sync", () => {
  it("runs syncClimatePlan/syncElectricalPlan/syncPlanPipes exactly once per command", () => {
    const climateSpy = vi.spyOn(climateMod, "syncClimatePlan");
    const electricalSpy = vi.spyOn(electricalMod, "syncElectricalPlan");
    const pipesSpy = vi.spyOn(pipesMod, "syncPlanPipes");
    climateSpy.mockClear();
    electricalSpy.mockClear();
    pipesSpy.mockClear();

    const plan = basePlan();
    plan.items = [rack("r1", 0, 0), rack("r2", 2000, 0)];
    const result = executeGeometryCommand(plan, { type: "item.bulkDelete", itemIds: ["r1"] }, { makeId: ids() });

    expect(result.ok).toBe(true);
    expect(climateSpy).toHaveBeenCalledTimes(1);
    expect(electricalSpy).toHaveBeenCalledTimes(1);
    expect(pipesSpy).toHaveBeenCalledTimes(1);
    climateSpy.mockRestore();
    electricalSpy.mockRestore();
    pipesSpy.mockRestore();
  });

  it("surviving item unrelated to any engineering link keeps its identity/placement fields unchanged", () => {
    const plan = basePlan();
    const survivor = rack("r2", 2000, 500, { w: 1220, h: 600 });
    plan.items = [rack("r1", 0, 0), survivor];
    const result = executeGeometryCommand(plan, { type: "item.bulkDelete", itemIds: ["r1"] }, { makeId: ids() });
    const after = result.plan.items.find((it) => it.id === "r2");
    expect(after).toBeTruthy();
    expect(after.id).toBe(survivor.id);
    expect(after.kind).toBe(survivor.kind);
    expect(after.layer).toBe(survivor.layer);
    expect(after.x).toBe(survivor.x);
    expect(after.y).toBe(survivor.y);
    expect(after.w).toBe(survivor.w);
    expect(after.h).toBe(survivor.h);
  });

  it("deleting an item never changes wall/node topology", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)];
    const result = executeGeometryCommand(plan, { type: "item.bulkDelete", itemIds: ["r1"] }, { makeId: ids() });
    expect(result.plan.walls).toEqual(plan.walls);
    expect(result.plan.nodes).toEqual(plan.nodes);
    expect(result.entityChanges.deleted.walls).toEqual([]);
    expect(result.entityChanges.deleted.nodes).toEqual([]);
  });
});

// ── history matrix ────────────────────────────────────────────────────────

describe("PHASE 1A-2C2D3B — history matrix", () => {
  it("one item: 1 command, 1 checkpoint, validator clean", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)];
    const h = makeHarness(plan);
    const before = h.history.current;
    const { status } = applyItemBulkDelete({ itemIds: ["r1"], runGeometryCommand: h.dispatcher });
    expect(status).toBe("success");
    expect(h.commitPlan).toHaveBeenCalledTimes(1);
    expect(h.history.current).not.toBe(before);
    expect(h.history.current.items).toEqual([]);
    const diagnostics = validatePlanIntegrity(h.history.current).diagnostics.filter((d) => d.severity === "error");
    expect(diagnostics).toEqual([]);
  });

  it("several items: 1 command, 1 checkpoint", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0), rack("r2", 2000, 0), rack("r3", 4000, 0)];
    const h = makeHarness(plan);
    const { status } = applyItemBulkDelete({ itemIds: ["r1", "r2"], runGeometryCommand: h.dispatcher });
    expect(status).toBe("success");
    expect(h.commitPlan).toHaveBeenCalledTimes(1);
    expect(h.history.current.items.map((it) => it.id)).toEqual(["r3"]);
  });

  it("duplicate IDs in one call: 1 command, 1 checkpoint", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)];
    const h = makeHarness(plan);
    const { status } = applyItemBulkDelete({ itemIds: ["r1", "r1"], runGeometryCommand: h.dispatcher });
    expect(status).toBe("success");
    expect(h.commitPlan).toHaveBeenCalledTimes(1);
  });

  it("partial missing: 1 command, 1 checkpoint, validator clean", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)];
    const h = makeHarness(plan);
    const { status } = applyItemBulkDelete({ itemIds: ["r1", "missing"], runGeometryCommand: h.dispatcher });
    expect(status).toBe("success");
    expect(h.commitPlan).toHaveBeenCalledTimes(1);
    const diagnostics = validatePlanIntegrity(h.history.current).diagnostics.filter((d) => d.severity === "error");
    expect(diagnostics).toEqual([]);
  });

  it("all missing: 0 checkpoints, original plan retained", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)];
    const h = makeHarness(plan);
    const before = h.history.current;
    const { status } = applyItemBulkDelete({ itemIds: ["missing-1", "missing-2"], runGeometryCommand: h.dispatcher });
    expect(status).toBe("no-target");
    expect(h.commitPlan).not.toHaveBeenCalled();
    expect(h.history.current).toBe(before);
  });

  it("empty helper input: 0 dispatcher calls, 0 checkpoints", () => {
    const plan = basePlan();
    const h = makeHarness(plan);
    const { status } = applyItemBulkDelete({ itemIds: [], runGeometryCommand: h.dispatcher });
    expect(status).toBe("no-target");
    expect(h.commitPlan).not.toHaveBeenCalled();
  });

  it("duplicate clear: 2 dispatch attempts total, exactly 1 checkpoint", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)];
    const h = makeHarness(plan);
    const first = applyItemBulkDelete({ itemIds: ["r1"], runGeometryCommand: h.dispatcher });
    const second = applyItemBulkDelete({ itemIds: ["r1"], runGeometryCommand: h.dispatcher });
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
    const { status } = applyItemBulkDelete({ itemIds: ["r1"], runGeometryCommand: h.dispatcher });
    expect(status).toBe("commit-failed");
    expect(h.history.current).toBe(before);
  });

  it("clear non-empty layer set (racks): 1 command, 1 checkpoint", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0), rack("r2", 2000, 0)];
    const h = makeHarness(plan);
    const itemIds = plan.items.filter((it) => it.layer === "racks").map((it) => it.id);
    const { status } = applyItemBulkDelete({ itemIds, runGeometryCommand: h.dispatcher });
    expect(status).toBe("success");
    expect(h.commitPlan).toHaveBeenCalledTimes(1);
    expect(h.history.current.items).toEqual([]);
  });

  it("clear empty layer: no-target, 0 checkpoints", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)];
    const h = makeHarness(plan);
    const itemIds = plan.items.filter((it) => it.layer === "water").map((it) => it.id);
    const { status } = applyItemBulkDelete({ itemIds, runGeometryCommand: h.dispatcher });
    expect(status).toBe("no-target");
    expect(h.commitPlan).not.toHaveBeenCalled();
  });

  it("undo returns the exact original plan reference; redo restores the exact committed reference (not recomputed)", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0), rack("r2", 2000, 0)];
    plan.links = [{ id: "lk1", type: "power", fromId: "r1", toId: "r2" }];
    const h = makeHarness(plan);
    const original = h.history.current;
    applyItemBulkDelete({ itemIds: ["r1"], runGeometryCommand: h.dispatcher });
    const committed = h.history.current;
    expect(committed).not.toBe(original);

    h.history.undo();
    expect(h.history.current).toBe(original);
    expect(h.history.current.items.map((it) => it.id)).toEqual(["r1", "r2"]);
    expect(h.history.current.links).toEqual([{ id: "lk1", type: "power", fromId: "r1", toId: "r2" }]);

    h.history.redo();
    expect(h.history.current).toBe(committed);
    expect(h.history.current.items.map((it) => it.id)).toEqual(["r2"]);
    expect(h.history.current.links).toEqual([]);
  });
});

// ── room-layer item kinds [PHASE 1A-2C2D3D2] ─────────────────────────────

describe("PHASE 1A-2C2D3D2 — room-layer item kinds through item.bulkDelete", () => {
  it("a door (layer:\"room\") is deleted the same as any other item", () => {
    const plan = basePlan();
    plan.items = [roomItem("d1", "door", 0, 0)];
    const result = executeGeometryCommand(plan, { type: "item.bulkDelete", itemIds: ["d1"] }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.items).toEqual([]);
    expect(result.entityChanges.deleted.items).toEqual(["d1"]);
  });

  it("a window (layer:\"room\") is deleted the same as any other item", () => {
    const plan = basePlan();
    plan.items = [roomItem("w1", "window", 0, 0)];
    const result = executeGeometryCommand(plan, { type: "item.bulkDelete", itemIds: ["w1"] }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.items).toEqual([]);
    expect(result.entityChanges.deleted.items).toEqual(["w1"]);
  });

  it("a technical opening (opening_tech, layer:\"room\") is deleted the same as any other item", () => {
    const plan = basePlan();
    plan.items = [roomItem("o1", "opening_tech", 0, 0)];
    const result = executeGeometryCommand(plan, { type: "item.bulkDelete", itemIds: ["o1"] }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.items).toEqual([]);
    expect(result.entityChanges.deleted.items).toEqual(["o1"]);
  });

  it("several mixed room kinds (door/window/opening/legacy-unknown) are all deleted atomically in one command", () => {
    const plan = basePlan();
    plan.items = [
      roomItem("d1", "door", 0, 0),
      roomItem("d2", "door_gate", 500, 0),
      roomItem("w1", "window", 1000, 0),
      roomItem("o1", "opening_vent", 1500, 0),
      roomItem("legacy1", "some_future_unknown_kind", 2000, 0),
      rack("survivor", 4000, 4000), // different layer — must NOT be touched
    ];
    const roomIds = plan.items.filter((it) => it.layer === "room").map((it) => it.id);
    const result = executeGeometryCommand(plan, { type: "item.bulkDelete", itemIds: roomIds }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.items.map((it) => it.id)).toEqual(["survivor"]);
    expect(result.entityChanges.deleted.items.sort()).toEqual(["d1", "d2", "legacy1", "o1", "w1"]);
  });

  it("combined: room item with a link, a persisted auto item-dimension, and a manual item-dimension — all cleaned up atomically; walls/nodes unchanged; validator clean; undo/redo exact references", () => {
    const plan = basePlan();
    const door = roomItem("d1", "door", 1000, 500, { w: 900, h: 120 });
    const survivor = { id: "s1", kind: "rack", layer: "racks", x: 4000, y: 4000, w: 500, h: 500 };
    plan.items = [door, survivor];
    plan.links = [{ id: "lk1", type: "power", fromId: "d1", toId: "s1" }];
    plan.dimensions = [
      { id: "auto1", auto: true, kind: "opening", attachedTo: { type: "item", id: "d1" } },
      {
        id: "manual1", auto: false, kind: "manual", p1: { x: 1, y: 1 }, p2: { x: 2, y: 2 }, attachedTo: { type: "item", id: "d1", mode: "bbox-width" },
      },
    ];
    const wallsBefore = plan.walls;
    const nodesBefore = plan.nodes;

    const h = makeHarness(plan);
    const original = h.history.current;
    const { status } = applyItemBulkDelete({ itemIds: ["d1"], runGeometryCommand: h.dispatcher });
    expect(status).toBe("success");

    const committed = h.history.current;
    expect(committed.items.map((it) => it.id)).toEqual(["s1"]);
    expect(committed.links).toEqual([]);
    expect(committed.walls).toEqual(wallsBefore);
    expect(committed.nodes).toEqual(nodesBefore);

    const manualDim = committed.dimensions.find((d) => d.id === "manual1");
    expect(manualDim.attachedTo).toBeNull();
    expect(manualDim.p1).toEqual({ x: 1000, y: 500 });
    expect(manualDim.p2).toEqual({ x: 1000 + 900, y: 500 });
    expect(committed.dimensions.find((d) => d.id === "auto1")).toBeUndefined();

    const diagnostics = validatePlanIntegrity(committed).diagnostics.filter((d) => d.severity === "error");
    expect(diagnostics).toEqual([]);

    h.history.undo();
    expect(h.history.current).toBe(original);
    expect(h.history.current.items.map((it) => it.id)).toEqual(["d1", "s1"]);
    expect(h.history.current.links).toEqual([{ id: "lk1", type: "power", fromId: "d1", toId: "s1" }]);

    h.history.redo();
    expect(h.history.current).toBe(committed);
  });
});
