import React from "react";
import { areaM2, LINE_STYLE, LINK_RULES } from "./catalog.js";
import { ObjectIcon, DoorIcon } from "./icons.jsx";
import { layerOpacity, labelsVisible } from "./geometry.js";
import { linkLengthMm } from "./linkGeometry.js";

const GRID_MINOR = 100;
const GRID_MAJOR = 1000;

export function PlanGrid({ room, zoom, showGrid, showMinorGrid = true }) {
  if (!showGrid) return null;
  const pad = 2000;
  const x0 = -pad;
  const y0 = -pad;
  const x1 = room.w + pad;
  const y1 = room.h + pad;
  const showMinor = showMinorGrid && zoom >= 0.03;
  const L = [];
  const minorColor = "rgba(25,45,38,0.14)";
  const majorColor = "rgba(25,45,38,0.28)";

  for (let x = Math.ceil(x0 / GRID_MINOR) * GRID_MINOR; x <= x1; x += GRID_MINOR) {
    const major = x % GRID_MAJOR === 0;
    if (!showMinor && !major) continue;
    L.push(
      <line
        key={"x" + x}
        x1={x}
        y1={y0}
        x2={x}
        y2={y1}
        stroke={major ? majorColor : minorColor}
        strokeWidth={major ? 1.4 : 0.9}
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  for (let y = Math.ceil(y0 / GRID_MINOR) * GRID_MINOR; y <= y1; y += GRID_MINOR) {
    const major = y % GRID_MAJOR === 0;
    if (!showMinor && !major) continue;
    L.push(
      <line
        key={"y" + y}
        x1={x0}
        y1={y}
        x2={x1}
        y2={y}
        stroke={major ? majorColor : minorColor}
        strokeWidth={major ? 1.4 : 0.9}
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  return <g data-ui="grid" pointerEvents="none">{L}</g>;
}

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

export function DimLine({ x1, y1, x2, y2, label, k, horizontal, active }) {
  const t = 60 * k;
  const fs = 11 * k;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const stroke = active ? "#116355" : "#8f9a94";
  return (
    <g stroke={stroke} strokeWidth={1.1 * k} fill="none">
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      {horizontal ? (
        <>
          <line x1={x1} y1={y1 - t / 2} x2={x1} y2={y1 + t / 2} />
          <line x1={x2} y1={y2 - t / 2} x2={x2} y2={y2 + t / 2} />
        </>
      ) : (
        <>
          <line x1={x1 - t / 2} y1={y1} x2={x1 + t / 2} y2={y1} />
          <line x1={x2 - t / 2} y1={y2} x2={x2 + t / 2} y2={y2} />
        </>
      )}
      <g stroke="none">
        <rect x={mx - 38 * k} y={my - 9 * k} width={76 * k} height={15 * k} rx={3 * k} fill="#fff" stroke="#d9e0dc" strokeWidth={0.5 * k} />
        <text x={mx} y={my + 4 * k} fontSize={fs} textAnchor="middle" fill={stroke} fontWeight="600" style={{ fontFamily: "var(--mono)" }}>
          {label}
        </text>
      </g>
    </g>
  );
}

export function RoomDims({ room, k, fmtU }) {
  const o = 240 * k;
  return (
    <g>
      <DimLine horizontal x1={0} y1={-o} x2={room.w} y2={-o} label={fmtU(room.w)} k={k} />
      <DimLine x1={-o} y1={0} x2={-o} y2={room.h} label={fmtU(room.h)} k={k} />
    </g>
  );
}

export function WallEl({ wall, k, editable, selected, fmtU, showDims, onSel, onNode, onDel, onWallMove }) {
  if (!wall?.pts || wall.pts.length < 2) return null;
  const d = wall.pts.map((p, i) => (i ? "L" : "M") + p.x + " " + p.y).join(" ");
  const outer = selected ? "#116355" : "#2f3431";
  const inner = "#e8e6e3";
  const cx = wall.pts.reduce((s, p) => s + p.x, 0) / wall.pts.length;
  const cy = wall.pts.reduce((s, p) => s + p.y, 0) / wall.pts.length;
  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={outer}
        strokeWidth={wall.thk}
        strokeLinejoin="miter"
        strokeLinecap="butt"
        onPointerDown={(e) => {
          if (editable) {
            e.stopPropagation();
            onSel();
          }
        }}
        style={{ cursor: editable ? "pointer" : "default" }}
      />
      <path
        d={d}
        fill="none"
        stroke={inner}
        strokeWidth={Math.max(wall.thk - 12, 20)}
        strokeLinejoin="miter"
        pointerEvents="none"
      />
      {showDims &&
        wall.pts.map((p, i) => {
          if (!i) return null;
          const a = wall.pts[i - 1];
          const mx = (a.x + p.x) / 2;
          const my = (a.y + p.y) / 2;
          return (
            <g key={i} pointerEvents="none">
              <rect x={mx - 34 * k} y={my - 8 * k} width={68 * k} height={14 * k} rx={3 * k} fill="#fff" stroke="#d9e0dc" strokeWidth={0.5 * k} />
              <text x={mx} y={my + 3.5 * k} fontSize={10 * k} textAnchor="middle" fill="#4b504d" style={{ fontFamily: "var(--mono)" }}>
                {fmtU(Math.hypot(p.x - a.x, p.y - a.y))}
              </text>
            </g>
          );
        })}
      {editable &&
        wall.pts.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={6 * k}
            fill="#fff"
            stroke={outer}
            strokeWidth={1.5 * k}
            onPointerDown={(e) => onNode(e, "walls", wall.id, i)}
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

export function ItemEl({
  it,
  k,
  selected,
  onDown,
  onResize,
  onRotateStart,
  showDims,
  activeLayer,
  vis,
  hasError,
  showLabel,
  display,
}) {
  const opacity = layerOpacity(it.layer, activeLayer, vis[it.layer] !== false, display);
  if (opacity === 0) return null;

  const small = Math.min(it.w, it.h) < 500;
  const a = it.angle || 0;
  const cx = it.x + it.w / 2;
  const cy = it.y + it.h / 2;
  const door = it.icon === "door" || it.icon === "door2";
  const win = it.icon === "window";
  const excluded = it.includedInProject === false;
  const hiddenClient = it.visibleToClient === false;
  const stroke = hasError && display.highlightErrors !== false ? "#a5371f" : selected ? "#116355" : it.color;
  const sw = (selected ? 2.2 : 1.4) * k;
  const layerHighlight =
    (display.highlightRacks && it.layer === "racks") ||
    (display.highlightSockets && it.layer === "sockets") ||
    (display.highlightFurniture && (it.layer === "furn" || it.layer === "staff"));
  const strokeW = layerHighlight && !selected ? sw * 1.6 : sw;
  const sx = it.mirrorH ? -1 : 1;
  const sy = it.mirrorV ? -1 : 1;
  const itemTransform = (sx !== 1 || sy !== 1 || a)
    ? `translate(${cx},${cy}) rotate(${a}) scale(${sx},${sy}) translate(${-cx},${-cy})`
    : undefined;

  return (
    <g transform={itemTransform} opacity={excluded ? opacity * 0.5 : opacity}>
      {door ? (
        <g onPointerDown={onDown} style={{ cursor: "move" }}>
          <line x1={it.x} y1={cy} x2={it.x + it.w} y2={cy} stroke="#f7f8f6" strokeWidth={it.h + 4} />
          <line x1={it.x} y1={cy} x2={it.x + it.w} y2={cy} stroke="#2f3431" strokeWidth={2 * k} />
          <g transform={`translate(${it.x} ${cy})`}>
            <DoorIcon it={{ ...it, color: "#2f3431" }} k={k} swing={it.icon === "door2"} />
          </g>
        </g>
      ) : win ? (
        <g onPointerDown={onDown} style={{ cursor: "move" }}>
          <line x1={it.x} y1={cy} x2={it.x + it.w} y2={cy} stroke="#f7f8f6" strokeWidth={it.h + 6} />
          <line x1={it.x} y1={cy - it.h * 0.2} x2={it.x + it.w} y2={cy - it.h * 0.2} stroke="#5b7c9d" strokeWidth={1.2 * k} />
          <line x1={it.x} y1={cy} x2={it.x + it.w} y2={cy} stroke="#5b7c9d" strokeWidth={1.8 * k} />
          <line x1={it.x} y1={cy + it.h * 0.2} x2={it.x + it.w} y2={cy + it.h * 0.2} stroke="#5b7c9d" strokeWidth={1.2 * k} />
        </g>
      ) : (
        <rect
          x={it.x}
          y={it.y}
          width={it.w}
          height={it.h}
          rx={4 * k}
          fill={it.color}
          fillOpacity={hiddenClient ? 0.03 : 0.06}
          stroke={stroke}
          strokeWidth={strokeW}
          strokeDasharray={excluded || hiddenClient ? `${8 * k} ${5 * k}` : "none"}
          onPointerDown={onDown}
          style={{ cursor: "move" }}
        />
      )}
      <g transform={`translate(${it.x} ${it.y})`}>{!door && !win && <ObjectIcon it={it} k={k} />}</g>
      {showLabel && !door && !win && labelsVisible(it.layer, activeLayer, display) && (
        <LabelBadge it={it} k={k} small={small} cx={cx} cy={cy} />
      )}
      {showDims && selected && !door && !win && (
        <g pointerEvents="none" style={{ fontFamily: "var(--mono)" }}>
          <text x={cx} y={it.y - 8 * k} fontSize={9 * k} textAnchor="middle" fill="#8f9a94">
            {Math.round(it.w)}
          </text>
          <text x={it.x - 6 * k} y={cy + 3 * k} fontSize={9 * k} textAnchor="end" fill="#8f9a94">
            {Math.round(it.h)}
          </text>
        </g>
      )}
      {selected && !door && !win && (
        <>
          <rect
            x={it.x - 2 * k}
            y={it.y - 2 * k}
            width={it.w + 4 * k}
            height={it.h + 4 * k}
            fill="none"
            stroke="#116355"
            strokeWidth={1 * k}
            strokeDasharray={`${4 * k} ${3 * k}`}
            pointerEvents="none"
          />
          <rect
            x={it.x + it.w - 6 * k}
            y={it.y + it.h - 6 * k}
            width={12 * k}
            height={12 * k}
            fill="#fff"
            stroke="#116355"
            strokeWidth={1.5 * k}
            onPointerDown={onResize}
            style={{ cursor: "nwse-resize" }}
          />
          <circle
            cx={cx}
            cy={it.y - 28 * k}
            r={6 * k}
            fill="#fff"
            stroke="#116355"
            strokeWidth={1.5 * k}
            onPointerDown={onRotateStart}
            style={{ cursor: "grab" }}
          />
          <line x1={cx} y1={it.y} x2={cx} y2={it.y - 22 * k} stroke="#116355" strokeWidth={1 * k} pointerEvents="none" />
        </>
      )}
    </g>
  );
}

function LabelBadge({ it, k, small, cx, cy }) {
  const lines = [it.label];
  if (it.params?.tiers) lines.push(`${Math.round(it.w)}×${Math.round(it.h)} · ${it.params.tiers} яр.`);
  const w = Math.max(80, lines[0].length * 7) * k;
  const h = (lines.length * 14 + 8) * k;
  const lx = small ? cx - w / 2 : cx - w / 2;
  const ly = small ? it.y - h - 10 * k : it.y + it.h + 8 * k;
  return (
    <g pointerEvents="none">
      {!small && <line x1={cx} y1={cy} x2={lx + w / 2} y2={ly} stroke="#b9c2bd" strokeWidth={0.8 * k} />}
      <rect x={lx} y={ly} width={w} height={h} rx={3 * k} fill="#fff" stroke="#d9e0dc" strokeWidth={0.8 * k} />
      {lines.map((s, i) => (
        <text key={i} x={lx + 6 * k} y={ly + (14 * (i + 1)) * k} fontSize={11 * k} fill="#1f2925" fontWeight={i === 0 ? 600 : 400}>
          {s}
        </text>
      ))}
    </g>
  );
}

export function ZoneEl({ zn, k, selected, onDown, onResize, fmtU, activeLayer, showDetail }) {
  const cx = zn.x + zn.w / 2;
  const cy = zn.y + zn.h / 2;
  const detail = showDetail || activeLayer === "zones";
  const poly = zn.polygon?.length >= 3;
  const polyD = poly ? `M ${zn.polygon.map((p) => `${p.x} ${p.y}`).join(" L ")} Z` : null;
  return (
    <g>
      {poly ? (
        <path
          d={polyD}
          fill="#8a7a9c"
          fillOpacity={selected ? 0.1 : 0.06}
          stroke="#8a7a9c"
          strokeWidth={(selected ? 2 : 1.2) * k}
          onPointerDown={onDown}
          style={{ cursor: "move" }}
        />
      ) : (
        <rect
          x={zn.x}
          y={zn.y}
          width={zn.w}
          height={zn.h}
          rx={2 * k}
          fill="#8a7a9c"
          fillOpacity={selected ? 0.08 : 0.04}
          stroke="#8a7a9c"
          strokeWidth={(selected ? 2 : 1.2) * k}
          strokeDasharray={detail ? "none" : `${10 * k} ${6 * k}`}
          onPointerDown={onDown}
          style={{ cursor: "move" }}
        />
      )}
      {detail && (
        <>
          <text x={cx} y={cy - 6 * k} fontSize={13 * k} textAnchor="middle" fill="#5a4a6a" fontWeight="600" pointerEvents="none">
            {zn.name}
          </text>
          <text x={cx} y={cy + 12 * k} fontSize={11 * k} textAnchor="middle" fill="#8a7a9c" pointerEvents="none" style={{ fontFamily: "var(--mono)" }}>
            S = {areaM2(zn.w, zn.h)} м²
          </text>
          {activeLayer === "zones" && (
            <text x={cx} y={cy + 28 * k} fontSize={10 * k} textAnchor="middle" fill="#9c8aac" pointerEvents="none" style={{ fontFamily: "var(--mono)" }}>
              H = {(zn.height / 1000).toFixed(2)} м
            </text>
          )}
        </>
      )}
      {selected && (
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

export function LabelEl({ lb, items, k, selected, onDown, activeLayer }) {
  const lines = (lb.text || "").split("\n");
  const w = Math.max(120, ...lines.map((s) => s.length * 7.5)) * k;
  const h = (lines.length * 15 + 10) * k;
  const tgt = lb.targetId ? items.find((i) => i.id === lb.targetId) : null;
  const show = !tgt || labelsVisible(tgt.layer, activeLayer);
  if (!show) return null;
  return (
    <g opacity={selected ? 1 : 0.9}>
      {tgt && (
        <line x1={lb.x} y1={lb.y + h / 2} x2={tgt.x + tgt.w / 2} y2={tgt.y + tgt.h / 2} stroke="#b9c2bd" strokeWidth={1 * k} />
      )}
      <rect
        x={lb.x}
        y={lb.y}
        width={w}
        height={h}
        rx={3 * k}
        fill="#fff"
        stroke={selected ? "#116355" : "#d9e0dc"}
        strokeWidth={(selected ? 1.6 : 1) * k}
        onPointerDown={onDown}
        style={{ cursor: "move" }}
      />
      {lines.map((s, i) => (
        <text key={i} x={lb.x + 6 * k} y={lb.y + (15 * (i + 1) - 3) * k} fontSize={11 * k} fill="#1f2925" pointerEvents="none">
          {s}
        </text>
      ))}
    </g>
  );
}

export function LineEl({ line, k, showDims, editable, selected, onSel, onNode, onDel, fmtU, activeLayer, vis, display }) {
  const opacity = layerOpacity(line.layer, activeLayer, vis[line.layer] !== false, display);
  if (opacity === 0) return null;
  const st = LINE_STYLE[line.layer] || LINE_STYLE.irrigation || LINE_STYLE.supply;
  const d = line.pts.map((p, i) => (i ? "L" : "M") + p.x + " " + p.y).join(" ");
  return (
    <g opacity={opacity}>
      <path
        d={d}
        fill="none"
        stroke={st.color}
        strokeWidth={(selected ? st.w + 1 : st.w) * k}
        strokeDasharray={st.dash ? `${8 * k} ${5 * k}` : "none"}
        strokeLinejoin="round"
        strokeLinecap="round"
        onPointerDown={(e) => {
          if (editable) {
            e.stopPropagation();
            onSel();
          }
        }}
        style={{ cursor: editable ? "pointer" : "default" }}
      />
      {st.arrow && line.pts.length >= 2 && <Arrow a={line.pts[line.pts.length - 2]} b={line.pts[line.pts.length - 1]} k={k} color={st.color} />}
      {showDims &&
        line.pts.map((p, i) => {
          if (!i) return null;
          const a = line.pts[i - 1];
          const mx = (a.x + p.x) / 2;
          const my = (a.y + p.y) / 2;
          return (
            <g key={i} pointerEvents="none">
              <rect x={mx - 30 * k} y={my - 8 * k} width={60 * k} height={13 * k} rx={3 * k} fill="#fff" stroke="#d9e0dc" strokeWidth={0.5 * k} />
              <text x={mx} y={my + 3.5 * k} fontSize={9.5 * k} textAnchor="middle" fill={st.color} style={{ fontFamily: "var(--mono)" }}>
                {fmtU(Math.hypot(p.x - a.x, p.y - a.y))}
              </text>
            </g>
          );
        })}
      {editable &&
        line.pts.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={5 * k}
            fill="#fff"
            stroke={st.color}
            strokeWidth={1.5 * k}
            onPointerDown={(e) => onNode(e, "lines", line.id, i)}
            style={{ cursor: "move" }}
          />
        ))}
      {editable && selected && (
        <text x={line.pts[0].x + 10 * k} y={line.pts[0].y - 10 * k} fontSize={13 * k} fill="#a5371f" style={{ cursor: "pointer" }} onClick={onDel}>
          ✕
        </text>
      )}
    </g>
  );
}

function Arrow({ a, b, k, color }) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const s = 30 * k;
  return (
    <g stroke={color} strokeWidth={2 * k} fill="none">
      <line x1={b.x} y1={b.y} x2={b.x - s * Math.cos(ang - 0.4)} y2={b.y - s * Math.sin(ang - 0.4)} />
      <line x1={b.x} y1={b.y} x2={b.x - s * Math.cos(ang + 0.4)} y2={b.y - s * Math.sin(ang + 0.4)} />
    </g>
  );
}

export function DraftLine({ pts, cursor, k, wall, thk, color, fmtU, snapPt }) {
  const all = cursor ? [...pts, cursor] : pts;
  const d = all.map((p, i) => (i ? "L" : "M") + p.x + " " + p.y).join(" ");
  const lenColor = wall ? "#2f3431" : color;
  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={wall ? "#2f3431" : color}
        strokeWidth={wall ? thk : 3 * k}
        strokeDasharray={wall ? "none" : `${6 * k} ${4 * k}`}
        opacity={wall ? 0.55 : 0.85}
        strokeLinecap={wall ? "butt" : "round"}
      />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={5 * k} fill={wall ? "#2f3431" : color} />
      ))}
      {snapPt?.snapped && cursor && (
        <circle cx={cursor.x} cy={cursor.y} r={8 * k} fill="none" stroke="#116355" strokeWidth={2 * k} opacity={0.85} />
      )}
      {cursor && pts.length > 0 && (
        <text
          x={(pts[pts.length - 1].x + cursor.x) / 2}
          y={(pts[pts.length - 1].y + cursor.y) / 2 - 8 * k}
          fontSize={11 * k}
          textAnchor="middle"
          fill={lenColor}
          fontWeight="600"
          style={{ fontFamily: "var(--mono)" }}
        >
          {fmtU(Math.hypot(cursor.x - pts[pts.length - 1].x, cursor.y - pts[pts.length - 1].y))}
        </text>
      )}
    </g>
  );
}

export function LinkEl({ link, items, room, k, selected, showLabel, onDown, onDel }) {
  const rule = LINK_RULES[link.type] || { color: "#5a5f5c", label: "Связь" };
  const { pts, total } = linkLengthMm(link, items, room);
  if (pts.length < 2) return null;
  const d = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const mid = pts[Math.floor(pts.length / 2)];
  const sw = (selected ? 2.4 : 1.6) * k;
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const ang = Math.atan2(last.y - prev.y, last.x - prev.x) * 180 / Math.PI;

  return (
    <g>
      <polyline
        points={d}
        fill="none"
        stroke={rule.color}
        strokeWidth={sw}
        strokeDasharray={`${8 * k} ${5 * k}`}
        opacity={selected ? 1 : 0.85}
        onPointerDown={onDown}
        style={{ cursor: "pointer" }}
      />
      <g transform={`translate(${last.x},${last.y}) rotate(${ang})`} pointerEvents="none">
        <polygon
          points={`0,0 ${-10 * k},${-5 * k} ${-10 * k},${5 * k}`}
          fill={rule.color}
        />
      </g>
      {showLabel && (
        <text
          x={mid.x}
          y={mid.y - 8 * k}
          fontSize={9 * k}
          textAnchor="middle"
          fill={rule.color}
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
      <rect x={12} y={12} width={180 * k} height={28 * k} rx={6 * k} fill="#fff" stroke="#116355" strokeWidth={1.2 * k} />
      <text x={20 * k} y={32 * k} fontSize={12 * k} fill="#116355" fontWeight="600" style={{ fontFamily: "var(--mono)" }}>
        Длина: {value} мм ↵
      </text>
    </g>
  );
}

export function SelectionDims({ it, room, k, fmtU }) {
  if (it.angle && it.angle % 90 !== 0) return null;
  const cy = it.y + it.h / 2;
  const cx = it.x + it.w / 2;
  return (
    <g>
      {it.x > 1 && <DimLine horizontal x1={0} y1={cy} x2={it.x} y2={cy} label={fmtU(it.x)} k={k} active />}
      {it.y > 1 && <DimLine x1={cx} y1={0} x2={cx} y2={it.y} label={fmtU(it.y)} k={k} active />}
      {room.w - (it.x + it.w) > 1 && (
        <DimLine horizontal x1={it.x + it.w} y1={cy} x2={room.w} y2={cy} label={fmtU(room.w - it.x - it.w)} k={k} active />
      )}
      {room.h - (it.y + it.h) > 1 && (
        <DimLine x1={cx} y1={it.y + it.h} x2={cx} y2={room.h} label={fmtU(room.h - it.y - it.h)} k={k} active />
      )}
    </g>
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
