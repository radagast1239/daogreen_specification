import React from "react";
import {
  PORT_TYPES,
  portPosition,
  serviceZoneElements,
  objectStatusStyle,
  defaultPortsForKind,
  ZONE_VIS,
} from "./objectProperties.js";
import { SEL_COLORS } from "./selectionVisuals.js";

export function ServiceZoneEl({ it, k }) {
  const zones = serviceZoneElements(it);
  if (!zones.length) return null;
  return (
    <g pointerEvents="none" data-ui="service-zone">
      {zones.map((z) => {
        const vis = ZONE_VIS[z.type] || ZONE_VIS.service;
        if (z.polygon?.length >= 3) {
          const d = `M ${z.polygon.map((p) => `${p.x} ${p.y}`).join(" L ")} Z`;
          return (
            <path
              key={z.id}
              d={d}
              fill={vis.fill}
              fillOpacity={vis.fillOpacity}
              stroke={vis.stroke}
              strokeWidth={0.9 * k}
              strokeDasharray={z.type === "swing" ? `${5 * k} ${4 * k}` : `${6 * k} ${4 * k}`}
              opacity={0.9}
              data-zone-type={z.type}
            />
          );
        }
        return (
          <rect
            key={z.id}
            x={z.x}
            y={z.y}
            width={z.w}
            height={z.h}
            fill={vis.fill}
            fillOpacity={vis.fillOpacity}
            stroke={vis.stroke}
            strokeWidth={0.9 * k}
            strokeDasharray={`${6 * k} ${4 * k}`}
            opacity={0.85}
            data-zone-type={z.type}
          />
        );
      })}
    </g>
  );
}

export function PortMarkers({ it, k, show }) {
  if (!show) return null;
  const ports = it.ports?.length ? it.ports : defaultPortsForKind(it.kind);
  if (!ports.length) return null;
  return (
    <g pointerEvents="none" data-ui="ports">
      {ports.map((port, i) => {
        const pt = portPosition(it, port);
        const st = PORT_TYPES[port.type] || PORT_TYPES.water;
        const r = 5 * k;
        return (
          <g key={`${port.type}-${i}`}>
            <circle cx={pt.x} cy={pt.y} r={r + 2 * k} fill="#fff" stroke={st.color} strokeWidth={1.2 * k} />
            <circle cx={pt.x} cy={pt.y} r={r * 0.55} fill={st.color} />
            <text
              x={pt.x + pt.nx * (r + 8 * k)}
              y={pt.y + pt.ny * (r + 8 * k) + 3 * k}
              fontSize={7.5 * k}
              textAnchor="middle"
              fill={st.color}
              fontWeight="600"
            >
              {st.short}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export function StatusBadge({ it, k, cx, cy }) {
  const st = objectStatusStyle(it.objectStatus);
  if (!it.objectStatus || it.objectStatus === "draft" || it.objectStatus === "approved") return null;
  return (
    <g pointerEvents="none">
      <rect
        x={cx - 28 * k}
        y={cy - 22 * k}
        width={56 * k}
        height={12 * k}
        rx={2 * k}
        fill="#fff"
        stroke={st.color}
        strokeWidth={0.8 * k}
      />
      <text x={cx} y={cy - 13 * k} fontSize={7 * k} textAnchor="middle" fill={st.color} fontWeight="600">
        {st.label}
      </text>
    </g>
  );
}

/** Иконки состояния в углу объекта: замок, глаз, спецификация, предупреждение. */
export function ItemStateIcons({
  it, k, locked, hiddenClient, inSpec, hasWarning, hasError, showReview, display,
}) {
  if (display?.showStateIcons === false) return null;
  const icons = [];
  const x0 = it.x + it.w - 4 * k;
  let ox = 0;
  const sz = 10 * k;
  const gap = 2 * k;

  const pushIcon = (key, node) => {
    icons.push(<g key={key} transform={`translate(${x0 - ox - sz}, ${it.y + 3 * k})`}>{node}</g>);
    ox += sz + gap;
  };

  if (locked) {
    pushIcon("lock", (
      <g pointerEvents="none">
        <rect width={sz} height={sz} rx={2 * k} fill="#fff" stroke={SEL_COLORS.locked} strokeWidth={0.7 * k} />
        <rect x={3 * k} y={4.5 * k} width={4 * k} height={3.5 * k} fill="none" stroke={SEL_COLORS.locked} strokeWidth={0.8 * k} rx={0.5 * k} />
        <path d={`M ${3.5 * k} 4.5 L ${3.5 * k} 3.2 Q ${5 * k} 1.8 ${6.5 * k} 3.2 L ${6.5 * k} 4.5`} fill="none" stroke={SEL_COLORS.locked} strokeWidth={0.8 * k} />
      </g>
    ));
  }
  if (hiddenClient) {
    pushIcon("eye", (
      <g pointerEvents="none">
        <rect width={sz} height={sz} rx={2 * k} fill="#fff" stroke={SEL_COLORS.hidden} strokeWidth={0.7 * k} />
        <ellipse cx={5 * k} cy={5 * k} rx={3 * k} ry={2 * k} fill="none" stroke={SEL_COLORS.hidden} strokeWidth={0.8 * k} />
        <line x1={2 * k} y1={8 * k} x2={8 * k} y2={2 * k} stroke={SEL_COLORS.hidden} strokeWidth={0.9 * k} />
      </g>
    ));
  }
  if (hasWarning && !hasError) {
    pushIcon("warn", (
      <g pointerEvents="none">
        <polygon
          points={`${5 * k},${1 * k} ${9 * k},${9 * k} ${1 * k},${9 * k}`}
          fill="#fff"
          stroke={SEL_COLORS.warning}
          strokeWidth={0.8 * k}
        />
        <text x={5 * k} y={7.5 * k} fontSize={6 * k} textAnchor="middle" fill={SEL_COLORS.warning} fontWeight="700">!</text>
      </g>
    ));
  }
  if (showReview) {
    pushIcon("review", (
      <circle cx={5 * k} cy={5 * k} r={4 * k} fill={SEL_COLORS.warning} opacity={0.9} pointerEvents="none" />
    ));
  }
  if (inSpec) {
    pushIcon("spec", (
      <g pointerEvents="none">
        <rect width={sz} height={sz} rx={2 * k} fill="#fff" stroke={SEL_COLORS.spec} strokeWidth={0.7 * k} />
        <path d={`M ${2.5 * k} ${5.5 * k} L ${4.5 * k} ${7.5 * k} L ${7.5 * k} ${3 * k}`} fill="none" stroke={SEL_COLORS.spec} strokeWidth={1 * k} />
      </g>
    ));
  } else if (it.includedInProject !== false && (it.specMode || "custom") === "custom") {
    pushIcon("nospec", (
      <circle cx={5 * k} cy={5 * k} r={3 * k} fill={SEL_COLORS.noSpec} opacity={0.55} pointerEvents="none" />
    ));
  }

  if (!icons.length) return null;
  return <g data-ui="state-icons">{icons}</g>;
}
