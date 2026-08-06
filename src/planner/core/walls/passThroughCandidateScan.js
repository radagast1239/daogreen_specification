/**
 * PHASE 2F1 — detect walls whose persisted endpoint lies beyond the first
 * canonical terminating host along their drawing ray.
 *
 * Pure scan over plan geometry. Does not mutate the plan.
 */
import {
  resolveWallDraftEnd,
  findFirstWallIntersectionAlongSegment,
  nearestPointOnWallSegment,
} from "./wallDrawTopology.js";
import { resolvePlanWalls } from "../../wallNetwork.js";

const EPS = 2;
const OVERSHOOT_MM = 8000;

function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function nearNode(plan, point, tol = EPS) {
  for (const [id, n] of Object.entries(plan.nodes || {})) {
    if (Math.hypot(n.x - point.x, n.y - point.y) <= tol) return id;
  }
  return null;
}

function deg(plan, nid) {
  return (plan.walls || []).filter((w) => w.a === nid || w.b === nid).length;
}

function extendRay(a, b, extraMm = OVERSHOOT_MM) {
  const len = dist(a, b) || 1;
  return {
    x: b.x + ((b.x - a.x) / len) * extraMm,
    y: b.y + ((b.y - a.y) / len) * extraMm,
  };
}

function startHostIds(start, walls, thrMm = 15) {
  const exclude = new Set();
  for (const w of walls) {
    const hit = nearestPointOnWallSegment(start, [w], thrMm, { preferEndpoints: true });
    if (hit) exclude.add(w.id);
  }
  return exclude;
}

function roomHint(plan, point) {
  const zones = plan.zones || plan.rooms || [];
  for (const z of zones) {
    const poly = z.polygon || z.pts || [];
    if (poly.length < 3) continue;
    const xs = poly.map((p) => p.x);
    const ys = poly.map((p) => p.y);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const y0 = Math.min(...ys);
    const y1 = Math.max(...ys);
    if (point.x >= x0 && point.x <= x1 && point.y >= y0 && point.y <= y1) {
      return { id: z.id, name: z.name || z.label || null, bbox: { x0, y0, x1, y1 } };
    }
  }
  return null;
}

/**
 * Scan one direction start→persistedEnd using an overshot ray so a wall that
 * already ends on a host is not confused with a wall that continues past it.
 */
function scanDirection(plan, walls, wall, start, persistedEnd, dirLabel) {
  const reasons = [];
  const far = extendRay(start, persistedEnd, OVERSHOOT_MM);
  const exclude = startHostIds(start, walls.filter((w) => w.id !== wall.id));
  const others = walls.filter((w) => w.id !== wall.id);

  const hits = [];
  // Collect ordered intersections along the overshot ray by successive search.
  let cursorStart = start;
  const used = new Set(exclude);
  for (let i = 0; i < 8; i++) {
    const hit = findFirstWallIntersectionAlongSegment(cursorStart, far, others, {
      excludeWallIds: used,
    });
    if (!hit) break;
    const nodeId = nearNode(plan, hit.point, EPS);
    hits.push({
      order: hits.length + 1,
      point: { ...hit.point },
      hostWallId: hit.wallId,
      along: dist(start, hit.point),
      sharedNodeId: nodeId,
      missingNode: !nodeId,
    });
    used.add(hit.wallId);
    // Nudge past the hit so the next search can continue.
    const len = dist(start, far) || 1;
    const ux = (far.x - start.x) / len;
    const uy = (far.y - start.y) / len;
    cursorStart = { x: hit.point.x + ux * 1, y: hit.point.y + uy * 1 };
  }

  const persistedLen = dist(start, persistedEnd);
  // Intersections that lie on the persisted segment (not past a free tip).
  const onSegmentHits = hits.filter((h) => h.along <= persistedLen + EPS);
  const firstOnSegment = onSegmentHits[0] || null;
  // First host along the overshot ray (may be past a short free tip).
  const firstAlongRay = hits[0] || null;

  const decision = resolveWallDraftEnd(plan, {
    walls,
    start,
    end: far,
    endIntentProvided: true,
    endIntent: {
      kind: "none",
      point: { ...far },
      nodeId: null,
      wallId: null,
      hostWallId: null,
      connects: false,
    },
  });

  const canonicalEnd = decision.point;
  // Positive beyond = persisted end is farther from start than the clip.
  const alongCanonical = canonicalEnd ? dist(start, canonicalEnd) : null;
  const beyondFirstMm = alongCanonical != null ? persistedLen - alongCanonical : 0;

  // A: unnoded crossing only if the crossing is ON the persisted segment.
  if (firstOnSegment && firstOnSegment.missingNode) {
    reasons.push("A_UNNESTED_INTERIOR_CROSSING");
  }
  if (firstOnSegment && beyondFirstMm > EPS && dist(persistedEnd, firstOnSegment.point) > EPS) {
    reasons.push("E_FIRST_INTERSECTION_BEFORE_ENDPOINT");
  }
  if (decision.clipped && beyondFirstMm > EPS) {
    reasons.push("F_PERSISTED_BEYOND_CANONICAL_CLIP");
  }
  if (firstOnSegment && !firstOnSegment.missingNode && beyondFirstMm > EPS) {
    reasons.push("C_BRANCH_EXTENDS_PAST_T_INTERSECTION");
  }
  // Endpoint lies on a host body but segment continues past that host.
  const endBody = nearestPointOnWallSegment(
    persistedEnd,
    others,
    EPS,
    { preferEndpoints: false },
  );
  if (endBody && endBody.kind === "interior" && firstOnSegment && beyondFirstMm > EPS) {
    reasons.push("B_ENDPOINT_ON_HOST_BUT_CONTINUES");
  }

  // Additional hosts crossed by the persisted segment after the first clip.
  const extraHosts = onSegmentHits.filter(
    (h) => h.order > 1 && h.along > (firstOnSegment?.along ?? 0) + EPS,
  );
  if (extraHosts.length && beyondFirstMm > EPS) {
    reasons.push(`D_ADDITIONAL_INTERSECTED_HOSTS_${extraHosts.length}`);
  }

  // Free tip short of a farther host is valid — not a candidate.
  if (!reasons.length) return null;
  // Prefer reporting on-segment hits; fall back to ray hits for diagnostics.
  const reportHits = onSegmentHits.length ? onSegmentHits : (firstAlongRay ? [firstAlongRay] : []);

  return {
    wallId: wall.id,
    role: wall.role || null,
    chainId: wall.chainId || null,
    nodeA: wall.a,
    nodeB: wall.b,
    dir: dirLabel,
    endpoints: { a: { ...start }, b: { ...persistedEnd } },
    lengthMm: Math.round(persistedLen),
    reasons: [...new Set(reasons)],
    intersections: reportHits,
    firstCanonicalClip: canonicalEnd ? { ...canonicalEnd } : null,
    canonicalReason: decision.reason || (decision.clipped ? "CLIPPED" : "NONE"),
    persistedEndpoint: { ...persistedEnd },
    distanceBeyondFirstClipMm: Math.round(Math.max(0, beyondFirstMm) * 10) / 10,
    roomHint: roomHint(plan, {
      x: (start.x + persistedEnd.x) / 2,
      y: (start.y + persistedEnd.y) / 2,
    }),
    degA: deg(plan, wall.a),
    degB: deg(plan, wall.b),
  };
}

/**
 * @returns {{ candidates: object[], primary: object|null }}
 */
export function scanPassThroughCandidates(plan) {
  const walls = resolvePlanWalls(plan);
  const candidates = [];

  for (const wall of walls) {
    const a = wall.pts?.[0];
    const b = wall.pts?.[wall.pts.length - 1];
    if (!a || !b) continue;

    const ab = scanDirection(plan, walls, wall, a, b, "A→B");
    const ba = scanDirection(plan, walls, wall, b, a, "B→A");
    // Keep the worse direction for this wall.
    const picked = [ab, ba]
      .filter(Boolean)
      .sort((x, y) => (y.distanceBeyondFirstClipMm || 0) - (x.distanceBeyondFirstClipMm || 0))[0];
    if (picked) candidates.push(picked);
  }

  candidates.sort((x, y) => {
    const score = (c) => {
      let s = c.distanceBeyondFirstClipMm || 0;
      if (c.role === "partition") s += 10000;
      if (c.reasons.some((r) => r.startsWith("F_"))) s += 5000;
      if (c.reasons.some((r) => r.startsWith("E_"))) s += 3000;
      if (c.reasons.some((r) => r.startsWith("A_"))) s += 2000;
      return s;
    };
    return score(y) - score(x);
  });

  return { candidates, primary: candidates[0] || null };
}

export function formatPassThroughScanReport({ projectId, revision, plan, scan }) {
  const lines = [];
  lines.push("PHASE 2F1 — PASS-THROUGH CANDIDATE SCAN");
  lines.push(`Project: ${projectId}`);
  lines.push(`Revision: ${revision}`);
  lines.push(`Walls: ${(plan.walls || []).length}`);
  lines.push(`Candidates: ${scan.candidates.length}`);
  lines.push("");
  if (!scan.candidates.length) {
    lines.push("NO TRUE CANDIDATES — no wall extends beyond first canonical host intersection.");
    lines.push("(Weak false-positives such as dual half-hosts at the same T node are ignored.)");
  }
  scan.candidates.forEach((c, i) => {
    lines.push(`---- CANDIDATE #${i + 1} ----`);
    lines.push(`wallId: ${c.wallId}`);
    lines.push(`role: ${c.role}`);
    lines.push(`chainId: ${c.chainId}`);
    lines.push(`dir: ${c.dir}`);
    lines.push(`endpoints: (${c.endpoints.a.x},${c.endpoints.a.y}) → (${c.endpoints.b.x},${c.endpoints.b.y})`);
    lines.push(`lengthMm: ${c.lengthMm}`);
    lines.push(`degrees: ${c.degA}/${c.degB}`);
    lines.push(`reasons: ${c.reasons.join(", ")}`);
    lines.push(`firstCanonicalClip: ${JSON.stringify(c.firstCanonicalClip)}`);
    lines.push(`canonicalReason: ${c.canonicalReason}`);
    lines.push(`persistedEndpoint: ${JSON.stringify(c.persistedEndpoint)}`);
    lines.push(`distanceBeyondFirstClipMm: ${c.distanceBeyondFirstClipMm}`);
    lines.push(`roomHint: ${JSON.stringify(c.roomHint)}`);
    lines.push("intersections:");
    for (const hit of c.intersections) {
      lines.push(
        `  #${hit.order} @ (${hit.point.x},${hit.point.y}) host=${hit.hostWallId} node=${hit.sharedNodeId || "MISSING"} along=${Math.round(hit.along)}`,
      );
    }
    lines.push("");
  });
  lines.push("PRIMARY (auto-selected):");
  lines.push(scan.primary ? `${scan.primary.wallId} — ${scan.primary.reasons.join("|")}` : "none");
  return lines.join("\n");
}
