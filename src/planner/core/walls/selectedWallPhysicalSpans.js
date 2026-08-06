/**
 * PHASE 2F1-LIVE4 — physical face spans for selected / live wall dimensions.
 *
 * Anchors come from joined wallGeometry quads (miters / host-face intersections),
 * never from shared topology nodes or adjoining-wall centrelines.
 */
import { resolvePlanWalls } from "../../wallNetwork.js";
import { wallGeometryMap } from "../../buildWallGeometry.js";
import {
  buildWallFaceReferences,
  applyJoinedQuadToReference,
  anchorsOnCenterline,
  referenceLength,
  FACE_REF_KINDS,
} from "./wallFaceReferences.js";
import { resolveLogicalWallChain } from "./logicalWallChain.js";

const FACE_EQ_EPS_MM = 0.5;
const CENTERLINE_EPS_MM = 4;
// PHASE 2F1-M2 — a STRAIGHT open chain has its centroid on its own centreline,
// so both physical faces are exactly equidistant from it. That comparison is a
// true mathematical tie; at 1.2 km from the origin the residue is pure
// floating-point cancellation (~1e-10 mm) and it decided the exterior face,
// which made the same geometry produce mirrored dimensions after translation.
// Anything below a nanometre is a tie, not a measurement.
const CHAIN_TIE_EPS_MM = 1e-6;

/**
 * +1 when the wall's stored a→b direction is already the canonical one
 * (+x, then +y), -1 when it is reversed. Uses exact zero tests: translating a
 * plan never changes a coordinate DIFFERENCE from zero to non-zero, so this is
 * stable under translation, wall reorder and endpoint reversal alike.
 */
export function canonicalDirSign(a, b) {
  const dx = b.x - a.x;
  if (dx !== 0) return dx > 0 ? 1 : -1;
  const dy = b.y - a.y;
  if (dy !== 0) return dy > 0 ? 1 : -1;
  return 1;
}

function dist(a, b) {
  if (!a || !b) return 0;
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function quadsForWall(geom, wall) {
  if (!geom || !wall?.id) return [];
  if ((wall.pts || []).length === 2) {
    return (geom.polygons || [])
      .filter((p) => p.wallId === wall.id)
      .map((p) => p.quad)
      .filter(Boolean);
  }
  const out = [];
  for (let i = 1; i < (wall.pts || []).length; i++) {
    const q = geom.quads?.get(`${wall.id}-${i - 1}`);
    if (q) out.push(q);
  }
  return out;
}

function spanFromJoined(ref, quads, preferOuter, sideKey) {
  if (!ref) return null;
  const joined = applyJoinedQuadToReference(ref, quads, preferOuter);
  const a = joined.joinedStart || joined.start;
  const b = joined.joinedEnd || joined.end;
  if (!a || !b) return null;
  const lengthMm = referenceLength(joined) ?? dist(a, b);
  if (!(lengthMm > 0)) return null;
  return {
    side: sideKey,
    kind: preferOuter ? FACE_REF_KINDS.JOINED_OUTER_FACE : FACE_REF_KINDS.JOINED_ROOM_FACE,
    a: { x: a.x, y: a.y },
    b: { x: b.x, y: b.y },
    lengthMm,
    // PHASE 2F1-M2 — the quad label ("inner"/"outer") this physical face
    // actually resolved to. That labelling flips with the plan's position
    // relative to the fixed room centre, so it must be carried, not assumed.
    quadFace: joined.joinedQuadFace ?? (preferOuter ? "outer" : "inner"),
    reference: joined,
  };
}

function spansFromWallAndQuads(wall, quads, roomBox, meta = {}) {
  const refs = buildWallFaceReferences(wall, roomBox);
  if (!refs) return null;

  // preferOuter false → inner/faceA corners; true → outer/faceB corners
  const faceA = spanFromJoined(refs.faceA, quads, false, "A")
    || {
      side: "A",
      kind: FACE_REF_KINDS.FACE_A,
      a: { ...refs.faceA.start },
      b: { ...refs.faceA.end },
      lengthMm: dist(refs.faceA.start, refs.faceA.end),
      reference: refs.faceA,
    };
  const faceB = spanFromJoined(refs.faceB, quads, true, "B")
    || {
      side: "B",
      kind: FACE_REF_KINDS.FACE_B,
      a: { ...refs.faceB.start },
      b: { ...refs.faceB.end },
      lengthMm: dist(refs.faceB.start, refs.faceB.end),
      reference: refs.faceB,
    };

  const centerline = {
    a: { ...refs.centerline.start },
    b: { ...refs.centerline.end },
    lengthMm: dist(refs.centerline.start, refs.centerline.end),
  };

  const onClA = anchorsOnCenterline(faceA.a, faceA.b, refs.centerline, CENTERLINE_EPS_MM);
  const onClB = anchorsOnCenterline(faceB.a, faceB.b, refs.centerline, CENTERLINE_EPS_MM);
  const facesDiffer = Math.abs(faceA.lengthMm - faceB.lengthMm) > FACE_EQ_EPS_MM;

  return {
    wallId: meta.wallId ?? wall.id,
    logicalId: meta.logicalId ?? null,
    chainWallIds: meta.chainWallIds ?? [wall.id],
    segmentCount: meta.segmentCount ?? 1,
    centerline,
    faceA,
    faceB,
    facesDiffer,
    anchorsOnCenterline: !!(onClA || onClB),
    quadsUsed: quads.length,
  };
}

/**
 * Both physical faces of a wall with joined/mitered endpoints.
 * faceA = +left (inner convention), faceB = −left (outer convention).
 *
 * Topology-segment scope only. For the user-visible logical host (T-split),
 * use resolveLogicalSelectedWallPhysicalSpans.
 */
export function resolveSelectedWallPhysicalSpans(plan, wallId, { room = null } = {}) {
  if (!plan || !wallId) return null;
  const walls = resolvePlanWalls(plan);
  const wall = walls.find((w) => w.id === wallId);
  if (!wall?.pts || wall.pts.length < 2) return null;

  const roomBox = room || plan.room || null;
  const geom = wallGeometryMap(walls, roomBox);
  const quads = quadsForWall(geom, wall);
  return spansFromWallAndQuads(wall, quads, roomBox, {
    wallId,
    logicalId: wall.id,
    chainWallIds: [wall.id],
    segmentCount: 1,
  });
}

/**
 * LIVE4.3 — physical faces of the HIGHLIGHTED logical wall.
 *
 * A T branch may split the host into topology segments, but selection still
 * highlights the whole logical chain. Measurement anchors must therefore use
 * the outer endpoints of that chain, never an internal T node, unless the
 * chain is a single segment (T genuinely is an endpoint).
 */
export function resolveLogicalSelectedWallPhysicalSpans(plan, wallId, { room = null } = {}) {
  if (!plan || !wallId) return null;
  const chain = resolveLogicalWallChain(plan, wallId);
  if (!chain?.ok || chain.segmentCount <= 1 || !chain.a || !chain.b) {
    return resolveSelectedWallPhysicalSpans(plan, wallId, { room });
  }

  const walls = resolvePlanWalls(plan);
  const seed = walls.find((w) => w.id === wallId)
    || walls.find((w) => chain.wallIds.includes(w.id));
  if (!seed) return resolveSelectedWallPhysicalSpans(plan, wallId, { room });

  const synthetic = {
    ...seed,
    id: chain.logicalId || seed.id,
    a: chain.outerNodeIds[0],
    b: chain.outerNodeIds[1],
    pts: [
      { x: chain.a.x, y: chain.a.y },
      { x: chain.b.x, y: chain.b.y },
    ],
  };
  const roomBox = room || plan.room || null;
  const geom = wallGeometryMap(walls, roomBox);
  const quads = [];
  for (const id of chain.wallIds) {
    const w = walls.find((x) => x.id === id);
    if (w) quads.push(...quadsForWall(geom, w));
  }
  const resolved = spansFromWallAndQuads(synthetic, quads, roomBox, {
    wallId,
    logicalId: chain.logicalId,
    chainWallIds: [...chain.wallIds],
    segmentCount: chain.segmentCount,
  });
  if (!resolved) return resolveSelectedWallPhysicalSpans(plan, wallId, { room });
  // Prefer chain centreline length (sum of segments) when synthetic equals it.
  resolved.centerline = {
    a: { x: chain.a.x, y: chain.a.y },
    b: { x: chain.b.x, y: chain.b.y },
    lengthMm: chain.totalLengthMm > 0
      ? chain.totalLengthMm
      : dist(chain.a, chain.b),
  };
  return resolved;
}

/**
 * Compare selected / preview / finalized physical spans for one wall.
 * Finalized dims: wall_length records whose reference.wallId matches.
 */
export function compareWallPhysicalSpans({ selected, preview, finalizedDims = [] } = {}) {
  const pick = (span) => (span ? {
    a: span.a || span.faceA?.a,
    b: span.b || span.faceA?.b,
    lengthMm: span.lengthMm ?? span.faceA?.lengthMm,
  } : null);

  const selA = selected?.faceA || null;
  const prevA = preview?.faceA || null;
  const fin = (finalizedDims || []).find((d) => {
    const wid = d.wallId || d.reference?.wallId;
    return wid === selected?.wallId || String(d.id || "").includes(`-${selected?.wallId}-`);
  });

  const near = (p, q, tol = 2) => p && q && Math.hypot(p.x - q.x, p.y - q.y) <= tol;
  const same = (s1, s2) => {
    if (!s1 || !s2) return false;
    return (near(s1.a, s2.a) && near(s1.b, s2.b))
      || (near(s1.a, s2.b) && near(s1.b, s2.a));
  };

  return {
    selectedFaceA: selA,
    previewFaceA: prevA,
    finalized: fin ? { a: fin.p1, b: fin.p2, lengthMm: fin.measurementValue } : null,
    selectedMatchesPreview: same(selA, prevA),
    selectedMatchesFinalized: fin ? same(selA, { a: fin.p1, b: fin.p2 }) : null,
    lengthsAgree: selA && prevA
      ? Math.abs(selA.lengthMm - prevA.lengthMm) <= FACE_EQ_EPS_MM
      : null,
  };
}

/**
 * Open-chain exterior offset sign for a wall segment.
 * Walks a simple path; keeps exterior on the LEFT of travel for a right-turn
 * elbow (RemPlanner L: horizontal above, vertical right).
 *
 * Returns +1 (along left normal) or −1 (along right / −left normal) for SegDim
 * offsetSide, and a signed offsetMm hint for generateWallDimensions.
 */
export function openChainExteriorOffsetForWall(plan, wallId) {
  const walls = resolvePlanWalls(plan);
  const wall = walls.find((w) => w.id === wallId);
  if (!wall?.pts || wall.pts.length < 2) return null;

  const byNode = new Map();
  for (const w of walls) {
    if (!w?.a || !w?.b) continue;
    for (const n of [w.a, w.b]) {
      if (!byNode.has(n)) byNode.set(n, []);
      byNode.get(n).push(w);
    }
  }

  // Build undirected adjacency among degree-≤2 nodes (open chain / path).
  const deg = (n) => (byNode.get(n) || []).length;
  const neighbors = (w) => {
    const out = [];
    for (const n of [w.a, w.b]) {
      for (const o of byNode.get(n) || []) {
        if (o.id !== w.id) out.push({ wall: o, via: n });
      }
    }
    return out;
  };

  // Collect connected component of degree≤2 walls containing wallId.
  const component = new Set();
  const stack = [wall];
  while (stack.length) {
    const cur = stack.pop();
    if (component.has(cur.id)) continue;
    // Allow T-host walls only if this wall itself is a simple open arm.
    component.add(cur.id);
    for (const { wall: o } of neighbors(cur)) {
      if (component.has(o.id)) continue;
      // Stay on path-like links: both endpoints of the edge have degree ≤2
      // OR this is a two-wall L (one shared node of any degree ≤3).
      const shared = [cur.a, cur.b].find((n) => n === o.a || n === o.b);
      if (!shared) continue;
      // LIVE4: only walk true open paths (degree ≤2). Degree-3 T junctions
      // previously pulled the whole plan into the component and put the L
      // dimension inside the elbow via a polluted centroid.
      if (deg(shared) <= 2 && component.size < 8) stack.push(o);
    }
  }

  if (component.size < 2) {
    // Free-standing: prefer "above / left of axis" (offsetSide -1 with +offset
    // in generateWallDimensions uses left normal).
    return { offsetSide: -1, offsetMm: 150, reason: "free" };
  }

  // Order a simple polyline walk starting at a degree-1 endpoint if present.
  const wallMap = new Map(walls.filter((w) => component.has(w.id)).map((w) => [w.id, w]));
  let startId = wallId;
  let hasLeaf = false;
  for (const id of component) {
    const w = wallMap.get(id);
    if (deg(w.a) === 1 || deg(w.b) === 1) {
      startId = id;
      hasLeaf = true;
      break;
    }
  }
  // Closed loops (rooms) are not open chains — keep room-face metrology.
  if (!hasLeaf) {
    return { offsetSide: -1, offsetMm: null, reason: "closed_loop", chainWallIds: [...component] };
  }

  const ordered = [];
  const visited = new Set();
  let cur = wallMap.get(startId);
  let prevNode = deg(cur.a) === 1 ? cur.a : (deg(cur.b) === 1 ? cur.b : cur.a);
  // Orient so we leave prevNode toward the other end.
  while (cur && !visited.has(cur.id)) {
    visited.add(cur.id);
    const from = prevNode === cur.a ? cur.a : (prevNode === cur.b ? cur.b : cur.a);
    const to = from === cur.a ? cur.b : cur.a;
    const pa = plan.nodes?.[from] || cur.pts?.[from === cur.a ? 0 : cur.pts.length - 1];
    const pb = plan.nodes?.[to] || cur.pts?.[to === cur.b ? cur.pts.length - 1 : 0];
    // Prefer resolved pts
    const pts = cur.pts;
    const a = pts[0];
    const b = pts[pts.length - 1];
    const forward = dist(a, pb) + dist(b, pa) < dist(a, pa) + dist(b, pb)
      ? { a, b }
      : { a: b, b: a };
    // Simpler: match node ids
    let sa = a;
    let sb = b;
    if (cur.a === from) { sa = a; sb = b; }
    else if (cur.b === from) { sa = b; sb = a; }
    else {
      sa = forward.a;
      sb = forward.b;
    }
    ordered.push({ id: cur.id, a: sa, b: sb });
    prevNode = to;
    const next = (byNode.get(to) || []).find((w) => !visited.has(w.id) && component.has(w.id));
    cur = next || null;
  }

  // Chain centroid = inside the elbow for a simple L. Exterior is the side
  // of each segment that points AWAY from the centroid. Convert that world
  // half-plane into generateWallDimensions offset using the wall's stored
  // pts direction (not the walk orientation), so reverse walks stay stable.
  let cx = 0;
  let cy = 0;
  for (const o of ordered) {
    cx += (o.a.x + o.b.x) / 2;
    cy += (o.a.y + o.b.y) / 2;
  }
  cx /= ordered.length || 1;
  cy /= ordered.length || 1;

  const canon = wall.pts;
  const ca = canon[0];
  const cb = canon[canon.length - 1];
  const mid = { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 };
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len; // left normal of stored a→b
  const ny = dx / len;
  const toCenter = { x: cx - mid.x, y: cy - mid.y };
  const towardCenter = toCenter.x * nx + toCenter.y * ny;
  // offset > 0 follows +left normal in generateWallDimensions.
  // Choose the side opposite the chain centroid (outside the elbow).
  // PHASE 2F1-M2 — a straight chain puts its centroid ON this wall's line, so
  // towardCenter is an exact zero whose floating-point residue must not decide
  // the lane. Fall back to the canonical undirected direction, matching the
  // exterior-face tie-break in openChainExteriorFaceSpan.
  const offsetMm = Math.abs(towardCenter) <= CHAIN_TIE_EPS_MM
    ? (canonicalDirSign(ca, cb) > 0 ? 150 : -150)
    : (towardCenter > 0 ? -150 : 150);

  return {
    offsetSide: offsetMm > 0 ? -1 : 1,
    offsetMm,
    reason: "open_chain",
    turnSum: null,
    exteriorOnLeft: offsetMm > 0,
    chainWallIds: ordered.map((o) => o.id),
    chainCentroid: { x: cx, y: cy },
  };
}

/**
 * LIVE4.1 — for open chains, pick the physical face whose mid is farther from
 * the chain centroid (true exterior), with joined anchors + that face length.
 * Returns null when the wall is not part of an open_chain.
 */
export function openChainExteriorFaceSpan(plan, wallId) {
  const open = openChainExteriorOffsetForWall(plan, wallId);
  if (!open || open.reason !== "open_chain" || !open.chainCentroid) return null;
  const spans = resolveSelectedWallPhysicalSpans(plan, wallId, {
    room: plan?.room || null,
  });
  if (!spans?.faceA || !spans?.faceB) return null;

  const midOf = (face) => ({
    x: (face.a.x + face.b.x) / 2,
    y: (face.a.y + face.b.y) / 2,
  });
  const c = open.chainCentroid;
  const dA = dist(midOf(spans.faceA), c);
  const dB = dist(midOf(spans.faceB), c);
  // PHASE 2F1-M2 — resolve an exact tie (straight chain) by the canonical
  // undirected wall direction instead of by floating-point residue.
  const pts = spans.centerline;
  const exteriorFace = Math.abs(dA - dB) <= CHAIN_TIE_EPS_MM
    ? (canonicalDirSign(pts.a, pts.b) > 0 ? spans.faceA : spans.faceB)
    : (dA > dB ? spans.faceA : spans.faceB);
  const sideKey = exteriorFace === spans.faceA ? "A" : "B";
  // PHASE 2F1-M2 — generateWallDimensions re-resolves chosenFace against the
  // wall's quad corners, whose "inner"/"outer" labels are assigned relative to
  // the fixed room centre and therefore swap when the plan is translated past
  // it. faceA is +left by construction, but +left is NOT always the quad's
  // "inner" pair, so the old `sideKey === "A" ? "inner" : "outer"` mapping
  // pointed at the opposite physical face off-origin. Use the label this face
  // actually resolved to.
  const chosenFace = exteriorFace.quadFace ?? (sideKey === "A" ? "inner" : "outer");

  return {
    ...open,
    face: exteriorFace,
    sideKey,
    chosenFace,
    lengthMm: exteriorFace.lengthMm,
    a: exteriorFace.a,
    b: exteriorFace.b,
  };
}

export { FACE_EQ_EPS_MM };
