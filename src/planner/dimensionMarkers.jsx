/** Архитектурные размерные линии: вынос, засечки, подпись на белой плашке. */

import React from "react";
import { computeClearances, isWallMountedItem } from "./clearanceDims.js";
import { dimStroke, resolveDimState, DEFAULT_PASSAGE_WARN_MM, DEFAULT_PASSAGE_ERROR_MM } from "./dimensionProperties.js";
import { DG_THEME } from "./plannerVisualTheme.js";

const EXT_GAP = 14;
const EXT_OVERSHOOT = 16;
const MIN_CLEAR_DIM = 40;

function archTick(x, y, segAngDeg, k, stroke) {
  const half = 5.5 * k;
  const rad = ((segAngDeg + 45) * Math.PI) / 180;
  const dx = Math.cos(rad) * half;
  const dy = Math.sin(rad) * half;
  return <line x1={x - dx} y1={y - dy} x2={x + dx} y2={y + dy} stroke={stroke} strokeWidth={1.15 * k} />;
}

function dimLabel(mx, my, textAng, label, k, stroke) {
  const fs = 10.5 * k;
  const padX = 7 * k;
  const padY = 5 * k;
  const chars = String(label).length;
  const w = Math.max(44 * k, chars * 6.2 * k + padX * 2);
  const h = fs + padY * 2;
  return (
    <g transform={`translate(${mx},${my}) rotate(${textAng})`} stroke="none">
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={3 * k} fill="#fff" stroke={DG_THEME.labelBorder} strokeWidth={0.65 * k} />
      <text
        x={0}
        y={fs * 0.35}
        fontSize={fs}
        textAnchor="middle"
        fill={stroke}
        fontWeight="600"
        style={{ fontFamily: "var(--mono)" }}
      >
        {label}
      </text>
    </g>
  );
}

/** Размер отрезка a→b, вынесенный на offset мм перпендикулярно. */
export function SegDim({
  a,
  b,
  label,
  k,
  offset = 110,
  offsetSide = 1,
  active = false,
  state = null,
  minLen = 40,
}) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < minLen) return null;

  const nx = (-dy / len) * offsetSide;
  const ny = (dx / len) * offsetSide;
  const dimA = { x: a.x + nx * offset, y: a.y + ny * offset };
  const dimB = { x: b.x + nx * offset, y: b.y + ny * offset };

  const segAng = (Math.atan2(dy, dx) * 180) / Math.PI;
  let textAng = segAng;
  if (textAng > 90 || textAng < -90) textAng += 180;

  const stroke = dimStroke({ state, active });
  const mx = (dimA.x + dimB.x) / 2;
  const my = (dimA.y + dimB.y) / 2;

  const ext = (p, sign) => {
    const ex = sign * nx;
    const ey = sign * ny;
    const p0 = { x: p.x + ex * EXT_GAP, y: p.y + ey * EXT_GAP };
    const p1 = { x: p.x + ex * (offset + EXT_OVERSHOOT), y: p.y + ey * (offset + EXT_OVERSHOOT) };
    return <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke={stroke} strokeWidth={0.95 * k} opacity={0.75} />;
  };

  return (
    <g pointerEvents="none" data-ui="dim">
      {ext(a, 1)}
      {ext(b, 1)}
      <line x1={dimA.x} y1={dimA.y} x2={dimB.x} y2={dimB.y} stroke={stroke} strokeWidth={1.15 * k} />
      {archTick(dimA.x, dimA.y, segAng, k, stroke)}
      {archTick(dimB.x, dimB.y, segAng, k, stroke)}
      {dimLabel(mx, my, textAng, label, k, stroke)}
    </g>
  );
}

/** Сторона выноса размера стены — наружу от центра помещения. */
export function wallSegmentOffsetSide(a, b, room) {
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

/** Ширина и глубина прямоугольного объекта (вид сверху). */
export function RectDims({ x, y, w, h, k, fmtU, offset = 110, active = false, state = null }) {
  if (w < 40 && h < 40) return null;
  const st = state || (active ? "active" : "normal");
  return (
    <g data-ui="dim">
      {w >= 40 && (
        <SegDim
          a={{ x, y }}
          b={{ x: x + w, y }}
          label={fmtU(w)}
          k={k}
          offset={offset}
          offsetSide={-1}
          state={st}
        />
      )}
      {h >= 40 && (
        <SegDim
          a={{ x: x + w, y: y + h }}
          b={{ x, y: y + h }}
          label={fmtU(h)}
          k={k}
          offset={offset}
          offsetSide={-1}
          state={st}
        />
      )}
    </g>
  );
}

/** Размеры отступов до стен и препятствий. */
export function ClearanceDims({
  it, plan, k, fmtU, warnMm = DEFAULT_PASSAGE_WARN_MM, errorMm = DEFAULT_PASSAGE_ERROR_MM,
}) {
  const lines = computeClearances(it, plan);
  if (!lines.length) return null;
  return (
    <g data-ui="dim">
      {lines.map((ln, i) => {
        const dist = Math.round(ln.dist);
        return (
          <SegDim
            key={i}
            a={ln.a}
            b={ln.b}
            label={fmtU(dist)}
            k={k}
            offset={90}
            offsetSide={ln.offsetSide ?? -1}
            state={resolveDimState({ distanceMm: dist, warnMm, errorMm, active: true })}
            minLen={MIN_CLEAR_DIM}
          />
        );
      })}
    </g>
  );
}

/** @deprecated use ClearanceDims */
export function WallMountedDim({ it, plan, k, fmtU }) {
  if (!isWallMountedItem(it)) return null;
  return <ClearanceDims it={it} plan={plan} k={k} fmtU={fmtU} />;
}

/** Размеры контура помещения. */
export function RoomOutlineDims({ room, k, fmtU }) {
  const o = 180;
  return (
    <g data-ui="dim">
      <SegDim a={{ x: 0, y: 0 }} b={{ x: room.w, y: 0 }} label={fmtU(room.w)} k={k} offset={o} offsetSide={-1} state="normal" />
      <SegDim a={{ x: room.w, y: room.h }} b={{ x: 0, y: room.h }} label={fmtU(room.h)} k={k} offset={o} offsetSide={1} state="normal" />
    </g>
  );
}

/** Размеры выбранной стены (все сегменты + суммарная длина). */
export function WallSelectionDims({ wall, room, k, fmtU }) {
  if (!wall?.pts || wall.pts.length < 2) return null;
  let total = 0;
  const segs = [];
  for (let i = 1; i < wall.pts.length; i++) {
    const a = wall.pts[i - 1];
    const b = wall.pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    total += len;
    segs.push(
      <SegDim
        key={i}
        a={a}
        b={b}
        label={fmtU(len)}
        k={k}
        offset={150}
        offsetSide={wallSegmentOffsetSide(a, b, room)}
        state="active"
      />,
    );
  }
  const cx = wall.pts.reduce((s, p) => s + p.x, 0) / wall.pts.length;
  const cy = wall.pts.reduce((s, p) => s + p.y, 0) / wall.pts.length;
  return (
    <g data-ui="dim">
      {segs}
      {wall.pts.length > 2 && (
        <text x={cx} y={cy} fontSize={9 * k} textAnchor="middle" fill="#116355" fontWeight="600" style={{ fontFamily: "var(--mono)" }}>
          Σ {fmtU(total)}
        </text>
      )}
    </g>
  );
}
