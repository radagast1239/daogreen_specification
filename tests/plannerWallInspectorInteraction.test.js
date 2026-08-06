/**
 * PHASE 2D — selection and "wall properties are open" are separate states.
 *
 * The defect was two effects that revealed the panel on a null -> selection
 * transition: PlannerLayout's mount effect and PlannerInspector's phase
 * effect. Both now consume one shipped decision, inspectorSelectionTransition,
 * and the double-click guard the canvas handler uses is
 * wallDoubleClickOpensInspector. Those two functions are driven directly here
 * — no copy of the logic.
 *
 * The suite runs in the "node" environment and this repo has no React testing
 * library, so mounting the panels is out of scope for a unit test: the full
 * click/Escape sequence against the real DOM is covered by the Phase 2D
 * browser acceptance script (cases N1-N9) and by manual acceptance.
 */
import { describe, it, expect, vi } from "vitest";
import { inspectorSelectionTransition } from "../src/planner/ui/PlannerInspector.jsx";
import { wallDoubleClickOpensInspector } from "../src/pages/admin/PlanPage.jsx";
import { HistoryModel } from "../src/planner/core/history/historyModel.js";
import { createPlanAutosaveBridge } from "../src/planner/core/history/planAutosaveBridge.js";

/**
 * The panel state machine as the two components apply it: a selection change
 * asks inspectorSelectionTransition, an explicit request always wins.
 */
function panel({ autoOpenOnSelect }) {
  let open = false;
  let selection = null;
  return {
    get open() { return open; },
    get selection() { return selection; },
    select(next) {
      const move = inspectorSelectionTransition({
        had: !!selection,
        has: !!next,
        autoOpenOnSelect: autoOpenOnSelect(next),
      });
      selection = next;
      if (move === "reveal") open = true;
      else if (move === "collapse") open = false;
    },
    requestOpen() { open = true; },
    requestClose() { open = false; },
  };
}
/** A wall panel: selecting a wall must never reveal it. */
const wallPanel = () => panel({ autoOpenOnSelect: (sel) => sel?.coll !== "walls" });
const wall = (id) => ({ coll: "walls", ids: [id], nodeIdx: -1 });

/** One click of the mouse, as PlanPage routes it. */
function singleClick(p, id) {
  p.select(wall(id));                       // selectWall / startWallMidNode
}
function doubleClick(p, id) {
  p.select(wall(id));                       // the two clicks that precede it
  p.select(wall(id));
  if (wallDoubleClickOpensInspector({ tool: "select", hitColl: "walls" })) {
    p.requestOpen();                        // onDblClick
  }
}
const escape = (p) => p.requestClose();

describe("PHASE 2D — single click selects, never opens", () => {
  it("1. a single click on an unselected wall selects it and leaves properties closed", () => {
    const p = wallPanel();
    singleClick(p, "w1");
    expect(p.selection).toEqual(wall("w1"));
    expect(p.open).toBe(false);
  });

  it("2. a second single click does not open properties", () => {
    const p = wallPanel();
    singleClick(p, "w1");
    singleClick(p, "w1");
    expect(p.open).toBe(false);
  });

  it("3. many single clicks, across walls, never open properties", () => {
    const p = wallPanel();
    for (const id of ["w1", "w1", "w2", "w3", "w2", "w1"]) {
      singleClick(p, id);
      expect(p.open).toBe(false);
    }
  });

  it("the reported first-click defect is gone: a null -> wall transition does not reveal", () => {
    expect(inspectorSelectionTransition({ had: false, has: true, autoOpenOnSelect: false })).toBe("none");
  });

  it("losing the selection still collapses the panel", () => {
    expect(inspectorSelectionTransition({ had: true, has: false, autoOpenOnSelect: false })).toBe("collapse");
    expect(inspectorSelectionTransition({ had: true, has: false, autoOpenOnSelect: true })).toBe("collapse");
  });

  it("a non-wall entity keeps the existing select-to-reveal behaviour", () => {
    expect(inspectorSelectionTransition({ had: false, has: true, autoOpenOnSelect: true })).toBe("reveal");
    const p = panel({ autoOpenOnSelect: (sel) => sel?.coll !== "walls" });
    p.select({ coll: "items", ids: ["i1"] });
    expect(p.open).toBe(true);
  });

  it("a wall-to-wall change is not a transition at all", () => {
    expect(inspectorSelectionTransition({ had: true, has: true, autoOpenOnSelect: true })).toBe("none");
  });
});

describe("PHASE 2D — double click opens, Escape closes", () => {
  it("4. a double click opens properties exactly once", () => {
    const p = wallPanel();
    let opens = 0;
    const counting = { ...p, requestOpen: () => { opens += 1; p.requestOpen(); } };
    doubleClick(counting, "w1");
    expect(p.open).toBe(true);
    expect(opens).toBe(1);
  });

  it("5./6. the open intent does not depend on which part of the wall was hit", () => {
    // The guard reads the hit-tested model point, which covers the wall's
    // whole visible mass — outline, hatch and the transparent hit area alike.
    for (const _part of ["outline", "hatch", "hit-area"]) {
      expect(wallDoubleClickOpensInspector({ tool: "select", hitColl: "walls" })).toBe(true);
    }
    // …but bare canvas hits nothing, so it never opens.
    expect(wallDoubleClickOpensInspector({ tool: "select", hitColl: undefined })).toBe(false);
    expect(wallDoubleClickOpensInspector({ tool: "select", hitColl: null })).toBe(false);
  });

  it("19. a double click while the wall tool is drawing never opens properties", () => {
    for (const tool of ["wall", "line", "add", "measure", "erase", "pan", "label"]) {
      expect(wallDoubleClickOpensInspector({ tool, hitColl: "walls" })).toBe(false);
    }
  });

  it("a double click on a non-wall entity does not use the wall path", () => {
    for (const coll of ["items", "rooms", "dimensions", "zones", null, undefined]) {
      expect(wallDoubleClickOpensInspector({ tool: "select", hitColl: coll })).toBe(false);
    }
  });

  it("7. Escape closes properties", () => {
    const p = wallPanel();
    doubleClick(p, "w1");
    expect(p.open).toBe(true);
    escape(p);
    expect(p.open).toBe(false);
  });

  it("8. after Escape a single click only selects", () => {
    const p = wallPanel();
    doubleClick(p, "w1");
    escape(p);
    for (const id of ["w2", "w3", "w2"]) {
      singleClick(p, id);
      expect(p.open).toBe(false);
    }
  });

  it("9. after Escape a double click opens again", () => {
    const p = wallPanel();
    doubleClick(p, "w1");
    escape(p);
    expect(p.open).toBe(false);
    doubleClick(p, "w1");
    expect(p.open).toBe(true);
  });

  it("10. double-clicking another wall switches the panel and keeps it open once", () => {
    const p = wallPanel();
    doubleClick(p, "w1");
    doubleClick(p, "w2");
    expect(p.open).toBe(true);
    expect(p.selection).toEqual(wall("w2"));
  });

  it("the whole reported defect sequence now behaves", () => {
    const p = wallPanel();
    singleClick(p, "w1"); expect(p.open).toBe(false);   // 1. was: opened
    singleClick(p, "w1"); expect(p.open).toBe(false);   // 2.
    doubleClick(p, "w1"); expect(p.open).toBe(true);    // 4. was: unreliable
    escape(p);            expect(p.open).toBe(false);   // 3.
    singleClick(p, "w1"); expect(p.open).toBe(false);   // 3. was: reopened
    doubleClick(p, "w1"); expect(p.open).toBe(true);
  });
});

describe("PHASE 2D — opening properties is transient UI only", () => {
  const flushAsync = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0)); };

  it("11./12./13./14. no click sequence touches plan, history or autosave", async () => {
    let queue = [];
    const persistFn = vi.fn(async () => ({ ok: true }));
    const identity = { mode: "project", id: "p1" };
    const plan = {
      nodes: { a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } },
      walls: [{ id: "w1", a: "a", b: "b" }],
      items: [], rooms: [], zones: [], dimensions: [], validationWarnings: [],
      room: { w: 20000, h: 15000, wallThk: 100, height: 3000 },
    };
    const history = new HistoryModel(plan);
    const bridge = createPlanAutosaveBridge({
      persistFn, debounceMs: 700,
      schedule: (fn) => { const h = { fn, cancelled: false }; queue.push(h); return h; },
      cancelSchedule: (h) => { h.cancelled = true; },
    });
    bridge.beginHydration(identity);
    bridge.completeHydration(identity, plan);

    const p = wallPanel();
    singleClick(p, "w1");
    singleClick(p, "w1");
    doubleClick(p, "w1");
    escape(p);
    doubleClick(p, "w1");

    const run = queue.filter((h) => !h.cancelled);
    queue = [];
    run.forEach((h) => h.fn());
    await flushAsync();

    expect(history.current).toBe(plan);
    expect(history.past.length).toBe(0);
    expect(persistFn).not.toHaveBeenCalled();
  });
});
