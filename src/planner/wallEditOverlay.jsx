import React from "react";

function segDir(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function interiorAngleDeg(a, b, c) {
  const v1 = segDir(b, a);
  const v2 = segDir(b, c);
  const dot = Math.max(-1, Math.min(1, v1.x * v2.x + v1.y * v2.y));
  const ang = (Math.acos(dot) * 180) / Math.PI;
  return Number.isFinite(ang) ? ang : null;
}

function segmentsAt(walls, pt, excludeWallId, thr = 85) {
  const segs = [];
  for (const w of walls || []) {
    if (!w?.pts || w.pts.length < 2) continue;
    for (let i = 1; i < w.pts.length; i++) {
      const a = w.pts[i - 1];
      const b = w.pts[i];
      if (dist(pt, a) <= thr) segs.push({ a: b, b: a, wallId: w.id });
      else if (dist(pt, b) <= thr) segs.push({ a, b, wallId: w.id });
    }
  }
  return segs;
}

function junctionAngle(segs) {
  if (segs.length < 2) return null;
  let best = null;
  let bestScore = -1;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const d1 = segDir(segs[i].a, segs[i].b);
      const d2 = segDir(segs[j].a, segs[j].b);
      const dot = Math.max(-1, Math.min(1, Math.abs(d1.x * d2.x + d1.y * d2.y)));
      const score = 1 - dot;
      if (score > bestScore) {
        bestScore = score;
        const ang = (Math.acos(dot) * 180) / Math.PI;
        if (Number.isFinite(ang)) best = ang;
      }
    }
  }
  return best;
}

/** Углы в вершинах выбранной стены (без комбинаторного взрыва). */
export function wallCornerAnglesFor(walls, wallId, thr = 85) {
  const wall = walls.find((w) => w.id === wallId);
  if (!wall?.pts?.length) return [];

  const out = [];
  const seen = new Set();

  const push = (x, y, angle, key) => {
    if (angle == null || !Number.isFinite(angle)) return;
    const k = `${Math.round(x / 25)}_${Math.round(y / 25)}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ x, y, angle, key });
  };

  for (let i = 1; i < wall.pts.length - 1; i++) {
    push(
      wall.pts[i].x,
      wall.pts[i].y,
      interiorAngleDeg(wall.pts[i - 1], wall.pts[i], wall.pts[i + 1]),
      `in-${i}`,
    );
  }

  for (const idx of [0, wall.pts.length - 1]) {
    const p = wall.pts[idx];
    const segs = segmentsAt(walls, p, wallId, thr);
    const ang = junctionAngle(segs);
    if (ang != null) push(p.x, p.y, ang, `ep-${idx}`);
  }

  return out.slice(0, 8);
}

export function WallCornerAngleLabels({ walls, wallId, k = 1 }) {
  const corners = wallCornerAnglesFor(walls, wallId);
  if (!corners.length) return null;
  return (
    <g pointerEvents="none" data-ui="wall-angles">
      {corners.map(({ x, y, angle, key }) => (
        <text
          key={key}
          x={x + 14 * k}
          y={y - 10 * k}
          fontSize={9.5 * k}
          fill="#c44a2f"
          fontWeight="700"
          style={{ fontFamily: "var(--mono)" }}
        >
          {angle.toFixed(1)}°
        </text>
      ))}
    </g>
  );
}

const NUDGE_DIRS = [
  { dx: 0, dy: -1, chev: "M -5 3 L 0 -4 L 5 3" },
  { dx: 1, dy: 0, chev: "M -3 -5 L 4 0 L -3 5" },
  { dx: 0, dy: 1, chev: "M -5 -3 L 0 4 L 5 -3" },
  { dx: -1, dy: 0, chev: "M 3 -5 L -4 0 L 3 5" },
];

/** Круг с 4 стрелками — сдвиг на stepMm (по умолчанию 10 мм = 1 см). */
export function WallNudgePad({ x, y, k = 1, stepMm = 10, onNudge }) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const ring = 38 * k;
  const btnR = 14 * k;
  return (
    <g data-ui="wall-nudge" pointerEvents="all">
      <circle cx={x} cy={y} r={6 * k} fill="#c44a2f" stroke="#fff" strokeWidth={1.8 * k} />
      {NUDGE_DIRS.map(({ dx, dy, chev }, i) => {
        const bx = x + dx * ring;
        const by = y + dy * ring;
        return (
          <g
            key={i}
            style={{ cursor: "pointer" }}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onNudge(dx * stepMm, dy * stepMm);
            }}
          >
            <circle cx={bx} cy={by} r={btnR} fill="#fff" stroke="#c44a2f" strokeWidth={1.8 * k} />
            <path
              d={chev}
              transform={`translate(${bx}, ${by}) scale(${1.35 * k})`}
              fill="none"
              stroke="#c44a2f"
              strokeWidth={2.4}
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

export function WallEditOverlay({ walls, selection, k, stepMm = 10, onNudge }) {
  if (selection?.coll !== "walls" || selection.ids?.length !== 1) return null;
  const wall = walls.find((w) => w.id === selection.ids[0]);
  if (!wall?.pts?.length) return null;

  let nx = wall.pts.reduce((s, p) => s + p.x, 0) / wall.pts.length;
  let ny = wall.pts.reduce((s, p) => s + p.y, 0) / wall.pts.length;
  const nidx = selection.nodeIdx;
  if (nidx === -1 && wall.pts.length === 2) {
    nx = (wall.pts[0].x + wall.pts[1].x) / 2;
    ny = (wall.pts[0].y + wall.pts[1].y) / 2;
  } else if (nidx != null && nidx >= 0 && wall.pts[nidx]) {
    nx = wall.pts[nidx].x;
    ny = wall.pts[nidx].y;
  }

  if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;

  return (
    <g data-ui="wall-edit-overlay" pointerEvents="none">
      <g pointerEvents="all">
        <WallNudgePad x={nx} y={ny} k={k} stepMm={stepMm} onNudge={onNudge} />
      </g>
    </g>
  );
}
