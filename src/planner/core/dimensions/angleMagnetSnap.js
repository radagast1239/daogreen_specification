/**
 * PHASE 2F2.2 — MODE A: relative 45°/90° magnetic angle snap during movement.
 *
 * Pure solver. Visibility belongs in angleMagnetOverlay; selected-wall angles
 * stay in cornerAngleDimensions (MODE B).
 */
import { projectPointToAngle } from "../geometry/angles.js";
import {
  collectIncidentRays,
  normalizeDeg,
  displayCornerAngleDeg,
  formatCornerAngleDisplay,
  buildSelectedWallCornerAngles,
} from "./cornerAngleDimensions.js";

/** Enter snap when angular error ≤ this (degrees). */
export const MAGNET_ENTER_DEG = 3.5;
/** Leave snap only when angular error > this (degrees). Wider than enter. */
export const MAGNET_RELEASE_DEG = 6.0;

/** Relative offsets from the authoritative host/reference ray. */
export const RELATIVE_MAGNET_OFFSETS_DEG = Object.freeze([
  0, 45, 90, 135, 180, 225, 270, 315,
]);

/** Tie-break priority: lower wins when |Δ| equal. */
const OFFSET_PRIORITY = Object.freeze({
  90: 0,
  270: 1,
  45: 2,
  135: 3,
  0: 4,
  180: 5,
  225: 6,
  315: 7,
});

const MIN_ARM_MM = 8;
const GUIDE_MIN_MM = 1600;
const GUIDE_MAX_MM = 5200;
const CONTINUATION_SUPPRESS_DEG = 170;

const isFinitePt = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);

export function angularDiffDeg(a, b) {
  let d = Math.abs(normalizeDeg(a) - normalizeDeg(b));
  if (d > 180) d = 360 - d;
  return d;
}

export function buildRelativeMagnetCandidates(referenceAngleDeg) {
  const ref = normalizeDeg(referenceAngleDeg);
  return RELATIVE_MAGNET_OFFSETS_DEG.map((offset) => ({
    offsetDeg: offset,
    angleDeg: normalizeDeg(ref + offset),
    priority: OFFSET_PRIORITY[offset] ?? 99,
    label: offset === 0 || offset === 180
      ? "продолжение"
      : `${offset}°`,
  }));
}

function pickBestCandidate(rawAngleDeg, candidates) {
  let best = null;
  for (const c of candidates) {
    const diff = angularDiffDeg(rawAngleDeg, c.angleDeg);
    if (!best
      || diff < best.diff - 1e-12
      || (Math.abs(diff - best.diff) <= 1e-12 && c.priority < best.priority)
      || (Math.abs(diff - best.diff) <= 1e-12
        && c.priority === best.priority
        && c.angleDeg < best.angleDeg)
    ) {
      best = { ...c, diff };
    }
  }
  return best;
}

/**
 * Resolve magnetic snap with enter/release hysteresis.
 * Does not mutate plan / history.
 */
export function resolveAngleMagnet({
  pivot,
  rawPoint,
  referenceAngleDeg,
  previousSnapAngleDeg = null,
  enterDeg = MAGNET_ENTER_DEG,
  releaseDeg = MAGNET_RELEASE_DEG,
  guideLenMm = null,
} = {}) {
  if (!isFinitePt(pivot) || !isFinitePt(rawPoint) || !Number.isFinite(referenceAngleDeg)) {
    return {
      snapped: false,
      angleDeg: null,
      point: rawPoint || null,
      candidates: [],
      activeCandidate: null,
      guides: [],
      previousSnapAngleDeg: null,
    };
  }
  const dx = rawPoint.x - pivot.x;
  const dy = rawPoint.y - pivot.y;
  const len = Math.hypot(dx, dy);
  const rawAngleDeg = normalizeDeg((Math.atan2(dy, dx) * 180) / Math.PI);
  const candidates = buildRelativeMagnetCandidates(referenceAngleDeg);
  const gLen = Number.isFinite(guideLenMm)
    ? Math.min(GUIDE_MAX_MM, Math.max(GUIDE_MIN_MM, guideLenMm))
    : Math.min(GUIDE_MAX_MM, Math.max(GUIDE_MIN_MM, len * 1.85));

  let active = null;
  if (previousSnapAngleDeg != null && Number.isFinite(previousSnapAngleDeg)) {
    const held = candidates.find(
      (c) => angularDiffDeg(c.angleDeg, previousSnapAngleDeg) < 1e-6,
    ) || {
      angleDeg: normalizeDeg(previousSnapAngleDeg),
      offsetDeg: null,
      priority: 50,
      label: "magnet",
    };
    const holdDiff = angularDiffDeg(rawAngleDeg, held.angleDeg);
    if (holdDiff <= releaseDeg) {
      active = { ...held, diff: holdDiff };
    }
  }
  if (!active) {
    const best = pickBestCandidate(rawAngleDeg, candidates);
    if (best && best.diff <= enterDeg) active = best;
  }

  if (!active || !(len >= MIN_ARM_MM)) {
    return {
      snapped: false,
      angleDeg: rawAngleDeg,
      point: { x: rawPoint.x, y: rawPoint.y },
      candidates,
      activeCandidate: null,
      guides: buildMagnetGuides(pivot, candidates, null, gLen),
      previousSnapAngleDeg: null,
    };
  }

  const exactLen = Math.max(len, MIN_ARM_MM);
  const point = projectPointToAngle(pivot, active.angleDeg, exactLen);
  return {
    snapped: true,
    angleDeg: active.angleDeg,
    point,
    candidates,
    activeCandidate: active,
    guides: buildMagnetGuides(pivot, candidates, active, gLen),
    previousSnapAngleDeg: active.angleDeg,
  };
}

function buildMagnetGuides(pivot, candidates, active, lenMm) {
  // Local rays only — never a full-viewport field.
  const show = [];
  if (active) {
    show.push(active);
    // Neighbours at ±45° from the active offset when available.
    for (const c of candidates) {
      if (c.angleDeg === active.angleDeg) continue;
      if (active.offsetDeg == null) continue;
      const dOff = Math.min(
        Math.abs(c.offsetDeg - active.offsetDeg),
        360 - Math.abs(c.offsetDeg - active.offsetDeg),
      );
      if (dOff === 45 || dOff === 90) show.push(c);
    }
  } else {
    // Free movement: show 45/90 family relative to host (compact set).
    for (const c of candidates) {
      if ([0, 45, 90, 135, 180].includes(c.offsetDeg)) show.push(c);
    }
  }
  const seen = new Set();
  const out = [];
  for (const c of show) {
    if (seen.has(c.angleDeg)) continue;
    seen.add(c.angleDeg);
    const rad = (c.angleDeg * Math.PI) / 180;
    const ux = Math.cos(rad);
    const uy = Math.sin(rad);
    out.push({
      type: "magnet-ray",
      angleDeg: c.angleDeg,
      offsetDeg: c.offsetDeg,
      active: !!(active && c.angleDeg === active.angleDeg),
      a: { x: pivot.x - ux * lenMm, y: pivot.y - uy * lenMm },
      b: { x: pivot.x + ux * lenMm, y: pivot.y + uy * lenMm },
      at: { x: pivot.x, y: pivot.y },
    });
  }
  return out;
}

/**
 * Authoritative reference ray at a pivot for a moving wall / draft.
 * Prefers a T-host direction; else the strongest non-moving incident ray.
 */
export function resolveMagnetReference(plan, pivotNodeId, movingWallId = null) {
  const rays = collectIncidentRays(plan, pivotNodeId);
  if (!rays.length) return null;
  const others = movingWallId
    ? rays.filter((r) => r.wallId !== movingWallId)
    : rays.slice();
  if (!others.length) return { referenceAngleDeg: rays[0].angleDeg, rays, hostPair: null };

  // Near-collinear opposite hosts → T reference.
  let hostPair = null;
  for (let i = 0; i < others.length; i++) {
    for (let j = i + 1; j < others.length; j++) {
      const a = others[i];
      const b = others[j];
      const cross = Math.abs(a.ux * b.uy - a.uy * b.ux);
      const dot = a.ux * b.ux + a.uy * b.uy;
      if (cross <= 0.08 && dot <= -0.95) {
        hostPair = [a, b];
        break;
      }
    }
    if (hostPair) break;
  }
  if (hostPair) {
    return {
      referenceAngleDeg: hostPair[0].angleDeg,
      rays,
      hostPair,
      kind: "t-host",
    };
  }
  others.sort((a, b) => b.len - a.len || String(a.wallId).localeCompare(String(b.wallId)));
  return {
    referenceAngleDeg: others[0].angleDeg,
    rays,
    hostPair: null,
    kind: "companion",
  };
}

/**
 * Context for dragging a wall endpoint (free end rotates about the other end).
 * Returns null when the drag is a shared-node move (not a branch rotate).
 */
export function resolveEndpointMagnetContext(plan, wallId, endpointIdx) {
  const wall = (plan?.walls || []).find((w) => w.id === wallId);
  if (!wall || (endpointIdx !== 0 && endpointIdx !== 1)) return null;
  const movingNodeId = endpointIdx === 0 ? wall.a : wall.b;
  const pivotNodeId = endpointIdx === 0 ? wall.b : wall.a;
  if (!movingNodeId || !pivotNodeId) return null;
  const pivot = plan.nodes?.[pivotNodeId];
  if (!isFinitePt(pivot)) return null;
  // Shared topology node drag moves every incident wall — not MODE A rotate.
  const movingDegree = collectIncidentRays(plan, movingNodeId).length;
  if (movingDegree >= 2) return null;
  const pivotDegree = collectIncidentRays(plan, pivotNodeId).length;
  if (pivotDegree < 2) return null;
  const ref = resolveMagnetReference(plan, pivotNodeId, wallId);
  if (!ref) return null;
  return {
    wallId,
    movingNodeId,
    pivotNodeId,
    pivot: { x: pivot.x, y: pivot.y },
    referenceAngleDeg: ref.referenceAngleDeg,
    hostPair: ref.hostPair,
    kind: ref.kind,
  };
}

/**
 * Draft / draw from an existing topology node.
 */
export function resolveDraftMagnetContext(plan, startPoint, startNodeId = null) {
  let pivotNodeId = startNodeId;
  if (!pivotNodeId && isFinitePt(startPoint) && plan?.nodes) {
    let best = null;
    let bestD = 12;
    for (const [id, p] of Object.entries(plan.nodes)) {
      if (!isFinitePt(p)) continue;
      const d = Math.hypot(p.x - startPoint.x, p.y - startPoint.y);
      if (d <= bestD) {
        bestD = d;
        best = id;
      }
    }
    pivotNodeId = best;
  }
  if (!pivotNodeId) return null;
  const pivot = plan.nodes?.[pivotNodeId];
  if (!isFinitePt(pivot)) return null;
  if (collectIncidentRays(plan, pivotNodeId).length < 1) return null;
  const ref = resolveMagnetReference(plan, pivotNodeId, null);
  if (!ref) return null;
  return {
    wallId: null,
    movingNodeId: null,
    pivotNodeId,
    pivot: { x: pivot.x, y: pivot.y },
    referenceAngleDeg: ref.referenceAngleDeg,
    hostPair: ref.hostPair,
    kind: ref.kind,
  };
}

/**
 * Compact branch↔host sectors for the active pivot during movement.
 * Never includes host-host ~180° continuation.
 */
export function buildMovementAngleSectors(plan, pivotNodeId, movingWallId = null) {
  if (!plan || !pivotNodeId) return [];
  // Prefer selected-wall builder when we know the moving wall — same T semantics.
  if (movingWallId) {
    const angs = buildSelectedWallCornerAngles(plan, movingWallId, { maxAngles: 4 })
      .filter((a) => a.nodeId === pivotNodeId)
      .filter((a) => a.sweepDeg < CONTINUATION_SUPPRESS_DEG)
      .filter((a) => a.displayDeg !== 180);
    if (angs.length) return angs.map((a) => ({ ...a, mode: "movement" }));
  }
  return [];
}

/**
 * Draft preview angles: host ↔ moving ray complementary pair (sum 180 on T).
 */
export function buildDraftMovementAngles(plan, pivotNodeId, endPoint) {
  if (!plan || !pivotNodeId || !isFinitePt(endPoint)) return [];
  const pivot = plan.nodes?.[pivotNodeId];
  if (!isFinitePt(pivot)) return [];
  const dx = endPoint.x - pivot.x;
  const dy = endPoint.y - pivot.y;
  const len = Math.hypot(dx, dy);
  if (len < MIN_ARM_MM) return [];
  const draftRay = {
    wallId: "__draft__",
    nodeId: pivotNodeId,
    otherNodeId: "__draft_end__",
    angleDeg: normalizeDeg((Math.atan2(dy, dx) * 180) / Math.PI),
    ux: dx / len,
    uy: dy / len,
    len,
    thk: 100,
  };
  const ref = resolveMagnetReference(plan, pivotNodeId, null);
  if (!ref?.hostPair) {
    // Open companion: single intended non-reflex sector vs strongest host ray.
    const host = (ref?.rays || []).find((r) => r.wallId !== draftRay.wallId) || ref?.rays?.[0];
    if (!host) return [];
    let a = host.angleDeg;
    let b = draftRay.angleDeg;
    let sweepCcw = normalizeDeg(b - a);
    if (sweepCcw > 180) {
      a = draftRay.angleDeg;
      sweepCcw = normalizeDeg(host.angleDeg - a);
    }
    const displayDeg = displayCornerAngleDeg(sweepCcw);
    return [{
      id: `mov:${pivotNodeId}:draft`,
      kind: "corner_angle",
      mode: "movement",
      role: "corner",
      nodeId: pivotNodeId,
      vertex: { x: pivot.x, y: pivot.y },
      wallIds: [host.wallId, "__draft__"],
      startDeg: a,
      endDeg: normalizeDeg(a + sweepCcw),
      sweepDeg: sweepCcw,
      deg: sweepCcw,
      displayDeg,
      text: formatCornerAngleDisplay(sweepCcw),
      thk: host.thk || 100,
      sectorKey: `${host.wallId}|draft:${displayDeg}`,
    }];
  }
  const [h1, h2] = ref.hostPair;
  const hostAngle = h1.angleDeg;
  const branch = draftRay.angleDeg;
  const hostOpp = normalizeDeg(hostAngle + 180);
  const mk = (startDeg, sweepDeg, key) => {
    const displayDeg = displayCornerAngleDeg(sweepDeg);
    return {
      id: `mov:${pivotNodeId}:${key}`,
      kind: "corner_angle",
      mode: "movement",
      role: "t_branch",
      nodeId: pivotNodeId,
      vertex: { x: pivot.x, y: pivot.y },
      wallIds: [h1.wallId, h2.wallId, "__draft__"],
      startDeg,
      endDeg: normalizeDeg(startDeg + sweepDeg),
      sweepDeg,
      deg: sweepDeg,
      displayDeg,
      text: formatCornerAngleDisplay(sweepDeg),
      thk: h1.thk || 100,
      sectorKey: `draft|${key}:${displayDeg}`,
    };
  };
  const rays = [
    { angleDeg: normalizeDeg(hostAngle), id: "h1" },
    { angleDeg: hostOpp, id: "h2" },
    { angleDeg: normalizeDeg(branch), id: "br" },
  ].sort((a, b) => a.angleDeg - b.angleDeg);
  const out = [];
  for (let i = 0; i < rays.length; i++) {
    const a = rays[i];
    const b = rays[(i + 1) % rays.length];
    const sweep = normalizeDeg(b.angleDeg - a.angleDeg);
    if (sweep >= CONTINUATION_SUPPRESS_DEG) continue;
    if ((a.id === "h1" && b.id === "h2") || (a.id === "h2" && b.id === "h1")) continue;
    if (!(a.id === "br" || b.id === "br")) continue;
    out.push(mk(a.angleDeg, sweep, `${a.id}-${b.id}`));
  }
  return out
    .filter((a) => a.sweepDeg < CONTINUATION_SUPPRESS_DEG && a.displayDeg !== 180)
    .slice(0, 2);
}

/**
 * Apply typed length along the current (possibly snapped) direction.
 */
export function pointAtMagnetLength(pivot, directionPointOrAngle, lengthMm) {
  if (!isFinitePt(pivot) || !(lengthMm > 0)) return null;
  let angleDeg;
  if (Number.isFinite(directionPointOrAngle)) {
    angleDeg = normalizeDeg(directionPointOrAngle);
  } else if (isFinitePt(directionPointOrAngle)) {
    angleDeg = normalizeDeg(
      (Math.atan2(
        directionPointOrAngle.y - pivot.y,
        directionPointOrAngle.x - pivot.x,
      ) * 180) / Math.PI,
    );
  } else {
    return null;
  }
  return projectPointToAngle(pivot, angleDeg, lengthMm);
}

export function emptyAngleMagnetPreview() {
  return {
    active: false,
    snapped: false,
    pivot: null,
    pivotNodeId: null,
    guides: [],
    angles: [],
    angleDeg: null,
    previousSnapAngleDeg: null,
  };
}

/**
 * Build the MODE A preview payload for overlay + lifecycle cleanup.
 */
export function buildAngleMagnetPreview({
  context,
  magnet,
  plan,
  movingWallId = null,
} = {}) {
  if (!context?.pivot || !magnet) return emptyAngleMagnetPreview();
  const angles = plan && context.pivotNodeId
    ? buildMovementAngleSectors(plan, context.pivotNodeId, movingWallId || context.wallId)
    : [];
  return {
    active: true,
    snapped: !!magnet.snapped,
    pivot: { ...context.pivot },
    pivotNodeId: context.pivotNodeId,
    guides: magnet.guides || [],
    angles,
    angleDeg: magnet.angleDeg,
    previousSnapAngleDeg: magnet.previousSnapAngleDeg,
    activeCandidate: magnet.activeCandidate || null,
  };
}
