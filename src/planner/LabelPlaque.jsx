import React from "react";
import { labelFontSize } from "./labelProperties.js";
import { DG_THEME } from "./plannerVisualTheme.js";

/** Белая плашка подписи с тонкой рамкой и опциональной выноской. */
export function LabelPlaque({
  x,
  y,
  lines,
  k,
  zoom,
  selected = false,
  onDown,
  leaderTo = null,
  leaderFrom = null,
  align = "center",
}) {
  if (!lines?.length) return null;
  const fs = labelFontSize(k, zoom);
  const padX = 6 * k;
  const padY = 5 * k;
  const lineH = fs * 1.35;
  const w = Math.max(90 * k, ...lines.map((s) => s.length * fs * 0.58)) + padX * 2;
  const h = lines.length * lineH + padY * 2;
  const lx = align === "center" ? x - w / 2 : x;
  const ly = y;
  const anchor = leaderFrom || { x: lx + w / 2, y: ly + h / 2 };
  const stroke = selected ? DG_THEME.brand : DG_THEME.labelBorder;
  const sw = (selected ? 1.2 : 1) * k;

  return (
    <g data-ui="label-plaque">
      {leaderTo && (
        <line
          x1={anchor.x}
          y1={anchor.y}
          x2={leaderTo.x}
          y2={leaderTo.y}
          stroke={DG_THEME.labelLeader}
          strokeWidth={0.9 * k}
          pointerEvents="none"
        />
      )}
      <rect
        x={lx}
        y={ly}
        width={w}
        height={h}
        rx={3 * k}
        fill="#fff"
        fillOpacity={0.97}
        stroke={stroke}
        strokeWidth={sw}
        onPointerDown={onDown}
        style={{ cursor: onDown ? "move" : "default" }}
      />
      {lines.map((s, i) => (
        <text
          key={i}
          x={lx + padX}
          y={ly + padY + lineH * (i + 0.85)}
          fontSize={fs}
          fill={DG_THEME.labelText}
          fontWeight={i === 0 ? 600 : 400}
          pointerEvents="none"
        >
          {s}
        </text>
      ))}
    </g>
  );
}
