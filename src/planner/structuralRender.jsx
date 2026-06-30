import React from "react";
import { STRUCTURAL_KINDS } from "./structuralTypes.js";
import { structuralFootprint } from "./structuralGeometry.js";

function polyD(pts) {
  if (!pts?.length) return "";
  return `M ${pts.map((p) => `${p.x} ${p.y}`).join(" L ")} Z`;
}

function StructuralShape({ s, k, selected, hovered, hasError }) {
  const meta = STRUCTURAL_KINDS[s.kind] || STRUCTURAL_KINDS.beam;
  const fp = structuralFootprint(s);
  if (!fp?.polygon) return null;
  const stroke = hasError ? "#c44a2f" : selected ? "#116355" : hovered ? "#5a9d8f" : meta.stroke;
  const sw = (selected ? 2.2 : 1.6) * k;
  return (
    <path
      d={polyD(fp.polygon)}
      fill={meta.fill}
      stroke={stroke}
      strokeWidth={sw}
      strokeLinejoin="miter"
    />
  );
}

export function StructuralEl({
  s, k, editable, selected, hovered, hasError, fmtU, showDims, onSel, onDel,
}) {
  const fp = structuralFootprint(s);
  if (!fp) return null;
  const meta = STRUCTURAL_KINDS[s.kind] || STRUCTURAL_KINDS.beam;
  const cx = s.kind === "column" && s.center
    ? s.center.x
    : (s.a.x + s.b.x) / 2;
  const cy = s.kind === "column" && s.center
    ? s.center.y
    : (s.a.y + s.b.y) / 2;

  return (
    <g data-structural={s.id}>
      <StructuralShape s={s} k={k} selected={selected} hovered={hovered} hasError={hasError} />
      {editable && (
        <path
          d={polyD(fp.polygon)}
          fill="transparent"
          stroke="transparent"
          strokeWidth={Math.max(s.width || 200, 80)}
          onPointerDown={(e) => { e.stopPropagation(); onSel?.(); }}
          style={{ cursor: "pointer" }}
        />
      )}
      {selected && editable && (
        <>
          <text x={cx} y={cy - 8 * k} fontSize={8.5 * k} textAnchor="middle" fill="#6b7d74" pointerEvents="none">
            {meta.label} · {fmtU(s.width)}
          </text>
          <text x={cx + 12 * k} y={cy - 18 * k} fontSize={12 * k} fill="#a5371f" style={{ cursor: "pointer" }} onClick={onDel}>
            ✕
          </text>
        </>
      )}
      {showDims && s.kind !== "column" && s.a && s.b && (
        <text x={cx} y={cy + 14 * k} fontSize={9 * k} textAnchor="middle" fill="#5a5f5c" pointerEvents="none" style={{ fontFamily: "var(--mono)" }}>
          {fmtU(Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y))}
        </text>
      )}
    </g>
  );
}

export function StructuralDraft({ kind, a, b, width, k, fmtU }) {
  if (!a) return null;
  const draft = kind === "column"
    ? { kind, center: a, width }
    : { kind, a, b: b || a, width };
  const meta = STRUCTURAL_KINDS[kind] || STRUCTURAL_KINDS.beam;
  const fp = structuralFootprint(draft);
  if (!fp) return null;
  return (
    <g pointerEvents="none" opacity={0.88}>
      <path d={polyD(fp.polygon)} fill={meta.fill} stroke={meta.stroke} strokeWidth={1.8 * k} strokeDasharray={`${6 * k} ${4 * k}`} />
      {b && kind !== "column" && (
        <text
          x={(a.x + b.x) / 2}
          y={(a.y + b.y) / 2 - 12 * k}
          fontSize={10 * k}
          textAnchor="middle"
          fill="#116355"
          fontWeight="700"
          style={{ fontFamily: "var(--mono)" }}
        >
          {fmtU(Math.hypot(b.x - a.x, b.y - a.y))}
        </text>
      )}
    </g>
  );
}

export function PlanMeasurementEl({ m, k, fmtU, selected, onSel }) {
  if (!m?.a || !m?.b) return null;
  const len = Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y);
  const mx = (m.a.x + m.b.x) / 2;
  const my = (m.a.y + m.b.y) / 2;
  const col = selected ? "#116355" : "#8f9a94";
  return (
    <g
      data-measurement={m.id}
      onPointerDown={(e) => { e.stopPropagation(); onSel?.(); }}
      style={{ cursor: "pointer" }}
    >
      <line x1={m.a.x} y1={m.a.y} x2={m.b.x} y2={m.b.y} stroke={col} strokeWidth={(selected ? 2 : 1.5) * k} strokeDasharray={`${5 * k} ${4 * k}`} />
      <circle cx={m.a.x} cy={m.a.y} r={(selected ? 5 : 4) * k} fill={col} />
      <circle cx={m.b.x} cy={m.b.y} r={(selected ? 5 : 4) * k} fill={col} />
      <rect x={mx - 36 * k} y={my - 9 * k} width={72 * k} height={15 * k} rx={3 * k} fill="#fff" stroke={selected ? "#116355" : "#d9e0dc"} strokeWidth={0.5 * k} />
      <text x={mx} y={my + 4 * k} fontSize={10 * k} textAnchor="middle" fill={col} fontWeight="700" style={{ fontFamily: "var(--mono)" }}>
        {fmtU(len)}
      </text>
    </g>
  );
}
