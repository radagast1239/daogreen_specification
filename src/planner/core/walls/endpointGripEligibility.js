/**
 * PHASE 2E.1 (B) — may this wall endpoint show a node grip?
 *
 * The sibling of wallMoveEligibility, for the OTHER affordance on a selected
 * wall. M3 freed the central whole-wall handle from the active layer; the
 * endpoint grips were left behind on the old gate:
 *
 *   canvasPrimitives.jsx  {editable && showNodes && wall.pts.map(...)}
 *   PlanPage.jsx          editable={active === "room"       && tool === "select"}
 *                         editable={active === "partitions" && tool === "select"}
 *
 * while selection itself (pickPlanHit -> pickWallBodyHit) is layer-agnostic. So
 * a partition selected while the room layer is active could be dragged as a
 * whole but had no endpoint grips, and switching layer made them appear out of
 * nowhere. Active layer decides where NEW walls are drawn — never whether an
 * already selected, editable wall keeps its editing controls.
 *
 * Eligibility is decided from the SAME command the drag runs, moveNode()
 * (core/walls/wallCommands.js), so a grip is offered exactly where the command
 * can act, and withheld only where the command itself fails closed — with a
 * reason a caller can surface.
 *
 * Measured contract of moveNode (probe: 22 endpoints over free / corner /
 * T-junction / oblique / degree-4 crossing fixtures, plus a 36-direction sweep):
 * it translates the SHARED node, so every incident wall follows it. The junction
 * stays a junction, nothing is detached, no unnoded crossing appears and no wall
 * collapses — degree 3 and degree 4 included, 0 refusals. It refuses exactly one
 * thing: a node it cannot resolve (NODE_NOT_FOUND). That is why degree is
 * CLASSIFIED and reported here but is not, by itself, a block: unlike
 * moveWallSegment — which must translate one segment while its hosts stay put,
 * and is genuinely ambiguous at a multi-junction — moving a node is unambiguous.
 *
 * Pure: no plan mutation, no React, no DOM, no active layer.
 */

export const GRIP_REASON = {
  OK: "OK",
  NO_WALL: "NO_WALL",
  TOOL_NOT_SELECT: "TOOL_NOT_SELECT",
  WALL_LOCKED: "WALL_LOCKED",
  NODE_LOCKED: "NODE_LOCKED",
  ENDPOINT_OUT_OF_RANGE: "ENDPOINT_OUT_OF_RANGE",
  /** mirror of moveNode's own refusal */
  NODE_NOT_FOUND: "NODE_NOT_FOUND",
};

/** How the endpoint sits in the network. Reported, not a gate (see header). */
export const GRIP_TOPOLOGY = {
  FREE: "free",         // degree 1 — loose end
  CORNER: "corner",     // degree 2 — corner / collinear seam
  JUNCTION: "junction", // degree 3 — T / three-way hub
  HUB: "hub",           // degree 4+ — crossing
  ORPHAN: "orphan",     // degree 0 — should not happen on a real wall
};

const ENDPOINT_INDEX = { start: 0, end: 1, a: 0, b: 1, 0: 0, 1: 1 };

const blocked = (reason, extra = {}) => ({
  visible: false,
  enabled: false,
  reason,
  nodeId: null,
  topology: null,
  ...extra,
});

function classifyDegree(degree) {
  if (degree <= 0) return GRIP_TOPOLOGY.ORPHAN;
  if (degree === 1) return GRIP_TOPOLOGY.FREE;
  if (degree === 2) return GRIP_TOPOLOGY.CORNER;
  if (degree === 3) return GRIP_TOPOLOGY.JUNCTION;
  return GRIP_TOPOLOGY.HUB;
}

/**
 * @param {object} plan  canonical plan (nodes + walls[].a/b)
 * @param {{wallId:string, endpoint:(0|1|"start"|"end"), tool?:string, locked?:boolean}} ctx
 * @returns {{visible:boolean, enabled:boolean, reason:string, nodeId:string|null,
 *            topology:{degree:number, kind:string, connectedWallIds:string[]}|null}}
 *
 * NOTE: the active layer is deliberately NOT a parameter. It is a drawing
 * default and a visibility setting, never a safety input.
 */
export function endpointGripEligibility(plan, { wallId, endpoint, tool = "select", locked = false } = {}) {
  const wall = (plan?.walls || []).find((candidate) => candidate.id === wallId);
  if (!wall) return blocked(GRIP_REASON.NO_WALL);

  const idx = ENDPOINT_INDEX[endpoint];
  if (idx !== 0 && idx !== 1) return blocked(GRIP_REASON.ENDPOINT_OUT_OF_RANGE);

  // The wall tool owns the pointer while drawing (shouldBlockWallGeometryDrag),
  // and erase deletes rather than drags — neither may offer a drag affordance.
  if (tool !== "select") return blocked(GRIP_REASON.TOOL_NOT_SELECT);
  if (locked || wall.locked) return blocked(GRIP_REASON.WALL_LOCKED);

  const nodeId = idx === 0 ? wall.a : wall.b;
  const node = nodeId ? plan?.nodes?.[nodeId] : null;
  // Exactly moveNode's precondition: an unresolvable node means the command
  // answers NODE_NOT_FOUND, so a grip here would be a promise it cannot keep.
  if (!node) return blocked(GRIP_REASON.NODE_NOT_FOUND, { nodeId: nodeId || null });
  if (node.locked) {
    return blocked(GRIP_REASON.NODE_LOCKED, { nodeId });
  }

  const connectedWallIds = (plan.walls || [])
    .filter((w) => w.a === nodeId || w.b === nodeId)
    .map((w) => w.id);

  return {
    visible: true,
    enabled: true,
    reason: GRIP_REASON.OK,
    nodeId,
    topology: {
      degree: connectedWallIds.length,
      kind: classifyDegree(connectedWallIds.length),
      connectedWallIds,
    },
  };
}

/**
 * Both endpoints of one wall, indexed the way WallEl indexes `wall.pts`.
 *
 * Returns null for a wall this decision does not cover (legacy `pts`-only wall,
 * or a plan without a node map). The caller then keeps whatever behaviour it had
 * — same conservative contract as WallEl's `movable == null` fallback, so no
 * legacy plan changes shape because of this phase.
 */
export function wallEndpointGrips(plan, wallId, ctx = {}) {
  const wall = (plan?.walls || []).find((candidate) => candidate.id === wallId);
  if (!wall?.a || !wall?.b || !plan?.nodes) return null;
  return [0, 1].map((endpoint) => endpointGripEligibility(plan, { ...ctx, wallId, endpoint }));
}

/** Human-facing text for a withheld grip, so the UI never just goes blank. */
export function endpointGripDisabledText(reason) {
  switch (reason) {
    case GRIP_REASON.WALL_LOCKED:
      return "Стена заблокирована";
    case GRIP_REASON.NODE_LOCKED:
      return "Узел заблокирован";
    case GRIP_REASON.NODE_NOT_FOUND:
      return "У конца стены нет узла — перетаскивание недоступно";
    default:
      return null;
  }
}
