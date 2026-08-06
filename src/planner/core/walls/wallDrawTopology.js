/**
 * Live wall-drawing topology commit: deferred host splits, first-hit stop,
 * imported crossing normalization. Pure core — no React / DOM / autosave.
 */
import { dist, near } from "../geometry/point.js";
import {
  collinearOverlap,
  segmentsIntersectProper,
  segmentIntersectionPoint,
} from "../geometry/segment.js";
import {
  resolvePlanWalls,
  findNodeIdAt,
  NODE_MERGE_MM,
} from "../../wallNetwork.js";
import { NODE_LINK_THR, wallSegments } from "./wallOps.js";
import { MIN_SEGMENT_MM } from "./wallModel.js";
import {
  addWall,
  splitWall,
  connectWallEndpoint,
  mergeNodes,
} from "./wallCommands.js";
import {
  WALL_BODY_ENDPOINT_EPS_MM,
  nearestPointOnWallSegment,
  clipWallDraftEnd,
} from "./wallDrawGeometry.js";
import { assertHostSplitPreservesSegment } from "./hostSplitInvariant.js";
import { INTENT_EPS_MM, normalizeWallTopologyIntent } from "./wallIntent.js";

export {
  WALL_BODY_ENDPOINT_EPS_MM,
  WALL_DRAW_MIN_ALONG_MM,
  WALL_BODY_LINK_THR_MM,
  nearestPointOnWallSegment,
  findFirstWallIntersectionAlongSegment,
  clipWallDraftEnd,
} from "./wallDrawGeometry.js";

export { assertHostSplitPreservesSegment, hostEndpointsUnchangedExceptSplit } from "./hostSplitInvariant.js";

/* ------------------------------------------------------------------ *
 * PHASE 2D — the single decision for where a drawn wall actually ends.
 *
 * The V2 preview used to draw the resolver's endpoint while the commit below
 * clipped the very same segment at the first wall it crossed, so the rubber
 * band promised geometry the release never produced. The rule now lives here
 * once: the preview calls it to draw, commitDrawnWallWithIntents calls it to
 * build topology, and because it is idempotent the second call on an
 * already-clipped segment reproduces the first call's point.
 *
 * The clipping is not a new algorithm — it is the proven clipWallDraftEnd
 * decision this file has always made, lifted into one place and given the
 * metadata a preview needs (intent, parameter, reason). It lives in this
 * module rather than its own file so it can reuse the wallNetwork lookups
 * already allowlisted here instead of opening a new core boundary crossing.
 * ------------------------------------------------------------------ */

/** Deterministic explanation of which rule produced the endpoint. */
export const WALL_DRAFT_END_REASON = {
  INVALID: "INVALID_INPUT",
  NONE: "NO_CLIP",
  INTERSECTION: "FIRST_INTERSECTION",
  NODE: "NODE_AT_INTERSECTION",
  BODY: "BODY_SNAP",
  ENDPOINT: "ENDPOINT_SNAP",
  INTENT_BODY: "INTENT_WALL_BODY",
};

function copy(p) {
  return { x: p.x, y: p.y };
}

function noneIntent(point) {
  return { kind: "none", point: copy(point), nodeId: null, wallId: null, hostWallId: null, connects: false };
}

function nodeIntent(nodeId, point) {
  return { kind: "node", point: copy(point), nodeId, wallId: null, hostWallId: null, connects: true };
}

function bodyIntent(hostWallId, point) {
  return { kind: "wall-body", point: copy(point), nodeId: null, wallId: null, hostWallId, connects: true };
}

/**
 * The node commitDrawnWall would reuse instead of splitting: an existing node
 * within the topology tolerance that is genuinely an endpoint of the host wall.
 * Mirrors ensureNodeOnWall, so preview and commit agree on the same node.
 */
function reusableHostNode(plan, hostWallId, point) {
  const nodeId = findNodeIdAt(plan?.nodes, point, NODE_LINK_THR);
  if (!nodeId) return null;
  const host = (plan?.walls || []).find((w) => w?.id === hostWallId);
  if (!host || (host.a !== nodeId && host.b !== nodeId)) return null;
  const node = plan?.nodes?.[nodeId];
  if (!isFinitePoint(node)) return null;
  return { nodeId, point: copy(node) };
}

/**
 * Where the segment start→end really ends, given the existing walls.
 *
 * @param {object}  plan              committed plan (read only)
 * @param {object}  o
 * @param {Array}   o.walls           resolved walls (resolvePlanWalls output)
 * @param {object}  o.start           already-resolved start point
 * @param {object}  o.end             intended (unclipped) endpoint
 * @param {boolean} o.endIntentProvided  caller supplied an explicit end intent
 * @param {object}  o.endIntent       that normalized intent, when provided
 * @param {number}  o.bodyThrMm       legacy body-snap tolerance
 */
export function resolveWallDraftEnd(plan, {
  walls = [],
  start,
  end,
  endIntentProvided = false,
  endIntent = null,
  bodyThrMm = NODE_LINK_THR,
} = {}) {
  if (!isFinitePoint(start) || !isFinitePoint(end)) {
    const fallback = isFinitePoint(end) ? copy(end) : { x: 0, y: 0 };
    return {
      start: isFinitePoint(start) ? copy(start) : null,
      requestedEnd: fallback,
      point: fallback,
      clipped: false,
      hostWallId: null,
      geometric: false,
      kind: "none",
      t: 0,
      nodeId: null,
      intent: endIntentProvided ? endIntent : null,
      snapPatch: null,
      ignored: [],
      reason: WALL_DRAFT_END_REASON.INVALID,
    };
  }

  const requestedEnd = copy(end);
  // Exactly the call commitDrawnWallWithIntents has always made: an explicit
  // intent owns the endpoint, so only the geometric crossing may override it
  // (bodyThrMm -1 disables the legacy body-snap fallback), while an inferred
  // endpoint keeps the legacy body tolerance.
  const clip = clipWallDraftEnd(start, requestedEnd, walls, {
    bodyThrMm: endIntentProvided ? -1 : bodyThrMm,
  });

  let point = copy(clip.point);
  let hostWallId = null;
  let geometric = false;
  let kind = "none";
  let reason = WALL_DRAFT_END_REASON.NONE;

  if (clip.hit?.kind === "intersection") {
    hostWallId = clip.hit.wallId;
    geometric = true;
    kind = "intersection";
    reason = WALL_DRAFT_END_REASON.INTERSECTION;
  } else if (!endIntentProvided && clip.hit?.kind === "body") {
    hostWallId = clip.hit.wallId;
    kind = "body";
    reason = WALL_DRAFT_END_REASON.BODY;
  } else if (endIntentProvided && endIntent?.kind === "wall-body") {
    point = copy(endIntent.point);
    hostWallId = endIntent.hostWallId;
    kind = "wall-body";
    reason = WALL_DRAFT_END_REASON.INTENT_BODY;
  } else if (!endIntentProvided) {
    const endBody = nearestPointOnWallSegment(point, walls, bodyThrMm, { preferEndpoints: true });
    if (endBody?.kind === "interior") {
      point = copy(endBody.point);
      hostWallId = endBody.wallId;
      kind = "body";
      reason = WALL_DRAFT_END_REASON.BODY;
    } else if (clip.hit?.kind === "endpoint") {
      kind = "endpoint";
      reason = WALL_DRAFT_END_REASON.ENDPOINT;
    }
  }

  // The point commitDrawnWall has always handed to its host split. Kept
  // separate from `point` so sharing this helper cannot shift the committed
  // split location by even a millimetre.
  const splitPoint = copy(point);

  // A crossing that lands on an existing node of the host is that node, not a
  // fresh split — the same choice ensureNodeOnWall makes at commit time, and
  // the reason several walls meeting at one node resolve deterministically.
  let nodeId = null;
  if (hostWallId && geometric) {
    const reuse = reusableHostNode(plan, hostWallId, point);
    if (reuse) {
      nodeId = reuse.nodeId;
      point = reuse.point;
      kind = "node";
      reason = WALL_DRAFT_END_REASON.NODE;
    }
  }

  const totalLen = dist(start, requestedEnd);
  const along = dist(start, point);
  const t = totalLen > 0 ? Math.max(0, Math.min(1, along / totalLen)) : 0;
  const moved = dist(point, requestedEnd) > 1e-6;

  let intent;
  let snapPatch = null;
  if (nodeId) {
    intent = nodeIntent(nodeId, point);
    snapPatch = { kind: "node", nodeId, wallId: null, hostWallId: null, connects: true };
  } else if (geometric && hostWallId) {
    intent = bodyIntent(hostWallId, point);
    snapPatch = { kind: "wall-body", nodeId: null, wallId: null, hostWallId, connects: true };
  } else if (endIntentProvided) {
    intent = endIntent || noneIntent(point);
  } else {
    intent = null;
  }

  return {
    start: copy(start),
    requestedEnd,
    point,
    splitPoint,
    clipped: moved || geometric,
    hostWallId,
    geometric,
    kind,
    t,
    nodeId,
    intent,
    snapPatch,
    firstIntersection: clip.hit?.kind === "intersection" ? clip.hit : null,
    ignored: clip.hit?.ignored || [],
    reason,
  };
}

function baseResult(plan) {
  return {
    plan,
    changed: false,
    affectedNodeIds: [],
    affectedWallIds: [],
    affectedDimensionIds: [],
    warnings: [],
    meta: null,
  };
}

function withWarning(result, code, message, extra = {}) {
  result.warnings.push({ code, message, ...extra });
  return result;
}

function isFinitePoint(p) {
  return p != null && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function isCollinearDuplicate(start, end, walls, eps = 12) {
  for (const s of wallSegments(walls)) {
    const ov = collinearOverlap(start, end, s.a, s.b, eps);
    if (ov && ov.len > MIN_SEGMENT_MM) return true;
  }
  return false;
}

function captureHostSegment(plan, wallId) {
  const w = resolvePlanWalls(plan).find((x) => x.id === wallId);
  if (!w?.pts || w.pts.length < 2) return null;
  return {
    id: wallId,
    a: { ...w.pts[0] },
    b: { ...w.pts[w.pts.length - 1] },
    thk: w.thk,
    role: w.role,
    kind: w.kind,
    thicknessSide: w.thicknessSide,
  };
}

function verifyHostSplit(originalSeg, planAfter, splitWallIds) {
  if (!originalSeg || !splitWallIds?.length) {
    return { ok: true, issues: [], meta: null };
  }
  const parts = resolvePlanWalls(planAfter)
    .filter((w) => splitWallIds.includes(w.id))
    .map((w) => ({
      a: w.pts[0],
      b: w.pts[w.pts.length - 1],
      thk: w.thk,
    }));
  if (parts.length < 2) {
    // Endpoint hit / no real split — host unchanged.
    return { ok: true, issues: [], meta: { skipped: true } };
  }
  return assertHostSplitPreservesSegment(originalSeg, parts[0], parts[1]);
}

/**
 * Ensure a topology node exists on wallId at point (split if needed).
 */
export function ensureNodeOnWall(plan, wallId, point, makeId) {
  if (!isFinitePoint(point)) {
    return { plan, nodeId: null, changed: false, affectedWallIds: [], warnings: [] };
  }
  const existing = findNodeIdAt(plan.nodes, point, NODE_LINK_THR);
  if (existing) {
    const resolved = resolvePlanWalls(plan).find((w) => w.id === wallId);
    if (resolved && (resolved.a === existing || resolved.b === existing)) {
      return { plan, nodeId: existing, changed: false, affectedWallIds: [], warnings: [] };
    }
  }

  const split = splitWall(plan, wallId, point, makeId);
  if (split.changed) {
    return {
      plan: split.plan,
      nodeId: split.affectedNodeIds[0],
      changed: true,
      affectedWallIds: split.affectedWallIds,
      warnings: split.warnings,
    };
  }

  const resolved = resolvePlanWalls(plan).find((w) => w.id === wallId);
  if (!resolved?.pts?.length) {
    return {
      plan,
      nodeId: existing || null,
      changed: false,
      affectedWallIds: [],
      warnings: split.warnings,
    };
  }
  const atA = near(point, resolved.pts[0], WALL_BODY_ENDPOINT_EPS_MM);
  const atB = near(point, resolved.pts[resolved.pts.length - 1], WALL_BODY_ENDPOINT_EPS_MM);
  const hostNode = atA ? resolved.a : atB ? resolved.b : existing;
  return {
    plan,
    nodeId: hostNode || null,
    changed: false,
    affectedWallIds: [],
    warnings: split.warnings,
  };
}

/**
 * Normalize proper crossings in a network plan into topology nodes (scenario B).
 */
export function normalizeNetworkCrossings(plan, makeId, { maxPasses = 32 } = {}) {
  let next = plan;
  const affectedWallIds = new Set();
  const affectedNodeIds = new Set();
  const warnings = [];
  let changed = false;

  for (let pass = 0; pass < maxPasses; pass++) {
    const walls = resolvePlanWalls(next);
    const segs = wallSegments(walls);
    let hit = null;
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const s1 = segs[i];
        const s2 = segs[j];
        if (s1.wallId === s2.wallId) continue;
        if (near(s1.a, s2.a, WALL_BODY_ENDPOINT_EPS_MM) || near(s1.a, s2.b, WALL_BODY_ENDPOINT_EPS_MM)
          || near(s1.b, s2.a, WALL_BODY_ENDPOINT_EPS_MM) || near(s1.b, s2.b, WALL_BODY_ENDPOINT_EPS_MM)) {
          continue;
        }
        if (!segmentsIntersectProper(s1.a, s1.b, s2.a, s2.b)) continue;
        const ip = segmentIntersectionPoint(s1.a, s1.b, s2.a, s2.b);
        if (!ip) continue;
        if (near(ip, s1.a, WALL_BODY_ENDPOINT_EPS_MM) || near(ip, s1.b, WALL_BODY_ENDPOINT_EPS_MM)) continue;
        if (near(ip, s2.a, WALL_BODY_ENDPOINT_EPS_MM) || near(ip, s2.b, WALL_BODY_ENDPOINT_EPS_MM)) continue;
        hit = { wallA: s1.wallId, wallB: s2.wallId, point: ip };
        break;
      }
      if (hit) break;
    }
    if (!hit) break;

    const a = ensureNodeOnWall(next, hit.wallA, hit.point, makeId);
    next = a.plan;
    a.affectedWallIds.forEach((id) => affectedWallIds.add(id));
    if (a.nodeId) affectedNodeIds.add(a.nodeId);
    warnings.push(...a.warnings);
    if (a.changed) changed = true;

    const wallsAfter = resolvePlanWalls(next);
    const body = nearestPointOnWallSegment(hit.point, wallsAfter, WALL_BODY_ENDPOINT_EPS_MM, {
      preferEndpoints: false,
    });
    const wallBId = body && body.wallId !== hit.wallA ? body.wallId : hit.wallB;
    const b = ensureNodeOnWall(next, wallBId, hit.point, makeId);
    next = b.plan;
    b.affectedWallIds.forEach((id) => affectedWallIds.add(id));
    if (b.nodeId) affectedNodeIds.add(b.nodeId);
    warnings.push(...b.warnings);
    if (b.changed) changed = true;

    if (a.nodeId && b.nodeId && a.nodeId !== b.nodeId) {
      const merged = mergeNodes(next, a.nodeId, b.nodeId);
      next = merged.plan;
      merged.affectedWallIds.forEach((id) => affectedWallIds.add(id));
      merged.affectedNodeIds.forEach((id) => affectedNodeIds.add(id));
      warnings.push(...merged.warnings);
      if (merged.changed) changed = true;
    }
  }

  return {
    plan: next,
    changed,
    affectedNodeIds: [...affectedNodeIds],
    affectedWallIds: [...affectedWallIds],
    affectedDimensionIds: [],
    warnings,
  };
}

function nodeValence(plan, nodeId) {
  return (plan.walls || []).filter((w) => w.a === nodeId || w.b === nodeId).length;
}

/**
 * Atomic commit of one drawn wall segment with start/end-on-wall splits and
 * first-intersection stop.
 */
function commitDrawnWallLegacy(plan, start, end, props = {}, makeId, opts = {}) {
  if (typeof makeId !== "function") throw new Error("commitDrawnWall: makeId is required");
  if (!isFinitePoint(start) || !isFinitePoint(end)) {
    return withWarning(baseResult(plan), "INVALID_POINT", "Старт/конец стены невалидны");
  }

  const bodyThrMm = opts.bodyThrMm ?? NODE_LINK_THR;
  const walls = resolvePlanWalls(plan);

  const startHit = nearestPointOnWallSegment(start, walls, bodyThrMm, {
    preferEndpoints: true,
  });
  let finalStart = startHit ? { ...startHit.point } : { ...start };
  const startHostId = startHit && startHit.kind === "interior" ? startHit.wallId : null;

  const clipped = clipWallDraftEnd(finalStart, end, walls, { bodyThrMm });
  let finalEnd = { ...clipped.point };

  let endSplitHostId = null;
  if (clipped.hit && (clipped.hit.kind === "intersection" || clipped.hit.kind === "body")) {
    endSplitHostId = clipped.hit.wallId;
  } else {
    const endBody = nearestPointOnWallSegment(finalEnd, walls, bodyThrMm, {
      preferEndpoints: true,
    });
    if (endBody?.kind === "interior") {
      finalEnd = { ...endBody.point };
      endSplitHostId = endBody.wallId;
    }
  }

  if (dist(finalStart, finalEnd) < MIN_SEGMENT_MM) {
    return withWarning(baseResult(plan), "ZERO_LENGTH_WALL", `Стена короче ${MIN_SEGMENT_MM}мм отклонена`);
  }
  if (isCollinearDuplicate(finalStart, finalEnd, walls)) {
    return withWarning(baseResult(plan), "DUPLICATE_WALL", "Коллинеарный дубликат существующей стены");
  }

  const original = plan;
  let next = plan;
  const affectedNodeIds = new Set();
  const affectedWallIds = new Set();
  const warnings = [];
  const meta = {
    startHostId,
    endHostId: endSplitHostId,
    firstIntersection: clipped.hit?.kind === "intersection" ? clipped.hit : null,
    ignoredIntersections: clipped.hit?.ignored || [],
    finalStart,
    finalEnd,
    startSplitWallIds: [],
    endSplitWallIds: [],
    newWallId: null,
    nodeValences: {},
  };

  try {
    if (startHostId) {
      const hostBefore = captureHostSegment(next, startHostId);
      const ensured = ensureNodeOnWall(next, startHostId, finalStart, makeId);
      next = ensured.plan;
      ensured.affectedWallIds.forEach((id) => affectedWallIds.add(id));
      warnings.push(...ensured.warnings);
      meta.startSplitWallIds = ensured.affectedWallIds.slice();
      const inv = verifyHostSplit(hostBefore, next, ensured.affectedWallIds);
      meta.startHostInvariant = inv;
      if (!inv.ok) {
        warnings.push({
          code: "HOST_SPLIT_INVARIANT",
          message: `Start host split drifted: ${(inv.issues || []).join(",")}`,
          wallId: startHostId,
        });
      }
      if (ensured.nodeId) {
        affectedNodeIds.add(ensured.nodeId);
        finalStart = { ...next.nodes[ensured.nodeId] };
      }
    } else if (startHit?.kind === "endpoint") {
      const nid = findNodeIdAt(next.nodes, finalStart, NODE_LINK_THR);
      if (nid) {
        affectedNodeIds.add(nid);
        finalStart = { ...next.nodes[nid] };
      }
    }

    if (endSplitHostId) {
      const wallsNow = resolvePlanWalls(next);
      const body = nearestPointOnWallSegment(finalEnd, wallsNow, bodyThrMm, {
        preferEndpoints: true,
      });
      const hostId = body?.kind === "interior"
        ? body.wallId
        : (body?.kind === "endpoint" ? null : endSplitHostId);
      if (body?.kind === "interior") finalEnd = { ...body.point };
      if (hostId) {
        const hostBefore = captureHostSegment(next, hostId);
        const ensured = ensureNodeOnWall(next, hostId, finalEnd, makeId);
        next = ensured.plan;
        ensured.affectedWallIds.forEach((id) => affectedWallIds.add(id));
        warnings.push(...ensured.warnings);
        meta.endSplitWallIds = ensured.affectedWallIds.slice();
        meta.endHostId = hostId;
        const inv = verifyHostSplit(hostBefore, next, ensured.affectedWallIds);
        meta.endHostInvariant = inv;
        if (!inv.ok) {
          warnings.push({
            code: "HOST_SPLIT_INVARIANT",
            message: `End host split drifted: ${(inv.issues || []).join(",")}`,
            wallId: hostId,
          });
        }
        if (ensured.nodeId) {
          affectedNodeIds.add(ensured.nodeId);
          finalEnd = { ...next.nodes[ensured.nodeId] };
        }
      } else if (body?.kind === "endpoint") {
        const nid = findNodeIdAt(next.nodes, finalEnd, NODE_LINK_THR);
        if (nid) {
          affectedNodeIds.add(nid);
          finalEnd = { ...next.nodes[nid] };
        }
      }
    }

    if (dist(finalStart, finalEnd) < MIN_SEGMENT_MM) {
      return withWarning(baseResult(original), "ZERO_LENGTH_WALL", `Стена короче ${MIN_SEGMENT_MM}мм отклонена`);
    }

    const added = addWall(next, finalStart, finalEnd, props, makeId);
    if (!added.changed) {
      return {
        ...added,
        plan: original,
        changed: false,
        meta,
      };
    }
    next = added.plan;
    added.affectedNodeIds.forEach((id) => affectedNodeIds.add(id));
    added.affectedWallIds.forEach((id) => affectedWallIds.add(id));
    warnings.push(...added.warnings);
    meta.newWallId = added.affectedWallIds[0] || null;
    meta.finalStart = finalStart;
    meta.finalEnd = finalEnd;

    for (const wallId of added.affectedWallIds) {
      const w = (next.walls || []).find((x) => x.id === wallId);
      if (!w) continue;
      for (const nodeId of [w.a, w.b]) {
        const pt = next.nodes?.[nodeId];
        if (!pt) continue;
        const host = nearestPointOnWallSegment(pt, resolvePlanWalls(next), bodyThrMm, {
          excludeWallIds: [wallId],
          preferEndpoints: false,
        });
        if (!host || host.kind !== "interior") continue;
        const linked = connectWallEndpoint(next, nodeId, host.wallId, pt, makeId);
        if (linked.changed) {
          next = linked.plan;
          linked.affectedNodeIds.forEach((id) => affectedNodeIds.add(id));
          linked.affectedWallIds.forEach((id) => affectedWallIds.add(id));
          warnings.push(...linked.warnings);
        }
      }
    }

    const normalized = normalizeNetworkCrossings(next, makeId);
    if (normalized.changed) {
      next = normalized.plan;
      normalized.affectedNodeIds.forEach((id) => affectedNodeIds.add(id));
      normalized.affectedWallIds.forEach((id) => affectedWallIds.add(id));
      warnings.push(...normalized.warnings);
    }

    for (const nid of affectedNodeIds) {
      meta.nodeValences[nid] = nodeValence(next, nid);
    }

    return {
      plan: next,
      changed: true,
      affectedNodeIds: [...affectedNodeIds],
      affectedWallIds: [...affectedWallIds],
      affectedDimensionIds: [],
      warnings,
      meta,
    };
  } catch (err) {
    return withWarning(baseResult(original), "DRAW_COMMIT_FAILED", String(err?.message || err));
  }
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function hostAtExactPoint(plan, candidateIds, point) {
  const candidates = [...new Set(candidateIds.filter(Boolean))];
  const resolved = resolvePlanWalls(plan);
  for (const wallId of candidates) {
    const wall = resolved.find((item) => item.id === wallId);
    if (!wall) continue;
    const hit = nearestPointOnWallSegment(point, [wall], INTENT_EPS_MM, {
      preferEndpoints: false,
      endpointEpsMm: INTENT_EPS_MM,
    });
    if (hit) return wallId;
  }
  return null;
}

function nonConnectingNearNodeWarning(plan, intent, side) {
  if (intent?.kind !== "none") return null;
  if (findNodeIdAt(plan.nodes, intent.point, NODE_MERGE_MM)) return null;
  const nearby = findNodeIdAt(plan.nodes, intent.point, NODE_LINK_THR);
  if (!nearby) return null;
  return {
    code: "NON_CONNECTING_NEAR_NODE",
    side,
    nodeId: nearby,
    message: `Explicit ${side} endpoint remains separate from nearby node`,
  };
}

function withIntentContract(result, intentWarnings, intents) {
  return {
    ...result,
    intentWarnings,
    meta: result.meta ? { ...result.meta, intents } : result.meta,
  };
}

function commitDrawnWallWithIntents(plan, start, end, props, makeId, opts) {
  if (typeof makeId !== "function") throw new Error("commitDrawnWall: makeId is required");
  if (!isFinitePoint(start) || !isFinitePoint(end)) {
    return withIntentContract(
      withWarning(baseResult(plan), "INVALID_POINT", "Старт/конец стены невалидны"),
      [],
      { start: null, end: null },
    );
  }

  const startState = normalizeWallTopologyIntent(
    plan,
    hasOwn(opts, "startIntent") ? opts.startIntent : undefined,
    start,
    "start",
  );
  const endState = normalizeWallTopologyIntent(
    plan,
    hasOwn(opts, "endIntent") ? opts.endIntent : undefined,
    end,
    "end",
  );
  const intentWarnings = [...startState.warnings, ...endState.warnings];
  const startNearWarning = startState.provided
    ? nonConnectingNearNodeWarning(plan, startState.intent, "start")
    : null;
  const endNearWarning = endState.provided
    ? nonConnectingNearNodeWarning(plan, endState.intent, "end")
    : null;
  if (startNearWarning) intentWarnings.push(startNearWarning);
  if (endNearWarning) intentWarnings.push(endNearWarning);

  const bodyThrMm = opts.bodyThrMm ?? NODE_LINK_THR;
  const walls = resolvePlanWalls(plan);
  const legacyStartHit = startState.provided
    ? null
    : nearestPointOnWallSegment(start, walls, bodyThrMm, { preferEndpoints: true });
  let finalStart = startState.provided
    ? { ...startState.intent.point }
    : (legacyStartHit ? { ...legacyStartHit.point } : { ...start });
  const startHostId = startState.provided
    ? (startState.intent.kind === "wall-body" ? startState.intent.hostWallId : null)
    : (legacyStartHit?.kind === "interior" ? legacyStartHit.wallId : null);

  const requestedEnd = endState.provided ? endState.intent.point : end;
  // PHASE 2D — the endpoint rule is shared with the live V2 preview, so the
  // wall that is committed ends exactly where the rubber band ended. The rule
  // is idempotent: re-running it on an already-clipped segment reproduces the
  // same point, so release never invents a second geometry.
  const endDecision = resolveWallDraftEnd(plan, {
    walls,
    start: finalStart,
    end: requestedEnd,
    endIntentProvided: endState.provided,
    endIntent: endState.intent,
    bodyThrMm,
  });
  const clipped = { point: endDecision.splitPoint, hit: endDecision.firstIntersection };
  let finalEnd = { ...endDecision.splitPoint };
  const endSplitIsGeometric = endDecision.geometric;
  let endSplitHostId = endDecision.hostWallId;

  const intents = { start: startState.intent, end: endState.intent };
  const rejectEarly = (code, message) => withIntentContract(
    withWarning(baseResult(plan), code, message),
    intentWarnings,
    intents,
  );
  if (dist(finalStart, finalEnd) < MIN_SEGMENT_MM) {
    return rejectEarly("ZERO_LENGTH_WALL", `Стена короче ${MIN_SEGMENT_MM}мм отклонена`);
  }
  if (isCollinearDuplicate(finalStart, finalEnd, walls)) {
    return rejectEarly("DUPLICATE_WALL", "Коллинеарный дубликат существующей стены");
  }

  const original = plan;
  let next = plan;
  const affectedNodeIds = new Set();
  const affectedWallIds = new Set();
  const warnings = [];
  const hostAliases = new Map();
  let startNodeId = startState.intent?.kind === "node" ? startState.intent.nodeId : null;
  let endNodeId = endState.intent?.kind === "node" ? endState.intent.nodeId : null;
  const meta = {
    startHostId,
    endHostId: endSplitHostId,
    firstIntersection: clipped.hit?.kind === "intersection" ? clipped.hit : null,
    ignoredIntersections: clipped.hit?.ignored || [],
    finalStart,
    finalEnd,
    startSplitWallIds: [],
    endSplitWallIds: [],
    newWallId: null,
    nodeValences: {},
    intents,
  };

  const applySplit = (side, hostId, point) => {
    const aliases = hostAliases.get(hostId) || [];
    const resolvedHostId = hostAtExactPoint(next, [hostId, ...aliases], point);
    if (!resolvedHostId) return { stale: true, nodeId: null };
    const hostBefore = captureHostSegment(next, resolvedHostId);
    const ensured = ensureNodeOnWall(next, resolvedHostId, point, makeId);
    next = ensured.plan;
    ensured.affectedWallIds.forEach((id) => affectedWallIds.add(id));
    warnings.push(...ensured.warnings);
    hostAliases.set(hostId, [...new Set([resolvedHostId, ...aliases, ...ensured.affectedWallIds])]);
    const splitKey = side === "start" ? "startSplitWallIds" : "endSplitWallIds";
    const invariantKey = side === "start" ? "startHostInvariant" : "endHostInvariant";
    meta[splitKey] = ensured.affectedWallIds.slice();
    meta[side === "start" ? "startHostId" : "endHostId"] = resolvedHostId;
    const invariant = verifyHostSplit(hostBefore, next, ensured.affectedWallIds);
    meta[invariantKey] = invariant;
    if (!invariant.ok) {
      warnings.push({
        code: "HOST_SPLIT_INVARIANT",
        message: `${side} host split drifted: ${(invariant.issues || []).join(",")}`,
        wallId: resolvedHostId,
      });
    }
    if (ensured.nodeId) affectedNodeIds.add(ensured.nodeId);
    return { stale: false, nodeId: ensured.nodeId, point: ensured.nodeId ? next.nodes[ensured.nodeId] : point };
  };

  try {
    if (startHostId) {
      const split = applySplit("start", startHostId, finalStart);
      if (!split.stale && split.nodeId) {
        startNodeId = split.nodeId;
        finalStart = { ...split.point };
      }
    } else if (startState.provided && startNodeId) {
      affectedNodeIds.add(startNodeId);
      finalStart = { ...next.nodes[startNodeId] };
    } else if (!startState.provided && legacyStartHit?.kind === "endpoint") {
      const nodeId = findNodeIdAt(next.nodes, finalStart, NODE_LINK_THR);
      if (nodeId) {
        startNodeId = nodeId;
        affectedNodeIds.add(nodeId);
        finalStart = { ...next.nodes[nodeId] };
      }
    }

    if (endSplitHostId) {
      if (!endState.provided && !endSplitIsGeometric) {
        const body = nearestPointOnWallSegment(finalEnd, resolvePlanWalls(next), bodyThrMm, {
          preferEndpoints: true,
        });
        if (body?.kind === "interior") {
          finalEnd = { ...body.point };
          endSplitHostId = body.wallId;
        } else if (body?.kind === "endpoint") {
          const nodeId = findNodeIdAt(next.nodes, body.point, NODE_LINK_THR);
          if (nodeId) {
            endNodeId = nodeId;
            affectedNodeIds.add(nodeId);
            finalEnd = { ...next.nodes[nodeId] };
          }
          endSplitHostId = null;
        }
      }
      if (endSplitHostId) {
        const split = applySplit("end", endSplitHostId, finalEnd);
        if (split.stale) {
          intentWarnings.push({
            code: "INTENT_STALE_HOST_AFTER_SPLIT",
            side: "end",
            wallId: endSplitHostId,
            message: "Explicit end host became stale after the start split",
          });
          if (endState.provided) {
            endState.intent = {
              kind: "none",
              point: { ...finalEnd },
              nodeId: null,
              wallId: null,
              hostWallId: null,
              connects: false,
            };
            intents.end = endState.intent;
          }
        } else if (split.nodeId) {
          endNodeId = split.nodeId;
          finalEnd = { ...split.point };
        }
      }
    } else if (endState.provided && endNodeId) {
      affectedNodeIds.add(endNodeId);
      finalEnd = { ...next.nodes[endNodeId] };
    }

    if (dist(finalStart, finalEnd) < MIN_SEGMENT_MM) {
      return withIntentContract(
        withWarning(baseResult(original), "ZERO_LENGTH_WALL", `Стена короче ${MIN_SEGMENT_MM}мм отклонена`),
        intentWarnings,
        intents,
      );
    }

    const added = addWall(next, finalStart, finalEnd, props, makeId, {
      startNodeId,
      endNodeId,
      startMergeMm: startState.provided ? NODE_MERGE_MM : NODE_LINK_THR,
      endMergeMm: endState.provided ? NODE_MERGE_MM : NODE_LINK_THR,
    });
    if (!added.changed) {
      return withIntentContract({ ...added, plan: original, changed: false, meta }, intentWarnings, intents);
    }
    next = added.plan;
    added.affectedNodeIds.forEach((id) => affectedNodeIds.add(id));
    added.affectedWallIds.forEach((id) => affectedWallIds.add(id));
    warnings.push(...added.warnings);
    meta.newWallId = added.affectedWallIds[0] || null;
    meta.finalStart = finalStart;
    meta.finalEnd = finalEnd;

    const newWall = (next.walls || []).find((wall) => wall.id === meta.newWallId);
    const legacyEndpoints = [
      { nodeId: newWall?.a, infer: !startState.provided },
      { nodeId: newWall?.b, infer: !endState.provided },
    ];
    for (const endpoint of legacyEndpoints) {
      if (!endpoint.infer || !endpoint.nodeId) continue;
      const point = next.nodes?.[endpoint.nodeId];
      if (!point) continue;
      const host = nearestPointOnWallSegment(point, resolvePlanWalls(next), bodyThrMm, {
        excludeWallIds: [meta.newWallId],
        preferEndpoints: false,
      });
      if (!host || host.kind !== "interior") continue;
      const linked = connectWallEndpoint(next, endpoint.nodeId, host.wallId, point, makeId);
      if (!linked.changed) continue;
      next = linked.plan;
      linked.affectedNodeIds.forEach((id) => affectedNodeIds.add(id));
      linked.affectedWallIds.forEach((id) => affectedWallIds.add(id));
      warnings.push(...linked.warnings);
    }

    const normalized = normalizeNetworkCrossings(next, makeId);
    if (normalized.changed) {
      next = normalized.plan;
      normalized.affectedNodeIds.forEach((id) => affectedNodeIds.add(id));
      normalized.affectedWallIds.forEach((id) => affectedWallIds.add(id));
      warnings.push(...normalized.warnings);
    }

    for (const nodeId of affectedNodeIds) meta.nodeValences[nodeId] = nodeValence(next, nodeId);

    return withIntentContract({
      plan: next,
      changed: true,
      affectedNodeIds: [...affectedNodeIds],
      affectedWallIds: [...affectedWallIds],
      affectedDimensionIds: [],
      warnings,
      meta,
    }, intentWarnings, intents);
  } catch (error) {
    return withIntentContract(
      withWarning(baseResult(original), "DRAW_COMMIT_FAILED", String(error?.message || error)),
      intentWarnings,
      intents,
    );
  }
}

/**
 * Additive explicit-intent contract. Calls without either intent retain the
 * original coordinate-inference implementation byte-for-byte.
 */
export function commitDrawnWall(plan, start, end, props = {}, makeId, opts = {}) {
  if (!hasOwn(opts, "startIntent") && !hasOwn(opts, "endIntent")) {
    return commitDrawnWallLegacy(plan, start, end, props, makeId, opts);
  }
  return commitDrawnWallWithIntents(plan, start, end, props, makeId, opts);
}

/**
 * PHASE 2F1 — the same pre-commit path the V2 Wall tool uses.
 *
 * Preview: resolveWallDraftEnd(intendedEnd) with an explicit end intent
 * (cursor beyond a host → first-intersection clip).
 * Commit:  commitDrawnWall(..., { startIntent, endIntent }) so the legacy
 * no-intent path is never taken.
 *
 * Invariant: committed endpoint === final visible preview endpoint
 *            === first valid intersection/snap endpoint.
 *
 * Fixture builders and offline draw helpers MUST use this (or an equivalent
 * UI gesture) instead of bare commitDrawnWall(start, end) without intents.
 */
export function commitWallThroughCanonicalDrawPath(plan, start, intendedEnd, props = {}, makeId, opts = {}) {
  if (typeof makeId !== "function") {
    throw new Error("commitWallThroughCanonicalDrawPath: makeId is required");
  }
  if (!isFinitePoint(start) || !isFinitePoint(intendedEnd)) {
    return {
      ...withWarning(baseResult(plan), "INVALID_POINT", "Старт/конец стены невалидны"),
      preview: null,
      committedEnd: null,
    };
  }

  const bodyThrMm = opts.bodyThrMm ?? NODE_LINK_THR;
  const walls = resolvePlanWalls(plan);

  // Start resolution mirrors the V2 start snap → topology intent mapping.
  const startHit = nearestPointOnWallSegment(start, walls, bodyThrMm, {
    preferEndpoints: true,
  });
  let finalStart = startHit ? copy(startHit.point) : copy(start);
  let startIntent = noneIntent(finalStart);
  if (startHit?.kind === "endpoint") {
    const nodeId = findNodeIdAt(plan.nodes, finalStart, NODE_LINK_THR);
    startIntent = nodeId ? nodeIntent(nodeId, finalStart) : noneIntent(finalStart);
  } else if (startHit?.kind === "interior") {
    startIntent = bodyIntent(startHit.wallId, finalStart);
  }

  // Cursor intent is "none" until the first-intersection rule claims a host —
  // exactly what clipWallDrawV2End does when the pointer is past a wall body.
  const preview = resolveWallDraftEnd(plan, {
    walls,
    start: finalStart,
    end: intendedEnd,
    endIntentProvided: true,
    endIntent: noneIntent(intendedEnd),
    bodyThrMm,
  });
  const previewEnd = copy(preview.point);
  const endIntent = preview.intent || noneIntent(previewEnd);

  const result = commitDrawnWall(plan, finalStart, previewEnd, props, makeId, {
    ...opts,
    startIntent,
    endIntent,
    bodyThrMm,
  });

  return {
    ...result,
    preview: {
      requestedEnd: copy(preview.requestedEnd),
      previewEnd,
      clipped: !!preview.clipped,
      reason: preview.reason,
      hostWallId: preview.hostWallId,
      kind: preview.kind,
    },
    committedEnd: result.meta?.finalEnd ? copy(result.meta.finalEnd) : null,
  };
}
