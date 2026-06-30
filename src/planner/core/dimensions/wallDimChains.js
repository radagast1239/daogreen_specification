/**
 * Авто-цепочки размеров стен: разбивка на проёмах, чистовая/габаритная линии.
 */
import { openingRangesOnSegment } from "../../doorGeometry.js";
import { dist, near, NODE_LINK_THR } from "../walls/wallOps.js";
import { wallOutlinePoint } from "../walls/wallRender.js";

function wallSegmentOffsetSide(a, b, room) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const rcx = room?.w ? room.w / 2 : mx;
  const rcy = room?.h ? room.h / 2 : my;
  const dot = (rcx - mx) * nx + (rcy - my) * ny;
  return dot > 0 ? 1 : -1;
}

const COLLINEAR_OFF_THR = 40;
const PERP_DOT_THR = 0.15;

function normalizeDir(dx, dy) {
  const len = Math.hypot(dx, dy) || 1;
  let ux = dx / len;
  let uy = dy / len;
  if (ux < -1e-6 || (Math.abs(ux) < 1e-6 && uy < 0)) {
    ux = -ux;
    uy = -uy;
  }
  return { ux, uy, len };
}

function axisOffset(a, ux, uy) {
  const nx = -uy;
  const ny = ux;
  return a.x * nx + a.y * ny;
}

function axisKey(a, b) {
  const { ux, uy } = normalizeDir(b.x - a.x, b.y - a.y);
  const off = axisOffset(a, ux, uy);
  return `${Math.round(ux * 10000)}_${Math.round(uy * 10000)}_${Math.round(off)}`;
}

function projectScalar(p, origin, ux, uy) {
  return (p.x - origin.x) * ux + (p.y - origin.y) * uy;
}

function pointOnAxis(t, origin, ux, uy) {
  return { x: origin.x + ux * t, y: origin.y + uy * t };
}

function mergeTs(values, minGap = 15) {
  if (!values.length) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const out = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const v = sorted[i];
    const last = out[out.length - 1];
    if (v - last < minGap) out[out.length - 1] = (last + v) / 2;
    else out.push(v);
  }
  return out;
}

function isPerpendicular(ux1, uy1, ux2, uy2) {
  const dot = Math.abs(ux1 * ux2 + uy1 * uy2);
  return dot <= PERP_DOT_THR;
}

function collectPerpJunctions(seg, allSegs) {
  const { ux, uy, a, b, wall } = seg;
  const pts = [];
  for (const other of allSegs) {
    if (other.key === seg.key) continue;
    const { ux: oux, uy: ouy } = other;
    if (!isPerpendicular(ux, uy, oux, ouy)) continue;
    for (const node of [other.a, other.b]) {
      const t = projectScalar(node, a, ux, uy);
      const len = dist(a, b);
      if (t >= -NODE_LINK_THR && t <= len + NODE_LINK_THR && near(node, a, NODE_LINK_THR) === false && near(node, b, NODE_LINK_THR) === false) {
        const onAxis = pointOnAxis(t, a, ux, uy);
        if (dist(onAxis, node) <= Math.max(seg.thk, other.thk, 100) * 0.75 + 30) {
          pts.push(Math.max(0, Math.min(len, t)));
        }
      }
      if (near(node, a, NODE_LINK_THR)) pts.push(0);
      if (near(node, b, NODE_LINK_THR)) pts.push(len);
    }
  }
  return pts;
}

function openingTs(a, b, wallId, len, items) {
  const ranges = openingRangesOnSegment(a, b, wallId, items);
  const ts = [];
  ranges.forEach(([t0, t1]) => {
    ts.push(t0 * len, t1 * len);
  });
  return ts;
}

function buildSegmentList(walls) {
  const segs = [];
  (walls || []).forEach((wall) => {
    const pts = wall.pts;
    if (!pts || pts.length < 2) return;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const { ux, uy, len } = normalizeDir(b.x - a.x, b.y - a.y);
      if (len < 40) continue;
      segs.push({
        key: axisKey(a, b),
        wall,
        wallId: wall.id,
        segIndex: i - 1,
        a,
        b,
        ux,
        uy,
        len,
        thk: wall.thk || 100,
      });
    }
  });
  return segs;
}

function groupCollinearSegments(segs) {
  const groups = new Map();
  segs.forEach((seg) => {
    const k = seg.key;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(seg);
  });
  return [...groups.values()];
}

function facePointAlongSeg(seg, axisPoint, face, room) {
  const t = Math.max(0, Math.min(1, projectScalar(axisPoint, seg.a, seg.ux, seg.uy) / (seg.len || 1)));
  return wallOutlinePoint(seg.wall, seg.segIndex, t, face, room);
}

/**
 * @returns {{ chains: Array, thickness: Array, overall: Array }}
 */
export function computeWallDimChains(walls, room, items = [], opts = {}) {
  const segs = buildSegmentList(walls);
  if (!segs.length) return { chains: [], thickness: [], overall: [] };

  const chains = [];
  const thickness = [];
  const overall = [];

  const groups = groupCollinearSegments(segs);

  groups.forEach((group) => {
    const ref = group[0];
    const { ux, uy } = ref;
    const offsetSide = wallSegmentOffsetSide(ref.a, ref.b, room);

    let minT = Infinity;
    let maxT = -Infinity;
    let origin = null;

    const ts = [0];
    group.forEach((seg) => {
      const baseT0 = projectScalar(seg.a, ref.a, ux, uy);
      const baseT1 = projectScalar(seg.b, ref.a, ux, uy);
      const t0 = Math.min(baseT0, baseT1);
      const t1 = Math.max(baseT0, baseT1);
      if (!origin) origin = seg.a;
      minT = Math.min(minT, t0);
      maxT = Math.max(maxT, t1);
      ts.push(t0, t1);
      ts.push(...openingTs(seg.a, seg.b, seg.wallId, seg.len, items));
      ts.push(...collectPerpJunctions(seg, segs));
    });

    const merged = mergeTs(ts.filter((t) => t >= minT - 1 && t <= maxT + 1));
    if (merged.length < 2 || !origin) return;

    const mkChainSegs = (face, offset, kind) => {
      const out = [];
      for (let i = 0; i < merged.length - 1; i++) {
        const t0 = merged[i];
        const t1 = merged[i + 1];
        const len = t1 - t0;
        if (len < 40) continue;
        const axisA = pointOnAxis(t0, origin, ux, uy);
        const axisB = pointOnAxis(t1, origin, ux, uy);
        const segRef = group.find((s) => {
          const st = projectScalar(s.a, origin, ux, uy);
          const en = projectScalar(s.b, origin, ux, uy);
          return t0 >= Math.min(st, en) - 5 && t1 <= Math.max(st, en) + 5;
        }) || ref;
        const fa = facePointAlongSeg(segRef, axisA, face, room);
        const fb = facePointAlongSeg(segRef, axisB, face, room);
        out.push({
          kind,
          face,
          a: fa,
          b: fb,
          len: dist(fa, fb),
          offset,
          offsetSide,
          key: `${kind}-${face}-${t0}-${t1}`,
        });
      }
      return out;
    };

    if (opts.showFinishing !== false) {
      chains.push(...mkChainSegs("inner", 200, "finishing"));
    }
    if (opts.showGross !== false) {
      chains.push(...mkChainSegs("outer", 240, "gross"));
    }

    const oa = pointOnAxis(minT, origin, ux, uy);
    const ob = pointOnAxis(maxT, origin, ux, uy);
    const oSeg = group[0];
    const outerA = facePointAlongSeg(oSeg, oa, "outer", room);
    const outerB = facePointAlongSeg(oSeg, ob, "outer", room);
    overall.push({
      kind: "overall",
      a: outerA,
      b: outerB,
      len: dist(outerA, outerB),
      offset: 340,
      offsetSide,
      key: `overall-${ref.key}`,
    });

    const endSeg = group.reduce((best, s) => (s.len < best.len ? s : best), group[0]);
    const thk = endSeg.thk;
    if (thk >= 5) {
      const { nx, ny } = (() => {
        const side = offsetSide;
        const ndx = -uy * side;
        const ndy = ux * side;
        return { nx: ndx, ny: ndy };
      })();
      const ea = wallOutlinePoint(endSeg.wall, endSeg.segIndex, 0, "outer", room);
      const eb = { x: ea.x + nx * thk, y: ea.y + ny * thk };
      thickness.push({
        kind: "thickness",
        a: ea,
        b: eb,
        len: thk,
        offset: 60,
        offsetSide: -offsetSide,
        key: `thk-${endSeg.wallId}`,
      });
    }
  });

  return { chains, thickness, overall };
}
