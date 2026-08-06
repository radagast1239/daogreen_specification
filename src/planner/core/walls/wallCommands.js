/**
 * Command layer over the existing wall-network primitives (wallNetwork.js,
 * wallOps.js, core/dimensions/*). This module does NOT reimplement
 * network geometry — it composes the already-tested primitives and gives
 * them one consistent, structured contract so PlanPage can call commands
 * instead of mutating plan data ad hoc in many places.
 *
 * Contract: every command is pure/deterministic (no React/DOM/autosave/UI
 * state) and returns
 *   { plan, changed, affectedNodeIds, affectedWallIds, affectedDimensionIds, warnings }
 * `affectedDimensionIds` is additive — older callers that ignore it stay valid.
 * Expected user-facing conditions are reported as `warnings`, never thrown.
 *
 * Room detection is intentionally NOT run here — commands only change
 * geometry (+ dimension remaps); the next layer re-runs safe room sync.
 */
import { dist } from "../geometry/point.js";
import {
  findNodeIdAt, commitWallEdge, movePlanNode, deleteWallEdge,
  breakWallEdgeAt, mergeCloseNodes, resolvePlanWalls, pruneOrphanNodes, ensureWallNetwork,
  migratePtsWallsToNetwork, tryMergeWallEdge,
} from "../../wallNetwork.js";
import { NODE_LINK_THR, refreshWallMountedItems } from "./wallOps.js";
import { MIN_SEGMENT_MM } from "./wallModel.js";
import { normalizeNetworkCrossings } from "./wallDrawTopology.js";
import { findUnnodedCrossings } from "./renderedContours.js";
import { resolveAttachedDimension } from "../dimensions/model.js";
import {
  remapDimensionsAfterWallMove,
  remapDimensionAfterWallSplit,
  remapDimensionsAfterNodeMerge,
  invalidateDimensionsAfterWallDelete,
  resolveDimensions,
} from "../dimensions/anchorOperations.js";
import { healHostsAfterWallRemoval } from "./wallHostHeal.js";
import { resolveLogicalWallChain } from "./logicalWallChain.js";

const ENDPOINT_MERGE_MM = 1;
const WALL_MOVE_EPS_MM = 1e-4;
const WALL_MOVE_COLLINEAR_EPS_MM = 1;
const WALL_MOVE_PARALLEL_EPS = 1e-6;
/**
 * PHASE 2F1 — physical compatibility of two walls that meet head-on.
 *
 * `chainId` is deliberately NOT here. It used to be, and that is the topology
 * cause behind "a wall moves through another wall": a partition teed into the
 * middle of a facade whose two halves were drawn as SEPARATE walls (different
 * chainId, otherwise identical) failed this test, so endpointAttachment
 * classified the partition as "detach" instead of "tee" — and detach hands it
 * fresh FREE nodes. From that move on the partition has degree-1 ends, nothing
 * constrains it, and it slides straight through its neighbours. Reproduced on
 * the real project (room c3h0, wall d_part) and from the original fixture.
 *
 * Lineage is proof for MERGING two halves back into one wall, never a
 * precondition for a branch to have a host to slide along — see
 * hostHalvesProvablyOneWall.
 */
const HOST_PROPERTY_KEYS = [
  "thk", "role", "kind", "thicknessSide", "height", "material", "type", "locked",
];

function baseResult(plan) {
  return {
    plan,
    changed: false,
    affectedNodeIds: [],
    affectedWallIds: [],
    affectedDimensionIds: [],
    warnings: [],
  };
}

function withWarning(result, code, message, extra = {}) {
  result.warnings.push({ code, message, ...extra });
  return result;
}

function isFinitePoint(p) {
  return p != null && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function wallOtherNodeId(wall, nodeId) {
  if (wall?.a === nodeId) return wall.b;
  if (wall?.b === nodeId) return wall.a;
  return null;
}

function hostWallsCompatible(a, b) {
  return HOST_PROPERTY_KEYS.every((key) => (a?.[key] ?? null) === (b?.[key] ?? null));
}

/**
 * May these two halves be MERGED back into one wall?
 *
 * Only when they provably were one wall: same physical properties AND the same
 * non-null chainId lineage, which commitDrawnWall preserves across a host
 * split. Two collinear walls the user drew separately keep their own lineage
 * and must stay two walls, however identical they look (PHASE 2F1 category C).
 */
function hostHalvesProvablyOneWall(a, b) {
  if (!hostWallsCompatible(a, b)) return false;
  const la = a?.chainId ?? null;
  const lb = b?.chainId ?? null;
  return la != null && la === lb;
}

function oppositeCollinearAt(plan, nodeId, wallA, wallB) {
  const center = plan.nodes?.[nodeId];
  const a = plan.nodes?.[wallOtherNodeId(wallA, nodeId)];
  const b = plan.nodes?.[wallOtherNodeId(wallB, nodeId)];
  if (!center || !a || !b) return false;
  const ax = a.x - center.x;
  const ay = a.y - center.y;
  const bx = b.x - center.x;
  const by = b.y - center.y;
  const al = Math.hypot(ax, ay);
  const bl = Math.hypot(bx, by);
  if (al < MIN_SEGMENT_MM || bl < MIN_SEGMENT_MM) return false;
  const lineDistance = Math.abs(ax * by - ay * bx) / Math.max(al, bl);
  return lineDistance <= WALL_MOVE_COLLINEAR_EPS_MM && ax * bx + ay * by < 0;
}

function endpointAttachment(plan, wall, endpoint) {
  const nodeId = wall?.[endpoint];
  const point = plan.nodes?.[nodeId];
  const incident = (plan.walls || []).filter(
    (candidate) => candidate.id !== wall.id && (candidate.a === nodeId || candidate.b === nodeId),
  );
  const base = {
    endpoint,
    nodeId,
    point: point ? { x: point.x, y: point.y } : null,
    degree: incident.length + 1,
    incidentWallIds: incident.map((candidate) => candidate.id).sort(),
  };
  if (!incident.length) return { ...base, type: "free", hostWallIds: [] };
  if (incident.length === 1) return { ...base, type: "simple", hostWallIds: [] };
  if (
    incident.length === 2
    && hostWallsCompatible(incident[0], incident[1])
    && oppositeCollinearAt(plan, nodeId, incident[0], incident[1])
  ) {
    // Seen from THIS wall the two survivors form one straight, compatible host:
    // this wall is the branch of a T. It keeps the attachment and may only
    // slide along the host (see the effective-delta constraint solver).
    const freeNodeIds = incident.map((candidate) => wallOtherNodeId(candidate, nodeId));
    return {
      ...base,
      type: "tee",
      hostWallIds: incident.map((candidate) => candidate.id).sort(),
      hostEndpointNodeIds: freeNodeIds,
      hostStart: { ...plan.nodes[freeNodeIds[0]] },
      hostEnd: { ...plan.nodes[freeNodeIds[1]] },
    };
  }
  if (incident.length === 2) {
    // Degree-3 node whose two survivors are NOT one straight host as seen from
    // this wall — typically this wall is itself a host half (its collinear
    // continuation plus a perpendicular branch meet here), or a corner that
    // also carries a branch. The selected wall may DETACH: it gets fresh
    // endpoint nodes while the shared junction node and every wall that keeps
    // it are left untouched, so no host is bent and no shared node moves.
    // Previously this returned "multi" and froze the wall — on a real plan that
    // blocked 21 of 24 walls (see phase2c3 audit).
    return { ...base, type: "detach", hostWallIds: [] };
  }
  // Degree 4+ (or higher-order incidence): several possible host chains, no
  // single defensible detach/heal. Stay fail-closed.
  return { ...base, type: "multi", hostWallIds: [] };
}

/** Capture endpoint ownership from the immutable transaction base plan. */
export function classifyWallSegmentAttachments(plan, wallId) {
  const wall = (plan?.walls || []).find((candidate) => candidate.id === wallId);
  if (!wall?.a || !wall?.b || !plan?.nodes?.[wall.a] || !plan?.nodes?.[wall.b]) return null;
  return {
    wallId,
    start: endpointAttachment(plan, wall, "a"),
    end: endpointAttachment(plan, wall, "b"),
  };
}

function attachmentSignature(attachments) {
  if (!attachments) return null;
  const one = (value) => ({
    endpoint: value?.endpoint,
    nodeId: value?.nodeId,
    type: value?.type,
    degree: value?.degree,
    incidentWallIds: [...(value?.incidentWallIds || [])].sort(),
    hostWallIds: [...(value?.hostWallIds || [])].sort(),
  });
  return JSON.stringify({ wallId: attachments.wallId, start: one(attachments.start), end: one(attachments.end) });
}

/** Unit direction of a tee endpoint's merged host, or null if degenerate. */
function hostUnitVector(attachment) {
  const a = attachment?.hostStart;
  const b = attachment?.hostEnd;
  if (!a || !b) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < MIN_SEGMENT_MM) return null;
  return { x: dx / len, y: dy / len };
}

/**
 * The single rigid translation that satisfies every host constraint.
 *   no constraint            -> the requested delta unchanged
 *   one, or mutually parallel-> the requested delta projected onto the host
 *   crossing hosts           -> only zero motion satisfies both -> null
 * Length and angle of the moved wall are preserved by construction, because
 * both endpoints receive the same vector.
 */
function resolveEffectiveDelta(delta, unitVectors) {
  if (!unitVectors.length) return { x: delta.x, y: delta.y };
  const [first, ...rest] = unitVectors;
  for (const other of rest) {
    const cross = Math.abs(first.x * other.y - first.y * other.x);
    if (cross > WALL_MOVE_PARALLEL_EPS) return null;
  }
  const along = delta.x * first.x + delta.y * first.y;
  return { x: first.x * along, y: first.y * along };
}

/**
 * PHASE 2F1 — dual (or more) parallel host attachments share one rigid
 * translation. After projecting onto the common tangent, both endpoints must
 * remain inside their finite host spans. Compute each attachment's valid
 * scalar interval along the translation direction and clamp to the intersection.
 *
 * One-ended T keeps the historical fail-closed WALL_MOVE_OUTSIDE_HOST path;
 * only multi-tee walls use this clamp (double-T contract).
 */
function clampDeltaToFiniteHosts(delta, teeAttachments) {
  const mag = Math.hypot(delta.x, delta.y);
  if (mag <= WALL_MOVE_EPS_MM || teeAttachments.length < 2) return { ...delta };
  const ux = delta.x / mag;
  const uy = delta.y / mag;
  let sMin = -Infinity;
  let sMax = Infinity;
  for (const attachment of teeAttachments) {
    const a = attachment.hostStart;
    const b = attachment.hostEnd;
    const p = attachment.point;
    if (!a || !b || !p) return null;
    const hx = b.x - a.x;
    const hy = b.y - a.y;
    const len = Math.hypot(hx, hy);
    if (len < MIN_SEGMENT_MM * 2) return null;
    const len2 = len * len;
    // Keep a usable host stub on each side of the T so re-split cannot collapse
    // onto a corner node (which would silently detach the dual-T topology).
    const tPad = MIN_SEGMENT_MM / len;
    const t0 = ((p.x - a.x) * hx + (p.y - a.y) * hy) / len2;
    const alpha = (ux * hx + uy * hy) / len2;
    if (Math.abs(alpha) <= WALL_MOVE_EPS_MM) {
      if (t0 < tPad - WALL_MOVE_EPS_MM || t0 > 1 - tPad + WALL_MOVE_EPS_MM) return null;
      continue;
    }
    const sAtLo = (tPad - t0) / alpha;
    const sAtHi = (1 - tPad - t0) / alpha;
    const lo = Math.min(sAtLo, sAtHi);
    const hi = Math.max(sAtLo, sAtHi);
    sMin = Math.max(sMin, lo);
    sMax = Math.min(sMax, hi);
  }
  if (!(sMin <= sMax + WALL_MOVE_EPS_MM)) return null;
  const s = Math.max(sMin, Math.min(sMax, mag));
  if (Math.abs(s) <= WALL_MOVE_EPS_MM) return { x: 0, y: 0 };
  return { x: ux * s, y: uy * s };
}

/**
 * Does ANY non-zero translation satisfy this wall's host constraints?
 *
 * Delta-independent by construction: it asks the same solver moveWallSegment
 * uses and only looks at whether the constraint system is solvable at all, not
 * at how far one particular delta gets. A wall between two crossing hosts (say
 * a diagonal partition from a horizontal wall's body to a vertical wall's body)
 * has zero degrees of freedom, so every delta returns
 * WALL_MOVE_INCOMPATIBLE_HOST_CONSTRAINTS — the UI must not offer a handle
 * there. A wall with one host still has one, and must keep its handle even
 * though a delta perpendicular to that host reports NO_CHANGE.
 */
export function wallSegmentHasMovableDirection(attachments) {
  const units = [attachments?.start, attachments?.end]
    .filter((attachment) => attachment?.type === "tee")
    .map(hostUnitVector);
  if (units.some((unit) => !unit)) return false;
  return resolveEffectiveDelta({ x: 1, y: 0 }, units) !== null;
}

/**
 * Which surviving host half does this point actually sit on?
 *
 * After a branch leaves a junction the halves may or may not have merged. When
 * they did not, "the host" is two records, and the branch must be re-split into
 * the one that contains its new attachment point.
 */
function pickHostHalfContaining(plan, hostWallIds, point) {
  const candidates = resolvePlanWalls(plan).filter((w) => hostWallIds.includes(w.id));
  if (!candidates.length) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const a = candidate.pts?.[0];
    const b = candidate.pts?.[candidate.pts.length - 1];
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2)) : 0;
    const distance = Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

function projectOnHostLine(point, attachment) {
  const a = attachment.hostStart;
  const b = attachment.hostEnd;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (!len2) return null;
  const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2;
  if (t < -WALL_MOVE_EPS_MM || t > 1 + WALL_MOVE_EPS_MM) return null;
  return { x: a.x + dx * t, y: a.y + dy * t, t };
}

function wallHasDependentRecords(plan, wallIds) {
  const ids = new Set(wallIds);
  if ((plan.items || []).some((item) => ids.has(item.wallId))) return true;
  // Auto dimensions are regenerated from current topology; they must not block
  // host heal / branch relocation (PHASE 2F1).
  return (plan.dimensions || []).some((dimension) => {
    if (dimension?.auto) return false;
    const direct = dimension?.attachedTo?.id || dimension?.attachedTo?.wallId || dimension?.reference?.wallId;
    if (ids.has(direct)) return true;
    return (dimension?.anchors || []).some((anchor) => ids.has(anchor?.wallId));
  });
}

function moveWallFailure(plan, reason, attachments, delta, warnings = []) {
  return {
    ...baseResult(plan),
    reason,
    warnings,
    movement: {
      wallId: attachments?.wallId || null,
      delta: delta ? { ...delta } : null,
      startAttachment: attachments?.start || null,
      endAttachment: attachments?.end || null,
      healedHosts: [],
      createdSplitNodes: [],
    },
  };
}

function validateMovedNetwork(plan) {
  const used = new Set();
  const edges = new Set();
  for (const wall of plan.walls || []) {
    const a = plan.nodes?.[wall.a];
    const b = plan.nodes?.[wall.b];
    if (!a || !b) return "WALL_MOVE_MISSING_NODE";
    if (wall.a === wall.b || dist(a, b) < MIN_SEGMENT_MM) return "WALL_MOVE_ZERO_LENGTH";
    const edge = [wall.a, wall.b].sort().join("|");
    if (edges.has(edge)) return "WALL_MOVE_DUPLICATE_EDGE";
    edges.add(edge);
    used.add(wall.a);
    used.add(wall.b);
  }
  if (Object.keys(plan.nodes || {}).some((nodeId) => !used.has(nodeId))) return "WALL_MOVE_ORPHAN_NODE";
  if (findUnnodedCrossings(resolvePlanWalls(plan)).length) return "WALL_MOVE_UNNODED_CROSSING";
  return null;
}

function wallEdgeExists(walls, aId, bId) {
  return (walls || []).some((w) => (w.a === aId && w.b === bId) || (w.a === bId && w.b === aId));
}

function mapDimWarnings(list = []) {
  return list.map((w) => ({
    code: w.code,
    message: w.message || `Размер ${w.dimensionId || "?"}: ${w.code}`,
    dimensionId: w.dimensionId,
    ...(w.wallId != null ? { wallId: w.wallId } : {}),
  }));
}

function wallSplitT(resolved, point) {
  const pts = resolved?.pts;
  if (!pts || pts.length < 2) return 0.5;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (!len2) return 0.5;
  const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2;
  return Math.max(0, Math.min(1, t));
}

/** Merge a dimension-op result into a wall-command result (plan.dimensions + warnings). */
function applyDimResult(cmd, dimResult) {
  if (!dimResult) return cmd;
  if (!dimResult.changed && !(dimResult.warnings || []).length) {
    return {
      ...cmd,
      affectedDimensionIds: [...new Set([...(cmd.affectedDimensionIds || []), ...(dimResult.affectedDimensionIds || [])])],
    };
  }
  return {
    ...cmd,
    plan: { ...cmd.plan, dimensions: dimResult.dimensions },
    affectedDimensionIds: [...new Set([
      ...(cmd.affectedDimensionIds || []),
      ...(dimResult.affectedDimensionIds || []),
    ])],
    warnings: [...(cmd.warnings || []), ...mapDimWarnings(dimResult.warnings || [])],
  };
}

/** invalid:true (per resolveAttachedDimension) for legacy attachedTo wall dims. */
function collectInvalidDimensionWarnings(plan, affectedWallIds) {
  if (!affectedWallIds.length) return [];
  const withPts = { ...plan, walls: resolvePlanWalls(plan) };
  const warnings = [];
  for (const dim of plan.dimensions || []) {
    if (dim?.attachedTo?.type !== "wall") continue;
    const wallId = dim.attachedTo.id || dim.attachedTo.wallId;
    if (!affectedWallIds.includes(wallId)) continue;
    const resolved = resolveAttachedDimension(dim, withPts);
    if (resolved.invalid) {
      warnings.push({
        code: "DIMENSION_ANCHOR_INVALID",
        message: `Размер ${dim.id} потерял привязку к стене ${wallId}`,
        dimensionId: dim.id,
        wallId,
      });
    }
  }
  return warnings;
}

/**
 * Legacy attachedTo wall dims still need an explicit review warning after split
 * (stale t0/t1 against the shortened segment). Anchor-model dims are remapped
 * via remapDimensionAfterWallSplit instead.
 */
function collectSplitLegacyDimensionWarnings(plan, splitWallId) {
  const warnings = [];
  for (const dim of plan.dimensions || []) {
    if (dim?.attachedTo?.type !== "wall") continue;
    if (Array.isArray(dim.anchors) && dim.anchors.length) continue;
    const wallId = dim.attachedTo.id || dim.attachedTo.wallId;
    if (wallId !== splitWallId) continue;
    warnings.push({
      code: "DIMENSION_ANCHOR_NEEDS_REVIEW",
      message: `Размер ${dim.id} привязан к разбитой стене ${splitWallId} — проверьте якорь`,
      dimensionId: dim.id,
      wallId: splitWallId,
    });
  }
  return warnings;
}

/** Добавить стену между двумя точками. Совпадающие узлы сливаются (см. commitWallEdge). */
export function addWall(plan, start, end, props = {}, makeId, options = {}) {
  if (typeof makeId !== "function") throw new Error("addWall: makeId is required");
  if (!isFinitePoint(start) || !isFinitePoint(end)) throw new Error("addWall: start/end must be finite points");

  if (dist(start, end) < MIN_SEGMENT_MM) {
    return withWarning(baseResult(plan), "ZERO_LENGTH_WALL", `Стена короче ${MIN_SEGMENT_MM}мм отклонена`);
  }
  const existingA = options.startNodeId && plan.nodes?.[options.startNodeId]
    ? options.startNodeId
    : findNodeIdAt(plan.nodes, start, options.startMergeMm ?? NODE_LINK_THR);
  const existingB = options.endNodeId && plan.nodes?.[options.endNodeId]
    ? options.endNodeId
    : findNodeIdAt(plan.nodes, end, options.endMergeMm ?? NODE_LINK_THR);
  if (existingA && existingB && existingA !== existingB && wallEdgeExists(plan.walls, existingA, existingB)) {
    return withWarning(baseResult(plan), "DUPLICATE_WALL", "Между этими узлами уже есть стена", {
      nodeIds: [existingA, existingB],
    });
  }

  const nextPlan = commitWallEdge(plan, start, end, props, makeId, options);
  if (nextPlan === plan) {
    return withWarning(baseResult(plan), "ZERO_LENGTH_WALL", "Начальная и конечная точка совпадают после привязки к узлу");
  }
  const newWall = nextPlan.walls[nextPlan.walls.length - 1];
  return {
    plan: nextPlan,
    changed: true,
    affectedNodeIds: [newWall.a, newWall.b],
    affectedWallIds: [newWall.id],
    affectedDimensionIds: [],
    warnings: [],
  };
}

/** Переместить узел в новую точку. Стены, ссылающиеся на узел, пересчитают геометрию при следующем resolvePlanWalls. */
export function moveNode(plan, nodeId, point) {
  if (!nodeId) throw new Error("moveNode: nodeId is required");
  if (!isFinitePoint(point)) throw new Error("moveNode: point must be finite");
  if (!plan?.nodes?.[nodeId]) {
    return withWarning(baseResult(plan), "NODE_NOT_FOUND", `Узел ${nodeId} не найден`);
  }
  const affectedWallIds = (plan.walls || [])
    .filter((w) => w.a === nodeId || w.b === nodeId)
    .map((w) => w.id);
  const nextPlan = movePlanNode(plan, nodeId, point);
  let result = {
    plan: nextPlan,
    changed: true,
    affectedNodeIds: [nodeId],
    affectedWallIds,
    affectedDimensionIds: [],
    warnings: [],
  };
  result = applyDimResult(result, remapDimensionsAfterWallMove(nextPlan, nextPlan.dimensions || []));
  return result;
}

/**
 * Разбить стену в точке на два ребра с общим новым узлом.
 * Door/window items, привязанные к стене, перепроецируются на новую геометрию
 * (refreshWallMountedItems). Dimension anchors remapped via anchorOperations.
 */
export function splitWall(plan, wallId, point, makeId) {
  if (typeof makeId !== "function") throw new Error("splitWall: makeId is required");
  if (!isFinitePoint(point)) throw new Error("splitWall: point must be finite");

  const resolved = resolvePlanWalls(plan).find((w) => w.id === wallId);
  if (!resolved?.pts?.length) {
    return withWarning(baseResult(plan), "WALL_NOT_FOUND", `Стена ${wallId} не найдена`);
  }
  if (resolved.pts.some((p) => dist(p, point) <= ENDPOINT_MERGE_MM)) {
    return { ...baseResult(plan), changed: false };
  }

  const splitT = wallSplitT(resolved, point);
  const broken = breakWallEdgeAt(plan, wallId, point, makeId);
  if (!broken) {
    return withWarning(baseResult(plan), "SPLIT_FAILED", `Точка вне стены ${wallId} — split не выполнен`);
  }
  const { plan: splitPlan, newWallId } = broken;
  const midWall = splitPlan.walls.find((w) => w.id === wallId);
  const midNodeId = midWall.b;
  const affectedWallIds = [wallId, newWallId];

  let nextPlan = splitPlan;
  if (Array.isArray(nextPlan.items) && nextPlan.items.length) {
    nextPlan = {
      ...nextPlan,
      items: refreshWallMountedItems(nextPlan.items, resolvePlanWalls(nextPlan), nextPlan.room, null),
    };
  }

  let result = {
    plan: nextPlan,
    changed: true,
    affectedNodeIds: [midNodeId],
    affectedWallIds,
    affectedDimensionIds: [],
    warnings: [
      ...collectSplitLegacyDimensionWarnings(nextPlan, wallId),
      ...collectInvalidDimensionWarnings(nextPlan, affectedWallIds),
    ],
  };

  const remapped = remapDimensionAfterWallSplit(nextPlan.dimensions || [], {
    oldWallId: wallId,
    firstWallId: wallId,
    secondWallId: newWallId,
    splitT,
    splitNodeId: midNodeId,
  });
  const reviewIds = new Set(
    (remapped.warnings || [])
      .filter((w) => w.code === "DIMENSION_ANCHOR_NEEDS_REVIEW")
      .map((w) => w.dimensionId),
  );
  const resolvedDims = resolveDimensions(
    { ...nextPlan, dimensions: remapped.dimensions },
    remapped.dimensions,
  );
  const dimensions = resolvedDims.dimensions.map((d) => (
    reviewIds.has(d.id) ? { ...d, invalid: true } : d
  ));
  result = applyDimResult(result, {
    dimensions,
    changed: remapped.changed || resolvedDims.changed || reviewIds.size > 0,
    affectedDimensionIds: [
      ...(remapped.affectedDimensionIds || []),
      ...(resolvedDims.affectedDimensionIds || []),
      ...reviewIds,
    ],
    warnings: [...(remapped.warnings || []), ...(resolvedDims.warnings || [])],
  });
  return result;
}

/** Удалить стену. Осиротевшие узлы удаляются автоматически (deleteWallEdge). */
export function deleteWall(plan, wallId) {
  const wall = (plan.walls || []).find((w) => w.id === wallId);
  if (!wall) return withWarning(baseResult(plan), "WALL_NOT_FOUND", `Стена ${wallId} не найдена`);

  let nextPlan = deleteWallEdge(plan, wallId);
  const warnings = [];

  // PHASE 2E FOLLOW-UP (M4) — removing the last branch of a T must give the
  // host back as ONE wall. commitDrawnWall splits the host into two records
  // when a branch attaches; without this the halves stayed separate forever,
  // leaving a redundant degree-2 node and two wall-length labels where the
  // user had drawn a single wall. Part of the same atomic delete, so one
  // history step and one save. Fails closed on anything that is not provably
  // the same wall — see wallHostHeal.
  const healed = healHostsAfterWallRemoval(nextPlan, [wall.a, wall.b], { mergeWallEdge: tryMergeWallEdge });
  const healedWallIds = [];
  if (healed.changed) {
    nextPlan = healed.plan;
    healedWallIds.push(...healed.mergedWallIds, ...healed.removedWallIds);
  }
  for (const it of (plan.items || []).filter((i) => i.wallId === wallId)) {
    warnings.push({
      code: "ITEM_LOST_HOST_WALL",
      message: `Объект ${it.id} потерял стену-носитель ${wallId}`,
      itemId: it.id,
      wallId,
    });
  }
  warnings.push(...collectInvalidDimensionWarnings(nextPlan, [wallId]));

  let result = {
    plan: nextPlan,
    changed: true,
    affectedNodeIds: [wall.a, wall.b].filter(Boolean),
    affectedWallIds: [wallId, ...healedWallIds],
    affectedDimensionIds: [],
    warnings,
  };
  result = applyDimResult(
    result,
    invalidateDimensionsAfterWallDelete(nextPlan.dimensions || [], { wallIds: [wallId] }),
  );
  return result;
}

/**
 * Удалить узел вместе со всеми стенами, которые к нему привязаны.
 * План не может содержать стену с недостающим концом, поэтому "удалить узел"
 * обязательно означает "удалить его стены" — это не побочный эффект, а policy.
 */
export function deleteNode(plan, nodeId) {
  if (!plan?.nodes?.[nodeId]) return withWarning(baseResult(plan), "NODE_NOT_FOUND", `Узел ${nodeId} не найден`);

  const touching = (plan.walls || []).filter((w) => w.a === nodeId || w.b === nodeId);
  let current = plan;
  const affectedWallIds = [];
  const affectedNodeIds = new Set([nodeId]);
  const affectedDimensionIds = [];
  const warnings = [];
  for (const w of touching) {
    const r = deleteWall(current, w.id);
    current = r.plan;
    affectedWallIds.push(w.id);
    r.affectedNodeIds.forEach((id) => affectedNodeIds.add(id));
    affectedDimensionIds.push(...(r.affectedDimensionIds || []));
    warnings.push(...r.warnings);
  }
  if (current.nodes?.[nodeId]) {
    const { [nodeId]: _drop, ...rest } = current.nodes;
    current = { ...current, nodes: rest };
  }
  if (!touching.length) {
    warnings.push({ code: "ISOLATED_NODE_REMOVED", message: `Узел ${nodeId} не был связан со стенами`, nodeId });
  }
  let result = {
    plan: current,
    changed: true,
    affectedNodeIds: [...affectedNodeIds],
    affectedWallIds,
    affectedDimensionIds: [...new Set(affectedDimensionIds)],
    warnings,
  };
  // Diagonals / angles that only referenced the deleted node.
  result = applyDimResult(
    result,
    invalidateDimensionsAfterWallDelete(result.plan.dimensions || [], { nodeIds: [nodeId] }),
  );
  return result;
}

/**
 * Слить dropId в keepId: стены dropId переподключаются на keepId, dropId удаляется.
 * Вырожденные (a===b) и задублировавшиеся после слияния стены отбрасываются с warning
 * вместо тихого создания невалидной/дублирующей геометрии.
 */
export function mergeNodes(plan, keepId, dropId) {
  if (!plan?.nodes?.[keepId] || !plan?.nodes?.[dropId]) {
    return withWarning(baseResult(plan), "NODE_NOT_FOUND", "Один из узлов не найден для merge");
  }
  if (keepId === dropId) return { ...baseResult(plan), changed: false };

  const beforeIds = new Set((plan.walls || []).map((w) => w.id));
  let walls = (plan.walls || []).map((w) => ({
    ...w,
    a: w.a === dropId ? keepId : w.a,
    b: w.b === dropId ? keepId : w.b,
  }));
  const warnings = [];
  const seen = new Set();
  walls = walls.filter((w) => {
    if (w.a === w.b) {
      warnings.push({ code: "DEGENERATE_WALL_REMOVED", message: `Стена ${w.id} выродилась после merge узлов`, wallId: w.id });
      return false;
    }
    const key = [w.a, w.b].sort().join("|");
    if (seen.has(key)) {
      warnings.push({ code: "DUPLICATE_WALL_REMOVED", message: `Стена ${w.id} задублировалась после merge узлов`, wallId: w.id });
      return false;
    }
    seen.add(key);
    return true;
  });
  const removedWallIds = [...beforeIds].filter((id) => !walls.some((w) => w.id === id));

  const { [dropId]: _drop, ...restNodes } = plan.nodes;
  const nextPlan = { ...plan, nodes: pruneOrphanNodes(restNodes, walls), walls };
  const affectedWallIds = walls.filter((w) => w.a === keepId || w.b === keepId).map((w) => w.id);
  let result = {
    plan: nextPlan,
    changed: true,
    affectedNodeIds: [keepId],
    affectedWallIds,
    affectedDimensionIds: [],
    warnings,
  };
  result = applyDimResult(
    result,
    remapDimensionsAfterNodeMerge(nextPlan.dimensions || [], { keepId, dropId }),
  );
  if (removedWallIds.length) {
    result = applyDimResult(
      result,
      invalidateDimensionsAfterWallDelete(result.plan.dimensions || [], { wallIds: removedWallIds }),
    );
  }
  result = applyDimResult(
    result,
    resolveDimensions(result.plan, result.plan.dimensions || []),
  );
  return result;
}

/**
 * Присоединить floating endpoint (nodeId) к другой стене в заданной точке —
 * T-junction / endpoint-to-wall connection. Если точка уже совпадает с
 * существующим узлом целевой стены, выполняется прямой merge без split.
 */
export function connectWallEndpoint(plan, nodeId, targetWallId, point, makeId) {
  if (!plan?.nodes?.[nodeId]) return withWarning(baseResult(plan), "NODE_NOT_FOUND", `Узел ${nodeId} не найден`);

  const split = splitWall(plan, targetWallId, point, makeId);
  if (!split.changed) {
    if (split.warnings.some((w) => w.code === "WALL_NOT_FOUND" || w.code === "SPLIT_FAILED")) return split;
    const resolved = resolvePlanWalls(plan).find((w) => w.id === targetWallId);
    const hitIdx = resolved?.pts?.findIndex((p) => dist(p, point) <= ENDPOINT_MERGE_MM);
    const hostNodeId = hitIdx === 0 ? resolved.a : hitIdx === 1 ? resolved.b : null;
    if (!hostNodeId || hostNodeId === nodeId) return { ...baseResult(plan), changed: false };
    return mergeNodes(plan, hostNodeId, nodeId);
  }

  const midNodeId = split.affectedNodeIds[0];
  const merged = mergeNodes(split.plan, midNodeId, nodeId);
  return {
    plan: merged.plan,
    changed: true,
    affectedNodeIds: [...new Set([...split.affectedNodeIds, ...merged.affectedNodeIds])],
    affectedWallIds: [...new Set([...split.affectedWallIds, ...merged.affectedWallIds])],
    affectedDimensionIds: [...new Set([
      ...(split.affectedDimensionIds || []),
      ...(merged.affectedDimensionIds || []),
    ])],
    warnings: [...split.warnings, ...merged.warnings],
  };
}

/**
 * Atomically translate one wall segment without moving shared topology nodes.
 * Endpoint attachment facts are captured from `plan` before any detach/heal.
 */
export function moveWallSegment(plan, {
  wallId,
  delta,
  expectedEndpointAttachments = null,
  makeId,
} = {}) {
  if (typeof makeId !== "function") throw new Error("moveWallSegment: makeId is required");
  if (!wallId) throw new Error("moveWallSegment: wallId is required");
  if (!isFinitePoint(delta)) throw new Error("moveWallSegment: delta must be finite");

  const wall = (plan?.walls || []).find((candidate) => candidate.id === wallId);
  const attachments = classifyWallSegmentAttachments(plan, wallId);
  if (!wall || !attachments) return moveWallFailure(plan, "WALL_NOT_FOUND", attachments, delta);
  if (
    expectedEndpointAttachments
    && attachmentSignature(expectedEndpointAttachments) !== attachmentSignature(attachments)
  ) {
    return moveWallFailure(plan, "WALL_MOVE_ATTACHMENT_MISMATCH", attachments, delta);
  }
  if (attachments.start.type === "multi" || attachments.end.type === "multi") {
    return moveWallFailure(plan, "WALL_MOVE_UNSAFE_MULTI_JUNCTION", attachments, delta);
  }
  const startHosts = new Set(attachments.start.hostWallIds || []);
  if ((attachments.end.hostWallIds || []).some((id) => startHosts.has(id))) {
    return moveWallFailure(plan, "WALL_MOVE_SAME_HOST_AMBIGUOUS", attachments, delta);
  }

  const oldA = plan.nodes[wall.a];
  const oldB = plan.nodes[wall.b];

  // ONE rigid translation for the whole segment. Endpoints must never be
  // corrected independently — that produced WALL_MOVE_HOST_CONSTRAINT_MISMATCH
  // for every wall with one free and one attached end. Only endpoints that KEEP
  // a host attachment ("tee") constrain the motion; free/simple/detach ends
  // impose nothing.
  const teeAttachments = [attachments.start, attachments.end]
    .filter((attachment) => attachment.type === "tee");
  const hostConstraints = teeAttachments.map(hostUnitVector);
  if (hostConstraints.some((unit) => !unit)) {
    return moveWallFailure(plan, "WALL_MOVE_HOST_CHANGED", attachments, delta);
  }
  let effectiveDelta = resolveEffectiveDelta(delta, hostConstraints);
  if (!effectiveDelta) {
    return moveWallFailure(plan, "WALL_MOVE_INCOMPATIBLE_HOST_CONSTRAINTS", attachments, delta);
  }
  // Double-T (and any multi-tee): clamp to the shared finite-host interval.
  // One-ended T keeps fail-closed WALL_MOVE_OUTSIDE_HOST below.
  if (teeAttachments.length >= 2) {
    const clamped = clampDeltaToFiniteHosts(effectiveDelta, teeAttachments);
    if (!clamped) {
      return moveWallFailure(plan, "WALL_MOVE_OUTSIDE_HOST", attachments, delta);
    }
    effectiveDelta = clamped;
  }
  const newA = { x: oldA.x + effectiveDelta.x, y: oldA.y + effectiveDelta.y };
  const newB = { x: oldB.x + effectiveDelta.x, y: oldB.y + effectiveDelta.y };
  // A constrained endpoint must still land inside its host span.
  for (const attachment of [attachments.start, attachments.end]) {
    if (attachment.type !== "tee") continue;
    const target = attachment.endpoint === "a" ? newA : newB;
    if (!projectOnHostLine(target, attachment)) {
      return moveWallFailure(plan, "WALL_MOVE_OUTSIDE_HOST", attachments, delta);
    }
  }
  const actualDeltaA = { ...effectiveDelta };
  if (dist(newA, newB) < MIN_SEGMENT_MM) {
    return moveWallFailure(plan, "ZERO_LENGTH_WALL", attachments, delta);
  }
  const duplicateGeometry = resolvePlanWalls(plan).some((candidate) => {
    if (candidate.id === wallId || !candidate.pts?.length) return false;
    const candidateA = candidate.pts[0];
    const candidateB = candidate.pts[candidate.pts.length - 1];
    return (dist(candidateA, newA) <= ENDPOINT_MERGE_MM && dist(candidateB, newB) <= ENDPOINT_MERGE_MM)
      || (dist(candidateA, newB) <= ENDPOINT_MERGE_MM && dist(candidateB, newA) <= ENDPOINT_MERGE_MM);
  });
  if (duplicateGeometry) {
    return moveWallFailure(plan, "DUPLICATE_WALL", attachments, delta);
  }
  if (Math.hypot(actualDeltaA.x, actualDeltaA.y) <= WALL_MOVE_EPS_MM) {
    return moveWallFailure(plan, "NO_CHANGE", attachments, delta);
  }

  // Endpoint ownership:
  //   free / simple — translate the EXISTING node so incident walls stay
  //                   connected and stretch/shorten (Phase 2C/2E centre-handle
  //                   contract for degree-2 corners).
  //   tee           — detach onto a fresh node, heal the vacated host, re-split
  //                   at the new attachment (branch slides on host).
  //   detach        — detach onto a fresh node; leave the shared junction put.
  const endpointNodeIds = { a: wall.a, b: wall.b };
  let nextNodes = { ...(plan.nodes || {}) };
  let nextWalls = (plan.walls || []).map((candidate) => ({ ...candidate }));
  const createdFreshNodes = [];

  for (const attachment of [attachments.start, attachments.end]) {
    const endpoint = attachment.endpoint; // "a" | "b"
    const target = endpoint === "a" ? newA : newB;
    if (attachment.type === "free" || attachment.type === "simple") {
      const nodeId = attachment.nodeId;
      nextNodes = { ...nextNodes, [nodeId]: { x: target.x, y: target.y } };
      endpointNodeIds[endpoint] = nodeId;
      continue;
    }
    // tee | detach → fresh endpoint node
    const freshId = makeId("n");
    if (!freshId || nextNodes[freshId] || plan.nodes?.[freshId]
      || freshId === endpointNodeIds.a || freshId === endpointNodeIds.b) {
      return moveWallFailure(plan, "WALL_MOVE_ID_COLLISION", attachments, delta);
    }
    nextNodes = { ...nextNodes, [freshId]: { x: target.x, y: target.y } };
    endpointNodeIds[endpoint] = freshId;
    createdFreshNodes.push(freshId);
  }
  if (endpointNodeIds.a === endpointNodeIds.b) {
    return moveWallFailure(plan, "WALL_MOVE_ID_COLLISION", attachments, delta);
  }
  nextWalls = nextWalls.map((candidate) => (
    candidate.id === wallId
      ? { ...candidate, a: endpointNodeIds.a, b: endpointNodeIds.b }
      : candidate
  ));
  let next = {
    ...plan,
    nodes: pruneOrphanNodes(nextNodes, nextWalls),
    walls: nextWalls,
  };

  // Heal vacated host junctions for tee (and detach that left a degree-2
  // collinear host). Never heal simple/free nodes we just translated.
  const vacatedTeeNodeIds = [attachments.start, attachments.end]
    .filter((attachment) => attachment.type === "tee" || attachment.type === "detach")
    .map((attachment) => attachment.nodeId)
    .filter(Boolean);
  for (const attachment of [attachments.start, attachments.end]) {
    if (attachment.type !== "tee") continue;
    const hostIds = attachment.hostWallIds || [];
    if (hostIds.length >= 2 && wallHasDependentRecords(plan, hostIds)) {
      return moveWallFailure(plan, "WALL_MOVE_UNSAFE_HOST_HEAL", attachments, delta);
    }
  }
  const hostLineageByEndpoint = {};
  for (const attachment of [attachments.start, attachments.end]) {
    if (attachment.type !== "tee") continue;
    const hostSample = (plan.walls || []).find((w) => (attachment.hostWallIds || []).includes(w.id));
    hostLineageByEndpoint[attachment.endpoint] = {
      hostWallIds: [...(attachment.hostWallIds || [])],
      chainId: hostSample?.chainId ?? null,
      oldNodeId: attachment.nodeId,
    };
  }
  // Heal ONLY the vacated junctions whose halves are provably one original
  // wall. The previous version stamped a shared chainId onto any two halves
  // (`teehost_<node>` when neither had one) so tryMergeWallEdge would run —
  // which invents lineage, and would fuse two walls the user drew separately
  // the moment a branch left their shared node (PHASE 2F1 category C).
  // Unprovable pairs simply keep their node; nothing is lost, nothing is merged.
  const provableHealNodeIds = vacatedTeeNodeIds.filter((nodeId) => {
    const attachment = [attachments.start, attachments.end]
      .find((a) => a.nodeId === nodeId && (a.type === "tee" || a.type === "detach"));
    const ids = attachment?.hostWallIds || [];
    if (ids.length < 2) return false;
    const halves = (next.walls || []).filter((w) => ids.includes(w.id));
    return halves.length >= 2 && hostHalvesProvablyOneWall(halves[0], halves[1]);
  });
  const healedBatch = provableHealNodeIds.length
    ? healHostsAfterWallRemoval(next, provableHealNodeIds, { mergeWallEdge: tryMergeWallEdge })
    : { plan: next, removedNodeIds: [], mergedWallIds: [], removedWallIds: [] };
  next = healedBatch.plan;
  const healedHosts = [];
  const healedMergedIds = [...(healedBatch.mergedWallIds || [])];
  const healedRemovedIds = [...(healedBatch.removedWallIds || [])];
  let healReportIdx = 0;
  for (const attachment of [attachments.start, attachments.end]) {
    if (attachment.type !== "tee") continue;
    if (!(healedBatch.removedNodeIds || []).includes(attachment.nodeId)) continue;
    const meta = hostLineageByEndpoint[attachment.endpoint] || {};
    const mergedId = healedMergedIds[healReportIdx]
      || healedMergedIds.find(Boolean)
      || meta.hostWallIds?.[0]
      || null;
    const removedWallId = healedRemovedIds[healReportIdx]
      || healedRemovedIds[0]
      || null;
    healReportIdx += 1;
    healedHosts.push({
      endpoint: attachment.endpoint,
      wallId: mergedId,
      removedWallId,
      oldNodeId: attachment.nodeId,
    });
  }

  const hostWallIdByEndpoint = {};
  for (const attachment of [attachments.start, attachments.end]) {
    if (attachment.type !== "tee") continue;
    const meta = hostLineageByEndpoint[attachment.endpoint] || {};
    // When the halves were NOT merged (they are not provably one wall) both
    // survive, and the branch must re-attach to the half it actually lands on —
    // picking whichever was found first would try to split the wrong one and
    // fail the whole gesture.
    const target = attachment.endpoint === "a" ? newA : newB;
    const surviving = pickHostHalfContaining(next, meta.hostWallIds || [], target);
    if (surviving) {
      hostWallIdByEndpoint[attachment.endpoint] = surviving.id;
      continue;
    }
    const byLineage = meta.chainId
      ? (next.walls || []).find((w) => w.chainId === meta.chainId)
      : null;
    const byMerged = (healedBatch.mergedWallIds || []).find((id) => (next.walls || []).some((w) => w.id === id));
    const hostId = byLineage?.id || byMerged || null;
    if (!hostId) return moveWallFailure(plan, "WALL_MOVE_HOST_CHANGED", attachments, delta);
    hostWallIdByEndpoint[attachment.endpoint] = hostId;
  }

  const newNodeA = endpointNodeIds.a;
  const newNodeB = endpointNodeIds.b;
  const createdSplitNodes = [];
  const affectedNodeIds = new Set([newNodeA, newNodeB, ...createdFreshNodes]);
  const affectedWallIds = new Set([wallId]);
  const warnings = [];
  for (const attachment of [attachments.start, attachments.end]) {
    if (attachment.type !== "tee") continue;
    const endpointNodeId = attachment.endpoint === "a" ? newNodeA : newNodeB;
    const target = attachment.endpoint === "a" ? newA : newB;
    const hostWallId = hostWallIdByEndpoint[attachment.endpoint];
    const host = resolvePlanWalls(next).find((candidate) => candidate.id === hostWallId);
    if (!host?.pts?.length) return moveWallFailure(plan, "WALL_MOVE_HOST_CHANGED", attachments, delta);
    const atA = dist(target, host.pts[0]) <= ENDPOINT_MERGE_MM;
    const atB = dist(target, host.pts[host.pts.length - 1]) <= ENDPOINT_MERGE_MM;
    if (atA || atB) {
      const hostNodeId = atA ? host.a : host.b;
      next = {
        ...next,
        walls: next.walls.map((candidate) => candidate.id === wallId
          ? { ...candidate, [attachment.endpoint]: hostNodeId }
          : candidate),
      };
      next = { ...next, nodes: pruneOrphanNodes(next.nodes, next.walls) };
      affectedNodeIds.add(hostNodeId);
      continue;
    }
    const split = splitWall(next, hostWallId, target, makeId);
    if (!split.changed || split.affectedNodeIds[0] !== endpointNodeId) {
      return moveWallFailure(plan, "WALL_MOVE_REATTACH_FAILED", attachments, delta);
    }
    next = split.plan;
    split.affectedNodeIds.forEach((id) => affectedNodeIds.add(id));
    split.affectedWallIds.forEach((id) => affectedWallIds.add(id));
    warnings.push(...split.warnings);
    createdSplitNodes.push({ endpoint: attachment.endpoint, nodeId: endpointNodeId, hostWallId });
  }

  const normalized = normalizeNetworkCrossings(next, makeId);
  next = normalized.plan;
  normalized.affectedNodeIds.forEach((id) => affectedNodeIds.add(id));
  normalized.affectedWallIds.forEach((id) => affectedWallIds.add(id));
  warnings.push(...normalized.warnings);

  const invalidReason = validateMovedNetwork(next);
  if (invalidReason) return moveWallFailure(plan, invalidReason, attachments, delta);
  const duplicateDestination = (next.walls || []).some((candidate) => (
    candidate.id !== wallId
    && ((candidate.a === newNodeA && candidate.b === newNodeB)
      || (candidate.a === newNodeB && candidate.b === newNodeA))
  ));
  if (duplicateDestination) {
    return moveWallFailure(plan, "DUPLICATE_WALL", attachments, delta);
  }

  let result = {
    plan: next,
    changed: true,
    reason: "WALL_SEGMENT_MOVED",
    affectedNodeIds: [...affectedNodeIds],
    affectedWallIds: [...affectedWallIds],
    affectedDimensionIds: [],
    warnings,
    movement: {
      wallId,
      delta: { ...actualDeltaA },
      startAttachment: attachments.start,
      endAttachment: attachments.end,
      healedHosts,
      createdSplitNodes,
    },
  };
  result = applyDimResult(result, remapDimensionsAfterWallMove(next, next.dimensions || []));
  return result;
}

/**
 * PHASE 2F1 — move the LOGICAL wall, not one topology half.
 *
 * A host split by a T branch is two records but one wall to the user. Its
 * centre handle must translate the WHOLE chain rigidly: both outer endpoints,
 * every internal T junction node, in one transaction — so branches stay
 * attached and stretch through the junction they share, total host length and
 * direction are preserved by construction, and the gesture is a single history
 * entry and a single API write.
 *
 * This is the canonical connected-wall transaction, extended from a one-segment
 * span to an n-segment span: identical constraint solver, identical host
 * heal / re-split primitives, identical failure codes and result shape. A
 * single-segment chain delegates straight to moveWallSegment, so nothing about
 * the accepted Phase 2C/2E behaviour changes for walls that were never split.
 */
export function moveLogicalWallChain(plan, {
  wallId,
  delta,
  expectedChainWallIds = null,
  makeId,
} = {}) {
  if (typeof makeId !== "function") throw new Error("moveLogicalWallChain: makeId is required");
  if (!wallId) throw new Error("moveLogicalWallChain: wallId is required");
  if (!isFinitePoint(delta)) throw new Error("moveLogicalWallChain: delta must be finite");

  const chain = resolveLogicalWallChain(plan, wallId);
  if (!chain.ok || !chain.wallIds.length) {
    return moveWallFailure(plan, "WALL_NOT_FOUND", null, delta);
  }
  if (chain.segmentCount <= 1) {
    return moveWallSegment(plan, {
      wallId,
      delta,
      expectedEndpointAttachments: classifyWallSegmentAttachments(plan, wallId),
      makeId,
    });
  }
  if (expectedChainWallIds
    && [...expectedChainWallIds].sort().join("|") !== [...chain.wallIds].sort().join("|")) {
    return moveWallFailure(plan, "WALL_MOVE_ATTACHMENT_MISMATCH", null, delta);
  }
  // A closed ring has no outer endpoints; there is no defensible rigid move.
  if (chain.outerNodeIds[0] === chain.outerNodeIds[1]) {
    return moveWallFailure(plan, "WALL_MOVE_UNSAFE_MULTI_JUNCTION", null, delta);
  }

  const memberIds = new Set(chain.wallIds);
  const members = (plan.walls || []).filter((w) => memberIds.has(w.id));
  if (members.length !== chain.wallIds.length) {
    return moveWallFailure(plan, "WALL_NOT_FOUND", null, delta);
  }
  if (members.some((w) => w.locked)) {
    return moveWallFailure(plan, "WALL_LOCKED", null, delta);
  }

  // The two ends of the LOGICAL wall. At an outer node the only chain member
  // incident is its own terminal segment, so the existing per-wall classifier
  // is already chain-correct there.
  const terminals = chain.outerNodeIds.map((nodeId) => {
    const wall = members.find((w) => w.a === nodeId || w.b === nodeId);
    return wall ? { wall, endpoint: wall.a === nodeId ? "a" : "b", nodeId } : null;
  });
  if (terminals.some((t) => !t)) return moveWallFailure(plan, "WALL_NOT_FOUND", null, delta);

  const attachments = terminals.map((t) => endpointAttachment(plan, t.wall, t.endpoint));
  const chainAttachments = {
    wallId: chain.logicalId,
    start: attachments[0],
    end: attachments[1],
  };
  if (attachments.some((a) => a.type === "multi")) {
    return moveWallFailure(plan, "WALL_MOVE_UNSAFE_MULTI_JUNCTION", chainAttachments, delta);
  }
  const startHosts = new Set(attachments[0].hostWallIds || []);
  if ((attachments[1].hostWallIds || []).some((id) => startHosts.has(id))) {
    return moveWallFailure(plan, "WALL_MOVE_SAME_HOST_AMBIGUOUS", chainAttachments, delta);
  }

  // ONE rigid translation for the whole chain — same solver as one segment.
  const teeAttachments = attachments.filter((a) => a.type === "tee");
  const hostConstraints = teeAttachments.map(hostUnitVector);
  if (hostConstraints.some((unit) => !unit)) {
    return moveWallFailure(plan, "WALL_MOVE_HOST_CHANGED", chainAttachments, delta);
  }
  let effectiveDelta = resolveEffectiveDelta(delta, hostConstraints);
  if (!effectiveDelta) {
    return moveWallFailure(plan, "WALL_MOVE_INCOMPATIBLE_HOST_CONSTRAINTS", chainAttachments, delta);
  }
  if (teeAttachments.length >= 2) {
    const clamped = clampDeltaToFiniteHosts(effectiveDelta, teeAttachments);
    if (!clamped) {
      return moveWallFailure(plan, "WALL_MOVE_OUTSIDE_HOST", chainAttachments, delta);
    }
    effectiveDelta = clamped;
  }
  if (Math.hypot(effectiveDelta.x, effectiveDelta.y) <= WALL_MOVE_EPS_MM) {
    return moveWallFailure(plan, "NO_CHANGE", chainAttachments, delta);
  }
  const moved = (nodeId) => {
    const p = plan.nodes[nodeId];
    return p ? { x: p.x + effectiveDelta.x, y: p.y + effectiveDelta.y } : null;
  };
  for (const [i, attachment] of attachments.entries()) {
    if (attachment.type !== "tee") continue;
    const target = moved(terminals[i].nodeId);
    if (!target || !projectOnHostLine(target, attachment)) {
      return moveWallFailure(plan, "WALL_MOVE_OUTSIDE_HOST", chainAttachments, delta);
    }
  }

  // Node ownership, exactly the single-segment rules:
  //   internal T junction — translate in place, so the branch stays attached to
  //                         the same node and stretches through it;
  //   free / simple outer — translate in place (connected corner contract);
  //   tee / detach outer  — fresh node, then heal + re-split as usual.
  let nextNodes = { ...(plan.nodes || {}) };
  for (const nodeId of chain.internalNodeIds) {
    const target = moved(nodeId);
    if (!target) return moveWallFailure(plan, "WALL_MOVE_MISSING_NODE", chainAttachments, delta);
    nextNodes = { ...nextNodes, [nodeId]: target };
  }
  const terminalNodeIds = {};
  const createdFreshNodes = [];
  for (const [i, attachment] of attachments.entries()) {
    const { nodeId } = terminals[i];
    const target = moved(nodeId);
    if (!target) return moveWallFailure(plan, "WALL_MOVE_MISSING_NODE", chainAttachments, delta);
    if (attachment.type === "free" || attachment.type === "simple") {
      nextNodes = { ...nextNodes, [nodeId]: target };
      terminalNodeIds[nodeId] = nodeId;
      continue;
    }
    const freshId = makeId("n");
    if (!freshId || nextNodes[freshId] || plan.nodes?.[freshId]) {
      return moveWallFailure(plan, "WALL_MOVE_ID_COLLISION", chainAttachments, delta);
    }
    nextNodes = { ...nextNodes, [freshId]: target };
    terminalNodeIds[nodeId] = freshId;
    createdFreshNodes.push(freshId);
  }

  let nextWalls = (plan.walls || []).map((candidate) => {
    const t = terminals.find((x) => x.wall.id === candidate.id);
    if (!t) return { ...candidate };
    const replacement = terminalNodeIds[t.nodeId];
    if (!replacement || replacement === t.nodeId) return { ...candidate };
    return { ...candidate, [t.endpoint]: replacement };
  });
  // Both ends of a two-segment chain can be terminals of DIFFERENT records, so
  // a single map pass covers them; a one-record chain was delegated above.
  if (nextWalls.some((w) => w.a === w.b)) {
    return moveWallFailure(plan, "WALL_MOVE_ID_COLLISION", chainAttachments, delta);
  }

  let next = {
    ...plan,
    nodes: pruneOrphanNodes(nextNodes, nextWalls),
    walls: nextWalls,
  };

  const vacatedTeeNodeIds = attachments
    .filter((a) => a.type === "tee" || a.type === "detach")
    .map((a) => a.nodeId)
    .filter(Boolean);
  for (const attachment of attachments) {
    if (attachment.type !== "tee") continue;
    const hostIds = attachment.hostWallIds || [];
    if (hostIds.length >= 2 && wallHasDependentRecords(plan, hostIds)) {
      return moveWallFailure(plan, "WALL_MOVE_UNSAFE_HOST_HEAL", chainAttachments, delta);
    }
  }
  const hostLineageByEndpoint = {};
  for (const [i, attachment] of attachments.entries()) {
    if (attachment.type !== "tee") continue;
    const hostSample = (plan.walls || []).find((w) => (attachment.hostWallIds || []).includes(w.id));
    hostLineageByEndpoint[i] = {
      hostWallIds: [...(attachment.hostWallIds || [])],
      chainId: hostSample?.chainId ?? null,
      oldNodeId: attachment.nodeId,
    };
  }
  // Same provable-only rule as moveWallSegment: never invent lineage to make a
  // merge possible (PHASE 2F1 category C).
  const provableHealNodeIds = vacatedTeeNodeIds.filter((nodeId) => {
    const attachment = attachments
      .find((a) => a.nodeId === nodeId && (a.type === "tee" || a.type === "detach"));
    const ids = attachment?.hostWallIds || [];
    if (ids.length < 2) return false;
    const halves = (next.walls || []).filter((w) => ids.includes(w.id));
    return halves.length >= 2 && hostHalvesProvablyOneWall(halves[0], halves[1]);
  });
  const healedBatch = provableHealNodeIds.length
    ? healHostsAfterWallRemoval(next, provableHealNodeIds, { mergeWallEdge: tryMergeWallEdge })
    : { plan: next, removedNodeIds: [], mergedWallIds: [], removedWallIds: [] };
  next = healedBatch.plan;

  const healedHosts = [];
  const createdSplitNodes = [];
  const affectedNodeIds = new Set([...chain.nodeIds, ...createdFreshNodes, ...Object.values(terminalNodeIds)]);
  const affectedWallIds = new Set(chain.wallIds);
  const warnings = [];
  for (const [i, attachment] of attachments.entries()) {
    if (attachment.type !== "tee") continue;
    if ((healedBatch.removedNodeIds || []).includes(attachment.nodeId)) {
      healedHosts.push({
        endpoint: attachment.endpoint,
        wallId: (healedBatch.mergedWallIds || []).find(Boolean) || null,
        removedWallId: (healedBatch.removedWallIds || [])[0] || null,
        oldNodeId: attachment.nodeId,
      });
    }
    const meta = hostLineageByEndpoint[i] || {};
    const endpointNodeId = terminalNodeIds[terminals[i].nodeId];
    const target = next.nodes?.[endpointNodeId];
    // Unmerged halves both survive — re-attach to the one the end lands on.
    const surviving = target
      ? pickHostHalfContaining(next, meta.hostWallIds || [], target)
      : (next.walls || []).find((w) => (meta.hostWallIds || []).includes(w.id));
    const byLineage = !surviving && meta.chainId
      ? (next.walls || []).find((w) => w.chainId === meta.chainId)
      : null;
    const byMerged = (healedBatch.mergedWallIds || [])
      .find((id) => (next.walls || []).some((w) => w.id === id));
    const hostWallId = surviving?.id || byLineage?.id || byMerged || null;
    if (!hostWallId) return moveWallFailure(plan, "WALL_MOVE_HOST_CHANGED", chainAttachments, delta);

    const host = resolvePlanWalls(next).find((candidate) => candidate.id === hostWallId);
    if (!host?.pts?.length || !target) {
      return moveWallFailure(plan, "WALL_MOVE_HOST_CHANGED", chainAttachments, delta);
    }
    const atA = dist(target, host.pts[0]) <= ENDPOINT_MERGE_MM;
    const atB = dist(target, host.pts[host.pts.length - 1]) <= ENDPOINT_MERGE_MM;
    if (atA || atB) {
      const hostNodeId = atA ? host.a : host.b;
      next = {
        ...next,
        walls: next.walls.map((candidate) => (candidate.id === terminals[i].wall.id
          ? { ...candidate, [terminals[i].endpoint]: hostNodeId }
          : candidate)),
      };
      next = { ...next, nodes: pruneOrphanNodes(next.nodes, next.walls) };
      affectedNodeIds.add(hostNodeId);
      continue;
    }
    const split = splitWall(next, hostWallId, target, makeId);
    if (!split.changed || split.affectedNodeIds[0] !== endpointNodeId) {
      return moveWallFailure(plan, "WALL_MOVE_REATTACH_FAILED", chainAttachments, delta);
    }
    next = split.plan;
    split.affectedNodeIds.forEach((id) => affectedNodeIds.add(id));
    split.affectedWallIds.forEach((id) => affectedWallIds.add(id));
    warnings.push(...split.warnings);
    createdSplitNodes.push({ endpoint: attachment.endpoint, nodeId: endpointNodeId, hostWallId });
  }

  const normalized = normalizeNetworkCrossings(next, makeId);
  next = normalized.plan;
  normalized.affectedNodeIds.forEach((id) => affectedNodeIds.add(id));
  normalized.affectedWallIds.forEach((id) => affectedWallIds.add(id));
  warnings.push(...normalized.warnings);

  const invalidReason = validateMovedNetwork(next);
  if (invalidReason) return moveWallFailure(plan, invalidReason, chainAttachments, delta);

  let result = {
    plan: next,
    changed: true,
    reason: "WALL_CHAIN_MOVED",
    affectedNodeIds: [...affectedNodeIds],
    affectedWallIds: [...affectedWallIds],
    affectedDimensionIds: [],
    warnings,
    movement: {
      wallId: chain.logicalId,
      chainWallIds: [...chain.wallIds],
      delta: { ...effectiveDelta },
      startAttachment: attachments[0],
      endAttachment: attachments[1],
      healedHosts,
      createdSplitNodes,
    },
  };
  result = applyDimResult(result, remapDimensionsAfterWallMove(next, next.dimensions || []));
  return result;
}

/**
 * PHASE 2F1 — one property write for the whole LOGICAL wall.
 *
 * A host split by a T must never end up with one half 100mm and the other
 * 200mm, or one half "outer" and the other "partition". Every segment of the
 * chain receives the same patch in one transaction; unrelated chains are never
 * touched, because membership is the same proven relation selection uses.
 */
export function setLogicalWallChainProps(plan, { wallId, props = {} } = {}) {
  if (!wallId) throw new Error("setLogicalWallChainProps: wallId is required");
  const chain = resolveLogicalWallChain(plan, wallId);
  if (!chain.ok || !chain.wallIds.length) {
    return { ...baseResult(plan), reason: "WALL_NOT_FOUND" };
  }
  const ids = new Set(chain.wallIds);
  const keys = Object.keys(props);
  if (!keys.length) return { ...baseResult(plan), reason: "NO_CHANGE" };
  const walls = (plan.walls || []).map((w) => (ids.has(w.id) ? { ...w, ...props } : w));
  const changed = (plan.walls || []).some((w, i) => ids.has(w.id)
    && keys.some((k) => w[k] !== walls[i][k]));
  if (!changed) return { ...baseResult(plan), reason: "NO_CHANGE" };
  return {
    ...baseResult({ ...plan, walls }),
    changed: true,
    reason: "WALL_CHAIN_PROPS_SET",
    affectedWallIds: [...ids],
  };
}

/**
 * Привести план к каноничной network-модели (nodes + wall.a/b), включая
 * миграцию legacy pts[] и слияние близких узлов (mergeCloseNodes).
 */
export function normalizeWallNetwork(plan, makeId) {
  const legacyOnly = (plan.walls || []).filter((w) => !(w.a && w.b) && (w.pts?.length >= 2));
  const alreadyNetwork = (plan.walls || []).filter((w) => w.a && w.b);
  let working = plan;
  if (legacyOnly.length && alreadyNetwork.length) {
    const migrated = migratePtsWallsToNetwork(legacyOnly, makeId, plan.nodes || {});
    working = { ...plan, nodes: migrated.nodes, walls: [...alreadyNetwork, ...migrated.walls] };
  }
  const ensured = ensureWallNetwork(working, makeId);
  const merged = mergeCloseNodes(ensured);
  const changed = JSON.stringify(merged.nodes) !== JSON.stringify(plan.nodes || {})
    || JSON.stringify(merged.walls) !== JSON.stringify(plan.walls || []);
  return {
    plan: merged,
    changed,
    affectedNodeIds: [],
    affectedWallIds: [],
    affectedDimensionIds: [],
    warnings: [],
  };
}

export { resolvePlanWalls as deriveLegacyPts };
