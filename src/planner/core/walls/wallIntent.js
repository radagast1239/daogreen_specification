/** Pure, serializable validation for explicit wall-drawing topology intent. */
import { dist } from "../geometry/point.js";
import { projectOnSegment } from "../geometry/segment.js";

export const INTENT_EPS_MM = 0.5;

function finitePoint(point) {
  return point != null && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function pointCopy(point, fallbackPoint) {
  const source = finitePoint(point) ? point : fallbackPoint;
  return { x: source.x, y: source.y };
}

function noneIntent(point) {
  return {
    kind: "none",
    point: { ...point },
    nodeId: null,
    wallId: null,
    hostWallId: null,
    connects: false,
  };
}

function warning(code, side, message) {
  return { code, side, message };
}

function nodeIntent(nodeId, point) {
  return {
    kind: "node",
    point: { ...point },
    nodeId,
    wallId: null,
    hostWallId: null,
    connects: true,
  };
}

/**
 * Missing intent stays missing so its side can use the exact legacy inference
 * path. Invalid/stale explicit intent fails closed to `none` at its own point.
 */
export function normalizeWallTopologyIntent(plan, rawIntent, fallbackPoint, side = "start") {
  if (rawIntent === undefined) return { provided: false, intent: null, warnings: [] };

  const point = pointCopy(rawIntent?.point, fallbackPoint);
  const reject = (code, message) => ({
    provided: true,
    intent: noneIntent(point),
    warnings: [warning(code, side, message)],
  });

  if (!rawIntent || rawIntent.kind === "none") {
    return { provided: true, intent: noneIntent(point), warnings: [] };
  }

  if (rawIntent.kind === "node") {
    const node = rawIntent.nodeId ? plan?.nodes?.[rawIntent.nodeId] : null;
    if (!node || rawIntent.connects !== true || dist(point, node) > INTENT_EPS_MM) {
      return reject("INTENT_REJECTED_NODE", `Explicit ${side} node intent is stale or inconsistent`);
    }
    return { provided: true, intent: nodeIntent(rawIntent.nodeId, node), warnings: [] };
  }

  if (rawIntent.kind === "wall-end") {
    const storedWall = (plan?.walls || []).find((wall) => wall?.id === rawIntent.wallId);
    if (storedWall && !(storedWall.a && storedWall.b)) {
      return reject("INTENT_DOWNGRADED_LEGACY_WALL", `Legacy ${side} wall endpoint has no exact network node`);
    }
    const node = rawIntent.nodeId ? plan?.nodes?.[rawIntent.nodeId] : null;
    const belongs = storedWall && (storedWall.a === rawIntent.nodeId || storedWall.b === rawIntent.nodeId);
    if (!storedWall || !node || !belongs || rawIntent.connects !== true || dist(point, node) > INTENT_EPS_MM) {
      return reject("INTENT_REJECTED_WALL_END", `Explicit ${side} wall-end intent is stale or inconsistent`);
    }
    return { provided: true, intent: nodeIntent(rawIntent.nodeId, node), warnings: [] };
  }

  if (rawIntent.kind === "wall-body") {
    const hostWallId = rawIntent.hostWallId;
    const storedWall = (plan?.walls || []).find((wall) => wall?.id === hostWallId);
    const aNode = storedWall?.a ? plan?.nodes?.[storedWall.a] : null;
    const bNode = storedWall?.b ? plan?.nodes?.[storedWall.b] : null;
    if (!storedWall || !aNode || !bNode || rawIntent.connects !== true) {
      return reject("INTENT_REJECTED_WALL_BODY", `Explicit ${side} wall-body host is stale or unresolved`);
    }
    const a = aNode;
    const b = bNode;
    const projected = projectOnSegment(point, a, b);
    if (dist(point, projected) > INTENT_EPS_MM) {
      return reject("INTENT_REJECTED_WALL_BODY", `Explicit ${side} wall-body point is off the host centerline`);
    }
    if (dist(projected, a) <= INTENT_EPS_MM || dist(projected, b) <= INTENT_EPS_MM) {
      const nodeId = dist(projected, a) <= INTENT_EPS_MM ? storedWall.a : storedWall.b;
      const node = plan.nodes[nodeId];
      return {
        provided: true,
        intent: nodeIntent(nodeId, node),
        warnings: [warning("INTENT_DOWNGRADED_ENDPOINT", side, `Explicit ${side} wall-body intent resolved to host endpoint`)],
      };
    }
    return {
      provided: true,
      intent: {
        kind: "wall-body",
        point: { ...projected },
        nodeId: null,
        wallId: null,
        hostWallId,
        connects: true,
      },
      warnings: [],
    };
  }

  return reject("INTENT_REJECTED_WALL_BODY", `Unsupported explicit ${side} topology intent`);
}
