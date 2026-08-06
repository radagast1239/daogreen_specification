/**
 * Геометрия стен как непрерывных лент: offset + miter в общих узлах.
 * Работает с текущим форматом walls[].pts (узлы = сваренные координаты).
 */
import { dist, near } from "./core/geometry/point.js";
import { projectOnSegment } from "./core/geometry/segment.js";
import { NODE_LINK_THR } from "./core/walls/wallOps.js";
import { wallFacePoint } from "./wallParallelGeometry.js";

export { NODE_LINK_THR };

function segDirUnit(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/** Пересечение двух прямых (точка + направление). */
export function lineIntersectLines(p1, d1, p2, d2) {
  const det = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(det) < 1e-9) return null;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const t = (dx * d2.y - dy * d2.x) / det;
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
}

/**
 * PHASE 2E FOLLOW-UP — endpoint clustering.
 *
 * This used to be a GRID HASH: `round(x/thr)_round(y/thr)`. Two endpoints in
 * the same 85 mm cell were declared the same node however far apart they were,
 * and two endpoints 0.2 mm apart straddling a cell edge were declared
 * different. With plans built from exact shared node coordinates that never
 * bit. With a plan the user DREW it bites immediately: freehand endpoints land
 * a few millimetres from the node they were aiming at, and the hash fused
 * genuinely separate topology nodes — measured on the manual plan, one bucket
 * held (4033,-14) and (4000,0), 35.8 mm apart and belonging to different
 * walls. Every arm in the bucket was then joined about ONE arbitrary
 * representative point, which tilted the bands off their own centerlines and
 * produced the visible defects.
 *
 * Replaced with a real proximity clustering (union-find over endpoints that
 * are genuinely within `thr` of each other), so distance decides membership,
 * not which cell a coordinate happened to fall in. The 3x3 neighbourhood scan
 * keeps it near-linear instead of O(n^2).
 */
function clusterEndpoints(points, thr) {
  const parent = points.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (i, j) => { const a = find(i); const b = find(j); if (a !== b) parent[b] = a; };

  const cell = new Map();
  const cellKey = (x, y) => `${Math.floor(x / thr)}_${Math.floor(y / thr)}`;
  points.forEach((p, i) => {
    const k = cellKey(p.x, p.y);
    if (!cell.has(k)) cell.set(k, []);
    cell.get(k).push(i);
  });
  points.forEach((p, i) => {
    const cx = Math.floor(p.x / thr); const cy = Math.floor(p.y / thr);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of cell.get(`${cx + dx}_${cy + dy}`) || []) {
          if (j > i && dist(p, points[j]) <= thr) union(i, j);
        }
      }
    }
  });
  return points.map((_, i) => find(i));
}

function buildNodeArms(walls, thr = NODE_LINK_THR) {
  const entries = [];
  for (const wall of walls || []) {
    if (!wall?.pts || wall.pts.length < 2) continue;
    for (let i = 0; i < wall.pts.length - 1; i++) {
      const a = wall.pts[i];
      const b = wall.pts[i + 1];
      if (dist(a, b) < 1) continue;
      const arm = { wall, segIdx: i, a, b };
      entries.push({ pt: a, arm });
      entries.push({ pt: b, arm });
    }
  }
  const roots = clusterEndpoints(entries.map((e) => e.pt), thr);
  const armsByKey = new Map();
  const keyByPoint = new Map();          // exact endpoint -> cluster key
  entries.forEach((e, i) => {
    const key = `c${roots[i]}`;
    if (!armsByKey.has(key)) armsByKey.set(key, { node: null, pts: [], arms: [] });
    const bucket = armsByKey.get(key);
    bucket.pts.push(e.pt);
    bucket.arms.push(e.arm);
    keyByPoint.set(pointKey(e.pt), key);
  });
  // Representative = centroid of the clustered endpoints. Deterministic and
  // independent of wall array order, unlike "whichever endpoint arrived first".
  for (const bucket of armsByKey.values()) {
    const n = bucket.pts.length;
    bucket.node = {
      x: bucket.pts.reduce((s, p) => s + p.x, 0) / n,
      y: bucket.pts.reduce((s, p) => s + p.y, 0) / n,
    };
  }
  return { armsByKey, keyByPoint };
}

/** Exact-coordinate key — endpoints are looked up by the value they were indexed with. */
function pointKey(p) {
  return `${p.x.toFixed(4)}_${p.y.toFixed(4)}`;
}

// ---------------------------------------------------------------------------
// Ordered multiway node join.
//
// The previous model picked ONE arbitrary neighbor per wall end via
// endpoint-nearness (correct for a plain 2-arm corner, since there is only
// one possible neighbor, but for a node with 3+ NON-collinear incident
// walls it can pair a wall's corner with a neighbor that isn't actually
// adjacent to it around the node, producing overlapping polygons, gaps, or
// spikes).
//
// buildNodeJoin replaces it with a proper node-local join: every incident
// wall becomes an "arm" (direction away from the node, angle, and which
// rotational side -- left/right of that outgoing direction -- its own
// "outer" face actually falls on, measured directly rather than assumed).
// Arms are sorted by angle into a stable circular order. Between every pair
// of angularly-ADJACENT arms there is exactly one join point, shared by
// "the sector-facing side" of both arms (arm i's LEFT paired with arm i+1's
// RIGHT, going counter-clockwise) -- so each arm always gets its two corner
// points (whichever of outer/inner each turns out to be, per its own
// measured side) from its two immediate neighbors, never a distant one.
// This is a strict generalization of the old pairwise model: for exactly 2
// arms it reduces to the same outer-outer / inner-inner pairing.
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;

/**
 * How far from the node a T-junction branch cap may reach, as a multiple of
 * the larger of (branch thickness, host thickness). Beyond this the branch is
 * so close to parallel with its host that the face intersection runs away, and
 * a bounded fallback is used instead of a spike.
 */
export const TEE_CAP_MITER_MUL = 4;

function normalizeAngle(a) {
  const r = a % TAU;
  return r < 0 ? r + TAU : r;
}

// Node-local arm descriptor: outgoing direction/angle plus each face point
// (as a plain, un-joined offset from the node -- the "naive" corner, used
// both as the miter-limit/degenerate fallback and, for sector pairing, as a
// convention-independent proximity probe -- see buildNodeJoin).
function describeArm(arm, node, room, thr) {
  const atA = dist(arm.a, node) <= dist(arm.b, node);
  const nearPt = atA ? arm.a : arm.b;
  const farPt = atA ? arm.b : arm.a;
  const dirAway = segDirUnit(nearPt, farPt);
  // PHASE 2E FOLLOW-UP — anchor the face points on the arm's OWN endpoint,
  // never on the shared node. The two can differ by a few millimetres when a
  // hand-drawn endpoint did not land exactly on the node it was aiming at, and
  // offsetting the SHARED point perpendicular to THIS arm puts the face line
  // beside the arm's real face instead of on it: the band then leaves the node
  // tilted, its width measured perpendicular to its own centerline no longer
  // equals its thickness, and the tilted face stops cancelling against the
  // faces it should be collinear with. Anchoring on nearPt keeps every band
  // exactly parallel to its own centerline no matter where the node sits; a
  // residual node mismatch can now only move the join POINT, never tilt a wall.
  const outerPt = wallFacePoint(nearPt, arm.a, arm.b, "outer", arm.wall, room);
  const innerPt = wallFacePoint(nearPt, arm.a, arm.b, "inner", arm.wall, room);
  return {
    arm,
    end: atA ? "a" : "b",
    nearPt,
    dirAway,
    angle: normalizeAngle(Math.atan2(dirAway.y, dirAway.x)),
    faceLineDir: segDirUnit(arm.a, arm.b),
    outerPt,
    innerPt,
    thk: Math.max(1, Number(arm.wall?.thk) || 100),
  };
}

function faceLineOf(d, faceKey) {
  return { p: faceKey === "outer" ? d.outerPt : d.innerPt, d: d.faceLineDir };
}

// A T-junction "host" is a pair of distinct-wall-id arms at a node that are
// collinear and point opposite ways away from the node (one arriving, one
// departing along the same straight line -- the signature left by
// expandWallsAtTeeJunctions splitting a host wall where a branch attaches).
function findCollinearHostPair(described) {
  for (let i = 0; i < described.length; i++) {
    for (let j = i + 1; j < described.length; j++) {
      const a = described[i];
      const b = described[j];
      if (a.arm.wall.id === b.arm.wall.id) continue;
      const cross = Math.abs(a.dirAway.x * b.dirAway.y - a.dirAway.y * b.dirAway.x);
      const dot = a.dirAway.x * b.dirAway.x + a.dirAway.y * b.dirAway.y;
      if (cross < 0.03 && dot < -0.97) return [a, b];
    }
  }
  return null;
}

// The face of an arm that faces INTO a given interior direction: its offset
// point (relative to the node) has a positive projection on `intoDir`.
function faceFacingInto(arm, node, intoDir) {
  const outerRel = { x: arm.outerPt.x - node.x, y: arm.outerPt.y - node.y };
  const dOuter = outerRel.x * intoDir.x + outerRel.y * intoDir.y;
  return dOuter >= 0 ? "outer" : "inner";
}

// One sector's join point, shared by the two angularly-adjacent arms
// bordering it. The two arms bound an angular wedge; the sum of their
// outgoing directions points along the wedge's interior bisector. Each
// arm's face that FACES INTO that wedge (positive projection on the
// bisector) is the one physically adjacent across the gap -- those two
// faces are what miter together here. This is convention-independent (it
// never assumes which rotational side wallFacePoint happened to call
// "outer") and correct for acute, right, and obtuse wedges alike. Falls
// back to the midpoint of the two chosen face points when the face lines
// are ~parallel or the raw intersection would land beyond a
// thickness-relative miter limit (a very acute wedge) -- always within
// about a wall thickness of the node, so never a spike or self-intersection.
function sectorJoinPoint(node, cur, next, maxMiterMul = 4, sectorSpan = null) {
  let bisector = { x: cur.dirAway.x + next.dirAway.x, y: cur.dirAway.y + next.dirAway.y };
  const blen = Math.hypot(bisector.x, bisector.y);
  if (blen < 1e-6) {
    // ~180° wedge (collinear arms): bisector is undefined; use the normal
    // to the shared line, oriented toward whichever side both arms' matching
    // faces sit (falls through to the mid-point fallback below anyway).
    bisector = { x: -cur.dirAway.y, y: cur.dirAway.x };
  } else {
    bisector = { x: bisector.x / blen, y: bisector.y / blen };
  }
  // PHASE 2E FOLLOW-UP — a REFLEX sector needs the opposite bisector.
  //
  // dirCur + dirNext bisects the wedge that is smaller than 180 degrees. Going
  // round a node the sectors must tile the full turn, so at any node with 3+
  // arms that are not evenly spread one sector is usually reflex (> 180) --
  // and for that one the sum points into the sector's OUTSIDE. faceFacingInto
  // then picked both arms' far faces and mitered the wrong pair, which tore a
  // wedge out of the mass on one side and stacked it twice on the other.
  //
  // Measured on the manual plan: the horizontal+vertical+diagonal hub the user
  // drew has sectors of 33.7, 56.3 and 270 degrees; only the 270 one was wrong,
  // and it alone produced the triangular gap. A second hub at 0,5935 (sectors
  // 72.1 / 198.4 / 89.5) failed the same way, while a hub whose sectors were
  // all convex rendered correctly -- which is what identified this.
  if (sectorSpan != null && sectorSpan > Math.PI) {
    bisector = { x: -bisector.x, y: -bisector.y };
  }
  const curFace = faceFacingInto(cur, node, bisector);
  const nextFace = faceFacingInto(next, node, bisector);
  const curLine = faceLineOf(cur, curFace);
  const nextLine = faceLineOf(next, nextFace);
  const curPt = curFace === "outer" ? cur.outerPt : cur.innerPt;
  const nextPt = nextFace === "outer" ? next.outerPt : next.innerPt;
  const fallback = { x: (curPt.x + nextPt.x) / 2, y: (curPt.y + nextPt.y) / 2 };
  const pt = lineIntersectLines(curLine.p, curLine.d, nextLine.p, nextLine.d);
  const resolved = (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)
    || dist(node, pt) > Math.max(cur.thk, next.thk) * maxMiterMul) ? fallback : pt;
  return { point: resolved, curFace, nextFace };
}

/**
 * Computes the joined outer/inner corner point for every wall end incident
 * to one node. Returns a Map keyed by `${wallId}-${segIdx}-${end}` ->
 * { outer, inner }.
 */
function buildNodeJoin(nodeArms, node, room, thr = NODE_LINK_THR) {
  const result = new Map();
  if (!nodeArms?.length) return result;
  const described = nodeArms.map((arm) => describeArm(arm, node, room, thr));
  if (described.length === 1) {
    const d = described[0];
    result.set(`${d.arm.wall.id}-${d.arm.segIdx}-${d.end}`, { outer: d.outerPt, inner: d.innerPt });
    return result;
  }
  const sorted = [...described].sort((a, b) => a.angle - b.angle || a.arm.wall.id.localeCompare(b.arm.wall.id));
  const n = sorted.length;
  const setResult = (d, faces) => result.set(`${d.arm.wall.id}-${d.arm.segIdx}-${d.end}`, {
    outer: faces.outer || d.outerPt,
    inner: faces.inner || d.innerPt,
  });

  // Two arms is a plain corner. The N>=3 sector walk cannot be reused
  // verbatim (with n === 2 both sectors lie between the SAME pair of arms, so
  // the loop would compute one of them twice), but its face-picking rule can:
  // a corner has two wedges, the one the bisector b = normalize(dirA + dirB)
  // points into and the one -b points into, and in each wedge the two faces
  // that miter together are the ones FACING INTO it.
  //
  // PHASE 2E -- this replaces a proximity pairing ("y's face nearest to
  // x.outer is the one x.outer miters with"). That heuristic is exactly TIED
  // at a right angle: for equal thicknesses both candidates sit thk/sqrt(2)
  // away, and the tie was broken by `<=`, i.e. arbitrarily. It came out right
  // only when the two arms' outer faces happened to fall on the same
  // geometric side. "outer"/"inner" is assigned by wallSegmentOffsetSide
  // relative to the ROOM CENTRE, so on a rectangle that does not enclose the
  // room centre two of the four corners get opposite labels and the tie broke
  // the WRONG way: the corner was mitered across the anti-diagonal, biting a
  // triangle out of one side of the corner and doubling the mass on the
  // other. Measured on a 6000x4000 rectangle at the origin in a 30000x20000
  // room: corners (0,0) and (6000,4000) came out correct, (6000,0) and
  // (0,4000) came out crossed. The bisector test cannot tie -- a zero
  // projection would mean the bisector is parallel to an arm, i.e. the arms
  // are collinear, which is the no-corner case handled above it.
  if (n === 2) {
    const [x, y] = sorted;
    let bis = { x: x.dirAway.x + y.dirAway.x, y: x.dirAway.y + y.dirAway.y };
    const blen = Math.hypot(bis.x, bis.y);
    if (blen < 1e-6) {
      // Collinear arms pointing opposite ways: the wall runs straight through
      // this node, there is no corner to miter -- each arm keeps its own faces.
      setResult(x, {});
      setResult(y, {});
      return result;
    }
    bis = { x: bis.x / blen, y: bis.y / blen };
    const joinWedge = (into) => {
      const xFace = faceFacingInto(x, node, into);
      const yFace = faceFacingInto(y, node, into);
      const line1 = faceLineOf(x, xFace);
      const line2 = faceLineOf(y, yFace);
      const p1 = xFace === "outer" ? x.outerPt : x.innerPt;
      const p2 = yFace === "outer" ? y.outerPt : y.innerPt;
      const pt = lineIntersectLines(line1.p, line1.d, line2.p, line2.d);
      const bounded = pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)
        && dist(node, pt) <= Math.max(x.thk, y.thk) * 4;
      // Very acute wedge (or near-parallel faces): bevel to the midpoint of
      // the two face points instead of letting the miter run away.
      const point = bounded ? pt : { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      return { point, xFace, yFace };
    };
    const faces = new Map([[x, {}], [y, {}]]);
    for (const w of [joinWedge(bis), joinWedge({ x: -bis.x, y: -bis.y })]) {
      faces.get(x)[w.xFace] = w.point;
      faces.get(y)[w.yFace] = w.point;
    }
    setResult(x, faces.get(x));
    setResult(y, faces.get(y));
    return result;
  }

  // T-junction special case: a collinear host pair (the host wall split at
  // the branch attachment) plus one or more branches. The host must stay a
  // straight, continuous band right through the node -- its two sub-segments
  // keep their own naive faces (they are collinear, so no corner) -- and
  // each branch caps against the host's near (inner-facing) side rather than
  // being mitered into a sector with a host arm, which would drag its
  // outline through the host's full thickness. This preserves exactly the
  // behaviour the dedicated T-junction fix and its regression tests locked in.
  const hostPair = findCollinearHostPair(sorted);
  if (hostPair) {
    const [h1, h2] = hostPair;
    // host sub-segments: keep their own straight faces (no join)
    setResult(h1, { outer: h1.outerPt, inner: h1.innerPt });
    setResult(h2, { outer: h2.outerPt, inner: h2.innerPt });
    // The host's centerline passes through the node; a branch's two faces
    // must both land on whichever host face the branch approaches from
    // (its near side). The host's own two naive face points straddle the
    // centerline; project the branch's face points onto the host line and
    // cap them at the nearer host face offset.
    const hostDir = h1.faceLineDir;
    const hostNormal = { x: -hostDir.y, y: hostDir.x };
    const hostHalf = Math.max(h1.thk, h2.thk) / 2;
    for (const d of sorted) {
      if (d === h1 || d === h2) continue;
      // signed distance of the branch's outgoing direction along the host
      // normal tells which side of the host the branch is on
      const side = Math.sign(d.dirAway.x * hostNormal.x + d.dirAway.y * hostNormal.y) || 1;
      const capOffset = hostHalf * side;
      const hostFacePt = {
        x: node.x + hostNormal.x * capOffset,
        y: node.y + hostNormal.y * capOffset,
      };
      // PHASE 2E — the branch's faces must MEET the host's near face, not be
      // projected onto it. Projection kept each face point's component along
      // the host and so squeezed the mouth to thk*sin(angle): a branch meeting
      // the host at 52 degrees ended up 79mm wide instead of 100, which is the
      // wedge users saw on diagonal branches. Intersecting each face line with
      // the host face line keeps the branch at full thickness right up to the
      // face and mitres it correctly at any incidence angle.
      const capOnHost = (p) => {
        const hit = lineIntersectLines(p, d.faceLineDir, hostFacePt, hostDir);
        const bound = Math.max(d.thk, hostHalf * 2) * TEE_CAP_MITER_MUL;
        if (hit && Number.isFinite(hit.x) && Number.isFinite(hit.y) && dist(node, hit) <= bound) {
          return hit;
        }
        // Branch nearly parallel to the host: the intersection runs away, so
        // fall back to the bounded projection (never a spike).
        const rel = { x: p.x - node.x, y: p.y - node.y };
        const along = rel.x * hostDir.x + rel.y * hostDir.y;
        return {
          x: node.x + hostDir.x * along + hostNormal.x * capOffset,
          y: node.y + hostDir.y * along + hostNormal.y * capOffset,
        };
      };
      setResult(d, { outer: capOnHost(d.outerPt), inner: capOnHost(d.innerPt) });
    }
    return result;
  }

  const byArm = new Map(sorted.map((d) => [d, { faces: {} }]));
  for (let i = 0; i < n; i++) {
    const cur = sorted[i];
    const next = sorted[(i + 1) % n];
    // angular width of THIS sector, going counter-clockwise from cur to next;
    // the sectors of a node sum to a full turn, so one of them is often reflex
    const span = normalizeAngle(next.angle - cur.angle) || TAU;
    const { point, curFace, nextFace } = sectorJoinPoint(node, cur, next, 4, span);
    byArm.get(cur).faces[curFace] = point;
    byArm.get(next).faces[nextFace] = point;
  }
  for (const d of sorted) setResult(d, byArm.get(d).faces);
  return result;
}

/** Сводим общие угловые точки соседних стен — убирает щели в L/T-стыках. */
function alignSharedQuadCorners(polygons, mergeThr = 2.5) {
  const entries = [];
  for (let pi = 0; pi < polygons.length; pi++) {
    for (let ci = 0; ci < 4; ci++) entries.push({ pi, ci, pt: polygons[pi].quad[ci] });
  }
  const used = new Set();
  for (let i = 0; i < entries.length; i++) {
    if (used.has(i)) continue;
    const cluster = [entries[i]];
    used.add(i);
    for (let j = i + 1; j < entries.length; j++) {
      if (used.has(j)) continue;
      if (dist(entries[i].pt, entries[j].pt) <= mergeThr) {
        cluster.push(entries[j]);
        used.add(j);
      }
    }
    if (cluster.length < 2) continue;
    const ax = cluster.reduce((s, c) => s + c.pt.x, 0) / cluster.length;
    const ay = cluster.reduce((s, c) => s + c.pt.y, 0) / cluster.length;
    for (const c of cluster) {
      c.pt.x = ax;
      c.pt.y = ay;
    }
  }
}

/** Вставить точки T-стыков на хост-сегменты для корректного miter. */
function expandWallsAtTeeJunctions(walls, thr = NODE_LINK_THR) {
  const insertions = new Map();

  for (const stem of walls || []) {
    if (!stem?.pts || stem.pts.length !== 2) continue;
    for (const ep of stem.pts) {
      for (const host of walls || []) {
        if (host.id === stem.id || !host?.pts || host.pts.length < 2) continue;
        const a = host.pts[0];
        const b = host.pts[host.pts.length - 1];
        if (near(ep, a, thr) || near(ep, b, thr)) continue;
        const proj = projectOnSegment(ep, a, b);
        if (dist(ep, proj) > thr) continue;
        const segLen = dist(a, b) || 1;
        const t = dist(a, proj) / segLen;
        if (t <= 0.02 || t >= 0.98) continue;
        if (!insertions.has(host.id)) insertions.set(host.id, []);
        const arr = insertions.get(host.id);
        if (!arr.some((p) => near(p, proj, 1))) arr.push({ x: proj.x, y: proj.y });
      }
    }
  }

  return (walls || []).map((w) => {
    const ins = insertions.get(w.id);
    if (!ins?.length || w.pts.length < 2) return w;
    const a = w.pts[0];
    const b = w.pts[w.pts.length - 1];
    const segLen = dist(a, b) || 1;
    const mid = ins
      .map((p) => ({ p, t: dist(a, p) / segLen }))
      .sort((x, y) => x.t - y.t)
      .map((x) => x.p);
    return { ...w, pts: [a, ...mid, b] };
  });
}

/**
 * @returns {{ polygons: Array<{wallId, segIdx, key, quad}>, contours: Array<{wallId, segIdx, face, a, b, key}> }}
 */
export function buildWallGeometry(walls, room = null, thr = NODE_LINK_THR) {
  const expanded = expandWallsAtTeeJunctions(walls, thr);
  const { armsByKey, keyByPoint } = buildNodeArms(expanded, thr);
  const polygons = [];
  const contours = [];

  const nodeJoinsByKey = new Map();
  const nodeJoinFor = (pt) => {
    const key = keyByPoint.get(pointKey(pt));
    if (key == null) return null;
    if (!nodeJoinsByKey.has(key)) {
      const entry = armsByKey.get(key);
      nodeJoinsByKey.set(key, buildNodeJoin(entry?.arms || [], entry?.node || pt, room, thr));
    }
    return nodeJoinsByKey.get(key);
  };

  for (const wall of expanded || []) {
    if (!wall?.pts || wall.pts.length < 2) continue;
    for (let i = 0; i < wall.pts.length - 1; i++) {
      const a = wall.pts[i];
      const b = wall.pts[i + 1];
      if (dist(a, b) < 1) continue;

      const joinA = nodeJoinFor(a)?.get(`${wall.id}-${i}-a`);
      const joinB = nodeJoinFor(b)?.get(`${wall.id}-${i}-b`);
      const outerA = joinA?.outer;
      const innerA = joinA?.inner;
      const outerB = joinB?.outer;
      const innerB = joinB?.inner;

      const quad = [outerA, outerB, innerB, innerA];
      if (!quad.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))) continue;

      const key = `${wall.id}-${i}`;
      polygons.push({ wallId: wall.id, segIdx: i, key, quad });
      contours.push(
        { wallId: wall.id, segIdx: i, face: "outer", a: outerA, b: outerB, key: `${key}-o` },
        { wallId: wall.id, segIdx: i, face: "inner", a: innerA, b: innerB, key: `${key}-i` },
      );
    }
  }

  alignSharedQuadCorners(polygons);

  return { polygons, contours, expanded };
}

/** Длина осевой линии сегмента (для размеров). */
export function wallSegAxisLength(wall, segIdx = 0) {
  if (!wall?.pts || segIdx >= wall.pts.length - 1) return 0;
  return dist(wall.pts[segIdx], wall.pts[segIdx + 1]);
}

/** Карта quad по wallId-segIdx для быстрого доступа при рендере. */
let _geomCache = null;

function wallsSignature(walls) {
  return (walls || []).map((w) => `${w.id}:${(w.pts || []).map((p) => `${Math.round(p.x)}_${Math.round(p.y)}`).join(";")}:${w.thk}`).join("|");
}

export function wallGeometryMap(walls, room = null) {
  const sig = wallsSignature(walls);
  if (_geomCache?.sig === sig && _geomCache?.room === room) return _geomCache.data;
  const { polygons, contours, expanded } = buildWallGeometry(walls, room);
  const data = {
    quads: new Map(polygons.map((p) => [`${p.wallId}-${p.segIdx}`, p.quad])),
    contours,
    polygons,
    expandedWalls: expanded,
  };
  _geomCache = { sig, room, data };
  return data;
}

export function slabFromMiterQuad(quad, t0, t1) {
  const [outerA, outerB, innerB, innerA] = quad;
  return [
    { x: outerA.x + (outerB.x - outerA.x) * t0, y: outerA.y + (outerB.y - outerA.y) * t0 },
    { x: outerA.x + (outerB.x - outerA.x) * t1, y: outerA.y + (outerB.y - outerA.y) * t1 },
    { x: innerA.x + (innerB.x - innerA.x) * t1, y: innerA.y + (innerB.y - innerA.y) * t1 },
    { x: innerA.x + (innerB.x - innerA.x) * t0, y: innerA.y + (innerB.y - innerA.y) * t0 },
  ];
}

export function contourSegment(contour, t0, t1) {
  return {
    p0: { x: contour.a.x + (contour.b.x - contour.a.x) * t0, y: contour.a.y + (contour.b.y - contour.a.y) * t0 },
    p1: { x: contour.a.x + (contour.b.x - contour.a.x) * t1, y: contour.a.y + (contour.b.y - contour.a.y) * t1 },
  };
}
