/**
 * Unified wall-mass geometry (visible render layer).
 *
 * The edit/identity layer keeps one quad per wall segment (see
 * buildWallGeometry) — used for selection, hit-testing, dimensions, commands.
 * For the VISIBLE render, connected walls must read as a single continuous
 * mass: one hatch fill, one boundary outline, no internal seams between the
 * individual wall polygons and no cap where two walls join.
 *
 * The ordered multiway join already produces quads that (a) do not overlap
 * (overlap area = 0) and (b) exactly share their end-cap edges at every
 * junction (adjacent walls' join corners are snapped to the same points by
 * alignSharedQuadCorners). The union is therefore a pure boundary
 * extraction: an edge shared by two polygons (appearing once in each
 * direction) is interior and cancels; every surviving edge is a real
 * outer/inner face or a free end cap. At a node where 3+ walls meet the
 * quads share only the join VERTICES, leaving the small central polygon of
 * the node uncovered — so a "node-core" polygon (the join points ordered
 * around the node) is added to the union to close it; its edges are exactly
 * the walls' end-cap edges (reversed) and cancel them, leaving one clean
 * boundary. No polygon-clipping dependency, no white masks, no z-index tricks.
 */

const EPS = 1e-3;
const KEY_SCALE = 1000; // 1 micron quantization for vertex identity

function keyOf(p) {
  return `${Math.round(p.x * KEY_SCALE)}_${Math.round(p.y * KEY_SCALE)}`;
}

function signedArea(loop) {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % loop.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function pointInLoop(pt, loop) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const xi = loop[i].x, yi = loop[i].y, xj = loop[j].x, yj = loop[j].y;
    if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function distPointToSeg(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const L2 = vx * vx + vy * vy;
  if (L2 < EPS) return dist(p, a);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
}

/** Strictly interior: inside the loop AND not sitting on any of its edges. */
function strictlyInsideLoop(pt, loop, edgeTol = 0.5) {
  if (!pointInLoop(pt, loop)) return false;
  for (let i = 0; i < loop.length; i++) {
    if (distPointToSeg(pt, loop[i], loop[(i + 1) % loop.length]) <= edgeTol) return false;
  }
  return true;
}

function loopBounds(loop) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of loop) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}

function boundsOverlap(a, b, pad = 0) {
  return !(a.x1 + pad < b.x0 || b.x1 + pad < a.x0 || a.y1 + pad < b.y0 || b.y1 + pad < a.y0);
}

function segIntersectParam(p, r, a, b) {
  // solve p + t*r = a + u*(b-a); returns t or null
  const sx = b.x - a.x, sy = b.y - a.y;
  const denom = r.x * sy - r.y * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const qpx = a.x - p.x, qpy = a.y - p.y;
  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * r.y - qpy * r.x) / denom;
  if (u < -1e-9 || u > 1 + 1e-9) return null;
  return t;
}

/**
 * True 2D overlap test for two convex quads: either an edge pair crosses, or
 * one quad's vertex lies strictly inside the other. Endpoint-only touching
 * (shared join corners, abutting end caps) is NOT overlap.
 */
function quadsOverlap(qa, qb) {
  if (!boundsOverlap(loopBounds(qa), loopBounds(qb))) return false;
  for (const p of qa) if (strictlyInsideLoop(p, qb)) return true;
  for (const p of qb) if (strictlyInsideLoop(p, qa)) return true;
  // a crossing pair of edges (proper crossing, not shared endpoints)
  for (let i = 0; i < qa.length; i++) {
    const a1 = qa[i], a2 = qa[(i + 1) % qa.length];
    for (let j = 0; j < qb.length; j++) {
      const b1 = qb[j], b2 = qb[(j + 1) % qb.length];
      const o = (p, q, r) => {
        const v = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
        return Math.abs(v) < EPS ? 0 : Math.sign(v);
      };
      if (o(a1, a2, b1) !== o(a1, a2, b2) && o(b1, b2, a1) !== o(b1, b2, a2)) return true;
    }
  }
  return false;
}

/**
 * Boundary of a union = the parts of each polygon's boundary that are NOT
 * strictly inside any other polygon. Parity cancellation alone only removes
 * COLLINEAR coincident/overlapping edges, so when two quads overlap in a 2D
 * region (walls crossing mid-span, or collinear walls overlapping along their
 * length) the crossing edges run through the other quad's interior and survive
 * — drawing a visible cross of stacked polygons and doubling the hatch. This
 * clips those spans away, which is what makes the union a real union instead of
 * a paint-order illusion.
 */
function clipEdgesInsidePolygons(edges, polys) {
  if (!edges.length || !polys.length) return edges;
  const polyBounds = polys.map(loopBounds);
  const out = [];
  for (const e of edges) {
    const len = dist(e.a, e.b);
    if (len < EPS) continue;
    const r = { x: e.b.x - e.a.x, y: e.b.y - e.a.y };
    const eb = loopBounds([e.a, e.b]);
    // candidate polygons whose bbox meets this edge
    const cand = [];
    for (let i = 0; i < polys.length; i++) {
      if (boundsOverlap(eb, polyBounds[i], 1)) cand.push(polys[i]);
    }
    if (!cand.length) { out.push(e); continue; }
    // split the edge at every crossing with a candidate polygon edge
    const cuts = [0, 1];
    for (const poly of cand) {
      for (let i = 0; i < poly.length; i++) {
        const t = segIntersectParam(e.a, r, poly[i], poly[(i + 1) % poly.length]);
        if (t != null && t > 1e-9 && t < 1 - 1e-9) cuts.push(t);
      }
    }
    cuts.sort((x, y) => x - y);
    // PHASE 2E FOLLOW-UP — exterior test, two-sided.
    //
    // This used to ask "is the fragment's midpoint strictly inside ONE
    // polygon", with a 0.5 mm edge tolerance. Both halves of that are wrong
    // for a junction. A fragment running along the SEAM between two abutting
    // quads is interior to the union but strictly inside neither, and a
    // fragment lying a fraction of a millimetre inside a neighbour was
    // disqualified by the tolerance. Measured on the manual plan, that is
    // exactly what left a 50 mm line inside a T — half the branch mouth, the
    // "internal half-line" the user saw.
    //
    // A fragment is on the EXTERIOR boundary iff the mass is on exactly one
    // side of it. So sample both normals: keep the fragment when one side is
    // in the union and the other is not; drop it when both are inside (buried)
    // or both outside (dangling).
    const nlen = Math.hypot(r.x, r.y) || 1;
    const nx = -r.y / nlen; const ny = r.x / nlen;
    const OFF = 0.25;                       // mm; features here are >= tens of mm
    const inUnion = (px, py) => cand.some((poly) => pointInLoop({ x: px, y: py }, poly));
    let runStart = null;
    for (let i = 0; i < cuts.length - 1; i++) {
      const t0 = cuts[i], t1 = cuts[i + 1];
      if (t1 - t0 < 1e-9) continue;
      const tm = (t0 + t1) / 2;
      const mx = e.a.x + r.x * tm; const my = e.a.y + r.y * tm;
      const left = inUnion(mx + nx * OFF, my + ny * OFF);
      const right = inUnion(mx - nx * OFF, my - ny * OFF);
      const exterior = left !== right;
      if (exterior) {
        if (runStart == null) runStart = t0;
      } else if (runStart != null) {
        pushSpan(out, e, r, runStart, t0, len);
        runStart = null;
      }
    }
    if (runStart != null) pushSpan(out, e, r, runStart, 1, len);
  }
  return out;
}

function pushSpan(out, e, r, t0, t1, len) {
  if ((t1 - t0) * len <= EPS) return;
  out.push({
    a: { x: e.a.x + r.x * t0, y: e.a.y + r.y * t0 },
    b: { x: e.a.x + r.x * t1, y: e.a.y + r.y * t1 },
  });
}

/**
 * Connected components by wall TOPOLOGY (shared centerline node), not by quad
 * vertices (join corners can be a hair apart and would split a real node).
 * Two walls are connected iff a centerline endpoint of one coincides with a
 * centerline endpoint of the other. Returns arrays of polygon indices.
 *
 * @param {Array<{wallId, quad}>} polygons
 * @param {Array<{id, pts:Array<{x,y}>}>} walls  (expanded walls, centerline)
 */
export function buildWallConnectedComponents(polygons = [], walls = [], thr = 60) {
  const wallOf = new Map(walls.map((w) => [w.id, w]));
  const ids = [...new Set(polygons.map((p) => p.wallId))];
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const unite = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  const q = Math.max(1, thr);
  const nodeOwners = new Map(); // quantized endpoint -> wallId
  for (const id of ids) {
    const w = wallOf.get(id);
    const pts = w?.pts || [];
    for (const p of [pts[0], pts[pts.length - 1]]) {
      if (!p) continue;
      const k = `${Math.round(p.x / q)}_${Math.round(p.y / q)}`;
      if (nodeOwners.has(k)) unite(nodeOwners.get(k), id);
      else nodeOwners.set(k, id);
    }
  }

  // Shared endpoints alone miss walls that meet only geometrically: a wall
  // crossing another mid-span without a split node, or two collinear walls
  // overlapping along their length. Those stayed separate components, so each
  // was filled and hatched independently and the visible result was decided by
  // paint order — one band appearing to run under the other, with doubled
  // hatch where they overlapped. Bodies that share area are one mass.
  for (let i = 0; i < polygons.length; i++) {
    const pi = polygons[i];
    if (!pi?.quad?.length) continue;
    for (let j = i + 1; j < polygons.length; j++) {
      const pj = polygons[j];
      if (!pj?.quad?.length) continue;
      if (find(pi.wallId) === find(pj.wallId)) continue;
      if (quadsOverlap(pi.quad, pj.quad)) unite(pi.wallId, pj.wallId);
    }
  }

  const groups = new Map();
  polygons.forEach((poly, idx) => {
    const r = find(poly.wallId);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(idx);
  });
  return [...groups.values()].sort((a, b) => Math.min(...a) - Math.min(...b));
}

/**
 * Node-core fill polygons: for every centerline node where 3+ wall SEGMENTS
 * meet, the small central sliver bounded by the walls' end caps is not
 * covered by any quad. This returns, per such node, the convex hull of the
 * incident quads' near-node corners — a polygon that fills exactly that
 * central sliver. Used only as an INSIDE-union test (never as boundary
 * edges), so its exact orientation/ordering does not matter.
 */
function buildNodeCores(compPolys, walls, thr = 60) {
  const wallOf = new Map(walls.map((w) => [w.id, w]));
  const q = Math.max(1, thr);
  const nodeKey = (p) => `${Math.round(p.x / q)}_${Math.round(p.y / q)}`;

  const nodes = new Map(); // key -> { pos, polyIdxs:Set }
  compPolys.forEach((poly, idx) => {
    const w = wallOf.get(poly.wallId);
    const pts = w?.pts || [];
    const segIdx = poly.segIdx || 0;
    for (const end of [pts[segIdx], pts[segIdx + 1]]) {
      if (!end) continue;
      const k = nodeKey(end);
      if (!nodes.has(k)) nodes.set(k, { pos: end, polyIdxs: new Set() });
      nodes.get(k).polyIdxs.add(idx);
    }
  });

  const cores = [];
  for (const { pos, polyIdxs } of nodes.values()) {
    if (polyIdxs.size < 3) continue;
    // Only fill a core where the node center is an actual GAP. The center is
    // "covered" if it lies inside an incident quad OR on the shared edge
    // between two of them (e.g. a straight partition passing through a node
    // where a branch tees into its side: the two collinear partition
    // segments meet exactly at the node, so pointInLoop is false for each
    // individually even though the body is continuous). Testing the node
    // nudged a hair toward each incident quad's own centroid is robust to
    // that on-edge case: if the node sits on a quad's boundary, the nudge
    // lands inside it. A genuine multiway gap (a Y / acute fan) has the node
    // outside every quad in every such nudge, so it still gets a core.
    const covered = [...polyIdxs].some((idx) => {
      const quad = compPolys[idx].quad;
      if (pointInLoop(pos, quad)) return true;
      let cx = 0, cy = 0;
      for (const p of quad) { cx += p.x; cy += p.y; }
      cx /= quad.length; cy /= quad.length;
      const dx = cx - pos.x, dy = cy - pos.y, dl = Math.hypot(dx, dy) || 1;
      return pointInLoop({ x: pos.x + (dx / dl) * 2, y: pos.y + (dy / dl) * 2 }, quad);
    });
    if (covered) continue;
    // Each incident wall's two node-side corners ARE its two join points
    // (shared with its angular neighbors). Collect, dedupe, and order by
    // angle around the node: consecutive join points are exactly the walls'
    // end-cap edges, so this polygon's edges cancel them in the union.
    const corners = [];
    for (const idx of polyIdxs) {
      const quad = compPolys[idx].quad;
      const sorted = [...quad].sort((a, b) => dist(a, pos) - dist(b, pos));
      corners.push(sorted[0], sorted[1]);
    }
    const seen = new Set();
    const uniq = [];
    for (const c of corners) {
      const k = keyOf(c);
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(c);
    }
    if (uniq.length < 3) continue;
    uniq.sort((a, b) => Math.atan2(a.y - pos.y, a.x - pos.x) - Math.atan2(b.y - pos.y, b.x - pos.x));
    cores.push(uniq);
  }
  return cores;
}

// Supporting-line offset proximity (mm). Must be FINE enough that two parallel
// wall faces (as close as a thin partition's two sides, ~50mm apart) never
// share a line — otherwise parity would merge them and emit a spurious edge
// along the wall centerline — yet coarse enough to still group truly
// collinear edges (whose offsets are equal up to alignSharedQuadCorners'
// ~2.5mm corner snapping). 4mm satisfies both.
const LINE_Q = 4;

function canonicalEdgeDir(a, b) {
  let dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  // canonical sign: dx>0, or (dx≈0 and dy>0)
  if (dx < -1e-9 || (Math.abs(dx) < 1e-9 && dy < 0)) { dx = -dx; dy = -dy; }
  return { dx, dy, dirKey: `${Math.round(dx * 1e4)}_${Math.round(dy * 1e4)}` };
}

/**
 * Deterministic local origin for relative line offsets.
 * Lexicographically minimum quantized physical point — stable under wall-array
 * reorder, endpoint reversal, and plan translation (not first array element).
 */
function deterministicLocalOrigin(polys = []) {
  let best = null;
  let bestQx = Infinity;
  let bestQy = Infinity;
  for (const poly of polys) {
    for (const p of poly || []) {
      if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) continue;
      const qx = Math.round(p.x * KEY_SCALE);
      const qy = Math.round(p.y * KEY_SCALE);
      if (qx < bestQx || (qx === bestQx && qy < bestQy)) {
        bestQx = qx;
        bestQy = qy;
        best = p;
      }
    }
  }
  return best ? { x: best.x, y: best.y } : { x: 0, y: 0 };
}

/**
 * Surviving boundary edges of the union of wall quads + node cores.
 *
 * Cancellation is done per supporting line via 1D parity coverage: every
 * edge is projected to an interval on its line and each span's coverage
 * COUNT (how many polygon edges lie over it) is computed. A span is boundary
 * iff its coverage is ODD. This cancels not only exactly-shared edges (an
 * L-corner's coincident end caps, a node core's edges vs. wall caps) but
 * also COLLINEAR-OVERLAPPING ones — e.g. a wall that tees into the middle of
 * a longer wall's face: the overlapping sub-span reaches coverage 2 (even →
 * dropped, opening the host face and removing the branch cap) while the rest
 * of the host face stays coverage 1 (odd → kept). Orientation-independent.
 *
 * Line identity uses a deterministic local origin + proximity clustering of
 * relative offsets (not Math.round of a world-origin line constant). Absolute
 * bucketing of dx*y-dy*x re-partitioned identical geometry under large plan
 * translations (Phase 2F1-M2 metrology off-origin case).
 *
 * @returns {Array<{a:{x,y}, b:{x,y}}>} undirected boundary edges
 */
export function extractWallMassBoundaryEdges(quads = [], cores = []) {
  const polys = [...quads, ...cores].filter((p) => p && p.length >= 3);
  const origin = deterministicLocalOrigin(polys);

  // Group by direction, then cluster by relative offset proximity (LINE_Q).
  // Relative offsets are translation-invariant; proximity avoids world-origin
  // bucket boundaries and keeps cancellation stable at large coordinates.
  const byDirection = new Map();
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if (dist(a, b) < EPS) continue;
      const { dx, dy, dirKey } = canonicalEdgeDir(a, b);
      const offset = dx * (a.y - origin.y) - dy * (a.x - origin.x);
      if (!byDirection.has(dirKey)) byDirection.set(dirKey, []);
      byDirection.get(dirKey).push({ a, b, dx, dy, offset });
    }
  }

  const lines = new Map(); // lineKey -> { dx, dy, anchor:{x,y}, spans:[{t0,t1}] }
  let lineSeq = 0;
  for (const [dirKey, items] of byDirection) {
    items.sort((p, q) => (
      p.offset - q.offset
      || p.a.x - q.a.x
      || p.a.y - q.a.y
      || p.b.x - q.b.x
      || p.b.y - q.b.y
    ));
    let currentKey = null;
    let currentOffset = null;
    for (const it of items) {
      if (currentKey == null || Math.abs(it.offset - currentOffset) > LINE_Q) {
        currentKey = `${dirKey}_${lineSeq++}`;
        currentOffset = it.offset;
        lines.set(currentKey, {
          dx: it.dx,
          dy: it.dy,
          anchor: { x: it.a.x, y: it.a.y },
          spans: [],
        });
      }
      const L = lines.get(currentKey);
      const ta = L.dx * (it.a.x - L.anchor.x) + L.dy * (it.a.y - L.anchor.y);
      const tb = L.dx * (it.b.x - L.anchor.x) + L.dy * (it.b.y - L.anchor.y);
      L.spans.push({ t0: Math.min(ta, tb), t1: Math.max(ta, tb) });
    }
  }

  const out = [];
  for (const L of lines.values()) {
    // sweep coverage; emit maximal odd-coverage spans
    const events = [];
    for (const s of L.spans) {
      events.push({ t: s.t0, d: +1 });
      events.push({ t: s.t1, d: -1 });
    }
    events.sort((a, b) => a.t - b.t || b.d - a.d);
    let cover = 0;
    let segStart = null;
    for (let i = 0; i < events.length; i++) {
      const before = cover;
      cover += events[i].d;
      // collapse simultaneous events at the same t
      while (i + 1 < events.length && Math.abs(events[i + 1].t - events[i].t) < 1e-6) {
        i++;
        cover += events[i].d;
      }
      const t = events[i].t;
      const wasOdd = before % 2 !== 0;
      const isOdd = cover % 2 !== 0;
      if (!wasOdd && isOdd) segStart = t;
      else if (wasOdd && !isOdd && segStart != null) {
        if (t - segStart > EPS) {
          out.push({
            a: { x: L.anchor.x + L.dx * segStart, y: L.anchor.y + L.dy * segStart },
            b: { x: L.anchor.x + L.dx * t, y: L.anchor.y + L.dy * t },
          });
        }
        segStart = null;
      }
    }
  }
  // Parity only cancels collinear coincidence. Overlapping bodies also need
  // their buried spans removed, or the crossing shows as stacked polygons.
  return clipEdgesInsidePolygons(out, polys);
}

/**
 * Trace the faces of the planar graph formed by the undirected boundary
 * edges (directed half-edge face tracing). Correctly separates the outer
 * boundary from interior holes even at degree-4 vertices (a partition teeing
 * into an outer wall), where a naive next-neighbor walk would self-cross.
 * Returns every bounded face loop; the unbounded (outer-of-everything) face
 * is dropped. For a two-room plan this yields the two room-hole loops plus
 * the mass's own outer loop.
 */
export function stitchLoops(edges = []) {
  const ptByKey = new Map();
  const halves = []; // {u, v, key} directed
  for (const e of edges) {
    const ka = keyOf(e.a), kb = keyOf(e.b);
    if (ka === kb) continue;
    ptByKey.set(ka, e.a); ptByKey.set(kb, e.b);
    halves.push({ u: ka, v: kb });
    halves.push({ u: kb, v: ka });
  }
  // outgoing half-edges per vertex, sorted by angle
  const outByVertex = new Map();
  for (const h of halves) {
    const pu = ptByKey.get(h.u), pv = ptByKey.get(h.v);
    h.angle = Math.atan2(pv.y - pu.y, pv.x - pu.x);
    if (!outByVertex.has(h.u)) outByVertex.set(h.u, []);
    outByVertex.get(h.u).push(h);
  }
  for (const list of outByVertex.values()) list.sort((a, b) => a.angle - b.angle);
  const idOf = (h) => `${h.u}->${h.v}`;

  // next half-edge in a face = the one after the twin, clockwise around v
  const twinAngle = (h) => Math.atan2(ptByKey.get(h.u).y - ptByKey.get(h.v).y, ptByKey.get(h.u).x - ptByKey.get(h.v).x);
  const nextHalf = (h) => {
    const list = outByVertex.get(h.v) || [];
    if (!list.length) return null;
    const ta = twinAngle(h);
    // pick the outgoing edge whose angle is the next one clockwise from ta
    let best = null, bestDelta = Infinity;
    for (const cand of list) {
      let d = ta - cand.angle;
      while (d <= 1e-9) d += 2 * Math.PI;
      if (d < bestDelta) { bestDelta = d; best = cand; }
    }
    return best;
  };

  const used = new Set();
  const loops = [];
  for (const start of halves) {
    if (used.has(idOf(start))) continue;
    const loop = [];
    let cur = start;
    let guard = 0;
    while (cur && !used.has(idOf(cur)) && guard++ < halves.length + 4) {
      used.add(idOf(cur));
      loop.push(ptByKey.get(cur.u));
      cur = nextHalf(cur);
      if (cur && cur.u === start.u && cur.v === start.v) break;
    }
    if (loop.length >= 3) {
      const clean = dedupeConsecutive(loop);
      if (clean.length >= 3) loops.push(clean);
    }
  }
  return loops;
}

function dedupeConsecutive(loop) {
  const out = [];
  for (const p of loop) {
    const last = out[out.length - 1];
    if (!last || dist(last, p) > EPS) out.push(p);
  }
  if (out.length > 1 && dist(out[0], out[out.length - 1]) <= EPS) out.pop();
  return out;
}

/** Canonical key for a closed loop modulo rotation and reversal. */
function canonicalLoopKey(loop = []) {
  if (!loop.length) return "";
  const pts = loop.map((p) => ({
    x: Math.round(p.x * KEY_SCALE) / KEY_SCALE,
    y: Math.round(p.y * KEY_SCALE) / KEY_SCALE,
  }));
  let best = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].x < pts[best].x || (pts[i].x === pts[best].x && pts[i].y < pts[best].y)) {
      best = i;
    }
  }
  const rot = [...pts.slice(best), ...pts.slice(0, best)];
  const fwd = rot.map((p) => `${p.x},${p.y}`).join(">");
  const rev = [rot[0], ...rot.slice(1).reverse()].map((p) => `${p.x},${p.y}`).join(">");
  return fwd <= rev ? fwd : rev;
}

/**
 * Classify traced faces into outer boundary vs. holes purely by containment.
 * Deduplicate opposite windings first — equal-|area| twins otherwise flip
 * hole/outer under plan translation (Phase 2F1-M2).
 */
export function classifyOuterAndHoleLoops(loops = []) {
  const seen = new Set();
  const meta = [];
  for (const loop of loops) {
    if (!loop || loop.length < 3) continue;
    const area = Math.abs(signedArea(loop));
    if (area <= 1) continue;
    const key = canonicalLoopKey(loop);
    if (seen.has(key)) continue;
    seen.add(key);
    meta.push({ loop, area, centroid: loopCentroid(loop) });
  }
  const outer = [];
  const holes = [];
  for (const m of meta) {
    const container = meta.find((o) => o !== m && o.area > m.area && pointInLoop(m.centroid, o.loop));
    if (container) holes.push(m.loop);
    else outer.push(m.loop);
  }
  return { outer, holes };
}

/**
 * Robust count of enclosed empty regions ("holes" / rooms) of a wall mass:
 * coarse grid flood-fill of the mass bounding box. Cells covered by any fill
 * polygon are wall; contiguous uncovered regions that do NOT touch the bbox
 * border are enclosed holes. Chamfer/miter artifacts in the boundary loops
 * do not affect this areal test.
 */
export function countMassHoles(fillPolygons = [], grid = 60) {
  const pts = fillPolygons.flat();
  if (pts.length < 3) return 0;
  const minX = Math.min(...pts.map((p) => p.x)) - grid;
  const minY = Math.min(...pts.map((p) => p.y)) - grid;
  const maxX = Math.max(...pts.map((p) => p.x)) + grid;
  const maxY = Math.max(...pts.map((p) => p.y)) + grid;
  const nx = Math.min(400, Math.max(4, Math.ceil((maxX - minX) / grid)));
  const ny = Math.min(400, Math.max(4, Math.ceil((maxY - minY) / grid)));
  const cx = (i) => minX + (i + 0.5) * (maxX - minX) / nx;
  const cy = (j) => minY + (j + 0.5) * (maxY - minY) / ny;
  const wall = (i, j) => fillPolygons.some((poly) => pointInLoop({ x: cx(i), y: cy(j) }, poly));
  const state = new Int8Array(nx * ny); // 0 empty, 1 wall, 2 visited-empty
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (wall(i, j)) state[j * nx + i] = 1;
  const flood = (si, sj) => {
    let touchesBorder = false;
    const stack = [[si, sj]];
    state[sj * nx + si] = 2;
    while (stack.length) {
      const [i, j] = stack.pop();
      if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) touchesBorder = true;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
        if (state[nj * nx + ni] === 0) { state[nj * nx + ni] = 2; stack.push([ni, nj]); }
      }
    }
    return touchesBorder;
  };
  let holes = 0;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (state[j * nx + i] === 0) { if (!flood(i, j)) holes += 1; }
  }
  return holes;
}

function loopCentroid(loop) {
  let x = 0, y = 0;
  for (const p of loop) { x += p.x; y += p.y; }
  return { x: x / loop.length, y: y / loop.length };
}

function round(v) { return Math.round(v * 100) / 100; }
function loopToPath(loop) {
  if (!loop?.length) return "";
  return `M ${loop.map((p) => `${round(p.x)} ${round(p.y)}`).join(" L ")} Z`;
}

/**
 * Build the render description for every connected wall mass in a plan.
 *
 * Rendering strategy (robust, no fragile winding logic):
 *  - FILL: every wall quad + node-core fill polygon, filled with the same
 *    hatch, no stroke. Since quads don't overlap and cores fill the multiway
 *    node centers, the hatch reads as one seamless mass. Room interiors stay
 *    unfilled automatically (no polygon covers them).
 *  - OUTLINE: the surviving boundary edges only. Interior seams between
 *    adjacent walls / cores cancel and are never drawn.
 * Loops (outer/holes) are also stitched, for area/hole metrics and tests.
 *
 * @param {Array<{wallId, segIdx, quad}>} polygons  wall segment quads (aligned)
 * @param {Array<{id, pts}>} walls  expanded centerline walls (for topology)
 */
function shiftPoint(p, ox, oy) {
  return { x: p.x - ox, y: p.y - oy };
}
function unshiftPoint(p, ox, oy) {
  return { x: p.x + ox, y: p.y + oy };
}
function shiftPoly(poly, ox, oy) {
  return (poly || []).map((p) => shiftPoint(p, ox, oy));
}
function unshiftPoly(poly, ox, oy) {
  return (poly || []).map((p) => unshiftPoint(p, ox, oy));
}
function unshiftEdge(e, ox, oy) {
  return { a: unshiftPoint(e.a, ox, oy), b: unshiftPoint(e.b, ox, oy) };
}

export function buildWallMassGeometry(polygons = [], walls = []) {
  const components = buildWallConnectedComponents(polygons, walls);
  const masses = [];
  for (const idxs of components) {
    const compPolys = idxs.map((i) => polygons[i]).filter((p) => p?.quad?.length >= 3);
    if (!compPolys.length) continue;
    const cores = buildNodeCores(compPolys, walls);
    const quads = compPolys.map((p) => p.quad);
    const fillPolygons = [...quads, ...cores];
    // Run extract + stitch in a deterministic local frame so vertex keys,
    // line offsets, and polygon tests cannot drift with world magnitude
    // (Phase 2F1-M2). Origin = lex-min quantized point of this component.
    const origin = deterministicLocalOrigin(fillPolygons);
    const ox = origin.x;
    const oy = origin.y;
    const localQuads = quads.map((q) => shiftPoly(q, ox, oy));
    const localCores = cores.map((c) => shiftPoly(c, ox, oy));
    const localEdges = extractWallMassBoundaryEdges(localQuads, localCores);
    const localLoops = stitchLoops(localEdges);
    const classified = classifyOuterAndHoleLoops(localLoops);
    const boundaryEdges = localEdges.map((e) => unshiftEdge(e, ox, oy));
    const outer = classified.outer.map((l) => unshiftPoly(l, ox, oy));
    const holes = classified.holes.map((l) => unshiftPoly(l, ox, oy));
    const sourceWallIds = [...new Set(compPolys.map((p) => p.wallId))].sort();
    masses.push({
      sourceWallIds,
      fillPolygons,
      fillPath: fillPolygons.map(loopToPath).join(" "),
      boundaryEdges,
      outerLoops: outer,
      holeLoops: holes,
      holeCount: countMassHoles(fillPolygons),
      selfIntersections: countSelfIntersections([...outer, ...holes]),
    });
  }
  return masses;
}

function countSelfIntersections(loops) {
  let count = 0;
  for (const loop of loops) {
    const n = loop.length;
    for (let i = 0; i < n; i++) {
      const a = loop[i], b = loop[(i + 1) % n];
      for (let j = i + 1; j < n; j++) {
        if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
        const c = loop[j], d = loop[(j + 1) % n];
        if (segmentsProperlyIntersect(a, b, c, d)) count++;
      }
    }
  }
  return count;
}

function segmentsProperlyIntersect(a, b, c, d) {
  const o = (p, q, r) => {
    const v = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    return Math.abs(v) < EPS ? 0 : Math.sign(v);
  };
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}
