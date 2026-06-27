import { snap } from "./catalog.js";
import { isDoorKind, isWallOpeningKind } from "./doorTypes.js";

const SNAP_DIST = 80;
const NODE_LINK_THR = 85;

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
    walls.forEach((w) => {
      for (let i = 1; i < w.pts.length; i++) {
        const proj = projectOnSegment(pt, w.pts[i - 1], w.pts[i]);
        trySnap(proj, "wall-seg");
      }
    });
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

export function polygonArea(poly) {
  if (!poly?.length) return 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return Math.abs(a) / 2;
}

export function polygonCentroid(poly) {
  if (!poly?.length) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  poly.forEach((p) => { x += p.x; y += p.y; });
  return { x: x / poly.length, y: y / poly.length };
}

/** Сжать полигон к центру — внутренняя граница помещения внутри линии осей стен. */
export function insetPolygon(poly, insetMm) {
  if (!poly?.length || poly.length < 3 || insetMm <= 0) return poly;
  const cen = polygonCentroid(poly);
  return poly.map((p) => {
    const dx = p.x - cen.x;
    const dy = p.y - cen.y;
    const d = Math.hypot(dx, dy) || 1;
    const move = Math.min(insetMm, d * 0.38);
    return { x: p.x - (dx / d) * move, y: p.y - (dy / d) * move };
  });
}

const MIN_ROOM_AREA_MM2 = 600000; // ~0.6 м²

/** Оставить «комнаты», убрать внешние контуры, внутри которых есть меньшие помещения. */
export function filterRoomLoops(loops) {
  const meta = loops
    .map((poly) => ({ poly, area: polygonArea(poly), cen: polygonCentroid(poly) }))
    .filter((l) => l.area >= MIN_ROOM_AREA_MM2);

  return meta
    .filter((l) => !meta.some((other) => (
      other.poly !== l.poly &&
      other.area < l.area * 0.98 &&
      pointInPolygon(other.cen, l.poly)
    )))
    .sort((a, b) => a.area - b.area)
    .map((l) => l.poly);
}

/** Автопомещения из замкнутых перегородок с сохранением имён/типов зон. */
export function syncZonesFromWalls(plan) {
  const partitionWalls = (plan.walls || []).filter((w) => w.role !== "outer");
  const loops = filterRoomLoops(findClosedLoops(partitionWalls));
  const manual = (plan.zones || []).filter((z) => !z.auto);
  const prevAuto = (plan.zones || []).filter((z) => z.auto);
  const avgThk = partitionWalls.length
    ? partitionWalls.reduce((s, w) => s + (w.thk || 100), 0) / partitionWalls.length
    : 100;

  const auto = loops.map((poly, i) => {
    const innerPoly = insetPolygon(poly, avgThk * 0.45);
    const b = polygonBounds(innerPoly);
    const cen = polygonCentroid(innerPoly);
    const prev = prevAuto.find((z) => {
      const zc = z.polygon?.length >= 3 ? polygonCentroid(z.polygon) : { x: z.x + z.w / 2, y: z.y + z.h / 2 };
      return dist(cen, zc) < 500;
    });
    return {
      prevId: prev?.id || null,
      ...b,
      name: prev?.name || `Помещение ${manual.length + i + 1}`,
      height: prev?.height || plan.room?.height || 3000,
      polygon: innerPoly,
      flow: prev?.flow || "neutral",
      purpose: prev?.purpose || "",
      zoneColor: prev?.zoneColor,
      locked: prev?.locked,
      showName: prev?.showName,
      showArea: prev?.showArea,
      showHeight: prev?.showHeight,
      hideFill: prev?.hideFill,
      contoursOnly: prev?.contoursOnly,
      auto: true,
    };
  });

  return { manual, auto };
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
export function placeOnWall(item, pt, walls, room, maxDist = 350) {
  const seg = nearestWallSegment({ x: pt.x + item.w / 2, y: pt.y + item.h / 2 }, walls, room, maxDist);
  if (!seg) return null;

  const { proj, horiz } = seg;
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

  return {
    x,
    y,
    angle,
    wallSeg: seg,
    wallId: seg.wallId,
    onWall: true,
  };
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

/** Сдвинуть узел и потянуть совпадающие узлы соседних стен. */
export function applyWallNodeMove(walls, wallId, nodeIdx, newPt, thr = NODE_LINK_THR) {
  const wall = walls.find((w) => w.id === wallId);
  if (!wall?.pts?.[nodeIdx]) return walls;
  const oldPt = wall.pts[nodeIdx];
  return walls.map((w) => ({
    ...w,
    pts: w.pts.map((p) => (dist(p, oldPt) <= thr ? { x: newPt.x, y: newPt.y } : p)),
  }));
}

/** Обновить позиции дверей/окон на стене после её изменения. */
export function refreshWallMountedItems(items, walls, room, wallId = null) {
  return items.map((it) => {
    const onWall = it.wall || isDoorKind(it.kind) || isWallOpeningKind(it.kind);
    if (!onWall) return it;
    if (wallId && it.wallId !== wallId && it.wallId != null) return it;
    const cx = it.x + it.w / 2;
    const cy = it.y + it.h / 2;
    const placed = placeOnWall(it, { x: cx, y: cy }, walls, room, 400);
    if (!placed) return it;
    return { ...it, x: placed.x, y: placed.y, angle: placed.angle ?? it.angle, wallId: placed.wallId };
  });
}

function sameLine(a, b, c, d, eps = 8) {
  const cross1 = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const cross2 = Math.abs((b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x));
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return len > 1 && cross1 / len < eps && cross2 / len < eps;
}

function overlap1D(a1, a2, b1, b2) {
  const lo = Math.max(Math.min(a1, a2), Math.min(b1, b2));
  const hi = Math.min(Math.max(a1, a2), Math.max(b1, b2));
  return hi - lo > 40;
}

/** Наложение коллинеарных сегментов разных стен. */
export function findWallOverlaps(walls) {
  const segs = wallSegments(walls);
  const hits = [];
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const s1 = segs[i];
      const s2 = segs[j];
      if (s1.wallId === s2.wallId) continue;
      const shared =
        near(s1.a, s2.a, 8) || near(s1.a, s2.b, 8) ||
        near(s1.b, s2.a, 8) || near(s1.b, s2.b, 8);
      if (shared) continue;
      if (!sameLine(s1.a, s1.b, s2.a, s2.b)) continue;
      const horiz = Math.abs(s1.b.x - s1.a.x) >= Math.abs(s1.b.y - s1.a.y);
      const ok = horiz
        ? overlap1D(s1.a.x, s1.b.x, s2.a.x, s2.b.x)
        : overlap1D(s1.a.y, s1.b.y, s2.a.y, s2.b.y);
      if (ok) hits.push({ id: `wo-${s1.wallId}-${s2.wallId}`, wallIds: [s1.wallId, s2.wallId] });
    }
  }
  return hits;
}

function segHitsRect(a, b, rx, ry, rw, rh) {
  const edges = [
    [{ x: rx, y: ry }, { x: rx + rw, y: ry }],
    [{ x: rx + rw, y: ry }, { x: rx + rw, y: ry + rh }],
    [{ x: rx + rw, y: ry + rh }, { x: rx, y: ry + rh }],
    [{ x: rx, y: ry + rh }, { x: rx, y: ry }],
  ];
  return edges.some(([e1, e2]) => segmentsIntersectProper(a, b, e1, e2));
}

/** Стена проходит поверх напольной мебели/оборудования. */
export function findWallsOverItems(walls, items) {
  const hits = [];
  walls.forEach((w) => {
    for (let i = 1; i < w.pts.length; i++) {
      const a = w.pts[i - 1];
      const b = w.pts[i];
      items.forEach((it) => {
        if (it.wall || isDoorKind(it.kind) || isWallOpeningKind(it.kind)) return;
        if (it.layer === "room") return;
        if (segHitsRect(a, b, it.x, it.y, it.w, it.h)) {
          hits.push({ id: `wov-${w.id}-${it.id}`, wallIds: [w.id], objectIds: [it.id] });
        }
      });
    }
  });
  return hits;
}

/** Сварить близкие узлы стен в одну точку. */
export function weldWallNodes(walls, thr = NODE_LINK_THR) {
  if (!walls?.length) return walls;
  const clusters = [];

  const clusterFor = (p) => {
    let c = clusters.find((cl) => dist(cl.center, p) <= thr);
    if (!c) {
      c = { center: { x: p.x, y: p.y }, n: 1 };
      clusters.push(c);
    } else {
      c.center = {
        x: (c.center.x * c.n + p.x) / (c.n + 1),
        y: (c.center.y * c.n + p.y) / (c.n + 1),
      };
      c.n += 1;
    }
    return c.center;
  };

  walls.forEach((w) => w.pts.forEach((p) => clusterFor(p)));

  return walls.map((w) => ({
    ...w,
    pts: w.pts.map((p) => {
      const c = clusters.find((cl) => dist(cl.center, p) <= thr);
      return c ? { x: c.center.x, y: c.center.y } : { ...p };
    }),
  }));
}

/** Объединить стену с соседней по общему узлу. */
export function tryMergeWall(walls, wallId) {
  const w = walls.find((x) => x.id === wallId);
  if (!w || w.pts.length < 2) return null;

  for (const other of walls) {
    if (other.id === wallId) continue;
    const tries = [
      { a: w.pts[w.pts.length - 1], b: other.pts[0], pts: [...w.pts, ...other.pts.slice(1)] },
      { a: w.pts[w.pts.length - 1], b: other.pts[other.pts.length - 1], pts: [...w.pts, ...[...other.pts].reverse().slice(1)] },
      { a: w.pts[0], b: other.pts[other.pts.length - 1], pts: [...other.pts, ...w.pts.slice(1)] },
      { a: w.pts[0], b: other.pts[0], pts: [...[...other.pts].reverse(), ...w.pts.slice(1)] },
    ];
    for (const t of tries) {
      if (near(t.a, t.b, NODE_LINK_THR)) {
        return {
          walls: walls
            .filter((x) => x.id !== other.id)
            .map((x) => (x.id === wallId ? { ...w, pts: t.pts } : x)),
          mergedId: wallId,
        };
      }
    }
  }
  return null;
}

/** Выровнять сегмент стены строго по горизонтали или вертикали. */
export function straightenWall(wall, mode = "h") {
  if (!wall?.pts || wall.pts.length < 2) return wall;
  const pts = wall.pts.map((p) => ({ ...p }));
  const a = pts[pts.length - 2];
  const b = pts[pts.length - 1];
  if (mode === "h") pts[pts.length - 1] = { x: b.x, y: a.y };
  else pts[pts.length - 1] = { x: a.x, y: b.y };
  return { ...wall, pts };
}

/** Задать точную длину последнего сегмента стены. */
export function setWallSegmentLength(wall, lenMm) {
  if (!wall?.pts || wall.pts.length < 2 || lenMm < 100) return wall;
  return setWallSegmentLengthAt(wall, wall.pts.length - 2, lenMm);
}

/** Задать точную длину сегмента wall.pts[i] → wall.pts[i+1]. */
export function setWallSegmentLengthAt(wall, segIndex, lenMm) {
  if (!wall?.pts || wall.pts.length < 2 || lenMm < 100) return wall;
  if (segIndex < 0 || segIndex >= wall.pts.length - 1) return wall;
  const pts = wall.pts.map((p) => ({ ...p }));
  const a = pts[segIndex];
  const b = pts[segIndex + 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d < 1) return wall;
  pts[segIndex + 1] = { x: a.x + (dx / d) * lenMm, y: a.y + (dy / d) * lenMm };
  return { ...wall, pts };
}

/** Длина сегмента стены по индексу узла (сегмент до или после узла). */
export function wallSegmentLengthAt(wall, nodeIdx) {
  if (!wall?.pts || wall.pts.length < 2 || nodeIdx == null) return 0;
  const seg = nodeIdx > 0 ? nodeIdx - 1 : 0;
  if (seg >= wall.pts.length - 1) return 0;
  const a = wall.pts[seg];
  const b = wall.pts[seg + 1];
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Индекс сегмента для редактирования длины по выбранному узлу. */
export function wallSegmentIndexForNode(wall, nodeIdx) {
  if (!wall?.pts || wall.pts.length < 2 || nodeIdx == null) return wall.pts.length - 2;
  if (nodeIdx <= 0) return 0;
  if (nodeIdx >= wall.pts.length - 1) return wall.pts.length - 2;
  return nodeIdx - 1;
}

/** Выровнять стену параллельно соседней по общему узлу. */
export function alignWallToNeighbor(walls, wallId) {
  const w = walls.find((x) => x.id === wallId);
  if (!w || w.pts.length < 2) return null;

  for (const other of walls) {
    if (other.id === wallId || other.pts.length < 2) continue;
    for (const pt of [w.pts[0], w.pts[w.pts.length - 1]]) {
      for (let i = 1; i < other.pts.length; i++) {
        const oa = other.pts[i - 1];
        const ob = other.pts[i];
        if (!near(pt, oa, NODE_LINK_THR) && !near(pt, ob, NODE_LINK_THR)) continue;
        const odx = ob.x - oa.x;
        const ody = ob.y - oa.y;
        const len = Math.hypot(odx, ody);
        if (len < 1) continue;
        const endIdx = near(pt, w.pts[0], NODE_LINK_THR) ? 1 : w.pts.length - 1;
        const startIdx = endIdx === 1 ? 0 : w.pts.length - 2;
        const segLen = dist(w.pts[startIdx], w.pts[endIdx]);
        const pts = w.pts.map((p) => ({ ...p }));
        pts[endIdx] = {
          x: pts[startIdx].x + (odx / len) * segLen,
          y: pts[startIdx].y + (ody / len) * segLen,
        };
        return walls.map((x) => (x.id === wallId ? { ...w, pts } : x));
      }
    }
  }
  return null;
}

