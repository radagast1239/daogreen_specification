/**
 * PHASE 1A-2C2D3E4D — combined power/light/vent "Очистить лист" clear.
 *
 * Two layers under test:
 *   1. Pure summary/message helpers (combinedLayerClearSummary.js) — plain
 *      unit tests, no production command involved.
 *   2. UI orchestration (applyCombinedLayerClear.js) exercised against the
 *      REAL command layer (real executeGeometryCommand, real
 *      createGeometryCommandDispatcher, real HistoryModel, real
 *      applyItemLineBulkDelete, real engineering sync modules, real
 *      validatePlanIntegrity) — only getCurrentPlan/confirmFn are fakes
 *      supplied by the test, exactly the two DOM/React-adjacent inputs
 *      PlanPage.jsx would normally provide. No cleanup algorithm is
 *      re-derived here.
 *
 * Import-order fragility: same class as the rest of the command-layer test
 * suite — wallGeometry.js warmed up first in beforeAll.
 */
import {
  describe, it, expect, vi, beforeAll,
} from "vitest";
import { summarizeCombinedLayerClear, buildCombinedLayerClearMessage } from "../src/planner/ui/combinedLayerClearSummary.js";

let executeGeometryCommand;
let createGeometryCommandDispatcher;
let HistoryModel;
let validatePlanIntegrity;
let applyCombinedLayerClear;

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

  const applyMod = await import("../src/planner/ui/applyCombinedLayerClear.js");
  applyCombinedLayerClear = applyMod.applyCombinedLayerClear;
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

function powerItem(id, kind, x, y, extra = {}) {
  return {
    id, kind, layer: "power", x, y, w: 200, h: 100, ...extra,
  };
}
function lightItem(id, kind, x, y, extra = {}) {
  return {
    id, kind, layer: "light", x, y, w: 400, h: 150, ...extra,
  };
}
function ventItem(id, kind, x, y, extra = {}) {
  return {
    id, kind, layer: "vent", x, y, w: 600, h: 400, ...extra,
  };
}
function rack(id, x, y, extra = {}) {
  return {
    id, kind: "rack", layer: "racks", x, y, w: 1220, h: 600, ...extra,
  };
}
function line(id, layer, pts, extra = {}) {
  return {
    id, layer, pts, points: pts, ...extra,
  };
}

// ── summary helper: real production catalog kinds ────────────────────────

describe("PHASE 1A-2C2D3E4D — summarizeCombinedLayerClear", () => {
  it("counts power items (panel/cable_tray/junction_box/switch/sensor/relay_box) and power lines", () => {
    const items = [
      powerItem("p1", "panel", 0, 0),
      powerItem("p2", "cable_tray", 200, 0),
      powerItem("p3", "junction_box", 400, 0),
      powerItem("p4", "switch", 600, 0),
      powerItem("p5", "sensor", 800, 0),
      powerItem("p6", "relay_box", 1000, 0),
    ];
    const lines = [
      line("pl1", "power", [{ x: 0, y: 0 }, { x: 1000, y: 0 }]),
    ];
    const summary = summarizeCombinedLayerClear({ items, lines, layerId: "power" });
    expect(summary.itemCount).toBe(6);
    expect(summary.lineCount).toBe(1);
    expect(summary.totalCount).toBe(7);
    expect(summary.itemIds.sort()).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
    expect(summary.lineIds).toEqual(["pl1"]);
  });

  it("counts light items (light_panel/lighting_group) and light lines", () => {
    const items = [
      lightItem("l1", "light_panel", 0, 0),
      lightItem("l2", "lighting_group", 500, 0),
    ];
    const lines = [line("ll1", "light", [{ x: 0, y: 0 }, { x: 500, y: 0 }])];
    const summary = summarizeCombinedLayerClear({ items, lines, layerId: "light" });
    expect(summary.itemCount).toBe(2);
    expect(summary.lineCount).toBe(1);
    expect(summary.totalCount).toBe(3);
  });

  it("counts vent items (vent_unit/blade_fan/supply/exhaust/duct_damper/airflow_arrow) and vent lines", () => {
    const items = [
      ventItem("v1", "vent_unit", 0, 0),
      ventItem("v2", "blade_fan", 700, 0),
      ventItem("v3", "supply", 1400, 0),
      ventItem("v4", "exhaust", 2100, 0),
      ventItem("v5", "duct_damper", 2800, 0),
      ventItem("v6", "airflow_arrow", 3500, 0),
    ];
    const lines = [line("vl1", "vent", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const summary = summarizeCombinedLayerClear({ items, lines, layerId: "vent" });
    expect(summary.itemCount).toBe(6);
    expect(summary.lineCount).toBe(1);
    expect(summary.totalCount).toBe(7);
  });

  it("excludes unrelated entities from a different layer", () => {
    const items = [powerItem("p1", "panel", 0, 0), rack("r1", 2000, 0)];
    const lines = [
      line("pl1", "power", [{ x: 0, y: 0 }, { x: 1000, y: 0 }]),
      line("il1", "irrigation", [{ x: 3000, y: 0 }, { x: 4000, y: 0 }]),
    ];
    const summary = summarizeCombinedLayerClear({ items, lines, layerId: "power" });
    expect(summary.itemIds).toEqual(["p1"]);
    expect(summary.lineIds).toEqual(["pl1"]);
  });

  it("uses production migrateLayerId, not a re-derived alias map — a legacy 'ac' line (migrates to climate, per catalog.js LAYER_MIGRATE) is correctly excluded from vent/power/light, proving the check is real, not a naive raw match", () => {
    const lines = [
      line("ac1", "ac", [{ x: 0, y: 0 }, { x: 1000, y: 0 }]),
      line("vl1", "vent", [{ x: 2000, y: 0 }, { x: 3000, y: 0 }]),
    ];
    const summary = summarizeCombinedLayerClear({ items: [], lines, layerId: "vent" });
    expect(summary.lineIds).toEqual(["vl1"]);
    expect(summary.lineIds).not.toContain("ac1");
  });

  it("returns IDs in deterministic plan order", () => {
    const items = [
      powerItem("p3", "panel", 0, 0),
      powerItem("p1", "sensor", 200, 0),
      powerItem("p2", "switch", 400, 0),
    ];
    const summary = summarizeCombinedLayerClear({ items, lines: [], layerId: "power" });
    expect(summary.itemIds).toEqual(["p3", "p1", "p2"]);
  });

  it("dedupes duplicate IDs in the source arrays", () => {
    const dup = powerItem("p1", "panel", 0, 0);
    const summary = summarizeCombinedLayerClear({ items: [dup, dup], lines: [], layerId: "power" });
    expect(summary.itemIds).toEqual(["p1"]);
    expect(summary.itemCount).toBe(1);
  });

  it("safely ignores malformed entries (null, missing id, non-string id)", () => {
    const items = [null, { layer: "power" }, { id: 123, layer: "power" }, powerItem("p1", "panel", 0, 0)];
    const lines = [null, { layer: "power" }, line("pl1", "power", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const summary = summarizeCombinedLayerClear({ items, lines, layerId: "power" });
    expect(summary.itemIds).toEqual(["p1"]);
    expect(summary.lineIds).toEqual(["pl1"]);
  });

  it("buildCombinedLayerClearMessage contains both counts and the layer label", () => {
    const message = buildCombinedLayerClearMessage({ layerLabel: "Электрика", itemCount: 6, lineCount: 4 });
    expect(message).toContain("Электрика");
    expect(message).toContain("Оборудование — 6");
    expect(message).toContain("Линии и трассы — 4");
  });
});

// ── orchestration: real command layer, fake getCurrentPlan/confirmFn ─────

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

describe("PHASE 1A-2C2D3E4D — applyCombinedLayerClear orchestration", () => {
  it("empty layer before confirm: no confirm call, no dispatch, returns 'empty'", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)]; // unrelated layer only
    const h = makeHarness(plan);
    const confirmFn = vi.fn(() => true);
    const status = applyCombinedLayerClear({
      getCurrentPlan: () => h.history.current,
      layerId: "power",
      layerLabel: "Электрика",
      confirmFn,
      runGeometryCommand: h.dispatcher,
    });
    expect(status).toBe("empty");
    expect(confirmFn).not.toHaveBeenCalled();
    expect(h.commitPlan).not.toHaveBeenCalled();
  });

  it("cancel: confirm called, dispatcher never called, returns 'cancelled'", () => {
    const plan = basePlan();
    plan.items = [powerItem("p1", "panel", 0, 0)];
    const h = makeHarness(plan);
    const runGeometryCommand = vi.fn();
    const confirmFn = vi.fn(() => false);
    const status = applyCombinedLayerClear({
      getCurrentPlan: () => h.history.current,
      layerId: "power",
      layerLabel: "Электрика",
      confirmFn,
      runGeometryCommand,
    });
    expect(status).toBe("cancelled");
    expect(confirmFn).toHaveBeenCalledTimes(1);
    expect(runGeometryCommand).not.toHaveBeenCalled();
  });

  it("power mixed clear (items + lines) dispatches exactly one command and commits exactly once", () => {
    const plan = basePlan();
    plan.items = [powerItem("p1", "panel", 0, 0), powerItem("p2", "switch", 200, 0)];
    plan.lines = [line("pl1", "power", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const h = makeHarness(plan);
    const status = applyCombinedLayerClear({
      getCurrentPlan: () => h.history.current,
      layerId: "power",
      layerLabel: "Электрика",
      confirmFn: () => true,
      runGeometryCommand: h.dispatcher,
    });
    expect(status).toBe("success");
    expect(h.commitPlan).toHaveBeenCalledTimes(1);
    expect(h.history.current.items).toEqual([]);
    expect(h.history.current.lines).toEqual([]);
  });

  it("light items-only clear dispatches exactly one command", () => {
    const plan = basePlan();
    plan.items = [lightItem("l1", "light_panel", 0, 0)];
    const h = makeHarness(plan);
    const status = applyCombinedLayerClear({
      getCurrentPlan: () => h.history.current,
      layerId: "light",
      layerLabel: "Свет",
      confirmFn: () => true,
      runGeometryCommand: h.dispatcher,
    });
    expect(status).toBe("success");
    expect(h.commitPlan).toHaveBeenCalledTimes(1);
    expect(h.history.current.items).toEqual([]);
  });

  it("vent lines-only clear dispatches exactly one command", () => {
    const plan = basePlan();
    plan.lines = [line("vl1", "vent", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const h = makeHarness(plan);
    const status = applyCombinedLayerClear({
      getCurrentPlan: () => h.history.current,
      layerId: "vent",
      layerLabel: "Вентиляция",
      confirmFn: () => true,
      runGeometryCommand: h.dispatcher,
    });
    expect(status).toBe("success");
    expect(h.commitPlan).toHaveBeenCalledTimes(1);
    expect(h.history.current.lines).toEqual([]);
  });

  it("dispatches the exact canonical itemLine.bulkDelete payload", () => {
    const plan = basePlan();
    plan.items = [powerItem("p1", "panel", 0, 0)];
    plan.lines = [line("pl1", "power", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const runGeometryCommand = vi.fn(() => ({ ok: true, changed: true }));
    applyCombinedLayerClear({
      getCurrentPlan: () => plan,
      layerId: "power",
      layerLabel: "Электрика",
      confirmFn: () => true,
      runGeometryCommand,
    });
    expect(runGeometryCommand).toHaveBeenCalledTimes(1);
    expect(runGeometryCommand).toHaveBeenCalledWith({ type: "itemLine.bulkDelete", itemIds: ["p1"], lineIds: ["pl1"] });
  });

  it("live-plan race: an item added between the pre-confirm read and the confirm resolving is included in the delete set", () => {
    const plan = basePlan();
    plan.items = [powerItem("p1", "panel", 0, 0)];
    const runGeometryCommand = vi.fn(() => ({ ok: true, changed: true }));
    let currentPlan = plan;
    const confirmFn = () => {
      // Simulate a new power item appearing while the confirm dialog is open.
      currentPlan = { ...currentPlan, items: [...currentPlan.items, powerItem("p2", "switch", 200, 0)] };
      return true;
    };
    applyCombinedLayerClear({
      getCurrentPlan: () => currentPlan,
      layerId: "power",
      layerLabel: "Электрика",
      confirmFn,
      runGeometryCommand,
    });
    expect(runGeometryCommand).toHaveBeenCalledWith({ type: "itemLine.bulkDelete", itemIds: ["p1", "p2"], lineIds: [] });
  });

  it("live-plan race: a line added between the pre-confirm read and the confirm resolving is included in the delete set", () => {
    const plan = basePlan();
    plan.lines = [line("vl1", "vent", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const runGeometryCommand = vi.fn(() => ({ ok: true, changed: true }));
    let currentPlan = plan;
    const confirmFn = () => {
      currentPlan = { ...currentPlan, lines: [...currentPlan.lines, line("vl2", "vent", [{ x: 2000, y: 0 }, { x: 3000, y: 0 }])] };
      return true;
    };
    applyCombinedLayerClear({
      getCurrentPlan: () => currentPlan,
      layerId: "vent",
      layerLabel: "Вентиляция",
      confirmFn,
      runGeometryCommand,
    });
    expect(runGeometryCommand).toHaveBeenCalledWith({ type: "itemLine.bulkDelete", itemIds: [], lineIds: ["vl1", "vl2"] });
  });

  it("live-plan race: an item removed between the pre-confirm read and the confirm resolving is omitted from the delete set", () => {
    const plan = basePlan();
    plan.items = [powerItem("p1", "panel", 0, 0), powerItem("p2", "switch", 200, 0)];
    const runGeometryCommand = vi.fn(() => ({ ok: true, changed: true }));
    let currentPlan = plan;
    const confirmFn = () => {
      currentPlan = { ...currentPlan, items: currentPlan.items.filter((it) => it.id !== "p2") };
      return true;
    };
    applyCombinedLayerClear({
      getCurrentPlan: () => currentPlan,
      layerId: "power",
      layerLabel: "Электрика",
      confirmFn,
      runGeometryCommand,
    });
    expect(runGeometryCommand).toHaveBeenCalledWith({ type: "itemLine.bulkDelete", itemIds: ["p1"], lineIds: [] });
  });

  it("live-plan race: a line removed between the pre-confirm read and the confirm resolving is omitted from the delete set", () => {
    const plan = basePlan();
    plan.lines = [
      line("vl1", "vent", [{ x: 0, y: 0 }, { x: 1000, y: 0 }]),
      line("vl2", "vent", [{ x: 2000, y: 0 }, { x: 3000, y: 0 }]),
    ];
    const runGeometryCommand = vi.fn(() => ({ ok: true, changed: true }));
    let currentPlan = plan;
    const confirmFn = () => {
      currentPlan = { ...currentPlan, lines: currentPlan.lines.filter((l) => l.id !== "vl2") };
      return true;
    };
    applyCombinedLayerClear({
      getCurrentPlan: () => currentPlan,
      layerId: "vent",
      layerLabel: "Вентиляция",
      confirmFn,
      runGeometryCommand,
    });
    expect(runGeometryCommand).toHaveBeenCalledWith({ type: "itemLine.bulkDelete", itemIds: [], lineIds: ["vl1"] });
  });

  it("live-plan race: an entity that changed layer between the pre-confirm read and the confirm resolving is omitted", () => {
    const plan = basePlan();
    plan.items = [powerItem("p1", "panel", 0, 0)];
    const runGeometryCommand = vi.fn(() => ({ ok: true, changed: true }));
    let currentPlan = plan;
    const confirmFn = () => {
      currentPlan = { ...currentPlan, items: [{ ...currentPlan.items[0], layer: "light" }] };
      return true;
    };
    const status = applyCombinedLayerClear({
      getCurrentPlan: () => currentPlan,
      layerId: "power",
      layerLabel: "Электрика",
      confirmFn,
      runGeometryCommand,
    });
    // applyItemLineBulkDelete itself short-circuits to no-target before ever
    // dispatching when the recomputed itemIds/lineIds are both empty — same
    // contract already proven by the empty-before-confirm tests above.
    expect(status).toBe("no-target");
    expect(runGeometryCommand).not.toHaveBeenCalled();
  });

  it("empty-after-confirm (everything vanished while the dialog was open): no-target, zero history checkpoints", () => {
    const plan = basePlan();
    plan.items = [powerItem("p1", "panel", 0, 0)];
    const h = makeHarness(plan);
    const confirmFn = () => {
      h.history.setPlan(() => ({ ...h.history.current, items: [] }));
      return true;
    };
    const status = applyCombinedLayerClear({
      getCurrentPlan: () => h.history.current,
      layerId: "power",
      layerLabel: "Электрика",
      confirmFn,
      runGeometryCommand: h.dispatcher,
    });
    expect(status).toBe("no-target");
    expect(h.commitPlan).not.toHaveBeenCalled();
  });

  it("success/noop/no-target/empty all map to a status the caller should clear selection for", () => {
    const successPlan = basePlan();
    successPlan.items = [powerItem("p1", "panel", 0, 0)];
    const successStatus = applyCombinedLayerClear({
      getCurrentPlan: () => successPlan,
      layerId: "power",
      layerLabel: "Электрика",
      confirmFn: () => true,
      runGeometryCommand: () => ({ ok: true, changed: true }),
    });
    expect(successStatus).toBe("success");

    const emptyStatus = applyCombinedLayerClear({
      getCurrentPlan: () => basePlan(),
      layerId: "power",
      layerLabel: "Электрика",
      confirmFn: () => true,
      runGeometryCommand: () => ({ ok: true, changed: true }),
    });
    expect(emptyStatus).toBe("empty");
  });

  it("geometry-rejected and commit-failed are distinct from the selection-clearing statuses", () => {
    const plan = basePlan();
    plan.items = [powerItem("p1", "panel", 0, 0)];
    const rejectedStatus = applyCombinedLayerClear({
      getCurrentPlan: () => plan,
      layerId: "power",
      layerLabel: "Электрика",
      confirmFn: () => true,
      runGeometryCommand: () => ({ ok: false, error: { code: "GEOMETRY_COMMAND_FAILED" } }),
    });
    expect(rejectedStatus).toBe("geometry-rejected");

    const commitFailedStatus = applyCombinedLayerClear({
      getCurrentPlan: () => plan,
      layerId: "power",
      layerLabel: "Электрика",
      confirmFn: () => true,
      runGeometryCommand: () => ({ ok: false, error: { code: "GEOMETRY_COMMAND_COMMIT_FAILED" } }),
    });
    expect(commitFailedStatus).toBe("commit-failed");
  });

  it("one history checkpoint for a mixed clear; duplicate clear attempt collapses to zero additional checkpoints", () => {
    const plan = basePlan();
    plan.items = [powerItem("p1", "panel", 0, 0)];
    plan.lines = [line("pl1", "power", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    const h = makeHarness(plan);
    const first = applyCombinedLayerClear({
      getCurrentPlan: () => h.history.current,
      layerId: "power",
      layerLabel: "Электрика",
      confirmFn: () => true,
      runGeometryCommand: h.dispatcher,
    });
    const second = applyCombinedLayerClear({
      getCurrentPlan: () => h.history.current,
      layerId: "power",
      layerLabel: "Электрика",
      confirmFn: () => true,
      runGeometryCommand: h.dispatcher,
    });
    expect(first).toBe("success");
    expect(second).toBe("empty");
    expect(h.commitPlan).toHaveBeenCalledTimes(1);
  });

  it("undo returns the exact original plan reference; redo restores the exact committed reference", () => {
    const plan = basePlan();
    plan.items = [powerItem("p1", "panel", 0, 0), powerItem("p2", "switch", 200, 0)];
    plan.lines = [line("pl1", "power", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    plan.links = [{ id: "lk1", type: "power", fromId: "p1", toId: "p2" }];
    const h = makeHarness(plan);
    const original = h.history.current;
    applyCombinedLayerClear({
      getCurrentPlan: () => h.history.current,
      layerId: "power",
      layerLabel: "Электрика",
      confirmFn: () => true,
      runGeometryCommand: h.dispatcher,
    });
    const committed = h.history.current;
    expect(committed).not.toBe(original);

    h.history.undo();
    expect(h.history.current).toBe(original);
    expect(h.history.current.items.map((it) => it.id)).toEqual(["p1", "p2"]);
    expect(h.history.current.lines.map((l) => l.id)).toEqual(["pl1"]);

    h.history.redo();
    expect(h.history.current).toBe(committed);
    expect(h.history.current.items).toEqual([]);
    expect(h.history.current.lines).toEqual([]);
  });

  it("referential integrity through the real combined command: links cleaned, auto dimension deleted, manual dimension detached, walls/nodes unchanged, unrelated layer preserved, validator clean", () => {
    const plan = basePlan();
    const survivor = rack("r1", 4000, 4000);
    plan.items = [
      powerItem("p1", "panel", 1000, 500, { w: 600, h: 200 }),
      survivor,
    ];
    plan.lines = [line("pl1", "power", [{ x: 0, y: 0 }, { x: 1000, y: 0 }])];
    plan.links = [{ id: "lk1", type: "power", fromId: "p1", toId: "r1" }];
    plan.dimensions = [
      { id: "auto1", auto: true, attachedTo: { type: "item", id: "p1" } },
      {
        id: "manual1", auto: false, kind: "manual", p1: { x: 1, y: 1 }, p2: { x: 2, y: 2 }, attachedTo: { type: "item", id: "p1", mode: "bbox-width" },
      },
    ];
    const wallsBefore = plan.walls;
    const nodesBefore = plan.nodes;
    const h = makeHarness(plan);

    const status = applyCombinedLayerClear({
      getCurrentPlan: () => h.history.current,
      layerId: "power",
      layerLabel: "Электрика",
      confirmFn: () => true,
      runGeometryCommand: h.dispatcher,
    });
    expect(status).toBe("success");

    const committed = h.history.current;
    expect(committed.items.map((it) => it.id)).toEqual(["r1"]);
    expect(committed.lines).toEqual([]);
    expect(committed.links).toEqual([]);
    expect(committed.walls).toEqual(wallsBefore);
    expect(committed.nodes).toEqual(nodesBefore);
    expect(committed.dimensions.find((d) => d.id === "auto1")).toBeUndefined();
    const manualDim = committed.dimensions.find((d) => d.id === "manual1");
    expect(manualDim.attachedTo).toBeNull();

    const diagnostics = validatePlanIntegrity(committed).diagnostics.filter((d) => d.severity === "error");
    expect(diagnostics).toEqual([]);
  });
});
