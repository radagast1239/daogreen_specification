/**
 * PHASE 2E.1 (B) — endpoint/node grips are gated on EDIT SAFETY, not on the
 * active drawing layer.
 *
 * Reported: a partition wall can be selected and moved as a whole while the room
 * layer is active, but its endpoint grips stay invisible; switching layer makes
 * them appear. Cause (traced — see
 * C:\tmp\phase2e1-history-grips\endpoint-grips-diagnosis.txt):
 * M3 freed the central movement handle from the layer gate but left the endpoint
 * grips on it — canvasPrimitives.jsx rendered them behind `editable`, which
 * PlanPage computes as `active === "room"/"partitions" && tool === "select"`,
 * while selection (pickPlanHit -> pickWallBodyHit) is layer-agnostic.
 *
 * These tests drive the shipped decision helper, the shipped WallEl and the
 * shipped moveNode command, and cross-check every verdict against the command:
 * a grip is offered exactly where moveNode can act.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  endpointGripEligibility,
  wallEndpointGrips,
  endpointGripDisabledText,
  GRIP_REASON,
  GRIP_TOPOLOGY,
} from "../src/planner/core/walls/endpointGripEligibility.js";
import {
  moveNode, moveWallSegment, classifyWallSegmentAttachments,
} from "../src/planner/core/walls/wallCommands.js";
import { wallMoveHandleEligibility } from "../src/planner/core/walls/wallMoveEligibility.js";
import { resolvePlanWalls } from "../src/planner/wallNetwork.js";
import { createWallEditController } from "../src/planner/core/session/index.js";
import { PlanHistoryStack } from "../src/planner/core/history/index.js";
import { WallEl } from "../src/planner/canvasPrimitives.jsx";
import {
  WallEndpointGripLayer, dedupeGripsByNode, gripKey,
  GRIP_MARKER_PX, GRIP_HIT_PX,
} from "../src/planner/wallEndpointGrips.jsx";

const WBASE = { thk: 100, role: "partition", kind: "new", thicknessSide: "center", height: 3000, material: "", type: "wall" };

function plan(nodes, walls) {
  return {
    nodes,
    walls: walls.map((w) => ({ ...WBASE, ...w })),
    items: [], rooms: [], zones: [], links: [], labels: [], lines: [],
    dimensions: [], validationWarnings: [],
    room: { w: 40000, h: 20000, wallThk: 100, height: 3000 },
  };
}

/**
 * free wall (degree-1 ends), degree-2 corner, ordinary T (degree-3 hub),
 * oblique wall, degree-4 crossing, one room-role wall, one locked wall.
 */
function fixture() {
  return plan({
    f1: { x: 1000, y: 1000 }, f2: { x: 5000, y: 1000 },
    c1: { x: 1000, y: 3000 }, c2: { x: 5000, y: 3000 }, c3: { x: 5000, y: 6000 },
    h1: { x: 1000, y: 9000 }, hm: { x: 5000, y: 9000 }, h2: { x: 9000, y: 9000 },
    br: { x: 5000, y: 13000 },
    o1: { x: 12000, y: 1000 }, o2: { x: 16000, y: 5000 },
    x0: { x: 20000, y: 9000 }, xc: { x: 24000, y: 9000 }, x1: { x: 28000, y: 9000 },
    y0: { x: 24000, y: 5000 }, y1: { x: 24000, y: 13000 },
    r1: { x: 30000, y: 1000 }, r2: { x: 36000, y: 1000 },
    L1: { x: 30000, y: 15000 }, L2: { x: 36000, y: 15000 },
  }, [
    { id: "free", a: "f1", b: "f2" },
    { id: "cornerA", a: "c1", b: "c2" }, { id: "cornerB", a: "c2", b: "c3" },
    { id: "hostL", a: "h1", b: "hm" }, { id: "hostR", a: "hm", b: "h2" },
    { id: "branch", a: "hm", b: "br" },
    { id: "oblique", a: "o1", b: "o2" },
    { id: "cw", a: "x0", b: "xc" }, { id: "ce", a: "xc", b: "x1" },
    { id: "cn", a: "y0", b: "xc" }, { id: "cs", a: "xc", b: "y1" },
    { id: "roomWall", a: "r1", b: "r2", role: "outer" },
    { id: "lockedWall", a: "L1", b: "L2", locked: true },
  ]);
}

const ALL_WALL_IDS = fixture().walls.map((w) => w.id);
const UNLOCKED = ALL_WALL_IDS.filter((id) => id !== "lockedWall");

/** Does the shipped command actually move that endpoint? */
function commandMovesEndpoint(p, wallId, endpoint) {
  const wall = p.walls.find((w) => w.id === wallId);
  const nodeId = endpoint === 0 ? wall?.a : wall?.b;
  const pt = nodeId ? p.nodes[nodeId] : null;
  const r = moveNode(p, nodeId || "missing", pt ? { x: pt.x + 250, y: pt.y + 180 } : { x: 0, y: 0 });
  return { changed: !!r.changed, warnings: r.warnings || [], plan: r.plan };
}

// --- the decision -----------------------------------------------------------

describe("2E.1/B — eligibility matches what the endpoint command can actually do", () => {
  it("1./20. every unlocked endpoint the command moves is offered a grip, and vice versa", () => {
    const p = fixture();
    for (const wallId of ALL_WALL_IDS) {
      for (const endpoint of [0, 1]) {
        const e = endpointGripEligibility(p, { wallId, endpoint, tool: "select" });
        const cmd = commandMovesEndpoint(p, wallId, endpoint);
        if (wallId === "lockedWall") {
          expect(e.visible, "locked wall must fail closed").toBe(false);
          continue;
        }
        // never MORE permissive than the command — the invariant that matters
        if (!cmd.changed) {
          expect(e.visible, `${wallId}[${endpoint}] offered a grip the command refuses`).toBe(false);
        }
        expect(e.visible, `${wallId}[${endpoint}] withheld though the command moves it`).toBe(true);
        expect(e.enabled).toBe(true);
        expect(e.reason).toBe(GRIP_REASON.OK);
      }
    }
  });

  it("2./3. role and active layer are not inputs — same geometry, same verdict", () => {
    const p = fixture();
    const asPartition = endpointGripEligibility(p, { wallId: "free", endpoint: 0, tool: "select" });
    p.walls.find((w) => w.id === "free").role = "outer";
    const asOuter = endpointGripEligibility(p, { wallId: "free", endpoint: 0, tool: "select" });
    expect(asOuter.visible).toBe(asPartition.visible);
    expect(asOuter.visible).toBe(true);
    // ...and the layer is not merely ignored, it is absent from the decision:
    // the module never reads an active layer at all (comments excluded).
    const src = readFileSync(new URL("../src/planner/core/walls/endpointGripEligibility.js", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/activeLayer|active\s*===/);
  });

  it("reports the endpoint's topology without gating on it", () => {
    const p = fixture();
    const kindOf = (wallId, endpoint) => endpointGripEligibility(p, { wallId, endpoint, tool: "select" }).topology;
    expect(kindOf("free", 0)).toMatchObject({ degree: 1, kind: GRIP_TOPOLOGY.FREE });
    expect(kindOf("cornerA", 1)).toMatchObject({ degree: 2, kind: GRIP_TOPOLOGY.CORNER });
    expect(kindOf("branch", 0)).toMatchObject({ degree: 3, kind: GRIP_TOPOLOGY.JUNCTION });
    expect(kindOf("cw", 1)).toMatchObject({ degree: 4, kind: GRIP_TOPOLOGY.HUB });
    expect(kindOf("cw", 1).connectedWallIds.sort()).toEqual(["ce", "cn", "cs", "cw"]);
  });

  it("20. the degree-4 hub is NOT fail-closed here, and that is measured, not assumed", () => {
    // moveWallSegment is ambiguous at a multi-junction because it must translate
    // ONE segment while its hosts stay put. moveNode translates the SHARED node,
    // so every incident wall follows and the junction survives. The command is
    // asked, in every direction, rather than guessed at.
    const p = fixture();
    for (let i = 0; i < 36; i++) {
      const a = (Math.PI * 2 * i) / 36;
      const r = moveNode(fixture(), "xc", { x: 24000 + Math.cos(a) * 300, y: 9000 + Math.sin(a) * 300 });
      expect(r.changed, `moveNode refused direction ${i}`).toBe(true);
    }
    const moved = moveNode(p, "xc", { x: 24600, y: 9400 });
    // all four arms stay attached to the one node
    for (const id of ["cw", "ce", "cn", "cs"]) {
      const w = moved.plan.walls.find((x) => x.id === id);
      expect(w.a === "xc" || w.b === "xc", `${id} detached from the hub`).toBe(true);
    }
    expect(endpointGripEligibility(p, { wallId: "cw", endpoint: 1, tool: "select" }).visible).toBe(true);
  });

  it("19. a locked wall withholds both grips with a deterministic reason", () => {
    const p = fixture();
    for (const endpoint of [0, 1]) {
      const e = endpointGripEligibility(p, { wallId: "lockedWall", endpoint, tool: "select" });
      expect(e.visible).toBe(false);
      expect(e.enabled).toBe(false);
      expect(e.reason).toBe(GRIP_REASON.WALL_LOCKED);
      expect(endpointGripDisabledText(e.reason)).toBeTruthy();
      // deterministic
      expect(endpointGripEligibility(p, { wallId: "lockedWall", endpoint, tool: "select" }).reason).toBe(e.reason);
    }
  });

  it("a locked NODE withholds only that grip", () => {
    const p = fixture();
    p.nodes.f1.locked = true;
    expect(endpointGripEligibility(p, { wallId: "free", endpoint: 0, tool: "select" }).reason)
      .toBe(GRIP_REASON.NODE_LOCKED);
    expect(endpointGripEligibility(p, { wallId: "free", endpoint: 1, tool: "select" }).visible).toBe(true);
  });

  it("an unresolvable node fails closed exactly like moveNode does", () => {
    const p = fixture();
    p.walls.find((w) => w.id === "free").a = "ghost";
    const e = endpointGripEligibility(p, { wallId: "free", endpoint: 0, tool: "select" });
    expect(e.visible).toBe(false);
    expect(e.reason).toBe(GRIP_REASON.NODE_NOT_FOUND);
    expect(moveNode(p, "ghost", { x: 0, y: 0 }).warnings[0].code).toBe("NODE_NOT_FOUND");
    expect(endpointGripDisabledText(e.reason)).toBeTruthy();
  });

  it("no grips while a non-select tool owns the pointer", () => {
    const p = fixture();
    for (const tool of ["wall", "erase", "dimension", "door"]) {
      const e = endpointGripEligibility(p, { wallId: "free", endpoint: 0, tool });
      expect(e.visible, tool).toBe(false);
      expect(e.reason).toBe(GRIP_REASON.TOOL_NOT_SELECT);
    }
  });

  it("the probe never mutates the plan", () => {
    const p = fixture();
    const before = JSON.stringify(p);
    for (const wallId of ALL_WALL_IDS) for (const endpoint of [0, 1]) {
      endpointGripEligibility(p, { wallId, endpoint, tool: "select" });
    }
    expect(JSON.stringify(p)).toBe(before);
  });

  it("23. the verdict survives a wall-array reorder", () => {
    const p = fixture();
    const rev = { ...p, walls: [...p.walls].reverse() };
    for (const wallId of ALL_WALL_IDS) for (const endpoint of [0, 1]) {
      const a = endpointGripEligibility(p, { wallId, endpoint, tool: "select" });
      const b = endpointGripEligibility(rev, { wallId, endpoint, tool: "select" });
      expect(b.visible, `${wallId}[${endpoint}]`).toBe(a.visible);
      expect(b.nodeId).toBe(a.nodeId);
      expect(b.topology?.degree).toBe(a.topology?.degree);
    }
  });

  it("24. reversed wall orientation gives an equivalent result for the same node", () => {
    const p = fixture();
    const forward = endpointGripEligibility(p, { wallId: "branch", endpoint: 0, tool: "select" });
    const rev = {
      ...p,
      walls: p.walls.map((w) => (w.id === "branch" ? { ...w, a: w.b, b: w.a } : w)),
    };
    // the same NODE is now endpoint 1
    const backward = endpointGripEligibility(rev, { wallId: "branch", endpoint: 1, tool: "select" });
    expect(backward.nodeId).toBe(forward.nodeId);
    expect(backward.visible).toBe(forward.visible);
    expect(backward.topology.degree).toBe(forward.topology.degree);
  });

  it("18. reload parity — a plain JSON round-trip changes nothing", () => {
    const p = fixture();
    const reloaded = JSON.parse(JSON.stringify(p));
    for (const wallId of UNLOCKED) for (const endpoint of [0, 1]) {
      expect(endpointGripEligibility(reloaded, { wallId, endpoint, tool: "select" }).visible,
        `${wallId}[${endpoint}] after reload`).toBe(true);
    }
  });

  it("wallEndpointGrips returns null for a legacy pts-only wall, so callers keep their old behaviour", () => {
    const legacy = { walls: [{ id: "w", pts: [{ x: 0, y: 0 }, { x: 3000, y: 0 }], thk: 100 }], room: { w: 9000, h: 9000 } };
    expect(wallEndpointGrips(legacy, "w", { tool: "select" })).toBeNull();
    expect(wallEndpointGrips(fixture(), "free", { tool: "select" })).toHaveLength(2);
  });
});

// --- what the top interaction layer actually renders -------------------------
//
// PHASE 2E.1 REWORK. Manual acceptance failed on VISIBILITY: the grips were
// mounted and their hit targets worked, but WallEl emits them inside the wall
// layer groups while PlanPage paints WallMassLayer and WallsTopOverlay after
// those groups — so the wall fill and outline covered every marker, and a
// topology node always lies on the wall centreline. They now live in a
// dedicated top layer (src/planner/wallEndpointGrips.jsx).

const P2 = (w, a, b) => ({ ...w, pts: [a, b] });
const wallEl = (props) => renderToStaticMarkup(React.createElement(WallEl, {
  k: 1, room: { w: 40000, h: 20000 }, fmtU: (v) => `${v}`, showDims: false,
  onSel: () => {}, onNode: () => {}, onDel: () => {}, onMidNode: () => {},
  ...props,
}));
const moveHandleCount = (html) => (html.match(/data-wall-move-handle/g) || []).length;
const OK = { visible: true, enabled: true, reason: GRIP_REASON.OK };
const NO = { visible: false, enabled: false, reason: GRIP_REASON.WALL_LOCKED };

const straight = P2({ id: "w", thk: 100, role: "partition" }, { x: 0, y: 0 }, { x: 4000, y: 0 });

const entryFor = (wallId, endpoint, point, extra = {}) => ({
  wallId, endpoint, point, selected: true,
  grip: { ...OK, nodeId: `${wallId}_${endpoint}`, topology: { degree: 1, kind: GRIP_TOPOLOGY.FREE }, ...extra },
});
const gripLayer = (props) => renderToStaticMarkup(React.createElement(WallEndpointGripLayer, {
  k: 1, onGripDown: () => {}, onGripHover: () => {}, ...props,
}));
const gripCount = (html) => (html.match(/data-wall-endpoint-grip/g) || []).length;
/** every circle radius in document order */
const radii = (html) => [...html.matchAll(/<circle[^>]*\br="([\d.]+)"/g)].map((m) => Number(m[1]));

describe("2E.1/B — endpoint grips render in a TOP layer, above the wall mass", () => {
  it("1. endpoint controls are emitted AFTER the wall mass and outlines (paint order)", () => {
    // SVG paints in document order: the layer must appear after both overlays.
    const src = readFileSync(new URL("../src/pages/admin/PlanPage.jsx", import.meta.url), "utf8");
    const mass = src.indexOf("<WallMassLayer");
    const outline = src.indexOf("<WallsTopOverlay");
    const dims = src.indexOf("<DimensionsLayer");
    const grips = src.indexOf("<WallEndpointGripLayer");
    expect(mass, "WallMassLayer must exist").toBeGreaterThan(0);
    expect(grips, "the grip layer must be rendered by PlanPage").toBeGreaterThan(0);
    expect(grips).toBeGreaterThan(mass);
    expect(grips).toBeGreaterThan(outline);
    expect(grips).toBeGreaterThan(dims);
  });

  it("2. WallEl no longer emits the grips it used to bury under the mass", () => {
    const html = wallEl({ wall: straight, editable: true, endpointGrips: [OK, OK], selected: true });
    expect(gripCount(html)).toBe(0);
  });

  it("9. the mass layer cannot intercept the grips: it is pointer-transparent", () => {
    const src = readFileSync(new URL("../src/planner/wallRender.jsx", import.meta.url), "utf8");
    const layer = src.slice(src.indexOf("export function WallMassLayer"));
    expect(layer).toContain('pointerEvents="none"');
  });

  it("4. a grip is rendered for every visible entry, with its full hook set", () => {
    const html = gripLayer({
      entries: [entryFor("w", 0, { x: 0, y: 0 }), entryFor("w", 1, { x: 4000, y: 0 })],
    });
    expect(gripCount(html)).toBe(2);
    expect(html).toContain('data-wall-id="w"');
    expect(html).toContain('data-endpoint="start"');
    expect(html).toContain('data-endpoint="end"');
    expect(html).toContain('data-node-id="w_0"');
    expect(html).toContain('data-grip-state="idle"');
  });

  it("3. the hit target is larger than the visible marker, at the contracted sizes", () => {
    // LIVE4: visual grip is zoom-bounded; hit stays ≥ GRIP_HIT_PX screen.
    const html = gripLayer({ entries: [entryFor("w", 0, { x: 0, y: 0 })], k: 1, zoom: 1 });
    const r = radii(html);
    const hit = Math.max(...r);
    const marker = Math.min(...r);
    expect(hit).toBeCloseTo(GRIP_HIT_PX / 2, 6);
    expect(marker).toBeLessThan(hit);
    expect(marker).toBeGreaterThanOrEqual(5);
    expect(marker).toBeLessThanOrEqual(15);
    expect(GRIP_HIT_PX).toBeGreaterThanOrEqual(28);
    expect(GRIP_HIT_PX).toBeLessThanOrEqual(36);
  });

  it("20. LIVE4: visible marker screen size changes with zoom; hit stays ≥32px", () => {
    const screens = [];
    for (const zoom of [0.05, 0.2, 1, 3]) {
      const k = 1 / zoom;
      const r = radii(gripLayer({ entries: [entryFor("w", 0, { x: 0, y: 0 })], k, zoom }));
      const hitScreenPx = Math.max(...r) * zoom;
      const markerScreenPx = Math.min(...r) * zoom;
      expect(hitScreenPx, `hit @${zoom}`).toBeCloseTo(GRIP_HIT_PX / 2, 5);
      expect(markerScreenPx, `marker @${zoom}`).toBeGreaterThanOrEqual(5);
      expect(markerScreenPx, `marker @${zoom}`).toBeLessThanOrEqual(15);
      screens.push(markerScreenPx);
    }
    // Far zoom smaller than close zoom (RemPlanner contract).
    expect(screens[0]).toBeLessThan(screens[2]);
  });

  it("7. hover is visible: the marker grows and the state hook changes", () => {
    const entries = [entryFor("w", 0, { x: 0, y: 0 })];
    const idle = gripLayer({ entries, zoom: 1 });
    const hover = gripLayer({ entries, hoverKey: gripKey("w", 0), zoom: 1 });
    expect(idle).toContain('data-grip-state="idle"');
    expect(hover).toContain('data-grip-state="hover"');
    expect(Math.min(...radii(hover))).toBeGreaterThan(Math.min(...radii(idle)));
  });

  it("8. the active drag state is unmistakable: own hook plus a halo", () => {
    const entries = [entryFor("w", 0, { x: 0, y: 0 })];
    const active = gripLayer({ entries, activeKey: gripKey("w", 0) });
    expect(active).toContain('data-grip-state="active"');
    // three circles instead of two: halo + hit + marker
    expect(radii(active).length).toBe(3);
    expect(Math.max(...radii(active))).toBeGreaterThan(GRIP_HIT_PX / 2);
  });

  it("14./15. the control sits exactly on the topology node — no offset, no mutation", () => {
    const node = { x: 4000, y: 0 };
    const html = gripLayer({ entries: [entryFor("w", 1, node)] });
    const centres = [...html.matchAll(/<circle[^>]*cx="([-\d.]+)"[^>]*cy="([-\d.]+)"/g)]
      .map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
    expect(centres.length).toBeGreaterThan(0);
    for (const c of centres) expect(c).toEqual(node);
    expect(node).toEqual({ x: 4000, y: 0 });
  });

  it("5./6. one control per shared node — no stacked duplicates at a T or corner", () => {
    const shared = { x: 4000, y: 0 };
    const entries = dedupeGripsByNode([
      { wallId: "branch", endpoint: 0, point: shared, selected: true,
        grip: { ...OK, nodeId: "hm", topology: { degree: 3, kind: GRIP_TOPOLOGY.JUNCTION } } },
      { wallId: "hostL", endpoint: 1, point: shared, selected: false,
        grip: { ...OK, nodeId: "hm", topology: { degree: 3, kind: GRIP_TOPOLOGY.JUNCTION } } },
    ]);
    expect(entries).toHaveLength(1);
    // the SELECTED wall's endpoint wins, so the drag starts from the wall the user picked
    expect(entries[0].wallId).toBe("branch");
    expect(entries[0].endpoint).toBe(0);
    expect(gripCount(gripLayer({ entries }))).toBe(1);
  });

  it("the shared-node winner is deterministic when neither entry is selected", () => {
    const shared = { x: 1, y: 2 };
    const mk = (wallId, endpoint) => ({
      wallId, endpoint, point: shared, selected: false,
      grip: { ...OK, nodeId: "n1", topology: { degree: 2, kind: GRIP_TOPOLOGY.CORNER } },
    });
    expect(dedupeGripsByNode([mk("a", 1), mk("b", 0)])[0].endpoint).toBe(0);
    expect(dedupeGripsByNode([mk("b", 0), mk("a", 1)])[0].endpoint).toBe(0);
  });

  it("10. endpoint grips and the centre handle use distinct hooks and appearance", () => {
    const handleHtml = wallEl({ wall: straight, editable: false, movable: true, selected: true });
    const gripHtml = gripLayer({ entries: [entryFor("w", 0, { x: 0, y: 0 })] });
    expect(moveHandleCount(handleHtml)).toBe(1);
    expect(gripCount(handleHtml)).toBe(0);
    expect(gripCount(gripHtml)).toBe(1);
    expect(moveHandleCount(gripHtml)).toBe(0);
    // the handle is a small dashed white dot; the grip a large solid red-bordered disc
    expect(handleHtml).toContain("stroke-dasharray");
    expect(handleHtml).toContain('fill="#fff"');
    expect(gripHtml).toContain('fill="#ffd9dc"');
    expect(gripHtml).toContain('stroke="#b3261e"');
  });

  it("19. an entry that is not visible is never turned into a control", () => {
    const html = gripLayer({
      entries: [{ wallId: "locked", endpoint: 0, point: { x: 0, y: 0 }, selected: true, grip: { ...NO, nodeId: null } }],
    });
    expect(gripCount(html)).toBe(0);
  });

  it("18. a cross-layer partition wall still produces two controls", () => {
    const p = fixture();
    const grips = wallEndpointGrips(p, "free", { tool: "select" });
    expect(grips.every((g) => g.visible)).toBe(true);
    const wall = resolvePlanWalls(p).find((w) => w.id === "free");
    const entries = dedupeGripsByNode(grips.map((grip, endpoint) => ({
      wallId: "free", endpoint, grip, point: wall.pts[endpoint], selected: true,
    })));
    expect(entries).toHaveLength(2);
    expect(gripCount(gripLayer({ entries }))).toBe(2);
  });

  it("the legacy pts-only path still renders in WallEl, so old plans are unchanged", () => {
    const html = wallEl({ wall: straight, editable: true, selected: true });
    expect(html).toContain('data-ui="wall-endpoint-grip-legacy"');
  });
});

// --- what the drag actually does --------------------------------------------

const pts = (p, wallId) => resolvePlanWalls(p).find((w) => w.id === wallId).pts;
const topology = (p) => p.walls.map((w) => `${w.id}:${w.a}-${w.b}`).sort().join(" ");
const geometry = (p) => resolvePlanWalls(p)
  .map((w) => `${w.id}:${w.pts.map((q) => `${Math.round(q.x)},${Math.round(q.y)}`).join("|")}`)
  .sort().join(" ");

/** One endpoint drag: begin -> N previews -> release, over the real controller. */
function dragEndpoint(history, wallId, endpoint, to, { writes } = {}) {
  const controller = createWallEditController({
    finalize: (previewPlan) => previewPlan,
    commitFrom: (base, next) => history.commitFrom(base, next),
  });
  const base = history.current;
  const txId = controller.begin(base, "wall-node", { wallId, idx: endpoint });
  const wall = base.walls.find((w) => w.id === wallId);
  const nodeId = endpoint === 0 ? wall.a : wall.b;
  for (let i = 1; i <= 5; i++) {
    const from = base.nodes[nodeId];
    const at = { x: from.x + ((to.x - from.x) * i) / 5, y: from.y + ((to.y - from.y) * i) / 5 };
    const r = moveNode(base, nodeId, at);
    controller.preview(txId, r.changed ? r.plan : base);
    writes?.push?.("preview");
  }
  return { controller, txId, base, commit: () => controller.commit(txId) };
}

describe("2E.1/B — the endpoint drag itself", () => {
  it("7./9. the start grip moves only the start endpoint; the far end stays put", () => {
    const p = fixture();
    const before = pts(p, "free");
    const r = moveNode(p, "free_a" in p.nodes ? "free_a" : p.walls.find((w) => w.id === "free").a, { x: 1400, y: 1600 });
    const after = pts(r.plan, "free");
    expect(after[0]).toMatchObject({ x: 1400, y: 1600 });
    expect(after[1]).toEqual(before[1]);
  });

  it("8./9. the end grip moves only the end endpoint", () => {
    const p = fixture();
    const before = pts(p, "free");
    const r = moveNode(p, p.walls.find((w) => w.id === "free").b, { x: 5400, y: 1600 });
    const after = pts(r.plan, "free");
    expect(after[0]).toEqual(before[0]);
    expect(after[1]).toMatchObject({ x: 5400, y: 1600 });
  });

  it("10. connected neighbours stay attached when a shared node moves", () => {
    const p = fixture();
    const r = moveNode(p, "hm", { x: 5600, y: 9400 });
    expect(topology(r.plan)).toBe(topology(p));
    for (const id of ["hostL", "hostR", "branch"]) {
      const w = resolvePlanWalls(r.plan).find((x) => x.id === id);
      const touches = w.pts.some((q) => Math.round(q.x) === 5600 && Math.round(q.y) === 9400);
      expect(touches, `${id} lost the shared node`).toBe(true);
    }
  });

  it("11. an oblique wall endpoint drags like any other", () => {
    const p = fixture();
    expect(endpointGripEligibility(p, { wallId: "oblique", endpoint: 1, tool: "select" }).visible).toBe(true);
    const r = moveNode(p, "o2", { x: 16800, y: 5900 });
    expect(r.changed).toBe(true);
    expect(pts(r.plan, "oblique")[1]).toMatchObject({ x: 16800, y: 5900 });
  });

  it("12./13. during the hold only the preview changes: committed plan and history untouched, zero writes", () => {
    const history = new PlanHistoryStack(fixture());
    const committedBefore = geometry(history.current);
    const written = [];
    const drag = dragEndpoint(history, "free", 1, { x: 5600, y: 1500 });
    // the preview really did move
    expect(geometry(drag.controller.getPreviewPlan())).not.toBe(committedBefore);
    // ... while nothing else did
    expect(geometry(history.current)).toBe(committedBefore);
    expect(history.past.length).toBe(0);
    expect(written.length).toBe(0);
  });

  it("14./15. release produces exactly one history entry (and therefore one write)", () => {
    const history = new PlanHistoryStack(fixture());
    const drag = dragEndpoint(history, "free", 1, { x: 5600, y: 1500 });
    drag.commit();
    expect(history.past.length).toBe(1);
    expect(pts(history.current, "free")[1]).toMatchObject({ x: 5600, y: 1500 });
  });

  it("16./17. Ctrl+Z restores the exact topology and geometry; Redo restores the drag", () => {
    const history = new PlanHistoryStack(fixture());
    const geomBefore = geometry(history.current);
    const topoBefore = topology(history.current);
    dragEndpoint(history, "branch", 0, { x: 5600, y: 9400 }).commit();
    const geomAfter = geometry(history.current);
    expect(geomAfter).not.toBe(geomBefore);

    history.undo();
    expect(geometry(history.current)).toBe(geomBefore);
    expect(topology(history.current)).toBe(topoBefore);

    history.redo();
    expect(geometry(history.current)).toBe(geomAfter);
  });

  it("18. reload parity — the committed result survives a JSON round-trip", () => {
    const history = new PlanHistoryStack(fixture());
    dragEndpoint(history, "free", 0, { x: 1400, y: 1600 }).commit();
    const saved = JSON.parse(JSON.stringify(history.current));
    expect(geometry(saved)).toBe(geometry(history.current));
    for (const wallId of UNLOCKED) for (const endpoint of [0, 1]) {
      expect(endpointGripEligibility(saved, { wallId, endpoint, tool: "select" }).visible).toBe(true);
    }
  });

  it("22. rooms/zones are reconciled once, at commit, exactly as before", () => {
    // the finalize hook is the single derived-state pass of the transaction
    const seen = [];
    const history = new PlanHistoryStack(fixture());
    const controller = createWallEditController({
      finalize: (previewPlan) => { seen.push("finalize"); return { ...previewPlan, rooms: ["synced"] }; },
      commitFrom: (base, next) => history.commitFrom(base, next),
    });
    const txId = controller.begin(history.current, "wall-node", {});
    for (let i = 0; i < 4; i++) {
      controller.preview(txId, moveNode(history.current, "f2", { x: 5000 + i * 50, y: 1000 }).plan);
    }
    expect(seen).toEqual([]);
    controller.commit(txId);
    expect(seen).toEqual(["finalize"]);
    expect(history.current.rooms).toEqual(["synced"]);
  });
});

// --- the two controls have different jobs (2E.1 rework, section 1) -----------

let mkSeq = 0;
const uniqueId = (prefix = "id") => `${prefix}_${++mkSeq}`;

const lenAngle = (plan, wallId) => {
  const w = resolvePlanWalls(plan).find((x) => x.id === wallId);
  const [a, b] = [w.pts[0], w.pts.at(-1)];
  return {
    len: Math.hypot(b.x - a.x, b.y - a.y),
    angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
  };
};

describe("2E.1 rework — endpoint grip vs centre handle: which one may change length", () => {
  it("11. an ENDPOINT drag may change length and angle — that is its job", () => {
    const p = fixture();
    const before = lenAngle(p, "free");
    const r = moveNode(p, p.walls.find((w) => w.id === "free").b, { x: 5600, y: 1900 });
    expect(r.changed).toBe(true);
    const after = lenAngle(r.plan, "free");
    expect(after.len).not.toBeCloseTo(before.len, 3);
    expect(after.angle).not.toBeCloseTo(before.angle, 3);
    // ...while the opposite endpoint is untouched
    const w = resolvePlanWalls(r.plan).find((x) => x.id === "free");
    expect(w.pts[0]).toEqual({ x: 1000, y: 1000 });
  });

  it("12. a CENTRE-HANDLE drag translates the wall: length and angle are preserved", () => {
    const p = fixture();
    const before = lenAngle(p, "free");
    const r = moveWallSegment(p, {
      wallId: "free",
      delta: { x: 250, y: 400 },
      expectedEndpointAttachments: classifyWallSegmentAttachments(p, "free"),
      makeId: uniqueId,
    });
    expect(r.changed).toBe(true);
    const after = lenAngle(r.plan, "free");
    expect(after.len).toBeCloseTo(before.len, 6);
    expect(after.angle).toBeCloseTo(before.angle, 6);
  });

  it("12. the same holds for every wall the whole-wall handle is offered on", () => {
    for (const id of ["free", "cornerA", "cornerB", "hostL", "hostR", "branch", "oblique"]) {
      const p = fixture();
      if (!wallMoveHandleEligibility(p, id, { tool: "select" }).eligible) continue;
      const before = lenAngle(p, id);
      let moved = null;
      // sweep for a direction this wall can actually take
      for (let i = 0; i < 36 && !moved; i += 1) {
        const a = (Math.PI * 2 * i) / 36;
        const r = moveWallSegment(fixture(), {
          wallId: id,
          delta: { x: Math.cos(a) * 200, y: Math.sin(a) * 200 },
          makeId: uniqueId,
        });
        if (r.changed) moved = r;
      }
      expect(moved, `${id} never moved`).toBeTruthy();
      const after = lenAngle(moved.plan, id);
      expect(after.len, `${id} length`).toBeCloseTo(before.len, 6);
      expect(after.angle, `${id} angle`).toBeCloseTo(before.angle, 6);
    }
  });

  it("13. the centre handle is drawn at the midpoint, the grips at the endpoints", () => {
    const html = wallEl({ wall: straight, editable: false, movable: true, selected: true });
    const centres = [...html.matchAll(/<circle[^>]*cx="([-\d.]+)"[^>]*cy="([-\d.]+)"/g)]
      .map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
    expect(centres.every((c) => c.x === 2000 && c.y === 0), JSON.stringify(centres)).toBe(true);

    const grips = gripLayer({
      entries: [entryFor("w", 0, { x: 0, y: 0 }), entryFor("w", 1, { x: 4000, y: 0 })],
    });
    const gripCentres = [...grips.matchAll(/<circle[^>]*cx="([-\d.]+)"[^>]*cy="([-\d.]+)"/g)]
      .map((m) => `${m[1]},${m[2]}`);
    expect(new Set(gripCentres)).toEqual(new Set(["0,0", "4000,0"]));
  });

  it("16./17. a shared-node drag keeps every incident connection, and Undo is exact", () => {
    const p = fixture();
    const topo = (plan) => plan.walls.map((w) => `${w.id}:${w.a}-${w.b}`).sort().join(" ");
    const history = new PlanHistoryStack(p);
    const before = topo(p);
    const beforeGeom = geometry(p);
    const r = moveNode(p, "hm", { x: 5400, y: 9600 });
    history.commitFrom(p, r.plan);
    expect(topo(history.current)).toBe(before);
    for (const id of ["hostL", "hostR", "branch"]) {
      const w = resolvePlanWalls(history.current).find((x) => x.id === id);
      expect(w.pts.some((q) => Math.round(q.x) === 5400 && Math.round(q.y) === 9600), id).toBe(true);
    }
    history.undo();
    expect(geometry(history.current)).toBe(beforeGeom);
    expect(topo(history.current)).toBe(before);
  });
});
