/**
 * PlanPage adapter over wallCommands results.
 * Commands only change geometry; callers run safe room sync when changed:true.
 */
import { resolvePlanWalls } from "../../wallNetwork.js";
import { refreshWallMountedItems, projectOnSegment, dist, NODE_LINK_THR } from "./wallOps.js";
import { connectWallEndpoint } from "./wallCommands.js";

const WALL_CMD_SOURCE = "wall-command";

/**
 * Materialize a wall-command result onto a plan (warnings → validationWarnings,
 * optional door/window re-project). Does NOT run room sync.
 */
export function materializeWallCommand(plan, result, { refreshMounted = true } = {}) {
  if (!result) return { plan, changed: false, warnings: [] };
  if (!result.changed) {
    return { plan, changed: false, warnings: result.warnings || [] };
  }
  let next = result.plan;
  if (refreshMounted && Array.isArray(next.items) && next.items.length) {
    next = {
      ...next,
      items: refreshWallMountedItems(next.items, resolvePlanWalls(next), next.room, null),
    };
  }
  if (result.warnings?.length) {
    const kept = (next.validationWarnings || []).filter((w) => w.source !== WALL_CMD_SOURCE);
    next = {
      ...next,
      validationWarnings: [
        ...kept,
        ...result.warnings.map((w) => ({
          id: w.dimensionId || w.wallId || w.nodeId || w.itemId || w.code,
          source: WALL_CMD_SOURCE,
          severity: w.severity || "warning",
          text: w.message,
          ...w,
        })),
      ],
    };
  }
  return { plan: next, changed: true, warnings: result.warnings || [] };
}

/**
 * After new walls are added, connect any endpoint that lands on another wall's
 * body (T-junction) via connectWallEndpoint.
 * @param {object} plan
 * @param {Iterable<string>} newWallIds — walls just added (their endpoints are checked)
 * @param {(prefix:string)=>string} makeId
 */
export function connectFloatingEndpointsToWallBodies(plan, newWallIds, makeId, thr = NODE_LINK_THR) {
  let next = plan;
  const newIds = newWallIds instanceof Set ? newWallIds : new Set(newWallIds || []);
  if (!newIds.size) return next;

  for (const wallId of [...newIds]) {
    const w = (next.walls || []).find((x) => x.id === wallId);
    if (!w) continue;
    for (const nodeId of [w.a, w.b]) {
      if (!nodeId || !next.nodes?.[nodeId]) continue;
      const pt = next.nodes[nodeId];
      const walls = resolvePlanWalls(next);
      const host = findWallBodyUnderPoint(walls, pt, newIds, thr);
      if (!host) continue;
      const r = connectWallEndpoint(next, nodeId, host.id, pt, makeId);
      if (r.changed) next = r.plan;
    }
  }
  return next;
}

function findWallBodyUnderPoint(resolvedWalls, pt, excludeIds, thr) {
  let best = null;
  let bestDist = thr;
  for (const w of resolvedWalls || []) {
    if (!w?.pts || w.pts.length < 2) continue;
    if (excludeIds?.has(w.id)) continue;
    for (let i = 1; i < w.pts.length; i++) {
      const a = w.pts[i - 1];
      const b = w.pts[i];
      if (dist(pt, a) <= thr || dist(pt, b) <= thr) continue;
      const proj = projectOnSegment(pt, a, b);
      const d = dist(pt, proj);
      if (d <= bestDist) {
        bestDist = d;
        best = w;
      }
    }
  }
  return best;
}
