/**
 * PHASE 2F1-LIVE — RemPlanner-style transient live measurement overlay.
 * Renders labels from buildLiveWallDrawMeasurements / buildLiveWallEditMeasurements.
 * Never persists dimensions.
 */
import React from "react";
import { SegDim } from "./dimensionMarkers.jsx";
import { prioritizeLiveLabels } from "./core/walls/liveWallMeasurements.js";
import { resolveViewportLod } from "./core/grid/adaptiveGrid.js";
import {
  nearWallLaneOffsetMm,
  solveSelectedWallDimPresentation,
  // Draft-time (pre-face) labels only — see the solve block below.
  chooseLabelTAlongWall,
  NEAR_LANE_MAX_PX,
  INTERACTION_OCCUPANCY_PX,
  visibleCentreKnockoutRadiusPx,
} from "./core/dimensions/selectedDimLayout.js";
import { presentSelectedCornerAngles } from "./core/dimensions/cornerAngleDimensions.js";
import {
  ANGLE_HALO_STROKE_PX,
  ANGLE_STROKE_SELECTED_PX,
  ANGLE_FONT_WEIGHT,
  angleGripOccupancy,
  screenPxToWorldMm,
} from "./core/dimensions/angleLabelPresentation.js";

const PRIMARY = "#14201b";
const ACCENT_ANGLE = "#e0312a";
const SNAP_OK = "#116355";
const HALO = "#ffffff";

function HaloText({ x, y, text, k, fill = PRIMARY, fontSize = 11, weight = 700, anchor = "middle" }) {
  const fs = fontSize * k;
  return (
    <text
      x={x}
      y={y}
      fontSize={fs}
      textAnchor={anchor}
      fill={fill}
      fontWeight={weight}
      style={{ fontFamily: "var(--mono)", paintOrder: "stroke", stroke: HALO, strokeWidth: 3.2 * k }}
    >
      {text}
    </text>
  );
}

/**
 * PHASE 2F2.4–2F2.5 — zoom-responsive angle value + compact translucent chip.
 * Chip then text (DOM order). pointer-events none.
 */
function AngleValueLabel({ x, y, text, k, fontPx, chip = null }) {
  const fs = fontPx * k;
  const halo = ANGLE_HALO_STROKE_PX * k;
  return (
    <g data-ui="corner-angle-label" pointerEvents="none">
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
          data-ui="corner-angle-chip"
          data-chip-opacity={chip.opacity}
        />
      )}
      <text
        x={x}
        y={y}
        fontSize={fs}
        textAnchor="middle"
        dominantBaseline="central"
        fill={ACCENT_ANGLE}
        fontWeight={ANGLE_FONT_WEIGHT}
        data-ui="corner-angle-text"
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

function thicknessMark({ start, end, thk, k, text }) {
  if (!start || !end || !(thk > 0)) return null;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const half = thk / 2;
  const a = { x: end.x - nx * half, y: end.y - ny * half };
  const b = { x: end.x + nx * half, y: end.y + ny * half };
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  return (
    <g data-ui="live-thk" pointerEvents="none">
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={PRIMARY} strokeWidth={1.2 * k} />
      <line
        x1={a.x - nx * 4 * k}
        y1={a.y - ny * 4 * k}
        x2={a.x + nx * 4 * k}
        y2={a.y + ny * 4 * k}
        stroke={PRIMARY}
        strokeWidth={1.1 * k}
      />
      <line
        x1={b.x - nx * 4 * k}
        y1={b.y - ny * 4 * k}
        x2={b.x + nx * 4 * k}
        y2={b.y + ny * 4 * k}
        stroke={PRIMARY}
        strokeWidth={1.1 * k}
      />
      <HaloText x={mx + nx * 14 * k} y={my + ny * 14 * k} text={text} k={k} fontSize={10} weight={600} />
    </g>
  );
}

/**
 * @param {{ measurements: object|null, k: number, maxLabels?: number, hideContext?: boolean }} props
 */
export function WallLiveMeasurementOverlay({
  measurements = null,
  k = 1,
  zoom = null,
  maxLabels = 8,
  hideContext = false,
  /** LIVE3: floating editor owns the numeric value — hide duplicate canvas label. */
  hidePrimaryLabel = false,
  /** Near-wall lane offset (mm). LIVE4.1: bounded screen→world, not 240+ dodge. */
  primaryOffsetMm = null,
  hideThicknessMarks = false,
}) {
  // LIVE4.2 — last valid wall-local placement, so camera-only frames retain
  // their layout instead of re-running the candidate search every wheel event.
  const layoutStateRef = React.useRef(null);
  const layoutWallRef = React.useRef(null);
  // PHASE 2F2.4 — angle LOD show/hide hysteresis across zoom frames.
  const angleVisibleRef = React.useRef(false);
  if (!measurements?.labels?.length) return null;
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : (k > 0 ? 1 / k : 1);
  const lod = resolveViewportLod(z);
  const laneMm = Number.isFinite(primaryOffsetMm) && primaryOffsetMm > 0
    ? Math.min(primaryOffsetMm, NEAR_LANE_MAX_PX / z)
    : nearWallLaneOffsetMm(z);
  const wallMid = measurements.a && measurements.b
    ? {
      x: (measurements.a.x + measurements.b.x) / 2,
      y: (measurements.a.y + measurements.b.y) / 2,
    }
    : (measurements.start && measurements.end
      ? {
        x: (measurements.start.x + measurements.end.x) / 2,
        y: (measurements.start.y + measurements.end.y) / 2,
      }
      : null);
  let labels = prioritizeLiveLabels(measurements.labels, maxLabels);
  if (hideContext) labels = labels.filter((l) => l.role !== "context");
  // LIVE4.4: float/command ownership may hide the draw "primary" length, but
  // never strips physical-face descriptors. Selected dual-face sets stay atomic
  // whether the float editor is open or closed.
  if (hidePrimaryLabel) {
    labels = labels.filter((l) => !(l.role === "primary" && l.kind !== "face"));
  }
  if (hideThicknessMarks) labels = labels.filter((l) => l.kind !== "thickness");
  // LIVE4 LOD: overview may drop angles; dual physical faces stay at normal/
  // detail. Extreme overview collapse of a secondary face is presentation-only
  // and never feeds back into semantic suppression (PlanPage Stage A).
  // PHASE 2F2: corner arcs render from measurements.cornerAngles (not labels),
  // so label LOD no longer strips kind=corner at normal editing zoom.
  if (lod === "overview") {
    labels = labels.filter((l) => l.kind === "face" || l.role === "primary");
    const faces = labels.filter((l) => l.kind === "face");
    if (faces.length > 1) {
      const keep = faces.find((l) => l.exterior) || faces[0];
      labels = labels.filter((l) => l.kind !== "face" || l === keep);
    }
  }
  // Prefer arc overlay for semantic corner angles; suppress duplicate text chips.
  if (measurements.cornerAngles?.length) {
    labels = labels.filter((l) => l.kind !== "corner");
  }

  // LIVE4.2 — ONE wall-local presentation solve per frame, for every wall role
  // and orientation. Face lanes, text positions and knockouts all come from it;
  // nothing below re-derives placement from screen x/y.
  //
  // Scope: labels of a RESOLVED physical face (kind "face"). Draft-time labels
  // — the draw command length, the draw-preview L/R faces, host/context spans —
  // have no resolved physical face yet and keep their existing draft placement;
  // they are not a second presentation algorithm for selected walls.
  const faceInputs = labels
    .filter((l) => l.kind === "face" && l.a && l.b)
    .map((l) => ({ id: l.id, a: l.a, b: l.b, faceKey: l.face ?? null }));
  const wallKey = measurements.wallId
    ? `${measurements.wallId}:${faceInputs.map((f) => f.id).join(",")}`
    : null;
  if (layoutWallRef.current !== wallKey) {
    layoutWallRef.current = wallKey;
    layoutStateRef.current = null;
  }
  const solved = (measurements.a && measurements.b && faceInputs.length)
    ? solveSelectedWallDimPresentation({
      faces: faceInputs,
      wallA: measurements.a,
      wallB: measurements.b,
      zoom: z,
      laneMm,
      // Interaction occupancy (≥ hit) for label dodge only; visualClearPx drives
      // the painted dimension-line gap and must stay on visible chrome.
      occupancy: wallMid ? [{
        point: wallMid,
        clearPx: INTERACTION_OCCUPANCY_PX,
        visualClearPx: visibleCentreKnockoutRadiusPx(z),
      }] : [],
      previous: layoutStateRef.current,
    })
    : null;
  if (solved) layoutStateRef.current = solved.state;

  // PHASE 2F2.4 — visible-grip dodge + LOD hysteresis (independent of grid overview).
  const angleOccupancy = (measurements.cornerAngles || [])
    .map((a) => angleGripOccupancy(a.vertex, z, "selected"))
    .filter(Boolean);
  const cornerStrokeWorld = screenPxToWorldMm(ANGLE_STROKE_SELECTED_PX, z);
  const cornerPresented = presentSelectedCornerAngles(measurements.cornerAngles || [], {
    zoom: z,
    mode: "selected",
    occupancy: angleOccupancy,
    wasVisible: angleVisibleRef.current,
  });
  angleVisibleRef.current = cornerPresented.length > 0;

  // PHASE 2F2.5 — paint order inside this overlay (DOM = SVG stack):
  // 1) linear / face dims  2) angle arcs+chips+text.
  // Parent PlanPage places this group after DimensionsLayer and before grips.
  const linearDimNodes = labels.map((lab) => {
    if (lab.kind === "thickness" && lab.start && lab.end) {
      return (
        <React.Fragment key={lab.id}>
          {thicknessMark({
            start: lab.start,
            end: lab.end,
            thk: lab.mm,
            k,
            text: lab.text,
          })}
        </React.Fragment>
      );
    }
    if ((lab.kind === "corner" || lab.kind === "direction") && lab.at) {
      const fill = lab.snapped ? SNAP_OK : ACCENT_ANGLE;
      return (
        <HaloText
          key={lab.id}
          x={lab.at.x + 18 * k}
          y={lab.at.y - 14 * k}
          text={lab.text}
          k={k}
          fill={fill}
          fontSize={lab.role === "primary" ? 12 : 11}
          weight={lab.snapped ? 700 : 600}
          anchor="start"
        />
      );
    }
    if (lab.kind === "host_total") {
      const mid = measurements.host?.a && measurements.host?.b
        ? {
          x: (measurements.host.a.x + measurements.host.b.x) / 2,
          y: (measurements.host.a.y + measurements.host.b.y) / 2,
        }
        : null;
      if (!mid) return null;
      return (
        <HaloText
          key={lab.id}
          x={mid.x}
          y={mid.y - 22 * k}
          text={lab.text}
          k={k}
          fill={PRIMARY}
          fontSize={10}
          weight={600}
        />
      );
    }
    if (lab.a && lab.b && (lab.role === "primary" || lab.role === "secondary" || lab.role === "context")) {
      const isPrimary = lab.role === "primary";
      const isFace = lab.kind === "face";
      const placed = solved?.byId?.[lab.id] || null;
      // LIVE4.2: near-wall lane + along-wall text + line knockout, all from
      // the one wall-local solver. `placed.offsetSide` carries the dim line
      // AWAY from the wall along this face's own normal — the pre-4.2 code
      // used the face's INVERTED normal, so at every zoom below ~0.44 the
      // lane (22px/zoom mm) exceeded half the wall thickness and each face's
      // value was drawn over the opposite face.
      const faceOffset = isFace || isPrimary ? laneMm : Math.min(100, laneMm * 1.2);
      const side = placed
        ? placed.offsetSide
        : (lab.offsetSide ?? (isFace && lab.face === "B" ? 1 : -1));
      const labelT = placed
        ? placed.labelT
        : ((isFace || isPrimary) && wallMid
          ? chooseLabelTAlongWall({
            a: lab.a,
            b: lab.b,
            zoom: z,
            occupyWorld: wallMid,
            clearPx: 30,
          })
          : 0.5);
      return (
        <SegDim
          key={lab.id}
          a={lab.a}
          b={lab.b}
          label={lab.text}
          k={k}
          offset={faceOffset}
          offsetSide={side}
          labelT={labelT}
          knockoutCluster={isFace || isPrimary ? wallMid : null}
          knockoutClusterRadiusPx={
            isFace || isPrimary
              ? (placed?.visualClearPx ?? visibleCentreKnockoutRadiusPx(z))
              : null
          }
          active={isPrimary}
          state={isPrimary ? "active" : "draft"}
          color={PRIMARY}
          labelColor={PRIMARY}
          strokeWidthMul={isPrimary ? 1.15 : 1}
        />
      );
    }
    return null;
  });

  const angleNodes = cornerPresented.map((p) => {
    const geom = p.geometry;
    const d = (geom?.points || [])
      .map((pt, i) => `${i === 0 ? "M" : "L"}${pt.x} ${pt.y}`)
      .join(" ");
    return (
      <g
        key={p.angle.id}
        data-ui="corner-angle"
        data-sector={p.sectorKey}
        data-deg={p.displayDeg}
        data-font-px={p.fontPx}
        data-arc-px={p.radiusScreenPx}
        data-arc-stroke-px={ANGLE_STROKE_SELECTED_PX}
        pointerEvents="none"
      >
        {(p.ticks || []).map((t, i) => (
          <line
            key={`tick-${i}`}
            x1={t.a.x}
            y1={t.a.y}
            x2={t.b.x}
            y2={t.b.y}
            stroke={ACCENT_ANGLE}
            strokeWidth={cornerStrokeWorld}
            opacity={0.9}
          />
        ))}
        {d && (
          <path
            d={d}
            fill="none"
            stroke={ACCENT_ANGLE}
            strokeWidth={cornerStrokeWorld}
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
      </g>
    );
  });

  return (
    <g data-ui="wall-live-measurements" pointerEvents="none">
      <g data-ui="wall-live-linear-dims" pointerEvents="none">
        {linearDimNodes}
      </g>
      <g data-ui="wall-live-corner-angles" pointerEvents="none">
        {angleNodes}
      </g>
    </g>
  );
}

export default WallLiveMeasurementOverlay;
