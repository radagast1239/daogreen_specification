import React from "react";
import { wallMaterialById, wallMaterialPatternId } from "./catalog.js";
import { WALL_ACTIVE_STROKE } from "./wallRender.jsx";

/** Превью-кубик сечения стены у курсора (до первой точки). */
export function WallCursorPreview({ cursor, materialId, thk, k }) {
  if (!cursor) return null;
  const mat = wallMaterialById(materialId);
  const size = Math.max(14 * k, Math.min(thk * k * 0.55, 28 * k));
  const x = cursor.x + 18 * k;
  const y = cursor.y - size / 2;
  const fill = `url(#${wallMaterialPatternId(mat.id)})`;
  return (
    <g pointerEvents="none" data-ui="wall-cursor-preview">
      <rect
        x={x - 1.5 * k}
        y={y - 1.5 * k}
        width={size + 3 * k}
        height={size + 3 * k}
        rx={2 * k}
        fill="#fff"
        stroke="#d9e0dc"
        strokeWidth={1 * k}
      />
      <rect x={x} y={y} width={size} height={size} fill="#ffffff" stroke={mat.color} strokeWidth={1.2 * k} />
      <rect x={x} y={y} width={size} height={size} fill={fill} stroke="none" opacity={0.95} />
    </g>
  );
}

/** Красный круг захвата + зелёная зона выравнивания. */
export function WallSnapIndicator({ cursor, snapPt, k, angleSnapOn = false }) {
  if (!cursor || !snapPt?.snapped) return null;
  const snapType = snapPt.type || snapPt.kind;
  const isClose = snapType === "close";
  const isVertex = snapType === "vertex" || snapType === "wall-end";
  const isWallLine = snapType === "wall-line" || snapType === "wall-mid";
  const isExt = snapType === "wall-extension";
  const isPerp = snapType === "perpendicular";
  const isAngle = snapType === "angle" || snapType === "parallel";
  const primary = "#116355";
  const accent = "#1a9e78";
  const r = (isClose ? 10 : 7) * k;
  return (
    <g pointerEvents="none" data-ui="wall-snap">
      {(angleSnapOn || isAngle || isExt) && (
        <circle cx={cursor.x} cy={cursor.y} r={r * 2.2} fill={accent} opacity={0.1} />
      )}
      {(isVertex || isClose) && (
        <circle cx={cursor.x} cy={cursor.y} r={r} fill="none" stroke={primary} strokeWidth={2.2 * k} opacity={0.95} />
      )}
      {isWallLine && (
        <>
          <circle cx={cursor.x} cy={cursor.y} r={5 * k} fill="#fff" stroke={primary} strokeWidth={1.8 * k} />
          <circle cx={cursor.x} cy={cursor.y} r={1.8 * k} fill={primary} />
        </>
      )}
      {isPerp && (
        <path
          d={`M ${cursor.x - 8 * k} ${cursor.y + 8 * k} L ${cursor.x - 8 * k} ${cursor.y - 2 * k} L ${cursor.x + 2 * k} ${cursor.y - 2 * k}`}
          fill="none"
          stroke={accent}
          strokeWidth={1.8 * k}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {isExt && (
        <line
          x1={cursor.x - 14 * k}
          y1={cursor.y}
          x2={cursor.x + 14 * k}
          y2={cursor.y}
          stroke={accent}
          strokeWidth={1.5 * k}
          strokeDasharray={`${4 * k} ${3 * k}`}
          opacity={0.85}
        />
      )}
      {isClose && (
        <text x={cursor.x} y={cursor.y - 14 * k} fontSize={10 * k} textAnchor="middle" fill={primary} fontWeight="600">
          Замкнуть помещение
        </text>
      )}
      {!isClose && snapPt.label && (
        <text x={cursor.x + 10 * k} y={cursor.y - 10 * k} fontSize={9 * k} textAnchor="start" fill={primary} fontWeight="600">
          {snapPt.label}
        </text>
      )}
    </g>
  );
}

/** Зелёные пунктирные направляющие при черчении стены. */
export function WallAlignmentGuides({ guides = [], k, bounds }) {
  if (!guides.length) return null;
  const pad = 80000;
  return (
    <g pointerEvents="none" data-ui="wall-guides" opacity={0.55}>
      {guides.map((g, i) => (
        g.type === "V" ? (
          <line
            key={`vg-${i}`}
            x1={g.at}
            y1={g.y0 ?? bounds?.t ?? -pad}
            x2={g.at}
            y2={g.y1 ?? bounds?.b ?? pad}
            stroke="#116355"
            strokeWidth={1.2 * k}
            strokeDasharray={`${6 * k} ${5 * k}`}
          />
        ) : (
          <line
            key={`hg-${i}`}
            x1={g.x0 ?? bounds?.l ?? -pad}
            y1={g.at}
            x2={g.x1 ?? bounds?.r ?? pad}
            y2={g.at}
            stroke="#116355"
            strokeWidth={1.2 * k}
            strokeDasharray={`${6 * k} ${5 * k}`}
          />
        )
      ))}
    </g>
  );
}

function arcPath(cx, cy, r, startDeg, endDeg) {
  const s = (startDeg * Math.PI) / 180;
  const e = (endDeg * Math.PI) / 180;
  const x1 = cx + r * Math.cos(s);
  const y1 = cy + r * Math.sin(s);
  const x2 = cx + r * Math.cos(e);
  const y2 = cy + r * Math.sin(e);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

/** Угол красным с дугой у узла стыка. */
export function WallAngleLabels({ nodePt, angles = [], k }) {
  if (!nodePt || !angles.length) return null;
  const r = 42 * k;
  return (
    <g pointerEvents="none" data-ui="wall-angles">
      {angles.map((deg, i) => {
        const start = i * 35 - 20;
        const labelR = r + 14 * k + i * 10 * k;
        const mid = start + deg / 2;
        const lx = nodePt.x + labelR * Math.cos((mid * Math.PI) / 180);
        const ly = nodePt.y + labelR * Math.sin((mid * Math.PI) / 180);
        return (
          <g key={`ang-${i}-${deg}`}>
            <path
              d={arcPath(nodePt.x, nodePt.y, r + i * 8 * k, start, start + deg)}
              fill="none"
              stroke="#e0312a"
              strokeWidth={1.4 * k}
              opacity={0.85}
            />
            <text x={lx} y={ly} fontSize={10 * k} textAnchor="middle" fill="#e0312a" fontWeight="600">
              {deg.toFixed(1)}°
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Живые чипы H= (синий) и S= (красный). */
export function WallLiveChips({ cursor, roomHeight, areaM2, k }) {
  if (!cursor) return null;
  const hCm = Math.round((roomHeight || 2700) / 10);
  const chips = [
    { label: `H=${hCm}`, color: "#2f6f8f", bg: "#e8f4fa" },
  ];
  if (areaM2 != null && areaM2 > 0) {
    chips.push({ label: `S=${areaM2.toFixed(2)} м²`, color: "#e0312a", bg: "#fdecea" });
  }
  const chipH = 20 * k;
  const gap = 6 * k;
  let x = cursor.x + 24 * k;
  const y = cursor.y + 28 * k;
  return (
    <g pointerEvents="none" data-ui="wall-chips">
      {chips.map((c, i) => {
        const w = Math.max(52 * k, c.label.length * 6.2 * k);
        const cx = x;
        x += w + gap;
        return (
          <g key={c.label} transform={`translate(${cx},${y})`}>
            <rect x={0} y={0} width={w} height={chipH} rx={chipH / 2} fill={c.bg} stroke={c.color} strokeWidth={0.8 * k} opacity={0.95} />
            <text x={w / 2} y={chipH * 0.68} fontSize={10 * k} textAnchor="middle" fill={c.color} fontWeight="600">
              {c.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export { WALL_ACTIVE_STROKE };
