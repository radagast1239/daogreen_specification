/**
 * PHASE 2E FOLLOW-UP 1 (M4) — heal a host wall that a T-junction split.
 *
 * Reproduced through the real commands: drawing a branch into the middle of a
 * 6000 mm host makes commitDrawnWall split it into two records (both keeping
 * `chainId: "host"`) plus the branch. Deleting the branch with deleteWall then
 * removed only the branch — the two halves stayed separate, a redundant
 * degree-2 node stayed behind, and the plan showed two 3000 mm wall-length
 * labels instead of one 6000 mm label. For the user the wall had permanently
 * become two walls.
 *
 * This merges the halves back when, and only when, that is provably the same
 * wall. The actual edge merge is the existing topology primitive
 * `tryMergeWallEdge` (which also prunes the orphaned node), passed in by the
 * caller rather than imported here: it lives outside CAD Core, and core must
 * not reach back out to the legacy planner modules. Injecting it also keeps
 * this the ONLY merge algorithm — there is no second implementation.
 *
 * Pure: never mutates the plan it is given.
 */

export const HOST_HEAL_REASON = {
  MERGED: "HOST_HEAL_MERGED",
  NO_NODE: "HOST_HEAL_NO_NODE",
  DEGREE_NOT_TWO: "HOST_HEAL_DEGREE_NOT_TWO",
  NOT_COLLINEAR: "HOST_HEAL_NOT_COLLINEAR",
  LINEAGE_MISMATCH: "HOST_HEAL_LINEAGE_MISMATCH",
  PROPERTY_MISMATCH: "HOST_HEAL_PROPERTY_MISMATCH",
  MERGE_REFUSED: "HOST_HEAL_MERGE_REFUSED",
};

/** Properties that must agree before two halves may become one wall again. */
const IDENTITY_FIELDS = ["thk", "role", "kind", "thicknessSide", "height", "material", "locked"];

const failure = (plan, reason, warnings = []) => ({
  plan, changed: false, reason, mergedWallId: null,
  removedWallIds: [], removedNodeId: null, identityMapping: null, warnings,
});

/**
 * @param {object} plan
 * @param {{nodeId:string, expectedLineage?:string|null, mergeWallEdge:Function}} opts
 *        mergeWallEdge — the topology merge primitive (wallNetwork.tryMergeWallEdge).
 * @returns {{plan, changed, reason, mergedWallId, removedWallIds, removedNodeId,
 *            identityMapping, warnings}}
 */
export function healCollinearHostAtNode(plan, { nodeId, expectedLineage = null, mergeWallEdge } = {}) {
  if (typeof mergeWallEdge !== "function") {
    throw new Error("healCollinearHostAtNode: mergeWallEdge primitive is required");
  }
  const nodes = plan?.nodes || {};
  const walls = plan?.walls || [];
  if (!nodeId || !nodes[nodeId]) return failure(plan, HOST_HEAL_REASON.NO_NODE);

  const incident = walls.filter((w) => w.a === nodeId || w.b === nodeId);
  // Exactly two arms left: anything else still needs the node (another branch,
  // a corner the user drew, a degree-4 crossing) and must not be dissolved.
  if (incident.length !== 2) return failure(plan, HOST_HEAL_REASON.DEGREE_NOT_TWO);

  const [first, second] = incident;
  const farOf = (w) => (w.a === nodeId ? w.b : w.a);
  const A = nodes[farOf(first)];
  const B = nodes[farOf(second)];
  const S = nodes[nodeId];
  if (!A || !B || !S) return failure(plan, HOST_HEAL_REASON.NO_NODE);

  // Collinear AND pointing opposite ways away from the shared node, i.e. the
  // wall really does run straight through. A corner must never be dissolved.
  const u = { x: A.x - S.x, y: A.y - S.y };
  const v = { x: B.x - S.x, y: B.y - S.y };
  const lu = Math.hypot(u.x, u.y);
  const lv = Math.hypot(v.x, v.y);
  if (lu < 1e-6 || lv < 1e-6) return failure(plan, HOST_HEAL_REASON.NOT_COLLINEAR);
  const cross = Math.abs((u.x / lu) * (v.y / lv) - (u.y / lu) * (v.x / lv));
  const dot = (u.x / lu) * (v.x / lv) + (u.y / lu) * (v.y / lv);
  if (cross > 0.02 || dot > -0.98) return failure(plan, HOST_HEAL_REASON.NOT_COLLINEAR);

  // Same wall in the user's sense. chainId is the lineage commitDrawnWall
  // already preserves when it splits a host; without one on either side there
  // is no proof these were ever one wall, and merging on geometry alone could
  // silently fuse two walls the user drew separately.
  const lineageA = first.chainId ?? null;
  const lineageB = second.chainId ?? null;
  if (!lineageA || !lineageB || lineageA !== lineageB) {
    return failure(plan, HOST_HEAL_REASON.LINEAGE_MISMATCH);
  }
  if (expectedLineage != null && lineageA !== expectedLineage) {
    return failure(plan, HOST_HEAL_REASON.LINEAGE_MISMATCH);
  }

  const mismatched = IDENTITY_FIELDS.filter((f) => (first[f] ?? null) !== (second[f] ?? null));
  if (mismatched.length) {
    return failure(plan, HOST_HEAL_REASON.PROPERTY_MISMATCH,
      [{ code: HOST_HEAL_REASON.PROPERTY_MISMATCH, fields: mismatched, wallIds: [first.id, second.id] }]);
  }

  // Keep the wall the split originally kept its id on, so identity is stable.
  const keep = first.id === lineageA ? first : (second.id === lineageA ? second : first);
  const drop = keep === first ? second : first;
  const merged = mergeWallEdge(plan, keep.id);
  if (!merged?.plan) return failure(plan, HOST_HEAL_REASON.MERGE_REFUSED);

  return {
    plan: merged.plan,
    changed: true,
    reason: HOST_HEAL_REASON.MERGED,
    mergedWallId: merged.mergedId,
    removedWallIds: [drop.id],
    removedNodeId: nodeId,
    identityMapping: { [drop.id]: merged.mergedId, [keep.id]: merged.mergedId },
    warnings: [],
  };
}

/**
 * Heal every node a just-deleted wall left behind. Used by deleteWall so that
 * removing the last branch of a T restores the host as one wall in the same
 * atomic operation (one history step, one save).
 */
export function healHostsAfterWallRemoval(plan, nodeIds = [], { mergeWallEdge } = {}) {
  let current = plan;
  const merged = [];
  const removedWallIds = [];
  const removedNodeIds = [];
  for (const nodeId of nodeIds.filter(Boolean)) {
    const r = healCollinearHostAtNode(current, { nodeId, mergeWallEdge });
    if (!r.changed) continue;
    current = r.plan;
    merged.push(r.mergedWallId);
    removedWallIds.push(...r.removedWallIds);
    removedNodeIds.push(r.removedNodeId);
  }
  return { plan: current, changed: merged.length > 0, mergedWallIds: merged, removedWallIds, removedNodeIds };
}
