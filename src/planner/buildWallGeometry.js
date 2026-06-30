/**
 * Геометрия стен как непрерывных лент: offset + miter в общих узлах.
 * Работает с текущим форматом walls[].pts (узлы = сваренные координаты).
 */
import { dist, near, NODE_LINK_THR, projectOnSegment } from "./wallGeometry.js";
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

function nodeKey(p, thr = NODE_LINK_THR) {
  return `${Math.round(p.x / thr)}_${Math.round(p.y / thr)}`;
}

function faceLine(a, b, wall, room, face) {
  const pa = wallFacePoint(a, a, b, face, wall, room);
  const d = segDirUnit(a, b);
  return { p: pa, d };
}

function faceAtEnd(a, b, wall, room, face, end) {
  const pt = end === "a" ? a : b;
  return wallFacePoint(pt, a, b, face, wall, room);
}

function faceEndpointAtNode(arm, node, thr = NODE_LINK_THR) {
  if (!arm) return "a";
  if (near(arm.a, node, thr)) return "a";
  if (near(arm.b, node, thr)) return "b";
  return "a";
}

function miterCorner(node, inArm, outArm, room, face, maxMiterMul = 4, thr = NODE_LINK_THR, endpointArm = null) {
  if (inArm && outArm) {
    const ln1 = faceLine(inArm.a, inArm.b, inArm.wall, room, face);
    const ln2 = faceLine(outArm.a, outArm.b, outArm.wall, room, face);
    let pt = lineIntersectLines(ln1.p, ln1.d, ln2.p, ln2.d);
    const thk = Math.max(inArm.wall?.thk || 100, outArm.wall?.thk || 100);
    if (pt && Number.isFinite(pt.x) && dist(node, pt) <= thk * maxMiterMul) return pt;
    const endArm = endpointArm || outArm || inArm;
    const ep = faceEndpointAtNode(endArm, node, thr);
    return faceAtEnd(endArm.a, endArm.b, endArm.wall, room, face, ep);
  }
  const arm = endpointArm || outArm || inArm;
  if (!arm) return node;
  const ep = faceEndpointAtNode(arm, node, thr);
  return faceAtEnd(arm.a, arm.b, arm.wall, room, face, ep);
}

function buildNodeArms(walls, thr = NODE_LINK_THR) {
  const armsByKey = new Map();
  for (const wall of walls || []) {
    if (!wall?.pts || wall.pts.length < 2) continue;
    for (let i = 0; i < wall.pts.length - 1; i++) {
      const a = wall.pts[i];
      const b = wall.pts[i + 1];
      if (dist(a, b) < 1) continue;
      const arm = { wall, segIdx: i, a, b };
      for (const pt of [a, b]) {
        const key = nodeKey(pt, thr);
        if (!armsByKey.has(key)) armsByKey.set(key, { node: pt, arms: [] });
        armsByKey.get(key).arms.push(arm);
      }
    }
  }
  return armsByKey;
}

function cornerArms(arms, node, wall, segIdx, end, thr = NODE_LINK_THR) {
  const segA = wall.pts[segIdx];
  const segB = wall.pts[segIdx + 1];
  const others = (arms || []).filter((arm) => !(arm.wall.id === wall.id && arm.segIdx === segIdx));

  if (end === "a") {
    const outArm = { wall, a: segA, b: segB };
    const inArm = others.find((arm) => near(arm.b, node, thr)) || null;
    return { inArm, outArm };
  }
  const inArm = { wall, a: segA, b: segB };
  const outArm = others.find((arm) => near(arm.a, node, thr)) || null;
  return { inArm, outArm };
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
  const armsByKey = buildNodeArms(expanded, thr);
  const polygons = [];
  const contours = [];

  for (const wall of expanded || []) {
    if (!wall?.pts || wall.pts.length < 2) continue;
    for (let i = 0; i < wall.pts.length - 1; i++) {
      const a = wall.pts[i];
      const b = wall.pts[i + 1];
      if (dist(a, b) < 1) continue;

      const armsA = armsByKey.get(nodeKey(a, thr))?.arms || [];
      const armsB = armsByKey.get(nodeKey(b, thr))?.arms || [];
      const cA = cornerArms(armsA, a, wall, i, "a");
      const cB = cornerArms(armsB, b, wall, i, "b");

      const outerA = miterCorner(a, cA.inArm, cA.outArm, room, "outer", 4, thr, cA.outArm);
      const innerA = miterCorner(a, cA.inArm, cA.outArm, room, "inner", 4, thr, cA.outArm);
      const outerB = miterCorner(b, cB.inArm, cB.outArm, room, "outer", 4, thr, cB.inArm);
      const innerB = miterCorner(b, cB.inArm, cB.outArm, room, "inner", 4, thr, cB.inArm);

      const quad = [outerA, outerB, innerB, innerA];
      if (!quad.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) continue;

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
