/**
 * Centerline vs outline для стен.
 * TODO: внешние стены помещения (room rect) позже перевести на wall-chain.
 */
import { projectOnSegment } from "../geometry/segment.js";
import { wallFacePoint } from "../../wallParallelGeometry.js";

/** Осевая линия — pts стены. */
export function wallCenterline(wall) {
  return (wall?.pts || []).map((p) => ({ x: p.x, y: p.y }));
}

/** Точка на centerline с параметром t ∈ [0,1] на сегменте i. */
export function centerlinePointAt(wall, segIndex, t) {
  const a = wall.pts[segIndex];
  const b = wall.pts[segIndex + 1];
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

/** Outline-точка на грани стены (inner/outer) — для будущих размеров по граням. */
export function wallOutlinePoint(wall, segIndex, t, face, room) {
  const a = wall.pts[segIndex];
  const b = wall.pts[segIndex + 1];
  const axis = centerlinePointAt(wall, segIndex, t);
  return wallFacePoint(axis, a, b, face, wall, room);
}

/** Контурный отрезок грани стены (inner/outer) для размеров. */
export function wallOutlineSegment(wall, segIndex, face = "outer", room) {
  const a = wall?.pts?.[segIndex];
  const b = wall?.pts?.[segIndex + 1];
  if (!a || !b) return null;
  return {
    a: wallFacePoint(a, a, b, face, wall, room),
    b: wallFacePoint(b, a, b, face, wall, room),
  };
}

/** Проекция на centerline сегмента. */
export function projectToCenterline(p, wall, segIndex) {
  const a = wall.pts[segIndex];
  const b = wall.pts[segIndex + 1];
  return projectOnSegment(p, a, b);
}

export function wallThicknessMm(wall) {
  return wall?.thk ?? 100;
}
