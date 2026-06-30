/**
 * Коммит wall-chain в план.
 */
import { createWallChain } from "./wallModel.js";
import { normalizeWalls } from "./wallNormalize.js";
import {
  commitWallEdge, isNetworkPlan, ensureWallNetwork, resolvePlanWalls, migratePtsWallsToNetwork,
} from "../../wallNetwork.js";

export function commitWallChain(plan, pts, wallProps, makeId) {
  if (!pts || pts.length < 2) return plan;

  const chainId = wallProps.chainId || makeId("ch");
  const meta = { ...wallProps, chainId, type: "wall" };

  let next = { ...plan };

  if (isNetworkPlan(plan) || Object.keys(plan.nodes || {}).length > 0) {
    next = ensureWallNetwork(next, makeId);
    const existingPtsWalls = resolvePlanWalls(next).map((w) => ({ ...w }));
    const incoming = createWallChain(pts, meta, makeId);
    const normalizedPts = normalizeWalls(
      [...existingPtsWalls, incoming],
      { makeId },
    );
    const { nodes, walls } = migratePtsWallsToNetwork(normalizedPts, makeId, next.nodes || {});
    return { ...next, nodes, walls };
  }

  const wall = createWallChain(pts, meta, makeId);
  const walls = normalizeWalls([...(plan.walls || []), wall], { makeId });
  return { ...plan, walls };
}
