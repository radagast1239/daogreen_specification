/**
 * PHASE 2F2.2–2F2.5 — MODE A overlay: magnetic rays + dynamic sectors.
 * Zoom-responsive fonts/arcs + translucent label chips. Pointer-events none.
 */
import React from "react";
import { presentCornerAngle } from "./core/dimensions/cornerAngleDimensions.js";
import {
  movementCornerArcRadiusMm,
  ANGLE_STROKE_MOVEMENT_PX,
  ANGLE_HALO_STROKE_PX,
  ANGLE_PAIR_STAGGER_PX,
  ANGLE_FONT_WEIGHT,
  screenPxToWorldMm,
} from "./core/dimensions/angleLabelPresentation.js";

const GUIDE = "#1a9e78";
const GUIDE_ACTIVE = "#0d7a5f";
const SECTOR = "#e0312a";
const HALO = "#ffffff";

function AngleValueLabel({ x, y, text, k, fontPx, chip = null }) {
  const fs = fontPx * k;
  const halo = ANGLE_HALO_STROKE_PX * k;
  return (
    <g data-ui="magnet-angle-label" pointerEvents="none">
      {chip && (
        <rect
          x={chip.x}
          y={chip.y}
          width={chip.width}
          height={chip.height}
          rx={chip.rx}
          ry={chip.ry}
          fill={chip.fill}
          opacity={chip.opacity}
          pointerEvents="none"
          data-ui="magnet-angle-chip"
          data-chip-opacity={chip.opacity}
        />
      )}
      <text
        x={x}
        y={y}
        fontSize={fs}
        textAnchor="middle"
        dominantBaseline="central"
        fill={SECTOR}
        fontWeight={ANGLE_FONT_WEIGHT}
        data-ui="magnet-angle-text"
        data-font-px={fontPx}
        data-font-weight={ANGLE_FONT_WEIGHT}
        style={{
          fontFamily: "var(--mono)",
          paintOrder: "stroke fill",
          stroke: HALO,
          strokeWidth: halo,
          strokeLinejoin: "round",
        }}
      >
        {text}
      </text>
    </g>
  );
}

/**
 * @param {{ preview: object|null, k: number, zoom?: number }} props
 */
export function AngleMagnetOverlay({ preview = null, k = 1, zoom = null }) {
  if (!preview?.active || !preview?.pivot) return null;
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : (k > 0 ? 1 / k : 1);
  const guides = preview.guides || [];
  const angles = (preview.angles || [])
    .filter((a) => a.sweepDeg < 170 && a.displayDeg !== 180);
  const strokeWorld = screenPxToWorldMm(ANGLE_STROKE_MOVEMENT_PX, z);
  const peers = [];
  const presented = [];
  for (let i = 0; i < angles.length; i++) {
    const a = angles[i];
    const p = presentCornerAngle(a, {
      zoom: z,
      mode: "movement",
      pairIndex: i,
      peerLabelPositions: peers,
      radiusMm: movementCornerArcRadiusMm(z, a.thk)
        + screenPxToWorldMm(i * ANGLE_PAIR_STAGGER_PX, z),
    });
    if (!p.valid) continue;
    peers.push(p.labelPos);
    presented.push(p);
  }

  return (
    <g data-ui="angle-magnets" data-snapped={preview.snapped ? "1" : "0"} pointerEvents="none">
      {guides.map((g, i) => (
        <line
          key={`mg-${i}-${g.angleDeg}`}
          x1={g.a.x}
          y1={g.a.y}
          x2={g.b.x}
          y2={g.b.y}
          stroke={g.active ? GUIDE_ACTIVE : GUIDE}
          strokeWidth={(g.active ? 1.6 : 1.15) * k}
          strokeDasharray={`${6 * k} ${5 * k}`}
          opacity={g.active ? 0.9 : 0.45}
          data-ui={g.active ? "magnet-ray-active" : "magnet-ray"}
          data-angle={g.angleDeg}
        />
      ))}
      {presented.map((p) => {
        const geom = p.geometry;
        const d = (geom?.points || [])
          .map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x} ${pt.y}`)
          .join(" ");
        const mid = p.startDeg + p.sweepDegArc / 2;
        const fillR = p.radius;
        const rad0 = (p.startDeg * Math.PI) / 180;
        const vx = p.angle.vertex.x;
        const vy = p.angle.vertex.y;
        const sectorPath = [
          `M ${vx} ${vy}`,
          `L ${vx + Math.cos(rad0) * fillR} ${vy + Math.sin(rad0) * fillR}`,
          d ? d.replace(/^M/, "L") : "",
          "Z",
        ].filter(Boolean).join(" ");
        return (
          <g
            key={p.angle.id}
            data-ui="magnet-angle"
            data-deg={p.displayDeg}
            data-sector={p.sectorKey}
            data-font-px={p.fontPx}
            data-arc-px={p.radiusScreenPx}
            data-arc-stroke-px={ANGLE_STROKE_MOVEMENT_PX}
          >
            {sectorPath && (
              <path d={sectorPath} fill={SECTOR} opacity={0.12} stroke="none" />
            )}
            {d && (
              <path
                d={d}
                fill="none"
                stroke={SECTOR}
                strokeWidth={strokeWorld}
                opacity={0.92}
              />
            )}
            {p.labelPos && (
              <AngleValueLabel
                x={p.labelPos.x}
                y={p.labelPos.y}
                text={p.text}
                k={k}
                fontPx={p.fontPx}
                chip={p.chip}
              />
            )}
            <title>{`${p.displayDeg}° @ ${mid.toFixed(1)}`}</title>
          </g>
        );
      })}
    </g>
  );
}
