import { snap } from "./catalog.js";

const SNAP_DIST = 80;

export function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function near(a, b, thr = SNAP_DIST) {
  return dist(a, b) <= thr;
}

/** Все узлы стен (концы сегментов). */
export function collectWallNodes(walls, room = null) {
  const nodes = [];
  walls.forEach((w) => w.pts.forEach((p) => nodes.push({ ...p, wallId: w.id })));
  if (room) {
    const t = room.wallThk / 2;
    nodes.push(
      { x: t, y: t }, { x: room.w - t, y: t },
      { x: room.w - t, y: room.h - t }, { x: t, y: room.h - t },
    );
  }
  return nodes;
}

/** Магнит к узлам стен и сетке. */
export function snapWallPoint(pt, walls, room, zoom, snapOn, gridStep = 50) {
  const thr = SNAP_DIST / Math.max(zoom, 0.05);
  let best = null;
  const trySnap = (target, kind = "node") => {
    const d = dist(pt, target);
    if (d <= thr && (!best || d < best.d)) best = { x: target.x, y: target.y, d, kind };
  };

  if (snapOn) {
    walls.forEach((w) => w.pts.forEach((p) => trySnap(p)));
    if (room) {
      const t = room.wallThk / 2;
      [
        { x: t, y: t }, { x: room.w - t, y: t },
        { x: room.w - t, y: room.h - t }, { x: t, y: room.h - t },
        { x: room.w / 2, y: t }, { x: room.w / 2, y: room.h - t },
        { x: t, y: room.h / 2 }, { x: room.w - t, y: room.h / 2 },
      ].forEach((p) => trySnap(p, "corner"));
    }
    const gx = snap(pt.x, gridStep, true);
    const gy = snap(pt.y, gridStep, true);
    trySnap({ x: gx, y: gy }, "grid");
  }

  return best ? { x: best.x, y: best.y, snapped: true, kind: best.kind } : { ...pt, snapped: false };
}

/** Точка на расстоянии len от from в направлении to (ортогонально если axis). */
export function pointAtLength(from, to, len, axis = null) {
  let dx = to.x - from.x;
  let dy = to.y - from.y;
  if (axis === "h") { dy = 0; dx = dx >= 0 ? 1 : -1; }
  else if (axis === "v") { dx = 0; dy = dy >= 0 ? 1 : -1; }
  const d = Math.hypot(dx, dy);
  if (d < 1) return { x: from.x + len, y: from.y };
  return { x: from.x + (dx / d) * len, y: from.y + (dy / d) * len };
}

export function wallSegments(walls) {
  const segs = [];
  walls.forEach((w) => {
    for (let i = 1; i < w.pts.length; i++) {
      segs.push({ a: w.pts[i - 1], b: w.pts[i], wallId: w.id, thk: w.thk });
    }
  });
  return segs;
}

function cross(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function onSegment(a, b, c) {
  return (
    Math.min(a.x, b.x) - 1 <= c.x && c.x <= Math.max(a.x, b.x) + 1 &&
    Math.min(a.y, b.y) - 1 <= c.y && c.y <= Math.max(a.y, b.y) + 1
  );
}

export function segmentsIntersectProper(a, b, c, d) {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (d1 === 0 && onSegment(c, d, a)) return true;
  if (d2 === 0 && onSegment(c, d, b)) return true;
  if (d3 === 0 && onSegment(a, b, c)) return true;
  if (d4 === 0 && onSegment(a, b, d)) return true;
  return false;
}

/** Пересечение стен (не в общих концах). */
export function findWallIntersections(walls) {
  const segs = wallSegments(walls);
  const hits = [];
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s1 = segs[i];
      const s2 = segs[j];
      if (s1.wallId === s2.wallId) continue;
      const shared =
        near(s1.a, s2.a, 5) || near(s1.a, s2.b, 5) ||
        near(s1.b, s2.a, 5) || near(s1.b, s2.b, 5);
      if (shared) continue;
      if (segmentsIntersectProper(s1.a, s1.b, s2.a, s2.b)) {
        hits.push({ id: `wx-${s1.wallId}-${s2.wallId}`, wallIds: [s1.wallId, s2.wallId] });
      }
    }
  }
  return hits;
}

/** Построить граф узлов из сегментов стен. */
function buildWallGraph(walls, thr = SNAP_DIST) {
  const nodes = [];
  const key = (p) => `${Math.round(p.x / thr)}_${Math.round(p.y / thr)}`;

  const getNode = (p) => {
    const k = key(p);
    let n = nodes.find((x) => key(x) === k);
    if (!n) { n = { x: p.x, y: p.y, key: k, edges: [] }; nodes.push(n); }
    return n;
  };

  walls.forEach((w) => {
    for (let i = 1; i < w.pts.length; i++) {
      const na = getNode(w.pts[i - 1]);
      const nb = getNode(w.pts[i]);
      if (!na.edges.find((e) => e.to === nb)) na.edges.push({ to: nb, wallId: w.id });
      if (!nb.edges.find((e) => e.to === na)) nb.edges.push({ to: na, wallId: w.id });
    }
  });
  return nodes;
}

/** Найти замкнутые контуры (простые циклы). */
export function findClosedLoops(walls, maxLoops = 48) {
  const nodes = buildWallGraph(walls);
  const loops = [];
  const seen = new Set();
  let steps = 0;
  const maxSteps = 8000;

  const walk = (start, cur, path, visitedEdges) => {
    if (loops.length >= maxLoops || steps++ > maxSteps) return;
    if (path.length > 2 && cur === start) {
      const sig = path.map((n) => n.key).sort().join("|");
      if (!seen.has(sig)) {
        seen.add(sig);
        loops.push(path.map((n) => ({ x: n.x, y: n.y })));
      }
      return;
    }
    if (path.length > 24) return;
    for (const e of cur.edges) {
      const eid = [cur.key, e.to.key].sort().join("-");
      if (visitedEdges.has(eid)) continue;
      visitedEdges.add(eid);
      walk(start, e.to, [...path, e.to], visitedEdges);
      visitedEdges.delete(eid);
      if (loops.length >= maxLoops || steps > maxSteps) return;
    }
  };

  for (const n of nodes) {
    walk(n, n, [n], new Set());
    if (loops.length >= maxLoops || steps > maxSteps) break;
  }
  return loops;
}

export function polygonBounds(pts) {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Точка внутри полигона (ray cast). */
export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x; const yi = poly[i].y;
    const xj = poly[j].x; const yj = poly[j].y;
    if (((yi > p.y) !== (yj > p.y)) && (p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

export function pointInZone(p, zone) {
  if (zone.polygon?.length >= 3) return pointInPolygon(p, zone.polygon);
  return p.x >= zone.x && p.x <= zone.x + zone.w && p.y >= zone.y && p.y <= zone.y + zone.h;
}

export function itemInAnyZone(item, zones) {
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  return zones.some((z) => pointInZone({ x: cx, y: cy }, z));
}

/** Ближайший сегмент стены к точке. */
export function nearestWallSegment(pt, walls, room, maxDist = 200) {
  const segs = wallSegments(walls.filter((w) => w.role !== "outer"));
  if (room) {
    const t = room.wallThk / 2;
    segs.push(
      { a: { x: t, y: t }, b: { x: room.w - t, y: t }, wallId: "outer", thk: room.wallThk },
      { a: { x: room.w - t, y: t }, b: { x: room.w - t, y: room.h - t }, wallId: "outer", thk: room.wallThk },
      { a: { x: room.w - t, y: room.h - t }, b: { x: t, y: room.h - t }, wallId: "outer", thk: room.wallThk },
      { a: { x: t, y: room.h - t }, b: { x: t, y: t }, wallId: "outer", thk: room.wallThk },
    );
  }

  let best = null;
  segs.forEach((s) => {
    const proj = projectOnSegment(pt, s.a, s.b);
    const d = dist(pt, proj);
    if (d <= maxDist && (!best || d < best.d)) {
      const angle = Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x) * 180 / Math.PI;
      const horiz = Math.abs(s.b.x - s.a.x) >= Math.abs(s.b.y - s.a.y);
      best = { ...s, proj, d, angle, horiz };
    }
  });
  return best;
}

function projectOnSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1) return { ...a };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/** Разместить настенный объект на ближайшей стене. */
export function placeOnWall(item, pt, walls, room) {
  const seg = nearestWallSegment({ x: pt.x + item.w / 2, y: pt.y + item.h / 2 }, walls, room, 350);
  if (!seg) return null;

  const { proj, horiz, thk } = seg;
  let x = proj.x - item.w / 2;
  let y = proj.y - item.h / 2;
  let angle = 0;

  if (horiz) {
    y = proj.y - item.h / 2;
    x = clampAlong(proj.x - item.w / 2, item.w, seg.a.x, seg.b.x);
    angle = seg.b.x >= seg.a.x ? 0 : 180;
  } else {
    x = proj.x - item.w / 2;
    y = clampAlong(proj.y - item.h / 2, item.h, seg.a.y, seg.b.y);
    angle = seg.b.y >= seg.a.y ? 90 : 270;
  }

  return { x, y, angle, wallSeg: seg };
}

function clampAlong(pos, size, a, b) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return Math.max(lo, Math.min(pos, hi - size));
}

/** Разорвать стену в точке клика — две стены с общим узлом. */
export function breakWallAt(wall, clickPt) {
  if (!wall?.pts || wall.pts.length < 2) return null;
  let bestI = 1;
  let bestPt = projectOnSegment(clickPt, wall.pts[0], wall.pts[1]);
  let bestD = dist(clickPt, bestPt);
  for (let i = 2; i < wall.pts.length; i++) {
    const proj = projectOnSegment(clickPt, wall.pts[i - 1], wall.pts[i]);
    const d = dist(clickPt, proj);
    if (d < bestD) {
      bestD = d;
      bestI = i;
      bestPt = proj;
    }
  }
  if (bestD > (wall.thk || 100) * 4) return null;
  const splitPt = { x: bestPt.x, y: bestPt.y };
  const pts1 = [...wall.pts.slice(0, bestI), splitPt];
  const pts2 = [splitPt, ...wall.pts.slice(bestI)];
  if (pts1.length < 2 || pts2.length < 2) return null;
  return [
    { ...wall, pts: pts1 },
    { ...wall, pts: pts2, id: null },
  ];
}

