import React from "react";
import { SEL_COLORS } from "./selectionVisuals.js";

/** Компактные ручки 6×6 px и поворот сверху (CAD-стиль). */
export function SelectionHandles({
  it, k, locked, onResizeCorner, onResizeW, onResizeH, onRotateStart,
}) {
  if (locked) return null;
  const { x, y, w, h } = it;
  const cx = x + w / 2;
  const hs = 6 * k;
  const stroke = SEL_COLORS.select;
  const sw = 1 * k;
  const fill = "#fff";

  const handleRect = (hx, hy, cursor, onDown) => (
    <rect
      x={hx}
      y={hy}
      width={hs}
      height={hs}
      fill={fill}
      stroke={stroke}
      strokeWidth={sw}
      onPointerDown={onDown}
      style={{ cursor }}
    />
  );

  return (
    <g data-ui="selection-handles">
      <rect
        x={x - 1.5 * k}
        y={y - 1.5 * k}
        width={w + 3 * k}
        height={h + 3 * k}
        fill="none"
        stroke={stroke}
        strokeWidth={0.9 * k}
        strokeDasharray={`${3 * k} ${2.5 * k}`}
        pointerEvents="none"
      />
      {handleRect(x + w - hs, y + h - hs, "nwse-resize", onResizeCorner)}
      {onResizeW && handleRect(x + w - hs / 2, y + h / 2 - hs / 2, "ew-resize", onResizeW)}
      {onResizeH && handleRect(x + w / 2 - hs / 2, y + h - hs, "ns-resize", onResizeH)}
      {handleRect(cx - hs / 2, y - 24 * k - hs / 2, "grab", onRotateStart)}
      <line x1={cx} y1={y} x2={cx} y2={y - 24 * k} stroke={stroke} strokeWidth={0.8 * k} pointerEvents="none" />
    </g>
  );
}
