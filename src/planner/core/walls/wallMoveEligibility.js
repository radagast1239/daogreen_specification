/**
 * PHASE 2E FOLLOW-UP 1 (M3) — may this wall show a movement handle?
 *
 * The handle used to be gated on the ACTIVE LAYER: PlanPage renders outer walls
 * and partitions in two groups and passed
 *   editable={active === "room"      && tool === "select"}   // outer walls
 *   editable={active === "partitions" && tool === "select"}  // partitions
 * to WallEl, while the selection hit area next to it was gated only on
 * `tool === "select"`. So EVERY wall could be selected from any layer, but only
 * the walls whose role matched the active layer got a handle — which is exactly
 * the reported "some selected walls show the move icon and move, others show
 * nothing and cannot be dragged".
 *
 * Hiding the affordance for a wall the user just selected, with no reason
 * shown, is the case the M3 contract forbids. Eligibility is decided here
 * instead, from the SAME classifier moveWallSegment itself uses
 * (classifyWallSegmentAttachments), so the handle appears exactly where the
 * command can act and is withheld only where the command would fail closed —
 * and then with a reason a caller can surface.
 *
 * Pure: no plan mutation, no React, no DOM.
 */
import { classifyWallSegmentAttachments, wallSegmentHasMovableDirection } from "./wallCommands.js";
import { resolveLogicalWallChain } from "./logicalWallChain.js";

export const MOVE_HANDLE_REASON = {
  OK: "OK",
  NO_WALL: "NO_WALL",
  TOOL_NOT_SELECT: "TOOL_NOT_SELECT",
  WALL_LOCKED: "WALL_LOCKED",
  MULTI_SEGMENT_WALL: "MULTI_SEGMENT_WALL",
  // mirrors of moveWallSegment's own fail-closed reasons
  UNSAFE_MULTI_JUNCTION: "WALL_MOVE_UNSAFE_MULTI_JUNCTION",
  SAME_HOST_AMBIGUOUS: "WALL_MOVE_SAME_HOST_AMBIGUOUS",
  INCOMPATIBLE_HOST_CONSTRAINTS: "WALL_MOVE_INCOMPATIBLE_HOST_CONSTRAINTS",
};

const blocked = (reason, attachments = null) => ({ eligible: false, reason, attachments });

/**
 * @param {object} plan            canonical plan (nodes + walls[].a/b)
 * @param {string} wallId
 * @param {{tool?:string, locked?:boolean}} ctx
 * @returns {{eligible:boolean, reason:string, attachments:object|null}}
 *
 * NOTE: deliberately independent of the active layer. A wall the user can
 * select is a wall the user can move; layer visibility is a display concern,
 * not a safety one, and gating the handle on it is what produced M3.
 */
export function wallMoveHandleEligibility(plan, wallId, { tool = "select", locked = false } = {}) {
  const wall = (plan?.walls || []).find((candidate) => candidate.id === wallId);
  if (!wall) return blocked(MOVE_HANDLE_REASON.NO_WALL);
  if (tool !== "select") return blocked(MOVE_HANDLE_REASON.TOOL_NOT_SELECT);
  if (locked || wall.locked) return blocked(MOVE_HANDLE_REASON.WALL_LOCKED);

  const attachments = classifyWallSegmentAttachments(plan, wallId);
  if (!attachments) return blocked(MOVE_HANDLE_REASON.NO_WALL);

  // Exactly moveWallSegment's preconditions, so eligibility can never claim a
  // move the command would refuse, nor hide one it would perform.
  if (attachments.start.type === "multi" || attachments.end.type === "multi") {
    return blocked(MOVE_HANDLE_REASON.UNSAFE_MULTI_JUNCTION, attachments);
  }
  const startHosts = new Set(attachments.start.hostWallIds || []);
  if ((attachments.end.hostWallIds || []).some((id) => startHosts.has(id))) {
    return blocked(MOVE_HANDLE_REASON.SAME_HOST_AMBIGUOUS, attachments);
  }
  // Both ends tee'd to hosts that are not parallel: the constraint system has
  // no solution, so NO delta can move this wall and a handle would be a
  // promise the command cannot keep. Deliberately asked as a delta-INDEPENDENT
  // question — a single probe delta would also reject walls that merely happen
  // to be perpendicular to their one host (those report NO_CHANGE and are
  // perfectly movable along it).
  if (!wallSegmentHasMovableDirection(attachments)) {
    return blocked(MOVE_HANDLE_REASON.INCOMPATIBLE_HOST_CONSTRAINTS, attachments);
  }
  return { eligible: true, reason: MOVE_HANDLE_REASON.OK, attachments };
}

/**
 * PHASE 2F1 — ONE central handle for the LOGICAL wall.
 *
 * A host split by a T used to offer a handle per half, each moving its own
 * half. The logical wall gets a single handle at the midpoint of the complete
 * chain, and it is offered exactly where moveLogicalWallChain can act: the
 * chain's own outer endpoints decide, never the internal T junction.
 *
 * @returns {{eligible:boolean, reason:string, chain:object, point:{x,y}|null,
 *            wallIds:string[], logicalId:string|null, segmentCount:number}}
 */
export function logicalChainMoveHandleEligibility(plan, wallId, { tool = "select", locked = false } = {}) {
  const chain = resolveLogicalWallChain(plan, wallId);
  const shape = (eligible, reason) => ({
    eligible,
    reason,
    chain,
    point: chain.midpoint,
    wallIds: chain.wallIds,
    logicalId: chain.logicalId,
    segmentCount: chain.segmentCount,
  });
  if (!chain.ok || !chain.wallIds.length) return shape(false, MOVE_HANDLE_REASON.NO_WALL);
  // A wall that was never split keeps the accepted single-segment decision.
  if (chain.segmentCount <= 1) {
    const single = wallMoveHandleEligibility(plan, wallId, { tool, locked });
    return { ...shape(single.eligible, single.reason), attachments: single.attachments };
  }
  if (tool !== "select") return shape(false, MOVE_HANDLE_REASON.TOOL_NOT_SELECT);
  const members = (plan?.walls || []).filter((w) => chain.wallIds.includes(w.id));
  if (locked || members.some((w) => w.locked)) return shape(false, MOVE_HANDLE_REASON.WALL_LOCKED);
  // The chain's ENDS decide, exactly as moveLogicalWallChain asks them to.
  for (const [i, nodeId] of chain.outerNodeIds.entries()) {
    const terminal = members.find((w) => w.a === nodeId || w.b === nodeId);
    if (!terminal) return shape(false, MOVE_HANDLE_REASON.NO_WALL);
    const attachments = classifyWallSegmentAttachments(plan, terminal.id);
    if (!attachments) return shape(false, MOVE_HANDLE_REASON.NO_WALL);
    const end = terminal.a === nodeId ? attachments.start : attachments.end;
    if (end.type === "multi") return shape(false, MOVE_HANDLE_REASON.UNSAFE_MULTI_JUNCTION);
    if (i === 1) {
      const firstNode = chain.outerNodeIds[0];
      const firstTerminal = members.find((w) => w.a === firstNode || w.b === firstNode);
      const firstAtt = firstTerminal ? classifyWallSegmentAttachments(plan, firstTerminal.id) : null;
      const firstEnd = firstTerminal
        ? (firstTerminal.a === firstNode ? firstAtt?.start : firstAtt?.end)
        : null;
      const firstHosts = new Set(firstEnd?.hostWallIds || []);
      if ((end.hostWallIds || []).some((id) => firstHosts.has(id))) {
        return shape(false, MOVE_HANDLE_REASON.SAME_HOST_AMBIGUOUS);
      }
    }
  }
  const terminalAttachments = chain.outerNodeIds.map((nodeId) => {
    const terminal = members.find((w) => w.a === nodeId || w.b === nodeId);
    const attachments = classifyWallSegmentAttachments(plan, terminal.id);
    return terminal.a === nodeId ? attachments.start : attachments.end;
  });
  if (!wallSegmentHasMovableDirection({ start: terminalAttachments[0], end: terminalAttachments[1] })) {
    return shape(false, MOVE_HANDLE_REASON.INCOMPATIBLE_HOST_CONSTRAINTS);
  }
  return shape(true, MOVE_HANDLE_REASON.OK);
}

/** Human-facing text for a withheld handle, so the UI never just goes blank. */
export function moveHandleDisabledText(reason) {
  switch (reason) {
    case MOVE_HANDLE_REASON.UNSAFE_MULTI_JUNCTION:
      return "Стена входит в сложный узел — перемещение отключено";
    case MOVE_HANDLE_REASON.SAME_HOST_AMBIGUOUS:
      return "Оба конца на одной несущей стене — перемещение неоднозначно";
    case MOVE_HANDLE_REASON.INCOMPATIBLE_HOST_CONSTRAINTS:
      return "Концы закреплены на пересекающихся стенах — свободного направления нет";
    case MOVE_HANDLE_REASON.WALL_LOCKED:
      return "Стена заблокирована";
    case MOVE_HANDLE_REASON.MULTI_SEGMENT_WALL:
      return "Составная стена — перемещайте сегменты по отдельности";
    default:
      return null;
  }
}
