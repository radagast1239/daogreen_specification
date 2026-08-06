import React from "react";
import { openingRangesOnSegment, wallDrawRanges, lerpPt } from "./doorGeometry.js";
import {
  wallFacePoint, wallFaceSegment, inwardNormal, wallFaceDistances,
} from "./wallParallelGeometry.js";
import { wallInnerFaceStrokeWidth, wallVisualStyle } from "./wallTypes.js";
import { wallVisualFromDisplay } from "./plannerVisualSettings.js";
import { WALL_MATERIALS, wallMaterialById, wallMaterialPatternId } from "./catalog.js";
import {
  stemTeeGapsOnSegment,
  teeOutlineTrimAtPoint,
  combineOpeningAndTeeGaps,
} from "./wallJoins.js";
import { slabFromMiterQuad, wallGeometryMap, contourSegment } from "./buildWallGeometry.js";
import { buildWallMassGeometry } from "./core/walls/wallMass.js";

export const WALL_STROKE = "#14201b";
export const WALL_INNER_STROKE = "#2f3431";
export const WALL_ACTIVE_STROKE = "#f07832";

const HATCH_STROKE_BASE = 3.15;
const HATCH_SPACING = 50;

function MaterialHatchPattern({ id, mat, spacing, strokeW, opacity }) {
  const color = mat.color;
  const bg = <rect x="0" y="0" width={spacing} height={spacing} fill="#ffffff" />;
  if (mat.hatch === "glass") {
    return (
      <pattern id={id} patternUnits="userSpaceOnUse" width={spacing} height={spacing}>
        {bg}
        <rect x="0" y="0" width={spacing} height={spacing} fill={color} opacity={0.08} />
      </pattern>
    );
  }
  if (mat.hatch === "vertical") {
    return (
      <pattern id={id} patternUnits="userSpaceOnUse" width={spacing / 2} height={spacing}>
        {bg}
        <line x1="0" y1="0" x2="0" y2={spacing} stroke={color} strokeWidth={strokeW * 0.85} opacity={opacity} />
      </pattern>
    );
  }
  if (mat.hatch === "cross") {
    return (
      <pattern id={id} patternUnits="userSpaceOnUse" width={spacing} height={spacing}>
        {bg}
        <line x1="0" y1="0" x2={spacing} y2={spacing} stroke={color} strokeWidth={strokeW * 0.9} opacity={opacity} />
        <line x1={spacing} y1="0" x2="0" y2={spacing} stroke={color} strokeWidth={strokeW * 0.9} opacity={opacity} />
      </pattern>
    );
  }
  if (mat.hatch === "grid") {
    return (
      <pattern id={id} patternUnits="userSpaceOnUse" width={spacing} height={spacing}>
        {bg}
        <line x1="0" y1="0" x2={spacing} y2={spacing} stroke={color} strokeWidth={strokeW * 0.75} opacity={opacity * 0.85} />
        <line x1={spacing} y1="0" x2="0" y2={spacing} stroke={color} strokeWidth={strokeW * 0.75} opacity={opacity * 0.85} />
        <line x1="0" y1={spacing / 2} x2={spacing} y2={spacing / 2} stroke={color} strokeWidth={strokeW * 0.55} opacity={opacity * 0.65} />
      </pattern>
    );
  }
  if (mat.hatch === "box") {
    return (
      <pattern id={id} patternUnits="userSpaceOnUse" width={spacing * 1.4} height={spacing * 1.4} patternTransform="rotate(-45)">
        {bg}
        <line x1="0" y1="0" x2="0" y2={spacing * 1.4} stroke={color} strokeWidth={strokeW * 0.7} opacity={opacity * 0.55} />
      </pattern>
    );
  }
  const dense = mat.id === "bearing";
  const sp = dense ? spacing * 0.72 : spacing;
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width={sp} height={sp} patternTransform="rotate(-45)">
      {bg}
      <line x1="0" y1="0" x2="0" y2={sp} stroke={color} strokeWidth={strokeW} opacity={opacity} />
    </pattern>
  );
}

export function resolveWallFill(wall, k = 1, isDemolish = false) {
  const wallPx = (wall?.thk || 100) / Math.max(k, 0.001);
  const useHatch = wallPx >= 5;
  if (isDemolish) return useHatch ? "url(#pl-wall-hatch-demolish)" : "#ffffff";
  const matId = wall?.material && WALL_MATERIALS[wall.material] ? wall.material : null;
  if (matId && useHatch) return `url(#${wallMaterialPatternId(matId)})`;
  if (useHatch) return "url(#pl-wall-hatch-drywall)";
  return "#ffffff";
}

export function resolveWallStrokeColor(wall, isDemolish = false) {
  if (isDemolish) return "#a5371f";
  const mat = wall?.material ? wallMaterialById(wall.material) : null;
  return mat?.color || wallVisualStyle(wall).color;
}

/** SVG-шаблоны штриховки стен (в мм плана). */
export function PlannerWallDefs({ display = {} }) {
  const { hatchSpacing, hatchOpacity, strokeMul } = wallVisualFromDisplay(display);
  const spacing = hatchSpacing || HATCH_SPACING;
  const hatchStroke = HATCH_STROKE_BASE * strokeMul;
  return (
    <defs>
      {Object.values(WALL_MATERIALS).map((mat) => (
        <MaterialHatchPattern
          key={mat.id}
          id={wallMaterialPatternId(mat.id)}
          mat={mat}
          spacing={spacing}
          strokeW={hatchStroke}
          opacity={hatchOpacity}
        />
      ))}
      <pattern
        id="pl-wall-hatch"
        patternUnits="userSpaceOnUse"
        width={spacing}
        height={spacing}
        patternTransform="rotate(-45)"
      >
        <rect x="0" y="0" width={spacing} height={spacing} fill="#ffffff" />
        <line
          x1="0"
          y1="0"
          x2="0"
          y2={spacing}
          stroke={WALL_STROKE}
          strokeWidth={hatchStroke}
          opacity={hatchOpacity}
        />
      </pattern>
      <pattern
        id="pl-wall-hatch-demolish"
        patternUnits="userSpaceOnUse"
        width={spacing}
        height={spacing}
        patternTransform="rotate(-45)"
      >
        <rect x="0" y="0" width={spacing} height={spacing} fill="#ffffff" />
        <line
          x1="0"
          y1="0"
          x2="0"
          y2={spacing}
          stroke="#a5371f"
          strokeWidth={hatchStroke}
          opacity={Math.min(0.75, hatchOpacity + 0.04)}
        />
      </pattern>
    </defs>
  );
}

function segDir(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

function facePointOnSegment(a, b, t, face, wall, room) {
  const seg = wallFaceSegment(a, b, face, wall, room);
  return lerpPt(seg.a, seg.b, t);
}

/** Заливка: параллельные грани — постоянная толщина вдоль сегмента. */
function slabPolygon(a, b, t0, t1, wall, room) {
  const outer = wallFaceSegment(a, b, "outer", wall, room);
  const inner = wallFaceSegment(a, b, "inner", wall, room);
  return [
    lerpPt(outer.a, outer.b, t0),
    lerpPt(outer.a, outer.b, t1),
    lerpPt(inner.a, inner.b, t1),
    lerpPt(inner.a, inner.b, t0),
  ];
}

function polyD(pts) {
  if (!pts?.length) return "";
  return `M ${pts.map((p) => `${p.x} ${p.y}`).join(" L ")} Z`;
}

export { collectWallParts, polyD };

function jambAt(a, b, t, wall, room) {
  const pt = lerpPt(a, b, t);
  return {
    a: wallFacePoint(pt, a, b, "outer", wall, room),
    b: wallFacePoint(pt, a, b, "inner", wall, room),
  };
}

function bridgeAt(a, b, t0, t1, wall, room) {
  const outer = wallFaceSegment(a, b, "outer", wall, room);
  const inner = wallFaceSegment(a, b, "inner", wall, room);
  return [
    { a: lerpPt(inner.a, inner.b, t0), b: lerpPt(inner.a, inner.b, t1) },
    { a: lerpPt(outer.a, outer.b, t0), b: lerpPt(outer.a, outer.b, t1) },
  ];
}

function segmentDrawRanges(a, b, wall, openings, allWalls, outlineMode) {
  const op = openingRangesOnSegment(a, b, wall.id, openings || []);
  let ranges = op;
  if (outlineMode && allWalls) {
    const teeGaps = stemTeeGapsOnSegment(a, b, wall.id, allWalls);
    ranges = combineOpeningAndTeeGaps(op, teeGaps);
  }
  let parts = wallDrawRanges(ranges);
  if (outlineMode && allWalls) {
    const trimA = teeOutlineTrimAtPoint(a, b, a, allWalls, wall.id);
    const trimB = teeOutlineTrimAtPoint(a, b, b, allWalls, wall.id);
    parts = parts.map(([t0, t1]) => {
      let r0 = t0;
      let r1 = t1;
      if (trimA) r0 = Math.max(r0, trimA.t0);
      if (trimB) r1 = Math.min(r1, trimB.t1);
      return [r0, r1];
    }).filter(([t0, t1]) => t1 - t0 > 0.012);
  }
  return parts;
}

function collectWallParts(wall, openings, room, allWalls = null) {
  const slabs = [];
  const jambs = [];
  const bridges = [];
  const geom = allWalls?.length ? wallGeometryMap(allWalls, room) : null;
  const renderWall = geom?.expandedWalls?.find((w) => w.id === wall.id) || wall;
  const pts = renderWall?.pts;
  if (!pts || pts.length < 2) return { slabs, jambs, bridges };

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const segIdx = i - 1;
    const quad = geom?.quads.get(`${wall.id}-${segIdx}`);

    segmentDrawRanges(a, b, wall, openings, allWalls, false).forEach(([t0, t1], j) => {
      if (t1 - t0 < 0.012) return;
      slabs.push({
        key: `s-${i}-${j}`,
        poly: quad ? slabFromMiterQuad(quad, t0, t1) : slabPolygon(a, b, t0, t1, wall, room),
      });
    });

    const op = openingRangesOnSegment(a, b, wall.id, openings || []);
    op.forEach(([t0, t1], j) => {
      jambs.push({ key: `j-${i}-${j}-0`, ...jambAt(a, b, t0, wall, room) });
      jambs.push({ key: `j-${i}-${j}-1`, ...jambAt(a, b, t1, wall, room) });
      bridgeAt(a, b, t0, t1, wall, room).forEach((seg, k) => {
        bridges.push({ key: `b-${i}-${j}-${k}`, ...seg });
      });
    });
  }
  return { slabs, jambs, bridges };
}

/** Невидимый hit-layer по оси стены. strokeWidth покрывает всю толщину стены. */
export function WallBodyHitAreas({
  wall, allWalls, room, editable = false, eraseMode = false, onDown,
}) {
  if ((!editable && !eraseMode) || !wall?.pts?.length || wall.pts.length < 2) return null;
  const thk = wall.thk || 100;
  const hitStroke = Math.max(thk, 80) + 16;
  const d = wall.pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  return (
    <path
      data-ui="wall-body-hit"
      d={d}
      fill="none"
      stroke="rgba(0,0,0,0)"
      strokeWidth={hitStroke}
      pointerEvents="stroke"
      onPointerDown={(e) => {
        e.stopPropagation();
        onDown?.(e);
      }}
      style={{ cursor: editable || eraseMode ? "pointer" : "default" }}
    />
  );
}

/** Заливка стены штриховкой + перемычки проёмов. */
export function WallSlabFill({ wall, openings, room, k = 1, isDemolish = false, allWalls = null, display = {} }) {
  const { slabs, jambs, bridges } = collectWallParts(wall, openings, room, allWalls);
  const stroke = resolveWallStrokeColor(wall, isDemolish);
  const fill = resolveWallFill(wall, k, isDemolish);
  const capW = Math.max(1.5 * k, 1.15);
  const bridgeW = Math.max(1.2 * k, 0.95);
  // When the unified wall-mass layer is active it draws the seamless hatch;
  // the per-wall slab hatch is suppressed (it is what creates the visible
  // internal seams). Door/window jambs + bridges still render here on top.
  const unified = display?.unifiedWallMass !== false;
  return (
    <g pointerEvents="none" data-ui="wall-fill">
      {!unified && slabs.map(({ key, poly }) => (
        <path key={key} d={polyD(poly)} fill={fill} stroke="none" />
      ))}
      {jambs.map(({ key, a, b }) => (
        <line
          key={key}
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke={stroke}
          strokeWidth={capW}
          strokeLinecap="square"
        />
      ))}
      {bridges.map(({ key, a, b }) => (
        <line
          key={key}
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke={stroke}
          strokeWidth={bridgeW}
          strokeDasharray={`${5 * k} ${4 * k}`}
          opacity={0.9}
        />
      ))}
    </g>
  );
}

/** Двойной контур граней стены (рисуется поверх объектов). */
export function WallFaceOutlines({
  wall, openings, room, k, strokeOuter = WALL_STROKE, strokeInner = WALL_INNER_STROKE,
  strokeW, dash = null, highlight = false, allWalls = null,
}) {
  const outerW = strokeW ?? 1.78 * (k || 1);
  const innerW = strokeW ? wallInnerFaceStrokeWidth(outerW) : Math.max(outerW * 0.86, 1.45 * (k || 1));
  const wallPx = (wall?.thk || 100) / Math.max(k || 1, 0.001);
  const showInner = wallPx >= 4;
  const vs = wallVisualStyle(wall);
  const outerColor = highlight ? WALL_ACTIVE_STROKE : (strokeOuter || resolveWallStrokeColor(wall));
  const innerColor = highlight ? "#ffb366" : strokeInner;
  const lineDash = dash || vs.dash || undefined;

  const segs = (face) => {
    const out = [];
    const geom = allWalls?.length ? wallGeometryMap(allWalls, room) : null;
    const renderWall = geom?.expandedWalls?.find((w) => w.id === wall.id) || wall;
    const pts = renderWall?.pts || [];
    const skipTee = !!geom?.contours?.length;

    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const segIdx = i - 1;
      const contour = geom?.contours.find((c) => c.wallId === wall.id && c.segIdx === segIdx && c.face === face);

      segmentDrawRanges(a, b, wall, openings, skipTee ? null : allWalls, true).forEach(([t0, t1], j) => {
        let p0;
        let p1;
        if (contour) {
          ({ p0, p1 } = contourSegment(contour, t0, t1));
        } else {
          p0 = facePointOnSegment(a, b, t0, face, wall, room);
          p1 = facePointOnSegment(a, b, t1, face, wall, room);
        }
        if (!Number.isFinite(p0.x) || !Number.isFinite(p1.x)) return;
        out.push({ key: `${face}-${i}-${j}`, p0, p1 });
      });
    }
    return out;
  };

  const outer = segs("outer");
  const inner = segs("inner");
  if (!outer.length && !inner.length) return null;

  const lineProps = {
    strokeLinecap: "butt",
    strokeLinejoin: "miter",
    strokeMiterlimit: 8,
    strokeDasharray: lineDash,
  };

  return (
    <g pointerEvents="none" data-ui="wall-outline">
      {outer.map(({ key, p0, p1 }) => (
        <line
          key={`o-${key}`}
          x1={p0.x}
          y1={p0.y}
          x2={p1.x}
          y2={p1.y}
          stroke={outerColor}
          strokeWidth={outerW}
          {...lineProps}
        />
      ))}
      {showInner && inner.map(({ key, p0, p1 }) => (
        <line
          key={`i-${key}`}
          x1={p0.x}
          y1={p0.y}
          x2={p1.x}
          y2={p1.y}
          stroke={innerColor}
          strokeWidth={innerW}
          {...lineProps}
        />
      ))}
    </g>
  );
}

/**
 * Unified wall-mass render: connected walls draw as one continuous mass —
 * a single seamless hatch fill (every wall quad + node-core fill polygon,
 * same pattern, no per-quad stroke) plus one boundary outline (only the
 * union's surviving edges; internal seams between adjacent walls and at
 * multiway/T nodes are cancelled and never drawn). Individual wall identity
 * (selection, hit-testing, dimensions) is untouched — those still use the
 * per-wall quads elsewhere; this layer only replaces the VISIBLE fill/stroke.
 */
export function WallMassLayer({ walls, room, k = 1, display = {}, isDemolish = false }) {
  if (!walls?.length) return null;
  const geom = wallGeometryMap(walls, room);
  const masses = buildWallMassGeometry(geom.polygons, geom.expandedWalls || walls);
  if (!masses.length) return null;
  const { strokeMul } = wallVisualFromDisplay(display);
  const byId = new Map(walls.map((w) => [w.id, w]));
  const outerW = 1.78 * (k || 1) * strokeMul;
  return (
    <g data-ui="wall-mass" pointerEvents="none">
      {masses.map((mass, mi) => {
        const firstWall = byId.get(mass.sourceWallIds[0]) || walls[0];
        const fill = resolveWallFill(firstWall, k, isDemolish);
        const stroke = resolveWallStrokeColor(firstWall, isDemolish);
        return (
          <g key={`mass-${mi}`}>
            <path d={mass.fillPath} fill={fill} stroke="none" fillRule="nonzero" />
            {mass.boundaryEdges.map((e, ei) => (
              <line
                key={`b-${mi}-${ei}`}
                x1={e.a.x}
                y1={e.a.y}
                x2={e.b.x}
                y2={e.b.y}
                stroke={stroke}
                strokeWidth={outerW}
                // PHASE 2E — butt, not round. The mass boundary is a set of
                // independent segments, so a round cap puts half a stroke
                // width of ink BEYOND every corner point: at high zoom that
                // reads as a rounded, bulging corner, and where two caps
                // overlap at an outside corner the joint looks bevelled or
                // clipped. Butt ends stop exactly on the shared corner point,
                // and the fill underneath (same geometry) closes the joint.
                strokeLinecap="butt"
              />
            ))}
          </g>
        );
      })}
    </g>
  );
}
