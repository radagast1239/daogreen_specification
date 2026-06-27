import { isDoorKind, isOpeningKind } from "./doorTypes.js";
import { pointInPolygon } from "./wallGeometry.js";

const CORNER_CLEAR_MM = 350;

export function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function lerpPt(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Параметр t ∈ [0,1] проекции точки на отрезок AB. */
export function segmentParam(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1) return 0;
  return ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
}

function mergeRanges(ranges) {
  if (!ranges.length) return [];
  const sorted = [...ranges].sort((x, y) => x[0] - y[0]);
  const out = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    if (sorted[i][0] <= last[1] + 0.001) last[1] = Math.max(last[1], sorted[i][1]);
    else out.push(sorted[i]);
  }
  return out;
}

/** Доли [t0,t1] проёма на сегменте стены. */
export function openingRangesOnSegment(a, b, wallId, items) {
  const len = dist(a, b);
  if (len < 1) return [];
  const ranges = [];
  items.forEach((it) => {
    if (!isDoorKind(it.kind) && !isOpeningKind(it.kind)) return;
    if (it.wallId && it.wallId !== wallId) return;
    const cx = it.x + it.w / 2;
    const cy = it.y + it.h / 2;
    const t = segmentParam({ x: cx, y: cy }, a, b);
    if (t < -0.08 || t > 1.08) return;
    const half = (it.w / 2 + 20) / len;
    ranges.push([Math.max(0, t - half), Math.min(1, t + half)]);
  });
  return mergeRanges(ranges);
}

/** Доли сегмента, где рисуется стена (инверсия проёмов). */
export function wallDrawRanges(openingRanges) {
  if (!openingRanges.length) return [[0, 1]];
  const parts = [];
  let cursor = 0;
  openingRanges.forEach(([o0, o1]) => {
    if (o0 > cursor + 0.002) parts.push([cursor, o0]);
    cursor = Math.max(cursor, o1);
  });
  if (cursor < 0.998) parts.push([cursor, 1]);
  return parts.filter(([a, b]) => b - a > 0.002);
}

/** Проверка установки двери/окна на стене. */
export function validateOpeningPlacement(item, placed, walls) {
  if (!placed?.wallSeg) return { ok: false, reason: "no_wall", message: "Не на стене" };
  const { a, b } = placed.wallSeg;
  const segLen = dist(a, b);
  if (item.w > segLen - 60) {
    return { ok: false, reason: "too_wide", message: "Проём шире сегмента стены" };
  }
  const px = placed.x ?? item.x;
  const py = placed.y ?? item.y;
  const cx = px + item.w / 2;
  const cy = py + item.h / 2;
  const t = segmentParam({ x: cx, y: cy }, a, b);
  const half = item.w / (2 * segLen);
  const margin = CORNER_CLEAR_MM / segLen;
  if (t - half < margin || t + half > 1 - margin) {
    return { ok: false, reason: "corner", message: "Слишком близко к углу стены (нужно ≥ 350 мм)" };
  }
  const wall = walls.find((w) => w.id === placed.wallId);
  if (wall && item.w > segLen * 0.98) {
    return { ok: false, reason: "too_wide", message: "Проём не помещается на стене" };
  }
  return { ok: true };
}

/** Сектор дуги открывания двери (многоугольник). */
export function doorSwingPolygon(door) {
  const w = door.w;
  const cy = door.y + door.h / 2;
  const ang = ((door.angle || 0) * Math.PI) / 180;
  const hingeRight = door.doorSwing === "right";
  const hx = hingeRight ? door.x + w : door.x;
  const hy = cy;
  const openIn = door.doorOpenIn !== false;
  const sign = openIn ? 1 : -1;
  const startA = ang + (hingeRight ? 0 : -sign * (Math.PI / 2));
  const endA = ang + (hingeRight ? -sign * (Math.PI / 2) : 0);
  const pts = [{ x: hx, y: hy }];
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = startA + (endA - startA) * t;
    pts.push({ x: hx + w * Math.cos(a), y: hy + w * Math.sin(a) });
  }
  return pts;
}

function itemCenter(it) {
  return { x: it.x + it.w / 2, y: it.y + it.h / 2 };
}

function rectsOverlap(a, b, pad = 0) {
  return !(
    a.x + a.w + pad < b.x ||
    b.x + b.w + pad < a.x ||
    a.y + a.h + pad < b.y ||
    b.y + b.h + pad < a.y
  );
}

/** Предупреждения: дуга открывания пересекает объекты. */
export function doorSwingCollisions(door, items) {
  if (!isDoorKind(door.kind) || door.kind === "door_slide") return [];
  const poly = doorSwingPolygon(door);
  const hits = [];
  items.forEach((it) => {
    if (it.id === door.id || isDoorKind(it.kind) || isOpeningKind(it.kind)) return;
    if (it.layer === "room") return;
    const c = itemCenter(it);
    if (pointInPolygon(c, poly) || rectsOverlap(
      { x: door.x, y: door.y, w: door.w, h: door.w },
      { x: it.x, y: it.y, w: it.w, h: it.h },
      80,
    )) {
      hits.push(it);
    }
  });
  return hits;
}

export function nextDoorNumber(items) {
  let max = 0;
  (items || []).forEach((it) => {
    if (!isDoorKind(it.kind)) return;
    const m = /^Д\s*(\d+)$/i.exec(it.doorNum || it.label || "");
    if (m) max = Math.max(max, +m[1]);
  });
  return `Д${String(max + 1).padStart(2, "0")}`;
}

export function nextOpeningNumber(items) {
  let max = 0;
  (items || []).forEach((it) => {
    if (!isOpeningKind(it.kind)) return;
    const m = /^О\s*(\d+)$/i.exec(it.openingNum || "");
    if (m) max = Math.max(max, +m[1]);
  });
  return `О${String(max + 1).padStart(2, "0")}`;
}

export function wallMountedItems(items) {
  return (items || []).filter((it) => isDoorKind(it.kind) || isOpeningKind(it.kind));
}
