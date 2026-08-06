/**
 * PHASE 2D — right mouse button cancels wall drawing and returns to Select.
 *
 * Two shipped pieces are driven directly: contextMenuActionFor, the routing the
 * PlanPage onContextMenu handler is a one-liner around, and the real wall-draw
 * controller together with the real HistoryModel and the real autosave bridge,
 * so "no plan change / no history step / no write" is measured rather than
 * asserted about a copy of the logic.
 */
import { describe, it, expect, vi } from "vitest";
import {
  contextMenuActionFor,
  CONTEXT_MENU_ACTION,
  wallDrawV2SnapToTopologyIntent,
} from "../src/pages/admin/PlanPage.jsx";
import { createWallDrawController } from "../src/planner/core/session/index.js";
import { HistoryModel } from "../src/planner/core/history/historyModel.js";
import { createPlanAutosaveBridge } from "../src/planner/core/history/planAutosaveBridge.js";
import { commitDrawnWall } from "../src/planner/core/walls/wallDrawTopology.js";
import { materializeWallCommand } from "../src/planner/core/walls/applyWallCommand.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";

const P = (x, y) => ({ x, y });
const W = { thk: 100, role: "outer", kind: "new", thicknessSide: "center", height: 3000, material: "" };

function basePlan() {
  return {
    nodes: { n1: P(0, 3000), n2: P(6000, 3000) },
    walls: [{ id: "w1", a: "n1", b: "n2", ...W }],
    items: [], rooms: [], zones: [], links: [], labels: [], lines: [],
    dimensions: [], validationWarnings: [],
    room: { w: 20000, h: 15000, wallThk: 100, height: 3000 },
  };
}

const flushAsync = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0)); };

function manualScheduler() {
  let queue = [];
  return {
    schedule: (fn) => { const h = { fn, cancelled: false }; queue.push(h); return h; },
    cancelSchedule: (h) => { h.cancelled = true; },
    flush: () => { const run = queue.filter((h) => !h.cancelled); queue = []; run.forEach((h) => h.fn()); },
  };
}

/**
 * PlanPage's V2 wiring without React: pointerdown / pointermove / pointerup,
 * plus the one cancel action the right button triggers.
 */
function harness() {
  const scheduler = manualScheduler();
  const persistFn = vi.fn(async () => ({ ok: true }));
  const identity = { mode: "project", id: "p1" };
  const history = new HistoryModel(basePlan());
  const bridge = createPlanAutosaveBridge({
    persistFn, debounceMs: 700,
    schedule: scheduler.schedule, cancelSchedule: scheduler.cancelSchedule,
  });
  bridge.beginHydration(identity);
  bridge.completeHydration(identity, history.current);

  let ids = 0;
  const makeId = (p) => `${p}_${++ids}`;
  // Transient UI state the cancel action must clear, mirrored by name.
  const ui = { tool: "wall", activeToolId: "wall_draw", draftSnap: null, angleSnap: null, guides: [], ctxMenu: null, typedLength: "" };
  let releasedPointer = null;

  const controller = createWallDrawController({
    commitSegment: (segment) => {
      const base = history.current;
      const r = commitDrawnWall(base, segment.start, segment.end, { ...W, chainId: makeId("ch") }, makeId, {
        startIntent: wallDrawV2SnapToTopologyIntent(segment.startSnap, segment.start),
        endIntent: wallDrawV2SnapToTopologyIntent(segment.endSnap, segment.end),
      });
      if (!r.changed) return;
      const mat = materializeWallCommand(base, r);
      if (!mat.changed) return;
      history.commitFrom(base, mat.plan);
      bridge.observePlan(identity, history.current);
    },
  });

  const down = (pt, pointerId = 1) => {
    controller.begin({ point: pt, snap: null, pointerId, now: 1 });
    ui.draftSnap = { snapped: true };
    ui.guides = [{ type: "axis" }];
  };
  const move = (pt, pointerId = 1) => {
    controller.preview(controller.getTxId(), { point: pt, snap: null, pointerId });
  };
  const up = () => controller.commit(controller.getTxId());

  /** The PlanPage action, same order of operations. */
  const rightClick = () => {
    const action = contextMenuActionFor(ui.tool, "room");
    if (action !== CONTEXT_MENU_ACTION.CANCEL_AND_SELECT) return action;
    const pointerId = controller.getPointerId();
    if (pointerId != null) releasedPointer = pointerId;
    controller.cancel();
    ui.ctxMenu = null;
    ui.draftSnap = null;
    ui.angleSnap = null;
    ui.typedLength = "";
    ui.guides = [];
    ui.tool = "select";
    ui.activeToolId = "select";
    return action;
  };

  return {
    controller, history, bridge, scheduler, persistFn, ui,
    down, move, up, rightClick,
    releasedPointer: () => releasedPointer,
    writes: () => persistFn.mock.calls.length,
    fingerprint: () => JSON.stringify({
      nodes: history.current.nodes,
      walls: (history.current.walls || []).map((w) => `${w.id}:${w.a}>${w.b}`).sort(),
    }),
  };
}

describe("PHASE 2D / 2F1 — right-click routing", () => {
  it("2./3. the wall tool routes the right button to cancel-and-select, drawing or idle", () => {
    expect(contextMenuActionFor("wall", "room")).toBe(CONTEXT_MENU_ACTION.CANCEL_AND_SELECT);
  });

  it("non-select tools cancel to Select (no menu)", () => {
    for (const tool of ["add", "line", "measure", "erase", "label", "pan", "structural", "wall"]) {
      expect(contextMenuActionFor(tool, "room")).toBe(CONTEXT_MENU_ACTION.CANCEL_AND_SELECT);
    }
  });

  it("selected wall: first RMB cancels, opens no menu", () => {
    expect(contextMenuActionFor("select", "room", {
      selection: { coll: "walls", id: "a_t" },
    })).toBe(CONTEXT_MENU_ACTION.CANCEL_AND_SELECT);
  });

  it("inspector open: first RMB cancels", () => {
    expect(contextMenuActionFor("select", "room", { inspectorOpen: true }))
      .toBe(CONTEXT_MENU_ACTION.CANCEL_AND_SELECT);
  });

  it("neutral Select may open context menu", () => {
    expect(contextMenuActionFor("select", "room", {})).toBe(CONTEXT_MENU_ACTION.CONTEXT_MENU);
  });

  it("the spec layer keeps its existing opt-out", () => {
    expect(contextMenuActionFor("wall", "spec")).toBe(CONTEXT_MENU_ACTION.NONE);
    expect(contextMenuActionFor("select", "spec")).toBe(CONTEXT_MENU_ACTION.NONE);
  });
});

describe("PHASE 2D — right-click during an active preview", () => {
  it("1./7. the preview and the guides are gone", () => {
    const h = harness();
    h.down(P(1000, 0));
    h.move(P(1000, 6000));
    expect(h.controller.getPreview()).not.toBeNull();

    h.rightClick();
    expect(h.controller.getPreview()).toBeNull();
    expect(h.controller.isActive()).toBe(false);
    expect(h.ui.guides).toEqual([]);
    expect(h.ui.draftSnap).toBeNull();
    expect(h.ui.angleSnap).toBeNull();
  });

  it("2. the tool becomes Select", () => {
    const h = harness();
    h.down(P(1000, 0));
    h.move(P(1000, 6000));
    h.rightClick();
    expect(h.ui.tool).toBe("select");
    expect(h.ui.activeToolId).toBe("select");
  });

  it("4./5./6. plan, history and autosave are untouched", () => {
    const h = harness();
    const before = h.fingerprint();
    const stepsBefore = h.history.past.length;

    h.down(P(1000, 0));
    h.move(P(1000, 6000));
    h.rightClick();
    h.scheduler.flush();

    expect(h.fingerprint()).toBe(before);
    expect(h.history.past.length).toBe(stepsBefore);
    expect(h.history.canUndo).toBe(false);
    expect(h.writes()).toBe(0);
  });

  it("8. the captured pointer is released and the session id is retired", () => {
    const h = harness();
    h.down(P(1000, 0), 77);
    h.move(P(1000, 6000), 77);
    const txBefore = h.controller.getTxId();

    h.rightClick();
    expect(h.releasedPointer()).toBe(77);
    expect(h.controller.getPointerId()).toBeNull();
    // A stale move for the retired transaction can no longer steer anything.
    expect(h.controller.preview(txBefore, { point: P(9000, 9000), pointerId: 77 })).toBe(false);
    expect(h.controller.getPreview()).toBeNull();
  });

  it("11. repeated right-clicks are idempotent", () => {
    const h = harness();
    h.down(P(1000, 0));
    h.move(P(1000, 6000));
    const before = h.fingerprint();

    for (let i = 0; i < 4; i++) h.rightClick();
    h.scheduler.flush();

    expect(h.controller.getPreview()).toBeNull();
    expect(h.ui.tool).toBe("select");
    expect(h.fingerprint()).toBe(before);
    expect(h.writes()).toBe(0);
  });

  it("3./12./13./14. right-click with no drawing at all still switches to Select and writes nothing", () => {
    const h = harness();
    const before = h.fingerprint();
    expect(h.controller.isActive()).toBe(false);

    h.rightClick();
    h.scheduler.flush();

    expect(h.ui.tool).toBe("select");
    expect(h.fingerprint()).toBe(before);
    expect(h.writes()).toBe(0);
  });

  it("16. the next gesture cannot inherit the cancelled start point", () => {
    const h = harness();
    h.down(P(1000, 0));
    h.move(P(1000, 6000));
    h.rightClick();

    // Back in the wall tool, a fresh press starts its own wall.
    h.ui.tool = "wall";
    h.down(P(4000, 0));
    expect(h.controller.getPreview().start).toEqual(P(4000, 0));
  });
});

describe("PHASE 2D — the normal release path is unaffected", () => {
  it("18. a committed release leaves the session idle and the wall tool active", async () => {
    const h = harness();
    h.down(P(1000, 0));
    h.move(P(1000, 6000));
    const r = h.up();
    h.scheduler.flush();
    await flushAsync();

    expect(r.committed).toBe(true);
    expect(h.controller.isActive()).toBe(false);
    expect(h.ui.tool).toBe("wall");
    expect(h.history.past.length).toBe(1);
    expect(h.writes()).toBe(1);
  });

  it("a cancel after a commit cannot undo the wall that was just created", async () => {
    const h = harness();
    h.down(P(1000, 0));
    h.move(P(1000, 6000));
    h.up();
    const after = h.fingerprint();

    h.scheduler.flush();
    await flushAsync();
    h.ui.tool = "wall";
    h.rightClick();
    h.scheduler.flush();
    await flushAsync();

    expect(h.fingerprint()).toBe(after);
    expect(resolvePlanWalls(h.history.current).length).toBeGreaterThan(1);
    expect(h.writes()).toBe(1);
  });
});
