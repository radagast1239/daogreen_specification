/**
 * Shared polygon assertions for the wall-geometry tests (PHASE 2E).
 *
 * TEST HELPER ONLY. Nothing here is imported by src/. In particular nothing
 * here repairs or mutates a polygon: a quad that comes out of
 * buildWallGeometry malformed must FAIL a test, never be quietly fixed.
 *
 * Used by plannerWallEndCaps, plannerWallCornerJoins and
 * plannerWallTJunctionJoins so all three judge "is this polygon valid" by
 * exactly the same rules.
 */
import { expect } from "vitest";

export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
export const P = (x, y) => ({ x, y });

/** Shoelace, signed: > 0 and < 0 are the two winding directions. */
export function signedArea(pts) {
  return pts.reduce((s, a, i) => {
    const b = pts[(i + 1) % pts.length];
    return s + a.x * b.y - b.x * a.y;
  }, 0) / 2;
}
export const polygonArea = (pts) => Math.abs(signedArea(pts));

/** True only for PROPER crossings — touching endpoints are not a crossing. */
export function hasSelfIntersection(pts) {
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const proper = (p1, p2, p3, p4) => {
    const d1 = cross(p3, p4, p1); const d2 = cross(p3, p4, p2);
    const d3 = cross(p1, p2, p3); const d4 = cross(p1, p2, p4);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 2; j < pts.length; j++) {
      if (i === 0 && j === pts.length - 1) continue;
      if (proper(pts[i], pts[(i + 1) % pts.length], pts[j], pts[(j + 1) % pts.length])) return true;
    }
  }
  return false;
}

export const uniquePointCount = (pts, digits = 3) =>
  new Set(pts.map((p) => `${p.x.toFixed(digits)},${p.y.toFixed(digits)}`)).size;

/** Index of the first vertex that repeats the one before it, or -1. */
export function duplicateConsecutiveIndex(pts, eps = 1e-6) {
  for (let i = 0; i < pts.length; i++) {
    if (dist(pts[i], pts[(i + 1) % pts.length]) <= eps) return i;
  }
  return -1;
}

export const allFinite = (pts) => pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

// --- canonical fingerprints -------------------------------------------------

export const polygonFingerprint = (quad, digits = 3) =>
  quad.map((q) => `${q.x.toFixed(digits)},${q.y.toFixed(digits)}`).join("|");

/**
 * Order-independent fingerprint of a whole geometry result. Sorted by key, so
 * two runs that differ only in wall array order produce the same string.
 */
export const geometryFingerprint = (polygons, digits = 3) => polygons
  .map((p) => `${p.key}:${polygonFingerprint(p.quad, digits)}`)
  .sort()
  .join("\n");

/** Rounded, order-independent set of a quad's corners — compares SHAPE only. */
export const pointSet = (quad, digits = 1) =>
  quad.map((q) => `${q.x.toFixed(digits)},${q.y.toFixed(digits)}`).sort().join(" ");

/**
 * Like geometryFingerprint but order-insensitive WITHIN each quad. A quad's
 * vertex order encodes which face buildWallGeometry called "outer", and that
 * label is assigned relative to the room centre — so two congruent plans in
 * different places in the room emit the same shapes in a different rotation.
 * Use this when comparing SHAPES across placements; use geometryFingerprint
 * when the two runs should be byte-identical (array order, reruns, undo/redo).
 */
export const shapeFingerprint = (polygons, digits = 1) => polygons
  .map((p) => `${p.key}:${pointSet(p.quad, digits)}`)
  .sort()
  .join("\n");

// --- measurements -----------------------------------------------------------

/**
 * Width of one end of a quad measured PERPENDICULAR to that wall's own
 * centerline a->b. This is the number a user sees as "how thick is this wall
 * here"; the raw distance between the two cap points is longer whenever the
 * cap is mitred (an oblique branch cuts across the band at an angle).
 */
export function perpWidth(quad, a, b, atStart) {
  const [oa, ob, ib, ia] = quad;
  const L = dist(a, b) || 1;
  const n = { x: -(b.y - a.y) / L, y: (b.x - a.x) / L };
  const o = atStart ? a : b;
  const p1 = atStart ? oa : ob;
  const p2 = atStart ? ia : ib;
  const proj = (p) => Math.abs((p.x - o.x) * n.x + (p.y - o.y) * n.y);
  return proj(p1) + proj(p2);
}

/** Straight-line distance between the two face points at one end of a quad. */
export const capSpan = (quad, atStart) =>
  (atStart ? dist(quad[0], quad[3]) : dist(quad[1], quad[2]));

/** Unit vector of the cap at one end, plus the wall's own unit direction. */
export function capVsCenterline(quad, a, b, atStart) {
  const cap = atStart
    ? { x: quad[3].x - quad[0].x, y: quad[3].y - quad[0].y }
    : { x: quad[2].x - quad[1].x, y: quad[2].y - quad[1].y };
  const cl = Math.hypot(cap.x, cap.y) || 1;
  const L = dist(a, b) || 1;
  const dir = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  return (cap.x / cl) * dir.x + (cap.y / cl) * dir.y; // 0 == perpendicular
}

export const maxReach = (quad, node) => Math.max(...quad.map((q) => dist(node, q)));

/** Even-odd point-in-polygon, for coverage/tiling checks. */
export function pointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]; const b = poly[j];
    if ((a.y > pt.y) !== (b.y > pt.y)
      && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Coverage of the disc of `radius` centred on a node — the check that works at
 * ANY corner angle. Every face line of every arm sits exactly half a thickness
 * from the centerline, and every centerline passes through the node, so the
 * disc of radius min(thk)/2 is inside the wall mass no matter how acute or
 * obtuse the corner is. A corner mitred across the wrong diagonal loses roughly
 * half of it (the clipped bite) and doubles the rest (the double hatch).
 */
export function nodeDiscCoverage(polygons, node, radius, steps = 72, rings = 24) {
  let once = 0; let doubled = 0; let uncovered = 0;
  // start at ring 1: the node itself lies ON the miter seam between the two
  // quads, where an even-odd test is undefined either way
  for (let r = 1; r <= rings; r++) {
    const rad = (radius * r) / rings;
    for (let i = 0; i < steps; i++) {
      const t = (2 * Math.PI * i) / steps;
      const pt = P(node.x + rad * Math.cos(t), node.y + rad * Math.sin(t));
      const n = polygons.filter((q) => pointInPolygon(pt, q.quad)).length;
      if (n === 0) uncovered++; else if (n > 1) doubled++; else once++;
    }
  }
  return { once, doubled, uncovered, total: once + doubled + uncovered };
}

/**
 * Samples the `size` x `size` square centred on a corner node. Exact only for
 * a RIGHT-ANGLE corner of equal-thickness walls: there the two bands tile the
 * square along the miter diagonal, so uncovered === 0 and doubled === 0 (bar a
 * few samples that land exactly on the shared diagonal). At other angles parts
 * of the square legitimately fall outside the mass — use nodeDiscCoverage.
 */
export function cornerSquareCoverage(polygons, node, size = 100, steps = 60) {
  const h = size / 2 - 0.5;
  let once = 0; let doubled = 0; let uncovered = 0;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const pt = P(node.x - h + (2 * h * i) / steps, node.y - h + (2 * h * j) / steps);
      const n = polygons.filter((q) => pointInPolygon(pt, q.quad)).length;
      if (n === 0) uncovered++; else if (n > 1) doubled++; else once++;
    }
  }
  return { once, doubled, uncovered, total: (steps + 1) ** 2 };
}

// --- assertions -------------------------------------------------------------

/**
 * Every rule a shipped wall quad must satisfy. `label` is echoed into the
 * failure message so a loop over many fixtures still says which one broke.
 */
export function assertValidPolygon(quad, label = "polygon", { minArea = 1 } = {}) {
  const where = `${label}: ${JSON.stringify(quad.map((q) => [+q.x?.toFixed?.(1), +q.y?.toFixed?.(1)]))}`;
  expect(Array.isArray(quad), where).toBe(true);
  expect(allFinite(quad), `${where} — non-finite coordinate`).toBe(true);
  expect(uniquePointCount(quad), `${where} — fewer than 3 distinct points`).toBeGreaterThanOrEqual(3);
  expect(duplicateConsecutiveIndex(quad), `${where} — duplicate consecutive vertex`).toBe(-1);
  expect(polygonArea(quad), `${where} — degenerate area`).toBeGreaterThan(minArea);
  expect(hasSelfIntersection(quad), `${where} — self-intersecting`).toBe(false);
}

export function assertValidGeometry(polygons, label = "geometry", opts) {
  expect(polygons.length, `${label} — no polygons produced`).toBeGreaterThan(0);
  for (const p of polygons) assertValidPolygon(p.quad, `${label} ${p.key}`, opts);
}

/**
 * Winding is NOT globally uniform across a plan and must not be asserted as
 * such: buildWallGeometry labels a wall's two faces "outer"/"inner" relative
 * to the ROOM CENTRE (wallSegmentOffsetSide), so two walls on opposite sides
 * of the centre legitimately emit their quads in opposite rotational order.
 * What must hold is that ONE wall never flips mid-run: every segment of a
 * multi-segment wall keeps the same winding, so its band cannot turn itself
 * inside out between segments.
 */
export function assertConsistentWinding(polygons, label = "geometry") {
  const byWall = new Map();
  for (const p of polygons) {
    const s = Math.sign(signedArea(p.quad));
    expect(s, `${label} ${p.key} — zero-area quad has no winding`).not.toBe(0);
    if (!byWall.has(p.wallId)) byWall.set(p.wallId, []);
    byWall.get(p.wallId).push({ key: p.key, s });
  }
  for (const [wallId, segs] of byWall) {
    const signs = [...new Set(segs.map((x) => x.s))];
    expect(signs.length, `${label} wall ${wallId} flips winding mid-wall: ${JSON.stringify(segs)}`).toBe(1);
  }
}

/**
 * No join point may run away from its node — the miter limit must bite.
 * Pass the join's OWN two points (quad[0]/quad[3] at the start of a quad,
 * quad[1]/quad[2] at its end), never the whole quad: the far end of a long
 * wall is legitimately thousands of mm from this node.
 */
export function assertNoSpike(joinPoints, node, limit, label = "join") {
  for (const p of joinPoints) {
    expect(dist(node, p), `${label} — join point ${p.x?.toFixed(1)},${p.y?.toFixed(1)} spikes past the miter limit`)
      .toBeLessThanOrEqual(limit);
  }
}

/** The two corner points a quad contributes at its start (true) or end. */
export const joinPointsAt = (quad, atStart) => (atStart ? [quad[0], quad[3]] : [quad[1], quad[2]]);
