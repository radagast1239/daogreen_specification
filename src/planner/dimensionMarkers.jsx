/** Архитектурные размерные линии: вынос, засечки, подпись на белой плашке. */

import React from "react";
import { computeClearances, isWallMountedItem } from "./clearanceDims.js";
import { dimStroke, resolveDimState, DEFAULT_PASSAGE_WARN_MM, DEFAULT_PASSAGE_ERROR_MM } from "./dimensionProperties.js";
import { DG_THEME } from "./plannerVisualTheme.js";
import { dimEffectiveK, dimEffectiveOffset, dimEffectiveOpacity } from "./plannerVisualSettings.js";
import { wallOutlineSegment } from "./core/walls/wallRender.js";
import { wallFacePoint } from "./wallParallelGeometry.js";
import { computeWallDimChains } from "./wallDimChains.js";

export const WALL_DIM_COLOR = "#14201b";
export const RULER_COLOR = "#e0312a";

const EXT_GAP = 14;
const EXT_OVERSHOOT = 16;
const MIN_CLEAR_DIM = 40;

function archTick(x, y, segAngDeg, k, stroke) {
  const half = 4 * k;
  const rad = ((segAngDeg + 45) * Math.PI) / 180;
  const dx = Math.cos(rad) * half;
  const dy = Math.sin(rad) * half;
  return <line x1={x - dx} y1={y - dy} x2={x + dx} y2={y + dy} stroke={stroke} strokeWidth={1.1 * k} />;
}

function dimLabel(mx, my, textAng, label, k, stroke, opacity = 1, labelColor = null) {
  const fs = 10.5 * k;
  const padX = 7 * k;
  const padY = 5 * k;
  const chars = String(label).length;
  const w = Math.max(44 * k, chars * 6.2 * k + padX * 2);
  const h = fs + padY * 2;
  return (
    <g transform={`translate(${mx},${my}) rotate(${textAng})`} stroke="none" opacity={opacity}>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={3 * k} fill="#fff" stroke={DG_THEME.labelBorder} strokeWidth={0.75 * k} />
      <text
        x={0}
        y={fs * 0.35}
        fontSize={fs}
        textAnchor="middle"
        fill={labelColor || stroke}
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
  display,
  offset = 110,
  offsetSide = 1,
  active = false,
  state = null,
  minLen = 40,
  color = null,
  labelColor = null,
  strokeWidthMul = 1,
  dasharray = null,
}) {
  const dk = dimEffectiveK(k, display);
  const effOffset = dimEffectiveOffset(offset, display);
  const opacity = dimEffectiveOpacity(display);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < minLen) return null;

  const nx = (-dy / len) * offsetSide;
  const ny = (dx / len) * offsetSide;
  const dimA = { x: a.x + nx * effOffset, y: a.y + ny * effOffset };
  const dimB = { x: b.x + nx * effOffset, y: b.y + ny * effOffset };

  const segAng = (Math.atan2(dy, dx) * 180) / Math.PI;
  let textAng = segAng;
  if (textAng > 90 || textAng < -90) textAng += 180;

  const stroke = color || dimStroke({ state, active });
  const sw = 1.1 * dk * strokeWidthMul;
  const mx = (dimA.x + dimB.x) / 2;
  const my = (dimA.y + dimB.y) / 2;

  const ext = (p, sign) => {
    const ex = sign * nx;
    const ey = sign * ny;
    const p0 = { x: p.x + ex * EXT_GAP * (display?.dimScale ?? 1), y: p.y + ey * EXT_GAP * (display?.dimScale ?? 1) };
    const p1 = {
      x: p.x + ex * (effOffset + EXT_OVERSHOOT * (display?.dimScale ?? 1)),
      y: p.y + ey * (effOffset + EXT_OVERSHOOT * (display?.dimScale ?? 1)),
    };
    return (
      <line
        x1={p0.x}
        y1={p0.y}
        x2={p1.x}
        y2={p1.y}
        stroke={stroke}
        strokeWidth={1.1 * dk}
        opacity={0.82 * opacity}
      />
    );
  };

  return (
    <g pointerEvents="none" data-ui="dim" opacity={opacity}>
      {ext(a, 1)}
      {ext(b, 1)}
      <line x1={dimA.x} y1={dimA.y} x2={dimB.x} y2={dimB.y} stroke={stroke} strokeWidth={sw} strokeDasharray={dasharray || undefined} />
      {archTick(dimA.x, dimA.y, segAng, dk, stroke)}
      {archTick(dimB.x, dimB.y, segAng, dk, stroke)}
      {dimLabel(mx, my, textAng, label, dk, stroke, opacity, labelColor)}
    </g>
  );
}

function dimStyleFromKind(dim) {
  if (dim?.invalid || dim?.style?.importance === "error") {
    return { line: "#c7372f", text: "#c7372f", dasharray: "7 4" };
  }
  if (dim?.style?.importance === "important") {
    return { line: "#8f9a94", text: "#116355", dasharray: null };
  }
  return { line: "#8f9a94", text: "#111111", dasharray: null };
}

function dimOffsetSide(offset) {
  return (offset || 0) >= 0 ? 1 : -1;
}

function dimOffsetAbs(offset) {
  return Math.abs(offset || 0);
}

export function DimensionLinearEl({
  dim, k, fmtDim, display, selected = false, onSelect, onDoubleClick, interactive = true,
}) {
  if (!dim?.p1 || !dim?.p2) return null;
  const len = Math.hypot(dim.p2.x - dim.p1.x, dim.p2.y - dim.p1.y);
  if (len < 1) return null;
  const style = dimStyleFromKind(dim);
  const mx = (dim.p1.x + dim.p2.x) / 2;
  const my = (dim.p1.y + dim.p2.y) / 2;
  const label = dim.labelOverride || fmtDim(Math.round(len), { roomChain: dim.kind === "room_width" || dim.kind === "room_height" });
  return (
    <g data-dimension={dim.id} pointerEvents="all">
      <line
        x1={dim.p1.x}
        y1={dim.p1.y}
        x2={dim.p2.x}
        y2={dim.p2.y}
        stroke="transparent"
        strokeWidth={18 * k}
        onPointerDown={(e) => {
          if (!interactive) return;
          e.stopPropagation();
          onSelect?.(e, dim);
        }}
        onDoubleClick={(e) => {
          if (!interactive) return;
          e.stopPropagation();
          onDoubleClick?.(e, dim, { x: mx, y: my });
        }}
        style={{ cursor: interactive ? "pointer" : "default" }}
      />
      <SegDim
        a={dim.p1}
        b={dim.p2}
        label={label}
        k={k}
        display={display}
        offset={dimOffsetAbs(dim.offset)}
        offsetSide={dimOffsetSide(dim.offset)}
        state={selected ? "active" : "normal"}
        color={style.line}
        labelColor={style.text}
        dasharray={style.dasharray}
      />
    </g>
  );
}

export function DimensionAnnotationEl({ dim, k }) {
  if (!dim?.p1 || !dim?.labelOverride) return null;
  return (
    <g pointerEvents="none" data-ui="dim-annotation">
      <text
        x={dim.p1.x}
        y={dim.p1.y}
        textAnchor="middle"
        fontSize={11 * k}
        fill="#111"
        fontWeight="600"
        style={{ fontFamily: "var(--mono)" }}
      >
        {dim.labelOverride}
      </text>
    </g>
  );
}

export function DimensionsLayer({
  dimensions = [], k, fmtDim, display, selectedId, onSelect, onDoubleClick,
}) {
  if (!dimensions.length) return null;
  return (
    <g data-ui="dimensions-runtime">
      {dimensions.map((dim) => (
        dim.mode === "annotation" ? (
          <DimensionAnnotationEl key={dim.id} dim={dim} k={k} />
        ) : (
          <DimensionLinearEl
            key={dim.id}
            dim={dim}
            k={k}
            fmtDim={fmtDim}
            display={display}
            selected={selectedId === dim.id}
            interactive={!dim.auto}
            onSelect={onSelect}
            onDoubleClick={onDoubleClick}
          />
        )
      ))}
    </g>
  );
}

export function DimensionDraftEl({
  p1, p2, offsetPoint, k, fmtDim, display, snapPt,
}) {
  if (!p1 || !p2) return null;
  if (!offsetPoint) {
    return <RulerDraftEl a={p1} b={p2} k={k} fmtU={fmtDim} display={display} snapPt={snapPt} />;
  }
  const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const nx = -(p2.y - p1.y) / (len || 1);
  const ny = (p2.x - p1.x) / (len || 1);
  const offset = (offsetPoint.x - p1.x) * nx + (offsetPoint.y - p1.y) * ny;
  return (
    <g data-ui="dimension-draft" pointerEvents="none">
      <SegDim
        a={p1}
        b={p2}
        label={fmtDim(Math.round(len))}
        k={k}
        display={display}
        offset={Math.abs(offset)}
        offsetSide={offset >= 0 ? 1 : -1}
        color="#8f9a94"
        labelColor="#111111"
      />
      {snapPt?.snapped && (
        <circle cx={offsetPoint.x} cy={offsetPoint.y} r={5 * k} fill="none" stroke="#116355" strokeWidth={1.2 * k} />
      )}
    </g>
  );
}

/** Точки размерной линии по наружной грани стены (не по оси). */
export function wallSegDimPoints(a, b, wall, room, face = "outer") {
  if (!wall?.pts?.length) {
    return {
      a: wallFacePoint(a, a, b, face, wall || {}, room),
      b: wallFacePoint(b, a, b, face, wall || {}, room),
    };
  }
  const segIndex = (wall?.pts || []).findIndex((p, i) => {
    const n = wall?.pts?.[i + 1];
    if (!n) return false;
    return Math.hypot(p.x - a.x, p.y - a.y) <= 0.01 && Math.hypot(n.x - b.x, n.y - b.y) <= 0.01;
  });
  const outline = segIndex >= 0 ? wallOutlineSegment(wall, segIndex, face, room) : null;
  if (outline) return { a: outline.a, b: outline.b };
  return { a, b };
}

export function wallSegDimLength(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
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
export function RectDims({
  x, y, w, h, k, fmtU, offset = 48, active = false, state = null, display, color = null, edgeOffset = true,
}) {
  if (w < 40 && h < 40) return null;
  const st = state || (active ? "active" : "normal");
  const off = edgeOffset ? Math.min(offset, Math.min(w, h) * 0.35) : offset;
  return (
    <g data-ui="dim">
      {w >= 40 && (
        <SegDim
          a={{ x, y }}
          b={{ x: x + w, y }}
          label={fmtU(w)}
          k={k}
          display={display}
          offset={off}
          offsetSide={-1}
          state={st}
          color={color}
          minLen={30}
        />
      )}
      {h >= 40 && (
        <SegDim
          a={{ x: x + w, y: y + h }}
          b={{ x, y: y + h }}
          label={fmtU(h)}
          k={k}
          display={display}
          offset={off}
          offsetSide={-1}
          state={st}
          color={color}
          minLen={30}
        />
      )}
    </g>
  );
}

/** Габариты объекта в цвет материала (не двери/проёмы). */
export function ItemDims({ it, k, fmtU, display, show = true }) {
  if (!show || it.dimensions?.display === false) return null;
  const color = it.color || WALL_DIM_COLOR;
  const cx = it.x + it.w / 2;
  const cy = it.y + it.h / 2;
  const isRound = it.shape === "round" || it.kind === "tank_round";
  if (isRound) {
    const d = Math.min(it.w, it.h);
    return (
      <g data-ui="dim-item" transform={`translate(${cx},${cy})`}>
        <SegDim
          a={{ x: -d / 2, y: 0 }}
          b={{ x: d / 2, y: 0 }}
          label={fmtU(d)}
          k={k}
          display={display}
          offset={d * 0.35}
          offsetSide={-1}
          color={color}
          minLen={30}
        />
      </g>
    );
  }
  return (
    <g data-ui="dim-item">
      <RectDims
        x={it.x}
        y={it.y}
        w={it.w}
        h={it.h}
        k={k}
        fmtU={fmtU}
        display={display}
        color={color}
        edgeOffset
      />
    </g>
  );
}

/** Размеры отступов до стен и препятствий. */
export function ClearanceDims({
  it, plan, k, fmtU, display, warnMm = DEFAULT_PASSAGE_WARN_MM, errorMm = DEFAULT_PASSAGE_ERROR_MM,
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
            display={display}
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
export function RoomOutlineDims({ room, k, fmtU, display }) {
  const o = dimEffectiveOffset(180, display);
  return (
    <g data-ui="dim">
      <SegDim a={{ x: 0, y: 0 }} b={{ x: room.w, y: 0 }} label={fmtU(room.w)} k={k} display={display} offset={o} offsetSide={-1} state="normal" color={WALL_DIM_COLOR} />
      <SegDim a={{ x: room.w, y: room.h }} b={{ x: 0, y: room.h }} label={fmtU(room.h)} k={k} display={display} offset={o} offsetSide={1} state="normal" color={WALL_DIM_COLOR} />
    </g>
  );
}

export function wallSegmentDimElements(wall, room, { k, fmtU, display, offset, state = "normal", keyPrefix = "" }) {
  if (!wall?.pts || wall.pts.length < 2) return { segs: [], total: 0 };
  let total = 0;
  const segs = [];
  for (let i = 1; i < wall.pts.length; i++) {
    const axisA = wall.pts[i - 1];
    const axisB = wall.pts[i];
    const { a, b } = wallSegDimPoints(axisA, axisB, wall, room);
    const len = wallSegDimLength(a, b);
    total += len;
    segs.push(
      <SegDim
        key={`${keyPrefix}${i}`}
        a={a}
        b={b}
        label={fmtU(len)}
        k={k}
        display={display}
        offset={dimEffectiveOffset(offset, display)}
        offsetSide={wallSegmentOffsetSide(axisA, axisB, room)}
        state={state}
        color={WALL_DIM_COLOR}
      />,
    );
  }
  return { segs, total };
}

/** Размеры выбранной стены (все сегменты + суммарная длина). */
export function WallSelectionDims({ wall, room, k, fmtU, display }) {
  if (!wall?.pts || wall.pts.length < 2) return null;
  const { segs, total } = wallSegmentDimElements(wall, room, {
    k,
    fmtU,
    display,
    offset: 150,
    state: "active",
    keyPrefix: "sel-",
  });
  const cx = wall.pts.reduce((s, p) => s + p.x, 0) / wall.pts.length;
  const cy = wall.pts.reduce((s, p) => s + p.y, 0) / wall.pts.length;
  return (
    <g data-ui="dim">
      {segs}
      {wall.pts.length > 2 && (
        <text x={cx} y={cy} fontSize={9 * dimEffectiveK(k, display)} textAnchor="middle" fill="#116355" fontWeight="600" style={{ fontFamily: "var(--mono)" }}>
          Σ {fmtU(total)}
        </text>
      )}
    </g>
  );
}

/** Цепочки размеров стен (чистовые/габаритные + общий габарит + толщина). */
export function WallDimChains({ walls, room, items, k, fmtU, display }) {
  const { chains, thickness, overall } = computeWallDimChains(walls, room, items, {
    showFinishing: display.showWallChainFinishing !== false,
    showGross: display.showWallChainGross !== false,
  });
  const all = [...chains, ...overall, ...thickness];
  if (!all.length) return null;
  return (
    <g data-ui="dim-wall-chains" pointerEvents="none">
      {all.map((seg) => (
        <SegDim
          key={seg.key}
          a={seg.a}
          b={seg.b}
          label={fmtU(Math.round(seg.len))}
          k={k}
          display={display}
          offset={seg.offset}
          offsetSide={seg.offsetSide}
          state="normal"
          color={WALL_DIM_COLOR}
          minLen={seg.kind === "thickness" ? 5 : 40}
        />
      ))}
    </g>
  );
}

/** Зафиксированная красная линейка. */
export function RulerEl({ ruler, k, fmtU, display, selected, onSel, onDel, onDragStart }) {
  if (!ruler?.a || !ruler?.b) return null;
  const len = Math.hypot(ruler.b.x - ruler.a.x, ruler.b.y - ruler.a.y);
  if (len < 1) return null;
  const handleDown = (e, end) => {
    e.stopPropagation();
    onDragStart?.(e, ruler.id, end);
  };
  return (
    <g data-ruler={ruler.id} pointerEvents="all">
      <line
        x1={ruler.a.x}
        y1={ruler.a.y}
        x2={ruler.b.x}
        y2={ruler.b.y}
        stroke="transparent"
        strokeWidth={14 * k}
        onPointerDown={(e) => {
          e.stopPropagation();
          if (e.button === 0) onDragStart?.(e, ruler.id, null);
          onSel?.(e, ruler.id);
        }}
        style={{ cursor: "move" }}
      />
      <SegDim
        a={ruler.a}
        b={ruler.b}
        label={fmtU(Math.round(len))}
        k={k}
        display={display}
        offset={0}
        offsetSide={1}
        color={RULER_COLOR}
        strokeWidthMul={1.2}
        minLen={1}
      />
      {selected && (
        <>
          <circle
            cx={ruler.a.x}
            cy={ruler.a.y}
            r={6 * k}
            fill="#fff"
            stroke={RULER_COLOR}
            strokeWidth={1.5 * k}
            onPointerDown={(e) => handleDown(e, "a")}
            style={{ cursor: "crosshair" }}
          />
          <circle
            cx={ruler.b.x}
            cy={ruler.b.y}
            r={6 * k}
            fill="#fff"
            stroke={RULER_COLOR}
            strokeWidth={1.5 * k}
            onPointerDown={(e) => handleDown(e, "b")}
            style={{ cursor: "crosshair" }}
          />
          <text
            x={ruler.b.x + 14 * k}
            y={ruler.b.y - 10 * k}
            fontSize={13 * k}
            fill="#a5371f"
            style={{ cursor: "pointer" }}
            onClick={(e) => { e.stopPropagation(); onDel?.(ruler.id); }}
          >
            ✕
          </text>
        </>
      )}
    </g>
  );
}

/** Черновик линейки при протягивании. */
export function RulerDraftEl({ a, b, k, fmtU, display, snapPt }) {
  if (!a || !b) return null;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return (
    <g data-ui="ruler-draft" pointerEvents="none">
      <SegDim
        a={a}
        b={b}
        label={fmtU(Math.round(len))}
        k={k}
        display={display}
        offset={0}
        offsetSide={1}
        color={RULER_COLOR}
        strokeWidthMul={1.2}
        minLen={1}
      />
      {snapPt?.snapped && (
        <circle cx={b.x} cy={b.y} r={5 * k} fill="none" stroke={RULER_COLOR} strokeWidth={1.2 * k} />
      )}
    </g>
  );
}
