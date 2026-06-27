import React from "react";
import { areaM2, LINE_STYLE, LINK_RULES } from "./catalog.js";
import {
  resolveLineVisual, linePlanLengthMm, lineTotalLengthMm, arrowPointsAlongLine,
} from "./lineProperties.js";
import { formatZoneAreaM2, zoneAreaMm2 } from "./roomZones.js";
import { ZONE_FLOW } from "./farmRules.js";
import { ObjectIcon, DoorIcon } from "./icons.jsx";
import { layerOpacity } from "./geometry.js";
import { layerDisplayState } from "./canvasLayers.js";
import {
  buildItemLabelLines, autoItemLabelPlacement, labelModeForItem,
  labelsVisible, labelAudienceVisible, resolveFreeLabelPosition, labelFontSize,
} from "./labelProperties.js";
import { LabelPlaque } from "./LabelPlaque.jsx";
import { wallVisualStyle, wallFaceStrokeWidth, WALL_KINDS } from "./wallTypes.js";
import { wallFaceSegment } from "./wallParallelGeometry.js";
import { DG_THEME } from "./plannerVisualTheme.js";
import { linkLengthMm, resolveLinkColor } from "./linkGeometry.js";
import { isDoorItem, isOpeningKind, isWindowKind, doorStyle, doorShowsSwing } from "./doorTypes.js";
import { openingStyle } from "./openingTypes.js";
import { OpeningIcon } from "./icons.jsx";
import { openingRangesOnSegment, wallDrawRanges, lerpPt, doorSwingPolygon } from "./doorGeometry.js";
import { resolveGrid, gridLineLevel, buildScreenGridLines, buildScreenAxes, fmtCoordMm, GRID_COLORS, GRID_STROKE } from "./gridSettings.js";
import { SegDim, wallSegmentOffsetSide, RectDims, WallMountedDim, RoomOutlineDims, ClearanceDims, WallSelectionDims } from "./dimensionMarkers.jsx";
import { isWallMountedItem } from "./clearanceDims.js";
import { DEFAULT_PASSAGE_WARN_MM, DEFAULT_PASSAGE_ERROR_MM } from "./dimensionProperties.js";
import { ServiceZoneEl, PortMarkers, StatusBadge, ItemStateIcons } from "./objectOverlays.jsx";
import { resolveItemVisual, SEL_COLORS } from "./selectionVisuals.js";
import { glyphRenderProps } from "./objectGlyphs.js";
import { SelectionHandles } from "./selectionHandles.jsx";

export { RectDims, WallMountedDim, RoomOutlineDims, WallSelectionDims };

/** Обёртка слоя: скрывает невидимые листы, помечает активный/приглушённый. */
export function PlanLayerGroup({ layerId, activeLayer, vis, display, children }) {
  const st = layerDisplayState(layerId, activeLayer, vis, display, display?.sheet);
  if (!st.visible) return null;
  return (
    <g
      data-layer={layerId}
      data-layer-active={st.isActive ? "1" : undefined}
      data-layer-muted={st.isMuted ? "1" : undefined}
    >
      {children}
    </g>
  );
}

/** Сетка на весь холст (экранные координаты, привязка к мировой сетке). */
export function PlanGridScreen({ view, width, height, display }) {
  const lines = buildScreenGridLines(view, width, height, display);
  if (!lines.length) return null;
  return (
    <g data-ui="grid" pointerEvents="none">
      {lines.map((ln) => (
        <line
          key={ln.key}
          x1={ln.x1}
          y1={ln.y1}
          x2={ln.x2}
          y2={ln.y2}
          stroke={GRID_COLORS[ln.level]}
          strokeWidth={GRID_STROKE[ln.level]}
          shapeRendering="crispEdges"
          data-grid-level={ln.level}
        />
      ))}
    </g>
  );
}

/** Оси X/Y (экранные координаты). */
export function PlanAxesScreen({ view, width, height, display }) {
  if (!display?.showAxes) return null;
  const axes = buildScreenAxes(view, width, height);
  if (!axes.length) return null;
  const stroke = "rgba(40, 50, 45, 0.22)";
  return (
    <g data-ui="axes" pointerEvents="none">
      {axes.map((a) => (
        <line
          key={a.key}
          x1={a.x1}
          y1={a.y1}
          x2={a.x2}
          y2={a.y2}
          stroke={stroke}
          strokeWidth={1.4}
          shapeRendering="crispEdges"
        />
      ))}
    </g>
  );
}

/** @deprecated — use PlanGridScreen */
export function PlanGrid({ bounds, zoom, display }) {
  const cfg = resolveGrid({
    showGrid: display?.showGrid !== false,
    showMinorGrid: display?.showMinorGrid !== false,
    showMediumGrid: display?.showMediumGrid !== false,
    showMajorGrid: display?.showMajorGrid !== false,
    zoom,
  });
  if (!cfg.visible || !bounds) return null;

  const { x0, y0, x1, y1 } = bounds;
  const { iterStep } = cfg;
  const L = [];
  const startX = Math.floor(x0 / iterStep) * iterStep;
  const startY = Math.floor(y0 / iterStep) * iterStep;

  const pushLine = (key, lx1, ly1, lx2, ly2, level) => {
    if (!level) return;
    L.push(
      <line
        key={key}
        x1={lx1}
        y1={ly1}
        x2={lx2}
        y2={ly2}
        stroke={GRID_COLORS[level]}
        strokeWidth={GRID_STROKE[level]}
        vectorEffect="non-scaling-stroke"
        data-grid-level={level}
      />,
    );
  };

  for (let x = startX; x <= x1; x += iterStep) {
    const level = gridLineLevel(x, cfg);
    pushLine(`x${x}`, x, y0, x, y1, level);
  }
  for (let y = startY; y <= y1; y += iterStep) {
    const level = gridLineLevel(y, cfg);
    pushLine(`y${y}`, x0, y, x1, y, level);
  }
  return <g data-ui="grid" pointerEvents="none">{L}</g>;
}

/** Оси X/Y от нулевой точки (0,0). */
export function PlanAxes({ bounds, display }) {
  if (!display?.showAxes || !bounds) return null;
  const { x0, y0, x1, y1 } = bounds;
  const stroke = "rgba(40, 50, 45, 0.22)";
  const L = [];
  if (y0 <= 0 && y1 >= 0) {
    L.push(
      <line key="axis-x" x1={x0} y1={0} x2={x1} y2={0} stroke={stroke} strokeWidth={1.4} vectorEffect="non-scaling-stroke" data-ui="axis" />,
    );
  }
  if (x0 <= 0 && x1 >= 0) {
    L.push(
      <line key="axis-y" x1={0} y1={y0} x2={0} y2={y1} stroke={stroke} strokeWidth={1.4} vectorEffect="non-scaling-stroke" data-ui="axis" />,
    );
  }
  if (!L.length) return null;
  return <g data-ui="axes" pointerEvents="none">{L}</g>;
}

export { buildScreenGridLines };

/** Лист чертежа — без готовых стен. Опционально пунктир границы листа. */
export function SheetBackdrop({ room, k, showBoundary }) {
  if (!showBoundary) return null;
  return (
    <rect
      x={0}
      y={0}
      width={room.w}
      height={room.h}
      fill="none"
      stroke="rgba(25,45,38,0.2)"
      strokeWidth={1.2 * k}
      strokeDasharray={`${12 * k} ${8 * k}`}
      pointerEvents="none"
    />
  );
}

/** @deprecated Используйте SheetBackdrop + рисование стен инструментом «Стена». */
export function RoomShell({ room, k, showBoundary = false }) {
  if (!showBoundary) return null;
  const t = room.wallThk;
  return (
    <g>
      <rect
        x={0}
        y={0}
        width={room.w}
        height={room.h}
        fill="none"
        stroke="#2f3431"
        strokeWidth={Math.max(2 * k, 2)}
        strokeDasharray={`${10 * k} ${6 * k}`}
        opacity={0.5}
      />
      <rect
        x={t * 0.75}
        y={t * 0.75}
        width={room.w - t * 1.5}
        height={room.h - t * 1.5}
        fill="none"
        stroke="#4b504d"
        strokeWidth={1 * k}
        opacity={0.25}
      />
    </g>
  );
}

export function RoomDims({ room, k, fmtU }) {
  return <RoomOutlineDims room={room} k={k} fmtU={fmtU} />;
}

function WallBodySegments({
  wall, openings, stroke, strokeW, dash, face = null, room = null,
}) {
  const segs = [];
  for (let i = 1; i < wall.pts.length; i++) {
    const a = wall.pts[i - 1];
    const b = wall.pts[i];
    const op = openingRangesOnSegment(a, b, wall.id, openings || []);
    wallDrawRanges(op).forEach(([t0, t1], j) => {
      let p0 = lerpPt(a, b, t0);
      let p1 = lerpPt(a, b, t1);
      if (face && room) {
        const seg = wallFaceSegment(a, b, face, wall, room);
        p0 = lerpPt(seg.a, seg.b, t0);
        p1 = lerpPt(seg.a, seg.b, t1);
      }
      segs.push({ key: `${i}-${j}`, p0, p1 });
    });
  }
  if (!segs.length) {
    const d = wall.pts.map((p, i) => (i ? "L" : "M") + p.x + " " + p.y).join(" ");
    return (
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeW}
        strokeLinejoin="miter"
        strokeLinecap="square"
        strokeDasharray={dash || undefined}
        pointerEvents="none"
      />
    );
  }
  return (
    <g pointerEvents="none">
      {segs.map(({ key, p0, p1 }) => (
        <line
          key={key}
          x1={p0.x}
          y1={p0.y}
          x2={p1.x}
          y2={p1.y}
          stroke={stroke}
          strokeWidth={strokeW}
          strokeLinecap="square"
          strokeDasharray={dash || undefined}
        />
      ))}
    </g>
  );
}

export function WallEl({
  wall, k, editable, selected, hovered = false, fmtU, showDims, onSel, onNode, onDel, onWallMove,
  hoverNodeIdx = null, hasError = false, openings = [], room = null, onHover, onNodeHover,
}) {
  if (!wall?.pts || wall.pts.length < 2) return null;
  const d = wall.pts.map((p, i) => (i ? "L" : "M") + p.x + " " + p.y).join(" ");
  const vs = wallVisualStyle(wall);
  const faceW = wallFaceStrokeWidth(k, wall);
  const hitW = Math.max(wall.thk || 100, 80);
  const isDemolish = wall.kind === "demolish";
  const outerColor = hasError ? DG_THEME.dimError : (selected ? DG_THEME.brand : hovered ? "#5a9d8f" : (isDemolish ? DG_THEME.demolish : (wall.role === "outer" ? DG_THEME.wall : DG_THEME.wallInner)));
  const innerStroke = wall.role === "outer" ? "#8a8580" : "#9a9a96";
  const cx = wall.pts.reduce((s, p) => s + p.x, 0) / wall.pts.length;
  const cy = wall.pts.reduce((s, p) => s + p.y, 0) / wall.pts.length;
  const roleLabel = wall.role === "outer" ? "Наружная" : "Перегородка";
  const showNodes = editable && (selected || hovered || hoverNodeIdx != null);
  const onWallDown = (e) => {
    if (editable) {
      e.stopPropagation();
      onSel();
    }
  };
  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={hitW + 80}
        onPointerDown={onWallDown}
        onPointerEnter={onHover ? () => onHover(wall.id) : undefined}
        onPointerLeave={onHover ? () => onHover(null) : undefined}
        style={{ cursor: editable ? "pointer" : "default" }}
      />
      {!isDemolish && (
        <path
          d={d}
          fill="none"
          stroke={DG_THEME.wallFill}
          strokeWidth={wall.thk || 100}
          strokeLinejoin="miter"
          strokeLinecap="butt"
          strokeOpacity={DG_THEME.wallFillAlpha}
          pointerEvents="none"
        />
      )}
      <WallBodySegments
        wall={wall}
        openings={openings}
        stroke={outerColor}
        strokeW={faceW * (wall.role === "outer" ? 1.15 : 1)}
        dash={vs.dash}
        face="outer"
        room={room}
      />
      <WallBodySegments
        wall={wall}
        openings={openings}
        stroke={innerStroke}
        strokeW={faceW * 0.92}
        dash={vs.dash}
        face="inner"
        room={room}
      />
      {selected && editable && (
        <text x={cx} y={cy - (wall.thk || 100) * 0.35} fontSize={9 * k} textAnchor="middle" fill="#6b7d74" pointerEvents="none">
          {WALL_KINDS[wall.kind]?.label || roleLabel}
        </text>
      )}
      {showDims &&
        wall.pts.map((p, i) => {
          if (!i) return null;
          const a = wall.pts[i - 1];
          const side = wallSegmentOffsetSide(a, p, room);
          return (
            <SegDim
              key={i}
              a={a}
              b={p}
              label={fmtU(Math.hypot(p.x - a.x, p.y - a.y))}
              k={k}
              offset={selected ? 130 : 100}
              offsetSide={side}
              state={selected ? "active" : "normal"}
            />
          );
        })}
      {editable &&
        showNodes &&
        wall.pts.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={(hoverNodeIdx === i ? 8 : 6) * k}
            fill={hoverNodeIdx === i ? "#e8f4ef" : "#fff"}
            stroke={hoverNodeIdx === i ? "#116355" : outerColor}
            strokeWidth={(hoverNodeIdx === i ? 2.2 : 1.5) * k}
            onPointerDown={(e) => onNode(e, "walls", wall.id, i)}
            onPointerEnter={() => onNodeHover?.(i)}
            onPointerLeave={() => onNodeHover?.(null)}
            style={{ cursor: "move" }}
          />
        ))}
      {editable && selected && onWallMove && (
        <rect
          x={cx - 5 * k}
          y={cy - 5 * k}
          width={10 * k}
          height={10 * k}
          fill="#116355"
          fillOpacity={0.25}
          stroke="#116355"
          strokeWidth={1.2 * k}
          transform={`rotate(45 ${cx} ${cy})`}
          onPointerDown={(e) => onWallMove(e, wall)}
          style={{ cursor: "move" }}
        />
      )}
      {editable && selected && (
        <text x={wall.pts[0].x + 12 * k} y={wall.pts[0].y - 12 * k} fontSize={13 * k} fill="#a5371f" style={{ cursor: "pointer" }} onClick={onDel}>
          ✕
        </text>
      )}
    </g>
  );
}

/** Обводка стен поверх объектов (без интерактива). */
export function WallsTopOverlay({ walls, k, warnWallIds = new Set(), openings = [], room = null }) {
  return (
    <g data-ui="walls-top" pointerEvents="none">
      {walls.map((wall) => {
        if (!wall?.pts || wall.pts.length < 2) return null;
        const vs = wallVisualStyle(wall);
        const faceW = wallFaceStrokeWidth(k, wall);
        const err = warnWallIds.has(wall.id);
        const stroke = err ? "#c44" : vs.color;
        return (
          <g key={`top-${wall.id}`}>
            <WallBodySegments
              wall={wall}
              openings={openings}
              stroke={stroke}
              strokeW={faceW}
              dash={vs.dash}
              face="outer"
              room={room}
            />
            <WallBodySegments
              wall={wall}
              openings={openings}
              stroke={wall.role === "outer" ? "#8a8580" : "#9a9a96"}
              strokeW={faceW * 0.92}
              face="inner"
              room={room}
            />
          </g>
        );
      })}
    </g>
  );
}

export function ItemEl({
  it,
  k,
  selected,
  hovered = false,
  onDown,
  onResize,
  onResizeW,
  onResizeH,
  onRotateStart,
  onHover,
  showDims,
  activeLayer,
  vis,
  hasError,
  hasWarning,
  showLabel,
  display,
  plan,
  zoom,
}) {
  const opacity = layerOpacity(it.layer, activeLayer, vis[it.layer] !== false, display, display?.sheet);
  if (opacity === 0) return null;

  const a = it.angle || 0;
  const cx = it.x + it.w / 2;
  const cy = it.y + it.h / 2;
  const door = isDoorItem(it);
  const opening = isOpeningKind(it.kind);
  const oStyle = opening ? openingStyle(it.kind) : null;
  const dStyle = doorStyle(it.kind);
  const visState = resolveItemVisual(it, {
    selected,
    hovered,
    hasError,
    hasWarning,
    highlightErrors: display.highlightErrors,
  });
  const layerHighlight =
    (display.highlightRacks && it.layer === "racks") ||
    (display.highlightSockets && it.layer === "sockets") ||
    (display.highlightFurniture && (it.layer === "furn" || it.layer === "staff"));
  const strokeW = (layerHighlight && !selected ? visState.strokeW * 1.4 : visState.strokeW) * k;
  const dashArr = visState.dash ? visState.dash.map((v) => v * k).join(" ") : undefined;
  const sx = it.mirrorH ? -1 : 1;
  const sy = it.mirrorV ? -1 : 1;
  const itemTransform = (sx !== 1 || sy !== 1 || a)
    ? `translate(${cx},${cy}) rotate(${a}) scale(${sx},${sy}) translate(${-cx},${-cy})`
    : undefined;
  const pointerProps = {
    onPointerEnter: onHover ? () => onHover(it.id) : undefined,
    onPointerLeave: onHover ? () => onHover(null) : undefined,
  };
  const itemOpacity = visState.excluded ? opacity * 0.5 : opacity;
  const glyph = !door && !opening ? glyphRenderProps(it, visState) : { hasGlyph: false };

  return (
    <g transform={itemTransform} opacity={itemOpacity}>
      {(display.showServiceZones || selected) && !opening && (
        <ServiceZoneEl it={it} k={k} />
      )}
      {door ? (
        <g onPointerDown={onDown} style={{ cursor: "move" }}>
          {!display.doorOpeningsOnly && (
            <>
              <line x1={it.x} y1={cy} x2={it.x + it.w} y2={cy} stroke={dStyle.color} strokeWidth={2 * k} />
              {dStyle.accent && (
                <line x1={it.x + 4 * k} y1={cy} x2={it.x + it.w - 4 * k} y2={cy} stroke={dStyle.accent} strokeWidth={3 * k} opacity={0.85} />
              )}
            </>
          )}
          {!display.doorOpeningsOnly && doorShowsSwing(it.kind, display) && (
            <path
              d={`M ${doorSwingPolygon(it).map((p) => `${p.x} ${p.y}`).join(" L ")} Z`}
              fill={DG_THEME.doorArc}
              fillOpacity={0.04}
              stroke={DG_THEME.doorArc}
              strokeWidth={0.75 * k}
              strokeDasharray={`${4 * k} ${3 * k}`}
              pointerEvents="none"
            />
          )}
          {!display.doorOpeningsOnly && (
            <g transform={`translate(${it.x} ${cy}) scale(${it.doorSwing === "right" ? -1 : 1}, 1)`}>
              <DoorIcon
                it={{ ...it, color: dStyle.color }}
                k={k}
                swing={dStyle.double}
                pivot={dStyle.pivot}
                slide={it.kind === "door_slide"}
                accent={dStyle.accent}
                showArc={doorShowsSwing(it.kind, display)}
              />
            </g>
          )}
          {display.doorOpeningsOnly && (
            <line x1={it.x} y1={cy} x2={it.x + it.w} y2={cy} stroke={dStyle.color} strokeWidth={3 * k} strokeDasharray={`${8 * k} ${4 * k}`} />
          )}
          {showLabel && labelsVisible(it.layer, activeLayer, display) && (
            <text x={cx} y={cy - it.h - 4 * k} fontSize={10 * k} textAnchor="middle" fill={dStyle.accent || dStyle.color} pointerEvents="none" fontWeight="600">
              {it.doorNum || dStyle.label}
            </text>
          )}
        </g>
      ) : opening ? (
        <g onPointerDown={onDown} style={{ cursor: "move" }}>
          {!display.doorOpeningsOnly ? (
            <>
              {isWindowKind(it.kind) ? (
                <>
                  <line x1={it.x} y1={cy - it.h * 0.5} x2={it.x + it.w} y2={cy - it.h * 0.5} stroke={DG_THEME.window} strokeWidth={1.1 * k} opacity={0.85} />
                  <line x1={it.x} y1={cy} x2={it.x + it.w} y2={cy} stroke={DG_THEME.window} strokeWidth={0.9 * k} opacity={0.7} />
                  <line x1={it.x} y1={cy + it.h * 0.5} x2={it.x + it.w} y2={cy + it.h * 0.5} stroke={DG_THEME.window} strokeWidth={1.1 * k} opacity={0.85} />
                </>
              ) : (
                <line
                  x1={it.x}
                  y1={cy}
                  x2={it.x + it.w}
                  y2={cy}
                  stroke={oStyle.color}
                  strokeWidth={2.2 * k}
                  strokeDasharray={oStyle.dash ? `${6 * k} ${4 * k}` : undefined}
                />
              )}
              {oStyle.glass && !isWindowKind(it.kind) && (
                <rect
                  x={it.x + 6 * k}
                  y={cy - it.h * 0.32}
                  width={it.w - 12 * k}
                  height={it.h * 0.64}
                  fill={oStyle.accent || oStyle.color}
                  fillOpacity={0.18}
                  stroke={oStyle.color}
                  strokeWidth={0.7 * k}
                  rx={oStyle.arch || it.openingShape === "arch" ? it.w * 0.2 : 2 * k}
                />
              )}
              {oStyle.vents && (
                <>
                  <line x1={it.x + it.w * 0.25} y1={cy - 3 * k} x2={it.x + it.w * 0.25} y2={cy + 3 * k} stroke={oStyle.color} strokeWidth={1 * k} />
                  <line x1={it.x + it.w * 0.5} y1={cy - 3 * k} x2={it.x + it.w * 0.5} y2={cy + 3 * k} stroke={oStyle.color} strokeWidth={1 * k} />
                  <line x1={it.x + it.w * 0.75} y1={cy - 3 * k} x2={it.x + it.w * 0.75} y2={cy + 3 * k} stroke={oStyle.color} strokeWidth={1 * k} />
                </>
              )}
              <g transform={`translate(${it.x} ${cy})`}>
                <OpeningIcon
                  w={it.w}
                  k={k}
                  style={oStyle}
                  shape={it.openingShape}
                  thk={it.h}
                  triple={isWindowKind(it.kind)}
                />
              </g>
            </>
          ) : (
            <line
              x1={it.x}
              y1={cy}
              x2={it.x + it.w}
              y2={cy}
              stroke={oStyle.color}
              strokeWidth={3 * k}
              strokeDasharray={`${8 * k} ${4 * k}`}
            />
          )}
          {showLabel && labelsVisible(it.layer, activeLayer, display) && (
            <text x={cx} y={cy - it.h - 4 * k} fontSize={10 * k} textAnchor="middle" fill={oStyle.color} pointerEvents="none" fontWeight="600">
              {it.openingNum || oStyle.short}
            </text>
          )}
          {selected && (
            <text x={cx} y={cy + it.h + 14 * k} fontSize={8 * k} textAnchor="middle" fill="#6b7d74" pointerEvents="none" style={{ fontFamily: "var(--mono)" }}>
              ↑{it.openingSillMm ?? 900} · H{it.openingHeightMm ?? 1200}
            </text>
          )}
        </g>
      ) : glyph.hasGlyph ? (
        <>
          {visState.hoverFill && (
            <rect
              x={it.x}
              y={it.y}
              width={it.w}
              height={it.h}
              rx={4 * k}
              fill={visState.hoverFill}
              stroke="none"
              pointerEvents="none"
            />
          )}
          {hasError && display.highlightErrors !== false && (
            <rect
              x={it.x - 2.5 * k}
              y={it.y - 2.5 * k}
              width={it.w + 5 * k}
              height={it.h + 5 * k}
              rx={5 * k}
              fill="none"
              stroke={SEL_COLORS.error}
              strokeWidth={1 * k}
              pointerEvents="none"
            />
          )}
          <rect
            x={it.x}
            y={it.y}
            width={it.w}
            height={it.h}
            rx={4 * k}
            fill={glyph.stroke}
            fillOpacity={glyph.hitFillOpacity}
            stroke="none"
            onPointerDown={visState.locked ? undefined : onDown}
            {...pointerProps}
            style={{ cursor: visState.locked ? "not-allowed" : "move" }}
          />
          {selected && (
            <rect
              x={it.x}
              y={it.y}
              width={it.w}
              height={it.h}
              rx={4 * k}
              fill="none"
              stroke={visState.stroke}
              strokeWidth={strokeW}
              strokeDasharray={dashArr}
              pointerEvents="none"
            />
          )}
          <g transform={`translate(${it.x} ${it.y})`}>
            <ObjectIcon
              it={it}
              k={k}
              stroke={glyph.stroke}
              fillOpacity={glyph.fillOpacity}
              icon={glyph.icon}
            />
          </g>
        </>
      ) : (
        <>
          {visState.hoverFill && (
            <rect
              x={it.x}
              y={it.y}
              width={it.w}
              height={it.h}
              rx={4 * k}
              fill={visState.hoverFill}
              stroke="none"
              pointerEvents="none"
            />
          )}
          {hasError && display.highlightErrors !== false && (
            <rect
              x={it.x - 2.5 * k}
              y={it.y - 2.5 * k}
              width={it.w + 5 * k}
              height={it.h + 5 * k}
              rx={5 * k}
              fill="none"
              stroke={SEL_COLORS.error}
              strokeWidth={1 * k}
              pointerEvents="none"
            />
          )}
          <rect
            x={it.x}
            y={it.y}
            width={it.w}
            height={it.h}
            rx={4 * k}
            fill={glyph.stroke || it.color}
            fillOpacity={visState.hiddenClient ? 0.03 : (glyph.fillOpacity || 0.05)}
            stroke={visState.stroke}
            strokeWidth={strokeW}
            strokeDasharray={dashArr}
            onPointerDown={visState.locked ? undefined : onDown}
            {...pointerProps}
            style={{ cursor: visState.locked ? "not-allowed" : "move" }}
          />
        </>
      )}
      {!door && !opening && !glyph.hasGlyph && (
        <g transform={`translate(${it.x} ${it.y})`}>
          <ObjectIcon it={{ ...it, color: glyph.stroke || it.color }} k={k} />
        </g>
      )}
      {showLabel && !door && !opening && labelsVisible(it.layer, activeLayer, display) && (
        <ItemLabelBadge it={it} plan={plan} k={k} zoom={zoom} display={display} room={plan?.room} />
      )}
      <StatusBadge it={it} k={k} cx={cx} cy={it.y - 6 * k} />
      <ItemStateIcons
        it={it}
        k={k}
        locked={visState.locked}
        hiddenClient={visState.hiddenClient}
        inSpec={visState.inSpec}
        hasWarning={hasWarning}
        hasError={hasError && display.highlightErrors !== false}
        showReview={visState.showReview}
        display={display}
      />
      {(display.showPorts || selected) && !door && !opening && (
        <PortMarkers it={it} k={k} show />
      )}
      {selected && !door && !opening && (
        <SelectionHandles
          it={it}
          k={k}
          locked={visState.locked}
          onResizeCorner={onResize}
          onResizeW={onResizeW}
          onResizeH={onResizeH}
          onRotateStart={onRotateStart}
        />
      )}
    </g>
  );
}

function ItemLabelBadge({ it, plan, k, zoom, display, room }) {
  const mode = labelModeForItem(it, display);
  const lines = buildItemLabelLines(it, plan, mode);
  const place = autoItemLabelPlacement(it, room);
  return (
    <LabelPlaque
      x={place.x}
      y={place.y}
      lines={lines}
      k={k}
      zoom={zoom}
      align="center"
      leaderTo={place.external ? place.anchor : null}
      leaderFrom={place.external ? { x: place.x, y: place.y } : null}
    />
  );
}

export function LabelEl({ lb, items, k, zoom, selected, onDown, activeLayer, display }) {
  const tgt = lb.targetId ? items.find((i) => i.id === lb.targetId) : null;
  if (tgt && !labelsVisible(tgt.layer, activeLayer, display, display?.sheet)) return null;
  if (!labelAudienceVisible(lb.audience, activeLayer)) return null;
  const pos = resolveFreeLabelPosition(lb, tgt);
  const lines = (lb.text || "").split("\n").filter(Boolean);
  const anchor = tgt ? { x: tgt.x + tgt.w / 2, y: tgt.y + tgt.h / 2 } : null;
  return (
    <g opacity={selected ? 1 : 0.92}>
      <LabelPlaque
        x={pos.x}
        y={pos.y}
        lines={lines}
        k={k}
        zoom={zoom}
        selected={selected}
        onDown={onDown}
        align="left"
        leaderTo={anchor}
        leaderFrom={{ x: pos.x, y: pos.y + labelFontSize(k, zoom) }}
      />
    </g>
  );
}

export function ZoneEl({
  zn, k, selected, onDown, onResize, fmtU, activeLayer, showDetail,
  showFlow = true, showZoneAreas = true, showZoneFill = true, zoneContoursOnly = false, room,
  vis, display,
}) {
  const zoneOpacity = vis && display
    ? layerOpacity("zones", activeLayer, vis.zones !== false, display, display?.sheet)
    : 1;
  if (zoneOpacity === 0) return null;
  const cx = zn.x + zn.w / 2;
  const cy = zn.y + zn.h / 2;
  const detail = showDetail || activeLayer === "zones";
  const poly = zn.polygon?.length >= 3;
  const polyD = poly ? `M ${zn.polygon.map((p) => `${p.x} ${p.y}`).join(" L ")} Z` : null;
  const flow = showFlow ? (ZONE_FLOW[zn.flow] || ZONE_FLOW.neutral) : ZONE_FLOW.neutral;
  const stroke = zn.zoneColor || flow.color;
  const fillColor = zn.zoneColor || flow.color;
  const contoursOnly = zn.contoursOnly || zoneContoursOnly;
  const hideFill = zn.hideFill || !showZoneFill || contoursOnly;
  let fillOp = hideFill ? 0 : (selected ? flow.fill + 0.04 : flow.fill);
  if (!hideFill && zn.auto) fillOp = Math.max(fillOp, flow.fill);
  const areaMm2 = zoneAreaMm2(zn);
  const small = areaMm2 < 2_500_000;
  const rcx = room?.w ? room.w / 2 : cx;
  const rcy = room?.h ? room.h / 2 : cy;
  const dx = cx - rcx;
  const dy = cy - rcy;
  const distC = Math.hypot(dx, dy) || 1;
  const labelX = small ? cx + (dx / distC) * Math.max(zn.w, zn.h) * 0.55 : cx;
  const labelY = small ? cy + (dy / distC) * Math.max(zn.w, zn.h) * 0.55 : cy;
  const showArea = zn.showArea !== false && showZoneAreas;
  const showName = zn.showName !== false;
  const showHeightLbl = zn.showHeight !== false && activeLayer === "zones";
  const locked = zn.locked === true;
  const dash = contoursOnly ? `${8 * k} ${5 * k}` : (detail ? "none" : `${10 * k} ${6 * k}`);
  const zoneLabels = display ? labelsVisible("zones", activeLayer, display, display?.sheet) : true;
  const labelLines = [];
  if (showName && zn.name) labelLines.push(zn.name);
  if (showFlow && zn.flow && zn.flow !== "neutral") labelLines.push(flow.label);
  if (showArea) labelLines.push(`S = ${formatZoneAreaM2(zn)} м²`);
  if (showHeightLbl && zn.height) labelLines.push(`H = ${(zn.height / 1000).toFixed(2)} м`);

  return (
    <g opacity={zoneOpacity < 1 ? zoneOpacity : undefined}>
      {poly ? (
        <path
          d={polyD}
          fill={fillColor}
          fillOpacity={fillOp}
          stroke={stroke}
          strokeWidth={(selected ? 2 : 1.2) * k}
          strokeDasharray={dash}
          onPointerDown={locked ? undefined : onDown}
          style={{ cursor: locked ? "default" : "move" }}
        />
      ) : (
        <rect
          x={zn.x}
          y={zn.y}
          width={zn.w}
          height={zn.h}
          rx={2 * k}
          fill={fillColor}
          fillOpacity={fillOp}
          stroke={stroke}
          strokeWidth={(selected ? 2 : 1.2) * k}
          strokeDasharray={dash}
          onPointerDown={locked ? undefined : onDown}
          style={{ cursor: locked ? "default" : "move" }}
        />
      )}
      {detail && zoneLabels && labelLines.length > 0 && (
        <>
          {small && (
            <line x1={cx} y1={cy} x2={labelX} y2={labelY} stroke={DG_THEME.labelLeader} strokeWidth={1 * k} opacity={0.6} pointerEvents="none" />
          )}
          <LabelPlaque
            x={labelX}
            y={labelY - (labelLines.length * 12 * k) / 2}
            lines={labelLines}
            k={k}
            zoom={k > 0 ? 1 / k : 0.1}
            align="center"
            leaderTo={small ? { x: cx, y: cy } : null}
            leaderFrom={small ? { x: labelX, y: labelY } : null}
          />
        </>
      )}
      {selected && !locked && !zn.auto && (
        <rect
          x={zn.x + zn.w - 6 * k}
          y={zn.y + zn.h - 6 * k}
          width={12 * k}
          height={12 * k}
          fill="#fff"
          stroke="#8a7a9c"
          strokeWidth={1.5 * k}
          onPointerDown={onResize}
          style={{ cursor: "nwse-resize" }}
        />
      )}
    </g>
  );
}

export function LineEl({ line, k, showDims, editable, selected, hovered = false, onSel, onNode, onDel, onHover, fmtU, activeLayer, vis, display }) {
  const opacity = layerOpacity(line.layer, activeLayer, vis[line.layer] !== false, display, display?.sheet);
  if (opacity === 0) return null;
  const st = resolveLineVisual(line);
  const pts = line.pts || [];
  const d = pts.map((p, i) => (i ? "L" : "M") + p.x + " " + p.y).join(" ");
  const dash = st.dash ? st.dash.map((v) => v * k).join(" ") : "none";
  const sw = (selected ? st.w + 1 : hovered ? st.w + 0.6 : st.w) * k;
  const lineColor = selected ? SEL_COLORS.select : hovered ? SEL_COLORS.hover : st.color;
  const arrowsOn = st.arrow && display.showLineArrows !== false;
  const arrowPts = arrowsOn ? arrowPointsAlongLine(pts, 900, line.arrowReverse) : [];
  const offset = st.double ? 2.5 * k : 0;

  const drawPath = (ox = 0, oy = 0) => (
    <path
      d={pts.map((p, i) => (i ? "L" : "M") + (p.x + ox) + " " + (p.y + oy)).join(" ")}
      fill="none"
      stroke={lineColor}
      strokeWidth={sw}
      strokeDasharray={dash}
      strokeLinejoin="round"
      strokeLinecap="round"
      onPointerDown={(e) => {
        if (editable && !line.locked) {
          e.stopPropagation();
          onSel();
        }
      }}
      onPointerEnter={onHover ? () => onHover(line.id) : undefined}
      onPointerLeave={onHover ? () => onHover(null) : undefined}
      style={{ cursor: editable && !line.locked ? "pointer" : "default" }}
    />
  );

  return (
    <g opacity={opacity}>
      {st.double ? (
        <>
          {drawPath(-offset, 0)}
          {drawPath(offset, 0)}
        </>
      ) : drawPath()}
      {arrowsOn && arrowPts.map((ap, i) => (
        <LineArrow key={i} x={ap.x} y={ap.y} ang={ap.ang} k={k} color={st.color} />
      ))}
      {showDims && selected &&
        pts.map((p, i) => {
          if (!i) return null;
          const a = pts[i - 1];
          return (
            <SegDim
              key={i}
              a={a}
              b={p}
              label={fmtU(Math.hypot(p.x - a.x, p.y - a.y))}
              k={k}
              offset={100}
              offsetSide={-1}
              state="active"
            />
          );
        })}
      {selected && pts.length >= 2 && (
        <text
          x={(pts[0].x + pts[pts.length - 1].x) / 2}
          y={(pts[0].y + pts[pts.length - 1].y) / 2 - 16 * k}
          fontSize={10 * k}
          textAnchor="middle"
          fill="#5a5f5c"
          pointerEvents="none"
          style={{ fontFamily: "var(--mono)" }}
        >
          Σ {fmtU(lineTotalLengthMm(line))} ({line.reservePct ?? 10}%)
        </text>
      )}
      {editable && !line.locked &&
        pts.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={5 * k}
            fill="#fff"
            stroke={lineColor}
            strokeWidth={1.5 * k}
            onPointerDown={(e) => onNode(e, "lines", line.id, i)}
            style={{ cursor: "move" }}
          />
        ))}
      {editable && selected && !line.locked && (
        <text x={pts[0]?.x + 10 * k} y={pts[0]?.y - 10 * k} fontSize={13 * k} fill="#a5371f" style={{ cursor: "pointer" }} onClick={onDel}>
          ✕
        </text>
      )}
    </g>
  );
}

function LineArrow({ x, y, ang, k, color }) {
  const s = 22 * k;
  return (
    <g stroke={color} strokeWidth={1.8 * k} fill="none" pointerEvents="none">
      <line x1={x} y1={y} x2={x - s * Math.cos(ang - 0.42)} y2={y - s * Math.sin(ang - 0.42)} />
      <line x1={x} y1={y} x2={x - s * Math.cos(ang + 0.42)} y2={y - s * Math.sin(ang + 0.42)} />
    </g>
  );
}

export function DraftLine({ pts, cursor, k, wall, thk, color, fmtU, snapPt, room, angleSnap }) {
  const all = cursor ? [...pts, cursor] : pts;
  const lenColor = wall ? "#2f3431" : color;
  const mockWall = wall ? { thk: thk || 100, thicknessSide: "center" } : null;
  const faceW = wall ? 1.2 * k : 3 * k;
  return (
    <g>
      {wall && all.length >= 2 ? (
        <>
          {Array.from({ length: all.length - 1 }, (_, i) => {
            const a = all[i];
            const b = all[i + 1];
            const outer = wallFaceSegment(a, b, "outer", mockWall, room);
            const inner = wallFaceSegment(a, b, "inner", mockWall, room);
            return (
              <g key={i}>
                <line x1={outer.a.x} y1={outer.a.y} x2={outer.b.x} y2={outer.b.y} stroke="#2f3431" strokeWidth={faceW} opacity={0.7} strokeLinecap="square" />
                <line x1={inner.a.x} y1={inner.a.y} x2={inner.b.x} y2={inner.b.y} stroke="#8a8580" strokeWidth={faceW * 0.92} opacity={0.55} strokeLinecap="square" />
              </g>
            );
          })}
        </>
      ) : (
        <path
          d={all.map((p, i) => (i ? "L" : "M") + p.x + " " + p.y).join(" ")}
          fill="none"
          stroke={color}
          strokeWidth={faceW}
          strokeDasharray={`${6 * k} ${4 * k}`}
          opacity={0.85}
          strokeLinecap="round"
        />
      )}
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={5 * k} fill={wall ? "#2f3431" : color} />
      ))}
      {snapPt?.snapped && cursor && (
        <>
          <circle cx={cursor.x} cy={cursor.y} r={8 * k} fill="none" stroke="#116355" strokeWidth={2 * k} opacity={0.85} />
          {snapPt.kind === "close" && (
            <text x={cursor.x} y={cursor.y - 14 * k} fontSize={10 * k} textAnchor="middle" fill="#116355" fontWeight="600">
              Замкнуть помещение
            </text>
          )}
          {(snapPt.kind === "port" || snapPt.kind === "object") && (
            <text x={cursor.x} y={cursor.y - 14 * k} fontSize={9 * k} textAnchor="middle" fill="#116355" fontWeight="600">
              {snapPt.kind === "port" ? "Порт" : "Объект"}
            </text>
          )}
          {snapPt.kind === "trass" && (
            <text x={cursor.x} y={cursor.y - 14 * k} fontSize={9 * k} textAnchor="middle" fill="#116355" fontWeight="600">
              Трасса
            </text>
          )}
        </>
      )}
      {cursor && pts.length > 0 && (() => {
        const a = pts[pts.length - 1];
        const len = Math.hypot(cursor.x - a.x, cursor.y - a.y);
        let ang = Math.round(angleSnap?.snappedAngle ?? (Math.atan2(cursor.y - a.y, cursor.x - a.x) * 180) / Math.PI);
        if (ang < 0) ang += 360;
        const midX = (a.x + cursor.x) / 2;
        const midY = (a.y + cursor.y) / 2;
        const snapSuffix = angleSnap?.isSnapped && angleSnap?.guideLabel ? ` · ${angleSnap.guideLabel}` : "";
        const hint = wall
          ? `${fmtU(len)} · ${ang}°${snapSuffix}`
          : `${fmtU(len)} · ${ang}°${snapSuffix}`;
        const hudX = cursor.x + 16 * k;
        const hudY = cursor.y - 12 * k;
        return (
          <>
            {angleSnap?.isSnapped && (
              <line
                x1={a.x}
                y1={a.y}
                x2={cursor.x}
                y2={cursor.y}
                stroke="#8f9a94"
                strokeWidth={1 * k}
                strokeDasharray={`${4 * k} ${3 * k}`}
                opacity={0.75}
              />
            )}
            <SegDim a={a} b={cursor} label={fmtU(len)} k={k} offset={120} offsetSide={-1} active />
            <g transform={`translate(${hudX},${hudY})`} pointerEvents="none">
              <rect x={-4 * k} y={-12 * k} width={Math.max(72 * k, hint.length * 5.2 * k)} height={18 * k} rx={4 * k} fill="#fff" stroke="#d9e0dc" strokeWidth={1 * k} />
              <text
                x={4 * k}
                y={0}
                fontSize={11 * k}
                fill="#2f3431"
                style={{ fontFamily: "var(--mono)" }}
              >
                {hint}
              </text>
            </g>
            <text
              x={cursor.x}
              y={cursor.y + 18 * k}
              fontSize={9 * k}
              textAnchor="middle"
              fill={lenColor}
              opacity={0.85}
              style={{ fontFamily: "var(--mono)" }}
            >
              {fmtCoordMm(cursor.x)}, {fmtCoordMm(cursor.y)}
            </text>
          </>
        );
      })()}
    </g>
  );
}

export function LinkEl({ link, items, room, k, selected, hovered = false, showLabel, onDown, onDel, onHover }) {
  if (link.visible === false) return null;
  const color = resolveLinkColor(link);
  const { pts, total } = linkLengthMm(link, items, room);
  if (pts.length < 2) return null;
  const d = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const mid = pts[Math.floor(pts.length / 2)];
  const strokeColor = selected ? SEL_COLORS.select : hovered ? SEL_COLORS.hover : color;
  const sw = (selected ? 2.4 : hovered ? 2 : 1.6) * k;
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const ang = Math.atan2(last.y - prev.y, last.x - prev.x) * 180 / Math.PI;

  return (
    <g>
      <polyline
        points={d}
        fill="none"
        stroke={strokeColor}
        strokeWidth={sw}
        strokeDasharray={`${8 * k} ${5 * k}`}
        opacity={selected ? 1 : hovered ? 0.95 : 0.85}
        onPointerDown={onDown}
        onPointerEnter={onHover ? () => onHover(link.id) : undefined}
        onPointerLeave={onHover ? () => onHover(null) : undefined}
        style={{ cursor: "pointer" }}
      />
      <g transform={`translate(${last.x},${last.y}) rotate(${ang})`} pointerEvents="none">
        <polygon
          points={`0,0 ${-10 * k},${-5 * k} ${-10 * k},${5 * k}`}
          fill={strokeColor}
        />
      </g>
      {showLabel && (
        <text
          x={mid.x}
          y={mid.y - 8 * k}
          fontSize={9 * k}
          textAnchor="middle"
          fill={strokeColor}
          pointerEvents="none"
          style={{ fontFamily: "var(--mono)" }}
        >
          {Math.round(total)} мм
        </text>
      )}
      {selected && onDel && (
        <circle
          cx={mid.x}
          cy={mid.y}
          r={8 * k}
          fill="#fff"
          stroke="#a5371f"
          strokeWidth={1.5 * k}
          onPointerDown={(e) => { e.stopPropagation(); onDel(); }}
          style={{ cursor: "pointer" }}
        />
      )}
    </g>
  );
}

export function TypedLengthHint({ value, k }) {
  if (!value) return null;
  return (
    <g data-ui="typed-length">
      <rect x={12} y={12} width={220 * k} height={30 * k} rx={6 * k} fill="#fff" stroke="#116355" strokeWidth={1.2 * k} />
      <text x={20 * k} y={32 * k} fontSize={12 * k} fill="#116355" fontWeight="600" style={{ fontFamily: "var(--mono)" }}>
        Длина {value} мм · Enter
      </text>
    </g>
  );
}

export function SelectionDims({ it, plan, k, fmtU, display = {} }) {
  if (it.angle && it.angle % 90 !== 0) return null;
  const showObj = display.showObjectDims !== false;
  const showClr = display.showClearanceDims !== false;
  const warnMm = display.dimPassageWarnMm ?? DEFAULT_PASSAGE_WARN_MM;
  const errorMm = display.dimPassageErrorMm ?? DEFAULT_PASSAGE_ERROR_MM;
  const mounted = isWallMountedItem(it);
  const cy = it.y + it.h / 2;

  return (
    <g data-ui="dim-selection">
      {showObj && !mounted && (
        <RectDims x={it.x} y={it.y} w={it.w} h={it.h} k={k} fmtU={fmtU} offset={130} state="active" />
      )}
      {showObj && mounted && (
        <SegDim
          a={{ x: it.x, y: cy }}
          b={{ x: it.x + it.w, y: cy }}
          label={fmtU(it.w)}
          k={k}
          offset={80}
          offsetSide={-1}
          state="active"
        />
      )}
      {showClr && (
        <ClearanceDims it={it} plan={plan} k={k} fmtU={fmtU} warnMm={warnMm} errorMm={errorMm} />
      )}
    </g>
  );
}

export function SelectionMarquee({ rect, k }) {
  if (!rect) return null;
  const x = Math.min(rect.x1, rect.x2);
  const y = Math.min(rect.y1, rect.y2);
  const w = Math.abs(rect.x2 - rect.x1);
  const h = Math.abs(rect.y2 - rect.y1);
  if (w < 2 && h < 2) return null;
  return (
    <rect
      x={x}
      y={y}
      width={w}
      height={h}
      fill="rgba(17,99,85,0.08)"
      stroke="#116355"
      strokeWidth={1.5 * k}
      strokeDasharray={`${5 * k} ${4 * k}`}
      pointerEvents="none"
    />
  );
}

export function MultiSelectBounds({ bounds, k }) {
  if (!bounds) return null;
  const pad = 6 * k;
  return (
    <rect
      x={bounds.x - pad}
      y={bounds.y - pad}
      width={bounds.w + pad * 2}
      height={bounds.h + pad * 2}
      fill="none"
      stroke="#116355"
      strokeWidth={1.5 * k}
      strokeDasharray={`${7 * k} ${5 * k}`}
      pointerEvents="none"
    />
  );
}

export function MeasureEl({ pts, cursor, k, fmtU }) {
  const end = pts.length === 2 ? pts[1] : cursor;
  if (!pts[0] || !end) return null;
  const len = Math.hypot(end.x - pts[0].x, end.y - pts[0].y);
  const mx = (pts[0].x + end.x) / 2;
  const my = (pts[0].y + end.y) / 2;
  return (
    <g>
      <line x1={pts[0].x} y1={pts[0].y} x2={end.x} y2={end.y} stroke="#8f9a94" strokeWidth={1.5 * k} strokeDasharray={`${5 * k} ${4 * k}`} />
      <circle cx={pts[0].x} cy={pts[0].y} r={4 * k} fill="#116355" />
      <circle cx={end.x} cy={end.y} r={4 * k} fill="#116355" />
      <rect x={mx - 36 * k} y={my - 9 * k} width={72 * k} height={15 * k} rx={3 * k} fill="#fff" stroke="#d9e0dc" strokeWidth={0.5 * k} />
      <text x={mx} y={my + 4 * k} fontSize={10 * k} textAnchor="middle" fill="#116355" fontWeight="700" style={{ fontFamily: "var(--mono)" }}>
        {fmtU(len)}
      </text>
    </g>
  );
}
