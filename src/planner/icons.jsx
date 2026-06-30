import React, { useId } from "react";
import { isRackKind, rackIconForType } from "./rackProperties.js";
import { acMountHeightPlanLabel } from "./acProperties.js";
import { DG_THEME } from "./plannerVisualTheme.js";
// Иконки объектов сверху. Локальные координаты (0..w, 0..h). k = 1/zoom.

function useDraw(it, k, opts = {}) {
  const { w, h } = it;
  const color = opts.stroke || it.color || "#3d4a46";
  const baseFill = opts.fillOpacity ?? 0.06;
  const sw = (opts.strokeWidth ?? 1.2) * k;
  const o = opts.lineOpacity ?? 0.78;
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) / 2;
  const detail = k <= 3;
  const ln = (x1, y1, x2, y2, op = o, wgt = 1) => (
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={sw * wgt} opacity={op} />
  );
  const cir = (x, y, rr, fill = "none", op = o) => (
    <circle cx={x} cy={y} r={rr} fill={fill === "none" ? "none" : color} fillOpacity={fill === "none" ? 0 : 0.55} stroke={color} strokeWidth={sw} opacity={op} />
  );
  const rect = (x, y, ww, hh, rx = 0, op = o, fillOp = 0) => (
    <rect x={x} y={y} width={ww} height={hh} rx={rx} fill={fillOp ? color : "none"} fillOpacity={fillOp} stroke={color} strokeWidth={sw} opacity={op} />
  );
  const fill = (x, y, ww, hh, rx = 0, fillOp) => (
    <rect x={x} y={y} width={ww} height={hh} rx={rx} fill={color} fillOpacity={fillOp ?? baseFill} stroke="none" />
  );
  const elli = (x, y, rx, ry, op = o) => (
    <ellipse cx={x} cy={y} rx={rx} ry={ry} fill="none" stroke={color} strokeWidth={sw} opacity={op} />
  );
  const posts = (inset = 0.04) => {
    const leg = 5 * k;
    return [[inset * w, inset * h], [w - inset * w, inset * h], [inset * w, h - inset * h], [w - inset * w, h - inset * h]].map(([lx, ly], i) => (
      <rect key={`p${i}`} x={lx - leg / 2} y={ly - leg / 2} width={leg} height={leg} fill={color} fillOpacity={0.35} stroke={color} strokeWidth={sw * 0.8} />
    ));
  };
  const legs4 = (tx, ty, tw, th) => {
    const s = 4 * k;
    const off = 6 * k;
    return [[tx + off, ty + off], [tx + tw - off, ty + off], [tx + off, ty + th - off], [tx + tw - off, ty + th - off]].map(([lx, ly], i) => (
      <rect key={`lg${i}`} x={lx - s / 2} y={ly - s / 2} width={s} height={s} fill={color} fillOpacity={0.4} stroke={color} strokeWidth={sw * 0.7} />
    ));
  };
  const flowArrow = (x1, y1, x2, y2, op = 0.65) => {
    const ang = Math.atan2(y2 - y1, x2 - x1);
    const al = 5 * k;
    const ax = x2 - Math.cos(ang) * al;
    const ay = y2 - Math.sin(ang) * al;
    return (
      <g opacity={op}>
        {ln(x1, y1, x2, y2, 1, 0.85)}
        <polygon points={`${x2},${y2} ${ax - Math.sin(ang) * 3 * k},${ay + Math.cos(ang) * 3 * k} ${ax + Math.sin(ang) * 3 * k},${ay - Math.cos(ang) * 3 * k}`} fill={color} stroke="none" />
      </g>
    );
  };
  return { w, h, color, sw, o, cx, cy, r, detail, ln, cir, rect, fill, elli, posts, legs4, flowArrow, baseFill };
}

function RackAero({ d, it }) {
  const { w, h, detail, fill, posts, cir, ln } = d;
  const cols = it?.channelCount || it?.params?.levels || Math.max(4, Math.round(w / 90));
  const rows = it?.tierCount || it?.params?.tiers || Math.max(3, Math.round(h / 90));
  const L = [fill(0, 0, w, h, 3 * d.sw, 0.07), ...posts()];
  const dx = (w * 0.84) / cols;
  const dy = (h * 0.84) / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = w * 0.08 + c * dx + dx * 0.5;
      const y = h * 0.08 + r * dy + dy * 0.5;
      L.push(cir(x, y, Math.min(dx, dy) * 0.22, detail ? "fill" : "none", detail ? 0.35 : 0.5));
      if (detail && c < cols - 1) L.push(ln(x + dx * 0.22, y, x + dx * 0.78, y, 0.3, 0.45));
    }
  }
  return <g pointerEvents="none">{L}</g>;
}

function RackNft({ d, it }) {
  const { w, h, detail, fill, posts, ln } = d;
  const n = it?.tierCount || it?.params?.tiers || Math.max(3, Math.min(12, Math.round(w / 180)));
  const channels = it?.channelCount || it?.params?.levels || Math.max(4, Math.round(h / 90));
  const L = [fill(0, 0, w, h, 3 * d.sw, 0.06), ...posts()];
  for (let i = 1; i < n; i++) L.push(ln(i * (w / n), h * 0.06, i * (w / n), h * 0.94, 0.55, 0.7));
  for (let j = 1; j < channels; j++) {
    const y = (h * j) / channels;
    L.push(ln(w * 0.05, y, w * 0.95, y, detail ? 0.45 : 0.3, 0.5));
  }
  return <g pointerEvents="none">{L}</g>;
}

function RackFlood({ d, it }) {
  const { w, h, detail, fill, posts, rect, ln } = d;
  const tiers = it?.tierCount || it?.params?.tiers || Math.max(2, Math.round(h / 200));
  const trays = it?.channelCount || it?.params?.levels || Math.max(2, Math.round(w / 400));
  const L = [fill(0, 0, w, h, 3 * d.sw, 0.06), ...posts()];
  for (let t = 0; t < tiers; t++) {
    const y0 = h * 0.08 + (t * (h * 0.84)) / tiers;
    const th = (h * 0.84) / tiers * 0.55;
    for (let b = 0; b < trays; b++) {
      const x0 = w * 0.06 + (b * (w * 0.88)) / trays;
      const bw = (w * 0.88) / trays * 0.88;
      L.push(rect(x0, y0, bw, th, 2 * d.sw, 0.6, 0));
      if (detail) L.push(ln(x0 + bw * 0.1, y0 + th * 0.5, x0 + bw * 0.9, y0 + th * 0.5, 0.35, 0.45));
    }
    if (t < tiers - 1) L.push(ln(w * 0.04, y0 + th + h * 0.02, w * 0.96, y0 + th + h * 0.02, 0.4, 0.6));
  }
  return <g pointerEvents="none">{L}</g>;
}

function RackSeedling({ d, it }) {
  const { w, h, detail, fill, posts, rect, cir } = d;
  const cols = it?.channelCount || it?.params?.levels || Math.max(3, Math.round(w / 120));
  const rows = it?.tierCount || it?.params?.tiers || Math.max(2, Math.round(h / 100));
  const L = [fill(0, 0, w, h, 3 * d.sw, 0.06), ...posts()];
  const cw = (w * 0.86) / cols;
  const ch = (h * 0.86) / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = w * 0.07 + c * cw;
      const y = h * 0.07 + r * ch;
      L.push(rect(x, y, cw * 0.88, ch * 0.88, 1.5 * d.sw, 0.5, 0));
      if (detail && (r + c) % 2 === 0) L.push(cir(x + cw * 0.44, y + ch * 0.44, Math.min(cw, ch) * 0.12, "none", 0.35));
    }
  }
  return <g pointerEvents="none">{L}</g>;
}

function RackStrawberry({ d, it }) {
  const { w, h, detail, fill, posts, cir } = d;
  const rows = it?.tierCount || it?.params?.tiers || Math.max(3, Math.round(h / 80));
  const cols = it?.channelCount || it?.params?.levels || Math.max(4, Math.round(w / 70));
  const L = [fill(0, 0, w, h, 3 * d.sw, 0.06), ...posts()];
  const dx = (w * 0.84) / cols;
  const dy = (h * 0.84) / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!detail && (r + c) % 2 === 1) continue;
      L.push(cir(w * 0.08 + c * dx + dx * 0.5, h * 0.08 + r * dy + dy * 0.5, Math.min(dx, dy) * 0.18, detail ? "fill" : "none", detail ? 0.4 : 0.55));
    }
  }
  return <g pointerEvents="none">{L}</g>;
}

function RackShelf({ d, it }) {
  const { w, h, detail, fill, posts, ln } = d;
  const n = Math.max(2, Math.min(6, Math.round(w / 500)));
  const seg = w / n;
  const shelves = it?.tierCount || it?.params?.tiers || Math.max(2, Math.round(h / 150));
  const L = [fill(0, 0, w, h, 3 * d.sw, 0.05), ...posts()];
  for (let i = 1; i < n; i++) L.push(ln(i * seg, h * 0.08, i * seg, h * 0.92, 0.55, 0.7));
  for (let j = 1; j < shelves; j++) L.push(ln(w * 0.06, (h * j) / shelves, w * 0.94, (h * j) / shelves, detail ? 0.4 : 0.3, 0.55));
  return <g pointerEvents="none">{L}</g>;
}

function TableBase({ d, trays = false, zones = false, belt = false }) {
  const { w, h, rect, legs4, ln, detail } = d;
  const tx = w * 0.06;
  const ty = h * 0.12;
  const tw = w * 0.88;
  const th = h * 0.76;
  const L = [rect(tx, ty, tw, th, 4 * d.sw, 0.55, 0), ...legs4(tx, ty, tw, th)];
  if (trays && detail) {
    const n = Math.max(2, Math.round(tw / 200));
    for (let i = 0; i < n; i++) L.push(rect(tx + (i + 0.15) * (tw / n), ty + th * 0.15, tw / n * 0.7, th * 0.7, 2 * d.sw, 0.45, 0));
  }
  if (zones) {
    L.push(ln(tx + tw * 0.33, ty + th * 0.1, tx + tw * 0.33, ty + th * 0.9, 0.4, 0.6));
    L.push(ln(tx + tw * 0.66, ty + th * 0.1, tx + tw * 0.66, ty + th * 0.9, 0.4, 0.6));
  }
  if (belt) L.push(ln(tx + tw * 0.1, ty + th * 0.55, tx + tw * 0.9, ty + th * 0.55, 0.5, 0.7));
  return <g pointerEvents="none">{L}</g>;
}

function TankRect({ d }) {
  const { w, h, cx, cy, rect, cir, ln, fill, sw } = d;
  const pad = Math.min(w, h) * 0.03;
  const outerX = pad;
  const outerY = pad;
  const outerW = w - pad * 2;
  const outerH = h - pad * 2;
  const outerR = Math.min(outerW, outerH) * 0.085;
  const wall = Math.max(Math.min(outerW, outerH) * 0.042, sw * 2.2);
  const innerX = outerX + wall;
  const innerY = outerY + wall;
  const innerW = outerW - wall * 2;
  const innerH = outerH - wall * 2;
  const innerR = Math.max(outerR * 0.55, sw * 1.5);
  const lidR = Math.min(innerW, innerH) * 0.21;
  const innerLidR = lidR * 0.52;
  const ribX1 = cx - lidR * 1.38;
  const ribX2 = cx + lidR * 1.38;
  const slotLen = innerLidR * 0.88;
  const slotAng = Math.PI / 4;

  return (
    <g pointerEvents="none">
      {fill(outerX, outerY, outerW, outerH, outerR, 0.1)}
      {rect(outerX, outerY, outerW, outerH, outerR, 0.92)}
      {rect(innerX, innerY, innerW, innerH, innerR, 0.84)}
      {ln(innerX, cy, innerX + innerW, cy, 0.4, 0.74)}
      {ln(ribX1, innerY, ribX1, innerY + innerH, 0.4, 0.74)}
      {ln(ribX2, innerY, ribX2, innerY + innerH, 0.4, 0.74)}
      {cir(cx, cy, lidR, "none", 0.86)}
      {cir(cx, cy, innerLidR, "none", 0.74)}
      {ln(
        cx - slotLen * Math.cos(slotAng),
        cy + slotLen * Math.sin(slotAng),
        cx + slotLen * Math.cos(slotAng),
        cy - slotLen * Math.sin(slotAng),
        0.72,
        0.92,
      )}
    </g>
  );
}

function TankRound({ d, waste = false }) {
  const { w, h, cx, cy, r, cir, rect, ln, fill } = d;
  const outer = r * 0.82;
  const inner = r * 0.52;
  if (waste) {
    return (
      <g pointerEvents="none">
        {fill(cx - outer, cy - outer, outer * 2, outer * 2, outer, 0.05)}
        {cir(cx, cy, outer)}
        {cir(cx, cy, inner, "none", 0.35)}
        {rect(cx - outer * 0.55, cy - outer * 0.92, outer * 1.1, outer * 0.28, 2 * d.sw, 0.65, 0.04)}
        {ln(cx - inner * 0.85, cy - inner * 0.85, cx + inner * 0.85, cy + inner * 0.85, 0.32, 0.55)}
        {ln(cx - inner * 0.85, cy + inner * 0.85, cx + inner * 0.85, cy - inner * 0.85, 0.32, 0.55)}
      </g>
    );
  }
  return (
    <g pointerEvents="none">
      {fill(cx - outer, cy - outer, outer * 2, outer * 2, outer, 0.06)}
      {cir(cx, cy, outer)}
      {cir(cx, cy, inner, "none", 0.45)}
      {rect(cx - 5 * d.sw, h * 0.04, 10 * d.sw, 8 * d.sw, 2 * d.sw, 0.75)}
      {ln(w * 0.88, cy, w * 0.98, cy, 0.7, 0.85)}
      {cir(w * 0.98, cy, 3 * d.sw, "fill", 0.65)}
    </g>
  );
}

/** Насосная станция: рама, насос с решёткой, гидробак, трубы, опоры. */
function PumpStation({ d }) {
  const { w, h, rect, cir, ln, sw } = d;
  const frameX = w * 0.05;
  const frameY = h * 0.16;
  const frameW = w * 0.9;
  const frameH = h * 0.68;
  const frameR = Math.min(frameW, frameH) * 0.11;
  const footW = Math.max(frameW * 0.07, sw * 5);
  const footH = Math.max(h * 0.07, sw * 4);
  const footCenters = [frameX + frameW * 0.16, frameX + frameW * 0.84];

  const motorW = frameW * 0.36;
  const motorH = frameH * 0.74;
  const motorX = frameX + frameW * 0.07;
  const motorY = frameY + (frameH - motorH) / 2;
  const motorR = Math.min(motorW, motorH) * 0.14;

  const tankS = Math.min(frameH * 0.8, frameW * 0.3);
  const tankX = frameX + frameW * 0.61;
  const tankY = frameY + (frameH - tankS) / 2;

  const pipeY1 = frameY + frameH * 0.4;
  const pipeY2 = frameY + frameH * 0.6;
  const pipeX0 = frameX + frameW * 0.03;
  const pipeX1 = frameX + frameW * 0.97;

  return (
    <g pointerEvents="none">
      {footCenters.map((fx, i) => (
        <g key={`ft${i}`}>
          {rect(fx - footW / 2, frameY - footH * 0.95, footW, footH, sw * 0.8, 0.86)}
          {rect(fx - footW / 2, frameY + frameH - footH * 0.05, footW, footH, sw * 0.8, 0.86)}
        </g>
      ))}
      {rect(frameX, frameY, frameW, frameH, frameR, 0.92)}
      {ln(pipeX0, pipeY1, pipeX1, pipeY1, 0.46, 0.78)}
      {ln(pipeX0, pipeY2, pipeX1, pipeY2, 0.46, 0.78)}
      {rect(motorX, motorY, motorW, motorH, motorR, 0.84, 0.06)}
      {[0.24, 0.38, 0.52, 0.66].map((t) => (
        ln(motorX + motorW * 0.08, motorY + motorH * t, motorX + motorW * 0.5, motorY + motorH * t, 0.42, 0.72)
      ))}
      {cir(motorX + motorW * 0.74, motorY + motorH * 0.5, Math.min(motorW, motorH) * 0.13, "none", 0.78)}
      {rect(tankX, tankY, tankS, tankS, sw * 1.2, 0.84, 0.04)}
      {cir(tankX + tankS / 2, tankY + tankS / 2, tankS * 0.34, "none", 0.82)}
    </g>
  );
}

function OsmosisFilters({ d }) {
  const { w, h, cx, cy, detail, cir, rect, ln } = d;
  const jarR = Math.min(h * 0.32, w * 0.09);
  const jars = [0.15, 0.5, 0.85];
  return (
    <g pointerEvents="none">
      {rect(w * 0.08, cy - h * 0.18, w * 0.84, h * 0.36, 3 * d.sw, 0.55, 0.04)}
      {jars.map((t, i) => <g key={i}>{cir(w * t, cy, jarR)}{detail && cir(w * t, cy, jarR * 0.55, "none", 0.35)}</g>)}
      {ln(w * 0.08, cy, w * 0.92, cy, 0.45, 0.65)}
      {ln(w * 0.02, cy, w * 0.08, cy, 0.6, 0.8)}
      {ln(w * 0.92, cy, w * 0.98, cy, 0.6, 0.8)}
      {detail && jars.slice(0, 2).map((t, i) => ln(w * t + jarR, cy, w * jars[i + 1] - jarR, cy, 0.35, 0.5))}
    </g>
  );
}

function drainCross({ cx, cy, d, r = 4 }) {
  const { sw, ln, cir } = d;
  const rr = r * d.sw;
  return (
    <g>
      {cir(cx, cy, rr, "none", 0.72)}
      {ln(cx - rr * 1.35, cy, cx + rr * 1.35, cy, 0.68, 0.9)}
      {ln(cx, cy - rr * 1.35, cx, cy + rr * 1.35, 0.68, 0.9)}
    </g>
  );
}

function faucetMixer({ x, y, d, lever = 1 }) {
  const { w, sw, ln, cir } = d;
  const r = 3.8 * sw;
  const lx = x + lever * w * 0.055;
  const ly = y - d.h * 0.035;
  return (
    <g>
      {cir(x, y, r, "fill", 0.78)}
      {ln(x, y, lx, ly, 0.82, 0.95)}
      {cir(lx, ly, sw * 0.85, "fill", 0.65)}
    </g>
  );
}

/** Раковина сверху: рама у стены, чаша «pill», смеситель, слив-крест. */
function SinkSingle({ d }) {
  const { w, h, cx, rect, fill, ln } = d;
  const frameX = w * 0.03;
  const frameY = h * 0.02;
  const frameW = w * 0.94;
  const frameH = h * 0.9;
  const frameR = Math.min(frameW, frameH) * 0.07;
  const basinW = frameW * 0.78;
  const basinH = frameH * 0.58;
  const basinX = cx - basinW / 2;
  const basinY = h * 0.28;
  const basinR = Math.min(basinW, basinH) * 0.38;
  const basinCy = basinY + basinH * 0.52;

  return (
    <g pointerEvents="none">
      {fill(frameX, frameY, frameW, frameH, frameR, 0.14)}
      {rect(frameX, frameY, frameW, frameH, frameR, 0.88)}
      {fill(basinX, basinY, basinW, basinH, basinR, 0.1)}
      {rect(basinX, basinY, basinW, basinH, basinR, 0.78, 0.06)}
      {faucetMixer({ x: cx, y: h * 0.13, d, lever: 1 })}
      {drainCross({ cx, cy: basinCy, d })}
      {ln(frameX, frameY + frameH * 0.04, frameX + frameW, frameY + frameH * 0.04, 0.35, 0.55)}
    </g>
  );
}

function SinkDouble({ d }) {
  const { w, h, rect, fill } = d;
  const frameX = w * 0.03;
  const frameY = h * 0.02;
  const frameW = w * 0.94;
  const frameH = h * 0.9;
  const frameR = Math.min(frameW, frameH) * 0.06;
  const bowlW = frameW * 0.38;
  const bowlH = frameH * 0.58;
  const bowlY = h * 0.28;
  const bowlR = Math.min(bowlW, bowlH) * 0.36;
  const centers = [w * 0.28, w * 0.72];

  return (
    <g pointerEvents="none">
      {fill(frameX, frameY, frameW, frameH, frameR, 0.14)}
      {rect(frameX, frameY, frameW, frameH, frameR, 0.88)}
      {centers.map((bx, i) => {
        const bx0 = bx - bowlW / 2;
        const bcy = bowlY + bowlH * 0.52;
        return (
          <g key={i}>
            {fill(bx0, bowlY, bowlW, bowlH, bowlR, 0.1)}
            {rect(bx0, bowlY, bowlW, bowlH, bowlR, 0.78, 0.06)}
            {faucetMixer({ x: bx, y: h * 0.13, d, lever: i === 0 ? 1 : -1 })}
            {drainCross({ cx: bx, cy: bcy, d })}
          </g>
        );
      })}
    </g>
  );
}

function ToiletTop({ d, bidet = false }) {
  const { w, h, cx, rect, elli } = d;
  return (
    <g pointerEvents="none">
      {rect(w * 0.22, 0, w * 0.56, h * 0.28, 2 * d.sw, 0.65)}
      {elli(cx, h * 0.62, w * (bidet ? 0.26 : 0.3), h * 0.32)}
      {elli(cx, h * 0.62, w * 0.17, h * 0.19, 0.45)}
    </g>
  );
}

/** Душевой поддон: двойной борт, штриховка чаши, слив в углу. */
function ShowerPan({ d }) {
  const clipId = useId().replace(/:/g, "");
  const { w, h, rect, ln, cir, sw } = d;
  const pad = Math.min(w, h) * 0.04;
  const outerX = pad;
  const outerY = pad;
  const outerW = w - pad * 2;
  const outerH = h - pad * 2;
  const outerR = Math.min(outerW, outerH) * 0.09;
  const rim = Math.min(outerW, outerH) * 0.075;
  const innerX = outerX + rim;
  const innerY = outerY + rim;
  const innerW = outerW - rim * 2;
  const innerH = outerH - rim * 2;
  const innerR = Math.max(outerR * 0.65, sw * 2);
  const hatchStep = Math.max(Math.min(innerW, innerH) * 0.052, sw * 4.5);
  const drainX = innerX + innerW * 0.14;
  const drainY = innerY + innerH * 0.86;
  const drainR = Math.max(3.2 * sw, Math.min(innerW, innerH) * 0.032);

  const hatch = [];
  for (let t = -innerH; t <= innerW + innerH; t += hatchStep) {
    hatch.push(ln(innerX + t, innerY + innerH, innerX + t + innerH, innerY, 0.36, 0.72));
  }

  return (
    <g pointerEvents="none">
      <defs>
        <clipPath id={clipId}>
          <rect x={innerX} y={innerY} width={innerW} height={innerH} rx={innerR} />
        </clipPath>
      </defs>
      {rect(outerX, outerY, outerW, outerH, outerR, 0.92)}
      {rect(innerX, innerY, innerW, innerH, innerR, 0.84)}
      <g clipPath={`url(#${clipId})`}>{hatch}</g>
      {cir(drainX, drainY, drainR, "none", 0.88)}
    </g>
  );
}

function FridgeTop({ d }) {
  const { w, h, rect, ln, fill } = d;
  const x = w * 0.1;
  const y = h * 0.08;
  const fw = w * 0.8;
  const fh = h * 0.84;
  return (
    <g pointerEvents="none">
      {fill(x, y, fw, fh, 3 * d.sw, 0.05)}
      {rect(x, y, fw, fh, 3 * d.sw, 0.6)}
      {ln(x, y + fh * 0.35, x + fw, y + fh * 0.35, 0.5, 0.65)}
      {rect(x + fw * 0.82, y + fh * 0.12, fw * 0.08, fh * 0.18, 1 * d.sw, 0.7, 0.3)}
    </g>
  );
}

function FreezerTop({ d }) {
  const { w, h, rect, ln, fill } = d;
  const x = w * 0.08;
  const y = h * 0.15;
  const fw = w * 0.84;
  const fh = h * 0.7;
  return (
    <g pointerEvents="none">
      {fill(x, y, fw, fh, 3 * d.sw, 0.05)}
      {rect(x, y, fw, fh, 3 * d.sw, 0.6)}
      {rect(x + fw * 0.05, y - h * 0.08, fw * 0.9, h * 0.1, 2 * d.sw, 0.65, 0.04)}
      {ln(x + fw * 0.05, y - h * 0.08, x + fw * 0.05, y, 0.55, 0.7)}
      {ln(x + fw * 0.95, y - h * 0.08, x + fw * 0.95, y, 0.55, 0.7)}
      {rect(x + fw * 0.78, y - h * 0.06, fw * 0.12, h * 0.06, 1 * d.sw, 0.7, 0.25)}
    </g>
  );
}

function TrolleyPlant({ d }) {
  const { w, h, rect, cir, ln, legs4 } = d;
  const tx = w * 0.1;
  const ty = h * 0.14;
  const tw = w * 0.8;
  const th = h * 0.72;
  return (
    <g pointerEvents="none">
      {rect(tx, ty, tw, th, 3 * d.sw, 0.55)}
      {legs4(tx, ty, tw, th)}
      {[[tx + tw * 0.15, ty + th + 4 * d.sw], [tx + tw * 0.85, ty + th + 4 * d.sw]].map(([wx, wy], i) => cir(wx, wy, 4 * d.sw, "fill", 0.55))}
      {ln(tx + tw * 0.5, ty, tx + tw * 0.5, ty - h * 0.08, 0.65, 0.85)}
      {ln(tx + tw * 0.2, ty + th * 0.35, tx + tw * 0.8, ty + th * 0.35, 0.35, 0.55)}
      {ln(tx + tw * 0.2, ty + th * 0.65, tx + tw * 0.8, ty + th * 0.65, 0.35, 0.55)}
    </g>
  );
}

function ScalesFloor({ d }) {
  const { w, h, cx, cy, rect, cir } = d;
  return (
    <g pointerEvents="none">
      {rect(w * 0.12, h * 0.12, w * 0.76, h * 0.76, 3 * d.sw, 0.6)}
      {cir(cx, cy, Math.min(w, h) * 0.22)}
      {rect(cx - w * 0.14, h * 0.78, w * 0.28, h * 0.12, 2 * d.sw, 0.55, 0.04)}
    </g>
  );
}

function ScalesBench({ d }) {
  const { w, h, cx, cy, rect, cir } = d;
  return (
    <g pointerEvents="none">
      {rect(w * 0.15, h * 0.2, w * 0.7, h * 0.55, 3 * d.sw, 0.6)}
      {rect(w * 0.2, h * 0.72, w * 0.6, h * 0.18, 2 * d.sw, 0.55, 0.04)}
      {cir(cx, cy, Math.min(w, h) * 0.16, "none", 0.55)}
    </g>
  );
}

function AcIndoor({ d, it }) {
  const { w, h, cx, cy, color, sw, o, ln, rect } = d;
  const bodyX = w * 0.05;
  const bodyY = h * 0.04;
  const bodyW = w * 0.9;
  const bodyH = h * 0.92;
  const cornerR = Math.min(bodyW, bodyH) * 0.14;
  const mountLabel = acMountHeightPlanLabel(it?.mountHeightMm);

  const louverY = [0.68, 0.78, 0.88].map((t) => bodyY + bodyH * t);

  return (
    <g pointerEvents="none">
      {rect(bodyX, bodyY, bodyW, bodyH, cornerR, o, 0)}
      {louverY.map((ly, i) => (
        ln(bodyX + bodyW * 0.1, ly, bodyX + bodyW * 0.9, ly, 0.7, 0.95)
      ))}
      {mountLabel && (() => {
        const fs = Math.max(8 * d.sw, Math.min(bodyH * 0.28, 11 * d.sw));
        const padX = 5 * d.sw;
        const padY = 3 * d.sw;
        const boxW = mountLabel.length * fs * 0.58 + padX * 2;
        const boxH = fs + padY * 2;
        return (
          <g>
            <rect
              x={cx - boxW / 2}
              y={cy - boxH / 2}
              width={boxW}
              height={boxH}
              rx={3 * d.sw}
              fill="#fff"
              stroke={DG_THEME.labelBorder}
              strokeWidth={0.65 * d.sw}
            />
            <text
              x={cx}
              y={cy + fs * 0.35}
              fontSize={fs}
              textAnchor="middle"
              fill={color}
              fontWeight="600"
              style={{ fontFamily: "var(--mono)" }}
            >
              {mountLabel}
            </text>
          </g>
        );
      })()}
    </g>
  );
}

function AcOutdoor({ d }) {
  const { w, h, cx, cy, r, rect, cir, ln } = d;
  const fr = r * 0.5;
  return (
    <g pointerEvents="none">
      {rect(w * 0.06, h * 0.1, w * 0.88, h * 0.8, 3 * d.sw, 0.55)}
      {cir(cx, cy, fr)}
      {[0, 60, 120, 180, 240, 300].map((a) => {
        const rad = (a * Math.PI) / 180;
        return ln(cx, cy, cx + Math.cos(rad) * fr, cy + Math.sin(rad) * fr, 0.5, 0.65);
      })}
      {[[w * 0.2, h * 0.92], [w * 0.8, h * 0.92]].map(([fx, fy], i) => <rect key={i} x={fx - 4 * d.sw} y={fy} width={8 * d.sw} height={6 * d.sw} fill={d.color} fillOpacity={0.4} stroke={d.color} strokeWidth={d.sw * 0.7} />)}
    </g>
  );
}

function FanRound({ d }) {
  const { w, h, cx, color, sw, o, elli, rect } = d;
  const headY = h * 0.31;
  const rx = w * 0.36;
  const ry = h * 0.23;
  const hubW = w * 0.075;
  const hubH = h * 0.13;
  const bodyTop = headY + ry * 0.88;
  const bodyBot = h * 0.8;
  const bodyHalf = w * 0.21;
  const stemW = w * 0.085;
  const stemTop = bodyBot;
  const stemH = h * 0.11;

  const pathEl = (dStr, op = o, wgt = 1) => (
    <path
      d={dStr}
      fill="none"
      stroke={color}
      strokeWidth={sw * wgt}
      opacity={op}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );

  const bladeLoop = (rotDeg) => {
    const rad = (rotDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const p = (lx, ly) => {
      const dx = lx * rx;
      const dy = ly * ry;
      return [cx + dx * cos - dy * sin, headY + dx * sin + dy * cos];
    };
    const [x0, y0] = p(0, -0.42);
    const [x1, y1] = p(-0.42, -0.08);
    const [x2, y2] = p(-0.28, 0.38);
    const [x3, y3] = p(0.02, 0.18);
    const [x4, y4] = p(0.28, 0.38);
    const [x5, y5] = p(0.42, -0.08);
    return pathEl(
      `M ${x0} ${y0} C ${x1} ${y1}, ${x2} ${y2}, ${x3} ${y3} C ${x4} ${y4}, ${x5} ${y5}, ${x0} ${y0}`,
      o * 0.92,
      0.95,
    );
  };

  const bodyPath = pathEl(
    `M ${cx - bodyHalf * 0.52} ${bodyTop}`
    + ` L ${cx - bodyHalf} ${bodyBot}`
    + ` Q ${cx} ${bodyBot + h * 0.035} ${cx + bodyHalf} ${bodyBot}`
    + ` L ${cx + bodyHalf * 0.52} ${bodyTop}`,
    o,
    1,
  );

  return (
    <g pointerEvents="none">
      {bodyPath}
      {rect(cx - stemW / 2, stemTop, stemW, stemH, stemW * 0.15, o, 0)}
      {elli(cx, headY, rx, ry, o)}
      {bladeLoop(0)}
      {bladeLoop(120)}
      {bladeLoop(-120)}
      {rect(cx - hubW / 2, headY - hubH * 0.62, hubW, hubH, hubW * 0.45, o, 0)}
    </g>
  );
}

function VentUnit({ d }) {
  const { w, h, cx, cy, r, rect, cir, ln, flowArrow } = d;
  const fr = r * 0.38;
  return (
    <g pointerEvents="none">
      {rect(w * 0.08, h * 0.1, w * 0.84, h * 0.8, 3 * d.sw, 0.55)}
      {cir(cx, cy, fr)}
      {[0, 90, 180, 270].map((a) => {
        const rad = (a * Math.PI) / 180;
        return ln(cx, cy, cx + Math.cos(rad) * fr, cy + Math.sin(rad) * fr, 0.5, 0.6);
      })}
      {flowArrow(w * 0.02, cy, w * 0.3, cy, 0.45)}
      {flowArrow(w * 0.7, cy, w * 0.98, cy, 0.45)}
    </g>
  );
}

function Dezmat({ d }) {
  const { w, h, rect, ln } = d;
  const L = [rect(w * 0.05, h * 0.05, w * 0.9, h * 0.9, 3 * d.sw, 0.5, 0.06)];
  const step = 8 * d.sw;
  for (let i = -Math.ceil(h / step); i < Math.ceil(w / step) + Math.ceil(h / step); i++) {
    const x1 = i * step;
    L.push(ln(x1, 0, x1 + h, h, 0.3, 0.45));
  }
  return <g pointerEvents="none">{L}</g>;
}

function BinTrash({ d }) {
  const { w, h, cx, cy, r, cir, rect } = d;
  const outer = r * 0.7;
  return (
    <g pointerEvents="none">
      {cir(cx, cy, outer)}
      {cir(cx, cy, outer * 0.62, "none", 0.4)}
      {rect(cx - outer * 0.55, cy - outer * 0.85, outer * 1.1, outer * 0.35, 2 * d.sw, 0.6, 0.05)}
    </g>
  );
}

function BenchTop({ d }) {
  const { w, h, rect, ln, legs4 } = d;
  const tx = w * 0.04;
  const ty = h * 0.22;
  const tw = w * 0.92;
  const th = h * 0.56;
  const L = [rect(tx, ty, tw, th, 3 * d.sw, 0.55), ...legs4(tx, ty, tw, th)];
  [0.33, 0.66].forEach((t) => L.push(ln(tx + tw * t, ty + th * 0.15, tx + tw * t, ty + th * 0.85, 0.35, 0.55)));
  return <g pointerEvents="none">{L}</g>;
}

function WardrobeTop({ d }) {
  const { w, h, cx, cy, ln, cir } = d;
  const L = [ln(w * 0.33, h * 0.08, w * 0.33, h * 0.92, 0.5), ln(w * 0.66, h * 0.08, w * 0.66, h * 0.92, 0.5)];
  [0.25, 0.5, 0.75].forEach((t) => L.push(cir(w * t, cy, 2.5 * d.sw, "fill", 0.6)));
  return <g pointerEvents="none">{L}</g>;
}

function PersonTop({ d }) {
  const { cx, cy, r, cir, ln } = d;
  return (
    <g pointerEvents="none">
      {cir(cx, cy, r * 0.42)}
      {cir(cx, cy - r * 0.18, r * 0.18, "fill", 0.55)}
      <polygon points={`${cx},${cy - r * 0.55} ${cx - r * 0.12},${cy - r * 0.38} ${cx + r * 0.12},${cy - r * 0.38}`} fill={d.color} opacity={0.6} />
    </g>
  );
}

function OpeningPalette({ d, glass, dash, arch, vents, serve }) {
  const { w, cy, rect, sw, color, ln } = d;
  const dashAttr = dash ? { strokeDasharray: `${4 * sw} ${2.5 * sw}` } : {};
  if (arch) {
    return (
      <g pointerEvents="none">
        <path d={`M ${w * 0.08} ${cy} Q ${w / 2} ${cy - w * 0.28} ${w * 0.92} ${cy}`} fill="none" stroke={color} strokeWidth={sw * 1.1} />
        {ln(w * 0.08, cy, w * 0.92, cy, 0.7, 1.1)}
      </g>
    );
  }
  return (
    <g pointerEvents="none">
      <line x1={w * 0.06} y1={cy} x2={w * 0.94} y2={cy} stroke={color} strokeWidth={sw * 1.4} opacity={0.85} {...dashAttr} />
      {glass && rect(w * 0.14, cy - w * 0.1, w * 0.72, w * 0.2, 2 * sw, 0.55, 0.12)}
      {vents && [0.3, 0.5, 0.7].map((t, i) => <g key={i}>{ln(w * t, cy - 5 * sw, w * t, cy + 5 * sw, 0.6)}</g>)}
      {serve && rect(w * 0.35, cy - w * 0.14, w * 0.3, w * 0.28, 2 * sw, 0.65, 0.08)}
    </g>
  );
}

const ICON_RENDERERS = {
  rack_nft: (d, it) => <RackNft d={d} it={it} />,
  rack: (d, it) => <RackNft d={d} it={it} />,
  rack_flood: (d, it) => <RackFlood d={d} it={it} />,
  rack_seedling: (d, it) => <RackSeedling d={d} it={it} />,
  rack_strawberry: (d, it) => <RackStrawberry d={d} it={it} />,
  rack_shelf: (d, it) => <RackShelf d={d} it={it} />,
  rack_aero: (d, it) => <RackAero d={d} it={it} />,

  table_sowing: (d) => <TableBase d={d} trays />,
  table_receiving: (d) => <TableBase d={d} belt />,
  table_packaging: (d) => <TableBase d={d} zones />,
  table: (d) => <TableBase d={d} />,

  tank_rect: (d) => <TankRect d={d} />,
  tank_round: (d) => <TankRound d={d} />,
  tank: (d, it) => (it?.icon === "tank_round" ? <TankRound d={d} /> : <TankRect d={d} />),
  tank_waste: (d) => <TankRound d={d} waste />,

  pump_inline: (d) => <PumpStation d={d} />,
  pump_station: (d) => <PumpStation d={d} />,
  pump: (d) => <PumpStation d={d} />,

  osmosis_filters: (d) => <OsmosisFilters d={d} />,
  osmosis: (d) => <OsmosisFilters d={d} />,

  sink_single: (d) => <SinkSingle d={d} />,
  sink: (d) => <SinkSingle d={d} />,
  sink_double: (d) => <SinkDouble d={d} />,
  sink2: (d) => <SinkDouble d={d} />,

  bidet: (d) => <ToiletTop d={d} bidet />,

  trolley_plant: (d) => <TrolleyPlant d={d} />,
  trolley: (d) => <TrolleyPlant d={d} />,

  scales_floor: (d) => <ScalesFloor d={d} />,
  scales_bench: (d) => <ScalesBench d={d} />,
  scales: (d) => <ScalesFloor d={d} />,

  ac_indoor: (d, it) => <AcIndoor d={d} it={it} />,
  ac: (d, it) => <AcIndoor d={d} it={it} />,

  fan_round: (d) => <FanRound d={d} />,
  fan: (d) => <FanRound d={d} />,

  vent_duct: (d) => <VentUnit d={d} />,

  bin_trash: (d) => <BinTrash d={d} />,
  bin: (d) => <BinTrash d={d} />,

  window: (d) => <OpeningPalette d={d} glass />,
  opening: (d) => <OpeningPalette d={d} dash />,
  opening_vent: (d) => <OpeningPalette d={d} dash vents />,
  opening_tech: (d) => <OpeningPalette d={d} glass />,
  opening_serve: (d) => <OpeningPalette d={d} glass serve />,
  opening_arch: (d) => <OpeningPalette d={d} arch />,
};

export function ObjectIcon({ it, k, stroke, fillOpacity, icon: iconOverride }) {
  const drawIt = stroke ? { ...it, color: stroke } : it;
  const d = useDraw(drawIt, k, { stroke, fillOpacity });
  const { w, h, rect, ln, cir, cx, cy, r, detail } = d;
  const iconKey = iconOverride || it.icon || (isRackKind(it.kind) ? rackIconForType(it.rackType) : null);

  const render = iconKey ? ICON_RENDERERS[iconKey] : null;
  if (render) {
    const body = render(d, it);
    if (isRackKind(it.kind)) {
      return (
        <g pointerEvents="none">
          {body}
          <rect
            x={0}
            y={0}
            width={w}
            height={h}
            rx={Math.max(2 * k, 2)}
            fill="none"
            stroke={stroke || it.color || "#1a332c"}
            strokeWidth={Math.max(d.sw * 2.4, 2.2 * k)}
            opacity={1}
          />
        </g>
      );
    }
    return body;
  }

  switch (iconKey || it.icon) {
    case "chair":
      return <g pointerEvents="none">{rect(w * 0.15, h * 0.15, w * 0.7, h * 0.7, 4 * d.sw, 0.55)}{ln(w * 0.15, h * 0.15, w * 0.85, h * 0.15, 0.55)}</g>;
    case "bench":
      return <BenchTop d={d} />;
    case "wardrobe":
      return <WardrobeTop d={d} />;
    case "hanger":
      return <g pointerEvents="none">{ln(w * 0.08, cy, w * 0.92, cy, 0.65)}{[0.2, 0.4, 0.6, 0.8].map((t, i) => <g key={i}>{ln(w * t, cy, w * t, cy + 8 * d.sw, 0.55)}{cir(w * t, cy + 10 * d.sw, 3 * d.sw)}</g>)}</g>;
    case "notebook":
      return <g pointerEvents="none">{rect(w * 0.1, h * 0.1, w * 0.8, h * 0.55, 2 * d.sw, 0.55)}{rect(w * 0.08, h * 0.62, w * 0.84, h * 0.3, 2 * d.sw, 0.5)}</g>;
    case "fridge":
      return <FridgeTop d={d} />;
    case "freezer":
      return <FreezerTop d={d} />;
    case "ladder": {
      const n = 4;
      const L = [];
      for (let i = 1; i <= n; i++) L.push(ln(w * 0.2, (h * i) / (n + 1), w * 0.8, (h * i) / (n + 1), 0.55));
      L.push(ln(w * 0.2, 0, w * 0.2, h, 0.45));
      L.push(ln(w * 0.8, 0, w * 0.8, h, 0.45));
      return <g pointerEvents="none">{L}</g>;
    }
    case "dezmat":
      return <Dezmat d={d} />;
    case "recirc":
      return <g pointerEvents="none">{rect(w * 0.15, h * 0.1, w * 0.7, h * 0.8, 4 * d.sw, 0.55)}{[0.3, 0.5, 0.7].map((t, i) => ln(w * 0.22, h * t, w * 0.78, h * t, 0.45, 0.6))}{cir(cx, cy, r * 0.25, "none", 0.5)}</g>;
    case "dispenser":
      return <g pointerEvents="none">{rect(w * 0.12, h * 0.08, w * 0.76, h * 0.72, 3 * d.sw, 0.6)}{rect(cx - 4 * d.sw, h * 0.72, 8 * d.sw, h * 0.18, 1.5 * d.sw, 0.65, 0.2)}{cir(cx, h * 0.88, 2.5 * d.sw, "fill", 0.55)}</g>;
    case "toilet":
      return <ToiletTop d={d} />;
    case "shower":
      return <ShowerPan d={d} />;
    case "showerhead":
      return <g pointerEvents="none">{cir(cx, cy, r * 0.45)}{detail && [0.25, 0.5, 0.75].map((t, i) => cir(w * t, cy + r * 0.15, 1.5 * d.sw, "fill", 0.4))}</g>;
    case "trap":
      return <g pointerEvents="none">{rect(w * 0.18, h * 0.18, w * 0.64, h * 0.64, 2 * d.sw, 0.6)}{ln(w * 0.18, cy, w * 0.82, cy, 0.45, 0.65)}{ln(cx, h * 0.18, cx, h * 0.82, 0.45, 0.65)}</g>;
    case "mirror":
      return <g pointerEvents="none">{rect(0, h * 0.2, w, h * 0.6, 2 * d.sw, 0.55, 0.04)}</g>;
    case "panel":
      return <g pointerEvents="none">{rect(w * 0.04, h * 0.1, w * 0.92, h * 0.8, 2 * d.sw, 0.55)}{ln(w * 0.38, h * 0.22, w * 0.52, cy, 0.55)}{ln(w * 0.52, cy, w * 0.42, cy, 0.55)}{ln(w * 0.42, cy, w * 0.58, h * 0.78, 0.55)}</g>;
    case "socket":
      return <g pointerEvents="none">{rect(w * 0.08, h * 0.12, w * 0.84, h * 0.76, 2 * d.sw, 0.55)}{cir(cx - w * 0.12, cy, 2 * d.sw, "fill", 0.6)}{cir(cx + w * 0.12, cy, 2 * d.sw, "fill", 0.6)}</g>;
    case "vent":
      return <VentUnit d={d} />;
    case "ac_out":
      return <AcOutdoor d={d} />;
    case "person":
      return <PersonTop d={d} />;
    case "light": {
      const L = [rect(w * 0.06, h * 0.18, w * 0.88, h * 0.64, 2 * d.sw, 0.5)];
      for (let i = 1; i <= 3; i++) L.push(ln(w * 0.12, (h * i) / 4, w * 0.88, (h * i) / 4, 0.45, 0.65));
      return <g pointerEvents="none">{L}</g>;
    }
    default:
      return (
        <g pointerEvents="none">
          {rect(w * 0.1, h * 0.1, w * 0.8, h * 0.8, 3 * d.sw, 0.55, d.baseFill)}
          {detail && ln(cx, h * 0.22, cx, h * 0.78, 0.4, 0.55)}
        </g>
      );
  }
}

// Окно / проём в стене (вид сверху, локальные координаты 0..w, центр по y=0)
export function OpeningIcon({ w, k, style = {}, shape = "rect", thk, triple = false }) {
  const sw = 1.2 * k;
  const c = style.color || "#5b7c9d";
  const isArch = shape === "arch" || style.arch;
  if (isArch) {
    const h = w * 0.28;
    return (
      <g pointerEvents="none">
        <path d={`M 0 0 Q ${w / 2} ${-h} ${w} 0`} fill="none" stroke={c} strokeWidth={sw} />
      </g>
    );
  }
  if (triple) {
    const half = Math.max((thk || w * 0.14) / 2, 18 * k);
    return (
      <g pointerEvents="none">
        <line x1={0} y1={-half} x2={w} y2={-half} stroke={c} strokeWidth={sw} opacity={0.85} />
        <line x1={0} y1={0} x2={w} y2={0} stroke={style.accent || c} strokeWidth={sw * 0.75} opacity={0.65} />
        <line x1={0} y1={half} x2={w} y2={half} stroke={c} strokeWidth={sw} opacity={0.85} />
      </g>
    );
  }
  return (
    <g pointerEvents="none">
      <line x1={0} y1={0} x2={w} y2={0} stroke={c} strokeWidth={sw * 0.6} opacity={0.45} />
    </g>
  );
}

// Дверь со створкой и дугой открывания (рисуется в проёме шириной w, толщина стены = h)
export function DoorIcon({ it, k, swing, pivot, slide, accent, showArc = true }) {
  const { w, color } = it;
  const leaf = color || DG_THEME.wall;
  const arc = DG_THEME.doorArc;
  const sw = 1.4 * k;
  if (slide) {
    return (
      <g pointerEvents="none">
        <line x1={0} y1={0} x2={w} y2={0} stroke={leaf} strokeWidth={sw} />
        <line x1={w * 0.15} y1={-w * 0.12} x2={w * 0.85} y2={-w * 0.12} stroke={accent || leaf} strokeWidth={sw * 0.8} strokeDasharray={`${6 * k} ${4 * k}`} />
        <polygon points={`${w * 0.7},${-w * 0.06} ${w * 0.85},0 ${w * 0.7},${w * 0.06}`} fill={accent || leaf} />
      </g>
    );
  }
  if (swing) {
    const hw = w / 2;
    return (
      <g pointerEvents="none">
        <line x1={0} y1={0} x2={0} y2={-hw} stroke={leaf} strokeWidth={sw} />
        <line x1={hw} y1={0} x2={hw} y2={-hw} stroke={leaf} strokeWidth={sw} />
        {showArc && (
          <>
            <path d={`M 0 ${-hw} A ${hw} ${hw} 0 0 1 ${hw} 0`} fill="none" stroke={arc} strokeWidth={sw * 0.75} strokeDasharray={`${4 * k} ${3 * k}`} />
            <path d={`M ${hw} ${-hw} A ${hw} ${hw} 0 0 0 ${hw} 0`} fill="none" stroke={arc} strokeWidth={sw * 0.75} strokeDasharray={`${4 * k} ${3 * k}`} />
          </>
        )}
        <line x1={0} y1={0} x2={hw} y2={0} stroke={accent || leaf} strokeWidth={sw * 0.9} />
      </g>
    );
  }
  if (pivot) {
    return (
      <g pointerEvents="none">
        <line x1={w / 2} y1={0} x2={w / 2} y2={-w * 0.45} stroke={leaf} strokeWidth={sw} />
        {showArc && (
          <>
            <path d={`M 0 0 A ${w / 2} ${w / 2} 0 0 1 ${w} 0`} fill="none" stroke={arc} strokeWidth={sw * 0.7} strokeDasharray={`${4 * k} ${3 * k}`} />
            <path d={`M 0 0 A ${w / 2} ${w / 2} 0 0 0 ${w} 0`} fill="none" stroke={arc} strokeWidth={sw * 0.7} strokeDasharray={`${4 * k} ${3 * k}`} />
          </>
        )}
        <line x1={0} y1={0} x2={w} y2={0} stroke={accent || leaf} strokeWidth={sw * 0.85} />
      </g>
    );
  }
  return (
    <g pointerEvents="none">
      <line x1={0} y1={0} x2={0} y2={-w} stroke={leaf} strokeWidth={sw} />
      {showArc && (
        <path d={`M 0 ${-w} A ${w} ${w} 0 0 1 ${w} 0`} fill="none" stroke={arc} strokeWidth={sw * 0.75} strokeDasharray={`${4 * k} ${3 * k}`} />
      )}
      <line x1={w} y1={0} x2={0} y2={0} stroke={accent || leaf} strokeWidth={sw * 0.9} />
    </g>
  );
}
