/**
 * PHASE 2E.1 REWORK — endpoint grips as a dedicated TOP interaction layer.
 *
 * Manual acceptance failed on visibility, not on behaviour: the grips were
 * mounted and their hit targets worked, but WallEl emits them inside the wall
 * layer groups, and PlanPage paints WallMassLayer and WallsTopOverlay AFTER
 * those groups. SVG paints in document order, so the wall fill and the exterior
 * outline covered every marker — and a topology node always lies on the wall
 * centreline, so a marker of 10-12 screen px sat entirely inside a 100-200mm
 * wall. At a T-junction the host wall's mass covered the shared node too. The
 * control was reachable by guessing where it should be, and invisible.
 *
 * This layer is rendered after the wall mass, the outlines and the dimensions,
 * so the controls are always on top. It changes NOTHING about topology: each
 * control is drawn exactly at plan.nodes[nodeId]; no node is offset to make room
 * for a marker.
 *
 * Sizing is screen-space: every radius is multiplied by k = 1/zoom, so a grip is
 * the same size at every zoom level.
 */
import React from "react";
import {
  zoomResponsiveGripRadiusPx,
  gripHitRadiusWorld,
  GRIP_HIT_MIN_PX,
} from "./core/viewport/gripScale.js";

/** Visible marker / hit target, in SCREEN px (diameter). Legacy defaults. */
export const GRIP_MARKER_PX = 18;
export const GRIP_MARKER_HOVER_PX = 22;
export const GRIP_HIT_PX = GRIP_HIT_MIN_PX;

const GRIP_COLORS = {
  idle: { fill: "#ffd9dc", stroke: "#b3261e", width: 2 },
  hover: { fill: "#ffc4c9", stroke: "#8c1d18", width: 2.4 },
  active: { fill: "#ff9aa2", stroke: "#7a1710", width: 2.8 },
};

export const gripRadiusPx = (state) => (
  (state === "idle" ? GRIP_MARKER_PX : GRIP_MARKER_HOVER_PX) / 2
);

/**
 * One control per NODE.
 *
 * Two endpoints of the selection can resolve to the same topology node (a
 * corner where both selected walls meet, or the hovered wall sharing the
 * selected wall's node). Drawing one control per endpoint would stack identical
 * circles on the same point. The winner is deterministic — the selected wall
 * first, then the lower endpoint index — and it keeps the wallId/endpoint that
 * a drag must start from.
 *
 * @param {Array<{wallId:string, endpoint:0|1, grip:object, point:{x,y}, selected:boolean}>} entries
 */
export function dedupeGripsByNode(entries) {
  const byNode = new Map();
  for (const entry of entries) {
    const nodeId = entry.grip?.nodeId;
    if (!nodeId || !entry.point) continue;
    const prev = byNode.get(nodeId);
    if (!prev) {
      byNode.set(nodeId, entry);
      continue;
    }
    // selected wall wins; then the lower endpoint index — deterministic either way
    const better = (prev.selected === entry.selected)
      ? (entry.endpoint < prev.endpoint ? entry : prev)
      : (entry.selected ? entry : prev);
    byNode.set(nodeId, better);
  }
  return [...byNode.values()];
}

export const gripKey = (wallId, endpoint) => `${wallId}:${endpoint}`;

/**
 * PHASE 2F1 — ONE central handle for a LOGICAL wall split by T junctions.
 *
 * WallEl draws its handle at its own segment midpoint, which for a T-split host
 * meant two handles, each moving one half. A logical wall gets exactly one, at
 * the midpoint of the complete chain, drawn in this top layer for the same
 * reason the endpoint grips moved here: the wall mass would otherwise cover it.
 *
 * @param {{x:number,y:number}|null} point  full-chain midpoint (plan mm)
 */
export function WallChainMoveHandleLayer({
  point = null, wallId = null, logicalId = null, segmentCount = 0,
  k = 1, color = "#116355", active = false, onHandleDown, onHandleHover,
}) {
  if (!point || !wallId || segmentCount < 2) return null;
  return (
    <g
      data-ui="wall-chain-move-handle"
      data-wall-chain-move-handle=""
      data-wall-id={wallId}
      data-logical-id={logicalId || ""}
      data-segment-count={segmentCount}
    >
      <circle
        cx={point.x}
        cy={point.y}
        r={13 * k}
        fill="transparent"
        stroke="none"
        onPointerDown={(e) => onHandleDown?.(e)}
        onPointerEnter={() => onHandleHover?.(true)}
        onPointerLeave={() => onHandleHover?.(false)}
        style={{ cursor: "move" }}
      />
      <circle
        cx={point.x}
        cy={point.y}
        r={(active ? 6 : 5) * k}
        fill="#fff"
        stroke={color}
        strokeWidth={1.8 * k}
        strokeDasharray={`${4 * k} ${3 * k}`}
        pointerEvents="none"
      />
    </g>
  );
}

/**
 * @param {object}   props
 * @param {Array}    props.entries    from dedupeGripsByNode
 * @param {number}   props.k          1/zoom — screen-space scale
 * @param {string?}  props.activeKey  gripKey currently being dragged
 * @param {string?}  props.hoverKey   gripKey under the pointer
 * @param {Function} props.onGripDown (event, wallId, endpoint) — opens the drag
 * @param {Function} props.onGripHover(gripKey|null)
 */
export function WallEndpointGripLayer({
  entries = [], k = 1, zoom = null, activeKey = null, hoverKey = null, onGripDown, onGripHover,
}) {
  if (!entries.length) return null;
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : (k > 0 ? 1 / k : 1);
  return (
    <g data-ui="wall-endpoint-grips">
      {entries.map(({ wallId, endpoint, grip, point }) => {
        // Fail closed here too: a control is never drawn for an endpoint the
        // eligibility decision withheld, whatever the caller passed in.
        if (!grip?.visible || !grip.nodeId || !point) return null;
        const key = gripKey(wallId, endpoint);
        const state = activeKey === key ? "active" : (hoverKey === key ? "hover" : "idle");
        const color = GRIP_COLORS[state];
        // LIVE4: visual radius scales with zoom (bounded); hit stays ≥32px screen.
        const visualPx = zoomResponsiveGripRadiusPx(z, {
          minPx: state === "idle" ? 5 : 6,
          maxPx: state === "idle" ? 13 : (state === "hover" ? 14.5 : 15),
        });
        const r = visualPx / z;
        const hitR = gripHitRadiusWorld(z, GRIP_HIT_PX);
        const strokeW = Math.min(2.8, Math.max(1.2, visualPx * 0.18)) / z;
        return (
          <g
            key={key}
            data-wall-endpoint-grip=""
            data-ui="wall-endpoint-grip"
            data-wall-id={wallId}
            data-endpoint={endpoint === 0 ? "start" : "end"}
            data-node-id={grip.nodeId}
            data-grip-state={state}
            data-topology={grip.topology?.kind || ""}
            data-visual-px={visualPx.toFixed(2)}
          >
            {state === "active" && (
              <circle
                cx={point.x}
                cy={point.y}
                r={r + 6 / z}
                fill="rgba(179,38,30,0.16)"
                stroke={color.stroke}
                strokeWidth={1 / z}
                strokeDasharray={`${3 / z} ${3 / z}`}
                pointerEvents="none"
              />
            )}
            <circle
              cx={point.x}
              cy={point.y}
              r={hitR}
              fill="transparent"
              stroke="none"
              onPointerDown={(e) => onGripDown?.(e, wallId, endpoint)}
              onPointerEnter={() => onGripHover?.(key)}
              onPointerLeave={() => onGripHover?.(null)}
              style={{ cursor: "move" }}
            />
            <circle
              cx={point.x}
              cy={point.y}
              r={r}
              fill={color.fill}
              stroke={color.stroke}
              strokeWidth={strokeW}
              pointerEvents="none"
            />
          </g>
        );
      })}
    </g>
  );
}
