import { snap } from "./catalog.js";
import { nearestWallSegment } from "./wallGeometry.js";
import { defaultPortsForKind, portPosition } from "./objectProperties.js";

export const PIPE_SYSTEMS = [
  "irrigation",
  "drainage",
  "clean_water",
  "nutrient_a",
  "nutrient_b",
  "acid",
  "waste",
  "air",
];

export const PIPE_ROLES = [
  "supply",
  "return",
  "drain",
  "overflow",
  "bypass",
  "main",
  "branch",
];

const EPS = 1e-6;
const DEFAULT_PIPE_RESERVE_PCT = 10;
const PORT_SNAP_DIST_MM = 260;
const PIPE_END_SNAP_DIST_MM = 230;
const PIPE_INTERSECTION_SNAP_DIST_MM = 260;
const PIPE_NEAR_OBJECT_MM = 320;
const VALVE_ON_PIPE_TOLERANCE_MM = 100;

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function dist(a, b) {
  return Math.hypot((a?.x || 0) - (b?.x || 0), (a?.y || 0) - (b?.y || 0));
}

function pointProjectToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return { x: a.x, y: a.y, t: 0 };
  const t = clamp01(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2);
  return { x: a.x + dx * t, y: a.y + dy * t, t };
}

function pointDistToSegment(p, a, b) {
  const proj = pointProjectToSegment(p, a, b);
  return dist(p, proj);
}

function segmentIntersection(a, b, c, d) {
  const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(den) < EPS) return null;
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
  const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, t, u };
}

function lineTagFromRole(role) {
  if (role === "main") return "main";
  if (role === "overflow") return "emergency";
  if (role === "return") return "return";
  if (role === "branch") return "branch";
  return null;
}

function roleFromLineTag(tag, layer) {
  if (tag === "main") return "main";
  if (tag === "emergency") return "overflow";
  if (tag === "return") return "return";
  if (tag === "branch") return "branch";
  if (layer === "drain") return "drain";
  return "supply";
}

function systemFromLineTag(tag, layer) {
  if (layer === "drain") return "drainage";
  if (tag === "acid") return "acid";
  if (tag === "fert_a") return "nutrient_a";
  if (tag === "fert_b") return "nutrient_b";
  if (tag === "waste") return "waste";
  if (tag === "clean") return "clean_water";
  if (layer === "vent") return "air";
  return "irrigation";
}

function defaultDiameterMm(system, role, source = {}) {
  if (source.diameterMm != null) return Math.max(8, num(source.diameterMm, 32));
  if (system === "drainage" || role === "drain") {
    if (role === "main" || source.lineTag === "main") return 110;
    return 50;
  }
  if (system === "nutrient_a" || system === "nutrient_b" || system === "acid") return 20;
  if (system === "air") return 160;
  return 32;
}

function defaultMaterial(system, source = {}) {
  if (source.material) return String(source.material).toLowerCase();
  if (system === "drainage" || system === "waste") return "pvc";
  if (system === "air") return "galv";
  return "pp";
}

function defaultSlopePercent(system, diameterMm, source = {}) {
  if (source.slopePercent != null) return num(source.slopePercent, 0);
  if (system !== "drainage" && system !== "waste") return null;
  if (diameterMm >= 100) return 1.5;
  return 2;
}

function defaultVisibleOnSheets(system) {
  if (system === "drainage" || system === "waste") return ["drainage", "specification"];
  if (system === "air") return ["ventilation", "specification"];
  return ["irrigation", "water_treatment", "specification"];
}

function normalizePoint(p) {
  return { x: num(p?.x), y: num(p?.y) };
}

export function isPipeLine(line = {}) {
  return line.type === "pipe"
    || line.pipeSystem
    || line.pipeRole
    || line.layer === "irrigation"
    || line.layer === "drain";
}

export function normalizePipe(line = {}) {
  if (!line) return null;
  const points = (line.points || line.pts || []).map(normalizePoint);
  const pipeSystem = PIPE_SYSTEMS.includes(line.pipeSystem)
    ? line.pipeSystem
    : systemFromLineTag(line.lineTag, line.layer);
  const pipeRole = PIPE_ROLES.includes(line.pipeRole)
    ? line.pipeRole
    : roleFromLineTag(line.lineTag, line.layer);
  const diameterMm = defaultDiameterMm(pipeSystem, pipeRole, line);
  const material = defaultMaterial(pipeSystem, line);
  const explicitFlow = line.flowDirection === "reverse" || line.flowDirection === "forward"
    ? line.flowDirection
    : null;
  const flowDirection = line.arrowReverse != null
    ? (line.arrowReverse ? "reverse" : "forward")
    : (explicitFlow || "forward");
  const arrowReverse = flowDirection === "reverse";
  const slopePercent = defaultSlopePercent(pipeSystem, diameterMm, line);
  const connectedObjectIds = uniq([
    ...(line.connectedObjectIds || []),
    line.fromItemId,
    line.toItemId,
  ]);
  const visibleOnSheets = Array.isArray(line.visibleOnSheets) && line.visibleOnSheets.length
    ? line.visibleOnSheets
    : defaultVisibleOnSheets(pipeSystem);
  const reservePct = Math.max(0, num(line.reservePct, DEFAULT_PIPE_RESERVE_PCT));
  return {
    ...line,
    type: "pipe",
    layer: line.layer || (pipeSystem === "drainage" ? "drain" : "irrigation"),
    pipeSystem,
    pipeRole,
    diameterMm,
    material,
    points,
    pts: points,
    flowDirection,
    arrowReverse,
    slopePercent,
    connectedObjectIds,
    visibleOnSheets,
    label: line.label || "",
    locked: line.locked === true,
    notes: line.notes || "",
    reservePct,
    lineTag: line.lineTag || lineTagFromRole(pipeRole),
  };
}

export function calculatePipeLength(pipe = {}) {
  const p = normalizePipe(pipe);
  const pts = p?.points || [];
  let planMm = 0;
  for (let i = 1; i < pts.length; i++) {
    planMm += dist(pts[i], pts[i - 1]);
  }
  const planM = planMm / 1000;
  const withReserveM = planM * (1 + (p?.reservePct ?? DEFAULT_PIPE_RESERVE_PCT) / 100);
  const withReserveRoundedM = Math.ceil(withReserveM * 2) / 2;
  return { planMm, planM, withReserveM, withReserveRoundedM };
}

export function resolvePipeLabel(pipe = {}) {
  const p = normalizePipe(pipe);
  const mat = (p.material || "pp").toUpperCase();
  if (p.pipeSystem === "drainage" && p.diameterMm >= 100) return `Канализация ${Math.round(p.diameterMm)}`;
  if (p.pipeSystem === "drainage") return `Дренаж ${Math.round(p.diameterMm)}`;
  if (p.pipeRole === "supply") return `Подача ${Math.round(p.diameterMm)}`;
  if (p.pipeRole === "return") return `Обратка ${Math.round(p.diameterMm)}`;
  if (p.pipeSystem === "acid") return `Кислота ${Math.round(p.diameterMm)}`;
  return `${mat} ${Math.round(p.diameterMm)}`;
}

export function resolvePipeVisual(pipe = {}) {
  const p = normalizePipe(pipe);
  const label = resolvePipeLabel(p);
  if (p.pipeSystem === "drainage" || p.pipeSystem === "waste") {
    if (p.diameterMm >= 100) {
      return { color: "#5f503d", w: 6, dash: null, label };
    }
    if (p.pipeRole === "overflow") {
      return { color: "#7a5c3e", w: 4, dash: [9, 5], label };
    }
    return { color: "#7a5c3e", w: 4, dash: null, label };
  }
  if (p.pipeSystem === "acid") {
    return { color: "#8a4a3a", w: 2.5, dash: [10, 4, 2, 4], label };
  }
  if (p.pipeSystem === "nutrient_a") {
    return { color: "#2f6f8f", w: 2.2, dash: null, label: `A ${Math.round(p.diameterMm)}` };
  }
  if (p.pipeSystem === "nutrient_b") {
    return { color: "#4a7f6a", w: 2.2, dash: null, label: `B ${Math.round(p.diameterMm)}` };
  }
  if (p.pipeRole === "return") {
    return { color: "#2f6f8f", w: 3, dash: [8, 5], label };
  }
  return { color: "#116355", w: 3.5, dash: null, label };
}

export function longestPipeSegment(pipe = {}) {
  const p = normalizePipe(pipe);
  const pts = p.points || [];
  let best = null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = dist(a, b);
    if (!best || len > best.len) {
      best = {
        a,
        b,
        len,
        mx: (a.x + b.x) / 2,
        my: (a.y + b.y) / 2,
      };
    }
  }
  return best;
}

function resolveObjectPorts(item = {}) {
  const srcPorts = item.connectionPorts?.length
    ? item.connectionPorts
    : item.ports?.length
      ? item.ports
      : defaultPortsForKind(item.kind);
  return (srcPorts || []).map((port, idx) => {
    const abs = portPosition(item, port);
    return {
      id: port.id || `${item.id}-p${idx}`,
      name: port.name || port.type || `port_${idx + 1}`,
      type: port.type || "inlet",
      direction: port.direction || port.side || "right",
      diameterMm: num(port.diameterMm, 32),
      system: port.system || "irrigation",
      x: abs.x,
      y: abs.y,
      itemId: item.id,
    };
  });
}

function objectCanHavePipe(item = {}) {
  const kind = item.kind || item.subtype || "";
  const category = item.category || "";
  return [
    "tank", "tank_waste", "pump", "osmosis", "water_prep", "rack", "seed_rack", "water_valve",
  ].includes(kind)
    || ["tank", "pump", "filter", "dosing_unit", "rack", "valve"].includes(category);
}

function nearestObjectPort(pt, items = [], maxDist = PORT_SNAP_DIST_MM) {
  let best = null;
  let bestD = maxDist;
  (items || []).forEach((it) => {
    if (!objectCanHavePipe(it)) return;
    resolveObjectPorts(it).forEach((port) => {
      const d = dist(pt, port);
      if (d < bestD) {
        bestD = d;
        best = { ...port, d };
      }
    });
  });
  return best;
}

function nearestPipeEnd(pt, pipes = [], maxDist = PIPE_END_SNAP_DIST_MM) {
  let best = null;
  let bestD = maxDist;
  (pipes || []).forEach((raw) => {
    const pipe = normalizePipe(raw);
    const pts = pipe.points || [];
    if (pts.length < 2) return;
    [0, pts.length - 1].forEach((idx) => {
      const p = pts[idx];
      const d = dist(pt, p);
      if (d < bestD) {
        bestD = d;
        best = { x: p.x, y: p.y, d, pipeId: pipe.id, endpointIndex: idx };
      }
    });
  });
  return best;
}

function nearestPipeMidpoint(pt, pipes = [], maxDist = PIPE_END_SNAP_DIST_MM) {
  let best = null;
  let bestD = maxDist;
  (pipes || []).forEach((raw) => {
    const pipe = normalizePipe(raw);
    const pts = pipe.points || [];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const d = dist(pt, m);
      if (d < bestD) {
        bestD = d;
        best = { x: m.x, y: m.y, d, pipeId: pipe.id, segmentIndex: i - 1 };
      }
    }
  });
  return best;
}

function nearestPipeIntersection(pt, pipes = [], maxDist = PIPE_INTERSECTION_SNAP_DIST_MM) {
  let best = null;
  let bestD = maxDist;
  for (let i = 0; i < pipes.length; i++) {
    const pa = normalizePipe(pipes[i]);
    const aPts = pa.points || [];
    for (let j = i + 1; j < pipes.length; j++) {
      const pb = normalizePipe(pipes[j]);
      const bPts = pb.points || [];
      for (let ai = 1; ai < aPts.length; ai++) {
        for (let bi = 1; bi < bPts.length; bi++) {
          const cross = segmentIntersection(aPts[ai - 1], aPts[ai], bPts[bi - 1], bPts[bi]);
          if (!cross) continue;
          const d = dist(pt, cross);
          if (d < bestD) {
            bestD = d;
            best = { x: cross.x, y: cross.y, d, pipeA: pa.id, pipeB: pb.id };
          }
        }
      }
    }
  }
  return best;
}

export function snapPipeDraftPoint(pt, {
  items = [],
  pipes = [],
  walls = [],
  room = null,
  zoom = 0.1,
  snapOn = true,
  snapGrid = true,
  snapWalls = true,
  snapObjects = true,
  snapStep = 50,
} = {}) {
  if (!snapOn) return { x: Math.round(pt.x), y: Math.round(pt.y), snapped: false };
  const thresholdMul = 1 / Math.max(zoom, 0.06);
  const candidates = [];
  const push = (c, kind, priority, meta = {}) => {
    if (!c) return;
    candidates.push({
      x: c.x,
      y: c.y,
      d: num(c.d, dist(pt, c)),
      kind,
      priority,
      snapped: kind !== "grid",
      ...meta,
    });
  };

  if (snapObjects) {
    const port = nearestObjectPort(pt, items, PORT_SNAP_DIST_MM * thresholdMul);
    push(port, "port", 1, port ? {
      itemId: port.itemId,
      portId: port.id,
      portType: port.type,
      portSystem: port.system,
      portDiameterMm: port.diameterMm,
    } : {});
  }

  const end = nearestPipeEnd(pt, pipes, PIPE_END_SNAP_DIST_MM * thresholdMul);
  push(end, "pipe-end", 2, end ? { lineId: end.pipeId, lineNodeIdx: end.endpointIndex } : {});

  const mid = nearestPipeMidpoint(pt, pipes, PIPE_END_SNAP_DIST_MM * thresholdMul);
  push(mid, "pipe-mid", 2.4, mid ? { lineId: mid.pipeId, segmentIndex: mid.segmentIndex } : {});

  const cross = nearestPipeIntersection(pt, pipes, PIPE_INTERSECTION_SNAP_DIST_MM * thresholdMul);
  push(cross, "pipe-intersection", 3, cross ? { lineIdA: cross.pipeA, lineIdB: cross.pipeB } : {});

  if (snapWalls) {
    const seg = nearestWallSegment(pt, walls, room, PORT_SNAP_DIST_MM * thresholdMul);
    if (seg?.proj) {
      push({ ...seg.proj, d: dist(seg.proj, pt) }, "wall", 4);
    }
  }

  if (snapGrid) {
    push(
      { x: snap(pt.x, snapStep, true), y: snap(pt.y, snapStep, true), d: 0 },
      "grid",
      5,
    );
  }

  candidates.sort((a, b) => a.priority - b.priority || a.d - b.d);
  return candidates[0] || { x: pt.x, y: pt.y, snapped: false };
}

function endpointOnOtherPipe(endpoint, pipe, allPipes, tolerance = 80) {
  for (const raw of allPipes) {
    if (raw.id === pipe.id) continue;
    const p = normalizePipe(raw);
    const pts = p.points || [];
    for (let i = 1; i < pts.length; i++) {
      const d = pointDistToSegment(endpoint, pts[i - 1], pts[i]);
      if (d <= tolerance) return true;
    }
  }
  return false;
}

export function attachPipeConnections(pipe, items = [], pipes = [], threshold = PORT_SNAP_DIST_MM) {
  const p = normalizePipe(pipe);
  const pts = p.points || [];
  if (pts.length < 2) return p;
  const endpointIndexes = [0, pts.length - 1];
  const endpointLinks = [];
  endpointIndexes.forEach((idx) => {
    const endpoint = pts[idx];
    const port = nearestObjectPort(endpoint, items, threshold);
    if (port) {
      endpointLinks.push({
        endpointIndex: idx,
        itemId: port.itemId,
        portId: port.id,
        portType: port.type,
        system: port.system,
      });
    }
  });
  const connectedObjectIds = uniq([
    ...p.connectedObjectIds,
    ...endpointLinks.map((x) => x.itemId),
  ]);
  const first = endpointLinks.find((x) => x.endpointIndex === 0);
  const last = endpointLinks.find((x) => x.endpointIndex === pts.length - 1);
  return {
    ...p,
    endpointLinks,
    connectedObjectIds,
    fromItemId: first?.itemId || p.fromItemId || null,
    toItemId: last?.itemId || p.toItemId || null,
  };
}

export function syncObjectConnectionsFromPipes(items = [], pipes = []) {
  const generated = new Map();
  pipes.forEach((raw) => {
    const pipe = attachPipeConnections(raw, items, pipes);
    (pipe.endpointLinks || []).forEach((ln) => {
      if (!generated.has(ln.itemId)) generated.set(ln.itemId, []);
      generated.get(ln.itemId).push({
        type: "pipe",
        pipeId: pipe.id,
        system: pipe.pipeSystem,
        role: pipe.pipeRole,
        endpointIndex: ln.endpointIndex,
        portId: ln.portId,
        portType: ln.portType,
      });
    });
  });
  return items.map((it) => {
    const keep = (it.connections || []).filter((c) => c.type !== "pipe");
    const add = generated.get(it.id) || [];
    return { ...it, connections: [...keep, ...add] };
  });
}

export function syncPlanPipes(plan = {}) {
  const lines = (plan.lines || []).map((line) => (isPipeLine(line) ? normalizePipe(line) : line));
  const rawPipes = lines.filter(isPipeLine);
  const pipes = rawPipes.map((pipe) => attachPipeConnections(pipe, plan.items || [], rawPipes));
  const byId = new Map(pipes.map((p) => [p.id, p]));
  const nextLines = lines.map((line) => (byId.has(line.id) ? byId.get(line.id) : line));
  const nextItems = syncObjectConnectionsFromPipes(plan.items || [], pipes);
  return { ...plan, lines: nextLines, items: nextItems };
}

function endpointWarnings(pipe, allItems, allPipes) {
  const warnings = [];
  const pts = pipe.points || [];
  if (pts.length < 2) return warnings;
  const linksByIdx = new Map((pipe.endpointLinks || []).map((x) => [x.endpointIndex, x]));
  [0, pts.length - 1].forEach((idx) => {
    const endpoint = pts[idx];
    if (linksByIdx.has(idx)) return;
    if (endpointOnOtherPipe(endpoint, pipe, allPipes, 90)) return;
    warnings.push({
      id: `pipe-end-${pipe.id}-${idx}`,
      severity: "warning",
      objectIds: [pipe.id],
      text: "Конец трубы не подключен",
    });
    const nearPort = nearestObjectPort(endpoint, allItems, PIPE_NEAR_OBJECT_MM);
    if (nearPort) {
      warnings.push({
        id: `pipe-near-${pipe.id}-${idx}`,
        severity: "warning",
        objectIds: [pipe.id, nearPort.itemId],
        text: "Труба рядом с объектом, но не подключена",
      });
    }
  });
  return warnings;
}

function valveOnPipeWarnings(items, pipes) {
  const warnings = [];
  const valves = items.filter((it) => {
    const kind = it.kind || "";
    const category = it.category || "";
    const subtype = it.subtype || "";
    return category === "valve" || kind === "water_valve" || subtype.includes("valve");
  });
  valves.forEach((valve) => {
    const c = { x: valve.x + (valve.w || valve.widthMm || 0) / 2, y: valve.y + (valve.h || valve.depthMm || 0) / 2 };
    const onPipe = pipes.some((raw) => {
      const pipe = normalizePipe(raw);
      const pts = pipe.points || [];
      for (let i = 1; i < pts.length; i++) {
        if (pointDistToSegment(c, pts[i - 1], pts[i]) <= VALVE_ON_PIPE_TOLERANCE_MM) return true;
      }
      return false;
    });
    if (!onPipe) {
      warnings.push({
        id: `valve-not-on-pipe-${valve.id}`,
        severity: "warning",
        objectIds: [valve.id],
        text: "Клапан не установлен на трубу",
      });
    }
  });
  return warnings;
}

function drainageSlopeWarnings(pipe) {
  if (pipe.pipeSystem !== "drainage" && pipe.pipeSystem !== "waste") return [];
  const slope = num(pipe.slopePercent, NaN);
  if (!Number.isFinite(slope) || slope <= 0) {
    return [{
      id: `drain-slope-missing-${pipe.id}`,
      severity: "warning",
      objectIds: [pipe.id],
      text: "Дренажная труба без уклона",
    }];
  }
  if (slope < 1) {
    return [{
      id: `drain-slope-low-${pipe.id}`,
      severity: "warning",
      objectIds: [pipe.id],
      text: "Уклон дренажа меньше 1%",
    }];
  }
  if (slope > 5) {
    return [{
      id: `drain-slope-high-${pipe.id}`,
      severity: "warning",
      objectIds: [pipe.id],
      text: "Уклон дренажа больше 5%",
    }];
  }
  return [];
}

function tankAndPumpWarnings(items = [], pipes = []) {
  const warnings = [];
  const byItem = new Map();
  pipes.forEach((raw) => {
    const pipe = normalizePipe(raw);
    (pipe.endpointLinks || []).forEach((ln) => {
      if (!byItem.has(ln.itemId)) byItem.set(ln.itemId, []);
      byItem.get(ln.itemId).push({ pipe, endpoint: ln });
    });
  });

  const tanks = items.filter((it) => (it.category === "tank" || it.kind === "tank" || it.kind === "tank_waste"));
  tanks.forEach((tank) => {
    const links = byItem.get(tank.id) || [];
    const tankType = tank.params?.tankType || (tank.kind === "tank_waste" ? "waste" : "nutrient");
    const hasDrain = links.some((x) => x.pipe.pipeRole === "drain" || x.pipe.pipeSystem === "drainage" || x.endpoint.portType === "drain");
    const hasOutlet = links.some((x) => x.endpoint.portType === "outlet" || x.pipe.pipeRole === "supply" || x.pipe.pipeRole === "main");
    const hasOverflow = links.some((x) => x.endpoint.portType === "overflow" || x.pipe.pipeRole === "overflow");
    if (["drain_collection", "waste", "waste_tank"].includes(tankType) && !hasDrain) {
      warnings.push({
        id: `tank-drain-missing-${tank.id}`,
        severity: "warning",
        objectIds: [tank.id],
        text: "Бак дренажа должен иметь подключение drain",
      });
    }
    if (["nutrient", "nutrient_solution", "clean_water", "clean_water_tank"].includes(tankType) && !hasOutlet) {
      warnings.push({
        id: `tank-outlet-missing-${tank.id}`,
        severity: "warning",
        objectIds: [tank.id],
        text: "Бак раствора/чистой воды должен иметь outlet",
      });
    }
    if (!hasOverflow) {
      warnings.push({
        id: `tank-overflow-recommended-${tank.id}`,
        severity: "warning",
        objectIds: [tank.id],
        text: "Аварийный перелив желательно подключить",
      });
    }
  });

  const pumps = items.filter((it) => it.category === "pump" || it.kind === "pump");
  pumps.forEach((pump) => {
    const links = byItem.get(pump.id) || [];
    const hasInlet = links.some((x) => x.endpoint.portType === "inlet" || x.pipe.pipeRole === "return" || x.pipe.pipeRole === "branch");
    const hasOutlet = links.some((x) => x.endpoint.portType === "outlet" || x.pipe.pipeRole === "supply" || x.pipe.pipeRole === "main");
    if (!hasInlet || !hasOutlet) {
      warnings.push({
        id: `pump-ports-${pump.id}`,
        severity: "warning",
        objectIds: [pump.id],
        text: "Насос без inlet или outlet",
      });
    }
    if (!num(pump.params?.flowLh, 0)) {
      warnings.push({
        id: `pump-flow-${pump.id}`,
        severity: "warning",
        objectIds: [pump.id],
        text: "Не задан расход насоса (flowLh)",
      });
    }
    const hasTankConnection = links.some((x) => x.pipe.connectedObjectIds?.some((id) => {
      const obj = items.find((it) => it.id === id);
      return obj && (obj.category === "tank" || obj.kind === "tank" || obj.kind === "tank_waste");
    }));
    const hasSupply = links.some((x) => ["supply", "main"].includes(x.pipe.pipeRole));
    if (!hasTankConnection || !hasSupply) {
      warnings.push({
        id: `pump-placement-${pump.id}`,
        severity: "warning",
        objectIds: [pump.id],
        text: "Насос должен быть между баком и подающей магистралью",
      });
    }
  });
  return warnings;
}

export function collectPipeWarnings(plan = {}) {
  const lines = (plan.lines || []).map((line) => (isPipeLine(line) ? normalizePipe(line) : line));
  const rawPipes = lines.filter(isPipeLine);
  const pipes = rawPipes.map((pipe) => attachPipeConnections(pipe, plan.items || [], rawPipes));
  const warnings = [];
  pipes.forEach((pipe) => {
    warnings.push(...endpointWarnings(pipe, plan.items || [], pipes));
    warnings.push(...drainageSlopeWarnings(pipe));
  });
  warnings.push(...valveOnPipeWarnings(plan.items || [], pipes));
  warnings.push(...tankAndPumpWarnings(plan.items || [], pipes));
  return warnings;
}

function angleBetweenSegmentsDeg(a, b, c) {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const l1 = Math.hypot(v1x, v1y);
  const l2 = Math.hypot(v2x, v2y);
  if (l1 < EPS || l2 < EPS) return 0;
  const cos = (v1x * v2x + v1y * v2y) / (l1 * l2);
  const deg = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
  return deg;
}

function teeCountForPipe(pipe, allPipes) {
  const pts = pipe.points || [];
  if (pts.length < 2) return 0;
  let tees = 0;
  [0, pts.length - 1].forEach((idx) => {
    const endpoint = pts[idx];
    const onOther = allPipes.some((raw) => {
      if (raw.id === pipe.id) return false;
      const p = normalizePipe(raw);
      const pPts = p.points || [];
      for (let i = 1; i < pPts.length; i++) {
        const proj = pointProjectToSegment(endpoint, pPts[i - 1], pPts[i]);
        const d = dist(endpoint, proj);
        if (d <= 40 && proj.t > 0.05 && proj.t < 0.95) return true;
      }
      return false;
    });
    if (onOther) tees += 1;
  });
  return tees;
}

export function estimatePipeFittings(pipe = {}, allPipes = []) {
  const p = normalizePipe(pipe);
  const pts = p.points || [];
  let corners90 = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const angle = angleBetweenSegmentsDeg(pts[i - 1], pts[i], pts[i + 1]);
    if (Math.abs(angle - 90) <= 20) corners90 += 1;
  }
  const tees = teeCountForPipe(p, allPipes.length ? allPipes : [p]);
  const objectConnections = (p.connectedObjectIds || []).length;
  let unconnectedEnds = 0;
  const linksByIdx = new Set((p.endpointLinks || []).map((x) => x.endpointIndex));
  [0, pts.length - 1].forEach((idx) => {
    if (linksByIdx.has(idx)) return;
    if (endpointOnOtherPipe(pts[idx], p, allPipes.length ? allPipes : [p], 80)) return;
    unconnectedEnds += 1;
  });
  const endCaps = unconnectedEnds;
  return {
    corners90,
    tees,
    objectConnections,
    endCaps,
    total: corners90 + tees + objectConnections + endCaps,
  };
}
