import { LINE_STYLE } from "./catalog.js";
import { pointInZone } from "./wallGeometry.js";
import { portPosition, defaultPortsForKind } from "./objectProperties.js";

export const STROKE_STYLES = {
  solid: { label: "Сплошная", dash: null },
  dashed: { label: "Пунктир", dash: [8, 5] },
  dashdot: { label: "Штрих-пунктир", dash: [10, 4, 2, 4] },
  double: { label: "Двойная", dash: null, double: true },
  duct: { label: "Воздуховод", dash: null, wMul: 1.75 },
};

export const ROUTING_HEIGHTS = [
  { id: "floor", label: "По полу" },
  { id: "wall", label: "По стене" },
  { id: "ceiling", label: "Под потолком" },
  { id: "rack", label: "На стеллаже" },
  { id: "tray", label: "В лотке / коробе" },
];

export const LINE_TRAFFIC_TYPES = [
  { id: "", label: "— не указано —" },
  { id: "staff", label: "Движение персонала" },
  { id: "raw", label: "Сырьё" },
  { id: "product", label: "Готовая продукция" },
  { id: "waste", label: "Отходы" },
];

const ATTACH_DIST_MM = 220;
const ARROW_SPACING_MM = 900;

export function defaultLineFields(layer) {
  const base = LINE_STYLE[layer] || LINE_STYLE.irrigation;
  return {
    strokeStyle: base?.dash ? "dashed" : "solid",
    reservePct: layer === "power" || layer === "light" ? 15 : 10,
    routingHeight: layer === "vent" ? "ceiling" : layer === "light" ? "ceiling" : "floor",
    showArrows: base?.arrow !== false,
    arrowReverse: false,
    orthoRoute: true,
    traffic: layer === "staff" ? "staff" : "",
    fromItemId: null,
    toItemId: null,
    locked: false,
  };
}

export function resolveLineVisual(line) {
  const base = LINE_STYLE[line.layer] || LINE_STYLE.irrigation;
  const styleKey = line.strokeStyle || (base.dash ? "dashed" : "solid");
  const ss = STROKE_STYLES[styleKey] || STROKE_STYLES.solid;
  const traffic = LINE_TRAFFIC_TYPES.find((t) => t.id === line.traffic);
  let color = line.color || base.color;
  if (line.traffic === "raw") color = line.color || "#7a5c3e";
  if (line.traffic === "product") color = line.color || "#116355";
  if (line.traffic === "waste") color = line.color || "#a5371f";
  return {
    color,
    w: (line.strokeW || base.w) * (ss.wMul || 1),
    dash: ss.dash,
    double: !!ss.double,
    arrow: line.showArrows !== undefined ? line.showArrows : base.arrow !== false,
    label: traffic?.id ? traffic.label : base.label,
  };
}

export function linePlanLengthMm(pts = []) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return len;
}

export function lineTotalLengthMm(line) {
  const len = linePlanLengthMm(line.pts);
  const pct = line.reservePct ?? 10;
  return len * (1 + Math.max(0, pct) / 100);
}

function itemAttachPoints(it) {
  const cx = it.x + it.w / 2;
  const cy = it.y + it.h / 2;
  const pts = [
    { x: cx, y: cy, itemId: it.id },
    { x: it.x, y: cy, itemId: it.id },
    { x: it.x + it.w, y: cy, itemId: it.id },
    { x: cx, y: it.y, itemId: it.id },
    { x: cx, y: it.y + it.h, itemId: it.id },
  ];
  const ports = it.ports?.length ? it.ports : defaultPortsForKind(it.kind);
  ports.forEach((port, portIndex) => {
    const p = portPosition(it, port);
    pts.push({
      x: p.x,
      y: p.y,
      itemId: it.id,
      portIndex,
      portType: port.type,
      label: port.type,
    });
  });
  return pts;
}

export function nearestItemAttach(pt, items, maxDist = ATTACH_DIST_MM) {
  let best = null;
  let bestD = maxDist;
  (items || []).forEach((it) => {
    itemAttachPoints(it).forEach((c) => {
      const d = Math.hypot(c.x - pt.x, c.y - pt.y);
      if (d < bestD) {
        bestD = d;
        best = {
          pt: { x: c.x, y: c.y },
          itemId: c.itemId,
          label: c.label || it.label,
          portIndex: c.portIndex,
          portType: c.portType,
        };
      }
    });
  });
  return best;
}

export function snapLinePoint(pt, items, snapOn = true) {
  if (!snapOn) return { x: Math.round(pt.x), y: Math.round(pt.y) };
  const attach = nearestItemAttach(pt, items);
  if (attach) {
    return {
      ...attach.pt,
      itemId: attach.itemId,
      portIndex: attach.portIndex,
      portType: attach.portType,
    };
  }
  return { x: Math.round(pt.x), y: Math.round(pt.y) };
}

export function attachLineEndpoints(line, items) {
  const pts = line.pts?.map((p) => ({ ...p })) || [];
  if (pts.length < 2) return line;
  const start = nearestItemAttach(pts[0], items);
  const end = nearestItemAttach(pts[pts.length - 1], items);
  if (start) pts[0] = { ...start.pt };
  if (end) pts[pts.length - 1] = { ...end.pt };
  return {
    ...line,
    pts,
    fromItemId: start?.itemId || null,
    toItemId: end?.itemId || null,
    fromPortIndex: start?.portIndex ?? null,
    toPortIndex: end?.portIndex ?? null,
  };
}

export function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (!len2) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function hitTestLine(mm, line, threshold = 120) {
  const pts = line.pts || [];
  for (let i = 1; i < pts.length; i++) {
    if (distToSegment(mm, pts[i - 1], pts[i]) <= threshold) return true;
  }
  return false;
}

function segCrossesInterior(a, b, c, d) {
  const den = (d.y - c.y) * (b.x - a.x) - (d.x - c.x) * (b.y - a.y);
  if (Math.abs(den) < 1e-6) return false;
  const ua = ((d.x - c.x) * (a.y - c.y) - (d.y - c.y) * (a.x - c.x)) / den;
  const ub = ((b.x - a.x) * (a.y - c.y) - (b.y - a.y) * (a.x - c.x)) / den;
  return ua > 0.03 && ua < 0.97 && ub > 0.03 && ub < 0.97;
}

export function lineCrossesWalls(line, walls = []) {
  const pts = line.pts || [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    for (const w of walls) {
      if (!w.pts || w.pts.length < 2) continue;
      for (let j = 1; j < w.pts.length; j++) {
        if (segCrossesInterior(a, b, w.pts[j - 1], w.pts[j])) return true;
      }
    }
  }
  return false;
}

export function drainLineInCleanZone(line, zones = []) {
  if (line.layer !== "drain" && migrateDrainTraffic(line)) return false;
  const pts = line.pts || [];
  const clean = zones.filter((z) => z.flow === "clean" || z.flow === "sterile");
  if (!clean.length) return false;
  for (let i = 1; i < pts.length; i++) {
    const mid = { x: (pts[i - 1].x + pts[i].x) / 2, y: (pts[i - 1].y + pts[i].y) / 2 };
    if (clean.some((z) => pointInZone(mid, z))) return true;
  }
  return false;
}

function migrateDrainTraffic(line) {
  return line.layer === "staff" && line.traffic === "waste";
}

export function endpointFloating(pt, items, attachedId) {
  if (attachedId) return false;
  return !nearestItemAttach(pt, items, ATTACH_DIST_MM);
}

export function insertPointOnLine(line, mm) {
  const pts = line.pts || [];
  if (pts.length < 2) return line;
  let bestI = 1;
  let bestD = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const d = distToSegment(mm, pts[i - 1], pts[i]);
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  const next = [...pts];
  next.splice(bestI, 0, { x: Math.round(mm.x), y: Math.round(mm.y) });
  return { ...line, pts: next };
}

export function removeLineNode(line, idx) {
  if (!line.pts || line.pts.length <= 2 || idx <= 0 || idx >= line.pts.length - 1) return line;
  return { ...line, pts: line.pts.filter((_, i) => i !== idx) };
}

export function reverseLine(line) {
  return { ...line, pts: [...(line.pts || [])].reverse(), arrowReverse: !line.arrowReverse };
}

/** Точки для стрелок вдоль трассы. */
export function arrowPointsAlongLine(pts, spacing = ARROW_SPACING_MM, reverse = false) {
  if (!pts || pts.length < 2) return [];
  const segs = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    segs.push({ a: pts[i - 1], b: pts[i], len, start: total });
    total += len;
  }
  if (total < spacing * 0.5) {
    const a = pts[pts.length - 2];
    const b = pts[pts.length - 1];
    return reverse ? [{ a: b, b: a }] : [{ a, b }];
  }
  const out = [];
  for (let d = spacing; d < total; d += spacing) {
    for (const s of segs) {
      if (d > s.start + s.len) continue;
      const t = (d - s.start) / s.len;
      const px = s.a.x + (s.b.x - s.a.x) * t;
      const py = s.a.y + (s.b.y - s.a.y) * t;
      const look = reverse ? { x: s.a.x - s.b.x, y: s.a.y - s.b.y } : { x: s.b.x - s.a.x, y: s.b.y - s.a.y };
      out.push({ x: px, y: py, ang: Math.atan2(look.y, look.x) });
      break;
    }
  }
  const last = pts[pts.length - 2];
  const end = pts[pts.length - 1];
  out.push({
    x: end.x,
    y: end.y,
    ang: Math.atan2((reverse ? last.y - end.y : end.y - last.y), (reverse ? last.x - end.x : end.x - last.x)),
  });
  return out;
}

export function collectLineWarnings(plan) {
  const warnings = [];
  const items = plan.items || [];
  const walls = plan.walls || [];
  const zones = plan.zones || [];

  (plan.lines || []).forEach((line) => {
    const vis = resolveLineVisual(line);
    const label = vis.label || "Трасса";
    const pts = line.pts || [];
    if (pts.length < 2) return;

    if (endpointFloating(pts[0], items, line.fromItemId)) {
      warnings.push({
        id: `line-start-${line.id}`,
        severity: "warning",
        objectIds: [line.id],
        text: `${label}: начало трассы не привязано к объекту`,
      });
    }
    if (endpointFloating(pts[pts.length - 1], items, line.toItemId)) {
      warnings.push({
        id: `line-end-${line.id}`,
        severity: "warning",
        objectIds: [line.id],
        text: `${label}: конец трассы висит в воздухе`,
      });
    }
    if (lineCrossesWalls(line, walls)) {
      warnings.push({
        id: `line-wall-${line.id}`,
        severity: "warning",
        objectIds: [line.id],
        text: `${label}: пересекает стену без проёма`,
      });
    }
    if (drainLineInCleanZone(line, zones)) {
      warnings.push({
        id: `line-clean-${line.id}`,
        severity: "warning",
        objectIds: [line.id],
        text: `${label}: дренаж/отходы проходят через чистую зону`,
      });
    }
  });
  return warnings;
}
