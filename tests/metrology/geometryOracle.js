/**
 * PHASE 2F1-M — INDEPENDENT GEOMETRY ORACLE.
 *
 * This module computes physical wall-face geometry from primitive plan data
 * ONLY: centreline endpoints, thickness, thicknessSide and topology. It exists
 * to judge the Planner's dimension output, so it must never consult that
 * output or any of the code that produces it — no dimension generation, no
 * arbitration, no anchor helpers, no contour-dimension utilities. Everything
 * below is derived from first principles with plain vector maths.
 *
 * The one thing it does NOT invent is the meaning of the stored data. The
 * thickness convention is a property of the model, not of the dimension code:
 *
 *   thicknessSide "center" -> the band straddles the centreline, thk/2 each way
 *   thicknessSide "in"     -> the whole band lies on the LEFT of a->b
 *   thicknessSide "out"    -> the whole band lies on the RIGHT of a->b
 *
 * with the left-hand normal of a->b taken as (-dy, dx)/|ab|. Section 2's unit
 * contract (1 model unit = 1 mm) is asserted against real drawn walls rather
 * than assumed.
 */

export const ORACLE_EPS = 1e-9;

/* ------------------------------------------------------------------ vectors */

export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const scale = (a, k) => ({ x: a.x * k, y: a.y * k });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const norm = (a) => Math.sqrt(a.x * a.x + a.y * a.y);
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function unitTangent(a, b) {
  const d = sub(b, a);
  const len = norm(d);
  if (len < ORACLE_EPS) return null;
  return { x: d.x / len, y: d.y / len };
}

/** Left-hand normal of a->b. */
export function leftNormal(a, b) {
  const t = unitTangent(a, b);
  return t ? { x: -t.y, y: t.x } : null;
}

/** Distance from a point to an INFINITE line through p0 with unit direction u. */
export function pointToLineDistance(p, p0, u) {
  return Math.abs(cross(sub(p, p0), u));
}

/** Signed position of p along u measured from p0. */
export function projectOnAxis(p, p0, u) {
  return dot(sub(p, p0), u);
}

export function pointToSegmentDistance(p, a, b) {
  const d = sub(b, a);
  const l2 = dot(d, d);
  if (l2 < ORACLE_EPS) return distance(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), d) / l2));
  return distance(p, add(a, scale(d, t)));
}

/** Distance between two points projected onto a measurement axis. */
export function projectedDistance(a, b, axisUnit) {
  return Math.abs(dot(sub(b, a), axisUnit));
}

/**
 * Intersection of two infinite lines (p1,u1) and (p2,u2).
 * Returns null when they are parallel — the caller then has no miter.
 */
export function intersectLines(p1, u1, p2, u2) {
  const den = cross(u1, u2);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross(sub(p2, p1), u2) / den;
  return add(p1, scale(u1, t));
}

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const straddles = (a.y > p.y) !== (b.y > p.y);
    if (!straddles) continue;
    const xCross = ((b.x - a.x) * (p.y - a.y)) / ((b.y - a.y) || ORACLE_EPS) + a.x;
    if (p.x < xCross) inside = !inside;
  }
  return inside;
}

/* -------------------------------------------------------------- wall faces */

/**
 * Signed offsets of the two physical faces along the LEFT normal of a->b.
 * left is the +normal face, right the -normal face.
 */
export function faceOffsets(wall) {
  const thk = Number.isFinite(wall?.thk) ? wall.thk : 100;
  const side = wall?.thicknessSide || "center";
  if (side === "in" || side === "inside") return { left: thk, right: 0 };
  if (side === "out" || side === "outside") return { left: 0, right: -thk };
  return { left: thk / 2, right: -thk / 2 };
}

/**
 * The two physical faces of one wall, as finite segments parallel to the
 * centreline. Corner mitering is applied separately (see miteredFacePoint):
 * these are the raw offset segments.
 */
export function wallFaces(wall, nodes) {
  const A = nodes[wall.a];
  const B = nodes[wall.b];
  if (!A || !B) return null;
  const t = unitTangent(A, B);
  if (!t) return null;
  const n = { x: -t.y, y: t.x };
  const off = faceOffsets(wall);
  const mk = (d) => ({ a: add(A, scale(n, d)), b: add(B, scale(n, d)) });
  return {
    wallId: wall.id,
    centre: { a: { ...A }, b: { ...B } },
    tangent: t,
    normal: n,
    offsets: off,
    left: { ...mk(off.left), offset: off.left, side: "left" },
    right: { ...mk(off.right), offset: off.right, side: "right" },
    centreLengthMm: distance(A, B),
  };
}

export function allWallFaces(plan) {
  const nodes = plan.nodes || {};
  const out = [];
  for (const wall of plan.walls || []) {
    const f = wallFaces(wall, nodes);
    if (f) out.push(f);
  }
  return out;
}

/**
 * Where two walls' faces truly meet at a shared node: the intersection of the
 * two infinite face lines. A raw offset-segment endpoint is NOT the physical
 * corner unless the walls happen to be collinear, which is exactly what §8
 * asks to be checked.
 */
export function miteredFacePoint(faceA, faceB) {
  return intersectLines(faceA.a, unitTangent(faceA.a, faceA.b), faceB.a, unitTangent(faceB.a, faceB.b));
}

/**
 * Every physical face segment in the plan, extended at both ends by an
 * allowance so a mitered corner point still counts as lying "on" the face.
 */
export function faceCandidates(plan, { miterAllowanceMm = null } = {}) {
  const faces = allWallFaces(plan);
  const maxThk = Math.max(100, ...(plan.walls || []).map((w) => w.thk || 100));
  const allowance = miterAllowanceMm == null ? maxThk * 1.5 : miterAllowanceMm;
  const out = [];
  for (const f of faces) {
    for (const side of ["left", "right"]) {
      const seg = f[side];
      out.push({
        wallId: f.wallId,
        side,
        offset: seg.offset,
        a: seg.a,
        b: seg.b,
        tangent: f.tangent,
        normal: f.normal,
        allowance,
        lengthMm: distance(seg.a, seg.b),
      });
    }
  }
  return out;
}

/**
 * The physical face a point lies on, if any.
 *
 * Perpendicular residual to the face LINE is the metrological quantity; the
 * along-axis position must still fall within the segment plus the miter
 * allowance, so a far-away collinear face cannot claim the point.
 */
export function nearestFace(point, candidates) {
  let best = null;
  for (const c of candidates) {
    const perp = pointToLineDistance(point, c.a, c.tangent);
    const along = projectOnAxis(point, c.a, c.tangent);
    const withinExtended = along >= -c.allowance && along <= c.lengthMm + c.allowance;
    if (!withinExtended) continue;
    const overshoot = Math.max(0, -along, along - c.lengthMm);
    if (!best || perp < best.perpendicularMm - 1e-9
      || (Math.abs(perp - best.perpendicularMm) <= 1e-9 && overshoot < best.overshootMm)) {
      best = {
        wallId: c.wallId,
        side: c.side,
        offset: c.offset,
        perpendicularMm: perp,
        alongMm: along,
        overshootMm: overshoot,
        faceLengthMm: c.lengthMm,
      };
    }
  }
  return best;
}

/** Distance from a point to the nearest wall CENTRELINE — the anti-oracle. */
export function nearestCentreline(point, plan) {
  const nodes = plan.nodes || {};
  let best = null;
  for (const wall of plan.walls || []) {
    const A = nodes[wall.a];
    const B = nodes[wall.b];
    if (!A || !B) continue;
    const d = pointToSegmentDistance(point, A, B);
    if (!best || d < best.distanceMm) best = { wallId: wall.id, distanceMm: d };
  }
  return best;
}

/* ------------------------------------------------------- room face polygons */

/**
 * Independent interior polygon of a closed wall loop, built by intersecting
 * consecutive inner face lines (real miters, not offset-segment endpoints).
 *
 * @param {Array} loopWalls walls in traversal order, each {wall, forward}
 */
export function interiorPolygonFromLoop(loopWalls, nodes, { innerSide = "auto" } = {}) {
  const faces = [];
  for (const { wall, forward } of loopWalls) {
    const A = nodes[forward ? wall.a : wall.b];
    const B = nodes[forward ? wall.b : wall.a];
    const t = unitTangent(A, B);
    if (!t) return null;
    const n = { x: -t.y, y: t.x };
    const off = faceOffsets(wall);
    // Traversal order fixes which side is interior; "auto" resolves by area.
    const d = innerSide === "right" ? off.right : off.left;
    faces.push({ p: add(A, scale(n, d)), u: t });
  }
  const poly = [];
  for (let i = 0; i < faces.length; i++) {
    const cur = faces[i];
    const next = faces[(i + 1) % faces.length];
    const hit = intersectLines(cur.p, cur.u, next.p, next.u);
    if (!hit) return null;
    poly.push(hit);
  }
  return poly;
}

export function polygonArea(poly) {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += (poly[j].x * poly[i].y) - (poly[i].x * poly[j].y);
  }
  return s / 2;
}

/**
 * Closed wall loops discovered from topology alone (degree-2 traversal), so the
 * oracle never needs the Planner's room detection.
 */
export function findClosedLoops(plan) {
  const nodes = plan.nodes || {};
  const walls = (plan.walls || []).filter((w) => nodes[w.a] && nodes[w.b]);
  const byNode = new Map();
  for (const w of walls) {
    for (const n of [w.a, w.b]) {
      if (!byNode.has(n)) byNode.set(n, []);
      byNode.get(n).push(w);
    }
  }
  const loops = [];
  const usedWalls = new Set();
  for (const start of walls) {
    if (usedWalls.has(start.id)) continue;
    if ((byNode.get(start.a) || []).length !== 2) continue;
    const chain = [];
    let current = start;
    let node = start.b;
    let forward = true;
    const guard = walls.length + 2;
    let ok = false;
    for (let i = 0; i < guard; i++) {
      chain.push({ wall: current, forward });
      const inc = (byNode.get(node) || []).filter((w) => w.id !== current.id);
      if (inc.length !== 1) break;
      const next = inc[0];
      if (next.id === start.id) { ok = true; break; }
      forward = next.a === node;
      node = forward ? next.b : next.a;
      current = next;
    }
    if (ok && chain.length >= 3) {
      chain.forEach((c) => usedWalls.add(c.wall.id));
      loops.push(chain);
    }
  }
  return loops;
}

/**
 * Interior polygon of a loop, with the inner side resolved by area: the correct
 * choice is the one that SHRINKS the enclosed region.
 */
export function loopInteriorPolygon(loop, nodes) {
  const left = interiorPolygonFromLoop(loop, nodes, { innerSide: "left" });
  const right = interiorPolygonFromLoop(loop, nodes, { innerSide: "right" });
  const centre = interiorPolygonFromLoop(
    loop.map(({ wall, forward }) => ({ wall: { ...wall, thk: 0 }, forward })), nodes,
    { innerSide: "left" },
  );
  if (!left || !right || !centre) return null;
  const aC = Math.abs(polygonArea(centre));
  const aL = Math.abs(polygonArea(left));
  const aR = Math.abs(polygonArea(right));
  return Math.abs(aL) < Math.abs(aC) ? left : (Math.abs(aR) < Math.abs(aC) ? right : left);
}

/* --------------------------------------------------- enclosure by wall mass */

/** Each wall as its physical quad (raw offset corners, no mitering). */
export function wallQuads(plan) {
  const nodes = plan.nodes || {};
  const quads = [];
  for (const wall of plan.walls || []) {
    const f = wallFaces(wall, nodes);
    if (!f) continue;
    quads.push({
      wallId: wall.id,
      poly: [f.left.a, f.left.b, f.right.b, f.right.a],
    });
  }
  return quads;
}

function segmentsIntersect(p1, p2, p3, p4) {
  const d1 = sub(p2, p1);
  const d2 = sub(p4, p3);
  const den = cross(d1, d2);
  if (Math.abs(den) < 1e-12) return false;
  const t = cross(sub(p3, p1), d2) / den;
  const u = cross(sub(p3, p1), d1) / den;
  return t > 1e-9 && t < 1 - 1e-9 && u > 1e-9 && u < 1 - 1e-9;
}

/**
 * Is this point enclosed by wall mass?
 *
 * Independent of the Planner's room detection AND of loop traversal: rays are
 * cast in many directions and the point counts as enclosed only when EVERY ray
 * runs into wall mass before escaping. Loop traversal cannot answer this for a
 * room whose bounding wall also carries a T branch (degree 3), which is most of
 * a real plan.
 */
export function isEnclosedByWalls(point, plan, { rays = 24, reach = 1e7 } = {}) {
  const quads = wallQuads(plan);
  for (const q of quads) if (pointInPolygon(point, q.poly)) return { enclosed: false, inMass: true };
  for (let i = 0; i < rays; i++) {
    // Irrational angular offset avoids grazing a face exactly.
    const ang = (i * 2 * Math.PI) / rays + 0.0137;
    const far = { x: point.x + Math.cos(ang) * reach, y: point.y + Math.sin(ang) * reach };
    let hit = false;
    for (const q of quads) {
      const poly = q.poly;
      for (let k = 0, j = poly.length - 1; k < poly.length; j = k++) {
        if (segmentsIntersect(point, far, poly[j], poly[k])) { hit = true; break; }
      }
      if (hit) break;
    }
    if (!hit) return { enclosed: false, inMass: false, escapedAt: ang };
  }
  return { enclosed: true, inMass: false };
}

/* ------------------------------------------------------------ span identity */

const q = (v, step) => Math.round(v / step) * step;

/**
 * Physical span key derived only from geometry + semantics, so two records
 * describing the same physical span collide regardless of anchor order.
 */
export function physicalSpanKey(p1, p2, { axis = null, side = "_", role = "_", quantMm = 1 } = {}) {
  const a = { x: q(p1.x, quantMm), y: q(p1.y, quantMm) };
  const b = { x: q(p2.x, quantMm), y: q(p2.y, quantMm) };
  const [first, second] = (a.x < b.x || (a.x === b.x && a.y <= b.y)) ? [a, b] : [b, a];
  const ax = axis || (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? "h" : "v");
  return `${role}:${side}:${ax}:${first.x},${first.y}:${second.x},${second.y}`;
}

/** Angle between two vectors in degrees, folded to [0,90]. */
export function angleBetweenDeg(u, v) {
  const lu = norm(u);
  const lv = norm(v);
  if (lu < ORACLE_EPS || lv < ORACLE_EPS) return NaN;
  const c = Math.min(1, Math.max(-1, dot(u, v) / (lu * lv)));
  const deg = (Math.acos(c) * 180) / Math.PI;
  return deg > 90 ? 180 - deg : deg;
}
