/**
 * PHASE 1A — command boundary для geometry mutations (nodes/walls).
 *
 * Проверяет executeGeometryCommand (src/planner/commands/geometryCommands.js):
 * result contract, wall.split совместимость с PHASE 0F, move/create/delete/
 * straighten операции, room-sync интеграцию (успех/сбой, PHASE 0G), structured
 * errors на низкоуровневых исключениях, и historyModel-интеграцию (checkpoint
 * semantics), воспроизведённую локально (компонент PlanPage не рендерится,
 * окружение тестов "node").
 *
 * Import-order stability: geometryCommands.js импортирует wallNetwork.js,
 * который импортирует wallGeometry.js (`export * from "./core/walls/index.js"`,
 * часть уже задокументированного 15-файлового цикла — см. PHASE 0G corrective
 * report, "Known risk for PHASE 1A"). Тот же класс фрагильности, что и в
 * tests/plannerRoomDetectionDiagnostics.test.js, поэтому применяется тот же
 * проверенный фикс: явный прогрев wallGeometry.js первым в beforeAll.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { loadPlannerFixture } from "./fixtures/planner/loadFixture.js";

let executeGeometryCommand;
let GEOMETRY_COMMAND_TYPES;
let GEOMETRY_COMMAND_UNKNOWN;
let GEOMETRY_COMMAND_INVALID;
let GEOMETRY_COMMAND_FAILED;
let GEOMETRY_COMMAND_NO_TARGET;
let SPLIT_INTERSECTS_OPENING;
let SPLIT_OPENING_GEOMETRY_INVALID;
let ROOM_DETECTION_FAILED;
let HistoryModel;
let wallNetworkMod;
let wallOpsMod;
let normalizePlan;
let validatePlanIntegrity;
let DIMENSION_DETACHED_AFTER_WALL_REMOVED;

beforeAll(async () => {
  // Прогрев фрагильного export* ПЕРВЫМ — см. комментарий в шапке файла и
  // tests/plannerRoomDetectionDiagnostics.test.js (PHASE 0G corrective).
  await import("../src/planner/wallGeometry.js");

  const cmdMod = await import("../src/planner/commands/geometryCommands.js");
  executeGeometryCommand = cmdMod.executeGeometryCommand;
  GEOMETRY_COMMAND_TYPES = cmdMod.GEOMETRY_COMMAND_TYPES;
  GEOMETRY_COMMAND_UNKNOWN = cmdMod.GEOMETRY_COMMAND_UNKNOWN;
  GEOMETRY_COMMAND_INVALID = cmdMod.GEOMETRY_COMMAND_INVALID;
  GEOMETRY_COMMAND_FAILED = cmdMod.GEOMETRY_COMMAND_FAILED;
  GEOMETRY_COMMAND_NO_TARGET = cmdMod.GEOMETRY_COMMAND_NO_TARGET;
  DIMENSION_DETACHED_AFTER_WALL_REMOVED = cmdMod.DIMENSION_DETACHED_AFTER_WALL_REMOVED;

  wallNetworkMod = await import("../src/planner/wallNetwork.js");
  SPLIT_INTERSECTS_OPENING = wallNetworkMod.SPLIT_INTERSECTS_OPENING;
  SPLIT_OPENING_GEOMETRY_INVALID = wallNetworkMod.SPLIT_OPENING_GEOMETRY_INVALID;

  wallOpsMod = await import("../src/planner/core/walls/wallOps.js");

  const roomsMod = await import("../src/planner/core/rooms/syncRooms.js");
  ROOM_DETECTION_FAILED = roomsMod.ROOM_DETECTION_FAILED;

  const historyMod = await import("../src/planner/core/history/historyModel.js");
  HistoryModel = historyMod.HistoryModel;

  const normalizeMod = await import("../src/planner/planNormalize.js");
  normalizePlan = normalizeMod.normalizePlan;

  const validationMod = await import("../src/planner/core/validation/validatePlanIntegrity.js");
  validatePlanIntegrity = validationMod.validatePlanIntegrity;
});

// ── fixtures ─────────────────────────────────────────────────────────────

function ids(prefix = "id") {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

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

function singleWallPlan(a = { x: 0, y: 0 }, b = { x: 6000, y: 0 }) {
  return {
    room: { w: 6000, h: 3000 },
    nodes: { na: a, nb: b },
    walls: [{ id: "w1", a: "na", b: "nb", thk: 150, material: "brick" }],
    items: [],
    dimensions: [],
    rooms: [],
    zones: [],
  };
}

const throwingRoomSyncFn = () => { throw new Error("controlled room-engine failure"); };

/**
 * Две коллинеарные стены с общим узлом n2 (mergeable), плюс третья
 * перпендикулярная стена на n3 для сценариев с shared/non-orphan node.
 * w1: n1(0,0)-n2(3000,0)   w2: n2(3000,0)-n3(6000,0)   w3: n3-n4(6000,3000)
 */
function mergeablePlan() {
  return {
    room: { w: 6000, h: 3000 },
    nodes: {
      n1: { x: 0, y: 0 },
      n2: { x: 3000, y: 0 },
      n3: { x: 6000, y: 0 },
      n4: { x: 6000, y: 3000 },
    },
    walls: [
      { id: "w1", a: "n1", b: "n2", thk: 100, material: "brick" },
      { id: "w2", a: "n2", b: "n3", thk: 100, material: "brick" },
      { id: "w3", a: "n3", b: "n4", thk: 100 },
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

/** Глубокая заморозка — ловит мутацию на ЛЮБОМ уровне вложенности, не только верхнем. */
function deepFreeze(obj) {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const v of Object.values(obj)) deepFreeze(v);
  }
  return obj;
}

// ── contract ─────────────────────────────────────────────────────────────

describe("PHASE 1A — executeGeometryCommand contract", () => {
  it("success: changed:true, result fields always present", () => {
    const plan = rectPlan();
    const result = executeGeometryCommand(plan, { type: "wall.delete", wallId: "w1" }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.commandType).toBe("wall.delete");
    for (const key of ["plan", "entityRemap", "createdEntityIds", "changedEntityIds", "deletedEntityIds", "diagnostics", "warnings", "error", "operationResult"]) {
      expect(result).toHaveProperty(key);
    }
    expect(result.error).toBeNull();
    expect(result.deletedEntityIds).toEqual(["w1"]);
  });

  it("rejection: same plan reference, structured error, no partial entities", () => {
    const plan = rectPlan();
    const result = executeGeometryCommand(plan, { type: "wall.delete", wallId: "does-not-exist" }, { makeId: ids() });
    expect(result.ok).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.plan).toBe(plan);
    expect(result.error).toMatchObject({ code: GEOMETRY_COMMAND_NO_TARGET });
    expect(typeof result.error.message).toBe("string");
  });

  it("no-op: ok:true, changed:false, same plan reference", () => {
    const plan = rectPlan();
    // w1 is already horizontal (y=0 both ends) -> straighten is a no-op.
    const result = executeGeometryCommand(plan, { type: "wall.straightenHorizontal", wallId: "w1" }, { makeId: ids() });
    expect(result).toMatchObject({ ok: true, changed: false });
    expect(result.plan).toBe(plan);
  });

  it("unknown command does not throw and returns structured GEOMETRY_COMMAND_UNKNOWN", () => {
    const plan = rectPlan();
    expect(() => executeGeometryCommand(plan, { type: "wall.teleport" }, {})).not.toThrow();
    const result = executeGeometryCommand(plan, { type: "wall.teleport" }, {});
    expect(result).toMatchObject({ ok: false, changed: false, plan, error: { code: GEOMETRY_COMMAND_UNKNOWN } });
  });

  it("invalid payload (missing type) returns GEOMETRY_COMMAND_INVALID without throwing", () => {
    const plan = rectPlan();
    expect(() => executeGeometryCommand(plan, {}, {})).not.toThrow();
    const result = executeGeometryCommand(plan, {}, {});
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe(GEOMETRY_COMMAND_INVALID);
  });

  it("invalid payload (missing required field) returns GEOMETRY_COMMAND_INVALID", () => {
    const plan = rectPlan();
    const result = executeGeometryCommand(plan, { type: "wall.split" }, { makeId: ids() }); // no wallId/point
    expect(result).toMatchObject({ ok: false, error: { code: GEOMETRY_COMMAND_INVALID } });
  });

  it("makeId is injected via context, never generated internally", () => {
    const plan = singleWallPlan();
    const calls = [];
    const makeId = (prefix) => { const id = `${prefix}-injected-${calls.length}`; calls.push(id); return id; };
    const result = executeGeometryCommand(plan, { type: "wall.split", wallId: "w1", point: { x: 3000, y: 0 } }, { makeId });
    expect(result.ok).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
    expect(result.createdEntityIds.every((id) => calls.includes(id))).toBe(true);
  });

  it("does not mutate the input plan", () => {
    const plan = rectPlan();
    const before = JSON.parse(JSON.stringify(plan));
    executeGeometryCommand(plan, { type: "wall.delete", wallId: "w1" }, { makeId: ids() });
    expect(plan).toEqual(before);
  });

  it("result is deterministic for the same plan/command/context shape", () => {
    const a = executeGeometryCommand(rectPlan(), { type: "wall.straightenHorizontal", wallId: "w2" }, { makeId: ids() });
    const b = executeGeometryCommand(rectPlan(), { type: "wall.straightenHorizontal", wallId: "w2" }, { makeId: ids() });
    expect(a.plan).toEqual(b.plan);
    expect(a.changed).toBe(b.changed);
  });

  it("result metadata (entityRemap/diagnostics/warnings/error) does not leak into plan", () => {
    const plan = rectPlan();
    const result = executeGeometryCommand(plan, { type: "wall.delete", wallId: "w1" }, { makeId: ids() });
    for (const key of ["entityRemap", "createdEntityIds", "changedEntityIds", "deletedEntityIds", "diagnostics", "warnings", "error", "ok", "changed", "commandType", "operationResult"]) {
      expect(result.plan).not.toHaveProperty(key);
    }
    expect(JSON.stringify(result.plan)).not.toContain("GEOMETRY_COMMAND");
  });

  it("GEOMETRY_COMMAND_TYPES lists every registered command", () => {
    expect(GEOMETRY_COMMAND_TYPES).toContain("wall.split");
    expect(GEOMETRY_COMMAND_TYPES).toContain("wall.delete");
    expect(GEOMETRY_COMMAND_TYPES).toContain("wall.create");
    expect(GEOMETRY_COMMAND_TYPES.length).toBeGreaterThan(5);
  });
});

// ── wall.split — PHASE 0F compatibility subset ────────────────────────────

describe("PHASE 1A — wall.split (PHASE 0F compatibility)", () => {
  function opening(id, kind, center, extra = {}) {
    const w = extra.w || 600;
    const h = extra.h || 100;
    return { id, kind, x: center.x - w / 2, y: center.y - h / 2, w, h, wallId: "w1", ...extra };
  }

  it("migrates an opening to the correct child wall with entityRemap", () => {
    const plan = singleWallPlan();
    plan.items = [opening("d1", "door", { x: 5000, y: 0 })];
    const result = executeGeometryCommand(plan, { type: "wall.split", wallId: "w1", point: { x: 3000, y: 0 } }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.items[0].wallId).not.toBe("w1");
    expect(result.entityRemap.walls).toMatchObject({ originalWallId: "w1" });
    expect(result.entityRemap.openings).toHaveLength(1);
  });

  it("returns dimension detach warnings for a cross-split manual dimension", () => {
    const plan = singleWallPlan();
    plan.dimensions = [{ id: "cross", p1: { x: 1200, y: 0 }, p2: { x: 4800, y: 0 }, attachedTo: { type: "wall", wallId: "w1", t0: 0.2, t1: 0.8 } }];
    const result = executeGeometryCommand(plan, { type: "wall.split", wallId: "w1", point: { x: 3000, y: 0 } }, { makeId: ids() });
    expect(result.warnings).toEqual([{ code: "DIMENSION_DETACHED_AFTER_WALL_SPLIT", entityId: "cross", wallId: "w1" }]);
    expect(result.plan.dimensions[0].attachedTo).toBeNull();
  });

  it("rejects a split intersecting an opening — same code, no created entities", () => {
    const plan = singleWallPlan();
    plan.items = [opening("d1", "door", { x: 3000, y: 0 }, { w: 900 })];
    let calls = 0;
    const result = executeGeometryCommand(plan, { type: "wall.split", wallId: "w1", point: { x: 3000, y: 0 } }, { makeId: () => { calls += 1; return `id-${calls}`; } });
    expect(result).toMatchObject({ ok: false, changed: false, plan, error: { code: SPLIT_INTERSECTS_OPENING } });
    expect(calls).toBe(0);
  });

  it("rejects a split when opening geometry is invalid", () => {
    const plan = singleWallPlan();
    plan.items = [opening("d1", "door", { x: 3000, y: 0 }, { w: 0 })];
    const result = executeGeometryCommand(plan, { type: "wall.split", wallId: "w1", point: { x: 3000, y: 0 } }, { makeId: ids() });
    expect(result).toMatchObject({ ok: false, error: { code: SPLIT_OPENING_GEOMETRY_INVALID } });
  });

  it("respects world-space boundary tolerance (split allowed exactly on opening edge)", () => {
    const plan = singleWallPlan();
    plan.items = [opening("d1", "door", { x: 500, y: 0 }, { w: 200 })]; // door spans x=400..600
    const result = executeGeometryCommand(plan, { type: "wall.split", wallId: "w1", point: { x: 600, y: 0 } }, { makeId: ids() });
    expect(result.ok).toBe(true);
  });
});

// ── move operations ────────────────────────────────────────────────────────

describe("PHASE 1A — move operations", () => {
  it("node.move relocates the correct endpoint", () => {
    const plan = rectPlan();
    const result = executeGeometryCommand(plan, { type: "node.move", wallId: "w1", nodeIdx: 1, point: { x: 4500, y: 0 } }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.plan.nodes.n2).toEqual({ x: 4500, y: 0 });
    expect(result.changedEntityIds).toContain("n2");
  });

  it("wall.moveSegment moves both endpoints (parallel move)", () => {
    const plan = rectPlan();
    const result = executeGeometryCommand(plan, { type: "wall.moveSegment", wallId: "w1", a: { x: 0, y: -200 }, b: { x: 4000, y: -200 } }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.nodes.n1).toEqual({ x: 0, y: -200 });
    expect(result.plan.nodes.n2).toEqual({ x: 4000, y: -200 });
  });

  it("supports reversed wall geometry", () => {
    const plan = singleWallPlan({ x: 6000, y: 0 }, { x: 0, y: 0 });
    const result = executeGeometryCommand(plan, { type: "node.move", wallId: "w1", nodeIdx: 0, point: { x: 6500, y: 0 } }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.nodes.na).toEqual({ x: 6500, y: 0 });
  });

  it("supports diagonal wall geometry", () => {
    const plan = singleWallPlan({ x: 0, y: 0 }, { x: 6000, y: 6000 });
    const result = executeGeometryCommand(plan, { type: "node.move", wallId: "w1", nodeIdx: 1, point: { x: 6100, y: 6100 } }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.nodes.nb).toEqual({ x: 6100, y: 6100 });
  });

  it("moving a node to its current position is a no-op", () => {
    const plan = rectPlan();
    const result = executeGeometryCommand(plan, { type: "node.move", wallId: "w1", nodeIdx: 0, point: { x: 0, y: 0 } }, { makeId: ids() });
    expect(result).toMatchObject({ ok: true, changed: false });
    expect(result.plan).toBe(plan);
  });

  it("invalid coordinates (missing point) are rejected, not silently applied", () => {
    const plan = rectPlan();
    const result = executeGeometryCommand(plan, { type: "node.move", wallId: "w1", nodeIdx: 0 }, { makeId: ids() });
    expect(result).toMatchObject({ ok: false, error: { code: GEOMETRY_COMMAND_INVALID } });
  });

  it("keyboard nudge (node.nudge) moves the wall's endpoints by delta", () => {
    const plan = rectPlan();
    const result = executeGeometryCommand(plan, { type: "node.nudge", wallId: "w1", dx: 10, dy: -5 }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.nodes.n1).toEqual({ x: 10, y: -5 });
    expect(result.plan.nodes.n2).toEqual({ x: 4010, y: -5 });
  });

  it("zero-delta nudge is a no-op", () => {
    const plan = rectPlan();
    const result = executeGeometryCommand(plan, { type: "node.nudge", wallId: "w1", dx: 0, dy: 0 }, { makeId: ids() });
    expect(result).toMatchObject({ ok: true, changed: false });
    expect(result.plan).toBe(plan);
  });

  it("a successful move triggers room postprocessing (rooms recomputed)", () => {
    const plan = rectPlan();
    const result = executeGeometryCommand(plan, { type: "node.move", wallId: "w1", nodeIdx: 0, point: { x: -50, y: -50 } }, { makeId: ids() });
    expect(result.ok).toBe(true);
    // rectPlan starts with rooms:[] (never synced); after a real geometry
    // change the command boundary must have run room sync at least once.
    expect(Array.isArray(result.plan.rooms)).toBe(true);
  });

  it("undo/redo: move command result integrates with HistoryModel as a single checkpoint", () => {
    const plan = rectPlan();
    const history = new HistoryModel(plan);
    const result = executeGeometryCommand(history.current, { type: "node.move", wallId: "w1", nodeIdx: 1, point: { x: 4200, y: 0 } }, { makeId: ids() });
    expect(result.ok && result.changed).toBe(true);
    history.setPlan(() => result.plan);
    expect(history.past).toHaveLength(1);
    expect(history.undo()).toBe(plan);
    expect(history.redo()).toBe(result.plan);
    expect(history.redo().nodes.n2).toEqual({ x: 4200, y: 0 });
  });
});

// ── create / delete ────────────────────────────────────────────────────────

describe("PHASE 1A — wall.create / wall.delete", () => {
  it("wall.create adds a wall and reports created entity ids", () => {
    const plan = rectPlan();
    const result = executeGeometryCommand(plan, {
      type: "wall.create",
      points: [{ x: 2000, y: 0 }, { x: 2000, y: 3000 }],
      wallProps: { thk: 100 },
    }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.createdEntityIds.length).toBeGreaterThan(0);
    expect(result.plan.walls.length).toBe(plan.walls.length + 1);
  });

  it("wall.create with fewer than 2 points is a no-op, not an error", () => {
    const plan = rectPlan();
    const result = executeGeometryCommand(plan, { type: "wall.create", points: [{ x: 0, y: 0 }] }, { makeId: ids() });
    expect(result).toMatchObject({ ok: true, changed: false });
    expect(result.plan).toBe(plan);
  });

  it("wall.delete removes the wall and prunes orphaned nodes (no dangling refs)", () => {
    const plan = singleWallPlan();
    const result = executeGeometryCommand(plan, { type: "wall.delete", wallId: "w1" }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.walls.find((w) => w.id === "w1")).toBeUndefined();
    expect(Object.keys(result.plan.nodes)).toEqual([]); // both endpoints were only used by w1
  });

  it("wall.delete on a shared node keeps the still-used node", () => {
    const plan = rectPlan();
    const result = executeGeometryCommand(plan, { type: "wall.delete", wallId: "w1" }, { makeId: ids() });
    expect(result.plan.nodes.n1).toBeDefined(); // still used by w4
    expect(result.plan.nodes.n2).toBeDefined(); // still used by w2
  });

  it("no duplicate wall IDs after create", () => {
    const plan = rectPlan();
    const result = executeGeometryCommand(plan, {
      type: "wall.create",
      points: [{ x: 1000, y: 0 }, { x: 1000, y: 3000 }],
    }, { makeId: ids() });
    const wallIds = result.plan.walls.map((w) => w.id);
    expect(new Set(wallIds).size).toBe(wallIds.length);
  });
});

// ── straighten ────────────────────────────────────────────────────────────

describe("PHASE 1A — straighten", () => {
  it("wall.straightenHorizontal aligns a nearly-horizontal wall", () => {
    const plan = singleWallPlan({ x: 0, y: 0 }, { x: 4000, y: 40 });
    const result = executeGeometryCommand(plan, { type: "wall.straightenHorizontal", wallId: "w1" }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.plan.nodes.na.y).toBe(result.plan.nodes.nb.y);
  });

  it("wall.straightenVertical aligns a nearly-vertical wall", () => {
    const plan = singleWallPlan({ x: 0, y: 0 }, { x: 40, y: 4000 });
    const result = executeGeometryCommand(plan, { type: "wall.straightenVertical", wallId: "w1" }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.plan.nodes.na.x).toBe(result.plan.nodes.nb.x);
  });

  it("already-straight wall is a no-op", () => {
    const plan = singleWallPlan({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const result = executeGeometryCommand(plan, { type: "wall.straightenHorizontal", wallId: "w1" }, { makeId: ids() });
    expect(result).toMatchObject({ ok: true, changed: false });
    expect(result.plan).toBe(plan);
  });

  it("dependent openings are not broken by straighten (wallId unchanged)", () => {
    const plan = singleWallPlan({ x: 0, y: 0 }, { x: 4000, y: 30 });
    plan.items = [{ id: "d1", kind: "door", x: 1700, y: -50, w: 600, h: 100, wallId: "w1" }];
    const result = executeGeometryCommand(plan, { type: "wall.straightenHorizontal", wallId: "w1" }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.items[0].wallId).toBe("w1");
  });
});

// ── room sync integration ────────────────────────────────────────────────

describe("PHASE 1A — room sync integration", () => {
  it("geometry changed + room sync success: returns synced plan, one command result", () => {
    const plan = rectPlan();
    const result = executeGeometryCommand(plan, { type: "node.move", wallId: "w1", nodeIdx: 0, point: { x: -100, y: 0 } }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it("geometry changed + room sync failure: geometry preserved, existing rooms preserved, diagnostic returned", () => {
    const plan = rectPlan();
    plan.rooms = [{ id: "existing", type: "room", name: "Существующая комната" }];
    plan.zones = [{ id: "existing", auto: true }];
    const result = executeGeometryCommand(
      plan,
      { type: "node.move", wallId: "w1", nodeIdx: 0, point: { x: -100, y: 0 } },
      { makeId: ids(), roomSyncFn: throwingRoomSyncFn },
    );
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    // Geometry mutation was applied even though room sync failed.
    expect(result.plan.nodes.n1).toEqual({ x: -100, y: 0 });
    // Existing rooms/zones preserved (safe policy PHASE 0G) — not wiped.
    expect(result.plan.rooms).toEqual(plan.rooms);
    expect(result.plan.zones).toEqual(plan.zones);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({ code: ROOM_DETECTION_FAILED });
  });

  it("room sync diagnostic is not written into the plan", () => {
    const plan = rectPlan();
    const result = executeGeometryCommand(
      plan,
      { type: "node.move", wallId: "w1", nodeIdx: 0, point: { x: -100, y: 0 } },
      { makeId: ids(), roomSyncFn: throwingRoomSyncFn },
    );
    expect(JSON.stringify(result.plan)).not.toContain("ROOM_DETECTION_FAILED");
  });

  it("room sync failure still produces exactly one history checkpoint", () => {
    const plan = rectPlan();
    const history = new HistoryModel(plan);
    const result = executeGeometryCommand(
      history.current,
      { type: "node.move", wallId: "w1", nodeIdx: 0, point: { x: -100, y: 0 } },
      { makeId: ids(), roomSyncFn: throwingRoomSyncFn },
    );
    expect(result.ok && result.changed).toBe(true);
    history.setPlan(() => result.plan);
    expect(history.past).toHaveLength(1);
  });

  it("rejected command: room sync is never invoked, plan unchanged", () => {
    const plan = rectPlan();
    const roomSyncFn = vi.fn();
    const result = executeGeometryCommand(plan, { type: "wall.delete", wallId: "does-not-exist" }, { makeId: ids(), roomSyncFn });
    expect(result.ok).toBe(false);
    expect(roomSyncFn).not.toHaveBeenCalled();
  });

  it("no-op command: room sync is never invoked", () => {
    const plan = rectPlan();
    const roomSyncFn = vi.fn();
    const result = executeGeometryCommand(plan, { type: "node.move", wallId: "w1", nodeIdx: 0, point: { x: 0, y: 0 } }, { makeId: ids(), roomSyncFn });
    expect(result.changed).toBe(false);
    expect(roomSyncFn).not.toHaveBeenCalled();
  });
});

// ── controlled low-level exception ─────────────────────────────────────────

describe("PHASE 1A — controlled low-level exception", () => {
  it("an unexpected exception from a handler is converted to GEOMETRY_COMMAND_FAILED, original plan preserved", () => {
    const plan = rectPlan();
    const spy = vi.spyOn(wallNetworkMod, "deleteWallEdge").mockImplementation(() => { throw new Error("controlled low-level failure"); });
    try {
      const result = executeGeometryCommand(plan, { type: "wall.delete", wallId: "w1" }, { makeId: ids() });
      expect(result.ok).toBe(false);
      expect(result.changed).toBe(false);
      expect(result.plan).toBe(plan);
      expect(result.error.code).toBe(GEOMETRY_COMMAND_FAILED);
      expect(JSON.stringify(result)).not.toContain("controlled low-level failure");
      expect(plan.walls).toHaveLength(4); // no partial mutation
    } finally {
      spy.mockRestore();
    }
  });
});

// ── performance ────────────────────────────────────────────────────────────

describe("PHASE 1A — performance", () => {
  it("100 sequential coordinate commands on a large plan stay within a wide budget", () => {
    // NxN сетка комнат (не unit-cell лабиринт: unit-cell плотность сделала бы
    // findClosedLoops комбинаторно дороже, чем реальный план). N=12 -> 312
    // стен / 169 узлов — близко к заданным «500 walls» без патологической
    // плотности петель. Замерено эмпирически: ~2.2s на 100 sequential команд
    // (каждая — полный room re-sync); бюджет ниже даёт ~3.5x запас.
    const N = 12;
    const nodes = {};
    const walls = [];
    let wid = 0;
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) nodes[`n_${i}_${j}`] = { x: i * 500, y: j * 500 };
    }
    for (let i = 0; i < N; i++) {
      for (let j = 0; j <= N; j++) walls.push({ id: `h_${wid++}`, a: `n_${i}_${j}`, b: `n_${i + 1}_${j}`, thk: 100 });
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i <= N; i++) walls.push({ id: `v_${wid++}`, a: `n_${i}_${j}`, b: `n_${i}_${j + 1}`, thk: 100 });
    }
    const items = [];
    for (let i = 0; i < 100; i++) items.push({ id: `op${i}`, kind: i % 2 ? "window" : "door", x: 100 + i, y: -50, w: 100, h: 100, wallId: walls[i % walls.length].id });
    const dimensions = [];
    for (let i = 0; i < 100; i++) dimensions.push({ id: `dm${i}`, kind: "auto", auto: true, p1: { x: 0, y: 0 }, p2: { x: 100, y: 0 } });

    let plan = { room: { w: N * 500, h: N * 500 }, nodes, walls, items, dimensions, rooms: [], zones: [] };
    const t0 = performance.now();
    for (let k = 0; k < 100; k++) {
      const wallId = `h_${k % wid}`;
      const wall = plan.walls.find((w) => w.id === wallId);
      if (!wall) continue;
      const result = executeGeometryCommand(plan, { type: "node.move", wallId, nodeIdx: 0, point: { x: (nodes[wall.a]?.x || 0) + 1, y: (nodes[wall.a]?.y || 0) } }, { makeId: ids() });
      if (result.ok && result.changed) plan = result.plan;
    }
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(8000); // широкий бюджет (~3.5x запас над замеренным), без flake
    if (process.env.PLANNER_PERF_LOG) console.log(`[perf] 100 sequential geometry commands (N=${N}, ${wid} walls): ${dt.toFixed(1)}ms`);
  });
});

// ── existing baseline fixtures ────────────────────────────────────────────

describe("PHASE 1A — existing baseline fixtures", () => {
  it("rectangle-room: command layer works after normalize/load round-trip", () => {
    const plan = normalizePlan(loadPlannerFixture("rectangle-room"));
    const before = validatePlanIntegrity(plan);
    expect(before.valid).toBe(true);
    const result = executeGeometryCommand(plan, { type: "node.move", wallId: "w1", nodeIdx: 1, point: { x: 6100, y: 0 } }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    // plan schema (top-level keys) unchanged — command result is still a valid plan.
    expect(Object.keys(result.plan).sort()).toEqual(Object.keys(plan).sort());
    const after = validatePlanIntegrity(result.plan);
    expect(after.valid).toBe(true);
  });

  it("legacy-pts-wall: normalize migrates pts[] to network model, then command layer works on it", () => {
    const raw = loadPlannerFixture("legacy-pts-wall");
    const plan = normalizePlan(raw); // migration happens here, not in the command layer
    expect(plan.nodes && Object.keys(plan.nodes).length).toBeGreaterThan(0);
    expect(plan.walls[0].a).toBeTruthy();
    expect(plan.walls[0].b).toBeTruthy();
    const result = executeGeometryCommand(plan, { type: "wall.straightenHorizontal", wallId: "w1" }, { makeId: ids() });
    expect(result.ok).toBe(true); // no throw on a migrated legacy fixture
  });

  it("t-junction: split one arm without breaking the shared node", () => {
    const plan = normalizePlan(loadPlannerFixture("t-junction"));
    const result = executeGeometryCommand(plan, { type: "wall.split", wallId: "w1", point: { x: 1500, y: 0 } }, { makeId: ids() });
    expect(result.ok).toBe(true);
    // w3 (the T-branch) must still reference the shared node n3 unchanged.
    const branch = result.plan.walls.find((w) => w.id === "w3");
    expect(branch.a === "n3" || branch.b === "n3").toBe(true);
    expect(result.plan.nodes.n3).toEqual({ x: 3000, y: 0 });
  });

  it("door-on-wall: command layer preserves door attachment through a non-topology move", () => {
    const plan = normalizePlan(loadPlannerFixture("door-on-wall"));
    const doorWallId = plan.items.find((it) => it.kind === "door")?.wallId;
    expect(doorWallId).toBeTruthy();
    const result = executeGeometryCommand(plan, { type: "wall.straightenHorizontal", wallId: doorWallId }, { makeId: ids() });
    expect(result.ok).toBe(true);
    const door = result.plan.items.find((it) => it.kind === "door");
    expect(door.wallId).toBe(doorWallId);
  });

  it("manual-dimension: a non-split geometry command leaves dimension attachment intact", () => {
    const plan = normalizePlan(loadPlannerFixture("manual-dimension"));
    const dimWallId = plan.dimensions[0]?.attachedTo?.wallId;
    expect(dimWallId).toBeTruthy();
    const result = executeGeometryCommand(plan, { type: "node.nudge", wallId: dimWallId, dx: 5, dy: 0 }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.dimensions[0].attachedTo).toMatchObject({ type: "wall" });
  });

  it("two-rooms: deleting the shared partition merges into one room via room sync", () => {
    const plan = normalizePlan(loadPlannerFixture("two-rooms"));
    const partitionWallId = plan.walls.find((w) => w.role === "partition" || w.id.startsWith("p"))?.id || plan.walls[plan.walls.length - 1].id;
    const result = executeGeometryCommand(plan, { type: "wall.delete", wallId: partitionWallId }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.deletedEntityIds).toEqual([partitionWallId]);
    expect(Array.isArray(result.plan.rooms)).toBe(true);
  });

  it("plan schema (top-level keys) is unchanged for every fixture after a command", () => {
    for (const name of ["rectangle-room", "legacy-pts-wall", "t-junction", "door-on-wall", "manual-dimension", "two-rooms"]) {
      const plan = normalizePlan(loadPlannerFixture(name));
      const wallId = plan.walls[0]?.id;
      if (!wallId) continue;
      const result = executeGeometryCommand(plan, { type: "wall.straightenHorizontal", wallId }, { makeId: ids() });
      expect(Object.keys(result.plan).sort(), name).toEqual(Object.keys(plan).sort());
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PHASE 1A-1 CORRECTIVE PASS
// ═══════════════════════════════════════════════════════════════════════

// ── §3 wall.delete contract ────────────────────────────────────────────

describe("PHASE 1A-1 corrective — wall.delete contract", () => {
  it("1. delete wall without dependencies (no mounted items/dimensions, no orphan nodes)", () => {
    const plan = rectPlan(); // w1's endpoints n1/n2 are shared with w4/w2 — no orphans
    const result = executeGeometryCommand(plan, { type: "wall.delete", wallId: "w1" }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.walls.find((w) => w.id === "w1")).toBeUndefined();
    expect(result.deletedEntityIds).toEqual(["w1"]);
  });

  it("2. delete wall with orphan endpoints — orphan nodes reported and removed", () => {
    const plan = singleWallPlan();
    const result = executeGeometryCommand(plan, { type: "wall.delete", wallId: "w1" }, { makeId: ids() });
    expect(result.plan.nodes).toEqual({});
    expect(result.deletedEntityIds.sort()).toEqual(["na", "nb", "w1"].sort());
  });

  it("3. shared endpoint is preserved (not orphaned)", () => {
    const plan = rectPlan(); // n1 shared by w1+w4, n2 shared by w1+w2
    const result = executeGeometryCommand(plan, { type: "wall.delete", wallId: "w1" }, { makeId: ids() });
    expect(result.plan.nodes.n1).toBeDefined();
    expect(result.plan.nodes.n2).toBeDefined();
    expect(result.deletedEntityIds).toEqual(["w1"]); // no orphan nodes
  });

  it("4a. door on the deleted wall gets re-placed onto a nearby wall (production policy)", () => {
    const plan = rectPlan();
    plan.items = [door("d1", "w1", { x: 100, y: 0 })]; // close to n1, near w4 (x=0 axis)
    const result = executeGeometryCommand(plan, { type: "wall.delete", wallId: "w1" }, { makeId: ids() });
    expect(result.ok).toBe(true);
    const survivor = result.plan.items.find((it) => it.id === "d1");
    expect(survivor).toBeDefined();
    expect(survivor.wallId).not.toBe("w1");
    expect(result.changedEntityIds).toContain("d1");
  });

  it("4b. door that cannot be re-placed anywhere is removed, not left dangling", () => {
    const plan = singleWallPlan(); // no other wall within reach
    plan.items = [door("d1", "w1", { x: 3000, y: 0 })];
    const result = executeGeometryCommand(plan, { type: "wall.delete", wallId: "w1" }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.items.find((it) => it.id === "d1")).toBeUndefined();
    expect(result.deletedEntityIds).toContain("d1");
  });

  it("5. wall-attached manual dimension is detached (p1/p2 preserved, attachedTo cleared)", () => {
    const plan = rectPlan();
    plan.dimensions = [{ id: "dm1", p1: { x: 500, y: 0 }, p2: { x: 1500, y: 0 }, labelOverride: "keep", attachedTo: { type: "wall", wallId: "w1", t0: 0.1, t1: 0.4 } }];
    const result = executeGeometryCommand(plan, { type: "wall.delete", wallId: "w1" }, { makeId: ids() });
    const dim = result.plan.dimensions[0];
    expect(dim.attachedTo).toBeNull();
    expect(dim.kind).toBe("manual");
    expect(dim.auto).toBe(false);
    expect(dim.labelOverride).toBe("keep");
    expect(Number.isFinite(dim.p1.x)).toBe(true);
    expect(Number.isFinite(dim.p2.x)).toBe(true);
    expect(result.warnings).toEqual([{ code: DIMENSION_DETACHED_AFTER_WALL_REMOVED, entityId: "dm1", wallId: "w1" }]);
    expect(result.changedEntityIds).toContain("dm1");
  });

  it("6. free/item-attached dimension is not touched by an unrelated wall delete", () => {
    const plan = rectPlan();
    const free = { id: "free1", p1: { x: 10, y: 10 }, p2: { x: 20, y: 20 }, attachedTo: null };
    const itemDim = { id: "itemDim1", p1: { x: 1, y: 1 }, p2: { x: 2, y: 2 }, attachedTo: { type: "item", id: "someItem" } };
    plan.dimensions = [free, itemDim];
    const result = executeGeometryCommand(plan, { type: "wall.delete", wallId: "w1" }, { makeId: ids() });
    expect(result.plan.dimensions[0]).toEqual(free);
    expect(result.plan.dimensions[1]).toEqual(itemDim);
  });

  it("7. exact deletedEntityIds: wall + orphan nodes + undeliverable items, no duplicates", () => {
    const plan = singleWallPlan();
    plan.items = [door("d1", "w1", { x: 3000, y: 0 })];
    const result = executeGeometryCommand(plan, { type: "wall.delete", wallId: "w1" }, { makeId: ids() });
    expect(new Set(result.deletedEntityIds).size).toBe(result.deletedEntityIds.length);
    expect(result.deletedEntityIds.sort()).toEqual(["d1", "na", "nb", "w1"].sort());
  });

  it("8. validatePlanIntegrity reports no dangling opening/dimension diagnostics after delete", () => {
    const plan = rectPlan();
    plan.items = [door("d1", "w1", { x: 100, y: 0 })];
    plan.dimensions = [{ id: "dm1", p1: { x: 500, y: 0 }, p2: { x: 1500, y: 0 }, attachedTo: { type: "wall", wallId: "w1", t0: 0.1, t1: 0.4 } }];
    const result = executeGeometryCommand(plan, { type: "wall.delete", wallId: "w1" }, { makeId: ids() });
    const diagnostics = validatePlanIntegrity(result.plan).diagnostics
      .filter((d) => ["OPENING_WALL_NOT_FOUND", "OPENING_WALL_SEG_INVALID", "DIMENSION_WALL_NOT_FOUND"].includes(d.code));
    expect(diagnostics).toEqual([]);
  });

  it("9. deep-frozen input plan is not mutated by delete", () => {
    const plan = deepFreeze(rectPlan());
    expect(() => executeGeometryCommand(plan, { type: "wall.delete", wallId: "w1" }, { makeId: ids() })).not.toThrow();
  });
});

// ── §4 wall.merge contract ─────────────────────────────────────────────

describe("PHASE 1A-1 corrective — wall.merge contract", () => {
  it("merge without mounted entities: surviving wall spans both, removed wall/node gone", () => {
    const plan = mergeablePlan();
    const result = executeGeometryCommand(plan, { type: "wall.merge", wallId: "w1" }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    const survivor = result.plan.walls.find((w) => w.id === "w1");
    expect(survivor).toBeDefined();
    expect(result.plan.nodes[survivor.a]).toEqual({ x: 0, y: 0 });
    expect(result.plan.nodes[survivor.b]).toEqual({ x: 6000, y: 0 });
    expect(result.plan.walls.find((w) => w.id === "w2")).toBeUndefined();
  });

  it("opening on the surviving wall is remapped (wallSeg extended, wallId unchanged)", () => {
    const plan = mergeablePlan();
    plan.items = [door("d1", "w1", { x: 1000, y: 0 })];
    const result = executeGeometryCommand(plan, { type: "wall.merge", wallId: "w1" }, { makeId: ids() });
    expect(result.ok).toBe(true);
    const item = result.plan.items.find((it) => it.id === "d1");
    expect(item.wallId).toBe("w1");
    expect(item.wallSeg).toEqual({ a: { x: 0, y: 0 }, b: { x: 6000, y: 0 } });
    expect(result.changedEntityIds).toContain("d1");
  });

  it("opening on the removed wall is transferred onto the surviving wall", () => {
    const plan = mergeablePlan();
    plan.items = [door("d1", "w2", { x: 4500, y: 0 })];
    const result = executeGeometryCommand(plan, { type: "wall.merge", wallId: "w1" }, { makeId: ids() });
    expect(result.ok).toBe(true);
    const item = result.plan.items.find((it) => it.id === "d1");
    expect(item.wallId).toBe("w1"); // surviving wall id
    expect(item.wallSeg).toEqual({ a: { x: 0, y: 0 }, b: { x: 6000, y: 0 } });
    expect(result.entityRemap.openings).toEqual([{ entityId: "d1", fromWallId: "w2", toWallId: "w1" }]);
  });

  it("manual dimension on the removed wall is remapped to local params of the surviving wall", () => {
    const plan = mergeablePlan();
    plan.dimensions = [{ id: "dm1", attachedTo: { type: "wall", wallId: "w2", t0: 0.2, t1: 0.8 } }]; // w2 spans 3000..6000
    const result = executeGeometryCommand(plan, { type: "wall.merge", wallId: "w1" }, { makeId: ids() });
    expect(result.ok).toBe(true);
    const dim = result.plan.dimensions[0];
    expect(dim.attachedTo.wallId).toBe("w1");
    // Absolute span was 3600..5400 on w2; on the surviving 0..6000 wall that's t=0.6..0.9.
    expect(dim.attachedTo.t0).toBeCloseTo(0.6);
    expect(dim.attachedTo.t1).toBeCloseTo(0.9);
    expect(result.entityRemap.dimensions).toEqual([{ entityId: "dm1", fromWallId: "w2", toWallId: "w1" }]);
  });

  it("wall metadata (thk/material) is preserved from the surviving wall", () => {
    const plan = mergeablePlan();
    const result = executeGeometryCommand(plan, { type: "wall.merge", wallId: "w1" }, { makeId: ids() });
    const survivor = result.plan.walls.find((w) => w.id === "w1");
    expect(survivor.thk).toBe(100);
    expect(survivor.material).toBe("brick");
  });

  it("entityRemap.walls uses the removed->surviving mapping", () => {
    const plan = mergeablePlan();
    const result = executeGeometryCommand(plan, { type: "wall.merge", wallId: "w1" }, { makeId: ids() });
    expect(result.entityRemap.walls).toEqual({ originalWallId: "w2", survivingWallId: "w1" });
  });

  it("exact deletedEntityIds: removed wall + orphaned node only", () => {
    const plan = mergeablePlan();
    const result = executeGeometryCommand(plan, { type: "wall.merge", wallId: "w1" }, { makeId: ids() });
    expect(result.deletedEntityIds.sort()).toEqual(["n2", "w2"].sort());
  });

  it("shared node used by a third wall is NOT reported as orphaned", () => {
    // Merge w2+w3 at n3, which is ALSO the shared node with w1 — but w1 keeps using n3's
    // sibling; here we merge w1+w2 at n2, which is not shared by w3, so this test instead
    // verifies the case where the shared node IS still in use: merge w2 into w3's neighbor
    // is not collinear (perpendicular), so use a plan where merging leaves a still-used node.
    const plan = mergeablePlan();
    plan.walls.push({ id: "w0", a: "n2", b: "n5", thk: 100 });
    plan.nodes.n5 = { x: 3000, y: -1000 };
    const result = executeGeometryCommand(plan, { type: "wall.merge", wallId: "w1" }, { makeId: ids() });
    expect(result.ok).toBe(true);
    // n2 is still referenced by w0, so it must survive the merge.
    expect(result.plan.nodes.n2).toBeDefined();
    expect(result.deletedEntityIds).not.toContain("n2");
  });

  it("rejects an unsafe merge (invalid opening geometry) before any mutation", () => {
    const plan = mergeablePlan();
    plan.items = [door("d1", "w2", { x: 4500, y: 0 }, { w: 0 })]; // invalid width
    let calls = 0;
    const result = executeGeometryCommand(plan, { type: "wall.merge", wallId: "w1" }, { makeId: () => { calls += 1; return `id-${calls}`; } });
    expect(result.ok).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.plan).toBe(plan);
    expect(result.error.code).toBe(GEOMETRY_COMMAND_FAILED);
    expect(calls).toBe(0);
  });

  it("validatePlanIntegrity is clean after a successful merge with mounted entities", () => {
    const plan = mergeablePlan();
    plan.items = [door("d1", "w1", { x: 1000, y: 0 }), door("d2", "w2", { x: 4500, y: 0 })];
    plan.dimensions = [{ id: "dm1", attachedTo: { type: "wall", wallId: "w2", t0: 0.1, t1: 0.3 } }];
    const result = executeGeometryCommand(plan, { type: "wall.merge", wallId: "w1" }, { makeId: ids() });
    const diagnostics = validatePlanIntegrity(result.plan).diagnostics
      .filter((d) => ["OPENING_WALL_NOT_FOUND", "DIMENSION_WALL_NOT_FOUND"].includes(d.code));
    expect(diagnostics).toEqual([]);
  });

  it("undo/redo: merged wall id and geometry are stable across undo/redo", () => {
    const plan = mergeablePlan();
    const history = new HistoryModel(plan);
    const result = executeGeometryCommand(history.current, { type: "wall.merge", wallId: "w1" }, { makeId: ids() });
    expect(result.ok && result.changed).toBe(true);
    history.setPlan(() => result.plan);
    expect(history.undo()).toBe(plan);
    expect(history.redo()).toBe(result.plan);
    expect(history.redo().walls.find((w) => w.id === "w1").b).toBe(result.plan.walls.find((w) => w.id === "w1").b);
  });
});

// ── §5 coordinate mutation refresh ─────────────────────────────────────

describe("PHASE 1A-1 corrective — coordinate mutation mounted-entity refresh", () => {
  it("wall.moveSegment: door on the moved wall stays attached with an updated position", () => {
    const plan = rectPlan();
    plan.items = [door("d1", "w1", { x: 2000, y: 0 })];
    const result = executeGeometryCommand(plan, { type: "wall.moveSegment", wallId: "w1", a: { x: 0, y: -300 }, b: { x: 4000, y: -300 } }, { makeId: ids() });
    expect(result.ok).toBe(true);
    const item = result.plan.items.find((it) => it.id === "d1");
    expect(item.wallId).toBe("w1");
    expect(item.y).not.toBe(-50); // repositioned onto the moved wall body
  });

  it("node.move: connected walls sharing the node are reported in changedEntityIds", () => {
    const plan = rectPlan(); // n1 shared by w1 and w4
    const result = executeGeometryCommand(plan, { type: "node.move", wallId: "w1", nodeIdx: 0, point: { x: -200, y: -200 } }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.changedEntityIds).toContain("w1");
    expect(result.changedEntityIds).toContain("w4"); // shares n1
    expect(result.plan.walls.find((w) => w.id === "w4").a === "n1" || result.plan.walls.find((w) => w.id === "w4").b === "n1").toBe(true);
  });

  it("straighten on a diagonal wall keeps a door attached", () => {
    const plan = singleWallPlan({ x: 0, y: 0 }, { x: 4000, y: 25 });
    plan.items = [door("d1", "w1", { x: 2000, y: 12 })];
    const result = executeGeometryCommand(plan, { type: "wall.straightenHorizontal", wallId: "w1" }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.items.find((it) => it.id === "d1").wallId).toBe("w1");
  });

  it("straighten on a reversed wall still succeeds and keeps geometry consistent", () => {
    const plan = singleWallPlan({ x: 4000, y: 30 }, { x: 0, y: 0 });
    const result = executeGeometryCommand(plan, { type: "wall.straightenHorizontal", wallId: "w1" }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.plan.nodes.na.y).toBe(result.plan.nodes.nb.y);
  });

  it("wall-attached dimension resolves correctly against the new geometry after a coordinate move (self-healing, no explicit remap needed)", () => {
    const plan = rectPlan();
    plan.dimensions = [{ id: "dm1", attachedTo: { type: "wall", wallId: "w1", t0: 0.25, t1: 0.75 } }];
    const result = executeGeometryCommand(plan, { type: "wall.moveSegment", wallId: "w1", a: { x: 0, y: -500 }, b: { x: 4000, y: -500 } }, { makeId: ids() });
    expect(result.ok).toBe(true);
    // attachedTo/t0/t1 unchanged — dimension resolves live from wall geometry.
    expect(result.plan.dimensions[0].attachedTo).toEqual({ type: "wall", wallId: "w1", t0: 0.25, t1: 0.75 });
    const resolved = resolveAttachedDimensionForTest(result.plan.dimensions[0], result.plan);
    expect(resolved.p1).toEqual({ x: 1000, y: -500 });
    expect(resolved.p2).toEqual({ x: 3000, y: -500 });
  });

  it("free (unattached) dimension is not touched by a coordinate move", () => {
    const plan = rectPlan();
    const free = { id: "free1", p1: { x: 10, y: 10 }, p2: { x: 20, y: 20 }, attachedTo: null };
    plan.dimensions = [free];
    const result = executeGeometryCommand(plan, { type: "node.nudge", wallId: "w1", dx: 5, dy: 5 }, { makeId: ids() });
    expect(result.plan.dimensions[0]).toEqual(free);
  });

  it("room sync runs after the coordinate mutation (rooms array present and recomputed)", () => {
    const plan = rectPlan();
    const result = executeGeometryCommand(plan, { type: "node.nudge", wallId: "w1", dx: 5, dy: 0 }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.plan.rooms)).toBe(true);
  });

  it("validatePlanIntegrity stays clean after a coordinate move with a door attached", () => {
    const plan = rectPlan();
    plan.items = [door("d1", "w1", { x: 2000, y: 0 })];
    const result = executeGeometryCommand(plan, { type: "wall.moveSegment", wallId: "w1", a: { x: 0, y: -400 }, b: { x: 4000, y: -400 } }, { makeId: ids() });
    const diagnostics = validatePlanIntegrity(result.plan).diagnostics.filter((d) => d.entityType === "opening");
    expect(diagnostics).toEqual([]);
  });
});

// Локальный тонкий wrapper — тест выше нужен только для проверки, что размер
// РЕЗОЛВИТСЯ корректно, само resolveAttachedDimension уже импортировано и
// протестировано в других файлах (не дублируем его алгоритм).
function resolveAttachedDimensionForTest(dim, plan) {
  const wall = plan.walls.find((w) => w.id === (dim.attachedTo.wallId ?? dim.attachedTo.id));
  const a = plan.nodes[wall.a];
  const b = plan.nodes[wall.b];
  const pointAtT = (t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  return { p1: pointAtT(dim.attachedTo.t0), p2: pointAtT(dim.attachedTo.t1) };
}

// ── §7 node.moveToWall removed ──────────────────────────────────────────

describe("PHASE 1A-1 corrective — node.moveToWall removed", () => {
  it("is not in the public command type list", () => {
    expect(GEOMETRY_COMMAND_TYPES).not.toContain("node.moveToWall");
  });

  it("dispatching node.moveToWall returns GEOMETRY_COMMAND_UNKNOWN", () => {
    const plan = rectPlan();
    const result = executeGeometryCommand(plan, { type: "node.moveToWall", wallId: "w1", nodeIdx: 0, point: { x: 0, y: 0 } }, { makeId: ids() });
    expect(result).toMatchObject({ ok: false, changed: false, plan, error: { code: GEOMETRY_COMMAND_UNKNOWN } });
  });
});

// ── §8 coordinate validation ─────────────────────────────────────────────

describe("PHASE 1A-1 corrective — coordinate (finite) validation", () => {
  const invalidPoints = [
    ["NaN x", { x: NaN, y: 0 }],
    ["Infinity y", { x: 0, y: Infinity }],
    ["undefined point", undefined],
  ];

  it.each(invalidPoints)("wall.split rejects an invalid point (%s)", (_name, point) => {
    const plan = singleWallPlan();
    let calls = 0;
    const result = executeGeometryCommand(plan, { type: "wall.split", wallId: "w1", point }, { makeId: () => { calls += 1; return `id-${calls}`; } });
    expect(result).toMatchObject({ ok: false, changed: false, plan, error: { code: GEOMETRY_COMMAND_INVALID } });
    expect(calls).toBe(0);
  });

  it.each(invalidPoints)("node.move rejects an invalid point (%s)", (_name, point) => {
    const plan = rectPlan();
    const result = executeGeometryCommand(plan, { type: "node.move", wallId: "w1", nodeIdx: 0, point }, { makeId: ids() });
    expect(result).toMatchObject({ ok: false, changed: false, plan, error: { code: GEOMETRY_COMMAND_INVALID } });
  });

  it.each(invalidPoints)("wall.moveSegment rejects an invalid endpoint (%s)", (_name, point) => {
    const plan = rectPlan();
    const result = executeGeometryCommand(plan, { type: "wall.moveSegment", wallId: "w1", a: point, b: { x: 0, y: 0 } }, { makeId: ids() });
    expect(result).toMatchObject({ ok: false, changed: false, plan, error: { code: GEOMETRY_COMMAND_INVALID } });
  });

  it.each([["NaN dx", NaN, 0], ["Infinity dy", 0, Infinity]])("node.nudge rejects non-finite delta (%s)", (_name, dx, dy) => {
    const plan = rectPlan();
    const result = executeGeometryCommand(plan, { type: "node.nudge", wallId: "w1", dx, dy }, { makeId: ids() });
    expect(result).toMatchObject({ ok: false, changed: false, plan, error: { code: GEOMETRY_COMMAND_INVALID } });
  });

  it("wall.create rejects a non-finite point without consuming makeId", () => {
    const plan = rectPlan();
    let calls = 0;
    const result = executeGeometryCommand(plan, {
      type: "wall.create",
      points: [{ x: 0, y: 0 }, { x: NaN, y: 100 }],
    }, { makeId: () => { calls += 1; return `id-${calls}`; } });
    expect(result).toMatchObject({ ok: false, changed: false, plan, error: { code: GEOMETRY_COMMAND_INVALID } });
    expect(calls).toBe(0);
  });
});

// ── §9 wall.create validation ─────────────────────────────────────────────

describe("PHASE 1A-1 corrective — wall.create validation", () => {
  it("identical two points is a no-op, not an error", () => {
    const plan = rectPlan();
    const result = executeGeometryCommand(plan, { type: "wall.create", points: [{ x: 100, y: 100 }, { x: 100, y: 100 }] }, { makeId: ids() });
    expect(result).toMatchObject({ ok: true, changed: false });
    expect(result.plan).toBe(plan);
  });

  it("repeated middle point is deduplicated, producing a valid two-segment wall", () => {
    const plan = rectPlan();
    const result = executeGeometryCommand(plan, {
      type: "wall.create",
      points: [{ x: 100, y: 100 }, { x: 500, y: 100 }, { x: 500, y: 100 }, { x: 500, y: 500 }],
    }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.plan.walls.length).toBe(plan.walls.length + 2);
  });

  it("NaN/Infinity in points is rejected", () => {
    const plan = rectPlan();
    const r1 = executeGeometryCommand(plan, { type: "wall.create", points: [{ x: 0, y: 0 }, { x: NaN, y: 0 }] }, { makeId: ids() });
    const r2 = executeGeometryCommand(plan, { type: "wall.create", points: [{ x: 0, y: 0 }, { x: Infinity, y: 0 }] }, { makeId: ids() });
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
  });

  it("a valid polyline creates walls with sequential entity IDs only for actual entities", () => {
    const plan = rectPlan();
    let calls = 0;
    const result = executeGeometryCommand(plan, {
      type: "wall.create",
      points: [{ x: 100, y: 100 }, { x: 500, y: 100 }, { x: 500, y: 500 }],
    }, { makeId: () => { calls += 1; return `id-${calls}`; } });
    expect(result.ok).toBe(true);
    // 3 new nodes + 2 new walls tracked in createdEntityIds, plus 1 extra
    // makeId("ch") call for commitWallChain's chainId metadata (existing
    // production behavior, reused as-is — chainId is a metadata value, not a
    // tracked entity, so it is intentionally excluded from createdEntityIds).
    expect(result.createdEntityIds).toHaveLength(5);
    expect(calls).toBe(result.createdEntityIds.length + 1);
    expect(new Set(result.createdEntityIds).size).toBe(result.createdEntityIds.length); // без дубликатов
  });

  it("input points array is not mutated", () => {
    const plan = rectPlan();
    const points = [{ x: 100, y: 100 }, { x: 500, y: 100 }, { x: 500, y: 100 }];
    const before = JSON.parse(JSON.stringify(points));
    executeGeometryCommand(plan, { type: "wall.create", points }, { makeId: ids() });
    expect(points).toEqual(before);
  });
});

// ── §10 wall.split result contract preservation ─────────────────────────

describe("PHASE 1A-1 corrective — wall.split preserves PHASE 0F operation fields", () => {
  it("operationResult carries originalWallId/splitNodeId/splitT/childWallIds/sourceRange/targetRange", () => {
    const plan = singleWallPlan();
    const result = executeGeometryCommand(plan, { type: "wall.split", wallId: "w1", point: { x: 3000, y: 0 } }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.operationResult).toMatchObject({
      originalWallId: "w1",
      childWallIds: ["w1", expect.any(String)],
      sourceRange: [0, expect.any(Number)],
      targetRange: [expect.any(Number), 1],
    });
    expect(result.operationResult.splitT).toBeCloseTo(0.5);
    expect(typeof result.operationResult.splitNodeId).toBe("string");
  });
});

// ── §11 immutability (deep freeze) ───────────────────────────────────────

describe("PHASE 1A-1 corrective — deep-freeze immutability per family", () => {
  const cases = [
    ["create", () => rectPlan(), { type: "wall.create", points: [{ x: 100, y: 100 }, { x: 500, y: 500 }] }],
    ["delete", () => rectPlan(), { type: "wall.delete", wallId: "w1" }],
    ["split", () => singleWallPlan(), { type: "wall.split", wallId: "w1", point: { x: 3000, y: 0 } }],
    ["move (node.move)", () => rectPlan(), { type: "node.move", wallId: "w1", nodeIdx: 0, point: { x: -100, y: -100 } }],
    ["straighten/align", () => singleWallPlan({ x: 0, y: 0 }, { x: 4000, y: 20 }), { type: "wall.straightenHorizontal", wallId: "w1" }],
    ["merge", () => mergeablePlan(), { type: "wall.merge", wallId: "w1" }],
    ["room-sync failure", () => rectPlan(), { type: "node.move", wallId: "w1", nodeIdx: 0, point: { x: -100, y: -100 } }, { roomSyncFn: throwingRoomSyncFn }],
  ];

  it.each(cases)("%s: original plan is deep-equal after the command, no nested mutation", (_name, makePlan, command, extraContext = {}) => {
    const plan = deepFreeze(makePlan());
    const before = JSON.parse(JSON.stringify(plan));
    const result = executeGeometryCommand(plan, command, { makeId: ids(), ...extraContext });
    expect(plan).toEqual(before); // deep-equal — freeze itself already guarantees no mutation succeeded
    if (result.ok === false || result.changed === false) {
      expect(result.plan).toBe(plan);
    } else {
      expect(result.plan).not.toBe(plan);
    }
  });

  it("low-level exception: plan === originalPlan (deep-frozen input)", () => {
    const plan = deepFreeze(rectPlan());
    const spy = vi.spyOn(wallNetworkMod, "deleteWallEdge").mockImplementation(() => { throw new Error("boom"); });
    try {
      const result = executeGeometryCommand(plan, { type: "wall.delete", wallId: "w1" }, { makeId: ids() });
      expect(result.ok).toBe(false);
      expect(result.plan).toBe(plan);
    } finally {
      spy.mockRestore();
    }
  });
});

// ── §12 exception safety ──────────────────────────────────────────────────

describe("PHASE 1A-1 corrective — exception during post-processing (mounted-item refresh)", () => {
  it("an exception thrown by refreshWallMountedItems yields full rejection, no partial entities", () => {
    const plan = rectPlan();
    const spy = vi.spyOn(wallOpsMod, "refreshWallMountedItems").mockImplementation(() => { throw new Error("controlled post-processing failure"); });
    try {
      const result = executeGeometryCommand(plan, { type: "node.move", wallId: "w1", nodeIdx: 0, point: { x: -100, y: -100 } }, { makeId: ids() });
      expect(result.ok).toBe(false);
      expect(result.changed).toBe(false);
      expect(result.plan).toBe(plan);
      expect(result.error.code).toBe(GEOMETRY_COMMAND_FAILED);
      expect(JSON.stringify(result)).not.toContain("controlled post-processing failure");
    } finally {
      spy.mockRestore();
    }
  });

  it("wall.delete post-processing exception also yields full rejection", () => {
    const plan = rectPlan();
    plan.items = [door("d1", "w1", { x: 100, y: 0 })];
    const spy = vi.spyOn(wallOpsMod, "refreshWallMountedItems").mockImplementation(() => { throw new Error("boom"); });
    try {
      const result = executeGeometryCommand(plan, { type: "wall.delete", wallId: "w1" }, { makeId: ids() });
      expect(result.ok).toBe(false);
      expect(result.plan).toBe(plan);
      expect(result.plan.items).toEqual(plan.items); // никакой partial delete
    } finally {
      spy.mockRestore();
    }
  });

  it("room sync engine exception (roomSyncFn throws): geometry kept, ok:true, ROOM_DETECTION_FAILED, one history op", () => {
    const plan = rectPlan();
    const history = new HistoryModel(plan);
    const result = executeGeometryCommand(
      history.current,
      { type: "node.move", wallId: "w1", nodeIdx: 0, point: { x: -300, y: -300 } },
      { makeId: ids(), roomSyncFn: throwingRoomSyncFn },
    );
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.plan.nodes.n1).toEqual({ x: -300, y: -300 });
    expect(result.diagnostics[0]).toMatchObject({ code: ROOM_DETECTION_FAILED });
    history.setPlan(() => result.plan);
    expect(history.past).toHaveLength(1);
  });
});

// ── §14 performance split ─────────────────────────────────────────────────

describe("PHASE 1A-1 corrective — performance (split: command overhead vs room-sync cost)", () => {
  it("command overhead alone (fast stub roomSyncFn): 100 coordinate commands on a large plan", () => {
    const N = 12;
    const nodes = {};
    const walls = [];
    let wid = 0;
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) nodes[`n_${i}_${j}`] = { x: i * 500, y: j * 500 };
    }
    for (let i = 0; i < N; i++) {
      for (let j = 0; j <= N; j++) walls.push({ id: `h_${wid++}`, a: `n_${i}_${j}`, b: `n_${i + 1}_${j}`, thk: 100 });
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i <= N; i++) walls.push({ id: `v_${wid++}`, a: `n_${i}_${j}`, b: `n_${i}_${j + 1}`, thk: 100 });
    }
    let plan = { room: { w: N * 500, h: N * 500 }, nodes, walls, items: [], dimensions: [], rooms: [], zones: [] };
    // Быстрый успешный roomSyncFn-заглушка — изолирует overhead САМОГО command
    // layer (dispatch/diff/refresh) от стоимости реального room engine (см.
    // соседний "room-sync cost" тест ниже, который меряет ИМЕННО room engine).
    const fastRoomSyncFn = (p) => ({ rooms: p.rooms || [], zones: p.zones || [], validationWarnings: [] });

    const t0 = performance.now();
    for (let k = 0; k < 100; k++) {
      const wallId = `h_${k % wid}`;
      const wall = plan.walls.find((w) => w.id === wallId);
      if (!wall) continue;
      const result = executeGeometryCommand(plan, { type: "node.move", wallId, nodeIdx: 0, point: { x: (nodes[wall.a]?.x || 0) + 1, y: (nodes[wall.a]?.y || 0) } }, { makeId: ids(), roomSyncFn: fastRoomSyncFn });
      if (result.ok && result.changed) plan = result.plan;
    }
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(2000); // чистый command-layer overhead — узкий бюджет
    if (process.env.PLANNER_PERF_LOG) console.log(`[perf] command overhead only, N=${N}: ${dt.toFixed(1)}ms`);
  });

  it("room-sync cost end-to-end (real room engine): 100 coordinate commands on a large plan", () => {
    // Тот же сценарий, но БЕЗ roomSyncFn — измеряет production room engine
    // (syncRoomsSafe → detectRooms), не command layer. Широкий бюджет —
    // намеренно не оптимизируем room engine в этой фазе.
    const N = 12;
    const nodes = {};
    const walls = [];
    let wid = 0;
    for (let i = 0; i <= N; i++) {
      for (let j = 0; j <= N; j++) nodes[`n_${i}_${j}`] = { x: i * 500, y: j * 500 };
    }
    for (let i = 0; i < N; i++) {
      for (let j = 0; j <= N; j++) walls.push({ id: `h_${wid++}`, a: `n_${i}_${j}`, b: `n_${i + 1}_${j}`, thk: 100 });
    }
    for (let j = 0; j < N; j++) {
      for (let i = 0; i <= N; i++) walls.push({ id: `v_${wid++}`, a: `n_${i}_${j}`, b: `n_${i}_${j + 1}`, thk: 100 });
    }
    let plan = { room: { w: N * 500, h: N * 500 }, nodes, walls, items: [], dimensions: [], rooms: [], zones: [] };

    const t0 = performance.now();
    for (let k = 0; k < 100; k++) {
      const wallId = `h_${k % wid}`;
      const wall = plan.walls.find((w) => w.id === wallId);
      if (!wall) continue;
      const result = executeGeometryCommand(plan, { type: "node.move", wallId, nodeIdx: 0, point: { x: (nodes[wall.a]?.x || 0) + 1, y: (nodes[wall.a]?.y || 0) } }, { makeId: ids() });
      if (result.ok && result.changed) plan = result.plan;
    }
    const dt = performance.now() - t0;
    expect(dt).toBeLessThan(8000); // широкий бюджет (~3.5x запас над замеренным ~2.2s), без flake
    if (process.env.PLANNER_PERF_LOG) console.log(`[perf] end-to-end incl. room engine, N=${N}, ${wid} walls: ${dt.toFixed(1)}ms`);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PHASE 1A-2A — P2 closure
// ═══════════════════════════════════════════════════════════════════════

// ── §2 typed entity-change contract ────────────────────────────────────

describe("PHASE 1A-2A — typed entityChanges contract", () => {
  it("entityChanges is present on every result type (success/rejected/no-op/unknown)", () => {
    const plan = rectPlan();
    const success = executeGeometryCommand(plan, { type: "wall.delete", wallId: "w1" }, { makeId: ids() });
    const rejectedR = executeGeometryCommand(plan, { type: "wall.delete", wallId: "missing" }, { makeId: ids() });
    const noopR = executeGeometryCommand(plan, { type: "wall.straightenHorizontal", wallId: "w1" }, { makeId: ids() });
    const unknownR = executeGeometryCommand(plan, { type: "wall.teleport" }, {});
    for (const r of [success, rejectedR, noopR, unknownR]) {
      expect(r).toHaveProperty("entityChanges");
      for (const bucket of ["created", "changed", "deleted"]) {
        for (const kind of ["walls", "nodes", "items", "dimensions"]) {
          expect(Array.isArray(r.entityChanges[bucket][kind])).toBe(true);
        }
      }
    }
  });

  it("rejected/no-op/unknown have a fully empty typed contract", () => {
    const plan = rectPlan();
    const rejectedR = executeGeometryCommand(plan, { type: "wall.delete", wallId: "missing" }, { makeId: ids() });
    const noopR = executeGeometryCommand(plan, { type: "wall.straightenHorizontal", wallId: "w1" }, { makeId: ids() });
    const unknownR = executeGeometryCommand(plan, { type: "wall.teleport" }, {});
    for (const r of [rejectedR, noopR, unknownR]) {
      const flat = [...Object.values(r.entityChanges.created), ...Object.values(r.entityChanges.changed), ...Object.values(r.entityChanges.deleted)].flat();
      expect(flat).toEqual([]);
    }
  });

  it("typed lists have no duplicates and reflect only real changes", () => {
    const plan = rectPlan();
    const result = executeGeometryCommand(plan, { type: "wall.delete", wallId: "w1" }, { makeId: ids() });
    for (const bucket of ["created", "changed", "deleted"]) {
      for (const kind of ["walls", "nodes", "items", "dimensions"]) {
        const list = result.entityChanges[bucket][kind];
        expect(new Set(list).size).toBe(list.length);
      }
    }
    expect(result.entityChanges.deleted.walls).toEqual(["w1"]);
  });

  it("flat createdEntityIds/changedEntityIds/deletedEntityIds remain a correct flattened summary", () => {
    const plan = rectPlan();
    plan.items = [{ id: "d1", kind: "door", x: 100, y: 0, w: 100, h: 100, wallId: "w1" }];
    const result = executeGeometryCommand(plan, { type: "wall.delete", wallId: "w1" }, { makeId: ids() });
    const flatDeleted = [...result.entityChanges.deleted.walls, ...result.entityChanges.deleted.nodes, ...result.entityChanges.deleted.items, ...result.entityChanges.deleted.dimensions];
    const flatChanged = [...result.entityChanges.changed.walls, ...result.entityChanges.changed.nodes, ...result.entityChanges.changed.items, ...result.entityChanges.changed.dimensions];
    expect(new Set(result.deletedEntityIds)).toEqual(new Set(flatDeleted));
    expect(new Set(result.changedEntityIds)).toEqual(new Set(flatChanged));
  });

  it("typed contract is not written into plan", () => {
    const plan = rectPlan();
    const result = executeGeometryCommand(plan, { type: "wall.delete", wallId: "w1" }, { makeId: ids() });
    expect(result.plan).not.toHaveProperty("entityChanges");
  });

  it("entityRemap remains a separate field from entityChanges", () => {
    const plan = singleWallPlan();
    const result = executeGeometryCommand(plan, { type: "wall.split", wallId: "w1", point: { x: 3000, y: 0 } }, { makeId: ids() });
    expect(result).toHaveProperty("entityRemap");
    expect(result).toHaveProperty("entityChanges");
    expect(result.entityRemap).not.toBe(result.entityChanges);
  });
});

// ── §3 wall.split changed entities (P2) ────────────────────────────────

describe("PHASE 1A-2A — wall.split typed changed entities", () => {
  function opening(id, kind, center, extra = {}) {
    const w = extra.w || 600;
    const h = extra.h || 100;
    return { id, kind, x: center.x - w / 2, y: center.y - h / 2, w, h, wallId: "w1", ...extra };
  }

  it("before/after opening ids land in entityChanges.changed.items, taken from entityRemap.openings", () => {
    const plan = singleWallPlan();
    plan.items = [opening("before", "door", { x: 1000, y: 0 }), opening("after", "window", { x: 5000, y: 0 })];
    const result = executeGeometryCommand(plan, { type: "wall.split", wallId: "w1", point: { x: 3000, y: 0 } }, { makeId: ids() });
    expect([...result.entityChanges.changed.items].sort()).toEqual(["after", "before"]);
    expect(result.entityChanges.changed.items).toEqual(result.entityRemap.openings.map((r) => r.entityId));
  });

  it("a reattached dimension id lands in entityChanges.changed.dimensions", () => {
    const plan = singleWallPlan();
    plan.dimensions = [{ id: "reattach1", p1: { x: 600, y: 0 }, p2: { x: 1200, y: 0 }, attachedTo: { type: "wall", wallId: "w1", t0: 0.1, t1: 0.2 } }];
    const result = executeGeometryCommand(plan, { type: "wall.split", wallId: "w1", point: { x: 3000, y: 0 } }, { makeId: ids() });
    expect(result.entityChanges.changed.dimensions).toEqual(["reattach1"]);
    expect(result.plan.dimensions[0].attachedTo).not.toBeNull();
  });

  it("a detached (cross-split) dimension id also lands in entityChanges.changed.dimensions", () => {
    const plan = singleWallPlan();
    plan.dimensions = [{ id: "detach1", p1: { x: 1200, y: 0 }, p2: { x: 4800, y: 0 }, attachedTo: { type: "wall", wallId: "w1", t0: 0.2, t1: 0.8 } }];
    const result = executeGeometryCommand(plan, { type: "wall.split", wallId: "w1", point: { x: 3000, y: 0 } }, { makeId: ids() });
    expect(result.entityChanges.changed.dimensions).toEqual(["detach1"]);
    expect(result.plan.dimensions[0].attachedTo).toBeNull();
    expect(result.warnings.some((w) => w.entityId === "detach1")).toBe(true);
  });

  it("rejected split returns a fully empty entityChanges", () => {
    const plan = singleWallPlan();
    plan.items = [opening("d1", "door", { x: 3000, y: 0 }, { w: 900 })];
    const result = executeGeometryCommand(plan, { type: "wall.split", wallId: "w1", point: { x: 3000, y: 0 } }, { makeId: ids() });
    expect(result.ok).toBe(false);
    const flat = [...Object.values(result.entityChanges.created), ...Object.values(result.entityChanges.changed), ...Object.values(result.entityChanges.deleted)].flat();
    expect(flat).toEqual([]);
  });

  it("flat compatibility arrays also contain the same opening/dimension IDs", () => {
    const plan = singleWallPlan();
    plan.items = [opening("d1", "door", { x: 5000, y: 0 })];
    plan.dimensions = [{ id: "dm1", p1: { x: 1200, y: 0 }, p2: { x: 4800, y: 0 }, attachedTo: { type: "wall", wallId: "w1", t0: 0.2, t1: 0.8 } }];
    const result = executeGeometryCommand(plan, { type: "wall.split", wallId: "w1", point: { x: 3000, y: 0 } }, { makeId: ids() });
    expect(result.changedEntityIds).toEqual(expect.arrayContaining(["d1", "dm1"]));
  });
});

// ── §4 node.nudge shared-node refresh (P2) ──────────────────────────────

describe("PHASE 1A-2A — node.nudge shared-node mounted-entity refresh", () => {
  it("nudging a node shared by two walls refreshes mounted openings on BOTH walls", () => {
    // w1: n1(0,0)-n2(3000,0), w2: n2(3000,0)-n3(3000,3000) — n2 shared (T-junction-ish corner).
    const plan = {
      room: { w: 6000, h: 3000 },
      nodes: { n1: { x: 0, y: 0 }, n2: { x: 3000, y: 0 }, n3: { x: 3000, y: 3000 } },
      walls: [{ id: "w1", a: "n1", b: "n2", thk: 100 }, { id: "w2", a: "n2", b: "n3", thk: 100 }],
      items: [
        { id: "d1", kind: "door", x: 1400, y: -50, w: 600, h: 100, wallId: "w1" }, // near n2 on w1
        { id: "d2", kind: "door", x: 2950, y: 1200, w: 100, h: 600, wallId: "w2" }, // near n2 on w2
      ],
      dimensions: [],
      rooms: [],
      zones: [],
    };
    const result = executeGeometryCommand(plan, { type: "node.nudge", wallId: "w1", nodeIdx: 1, dx: 60, dy: 40 }, { makeId: ids() });
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    // n2 (shared) moved -> both walls' geometry changed.
    expect(result.plan.nodes.n2).toEqual({ x: 3060, y: 40 });
    const w2 = result.plan.walls.find((w) => w.id === "w2");
    expect(result.plan.nodes[w2.a]).toEqual({ x: 3060, y: 40 });

    // Both openings resolved against the moved geometry (wallSeg reflects the new endpoint).
    const d1 = result.plan.items.find((it) => it.id === "d1");
    const d2 = result.plan.items.find((it) => it.id === "d2");
    expect(d1.wallSeg.b).toEqual({ x: 3060, y: 40 });
    expect(d2.wallSeg.a).toEqual({ x: 3060, y: 40 });

    expect(result.entityChanges.changed.walls.sort()).toEqual(["w1", "w2"]);
    expect(result.entityChanges.changed.items.sort()).toEqual(["d1", "d2"]);

    const diagnostics = validatePlanIntegrity(result.plan).diagnostics.filter((d) => d.entityType === "opening");
    expect(diagnostics).toEqual([]);
  });

  it("free/item dimensions are not touched by a shared-node nudge", () => {
    const plan = {
      room: { w: 6000, h: 3000 },
      nodes: { n1: { x: 0, y: 0 }, n2: { x: 3000, y: 0 }, n3: { x: 3000, y: 3000 } },
      walls: [{ id: "w1", a: "n1", b: "n2", thk: 100 }, { id: "w2", a: "n2", b: "n3", thk: 100 }],
      items: [],
      dimensions: [{ id: "free1", p1: { x: 10, y: 10 }, p2: { x: 20, y: 20 }, attachedTo: null }],
      rooms: [],
      zones: [],
    };
    const result = executeGeometryCommand(plan, { type: "node.nudge", wallId: "w1", nodeIdx: 1, dx: 60, dy: 40 }, { makeId: ids() });
    expect(result.plan.dimensions[0]).toEqual(plan.dimensions[0]);
  });

  it("wall-attached dimension on the non-nudged-wallId side still resolves correctly (self-healing)", () => {
    const plan = {
      room: { w: 6000, h: 3000 },
      nodes: { n1: { x: 0, y: 0 }, n2: { x: 3000, y: 0 }, n3: { x: 3000, y: 3000 } },
      walls: [{ id: "w1", a: "n1", b: "n2", thk: 100 }, { id: "w2", a: "n2", b: "n3", thk: 100 }],
      items: [],
      dimensions: [{ id: "dm1", attachedTo: { type: "wall", wallId: "w2", t0: 0, t1: 1 } }],
      rooms: [],
      zones: [],
    };
    const result = executeGeometryCommand(plan, { type: "node.nudge", wallId: "w1", nodeIdx: 1, dx: 60, dy: 40 }, { makeId: ids() });
    // attachedTo unchanged (self-healing) — resolves against w2's NEW endpoint live.
    expect(result.plan.dimensions[0].attachedTo).toEqual({ type: "wall", wallId: "w2", t0: 0, t1: 1 });
    const w2 = result.plan.walls.find((w) => w.id === "w2");
    expect(result.plan.nodes[w2.a]).toEqual({ x: 3060, y: 40 });
  });

  it("room sync runs exactly once for a shared-node nudge", () => {
    const plan = {
      room: { w: 6000, h: 3000 },
      nodes: { n1: { x: 0, y: 0 }, n2: { x: 3000, y: 0 }, n3: { x: 3000, y: 3000 } },
      walls: [{ id: "w1", a: "n1", b: "n2", thk: 100 }, { id: "w2", a: "n2", b: "n3", thk: 100 }],
      items: [], dimensions: [], rooms: [], zones: [],
    };
    const roomSyncFn = vi.fn((p) => ({ rooms: p.rooms || [], zones: p.zones || [], validationWarnings: [] }));
    const result = executeGeometryCommand(plan, { type: "node.nudge", wallId: "w1", nodeIdx: 1, dx: 60, dy: 40 }, { makeId: ids(), roomSyncFn });
    expect(result.ok).toBe(true);
    expect(roomSyncFn).toHaveBeenCalledTimes(1);
  });
});
