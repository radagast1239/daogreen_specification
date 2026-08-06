import { dist } from "../geometry/point.js";
import { projectOnSegment } from "../geometry/segment.js";
import { snapAltRound } from "../grid/gridSnap.js";
import { GRID_DEFAULT_SNAP_STEP } from "../grid/gridSettings.js";
import { collectSnapCandidates } from "./snapEngine.js";
import { compareSnapCandidates } from "./snapPriority.js";
import { SNAP_TYPES } from "./snapTypes.js";
// Same topology tolerance the commit path uses, so a capture never promises a
// link commitDrawnWall would refuse. snapEngine already depends on wallOps.
import { NODE_LINK_THR } from "../walls/wallOps.js";

export const WALL_POINT_MAX_DISTANCE_PX = 12;
export const WALL_POINT_MAX_DISTANCE_MM = 250;
export const WALL_POINT_TOPOLOGY_TIE_PX = 2;

/**
 * Model-space ceiling for NODE and WALL-END capture.
 *
 * The screen radius alone is not enough: at an overview zoom (~0.05) 12 px is
 * ~250 mm, so a corner or T-junction used to pull the cursor from a quarter of
 * a metre away and the user could not pick an arbitrary point along a wall.
 * Topology only ever links within NODE_LINK_THR, so capturing beyond it
 * promises a connection the commit would not make. Wall-body keeps the wider
 * WALL_POINT_MAX_DISTANCE_MM fallback because sliding along a wall is the
 * behaviour this bound is meant to protect.
 */
export const WALL_POINT_NODE_MAX_DISTANCE_MM = NODE_LINK_THR;

const TOPOLOGY_PRIORITY = { node: 0, "wall-end": 1, "wall-body": 2 };
const AXIS_TYPES = new Set([
  SNAP_TYPES.WALL_EXTENSION,
  SNAP_TYPES.PERPENDICULAR,
  SNAP_TYPES.PARALLEL,
]);

function isPoint(point) {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function copyPoint(point) {
  return { x: point.x, y: point.y };
}

function wallIdFromCandidate(candidate) {
  if (candidate.wallId) return candidate.wallId;
  if (candidate.hostWallId) return candidate.hostWallId;
  const target = candidate.targetId;
  if (typeof target !== "string") return null;
  const match = target.match(/^(.*):\d+$/);
  return match ? match[1] : target;
}

function wallById(plan, wallId) {
  return wallId ? (plan?.walls || []).find((wall) => wall.id === wallId) || null : null;
}

function nodePoint(plan, nodeId) {
  const node = nodeId ? plan?.nodes?.[nodeId] : null;
  return isPoint(node) ? node : null;
}

function findNodeIdAt(plan, point) {
  if (!isPoint(point)) return null;
  return Object.keys(plan?.nodes || {})
    .sort()
    .find((id) => {
      const node = plan.nodes[id];
      return isPoint(node) && Math.abs(node.x - point.x) <= 1e-6 && Math.abs(node.y - point.y) <= 1e-6;
    }) || null;
}

function wallSegment(plan, candidate, wallId) {
  if (isPoint(candidate.a) && isPoint(candidate.b)) {
    return { a: candidate.a, b: candidate.b };
  }
  const wall = wallById(plan, wallId);
  const a = nodePoint(plan, wall?.a) || wall?.pts?.[0];
  const b = nodePoint(plan, wall?.b) || wall?.pts?.[wall?.pts?.length - 1];
  return isPoint(a) && isPoint(b) ? { a, b } : null;
}

function endpointNodeId(plan, candidate, wallId, point) {
  if (candidate.nodeId) return candidate.nodeId;
  const wall = wallById(plan, wallId);
  for (const id of [wall?.a, wall?.b]) {
    const node = nodePoint(plan, id);
    if (node && dist(node, point) <= 1e-6) return id;
  }
  return findNodeIdAt(plan, point);
}

function topologyKind(candidate, plan) {
  if (["node", "wall-end", "wall-body"].includes(candidate.kind)) return candidate.kind;
  if (candidate.type === SNAP_TYPES.VERTEX) {
    const nodeId = candidate.nodeId || findNodeIdAt(plan, candidate.point);
    return nodeId ? "node" : "wall-end";
  }
  if (candidate.type === SNAP_TYPES.WALL_END) return "wall-end";
  if (candidate.type === SNAP_TYPES.WALL_LINE || candidate.type === SNAP_TYPES.WALL_MID) return "wall-body";
  return null;
}

function directionalKind(candidate) {
  if (["axis", "angle", "grid"].includes(candidate.kind)) return candidate.kind;
  if (AXIS_TYPES.has(candidate.type)) return "axis";
  if (candidate.type === SNAP_TYPES.ANGLE) return "angle";
  if (candidate.type === SNAP_TYPES.GRID) return "grid";
  return null;
}

function candidateGuides(candidate) {
  if (Array.isArray(candidate.guides)) return { items: candidate.guides };
  if (candidate.guides && typeof candidate.guides === "object") return candidate.guides;
  if (candidate.guide && typeof candidate.guide === "object") return candidate.guide;
  if (Number.isFinite(candidate.guideAngle)) return { angleDeg: candidate.guideAngle };
  return null;
}

function sourceOf(candidate, fallback) {
  return String(candidate.source || candidate.type || candidate.kind || fallback);
}

function stableCandidateKey(candidate) {
  return JSON.stringify([
    candidate.kind || "",
    candidate.type || "",
    candidate.nodeId || "",
    candidate.wallId || "",
    candidate.hostWallId || "",
    candidate.targetId || "",
    candidate.point?.x ?? null,
    candidate.point?.y ?? null,
  ]);
}

function rawResult(raw, point = raw, source = "raw", zoom = 1) {
  const distanceMm = dist(raw, point);
  return {
    point: copyPoint(point),
    kind: "raw",
    nodeId: null,
    wallId: null,
    hostWallId: null,
    distanceMm,
    distancePx: distanceMm * zoom,
    connects: false,
    source,
    guides: null,
  };
}

function topologyCandidate(raw, zoom, plan, options, candidate) {
  if (!isPoint(candidate.point)) return null;
  const requestedKind = topologyKind(candidate, plan);
  if (!requestedKind) return null;
  const wallId = wallIdFromCandidate(candidate);

  if (requestedKind === "wall-body") {
    const segment = wallSegment(plan, candidate, wallId);
    const point = segment ? projectOnSegment(raw, segment.a, segment.b) : copyPoint(candidate.point);
    const axisDistanceMm = dist(raw, point);
    const wall = wallById(plan, wallId);
    const wallThicknessMm = Number(candidate.wallThicknessMm ?? wall?.thk ?? options.wallThk ?? 100);
    const halfThicknessMm = Math.max(0, wallThicknessMm) / 2;
    const faceDistanceMm = Math.max(0, axisDistanceMm - halfThicknessMm);
    const faceDistancePx = faceDistanceMm * zoom;
    if (faceDistancePx > WALL_POINT_MAX_DISTANCE_PX) return null;
    if (axisDistanceMm > halfThicknessMm + WALL_POINT_MAX_DISTANCE_MM) return null;
    return {
      candidate,
      point,
      kind: "wall-body",
      nodeId: null,
      wallId: null,
      hostWallId: candidate.hostWallId || wallId,
      distanceMm: axisDistanceMm,
      distancePx: axisDistanceMm * zoom,
      selectionDistancePx: faceDistancePx,
      axisDistanceMm,
      faceDistanceMm,
      faceDistancePx,
      wallThicknessMm,
      connects: true,
      source: sourceOf(candidate, "wall-body"),
      guides: candidateGuides(candidate),
    };
  }

  let point = copyPoint(candidate.point);
  let nodeId = candidate.nodeId || findNodeIdAt(plan, point);
  let kind = requestedKind;
  if (kind === "node" && nodeId) {
    const exact = nodePoint(plan, nodeId);
    if (exact) point = copyPoint(exact);
  } else if (kind === "node" && !nodeId) {
    kind = "wall-end";
  }
  if (kind === "wall-end") {
    nodeId = endpointNodeId(plan, candidate, wallId, point);
    const exact = nodePoint(plan, nodeId);
    if (exact) point = copyPoint(exact);
  }
  const distanceMm = dist(raw, point);
  const distancePx = distanceMm * zoom;
  // Both bounds must hold: a screen radius for feel, a model radius so the
  // capture can never promise a link the topology engine would refuse.
  if (distancePx > WALL_POINT_MAX_DISTANCE_PX || distanceMm > WALL_POINT_NODE_MAX_DISTANCE_MM) return null;
  return {
    candidate,
    point,
    kind,
    nodeId,
    wallId: kind === "wall-end" ? wallId : null,
    hostWallId: null,
    distanceMm,
    distancePx,
    selectionDistancePx: distancePx,
    connects: true,
    source: sourceOf(candidate, kind),
    guides: candidateGuides(candidate),
  };
}

function selectTopology(candidates) {
  if (!candidates.length) return null;
  const byDistance = [...candidates].sort((a, b) => (
    a.selectionDistancePx - b.selectionDistancePx
    || stableCandidateKey(a.candidate).localeCompare(stableCandidateKey(b.candidate))
  ));
  const closest = byDistance[0].selectionDistancePx;
  return byDistance
    .filter((candidate) => candidate.selectionDistancePx <= closest + WALL_POINT_TOPOLOGY_TIE_PX)
    .sort((a, b) => (
      TOPOLOGY_PRIORITY[a.kind] - TOPOLOGY_PRIORITY[b.kind]
      || a.selectionDistancePx - b.selectionDistancePx
      || stableCandidateKey(a.candidate).localeCompare(stableCandidateKey(b.candidate))
    ))[0];
}

function selectDirectional(raw, zoom, candidates, role, from) {
  const eligible = candidates
    .filter((candidate) => isPoint(candidate.point))
    .filter((candidate) => {
      const kind = directionalKind(candidate);
      if (!kind) return false;
      return kind === "grid" || (role === "end" && isPoint(from));
    })
    .sort((a, b) => compareSnapCandidates(a, b) || stableCandidateKey(a).localeCompare(stableCandidateKey(b)));
  const candidate = eligible[0];
  if (!candidate) return null;
  const point = copyPoint(candidate.point);
  const distanceMm = dist(raw, point);
  return {
    point,
    kind: directionalKind(candidate),
    nodeId: null,
    wallId: null,
    hostWallId: null,
    distanceMm,
    distancePx: distanceMm * zoom,
    connects: false,
    source: sourceOf(candidate, directionalKind(candidate)),
    guides: candidateGuides(candidate),
  };
}

/**
 * Pure PHASE 2B1 wall start/end resolver. It selects a point only; it never
 * mutates the plan or invokes topology, history, rooms or persistence.
 */
export function resolveWallPoint({
  point: raw,
  from = null,
  role = "end",
  zoom = 0.08,
  plan = {},
  candidates = null,
  candidateContext = {},
  modifiers = {},
  grid = {},
  options = {},
} = {}) {
  if (!isPoint(raw)) throw new TypeError("resolveWallPoint: point must contain finite x/y");
  if (role !== "start" && role !== "end") throw new TypeError('resolveWallPoint: role must be "start" or "end"');
  const effectiveZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 0.08;

  if (modifiers.alt) {
    return rawResult(raw, snapAltRound(raw, 1), "alt-raw", effectiveZoom);
  }

  const baseGridStep = grid.step ?? options.snapStep ?? GRID_DEFAULT_SNAP_STEP;
  const fineGridStep = grid.fineStep ?? options.fineSnapStep ?? 10;
  const snapStep = modifiers.ctrl ? fineGridStep : baseGridStep;
  const effectiveFrom = role === "end" && isPoint(from) ? from : null;
  const available = Array.isArray(candidates)
    ? [...candidates]
    : collectSnapCandidates({
      point: raw,
      mode: "wall",
      plan,
      draft: candidateContext.draft || {},
      view: { ...(candidateContext.view || {}), zoom: effectiveZoom },
      modifiers: { ...modifiers, alt: false },
      options: {
        ...options,
        from: effectiveFrom,
        snapStep,
        snapGrid: grid.enabled ?? options.snapGrid ?? true,
      },
    }).candidates;

  const topology = selectTopology(
    available
      .map((candidate) => topologyCandidate(raw, effectiveZoom, plan, options, candidate))
      .filter(Boolean),
  );
  if (topology) {
    const { candidate: _candidate, selectionDistancePx: _selection, ...result } = topology;
    return result;
  }

  return selectDirectional(raw, effectiveZoom, available, role, effectiveFrom)
    || rawResult(raw);
}
