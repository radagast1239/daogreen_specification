/**
 * PHASE 2F1 — the LOGICAL wall a user sees, over the topology segments.
 *
 * Blocker B. Drawing a T branch into the middle of a host makes
 * commitDrawnWall split the host into two records so the branch has a node to
 * attach to. That split is a TOPOLOGY fact and it must stay — but it leaked all
 * the way to the user: selecting the top host selected one half, a red endpoint
 * grip appeared at the T junction, each half had its own centre handle, its own
 * length, its own inspector target, and its own properties.
 *
 * For the user there is still ONE wall. This module resolves that logical wall
 * from any of its segments, so selection, grips, the centre handle, the reported
 * length, the inspector and property commands can all address the same identity.
 *
 * Membership is PROVEN, never guessed — two collinear walls that merely touch
 * are not one wall. A segment joins the chain only when all of these hold:
 *
 *   - it carries the SAME chainId lineage (the id commitDrawnWall preserves
 *     across a host split, and wallHostHeal already requires before merging);
 *   - it is contiguous with the chain at a shared topology node;
 *   - it runs straight THROUGH that node (opposite directions, collinear) —
 *     a corner is never dissolved;
 *   - every identity property matches;
 *   - it is the ONLY such continuation at that node (ambiguity stops the walk).
 *
 * Pure: no plan mutation, no React, no DOM.
 */
import { endpointGripEligibility } from "./endpointGripEligibility.js";

export const LOGICAL_CHAIN_REASON = Object.freeze({
  OK: "OK",
  NO_WALL: "NO_WALL",
  NO_NETWORK: "NO_NETWORK",
  SINGLE_SEGMENT: "SINGLE_SEGMENT",
  NO_LINEAGE: "NO_LINEAGE",
});

/** Properties that must agree for two segments to be one logical wall. */
export const CHAIN_IDENTITY_FIELDS = Object.freeze([
  "thk", "role", "kind", "thicknessSide", "height", "material", "locked",
]);

const COLLINEAR_CROSS_EPS = 0.02;   // ~1.15°
const OPPOSITE_DOT_MAX = -0.98;     // must point away from the shared node
const MIN_ARM_MM = 1;

function compatible(a, b) {
  return CHAIN_IDENTITY_FIELDS.every((key) => (a?.[key] ?? null) === (b?.[key] ?? null));
}

function otherNodeId(wall, nodeId) {
  if (wall?.a === nodeId) return wall.b;
  if (wall?.b === nodeId) return wall.a;
  return null;
}

/**
 * Do these two walls run straight through the shared node?
 * Same test wallHostHeal uses before it is allowed to merge two halves.
 */
function runsStraightThrough(nodes, nodeId, wallA, wallB) {
  const S = nodes?.[nodeId];
  const A = nodes?.[otherNodeId(wallA, nodeId)];
  const B = nodes?.[otherNodeId(wallB, nodeId)];
  if (!S || !A || !B) return false;
  const ux = A.x - S.x;
  const uy = A.y - S.y;
  const vx = B.x - S.x;
  const vy = B.y - S.y;
  const lu = Math.hypot(ux, uy);
  const lv = Math.hypot(vx, vy);
  if (lu < MIN_ARM_MM || lv < MIN_ARM_MM) return false;
  const cross = Math.abs((ux / lu) * (vy / lv) - (uy / lu) * (vx / lv));
  const dot = (ux / lu) * (vx / lv) + (uy / lu) * (vy / lv);
  return cross <= COLLINEAR_CROSS_EPS && dot <= OPPOSITE_DOT_MAX;
}

function lineageOf(wall) {
  const id = wall?.chainId;
  return id == null || id === "" ? null : id;
}

function singleton(plan, wall, reason) {
  const nodes = plan?.nodes || {};
  const A = wall ? nodes[wall.a] : null;
  const B = wall ? nodes[wall.b] : null;
  const length = A && B ? Math.hypot(B.x - A.x, B.y - A.y) : 0;
  return {
    ok: !!wall,
    reason,
    chainId: lineageOf(wall) || wall?.id || null,
    logicalId: wall?.id || null,
    wallIds: wall ? [wall.id] : [],
    nodeIds: wall ? [wall.a, wall.b] : [],
    outerNodeIds: wall ? [wall.a, wall.b] : [],
    internalNodeIds: [],
    branchWallIdsByNode: {},
    segmentCount: wall ? 1 : 0,
    totalLengthMm: length,
    a: A ? { x: A.x, y: A.y } : null,
    b: B ? { x: B.x, y: B.y } : null,
    midpoint: A && B ? { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 } : null,
  };
}

/**
 * The complete logical wall that `wallId` belongs to.
 *
 * A single-segment wall resolves to itself, so every caller can use this
 * unconditionally and nothing changes for walls that were never split.
 *
 * @param {object} plan   canonical plan (nodes + walls[].a/b)
 * @param {string} wallId any segment of the chain
 */
export function resolveLogicalWallChain(plan, wallId) {
  const walls = plan?.walls || [];
  const nodes = plan?.nodes || {};
  const wall = walls.find((w) => w.id === wallId);
  if (!wall) return { ...singleton(plan, null, LOGICAL_CHAIN_REASON.NO_WALL), ok: false };
  if (!wall.a || !wall.b || !nodes[wall.a] || !nodes[wall.b]) {
    return singleton(plan, wall, LOGICAL_CHAIN_REASON.NO_NETWORK);
  }
  const lineage = lineageOf(wall);
  // No lineage means no proof these were ever one wall. Fail closed: a wall
  // with no chainId is its own logical wall, whatever happens to touch it.
  if (!lineage) return singleton(plan, wall, LOGICAL_CHAIN_REASON.NO_LINEAGE);

  const byNode = new Map();
  for (const w of walls) {
    if (!w.a || !w.b) continue;
    for (const n of [w.a, w.b]) {
      if (!byNode.has(n)) byNode.set(n, []);
      byNode.get(n).push(w);
    }
  }

  const memberIds = new Set([wall.id]);
  let orderedWalls = [wall];
  let orderedNodes = [wall.a, wall.b];

  const extend = (fromNodeId, terminalWall, append) => {
    let nodeId = fromNodeId;
    let current = terminalWall;
    for (let guard = 0; guard < walls.length + 1; guard++) {
      const incident = (byNode.get(nodeId) || []).filter((w) => !memberIds.has(w.id));
      const candidates = incident.filter((w) => (
        lineageOf(w) === lineage
        && compatible(w, wall)
        && runsStraightThrough(nodes, nodeId, current, w)
      ));
      // 0 → the logical wall ends here. >1 → genuinely ambiguous, stop rather
      // than pick; the user still gets a correct (shorter) logical wall.
      if (candidates.length !== 1) return;
      const next = candidates[0];
      const far = otherNodeId(next, nodeId);
      if (!far || !nodes[far]) return;
      memberIds.add(next.id);
      if (append) {
        orderedWalls = [...orderedWalls, next];
        orderedNodes = [...orderedNodes, far];
      } else {
        orderedWalls = [next, ...orderedWalls];
        orderedNodes = [far, ...orderedNodes];
      }
      nodeId = far;
      current = next;
    }
  };

  extend(wall.a, wall, false);
  extend(wall.b, wall, true);

  const outerNodeIds = [orderedNodes[0], orderedNodes[orderedNodes.length - 1]];
  const internalNodeIds = orderedNodes.slice(1, -1);
  const branchWallIdsByNode = {};
  for (const nodeId of orderedNodes) {
    const branches = (byNode.get(nodeId) || [])
      .filter((w) => !memberIds.has(w.id))
      .map((w) => w.id)
      .sort();
    if (branches.length) branchWallIdsByNode[nodeId] = branches;
  }

  let totalLengthMm = 0;
  for (let i = 0; i < orderedNodes.length - 1; i++) {
    const p = nodes[orderedNodes[i]];
    const q = nodes[orderedNodes[i + 1]];
    if (p && q) totalLengthMm += Math.hypot(q.x - p.x, q.y - p.y);
  }
  const A = nodes[outerNodeIds[0]];
  const B = nodes[outerNodeIds[1]];

  return {
    ok: true,
    reason: orderedWalls.length > 1 ? LOGICAL_CHAIN_REASON.OK : LOGICAL_CHAIN_REASON.SINGLE_SEGMENT,
    chainId: lineage,
    // Stable user-facing identity of the whole logical wall.
    logicalId: orderedWalls.length > 1 ? `chain:${lineage}` : wall.id,
    wallIds: orderedWalls.map((w) => w.id),
    nodeIds: orderedNodes,
    outerNodeIds,
    internalNodeIds,
    branchWallIdsByNode,
    segmentCount: orderedWalls.length,
    totalLengthMm,
    a: A ? { x: A.x, y: A.y } : null,
    b: B ? { x: B.x, y: B.y } : null,
    midpoint: A && B ? { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 } : null,
  };
}

/** Every wall id of the logical wall `wallId` belongs to (never empty). */
export function logicalChainWallIds(plan, wallId) {
  const chain = resolveLogicalWallChain(plan, wallId);
  return chain.wallIds.length ? chain.wallIds : (wallId ? [wallId] : []);
}

/**
 * True when this node is INSIDE the logical wall — a T junction the branch
 * needs, but never an endpoint of the host as the user sees it.
 */
export function isInternalChainNode(chain, nodeId) {
  return !!nodeId && (chain?.internalNodeIds || []).includes(nodeId);
}

/**
 * Endpoint grips for the LOGICAL wall: the two outer ends only.
 *
 * Each entry keeps the terminal segment id + endpoint index the drag must
 * start from, so the existing moveNode drag path is unchanged; what changes is
 * that the T junction between two halves no longer offers a grip, because it is
 * not an end of the wall the user selected.
 *
 * @returns {Array<{wallId:string, endpoint:0|1, grip:object, nodeId:string}>|null}
 */
export function logicalChainEndpointGrips(plan, wallId, ctx = {}) {
  const chain = resolveLogicalWallChain(plan, wallId);
  if (!chain.ok || !chain.wallIds.length) return null;
  const walls = plan?.walls || [];
  if (!plan?.nodes) return null;
  const out = [];
  for (const nodeId of chain.outerNodeIds) {
    const terminal = walls.find((w) => chain.wallIds.includes(w.id) && (w.a === nodeId || w.b === nodeId));
    if (!terminal) continue;
    const endpoint = terminal.a === nodeId ? 0 : 1;
    const grip = endpointGripEligibility(plan, { ...ctx, wallId: terminal.id, endpoint });
    out.push({ wallId: terminal.id, endpoint, grip, nodeId });
  }
  return out;
}

/**
 * Do these two walls belong to the same logical wall? Used by selection and by
 * property commands so "apply to the whole wall" has one definition.
 */
export function sameLogicalWall(plan, wallIdA, wallIdB) {
  if (!wallIdA || !wallIdB) return false;
  if (wallIdA === wallIdB) return true;
  return resolveLogicalWallChain(plan, wallIdA).wallIds.includes(wallIdB);
}
