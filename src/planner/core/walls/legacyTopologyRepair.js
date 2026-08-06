/**
 * PHASE 2F1 — bounded repair of PROVEN malformed legacy topology, at load.
 *
 * Scope is deliberately narrow. Only two classes are repaired, both of which
 * are defects with a single defensible answer:
 *
 *   E. UNNODED_CROSSING / endpoint_on_body
 *      A branch endpoint sits exactly on a host's body but shares no node. The
 *      walls look joined and are not: the mover sees a FREE end, so nothing
 *      constrains the branch and it slides through its neighbours; the host
 *      sees no branch, so nothing heals when the branch goes. Repair = make the
 *      visible join real: split the host at that point and share the node. No
 *      coordinate moves.
 *
 *   B. ORPHAN_HOST_SPLIT
 *      Two halves of ONE original wall (same non-null chainId, identical
 *      properties, collinear, degree-2 node) left behind after their branch
 *      disappeared. Repair = merge them back and drop the redundant node.
 *
 * Everything else is left exactly as stored. In particular two collinear walls
 * the user drew separately (category C) are NEVER merged, coincident-but-
 * distinct nodes are NEVER welded blindly, and a live T split is untouched.
 *
 * Idempotent: after a repair the anomaly no longer classifies, so a second run
 * over the same plan is a no-op — which is what keeps hydration free of save
 * loops. Pure: never mutates the plan it is given.
 */
import { classifyPlanTopologyAnomalies, TOPOLOGY_CLASS } from "./legacyTopologyAudit.js";

export const REPAIR_ACTION = Object.freeze({
  WELD_ENDPOINT_TO_HOST: "WELD_ENDPOINT_TO_HOST",
  MERGE_ORPHAN_HOST_SPLIT: "MERGE_ORPHAN_HOST_SPLIT",
});

const MIN_PIECE_MM = 20;

function pointOnSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return null;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  return { t, len: Math.sqrt(len2) };
}

/**
 * Make a visible-but-fake join real.
 *
 * The host record keeps its id, its properties and its chainId; the new far
 * half inherits the same chainId, so the pair stays PROVABLY one original wall
 * and will heal correctly when the branch is later deleted.
 */
function weldEndpointToHost(plan, anomaly, makeId) {
  const branch = (plan.walls || []).find((w) => w.id === anomaly.branchWallId);
  const host = (plan.walls || []).find((w) => w.id === anomaly.hostWallId);
  if (!branch || !host) return null;
  const nodeId = anomaly.nodeIds?.[0];
  const point = plan.nodes?.[nodeId];
  const hostA = plan.nodes?.[host.a];
  const hostB = plan.nodes?.[host.b];
  if (!point || !hostA || !hostB) return null;

  const on = pointOnSegment(point, hostA, hostB);
  if (!on) return null;
  const along = on.t * on.len;
  if (along <= MIN_PIECE_MM || along >= on.len - MIN_PIECE_MM) return null;

  // The branch endpoint node becomes the shared junction — no coordinate moves.
  const farId = makeId("wl");
  if (!farId || (plan.walls || []).some((w) => w.id === farId)) return null;
  const lineage = host.chainId ?? host.id;

  const walls = (plan.walls || []).map((w) => (
    w.id === host.id ? { ...w, chainId: lineage, b: nodeId } : w
  ));
  walls.push({
    ...host,
    id: farId,
    chainId: lineage,
    a: nodeId,
    b: host.b,
  });

  return {
    plan: { ...plan, walls },
    repair: {
      action: REPAIR_ACTION.WELD_ENDPOINT_TO_HOST,
      class: TOPOLOGY_CLASS.UNNODED_CROSSING,
      branchWallId: branch.id,
      hostWallId: host.id,
      createdWallId: farId,
      junctionNodeId: nodeId,
      chainId: lineage,
      atMm: Math.round(along),
    },
  };
}

/** Merge two proven halves of one original wall and drop the middle node. */
function mergeOrphanSplit(plan, anomaly) {
  const [idA, idB] = anomaly.wallIds || [];
  const A = (plan.walls || []).find((w) => w.id === idA);
  const B = (plan.walls || []).find((w) => w.id === idB);
  const nodeId = anomaly.junctionNodeId;
  if (!A || !B || !nodeId) return null;
  // Still exactly two arms? Anything else must keep the node.
  const incident = (plan.walls || []).filter((w) => w.a === nodeId || w.b === nodeId);
  if (incident.length !== 2) return null;

  const farOf = (w) => (w.a === nodeId ? w.b : w.a);
  const farA = farOf(A);
  const farB = farOf(B);
  if (!plan.nodes?.[farA] || !plan.nodes?.[farB] || farA === farB) return null;

  // Keep the record that carries the original lineage, so identity is stable.
  const keep = A.chainId === A.id ? A : (B.chainId === B.id ? B : A);
  const drop = keep === A ? B : A;
  const keepFar = farOf(keep);
  const dropFar = farOf(drop);

  const walls = (plan.walls || [])
    .filter((w) => w.id !== drop.id)
    .map((w) => (w.id === keep.id ? { ...w, a: keepFar, b: dropFar } : w));
  const nodes = { ...(plan.nodes || {}) };
  delete nodes[nodeId];

  return {
    plan: { ...plan, walls, nodes },
    repair: {
      action: REPAIR_ACTION.MERGE_ORPHAN_HOST_SPLIT,
      class: TOPOLOGY_CLASS.ORPHAN_HOST_SPLIT,
      keptWallId: keep.id,
      removedWallId: drop.id,
      removedNodeId: nodeId,
      chainId: keep.chainId ?? null,
    },
  };
}

/**
 * @param {object} plan canonical plan (nodes + walls[].a/b)
 * @param {{makeId:Function}} opts
 * @returns {{plan:object, changed:boolean, repairs:Array, skipped:Array}}
 */
export function repairLegacyTopology(plan, { makeId } = {}) {
  if (typeof makeId !== "function") throw new Error("repairLegacyTopology: makeId is required");
  if (!plan?.walls?.length || !plan?.nodes) {
    return { plan, changed: false, repairs: [], skipped: [] };
  }

  const audit = classifyPlanTopologyAnomalies(plan);
  const repairs = [];
  const skipped = [];
  let current = plan;

  // Deterministic order: welds first (they create the junctions an orphan test
  // then correctly refuses), each class sorted by id so runs are reproducible.
  const welds = audit.anomalies
    .filter((a) => a.class === TOPOLOGY_CLASS.UNNODED_CROSSING
      && a.subtype === "endpoint_on_body" && a.repairable)
    .sort((x, y) => String(x.branchWallId).localeCompare(String(y.branchWallId))
      || String(x.hostWallId).localeCompare(String(y.hostWallId)));
  for (const anomaly of welds) {
    const result = weldEndpointToHost(current, anomaly, makeId);
    if (!result) {
      skipped.push({ ...anomaly, reason: "weld_preconditions_not_met" });
      continue;
    }
    current = result.plan;
    repairs.push(result.repair);
  }

  const orphans = audit.anomalies
    .filter((a) => a.class === TOPOLOGY_CLASS.ORPHAN_HOST_SPLIT && a.repairable)
    .sort((x, y) => String(x.junctionNodeId).localeCompare(String(y.junctionNodeId)));
  for (const anomaly of orphans) {
    const result = mergeOrphanSplit(current, anomaly);
    if (!result) {
      skipped.push({ ...anomaly, reason: "orphan_merge_preconditions_not_met" });
      continue;
    }
    current = result.plan;
    repairs.push(result.repair);
  }

  // Everything deliberately left alone, so the decision is auditable.
  for (const a of audit.anomalies) {
    if (a.repairable) continue;
    skipped.push({ class: a.class, wallIds: a.wallIds, reason: a.detail });
  }

  return { plan: current, changed: repairs.length > 0, repairs, skipped };
}
