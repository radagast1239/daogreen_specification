import React from "react";
import {
  zoomResponsiveGripRadiusPx,
  screenPxToWorldMm,
  NUDGE_ARROW_RING_PX,
  NUDGE_ARROW_VISUAL_R_PX,
  NUDGE_ARROW_HIT_R_PX,
} from "./core/viewport/gripScale.js";

/*
 * PHASE 2F2 — the text-only corner-angle helpers that used to live here
 * (wallCornerAnglesFor / WallCornerAngleLabels) are gone. Selected-wall angles
 * are now built by core/dimensions/cornerAngleDimensions.js and painted as arcs
 * by WallLiveMeasurementOverlay; movement magnets by AngleMagnetOverlay.
 */

const NUDGE_DIRS = [
  { dx: 0, dy: -1, chev: "M -5 3 L 0 -4 L 5 3", dir: "up" },
  { dx: 1, dy: 0, chev: "M -3 -5 L 4 0 L -3 5", dir: "right" },
  { dx: 0, dy: 1, chev: "M -5 -3 L 0 4 L 5 -3", dir: "down" },
  { dx: -1, dy: 0, chev: "M 3 -5 L -4 0 L 3 5", dir: "left" },
];

/**
 * LIVE4 RemPlanner-style active-grip controls:
 * circular centre (or endpoint) grip + four screen-space arrow buttons.
 * Geometry handles stay at true model positions; this is UI only.
 */
export function WallNudgePad({
  x,
  y,
  k = 1,
  zoom = null,
  stepMm = 10,
  onNudge,
  showCentreGrip = true,
  showArrows = true,
  disabledDirs = null,
}) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : (k > 0 ? 1 / k : 1);
  // LIVE4: centre grip visual scales with zoom; arrows stay screen-space UI.
  // LIVE4.5: ring / visual / hit radii share gripScale constants so knockout
  // math and painted chrome cannot drift apart.
  const centrePx = zoomResponsiveGripRadiusPx(z, { minPx: 5, maxPx: 14 });
  const centreR = screenPxToWorldMm(centrePx, z);
  const ring = screenPxToWorldMm(NUDGE_ARROW_RING_PX, z);
  const arrowR = screenPxToWorldMm(NUDGE_ARROW_VISUAL_R_PX, z);
  const hitR = screenPxToWorldMm(NUDGE_ARROW_HIT_R_PX, z);
  const strokeW = screenPxToWorldMm(Math.min(2.4, Math.max(1.2, centrePx * 0.16)), z);
  const hideArrows = !showArrows || z < 0.08;
  return (
    <g data-ui="wall-nudge" data-live4-grip-cluster="" pointerEvents="all">
      {showCentreGrip && (
        <circle
          cx={x}
          cy={y}
          r={centreR}
          fill="#fff"
          stroke="#c44a2f"
          strokeWidth={strokeW}
          pointerEvents="none"
          data-ui="wall-centre-grip"
          data-visual-px={centrePx.toFixed(2)}
        />
      )}
      {!hideArrows && NUDGE_DIRS.map(({ dx, dy, chev, dir }) => {
        const bx = x + dx * ring;
        const by = y + dy * ring;
        const disabled = disabledDirs?.has?.(dir) || disabledDirs?.includes?.(dir);
        return (
          <g
            key={dir}
            data-ui="wall-nudge-arrow"
            data-dir={dir}
            data-disabled={disabled ? "1" : "0"}
            style={{ cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.35 : 1 }}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              if (disabled) return;
              onNudge?.(dx * stepMm, dy * stepMm);
            }}
          >
            <circle cx={bx} cy={by} r={hitR} fill="transparent" stroke="none" />
            <circle
              cx={bx}
              cy={by}
              r={arrowR}
              fill="#f3f4f5"
              stroke="#9aa3a0"
              strokeWidth={screenPxToWorldMm(1.4, z)}
              pointerEvents="none"
            />
            <path
              d={chev}
              transform={`translate(${bx}, ${by}) scale(${screenPxToWorldMm(0.85, z)})`}
              fill="none"
              stroke="#c44a2f"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
              pointerEvents="none"
            />
          </g>
        );
      })}
    </g>
  );
}

export function WallEditOverlay({
  walls,
  selection,
  k,
  zoom = null,
  stepMm = 10,
  onNudge,
  /** When false, only arrows around an endpoint (endpoint already drawn by grip layer). */
  showCentreGrip = true,
}) {
  if (selection?.coll !== "walls" || selection.ids?.length !== 1) return null;
  const wall = walls.find((w) => w.id === selection.ids[0]);
  if (!wall?.pts?.length) return null;

  let nx = wall.pts.reduce((s, p) => s + p.x, 0) / wall.pts.length;
  let ny = wall.pts.reduce((s, p) => s + p.y, 0) / wall.pts.length;
  const nidx = selection.nodeIdx;
  let atCentre = true;
  if (nidx === -1 && wall.pts.length === 2) {
    nx = (wall.pts[0].x + wall.pts[1].x) / 2;
    ny = (wall.pts[0].y + wall.pts[1].y) / 2;
    atCentre = true;
  } else if (nidx != null && nidx >= 0 && wall.pts[nidx]) {
    nx = wall.pts[nidx].x;
    ny = wall.pts[nidx].y;
    atCentre = false;
  }

  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;

  return (
    <g data-ui="wall-edit-overlay" pointerEvents="none">
      <g pointerEvents="all">
        <WallNudgePad
          x={nx}
          y={ny}
          k={k}
          zoom={zoom}
          stepMm={stepMm}
          onNudge={onNudge}
          showCentreGrip={showCentreGrip && atCentre}
        />
      </g>
    </g>
  );
}
