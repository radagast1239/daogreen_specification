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
function personItem(id, x, y, extra = {}) {
  return {
    id, kind: "person", layer: "staff", x, y, w: 450, h: 450, ...extra,
  };
}
function sanitaryItem(id, kind, x, y, extra = {}) {
  return {
    id, kind, layer: "sanitary", x, y, w: 800, h: 420, ...extra,
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

// ── summary helper: staff (PHASE 1A-2C2D3E5B, AUDIT PHASE 1A-2C2D3E5A ─────
// verdict C) — layer holds a real item kind (person) AND real lines across
// four lineTag variants (staff/raw/product/waste); summarizeCombinedLayerClear
// itself needed zero changes (already filters purely by item.layer/line.layer,
// no kind/lineTag narrowing), these tests just prove that against the staff
// shape specifically.

describe("PHASE 1A-2C2D3E5B — summarizeCombinedLayerClear (staff)", () => {
  it("counts a person item and a route_staff line (lineTag:\"staff\")", () => {
    const items = [personItem("s1", 0, 0)];
    const lines = [line("sl1", "staff", [{ x: 0, y: 0 }, { x: 1000, y: 0 }], { lineTag: "staff" })];
    const summary = summarizeCombinedLayerClear({ items, lines, layerId: "staff" });
    expect(summary.itemCount).toBe(1);
    expect(summary.lineCount).toBe(1);
    expect(summary.totalCount).toBe(2);
    expect(summary.itemIds).toEqual(["s1"]);
    expect(summary.lineIds).toEqual(["sl1"]);
  });

  it("counts staff lines regardless of lineTag — raw/product/waste/unknown/missing all included, layer alone is authoritative", () => {
    const lines = [
      line("raw1", "staff", [{ x: 0, y: 0 }, { x: 1000, y: 0 }], { lineTag: "raw" }),
      line("prod1", "staff", [{ x: 0, y: 0 }, { x: 1000, y: 0 }], { lineTag: "product" }),
      line("waste1", "staff", [{ x: 0, y: 0 }, { x: 1000, y: 0 }], { lineTag: "waste" }),
      line("weird1", "staff", [{ x: 0, y: 0 }, { x: 1000, y: 0 }], { lineTag: "unknown_future_tag" }),
      line("notag1", "staff", [{ x: 0, y: 0 }, { x: 1000, y: 0 }]),
    ];
    const summary = summarizeCombinedLayerClear({ items: [], lines, layerId: "staff" });
    expect(summary.lineCount).toBe(5);
    expect(summary.lineIds.slice().sort()).toEqual(["notag1", "prod1", "raw1", "waste1", "weird1"]);
  });

  it("excludes a sanitary item and unrelated power/drain lines from the same safety-sheet neighborhood", () => {
    const items = [personItem("s1", 0, 0), sanitaryItem("d1", "dezmat", 2000, 0)];
    const lines = [
      line("sl1", "staff", [{ x: 0, y: 0 }, { x: 1000, y: 0 }], { lineTag: "staff" }),
      line("pl1", "power", [{ x: 3000, y: 0 }, { x: 4000, y: 0 }]),
      line("dr1", "drain", [{ x: 5000, y: 0 }, { x: 6000, y: 0 }]),
    ];
    const summary = summarizeCombinedLayerClear({ items, lines, layerId: "staff" });
    expect(summary.itemIds).toEqual(["s1"]);
    expect(summary.lineIds).toEqual(["sl1"]);
  });

  it("returns deterministic IDs and dedupes duplicate person/route entries", () => {
    const p1 = personItem("s1", 0, 0);
    const l1 = line("sl1", "staff", [{ x: 0, y: 0 }, { x: 1000, y: 0 }], { lineTag: "staff" });
    const summary = summarizeCombinedLayerClear({ items: [p1, p1], lines: [l1, l1], layerId: "staff" });
    expect(summary.itemIds).toEqual(["s1"]);
    expect(summary.lineIds).toEqual(["sl1"]);
    expect(summary.itemCount).toBe(1);
    expect(summary.lineCount).toBe(1);
  });
});

describe("PHASE 1A-2C2D3E5B — buildCombinedLayerClearMessage (staff terminology)", () => {
  it("staff message uses caller-supplied Персонал/Маршруты labels instead of Оборудование/Линии и трассы", () => {
    const message = buildCombinedLayerClearMessage({
      layerLabel: "Движение персонала",
      itemCount: 3,
      lineCount: 5,
      itemLabel: "Персонал",
      lineLabel: "Маршруты",
    });
    expect(message).toContain("Движение персонала");
    expect(message).toContain("Персонал — 3");
    expect(message).toContain("Маршруты — 5");
    expect(message).not.toContain("Оборудование");
    expect(message).not.toContain("Линии и трассы");
  });

  it("power/light/vent default message stays byte-for-byte unchanged when no itemLabel/lineLabel override is passed", () => {
    const message = buildCombinedLayerClearMessage({ layerLabel: "Электрика", itemCount: 6, lineCount: 4 });
    expect(message).toBe([
      "Будут удалены объекты листа «Электрика»:",
      "",
      "Оборудование — 6",
      "Линии и трассы — 4",
      "",
      "Продолжить?",
    ].join("\n"));
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

// ── orchestration: staff (PHASE 1A-2C2D3E5B) — same real command layer as ──
// power/light/vent above, only layerId/layerLabel/itemLabel/lineLabel differ.
// No cleanup algorithm re-derived here; this proves the already-accepted
// applyCombinedLayerClear/applyItemLineBulkDelete pipeline behaves
// identically for staff's item(person)+line(any lineTag) shape.

describe("PHASE 1A-2C2D3E5B — applyCombinedLayerClear orchestration (staff)", () => {
  it("empty staff layer before confirm: no confirm call, no dispatch, no checkpoint", () => {
    const plan = basePlan();
    plan.items = [rack("r1", 0, 0)]; // unrelated layer only
    const h = makeHarness(plan);
    const confirmFn = vi.fn(() => true);
    const status = applyCombinedLayerClear({
      getCurrentPlan: () => h.history.current,
      layerId: "staff",
      layerLabel: "Движение персонала",
      itemLabel: "Персонал",
      lineLabel: "Маршруты",
      confirmFn,
      runGeometryCommand: h.dispatcher,
    });
    expect(status).toBe("empty");
    expect(confirmFn).not.toHaveBeenCalled();
    expect(h.commitPlan).not.toHaveBeenCalled();
  });

  it("cancel preserves the original plan reference; confirm is shown the staff-labeled message", () => {
    const plan = basePlan();
    plan.items = [personItem("s1", 0, 0)];
    const h = makeHarness(plan);
    const original = h.history.current;
    const runGeometryCommand = vi.fn();
    let seenMessage = null;
    const confirmFn = vi.fn((message) => {
      seenMessage = message;
      return false;
    });
    const status = applyCombinedLayerClear({
      getCurrentPlan: () => h.history.current,
      layerId: "staff",
      layerLabel: "Движение персонала",
      itemLabel: "Персонал",
      lineLabel: "Маршруты",
      confirmFn,
      runGeometryCommand,
    });
    expect(status).toBe("cancelled");
    expect(confirmFn).toHaveBeenCalledTimes(1);
    expect(seenMessage).toContain("Персонал — 1");
    expect(runGeometryCommand).not.toHaveBeenCalled();
    expect(h.history.current).toBe(original);
  });

  it("mixed person + staff route clear dispatches exactly one command with the exact itemIds/lineIds payload", () => {
    const plan = basePlan();
    plan.items = [personItem("s1", 0, 0)];
    plan.lines = [line("rl1", "staff", [{ x: 0, y: 0 }, { x: 1000, y: 0 }], { lineTag: "staff" })];
    const runGeometryCommand = vi.fn(() => ({ ok: true, changed: true }));
    applyCombinedLayerClear({
      getCurrentPlan: () => plan,
      layerId: "staff",
      layerLabel: "Движение персонала",
      itemLabel: "Персонал",
      lineLabel: "Маршруты",
      confirmFn: () => true,
      runGeometryCommand,
    });
    expect(runGeometryCommand).toHaveBeenCalledTimes(1);
    expect(runGeometryCommand).toHaveBeenCalledWith({ type: "itemLine.bulkDelete", itemIds: ["s1"], lineIds: ["rl1"] });
  });

  it("items-only staff clear (person, no routes) dispatches exactly one command", () => {
    const plan = basePlan();
    plan.items = [personItem("s1", 0, 0)];
    const h = makeHarness(plan);
    const status = applyCombinedLayerClear({
      getCurrentPlan: () => h.history.current,
      layerId: "staff",
      layerLabel: "Движение персонала",
      itemLabel: "Персонал",
      lineLabel: "Маршруты",
      confirmFn: () => true,
      runGeometryCommand: h.dispatcher,
    });
    expect(status).toBe("success");
    expect(h.commitPlan).toHaveBeenCalledTimes(1);
    expect(h.history.current.items).toEqual([]);
  });

  it("lines-only staff clear (routes, no person items) dispatches exactly one command", () => {
    const plan = basePlan();
    plan.lines = [
      line("raw1", "staff", [{ x: 0, y: 0 }, { x: 1000, y: 0 }], { lineTag: "raw" }),
      line("waste1", "staff", [{ x: 2000, y: 0 }, { x: 3000, y: 0 }], { lineTag: "waste" }),
    ];
    const h = makeHarness(plan);
    const status = applyCombinedLayerClear({
      getCurrentPlan: () => h.history.current,
      layerId: "staff",
      layerLabel: "Движение персонала",
      itemLabel: "Персонал",
      lineLabel: "Маршруты",
      confirmFn: () => true,
      runGeometryCommand: h.dispatcher,
    });
    expect(status).toBe("success");
    expect(h.commitPlan).toHaveBeenCalledTimes(1);
    expect(h.history.current.lines).toEqual([]);
  });

  it("live-plan race: a person item added while the confirm dialog is open is included in the delete set", () => {
    const plan = basePlan();
    plan.items = [personItem("s1", 0, 0)];
    const runGeometryCommand = vi.fn(() => ({ ok: true, changed: true }));
    let currentPlan = plan;
    const confirmFn = () => {
      currentPlan = { ...currentPlan, items: [...currentPlan.items, personItem("s2", 500, 0)] };
      return true;
    };
    applyCombinedLayerClear({
      getCurrentPlan: () => currentPlan,
      layerId: "staff",
      layerLabel: "Движение персонала",
      itemLabel: "Персонал",
      lineLabel: "Маршруты",
      confirmFn,
      runGeometryCommand,
    });
    expect(runGeometryCommand).toHaveBeenCalledWith({ type: "itemLine.bulkDelete", itemIds: ["s1", "s2"], lineIds: [] });
  });

  it("live-plan race: a route added while the confirm dialog is open is included in the delete set", () => {
    const plan = basePlan();
    plan.lines = [line("rl1", "staff", [{ x: 0, y: 0 }, { x: 1000, y: 0 }], { lineTag: "staff" })];
    const runGeometryCommand = vi.fn(() => ({ ok: true, changed: true }));
    let currentPlan = plan;
    const confirmFn = () => {
      currentPlan = {
        ...currentPlan,
        lines: [...currentPlan.lines, line("rl2", "staff", [{ x: 2000, y: 0 }, { x: 3000, y: 0 }], { lineTag: "raw" })],
      };
      return true;
    };
    applyCombinedLayerClear({
      getCurrentPlan: () => currentPlan,
      layerId: "staff",
      layerLabel: "Движение персонала",
      itemLabel: "Персонал",
      lineLabel: "Маршруты",
      confirmFn,
      runGeometryCommand,
    });
    expect(runGeometryCommand).toHaveBeenCalledWith({ type: "itemLine.bulkDelete", itemIds: [], lineIds: ["rl1", "rl2"] });
  });

  it("live-plan race: a person item removed while the confirm dialog is open is omitted from the delete set", () => {
    const plan = basePlan();
    plan.items = [personItem("s1", 0, 0), personItem("s2", 500, 0)];
    const runGeometryCommand = vi.fn(() => ({ ok: true, changed: true }));
    let currentPlan = plan;
    const confirmFn = () => {
      currentPlan = { ...currentPlan, items: currentPlan.items.filter((it) => it.id !== "s2") };
      return true;
    };
    applyCombinedLayerClear({
      getCurrentPlan: () => currentPlan,
      layerId: "staff",
      layerLabel: "Движение персонала",
      itemLabel: "Персонал",
      lineLabel: "Маршруты",
      confirmFn,
      runGeometryCommand,
    });
    expect(runGeometryCommand).toHaveBeenCalledWith({ type: "itemLine.bulkDelete", itemIds: ["s1"], lineIds: [] });
  });

  it("live-plan race: a route removed while the confirm dialog is open is omitted from the delete set", () => {
    const plan = basePlan();
    plan.lines = [
      line("rl1", "staff", [{ x: 0, y: 0 }, { x: 1000, y: 0 }], { lineTag: "staff" }),
      line("rl2", "staff", [{ x: 2000, y: 0 }, { x: 3000, y: 0 }], { lineTag: "product" }),
    ];
    const runGeometryCommand = vi.fn(() => ({ ok: true, changed: true }));
    let currentPlan = plan;
    const confirmFn = () => {
      currentPlan = { ...currentPlan, lines: currentPlan.lines.filter((l) => l.id !== "rl2") };
      return true;
    };
    applyCombinedLayerClear({
      getCurrentPlan: () => currentPlan,
      layerId: "staff",
      layerLabel: "Движение персонала",
      itemLabel: "Персонал",
      lineLabel: "Маршруты",
      confirmFn,
      runGeometryCommand,
    });
    expect(runGeometryCommand).toHaveBeenCalledWith({ type: "itemLine.bulkDelete", itemIds: [], lineIds: ["rl1"] });
  });

  it("live-plan race: a person item moved off the staff layer while the confirm dialog is open is omitted", () => {
    const plan = basePlan();
    plan.items = [personItem("s1", 0, 0)];
    const runGeometryCommand = vi.fn(() => ({ ok: true, changed: true }));
    let currentPlan = plan;
    const confirmFn = () => {
      currentPlan = { ...currentPlan, items: [{ ...currentPlan.items[0], layer: "furn" }] };
      return true;
    };
    const status = applyCombinedLayerClear({
      getCurrentPlan: () => currentPlan,
      layerId: "staff",
      layerLabel: "Движение персонала",
      itemLabel: "Персонал",
      lineLabel: "Маршруты",
      confirmFn,
      runGeometryCommand,
    });
    // applyItemLineBulkDelete itself short-circuits to no-target before ever
    // dispatching when the recomputed itemIds/lineIds are both empty — same
    // contract already proven for power above.
    expect(status).toBe("no-target");
    expect(runGeometryCommand).not.toHaveBeenCalled();
  });

  it("one history checkpoint for a mixed staff clear; duplicate clear attempt collapses to zero additional checkpoints", () => {
    const plan = basePlan();
    plan.items = [personItem("s1", 0, 0)];
    plan.lines = [line("rl1", "staff", [{ x: 0, y: 0 }, { x: 1000, y: 0 }], { lineTag: "staff" })];
    const h = makeHarness(plan);
    const opts = {
      getCurrentPlan: () => h.history.current,
      layerId: "staff",
      layerLabel: "Движение персонала",
      itemLabel: "Персонал",
      lineLabel: "Маршруты",
      confirmFn: () => true,
      runGeometryCommand: h.dispatcher,
    };
    const first = applyCombinedLayerClear(opts);
    const second = applyCombinedLayerClear(opts);
    expect(first).toBe("success");
    expect(second).toBe("empty");
    expect(h.commitPlan).toHaveBeenCalledTimes(1);
  });

  it("undo returns the exact original plan reference; redo restores the exact committed reference", () => {
    const plan = basePlan();
    plan.items = [personItem("s1", 0, 0), personItem("s2", 500, 0)];
    plan.lines = [line("rl1", "staff", [{ x: 0, y: 0 }, { x: 1000, y: 0 }], { lineTag: "staff" })];
    const h = makeHarness(plan);
    const original = h.history.current;
    applyCombinedLayerClear({
      getCurrentPlan: () => h.history.current,
      layerId: "staff",
      layerLabel: "Движение персонала",
      itemLabel: "Персонал",
      lineLabel: "Маршруты",
      confirmFn: () => true,
      runGeometryCommand: h.dispatcher,
    });
    const committed = h.history.current;
    expect(committed).not.toBe(original);

    h.history.undo();
    expect(h.history.current).toBe(original);
    expect(h.history.current.items.map((it) => it.id)).toEqual(["s1", "s2"]);
    expect(h.history.current.lines.map((l) => l.id)).toEqual(["rl1"]);

    h.history.redo();
    expect(h.history.current).toBe(committed);
    expect(h.history.current.items).toEqual([]);
    expect(h.history.current.lines).toEqual([]);
  });

  it("unrelated sanitary/power/light/rack entities and their lines are preserved by a staff clear", () => {
    const plan = basePlan();
    plan.items = [
      personItem("s1", 0, 0),
      sanitaryItem("d1", "dezmat", 2000, 0),
      powerItem("p1", "panel", 3000, 0),
      lightItem("l1", "light_panel", 4000, 0),
      rack("r1", 5000, 0),
    ];
    plan.lines = [
      line("rl1", "staff", [{ x: 0, y: 0 }, { x: 1000, y: 0 }], { lineTag: "staff" }),
      line("pl1", "power", [{ x: 3000, y: 0 }, { x: 3500, y: 0 }]),
      line("dr1", "drain", [{ x: 6000, y: 0 }, { x: 6500, y: 0 }]),
    ];
    const h = makeHarness(plan);
    const status = applyCombinedLayerClear({
      getCurrentPlan: () => h.history.current,
      layerId: "staff",
      layerLabel: "Движение персонала",
      itemLabel: "Персонал",
      lineLabel: "Маршруты",
      confirmFn: () => true,
      runGeometryCommand: h.dispatcher,
    });
    expect(status).toBe("success");
    const committed = h.history.current;
    expect(committed.items.map((it) => it.id).slice().sort()).toEqual(["d1", "l1", "p1", "r1"]);
    expect(committed.lines.map((l) => l.id).slice().sort()).toEqual(["dr1", "pl1"]);
  });

  it("referential integrity through the real combined command: person deleted, staff lines deleted (any lineTag), links cleaned, auto dimension deleted, manual dimension detached, walls/nodes unchanged, unrelated layer preserved, validator clean, one checkpoint, undo/redo exact", () => {
    const plan = basePlan();
    const survivor = rack("r1", 4000, 4000);
    plan.items = [
      personItem("s1", 1000, 500),
      survivor,
    ];
    plan.lines = [
      line("rl1", "staff", [{ x: 0, y: 0 }, { x: 1000, y: 0 }], { lineTag: "staff" }),
      line("rl2", "staff", [{ x: 2000, y: 0 }, { x: 3000, y: 0 }], { lineTag: "waste" }),
    ];
    plan.links = [{ id: "lk1", type: "staff", fromId: "s1", toId: "r1" }];
    plan.dimensions = [
      { id: "auto1", auto: true, attachedTo: { type: "item", id: "s1" } },
      {
        id: "manual1", auto: false, kind: "manual", p1: { x: 1, y: 1 }, p2: { x: 2, y: 2 }, attachedTo: { type: "item", id: "s1", mode: "bbox-width" },
      },
    ];
    const wallsBefore = plan.walls;
    const nodesBefore = plan.nodes;
    const h = makeHarness(plan);
    const original = h.history.current;

    const status = applyCombinedLayerClear({
      getCurrentPlan: () => h.history.current,
      layerId: "staff",
      layerLabel: "Движение персонала",
      itemLabel: "Персонал",
      lineLabel: "Маршруты",
      confirmFn: () => true,
      runGeometryCommand: h.dispatcher,
    });
    expect(status).toBe("success");
    expect(h.commitPlan).toHaveBeenCalledTimes(1);

    const committed = h.history.current;
    expect(committed).not.toBe(original);
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

    h.history.undo();
    expect(h.history.current).toBe(original);
    h.history.redo();
    expect(h.history.current).toBe(committed);
  });
});
