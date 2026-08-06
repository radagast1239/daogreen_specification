/**
 * Host-wall split immutability helpers.
 * union(splitHostA, splitHostB) == originalHostSegment (epsilon).
 */
import { dist, near } from "../geometry/point.js";

const DEFAULT_EPS = 0.75;

function segLen(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function direction(a, b) {
  const len = segLen(a, b) || 1;
  return { ux: (b.x - a.x) / len, uy: (b.y - a.y) / len, len };
}

function projectT(p, a, b) {
  const { ux, uy, len } = direction(a, b);
  if (len < 1e-9) return 0;
  return ((p.x - a.x) * ux + (p.y - a.y) * uy) / len;
}

function pointOnSegment(p, a, b, eps) {
  const t = projectT(p, a, b);
  if (t < -eps / (segLen(a, b) || 1) || t > 1 + eps / (segLen(a, b) || 1)) return false;
  const { ux, uy, len } = direction(a, b);
  const closest = { x: a.x + ux * t * len, y: a.y + uy * t * len };
  return dist(p, closest) <= eps;
}

/**
 * @param {{a:{x,y}, b:{x,y}, thk?:number, meta?:object}} original
 * @param {{a:{x,y}, b:{x,y}, thk?:number}} partA
 * @param {{a:{x,y}, b:{x,y}, thk?:number}} partB
 * @param {{eps?:number}} [opts]
 */
export function assertHostSplitPreservesSegment(original, partA, partB, opts = {}) {
  const eps = opts.eps ?? DEFAULT_EPS;
  const issues = [];
  if (!original?.a || !original?.b || !partA?.a || !partA?.b || !partB?.a || !partB?.b) {
    return { ok: false, issues: ["missing-geometry"], meta: null };
  }

  const oLen = segLen(original.a, original.b);
  const aLen = segLen(partA.a, partA.b);
  const bLen = segLen(partB.a, partB.b);
  if (Math.abs((aLen + bLen) - oLen) > eps * 2) {
    issues.push("length-mismatch");
  }

  const oDir = direction(original.a, original.b);
  const aDir = direction(partA.a, partA.b);
  const bDir = direction(partB.a, partB.b);
  const dotA = aDir.ux * oDir.ux + aDir.uy * oDir.uy;
  const dotB = bDir.ux * oDir.ux + bDir.uy * oDir.uy;
  if (Math.abs(Math.abs(dotA) - 1) > 1e-3 || Math.abs(Math.abs(dotB) - 1) > 1e-3) {
    issues.push("direction-mismatch");
  }

  // Endpoints of parts must lie on original segment.
  for (const p of [partA.a, partA.b, partB.a, partB.b]) {
    if (!pointOnSegment(p, original.a, original.b, eps)) {
      issues.push("endpoint-off-original");
      break;
    }
  }

  // Union coverage: original endpoints must appear among part endpoints.
  const ends = [partA.a, partA.b, partB.a, partB.b];
  const hasOrigA = ends.some((p) => near(p, original.a, eps));
  const hasOrigB = ends.some((p) => near(p, original.b, eps));
  if (!hasOrigA || !hasOrigB) issues.push("original-endpoints-lost");

  // Shared split point: exactly one shared endpoint between parts (within eps).
  const shared = [];
  for (const pa of [partA.a, partA.b]) {
    for (const pb of [partB.a, partB.b]) {
      if (near(pa, pb, eps)) shared.push(pa);
    }
  }
  if (!shared.length) issues.push("missing-shared-split-point");
  else if (!pointOnSegment(shared[0], original.a, original.b, eps)) {
    issues.push("split-point-off-original");
  }

  if (original.thk != null) {
    if (partA.thk != null && Math.abs(partA.thk - original.thk) > 1e-6) issues.push("thickness-drift-a");
    if (partB.thk != null && Math.abs(partB.thk - original.thk) > 1e-6) issues.push("thickness-drift-b");
  }

  return {
    ok: issues.length === 0,
    issues,
    meta: {
      originalLength: oLen,
      partsLengthSum: aLen + bLen,
      splitPoint: shared[0] || null,
    },
  };
}

/**
 * Compare host wall coordinates before/after — no transverse/along drift of
 * surviving endpoints except the intentional split node insertion.
 */
export function hostEndpointsUnchangedExceptSplit(beforePts, afterParts, eps = DEFAULT_EPS) {
  if (!beforePts || beforePts.length < 2 || !afterParts?.length) {
    return { ok: false, issues: ["missing-input"] };
  }
  const a0 = beforePts[0];
  const b0 = beforePts[beforePts.length - 1];
  const ends = afterParts.flatMap((w) => {
    const pts = w.pts || [];
    if (pts.length < 2) return [];
    return [pts[0], pts[pts.length - 1]];
  });
  const hasA = ends.some((p) => near(p, a0, eps));
  const hasB = ends.some((p) => near(p, b0, eps));
  const issues = [];
  if (!hasA) issues.push("start-drift");
  if (!hasB) issues.push("end-drift");
  return { ok: issues.length === 0, issues };
}
