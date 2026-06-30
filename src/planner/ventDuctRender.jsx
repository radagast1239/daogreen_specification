import React from "react";
import { DG_THEME } from "./plannerVisualTheme.js";

export const DEFAULT_DUCT_SIZE_W_MM = 2040;
export const DEFAULT_DUCT_SIZE_H_MM = 600;

/** Подпись сечения как на чертеже: 2040×600 мм → «20.4×6». */
export function formatDuctSizeLabel(wMm, hMm) {
  const w = Number(wMm);
  const h = Number(hMm);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return "";
  const wLabel = (w / 100).toFixed(1).replace(/\.0$/, "");
  const hLabel = Math.abs((h / 100) - Math.round(h / 100)) < 0.05
    ? String(Math.round(h / 100))
    : (h / 100).toFixed(1);
  return `${wLabel}×${hLabel}`;
}

export function ductPlanHalfWidth(line) {
  const h = line?.ductSizeHmm ?? DEFAULT_DUCT_SIZE_H_MM;
  return Math.max(40, Math.min(220, h / 2));
}

function segDir(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len, len };
}

function perp(v) {
  return { x: -v.y, y: v.y };
}

function offsetPt(p, v, half, sideSign) {
  const n = perp(v);
  return { x: p.x + n.x * half * sideSign, y: p.y + n.y * half * sideSign };
}

function ptDist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function isOrthoTurn(v1, v2) {
  return Math.abs(v1.x * v2.x + v1.y * v2.y) < 0.08;
}

/** Пересечение двух прямых: p1 + t·d1 и p2 + u·d2. */
function lineMeet(p1, d1, p2, d2) {
  const cross = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(cross) < 1e-6) return null;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const t = (dx * d2.y - dy * d2.x) / cross;
  return { x: p1.x + d1.x * t, y: p1.y + d1.y * t };
}

/**
 * Одна параллельная линия контура воздуховода.
 * Внутренние углы — miter; внешние 90° — дуга; остальное — miter с ограничением.
 */
function buildSidePath(pts, half, sideSign) {
  const n = pts.length;
  if (n < 2) return "";

  const v0 = segDir(pts[0], pts[1]);
  const startPt = offsetPt(pts[0], v0, half, sideSign);
  let d = `M${startPt.x} ${startPt.y}`;

  for (let i = 0; i < n - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const v = segDir(a, b);

    if (i < n - 2) {
      const v2 = segDir(b, pts[i + 2]);
      const cross = v.x * v2.y - v.y * v2.x;
      const ortho = isOrthoTurn(v, v2);
      const outer = ortho && cross * sideSign > 0;
      const segEnd = offsetPt(b, v, half, sideSign);

      if (outer) {
        const arcEnd = offsetPt(b, v2, half, sideSign);
        d += ` L${segEnd.x} ${segEnd.y}`;
        const sweep = cross > 0 ? 1 : 0;
        d += ` A${half} ${half} 0 0 ${sweep} ${arcEnd.x} ${arcEnd.y}`;
      } else {
        const p1 = segEnd;
        const p2 = offsetPt(b, v2, half, sideSign);
        const m = lineMeet(p1, v, p2, v2);
        if (m && ptDist(m, b) <= half * 6) {
          d += ` L${m.x} ${m.y}`;
        } else {
          d += ` L${p1.x} ${p1.y} L${p2.x} ${p2.y}`;
        }
      }
    } else {
      const end = offsetPt(b, v, half, sideSign);
      d += ` L${end.x} ${end.y}`;
    }
  }
  return d;
}

function elbowJoints(pts, half) {
  const joints = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const v1 = segDir(pts[i - 1], pts[i]);
    const v2 = segDir(pts[i], pts[i + 1]);
    if (!isOrthoTurn(v1, v2)) continue;
    const cur = pts[i];
    const bx = v1.x + v2.x;
    const by = v1.y + v2.y;
    const bl = Math.hypot(bx, by);
    if (bl < 0.01) continue;
    const tick = Math.min(half * 0.9, 30);
    joints.push({
      a: { x: cur.x - (bx / bl) * tick, y: cur.y - (by / bl) * tick },
      b: { x: cur.x + (bx / bl) * tick, y: cur.y + (by / bl) * tick },
    });
  }
  return joints;
}

function segmentLabels(pts, labelText) {
  if (!labelText) return [];
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const v = segDir(pts[i], pts[i + 1]);
    if (v.len < 280) continue;
    let ang = (Math.atan2(v.y, v.x) * 180) / Math.PI;
    if (ang > 90 || ang < -90) ang += 180;
    out.push({
      x: (pts[i].x + pts[i + 1].x) / 2,
      y: (pts[i].y + pts[i + 1].y) / 2,
      ang,
      text: labelText,
    });
  }
  return out;
}

export function isVentDuctLine(line) {
  return line?.layer === "vent" || line?.strokeStyle === "duct";
}

export function VentDuctGraphic({
  pts,
  line,
  k,
  color,
  selected = false,
  hovered = false,
  onPointerDown,
  onHover,
  editable = false,
  locked = false,
}) {
  if (!pts || pts.length < 2) return null;
  const half = ductPlanHalfWidth(line);
  const stroke = selected ? "#116355" : hovered ? "#2f6f8f" : (color || "#4a74a8");
  const sw = 1.15 * k;
  const label = formatDuctSizeLabel(line?.ductSizeWmm, line?.ductSizeHmm);
  const sideA = buildSidePath(pts, half, 1);
  const sideB = buildSidePath(pts, half, -1);
  const joints = elbowJoints(pts, half);
  const labels = segmentLabels(pts, label);
  const hitW = Math.max(half * 2 + 20 * k, 28 * k);

  const hitProps = editable && !locked ? {
    onPointerDown,
    onPointerEnter: onHover ? () => onHover(true) : undefined,
    onPointerLeave: onHover ? () => onHover(false) : undefined,
    style: { cursor: "pointer" },
  } : { pointerEvents: "none" };

  const centerHit = pts.slice(0, -1).map((a, i) => {
    const b = pts[i + 1];
    const v = segDir(a, b);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const px = -v.y * hitW * 0.5;
    const py = v.x * hitW * 0.5;
    return `M${mx - v.x * v.len * 0.48 + px} ${my - v.y * v.len * 0.48 + py} L${mx + v.x * v.len * 0.48 + px} ${my + v.y * v.len * 0.48 + py} L${mx + v.x * v.len * 0.48 - px} ${my + v.y * v.len * 0.48 - py} L${mx - v.x * v.len * 0.48 - px} ${my - v.y * v.len * 0.48 - py} Z`;
  }).join(" ");

  return (
    <g data-ui="vent-duct">
      {centerHit && (
        <path d={centerHit} fill="transparent" stroke="none" {...hitProps} />
      )}
      <path d={sideA} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="square" strokeLinejoin="miter" pointerEvents="none" />
      <path d={sideB} fill="none" stroke={stroke} strokeWidth={sw} strokeLinecap="square" strokeLinejoin="miter" pointerEvents="none" />
      {joints.map((j, i) => (
        <line
          key={`j${i}`}
          x1={j.a.x}
          y1={j.a.y}
          x2={j.b.x}
          y2={j.b.y}
          stroke={stroke}
          strokeWidth={sw * 0.95}
          pointerEvents="none"
        />
      ))}
      {labels.map((lb, i) => {
        const fs = Math.max(8 * k, Math.min(11 * k, half * 0.55));
        const padX = 4 * k;
        const padY = 2.5 * k;
        const boxW = lb.text.length * fs * 0.58 + padX * 2;
        const boxH = fs + padY * 2;
        return (
          <g key={`lb${i}`} transform={`translate(${lb.x},${lb.y}) rotate(${lb.ang})`} pointerEvents="none">
            <rect
              x={-boxW / 2}
              y={-boxH / 2}
              width={boxW}
              height={boxH}
              fill="#fff"
              stroke={DG_THEME.labelBorder}
              strokeWidth={0.55 * k}
              rx={2 * k}
            />
            <text
              x={0}
              y={fs * 0.32}
              fontSize={fs}
              textAnchor="middle"
              fill="#2f3431"
              fontWeight="600"
              style={{ fontFamily: "var(--mono)" }}
            >
              {lb.text}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export function VentDuctDraftGraphic({ pts, cursor, line, k, color }) {
  const all = cursor ? [...pts, cursor] : pts;
  if (all.length < 2) return null;
  const mockLine = line || {};
  return (
    <VentDuctGraphic
      pts={all}
      line={mockLine}
      k={k}
      color={color || "#4a74a8"}
      editable={false}
    />
  );
}
