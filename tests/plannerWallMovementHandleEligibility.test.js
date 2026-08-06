/**
 * PHASE 2E FOLLOW-UP 1 (M3) — the movement handle appears for every wall the
 * move command can actually move.
 *
 * Reported: some selected walls show the move icon and drag, others show
 * nothing and cannot be dragged. Cause (measured, not guessed): PlanPage
 * rendered outer walls and partitions as two groups and gated WallEl on
 *   editable={active === "room"/"partitions" && tool === "select"}
 * — the ACTIVE LAYER — while the selection hit area beside it was gated only
 * on the tool. Every wall was therefore selectable from any layer, but only
 * walls whose role matched the active layer got a handle.
 *
 * These tests drive the shipped decision helper and the shipped WallEl, and
 * cross-check every verdict against the real moveWallSegment: the handle must
 * be shown exactly where the command reports changed:true.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { wallMoveHandleEligibility, moveHandleDisabledText, MOVE_HANDLE_REASON } from "../src/planner/core/walls/wallMoveEligibility.js";
import { moveWallSegment, classifyWallSegmentAttachments } from "../src/planner/core/walls/wallCommands.js";
import { WallEl } from "../src/planner/canvasPrimitives.jsx";

let seq = 0;
const makeId = (p = "id") => `${p}_${++seq}`;
const WBASE = { thk: 100, role: "partition", kind: "new", thicknessSide: "center", height: 3000, material: "", type: "wall" };

function plan(nodes, walls) {
  return {
    nodes,
    walls: walls.map((w) => ({ ...WBASE, ...w })),
    items: [], rooms: [], zones: [], links: [], labels: [], lines: [],
    dimensions: [], validationWarnings: [],
    room: { w: 30000, h: 20000, wallThk: 100, height: 3000 },
  };
}

/** free wall, degree-2 corner, ordinary T (host halves + branch), oblique */
function fixture() {
  return plan({
    f1: { x: 1000, y: 1000 }, f2: { x: 5000, y: 1000 },          // free wall
    c1: { x: 1000, y: 3000 }, c2: { x: 5000, y: 3000 }, c3: { x: 5000, y: 6000 }, // corner
    h1: { x: 1000, y: 9000 }, hm: { x: 5000, y: 9000 }, h2: { x: 9000, y: 9000 }, // T host
    br: { x: 5000, y: 13000 },                                    // T branch
    o1: { x: 12000, y: 1000 }, o2: { x: 16000, y: 5000 },         // oblique free
  }, [
    { id: "free", a: "f1", b: "f2" },
    { id: "cornerA", a: "c1", b: "c2" }, { id: "cornerB", a: "c2", b: "c3" },
    { id: "hostL", a: "h1", b: "hm" }, { id: "hostR", a: "hm", b: "h2" },
    { id: "branch", a: "hm", b: "br" },
    { id: "oblique", a: "o1", b: "o2", role: "outer" },
  ]);
}

/** A degree-4 crossing — moveWallSegment must fail closed here. */
function crossFixture() {
  return plan({
    x0: { x: 20000, y: 9000 }, xc: { x: 24000, y: 9000 }, x1: { x: 28000, y: 9000 },
    y0: { x: 24000, y: 5000 }, y1: { x: 24000, y: 13000 },
  }, [
    { id: "cw", a: "x0", b: "xc" }, { id: "ce", a: "xc", b: "x1" },
    { id: "cn", a: "y0", b: "xc" }, { id: "cs", a: "xc", b: "y1" },
  ]);
}

/**
 * A wall tee'd to a horizontal host at one end and a VERTICAL host at the other.
 * The two constraints cross, so no translation satisfies both.
 */
function crossingHostsFixture() {
  return plan({
    h0: { x: 0, y: 0 }, hm: { x: 4000, y: 0 }, h1: { x: 8000, y: 0 },
    v0: { x: 12000, y: 3000 }, vm: { x: 12000, y: 7000 }, v1: { x: 12000, y: 11000 },
  }, [
    { id: "hL", a: "h0", b: "hm" }, { id: "hR", a: "hm", b: "h1" },
    { id: "vT", a: "v0", b: "vm" }, { id: "vB", a: "vm", b: "v1" },
    { id: "span", a: "hm", b: "vm" },
  ]);
}

/** Does the shipped command actually move it? */
function commandMoves(p, wallId, delta = { x: 130, y: 90 }) {
  const r = moveWallSegment(p, { wallId, delta, makeId });
  return { changed: !!r?.changed, reason: r?.reason, plan: r?.plan };
}

/** Sweep the whole circle — "movable" must never rest on one arbitrary delta. */
function anyDirectionMoves(p, wallId, steps = 36) {
  const refusals = new Set();
  for (let i = 0; i < steps; i++) {
    const a = (Math.PI * 2 * i) / steps;
    const r = moveWallSegment(p, { wallId, delta: { x: Math.cos(a) * 200, y: Math.sin(a) * 200 }, makeId });
    if (r?.changed) return { moves: true, refusals };
    refusals.add(r?.reason);
  }
  return { moves: false, refusals };
}

const SAFE = ["free", "cornerA", "cornerB", "hostL", "hostR", "branch", "oblique"];

describe("M3 — eligibility matches what the move command can actually do", () => {
  for (const id of SAFE) {
    it(`${id}: handle is offered AND the command moves it`, () => {
      const p = fixture();
      const e = wallMoveHandleEligibility(p, id, { tool: "select" });
      const cmd = commandMoves(p, id);
      expect(cmd.changed, `${id}: command refused with ${cmd.reason}`).toBe(true);
      expect(e.eligible, `${id}: command moves it but the handle was withheld (${e.reason})`).toBe(true);
      expect(e.reason).toBe(MOVE_HANDLE_REASON.OK);
    });
  }

  it("13. a degree-4 crossing arm stays fail-closed, and the handle agrees", () => {
    const p = crossFixture();
    for (const id of ["cw", "ce", "cn", "cs"]) {
      const e = wallMoveHandleEligibility(p, id, { tool: "select" });
      const cmd = commandMoves(p, id);
      expect(cmd.changed, `${id} should be refused`).toBe(false);
      expect(e.eligible, `${id} should not offer a handle`).toBe(false);
      expect(e.reason).toBe(MOVE_HANDLE_REASON.UNSAFE_MULTI_JUNCTION);
    }
  });

  it("a wall between two CROSSING hosts has no free direction, so no handle", () => {
    const p = crossingHostsFixture();
    const att = classifyWallSegmentAttachments(p, "span");
    expect(att.start.type, "fixture must really tee at both ends").toBe("tee");
    expect(att.end.type).toBe("tee");
    // the command refuses EVERY direction, not just an unlucky one
    const swept = anyDirectionMoves(p, "span");
    expect(swept.moves, "fixture is supposed to be immovable").toBe(false);
    expect([...swept.refusals]).toEqual(["WALL_MOVE_INCOMPATIBLE_HOST_CONSTRAINTS"]);
    const e = wallMoveHandleEligibility(p, "span", { tool: "select" });
    expect(e.eligible, "a handle here would be a promise the command cannot keep").toBe(false);
    expect(e.reason).toBe(MOVE_HANDLE_REASON.INCOMPATIBLE_HOST_CONSTRAINTS);
    expect(moveHandleDisabledText(e.reason)).toBeTruthy();
  });

  it("a single host still leaves one degree of freedom — the handle stays", () => {
    // the trap this must not fall into: probing ONE delta. A T-branch may only
    // slide along its host, so a perpendicular probe reports NO_CHANGE while the
    // wall is perfectly movable along the host.
    const p = fixture();
    const perpendicular = commandMoves(p, "branch", { x: 0, y: 200 });
    expect(perpendicular.changed, "perpendicular probe is expected to be a no-op").toBe(false);
    expect(perpendicular.reason).toBe("NO_CHANGE");
    expect(anyDirectionMoves(p, "branch").moves).toBe(true);
    expect(wallMoveHandleEligibility(p, "branch", { tool: "select" }).eligible).toBe(true);
  });

  it("every wall offered a handle really does move in SOME direction", () => {
    const p = fixture();
    for (const w of p.walls) {
      const e = wallMoveHandleEligibility(p, w.id, { tool: "select" });
      if (!e.eligible) continue;
      expect(anyDirectionMoves(p, w.id).moves, `${w.id} was offered a handle but never moves`).toBe(true);
    }
  });

  it("14. a withheld handle always carries a deterministic, human reason", () => {
    const p = crossFixture();
    const e = wallMoveHandleEligibility(p, "cw", { tool: "select" });
    expect(e.eligible).toBe(false);
    expect(moveHandleDisabledText(e.reason)).toBeTruthy();
    // deterministic
    expect(wallMoveHandleEligibility(p, "cw", { tool: "select" }).reason).toBe(e.reason);
  });

  it("the eligibility probe never mutates the plan", () => {
    const p = fixture();
    const before = JSON.stringify(p);
    for (const w of p.walls) wallMoveHandleEligibility(p, w.id, { tool: "select" });
    expect(JSON.stringify(p)).toBe(before);
  });

  it("a locked wall withholds the handle with its own reason", () => {
    const p = fixture();
    p.walls.find((w) => w.id === "free").locked = true;
    const e = wallMoveHandleEligibility(p, "free", { tool: "select" });
    expect(e.eligible).toBe(false);
    expect(e.reason).toBe(MOVE_HANDLE_REASON.WALL_LOCKED);
  });

  it("no handle while a non-select tool owns the pointer", () => {
    const p = fixture();
    for (const tool of ["wall", "erase", "dimension", "door"]) {
      const e = wallMoveHandleEligibility(p, "free", { tool });
      expect(e.eligible, tool).toBe(false);
      expect(e.reason).toBe(MOVE_HANDLE_REASON.TOOL_NOT_SELECT);
    }
  });

  it("7. the wall's role/layer is NOT part of the decision", () => {
    // the regression itself: same geometry, different role, same verdict
    const p = fixture();
    const asPartition = wallMoveHandleEligibility(p, "free", { tool: "select" });
    p.walls.find((w) => w.id === "free").role = "outer";
    const asOuter = wallMoveHandleEligibility(p, "free", { tool: "select" });
    expect(asOuter.eligible).toBe(asPartition.eligible);
    expect(asOuter.eligible).toBe(true);
  });

  it("15. eligibility survives a reload (plain JSON round-trip)", () => {
    const p = fixture();
    const reloaded = JSON.parse(JSON.stringify(p));
    for (const id of SAFE) {
      expect(wallMoveHandleEligibility(reloaded, id, { tool: "select" }).eligible,
        `${id} after reload`).toBe(true);
    }
  });

  it("22. the verdict does not depend on wall array order", () => {
    const p = fixture();
    const rev = { ...p, walls: [...p.walls].reverse() };
    for (const id of SAFE) {
      expect(wallMoveHandleEligibility(rev, id, { tool: "select" }).eligible, id)
        .toBe(wallMoveHandleEligibility(p, id, { tool: "select" }).eligible);
    }
  });
});

// --- what the component actually renders -----------------------------------

const P2 = (w) => ({ ...w, pts: [w.a, w.b] });
const wallEl = (props) => renderToStaticMarkup(React.createElement(WallEl, {
  k: 1, room: { w: 30000, h: 20000 }, fmtU: (v) => `${v}`, showDims: false,
  onSel: () => {}, onNode: () => {}, onDel: () => {}, onMidNode: () => {},
  ...props,
}));
/** the move handle carries its own data-ui hook, so endpoint node handles
 *  (which also use a move cursor) cannot be mistaken for it */
const countMoveCursors = (html) => (html.match(/data-ui="wall-move-handle"/g) || []).length;

const straight = P2({ id: "w", thk: 100, role: "partition", a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } });

describe("M3 — WallEl renders the handle from `movable`, not from the layer", () => {
  it("a selected wall on a NON-active layer still gets its handle", () => {
    // editable=false is exactly what PlanPage passed for an off-layer wall
    const html = wallEl({ wall: straight, editable: false, movable: true, selected: true });
    expect(countMoveCursors(html)).toBeGreaterThan(0);
  });

  it("an ineligible wall gets no handle even on the active layer", () => {
    const html = wallEl({ wall: straight, editable: true, movable: false, selected: true });
    expect(countMoveCursors(html)).toBe(0);
  });

  it("no handle unless the wall is selected or hovered", () => {
    expect(countMoveCursors(wallEl({ wall: straight, editable: true, movable: true, selected: false })))
      .toBe(0);
    expect(countMoveCursors(wallEl({ wall: straight, editable: true, movable: true, hovered: true })))
      .toBeGreaterThan(0);
  });

  it("omitting `movable` preserves the old editable-driven behaviour", () => {
    expect(countMoveCursors(wallEl({ wall: straight, editable: true, selected: true }))).toBeGreaterThan(0);
    expect(countMoveCursors(wallEl({ wall: straight, editable: false, selected: true }))).toBe(0);
  });

  it("9. the handle's pointer target calls onMidNode, which is what opens the transaction", () => {
    let called = 0;
    const el = React.createElement(WallEl, {
      wall: straight, k: 1, editable: false, movable: true, selected: true,
      room: { w: 30000, h: 20000 }, fmtU: (v) => `${v}`, showDims: false,
      onSel: () => {}, onNode: () => {}, onDel: () => {},
      onMidNode: () => { called += 1; },
    });
    const html = renderToStaticMarkup(el);
    expect(html).toContain("cursor:move");
    // the handler identity is what PlanPage binds to startWallMidNode
    expect(typeof el.props.onMidNode).toBe("function");
    el.props.onMidNode({}, straight);
    expect(called).toBe(1);
  });

  it("8. WallMassLayer paints with pointerEvents disabled, so it cannot steal the hit-test", () => {
    // the mass layer is decoration; selection and handles belong to the
    // canonical interaction layer
    const src = readFileSync(new URL("../src/planner/wallRender.jsx", import.meta.url), "utf8");
    const layer = src.slice(src.indexOf("export function WallMassLayer"));
    expect(layer).toContain('pointerEvents="none"');
  });
});

describe("M3 — mouse and keyboard agree", () => {
  it("11./12. the same delta through the command gives the same plan either way", () => {
    const p = fixture();
    const viaMouse = commandMoves(p, "branch", { x: 150, y: 90 });
    const viaArrows = commandMoves(p, "branch", { x: 150, y: 90 });
    expect(viaMouse.changed).toBe(true);
    expect(viaArrows.changed).toBe(true);
    // compare GEOMETRY, not the id-keyed map: each call mints its own node ids
    const coords = (r) => Object.values(r.plan.nodes)
      .map((n) => `${n.x.toFixed(4)},${n.y.toFixed(4)}`).sort().join(" ");
    expect(coords(viaArrows)).toBe(coords(viaMouse));
  });

  it("10. probing eligibility and previewing a move leave the committed plan untouched", () => {
    const p = fixture();
    const before = JSON.stringify(p);
    wallMoveHandleEligibility(p, "branch", { tool: "select" });
    commandMoves(p, "branch", { x: 150, y: 90 });   // returns a NEW plan
    expect(JSON.stringify(p)).toBe(before);
  });
});
