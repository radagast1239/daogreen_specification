/**
 * Pure geometry helpers for live wall drawing (snap / preview).
 * Intentionally avoids wallNetwork / wallCommands / walls/index barrels
 * to prevent circular imports via wallGeometry.js re-exports.
 */
import { dist, near } from "../geometry/point.js";
import {
  projectOnSegment,
  segmentsIntersectProper,
  segmentIntersectionPoint,
} from "../geometry/segment.js";

export const WALL_BODY_ENDPOINT_EPS_MM = 15;
export const WALL_DRAW_MIN_ALONG_MM = 1;
export const WALL_BODY_LINK_THR_MM = 85;

function excludeSet(ids) {
  if (!ids) return new Set();
  return ids instanceof Set ? ids : new Set(ids);
}

function isFinitePoint(p) {
  return p != null && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function wallSegments(walls) {
  const segs = [];
  (walls || []).forEach((w) => {
    const pts = w.pts;
    if (!pts || pts.length < 2) return;
    for (let i = 1; i < pts.length; i++) {
      segs.push({ a: pts[i - 1], b: pts[i], wallId: w.id, thk: w.thk });
    }
  });
  return segs;
}

/**
 * Nearest point on a wall centerline segment (interior or endpoint).
 * thrMm is world mm (caller converts from screen px / zoom).
 */
export function nearestPointOnWallSegment(pt, walls, thrMm = Infinity, {
  excludeWallIds = null,
  preferEndpoints = true,
  endpointEpsMm = WALL_BODY_ENDPOINT_EPS_MM,
} = {}) {
  if (!isFinitePoint(pt)) return null;
  const exclude = excludeSet(excludeWallIds);
  let best = null;
  for (const s of wallSegments(walls)) {
    if (exclude.has(s.wallId)) continue;
    const proj = projectOnSegment(pt, s.a, s.b);
    const d = dist(pt, proj);
    if (d > thrMm) continue;
    const atA = near(proj, s.a, endpointEpsMm);
    const atB = near(proj, s.b, endpointEpsMm);
    const kind = atA || atB ? "endpoint" : "interior";
    const point = atA ? { ...s.a } : atB ? { ...s.b } : { ...proj };
    const score = preferEndpoints && kind === "endpoint" ? d - 0.01 : d;
    if (
      !best
      || score < best.score - 1e-9
      || (Math.abs(score - best.score) <= 1e-9 && String(s.wallId) < String(best.wallId))
    ) {
      best = {
        point,
        wallId: s.wallId,
        distance: d,
        score,
        kind,
        a: s.a,
        b: s.b,
      };
    }
  }
  return best;
}

/**
 * First proper centerline intersection along start→end by distance from start.
 * Deterministic: min along, then wallId tie-break (not array order).
 */
export function findFirstWallIntersectionAlongSegment(start, end, walls, {
  excludeWallIds = null,
  endpointEpsMm = WALL_BODY_ENDPOINT_EPS_MM,
  minAlongMm = WALL_DRAW_MIN_ALONG_MM,
} = {}) {
  if (!isFinitePoint(start) || !isFinitePoint(end)) return null;
  const totalLen = dist(start, end);
  if (totalLen < minAlongMm) return null;
  const exclude = excludeSet(excludeWallIds);

  const hits = [];
  for (const s of wallSegments(walls)) {
    if (exclude.has(s.wallId)) continue;
    const startProj = projectOnSegment(start, s.a, s.b);
    if (dist(start, startProj) <= endpointEpsMm) continue;

    if (!segmentsIntersectProper(start, end, s.a, s.b)) continue;
    const ip = segmentIntersectionPoint(start, end, s.a, s.b);
    if (!ip) continue;
    const along = dist(start, ip);
    if (along < minAlongMm) continue;
    if (along > totalLen + 1e-6) continue;
    hits.push({
      point: { x: ip.x, y: ip.y },
      wallId: s.wallId,
      along,
      totalLen,
    });
  }

  if (!hits.length) return null;
  hits.sort((a, b) => {
    if (Math.abs(a.along - b.along) > 1e-6) return a.along - b.along;
    return String(a.wallId).localeCompare(String(b.wallId));
  });
  const first = hits[0];
  return {
    ...first,
    ignored: hits.slice(1),
  };
}

/**
 * Clip draft end to the first intersected wall, or snap onto a wall body.
 */
export function clipWallDraftEnd(start, end, walls, {
  excludeWallIds = null,
  bodyThrMm = WALL_BODY_LINK_THR_MM,
  endpointEpsMm = WALL_BODY_ENDPOINT_EPS_MM,
} = {}) {
  if (!isFinitePoint(start) || !isFinitePoint(end)) {
    return { point: end, clipped: false, hit: null };
  }

  const startHost = nearestPointOnWallSegment(start, walls, endpointEpsMm, {
    excludeWallIds,
    preferEndpoints: true,
    endpointEpsMm,
  });
  const exclude = excludeSet(excludeWallIds);
  if (startHost) exclude.add(startHost.wallId);

  const crossing = findFirstWallIntersectionAlongSegment(start, end, walls, {
    excludeWallIds: exclude,
    endpointEpsMm,
  });
  if (crossing) {
    return {
      point: { ...crossing.point },
      clipped: true,
      hit: {
        kind: "intersection",
        wallId: crossing.wallId,
        along: crossing.along,
        ignored: crossing.ignored,
      },
    };
  }

  const body = nearestPointOnWallSegment(end, walls, bodyThrMm, {
    excludeWallIds: exclude,
    preferEndpoints: true,
    endpointEpsMm,
  });
  if (body && body.kind === "interior") {
    return {
      point: { ...body.point },
      clipped: true,
      hit: { kind: "body", wallId: body.wallId, along: dist(start, body.point), ignored: [] },
    };
  }
  if (body && body.kind === "endpoint") {
    return {
      point: { ...body.point },
      clipped: true,
      hit: { kind: "endpoint", wallId: body.wallId, along: dist(start, body.point), ignored: [] },
    };
  }

  return { point: { ...end }, clipped: false, hit: null };
}
