/**
 * PHASE 1A-2C2D2 — atomic multi-wall delete (wall.bulkDelete), exercised
 * against the real geometry command dispatcher (real HistoryModel, real
 * createGeometryCommandDispatcher, real executeGeometryCommand, real
 * wall.bulkDelete via the shared deleteWallsFromPlan helper) — no mocks of
 * the command layer itself.
 *
 * The critical property this file exists to prove: bulk deletion must
 * compute the FINAL surviving wall set once and resolve every mounted item
 * against it directly — never by looping wall.delete once per wall, which
 * would let an opening "hop" through an intermediate wall that is also being
 * deleted in the same call, producing an order-dependent result (see
 * "order independence [CRITICAL]" below).
 *
 * Import-order fragility: same class as the rest of the command-layer test
 * suite — wallGeometry.js warmed up first in beforeAll.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";

let executeGeometryCommand;
let createGeometryCommandDispatcher;
let HistoryModel;
let validatePlanIntegrity;
let applyWallBulkDelete;

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

  const applyMod = await import("../src/planner/ui/applyWallBulkDelete.js");
  applyWallBulkDelete = applyMod.applyWallBulkDelete;
});

// ── fixtures ─────────────────────────────────────────────────────────────

function ids(prefix = "id") {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function door(id, wallId, center, extra = {}) {
  const w = extra.w || 600;
  const h = extra.h || 100;
  return { id, kind: "door", x: center.x - w / 2, y: center.y - h / 2, w, h, wallId, ...extra };
}

/**
 * Rectangle of 5 outer walls (o1 split at n5) + 2 partition walls:
 * p1 (n5-n6) shares n5 with the outer boundary; p2 (n7-n8) is fully interior
 * (no shared nodes with anything) — covers "shared node preserved" and
 * "orphan node pruned" in one fixture.
 */
function partitionsPlan() {
  return {
    room: { w: 6000, h: 4000 },
    nodes: {
      n1: { x: 0, y: 0 },
      n2: { x: 4000, y: 0 },
      n3: { x: 4000, y: 3000 },
      n4: { x: 0, y: 3000 },
      n5: { x: 2000, y: 0 },
      n6: { x: 2000, y: 3000 },
      n7: { x: 3000, y: 1500 },
      n8: { x: 1000, y: 1500 },
    },
    walls: [
      { id: "o1a", a: "n1", b: "n5", thk: 200, role: "outer" },
      { id: "o1b", a: "n5", b: "n2", thk: 200, role: "outer" },
      { id: "o2", a: "n2", b: "n3", thk: 200, role: "outer" },
      { id: "o3", a: "n3", b: "n4", thk: 200, role: "outer" },
      { id: "o4", a: "n4", b: "n1", thk: 200, role: "outer" },
      { id: "p1", a: "n5", b: "n6", thk: 100, role: "partition" },
      { id: "p2", a: "n7", b: "n8", thk: 100, role: "partition" },
    ],
    items: [],
    dimensions: [],
    rooms: [],
    zones: [],
    links: [],
  };
}

function partitionWallIds(plan) {
  return plan.walls.filter((w) => w.role !== "outer").map((w) => w.id);
}

/**
 * Order-independence fixture (PHASE 1A-2C2D2 §16):
 * wallA: na(0,0)-nb(3000,0); wallB: nb(3000,0)-nc(3000,3000) [shares nb with A].
 * Both A and B are deleted in the same call. An opening starts on A near the
 * shared corner (2950,0) — 50mm from B's line, so a NAIVE per-wall loop
 * (delete A first) would reattach it onto B at (3000,0) before B is itself
 * deleted next.
 */
function orderIndependencePlan(extraWalls = [], extraNodes = {}) {
  return {
    room: { w: 8000, h: 6000 },
    nodes: { na: { x: 0, y: 0 }, nb: { x: 3000, y: 0 }, nc: { x: 3000, y: 3000 }, ...extraNodes },
    walls: [
      { id: "wallA", a: "na", b: "nb", thk: 100 },
      { id: "wallB", a: "nb", b: "nc", thk: 100 },
      ...extraWalls,
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
  return { history, dispatcher, commitPlan, setSelection, setRuntimeDiagnostic, showMessage, roomSyncFn };
}

// ── applyWallBulkDelete orchestration ───────────────────────────────────────

describe("PHASE 1A-2C2D2 — applyWallBulkDelete orchestration", () => {
  it("empty/missing wallIds never calls the dispatcher", () => {
    const spy = vi.fn();
    expect(applyWallBulkDelete({ wallIds: [], runGeometryCommand: spy }).status).toBe("no-target");
    expect(applyWallBulkDelete({ wallIds: null, runGeometryCommand: spy }).status).toBe("no-target");
    expect(applyWallBulkDelete({ runGeometryCommand: spy }).status).toBe("no-target");
    expect(spy).not.toHaveBeenCalled();
  });

  it("a valid wallIds array dispatches exactly one wall.bulkDelete command", () => {
    const plan = partitionsPlan();
    const wallIds = partitionWallIds(plan);
    const { dispatcher, history } = makeHarness(plan);
    const spy = vi.fn(dispatcher);
    const result = applyWallBulkDelete({ wallIds, runGeometryCommand: spy });
    expect(result.status).toBe("success");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ type: "wall.bulkDelete", wallIds });
    expect(history.past.length).toBe(1);
  });

  it("wallIds that don't exist in the plan classify as no-target", () => {
    const plan = partitionsPlan();
    const { dispatcher, history } = makeHarness(plan);
    const result = applyWallBulkDelete({ wallIds: ["ghost1", "ghost2"], runGeometryCommand: dispatcher });
    expect(result.status).toBe("no-target");
    expect(history.past.length).toBe(0);
  });

  it("a commit failure classifies distinctly as commit-failed", () => {
    const plan = partitionsPlan();
    const commitPlan = vi.fn(() => { throw new Error("commit failed"); });
    const { dispatcher } = makeHarness(plan, { commitPlan });
    const result = applyWallBulkDelete({ wallIds: partitionWallIds(plan), runGeometryCommand: dispatcher });
    expect(result.status).toBe("commit-failed");
  });

  it("a room-sync diagnostic failure still reports success", () => {
    const plan = partitionsPlan();
    const throwingRoomSyncFn = vi.fn(() => { throw new Error("controlled room-engine failure"); });
    const { dispatcher, history, setRuntimeDiagnostic } = makeHarness(plan, { roomSyncFn: throwingRoomSyncFn });
    const result = applyWallBulkDelete({ wallIds: partitionWallIds(plan), runGeometryCommand: dispatcher });
    expect(result.status).toBe("success");
    expect(history.past.length).toBe(1);
    expect(setRuntimeDiagnostic).toHaveBeenCalled();
  });
});

// ── command-level validation ─────────────────────────────────────────────

describe("PHASE 1A-2C2D2 — wall.bulkDelete command validation", () => {
  it("rejects a non-array wallIds payload", () => {
    const plan = partitionsPlan();
    const result = executeGeometryCommand(plan, { type: "wall.bulkDelete", wallIds: "p1" }, { makeId: ids() });
    expect(result.ok).toBe(false);
  });

  it("rejects an empty array payload", () => {
    const plan = partitionsPlan();
    const result = executeGeometryCommand(plan, { type: "wall.bulkDelete", wallIds: [] }, { makeId: ids() });
    expect(result.ok).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.plan).toBe(plan);
  });

  it("rejects when none of the given wallIds exist", () => {
    const plan = partitionsPlan();
    const result = executeGeometryCommand(plan, { type: "wall.bulkDelete", wallIds: ["ghost1", "ghost2"] }, { makeId: ids() });
    expect(result.ok).toBe(false);
    expect(result.plan).toBe(plan);
  });

  it("partial missing IDs: deletes the existing ones atomically, ignores the missing one", () => {
    const plan = partitionsPlan();
    const result = executeGeometryCommand(plan, { type: "wall.bulkDelete", wallIds: ["p1", "ghost", "p2"] }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.entityChanges.deleted.walls.sort()).toEqual(["p1", "p2"]);
    expect(result.plan.walls.find((w) => w.id === "p1")).toBeUndefined();
    expect(result.plan.walls.find((w) => w.id === "p2")).toBeUndefined();
    expect(result.plan.walls).toHaveLength(5); // 5 outer walls survive
  });

  it("dedupes repeated IDs in the payload (no duplicate processing)", () => {
    const plan = partitionsPlan();
    const result = executeGeometryCommand(plan, { type: "wall.bulkDelete", wallIds: ["p1", "p1", "p2"] }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.entityChanges.deleted.walls.sort()).toEqual(["p1", "p2"]);
  });
});

// ── referential integrity ───────────────────────────────────────────────────

describe("PHASE 1A-2C2D2 — referential integrity", () => {
  it("removes exactly the partition walls, keeps all outer walls, prunes true orphans, preserves the shared node", () => {
    const plan = partitionsPlan();
    const wallIds = partitionWallIds(plan);
    const result = executeGeometryCommand(plan, { type: "wall.bulkDelete", wallIds }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.walls.map((w) => w.id).sort()).toEqual(["o1a", "o1b", "o2", "o3", "o4"]);
    // n5 shared between o1a/o1b (outer) and p1 (deleted) — preserved.
    expect(result.plan.nodes.n5).toEqual({ x: 2000, y: 0 });
    expect(result.plan.walls.find((w) => w.id === "o1a").b).toBe("n5");
    expect(result.plan.walls.find((w) => w.id === "o1b").a).toBe("n5");
    // n6 (only p1), n7/n8 (only p2) — true orphans, pruned.
    expect(Object.keys(result.plan.nodes).sort()).toEqual(["n1", "n2", "n3", "n4", "n5"]);
    expect(result.entityChanges.deleted.nodes.sort()).toEqual(["n6", "n7", "n8"]);
    const diagnostics = validatePlanIntegrity(result.plan).diagnostics.filter((d) => d.severity === "error");
    expect(diagnostics).toEqual([]);
  });

  it("a manual wall-attached dimension on one deleted partition wall detaches with live p1/p2", () => {
    const plan = partitionsPlan();
    plan.dimensions = [{ id: "dm1", p1: { x: 1, y: 1 }, p2: { x: 2, y: 2 }, attachedTo: { type: "wall", wallId: "p1", t0: 0.2, t1: 0.7 } }];
    const result = executeGeometryCommand(plan, { type: "wall.bulkDelete", wallIds: partitionWallIds(plan) }, { makeId: ids() });
    expect(result.ok).toBe(true);
    const dim = result.plan.dimensions.find((d) => d.id === "dm1");
    expect(dim.attachedTo).toBeNull();
    // p1 spans n5(2000,0) to n6(2000,3000): t0=0.2 -> (2000,600); t1=0.7 -> (2000,2100).
    expect(dim.p1).toEqual({ x: 2000, y: 600 });
    expect(dim.p2).toEqual({ x: 2000, y: 2100 });
    expect(result.warnings.some((w) => w.entityId === "dm1" && w.wallId === "p1")).toBe(true);
    expect(result.entityChanges.changed.dimensions).toEqual(["dm1"]);
  });

  it("a reversed-t0/t1 manual dimension on a different deleted partition wall detaches correctly", () => {
    const plan = partitionsPlan();
    plan.dimensions = [{ id: "dm2", p1: { x: 1, y: 1 }, p2: { x: 2, y: 2 }, attachedTo: { type: "wall", wallId: "p2", t0: 0.8, t1: 0.3 } }];
    const result = executeGeometryCommand(plan, { type: "wall.bulkDelete", wallIds: partitionWallIds(plan) }, { makeId: ids() });
    expect(result.ok).toBe(true);
    const dim = result.plan.dimensions.find((d) => d.id === "dm2");
    // p2 spans n7(3000,1500) to n8(1000,1500), length 2000 along x, decreasing.
    expect(dim.attachedTo).toBeNull();
    expect(dim.p1).toEqual({ x: 3000 - 2000 * 0.8, y: 1500 }); // t0=0.8
    expect(dim.p2).toEqual({ x: 3000 - 2000 * 0.3, y: 1500 }); // t1=0.3
  });

  it("persisted auto dimensions on two different deleted partition walls are both deleted, not detached", () => {
    const plan = partitionsPlan();
    plan.dimensions = [
      { id: "auto1", auto: true, attachedTo: { type: "wall", wallId: "p1", t0: 0, t1: 1 } },
      { id: "auto2", auto: true, attachedTo: { type: "wall", wallId: "p2", t0: 0, t1: 1 } },
    ];
    const result = executeGeometryCommand(plan, { type: "wall.bulkDelete", wallIds: partitionWallIds(plan) }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.dimensions).toEqual([]);
    expect(result.entityChanges.deleted.dimensions.sort()).toEqual(["auto1", "auto2"]);
    expect(result.entityChanges.changed.dimensions).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("a malformed persisted auto dimension (missing t0/t1) on a deleted wall is still removed", () => {
    const plan = partitionsPlan();
    plan.dimensions = [{ id: "auto3", auto: true, attachedTo: { type: "wall", wallId: "p1" } }];
    const result = executeGeometryCommand(plan, { type: "wall.bulkDelete", wallIds: partitionWallIds(plan) }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.dimensions).toEqual([]);
    expect(result.entityChanges.deleted.dimensions).toEqual(["auto3"]);
  });

  it("dimensions on surviving outer walls, item-attached dimensions, and free dimensions are all untouched", () => {
    const plan = partitionsPlan();
    plan.dimensions = [
      { id: "outerDim", attachedTo: { type: "wall", wallId: "o1a", t0: 0, t1: 1 } },
      { id: "itemDim", attachedTo: { type: "item", id: "someItem" } },
      { id: "freeDim", p1: { x: 10, y: 10 }, p2: { x: 20, y: 20 }, attachedTo: null },
    ];
    const result = executeGeometryCommand(plan, { type: "wall.bulkDelete", wallIds: partitionWallIds(plan) }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.dimensions).toEqual(plan.dimensions);
    expect(result.entityChanges.changed.dimensions).toEqual([]);
    expect(result.entityChanges.deleted.dimensions).toEqual([]);
  });
});

// ── openings/items — order independence [CRITICAL] ──────────────────────────

describe("PHASE 1A-2C2D2 — openings: order independence [CRITICAL BLOCKER]", () => {
  it("Case C exists: opening reattaches directly to the surviving wall, regardless of payload order/duplicates", () => {
    // C at (3300, y:-200..200) — reachable both from A's original position
    // (2950,0) [dist ~354] and from B's shared-corner position (3000,0)
    // [dist ~300] — a "same answer either way" sanity check.
    const c = { id: "wallC", a: "nd", b: "ne", thk: 100 };
    const orders = [
      ["wallA", "wallB"],
      ["wallB", "wallA"],
      ["wallA", "wallA", "wallB"],
      ["missing", "wallB", "wallA"],
    ];
    const results = orders.map((wallIds) => {
      const plan = orderIndependencePlan([c], { nd: { x: 3300, y: -200 }, ne: { x: 3300, y: 200 } });
      plan.items = [door("d1", "wallA", { x: 2950, y: 0 })];
      return executeGeometryCommand(plan, { type: "wall.bulkDelete", wallIds }, { makeId: ids() });
    });
    for (const result of results) {
      expect(result.ok).toBe(true);
      const item = result.plan.items.find((it) => it.id === "d1");
      expect(item).toBeTruthy();
      expect(item.wallId).toBe("wallC");
      expect(item.wallId).not.toBe("wallB"); // must not remain/end on a wall that is itself deleted
      const diagnostics = validatePlanIntegrity(result.plan).diagnostics.filter((d) => d.entityType === "opening");
      expect(diagnostics).toEqual([]);
    }
    // All four payload variants converge on the exact same committed outcome.
    const [r1, r2, r3, r4] = results;
    for (const r of [r2, r3, r4]) {
      expect(r.plan.items).toEqual(r1.plan.items);
      expect(r.entityChanges.deleted.walls.sort()).toEqual(r1.entityChanges.deleted.walls.sort());
      expect(r.entityChanges.deleted.items.sort()).toEqual(r1.entityChanges.deleted.items.sort());
    }
  });

  it("No reachable survivor: opening is deleted — never left dangling, regardless of payload order/duplicates", () => {
    // C placed far from the A/B corner (well outside placeOnWall's search
    // radius from any position the opening could plausibly occupy) — proves
    // the atomic implementation correctly deletes an unrecoverable opening
    // rather than leaving it dangling, consistently across every payload
    // order/duplicate/missing-ID variant. (The stronger structural guarantee
    // — that the opening can never end up "stuck" on a wall that is itself
    // being deleted — is proven by construction: deleteWallsFromPlan removes
    // ALL delete-set walls from the topology BEFORE any placement search
    // runs, so a deleted wall is never even a candidate; see the "Case C
    // exists" test above, where all 4 payload orders land identically on the
    // true surviving wall and never on wallB.)
    const c = { id: "wallC", a: "nd", b: "ne", thk: 100 };
    const orders = [
      ["wallA", "wallB"],
      ["wallB", "wallA"],
      ["wallA", "wallA", "wallB"],
      ["missing", "wallB", "wallA"],
    ];
    const results = orders.map((wallIds) => {
      const plan = orderIndependencePlan([c], { nd: { x: 6000, y: -200 }, ne: { x: 6000, y: 200 } });
      plan.items = [door("d1", "wallA", { x: 2950, y: 0 })];
      return executeGeometryCommand(plan, { type: "wall.bulkDelete", wallIds }, { makeId: ids() });
    });
    for (const result of results) {
      expect(result.ok).toBe(true);
      expect(result.plan.items.find((it) => it.id === "d1")).toBeUndefined(); // correctly deleted, not hopped onto C
      expect(result.entityChanges.deleted.items).toEqual(["d1"]);
      const diagnostics = validatePlanIntegrity(result.plan).diagnostics.filter((d) => d.entityType === "opening");
      expect(diagnostics).toEqual([]);
    }
    const [r1, r2, r3, r4] = results;
    for (const r of [r2, r3, r4]) {
      expect(r.plan.items).toEqual(r1.plan.items);
      expect(r.entityChanges.deleted.items).toEqual(r1.entityChanges.deleted.items);
    }
  });
});

// ── unrelated mounted-item stability [CORRECTIVE F3] ────────────────────

/**
 * CORRECTIVE PASS F3 fixture: wallA/wallB are deleted together (forces the
 * bulk >1 code path). wallC and wallD are two OTHER surviving partition
 * walls placed only 90mm apart — close enough that placeOnWall's 400mm
 * proximity search (using its existing center+w/2,h/2 offset quirk, see
 * PHASE 1A-2C2D2 order-independence notes) finds wallD nearer than wallC to
 * an item that is actually, correctly, already mounted on wallC. If bulk
 * delete's mounted-item refresh has no filter (scope=null applied globally,
 * as production refreshWallMountedItems does when called with a null
 * wallId), this unrelated item — whose own wallId is never in the delete
 * set — would get silently re-snapped from wallC onto wallD.
 */
function unrelatedItemStabilityPlan() {
  return {
    room: { w: 8000, h: 6000 },
    nodes: {
      na: { x: 0, y: -1000 },
      nb: { x: 2000, y: -1000 },
      ncc: { x: 4000, y: -1000 },
      nc1: { x: 0, y: 0 },
      nc2: { x: 4000, y: 0 },
      nd1: { x: 0, y: 90 },
      nd2: { x: 4000, y: 90 },
    },
    walls: [
      { id: "wallA", a: "na", b: "nb", thk: 100, role: "partition" },
      { id: "wallB", a: "nb", b: "ncc", thk: 100, role: "partition" },
      { id: "wallC", a: "nc1", b: "nc2", thk: 100, role: "partition" },
      { id: "wallD", a: "nd1", b: "nd2", thk: 100, role: "partition" },
    ],
    items: [],
    dimensions: [],
    rooms: [],
    zones: [],
    links: [],
  };
}

describe("PHASE 1A-2C2D2 CORRECTIVE — unrelated mounted-item stability [F3]", () => {
  const PAYLOAD_VARIANTS = [
    ["wallA", "wallB"],
    ["wallB", "wallA"],
    ["wallA", "wallA", "wallB"],
    ["missing", "wallB", "wallA"],
  ];

  function buildScenario() {
    const plan = unrelatedItemStabilityPlan();
    plan.items = [
      // On wallC, already correctly placed (center exactly on wallC's line) —
      // wallC is NOT in the delete set. wallD is 90mm away and, due to the
      // placeOnWall offset quirk, is the NEARER candidate for this item's
      // recomputed search point than wallC itself.
      door("unrelated1", "wallC", { x: 2000, y: 0 }),
      // On wallA, which IS deleted, and far (~1000mm) from any surviving
      // wall — must be dropped as an unrecoverable dangling opening.
      door("affected1", "wallA", { x: 1000, y: -1000 }),
      // Free-standing, not wall-mounted at all.
      { id: "free1", kind: "rack", x: 100, y: 100, w: 200, h: 200 },
    ];
    plan.links = [{ id: "lk1", type: "power", fromId: "unrelated1", toId: "free1" }];
    return plan;
  }

  it("unrelated item on a surviving wall keeps its exact wallId/x/y/angle/wallSeg, across every payload order", () => {
    const results = PAYLOAD_VARIANTS.map((wallIds) => {
      const plan = buildScenario();
      const before = plan.items.find((it) => it.id === "unrelated1");
      const result = executeGeometryCommand(plan, { type: "wall.bulkDelete", wallIds }, { makeId: ids() });
      return { before, result };
    });

    for (const { before, result } of results) {
      expect(result.ok).toBe(true);
      const after = result.plan.items.find((it) => it.id === "unrelated1");
      expect(after).toBeTruthy();
      expect(after.wallId).toBe("wallC");
      expect(after.wallId).not.toBe("wallD"); // must not hop onto the nearby unrelated survivor
      expect(after.x).toBe(before.x);
      expect(after.y).toBe(before.y);
      expect(after.angle).toBe(before.angle);
      expect(after.wallSeg).toEqual(before.wallSeg);
      expect(result.entityChanges.changed.items).not.toContain("unrelated1");
      expect(result.entityChanges.deleted.items).not.toContain("unrelated1");
    }

    const [r1, r2, r3, r4] = results.map((r) => r.result);
    for (const r of [r2, r3, r4]) {
      expect(r.plan.items.find((it) => it.id === "unrelated1")).toEqual(r1.plan.items.find((it) => it.id === "unrelated1"));
    }
  });

  it("free-standing item is completely untouched and never reported as changed", () => {
    for (const wallIds of PAYLOAD_VARIANTS) {
      const plan = buildScenario();
      const before = plan.items.find((it) => it.id === "free1");
      const result = executeGeometryCommand(plan, { type: "wall.bulkDelete", wallIds }, { makeId: ids() });
      expect(result.ok).toBe(true);
      const after = result.plan.items.find((it) => it.id === "free1");
      expect(after).toEqual(before);
      expect(result.entityChanges.changed.items).not.toContain("free1");
      expect(result.entityChanges.deleted.items).not.toContain("free1");
    }
  });

  it("the affected opening on a deleted wall with no reachable survivor is still correctly removed (fix does not disable affected-item cleanup)", () => {
    for (const wallIds of PAYLOAD_VARIANTS) {
      const plan = buildScenario();
      const result = executeGeometryCommand(plan, { type: "wall.bulkDelete", wallIds }, { makeId: ids() });
      expect(result.ok).toBe(true);
      expect(result.plan.items.find((it) => it.id === "affected1")).toBeUndefined();
      expect(result.entityChanges.deleted.items).toContain("affected1");
    }
  });

  it("the unrelated item's link survives; validator reports no errors", () => {
    const plan = buildScenario();
    const result = executeGeometryCommand(plan, { type: "wall.bulkDelete", wallIds: ["wallA", "wallB"] }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.links.map((l) => l.id)).toEqual(["lk1"]);
    const diagnostics = validatePlanIntegrity(result.plan).diagnostics.filter((d) => d.severity === "error");
    expect(diagnostics).toEqual([]);
  });
});

// ── links cleanup ────────────────────────────────────────────────────────

describe("PHASE 1A-2C2D2 — links cleanup for bulk delete", () => {
  it("links referencing items dangling from two different deleted walls are all removed; unrelated/reattached links survive", () => {
    const plan = partitionsPlan();
    plan.items = [
      door("d1", "p1", { x: 2000, y: 1500 }), // isolated on interior p1, no other wall nearby -> dangling
      door("d2", "p2", { x: 2000, y: 1500 }), // isolated on interior p2 -> dangling
      { id: "surv1", kind: "rack", x: 500, y: 500, w: 500, h: 500 },
    ];
    plan.links = [
      { id: "lk1", type: "power", fromId: "d1", toId: "surv1" },
      { id: "lk2", type: "power", fromId: "surv1", toId: "d2" },
      { id: "lk3", type: "power", fromId: "surv1", toId: "surv1" }, // unrelated, must survive
    ];
    const result = executeGeometryCommand(plan, { type: "wall.bulkDelete", wallIds: partitionWallIds(plan) }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.items.find((it) => it.id === "d1")).toBeUndefined();
    expect(result.plan.items.find((it) => it.id === "d2")).toBeUndefined();
    expect(result.plan.links.map((l) => l.id)).toEqual(["lk3"]);
    expect(result.entityChanges.deleted.links.sort()).toEqual(["lk1", "lk2"]);
    const diagnostics = validatePlanIntegrity(result.plan).diagnostics.filter((d) => d.entityType === "link" || d.entityType === "route");
    expect(diagnostics).toEqual([]);
  });
});

// ── entityChanges contract ───────────────────────────────────────────────────

describe("PHASE 1A-2C2D2 — entityChanges contract", () => {
  it("combined scenario: deleted.{walls,nodes,items,dimensions,links} and changed.{items,dimensions}, no duplicates, no plan leak", () => {
    const plan = partitionsPlan();
    plan.items = [
      door("d1", "p1", { x: 2000, y: 1500 }), // dangling
    ];
    plan.dimensions = [
      { id: "manual1", p1: { x: 1, y: 1 }, p2: { x: 2, y: 2 }, attachedTo: { type: "wall", wallId: "p1", t0: 0.1, t1: 0.5 } },
      { id: "auto1", auto: true, attachedTo: { type: "wall", wallId: "p2", t0: 0, t1: 1 } },
    ];
    plan.links = [{ id: "lk1", fromId: "d1", toId: "d1" }];
    const wallIds = partitionWallIds(plan);
    const result = executeGeometryCommand(plan, { type: "wall.bulkDelete", wallIds }, { makeId: ids() });

    expect(result.entityChanges.deleted.walls.sort()).toEqual(["p1", "p2"]);
    expect(result.entityChanges.deleted.nodes.sort()).toEqual(["n6", "n7", "n8"]);
    expect(result.entityChanges.deleted.items).toEqual(["d1"]);
    expect(result.entityChanges.deleted.dimensions).toEqual(["auto1"]);
    expect(result.entityChanges.deleted.links).toEqual(["lk1"]);
    expect(result.entityChanges.changed.dimensions).toEqual(["manual1"]);
    expect(result.entityChanges.changed.items).toEqual([]);
    expect(result.entityChanges.created).toEqual({ walls: [], nodes: [], items: [], dimensions: [], links: [] });

    for (const bucket of ["created", "changed", "deleted"]) {
      const flat = Object.values(result.entityChanges[bucket]).flat();
      expect(flat.length).toBe(new Set(flat).size);
    }
    // No single ID should appear in both changed and deleted of the same kind.
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

// ── history matrix ───────────────────────────────────────────────────────

describe("PHASE 1A-2C2D2 — history matrix", () => {
  it("one partition wall: 1 command, 1 checkpoint, validator clean", () => {
    const plan = partitionsPlan();
    const { dispatcher, history } = makeHarness(plan);
    const result = applyWallBulkDelete({ wallIds: ["p1"], runGeometryCommand: dispatcher });
    expect(result.status).toBe("success");
    expect(history.past.length).toBe(1);
    expect(validatePlanIntegrity(history.current).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("several partitions: 1 command, 1 checkpoint, validator clean", () => {
    const plan = partitionsPlan();
    const { dispatcher, history } = makeHarness(plan);
    const result = applyWallBulkDelete({ wallIds: partitionWallIds(plan), runGeometryCommand: dispatcher });
    expect(result.status).toBe("success");
    expect(history.past.length).toBe(1);
    expect(history.current.walls).toHaveLength(5);
  });

  it("partitions + outer walls in the same payload: only non-outer ones actually get removed (UI is expected to filter, but the command itself is not outer-aware)", () => {
    const plan = partitionsPlan();
    const { dispatcher, history } = makeHarness(plan);
    const result = applyWallBulkDelete({ wallIds: [...partitionWallIds(plan), "o2"], runGeometryCommand: dispatcher });
    expect(result.status).toBe("success");
    expect(history.past.length).toBe(1);
    expect(history.current.walls.map((w) => w.id).sort()).toEqual(["o1a", "o1b", "o3", "o4"]);
  });

  it("no partition walls (empty wallIds): 0 dispatcher calls at the helper level, 0 checkpoints", () => {
    const plan = partitionsPlan();
    const { dispatcher, history } = makeHarness(plan);
    const spy = vi.fn(dispatcher);
    const result = applyWallBulkDelete({ wallIds: [], runGeometryCommand: spy });
    expect(result.status).toBe("no-target");
    expect(spy).not.toHaveBeenCalled();
    expect(history.past.length).toBe(0);
  });

  it("duplicate clear: 2 dispatch attempts total, exactly 1 checkpoint", () => {
    const plan = partitionsPlan();
    const wallIds = partitionWallIds(plan);
    const { dispatcher, history } = makeHarness(plan);
    const spy = vi.fn(dispatcher);
    const first = applyWallBulkDelete({ wallIds, runGeometryCommand: spy });
    expect(first.status).toBe("success");
    const second = applyWallBulkDelete({ wallIds, runGeometryCommand: spy }); // same IDs, now gone
    expect(second.status).toBe("no-target");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(history.past.length).toBe(1);
  });

  it("room diagnostic: 1 command, 1 checkpoint, geometry committed", () => {
    const plan = partitionsPlan();
    const throwingRoomSyncFn = vi.fn(() => { throw new Error("controlled room-engine failure"); });
    const { dispatcher, history } = makeHarness(plan, { roomSyncFn: throwingRoomSyncFn });
    const result = applyWallBulkDelete({ wallIds: partitionWallIds(plan), runGeometryCommand: dispatcher });
    expect(result.status).toBe("success");
    expect(history.past.length).toBe(1);
    expect(history.current.walls).toHaveLength(5);
  });

  it("commit failure: 0 checkpoints, original plan retained", () => {
    const plan = partitionsPlan();
    const commitPlan = vi.fn(() => { throw new Error("commit failed"); });
    const { dispatcher, history } = makeHarness(plan, { commitPlan });
    const result = applyWallBulkDelete({ wallIds: partitionWallIds(plan), runGeometryCommand: dispatcher });
    expect(result.status).toBe("commit-failed");
    expect(history.past.length).toBe(0);
    expect(history.current).toBe(plan);
  });

  it("partial missing IDs: 1 command, 1 checkpoint, validator clean", () => {
    const plan = partitionsPlan();
    const { dispatcher, history } = makeHarness(plan);
    const result = applyWallBulkDelete({ wallIds: ["p1", "ghost", "p2"], runGeometryCommand: dispatcher });
    expect(result.status).toBe("success");
    expect(history.past.length).toBe(1);
    expect(validatePlanIntegrity(history.current).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("undo returns the exact original plan reference; redo restores the exact committed reference (same IDs, same cleanup, not recomputed)", () => {
    const plan = partitionsPlan();
    const { dispatcher, history } = makeHarness(plan);
    const result = applyWallBulkDelete({ wallIds: partitionWallIds(plan), runGeometryCommand: dispatcher });
    expect(result.status).toBe("success");
    const committed = history.current;
    expect(committed).toBe(result.result.plan);

    const afterUndo = history.undo();
    expect(afterUndo).toBe(plan);
    expect(afterUndo.walls).toHaveLength(7); // both partitions back

    const afterRedo = history.redo();
    expect(afterRedo).toBe(committed);
    expect(afterRedo.walls).toHaveLength(5);
  });
});
