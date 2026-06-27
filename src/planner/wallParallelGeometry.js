/**
 * Параллельные линии стен (архитектурная двойная линия) с учётом thicknessSide.
 */
import { wallSegmentOffsetSide } from "./dimensionMarkers.jsx";

/** Единичная нормаль к сегменту, направленная внутрь помещения. */
export function inwardNormal(a, b, room) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  const side = wallSegmentOffsetSide(a, b, room);
  return { nx: nx * side, ny: ny * side };
}

/** Расстояния от осевой линии до внутренней/внешней грани вдоль inwardNormal. */
export function wallFaceDistances(wall) {
  const thk = wall?.thk || 100;
  const side = wall?.thicknessSide || "center";
  if (side === "in") return { inner: thk, outer: 0 };
  if (side === "out") return { inner: 0, outer: thk };
  return { inner: thk / 2, outer: thk / 2 };
}

/** Точка на грани стены: face = "inner" | "outer". */
export function wallFacePoint(pt, segA, segB, face, wall, room) {
  const { nx, ny } = inwardNormal(segA, segB, room);
  const { inner, outer } = wallFaceDistances(wall);
  const dist = face === "inner" ? inner : -outer;
  return { x: pt.x + nx * dist, y: pt.y + ny * dist };
}

/** Смещённые концы сегмента для заданной грани. */
export function wallFaceSegment(a, b, face, wall, room) {
  return {
    a: wallFacePoint(a, a, b, face, wall, room),
    b: wallFacePoint(b, a, b, face, wall, room),
  };
}
