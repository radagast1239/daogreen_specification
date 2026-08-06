/**
 * PHASE 2F2 — true corner angle dimensions (RemPlanner-style).
 *
 * Pure semantic model: topology node + two incident wall rays + intended sector.
 * Degree values use centreline directions (parallel faces share the same angle).
 * Presentation (arc radius / label shift) is separate and must not change sector.
 */
import { resolveLogicalWallChain, isInternalChainNode } from "../walls/logicalWallChain.js";
import { pointInPolygon } from "../walls/wallOps.js";
import { computeAngleArcGeometry } from "./renderGeometry.js";
import {
  selectedCornerArcRadiusMm as selectedArcRadiusScreenMm,
  movementCornerArcRadiusMm,
  angleFontPx,
  anglesVisibleAtZoom,
  ANGLE_PAIR_STAGGER_PX,
  SELECTED_ARC_MAX_PX,
  MOVEMENT_ARC_MAX_PX,
  screenPxToWorldMm,
  resolveAngleLabelPlacement,
  angleChipRectWorld,
} from "./angleLabelPresentation.js";

export {
  selectedCornerArcRadiusMm,
  movementCornerArcRadiusMm,
  angleFontPx,
  anglesVisibleAtZoom,
  resolveAngleLabelPlacement,
  angleChipRectWorld,
} from "./angleLabelPresentation.js";

const MIN_ARM_MM = 1;
const COLLINEAR_CROSS_EPS = 0.02;
const OPPOSITE_DOT_MAX = -0.98;
/** Slightly bent hosts still classify as T (screenshot 180/88/92 hub path). */
const NEAR_T_CROSS_EPS = 0.08;
const NEAR_T_OPPOSITE_DOT = -0.95;
const STRAIGHT_TOL_DEG = 0.55;
/** Host-host continuations and near-straight fans must never paint as corners. */
const CONTINUATION_SUPPRESS_DEG = 170;
const NEAR_ZERO_DEG = 0.05;
const MAX_VISIBLE_PER_WALL = 4;
const PROBE_MM = 48;
const DISPLAY_SNAP_DEG = 0.05;

const isFinitePt = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);

export function normalizeDeg(deg) {
  if (!Number.isFinite(deg)) return 0;
  let a = deg % 360;
  if (a < 0) a += 360;
  if (a >= 360 - 1e-12) a = 0;
  return a;
}

/** One-decimal display degrees; never "-0.0"; clamps residue near exact angles. */
export function displayCornerAngleDeg(deg) {
  if (!Number.isFinite(deg)) return null;
  let d = deg;
  if (Math.abs(d) < NEAR_ZERO_DEG || Math.abs(d - 360) < NEAR_ZERO_DEG) d = 0;
  if (d < 0) d = 0;
  for (const exact of [0, 45, 90, 135, 180]) {
    if (Math.abs(d - exact) < DISPLAY_SNAP_DEG) {
      d = exact;
      break;
    }
  }
  let rounded = Math.round(d * 10) / 10;
  if (Object.is(rounded, -0) || Math.abs(rounded) < 1e-12) rounded = 0;
  if (rounded >= 360) rounded = 0;
  return rounded;
}

export function formatCornerAngleDisplay(deg) {
  const d = displayCornerAngleDeg(deg);
  if (d == null) return null;
  return `${d.toFixed(1)}°`;
}

function otherNodeId(wall, nodeId) {
  if (wall?.a === nodeId) return wall.b;
  if (wall?.b === nodeId) return wall.a;
  return null;
}

function raysCollinearOpposite(a, b, {
  crossEps = COLLINEAR_CROSS_EPS,
  oppositeDot = OPPOSITE_DOT_MAX,
} = {}) {
  const cross = Math.abs(a.ux * b.uy - a.uy * b.ux);
  const dot = a.ux * b.ux + a.uy * b.uy;
  return cross <= crossEps && dot <= oppositeDot;
}

function isContinuationSector(sweepDeg) {
  return sweepDeg >= CONTINUATION_SUPPRESS_DEG - 1e-9
    || Math.abs(sweepDeg - 180) <= STRAIGHT_TOL_DEG;
}

/**
 * Deterministic incident rays at a topology node (polar angle, then wallId).
 */
export function collectIncidentRays(plan, nodeId) {
  const node = plan?.nodes?.[nodeId];
  if (!node || !isFinitePt(node)) return [];
  const rays = [];
  for (const w of plan.walls || []) {
    if (!w || (w.a !== nodeId && w.b !== nodeId)) continue;
    const oid = otherNodeId(w, nodeId);
    const other = plan.nodes?.[oid];
    if (!isFinitePt(other)) continue;
    const dx = other.x - node.x;
    const dy = other.y - node.y;
    const len = Math.hypot(dx, dy);
    if (len < MIN_ARM_MM) continue;
    rays.push({
      wallId: w.id,
      nodeId,
      otherNodeId: oid,
      angleDeg: normalizeDeg((Math.atan2(dy, dx) * 180) / Math.PI),
      ux: dx / len,
      uy: dy / len,
      len,
      chainId: w.chainId ?? null,
      thk: w.thk || 100,
    });
  }
  rays.sort((a, b) => {
    const da = a.angleDeg - b.angleDeg;
    if (Math.abs(da) > 1e-9) return da;
    return String(a.wallId).localeCompare(String(b.wallId));
  });
  return rays;
}

function adjacentSectors(rays) {
  if (rays.length < 2) return [];
  const out = [];
  const n = rays.length;
  // CCW step to the next polar ray. For n===2 this yields both complementary
  // sectors (θ and 360−θ); for n>=3 it yields the full node partition.
  for (let i = 0; i < n; i++) {
    const a = rays[i];
    const b = rays[(i + 1) % n];
    const sweep = normalizeDeg(b.angleDeg - a.angleDeg);
    if (sweep <= NEAR_ZERO_DEG) continue;
    out.push({
      rayA: a,
      rayB: b,
      startDeg: a.angleDeg,
      endDeg: b.angleDeg,
      sweepDeg: sweep,
      index: i,
    });
  }
  return out;
}

function sectorTouchesWall(sector, wallIdSet) {
  return wallIdSet.has(sector.rayA.wallId) || wallIdSet.has(sector.rayB.wallId);
}

function isStraightSector(sweepDeg) {
  return Math.abs(sweepDeg - 180) <= STRAIGHT_TOL_DEG;
}

function classifyNode(rays, plan, nodeId) {
  const degree = rays.length;
  if (degree < 2) return { kind: "free", degree, hostPair: null, branchRays: [] };
  let hostPair = null;
  const tryPair = (a, b, loose) => raysCollinearOpposite(
    a,
    b,
    loose
      ? { crossEps: NEAR_T_CROSS_EPS, oppositeDot: NEAR_T_OPPOSITE_DOT }
      : {},
  );
  for (let i = 0; i < rays.length; i++) {
    for (let j = i + 1; j < rays.length; j++) {
      if (tryPair(rays[i], rays[j], false) || tryPair(rays[i], rays[j], true)) {
        hostPair = [rays[i], rays[j]];
        break;
      }
    }
    if (hostPair) break;
  }
  // Logical-chain internal node is a T even if float noise slightly breaks collinearity.
  if (!hostPair && degree >= 3) {
    for (const r of rays) {
      const chain = resolveLogicalWallChain(plan, r.wallId);
      if (isInternalChainNode(chain, nodeId)) {
        const hosts = rays.filter((x) => (chain.wallIds || []).includes(x.wallId));
        if (hosts.length >= 2 && (tryPair(hosts[0], hosts[1], false) || tryPair(hosts[0], hosts[1], true))) {
          hostPair = [hosts[0], hosts[1]];
          break;
        }
      }
    }
  }
  // Classic T is degree-3 with exactly one collinear host pair.
  // A cross (degree 4, two collinear pairs) must stay a hub — not a T.
  if (hostPair && degree === 3) {
    const hostIds = new Set(hostPair.map((r) => r.wallId));
    const branchRays = rays.filter((r) => !hostIds.has(r.wallId));
    return { kind: "t", degree, hostPair, branchRays };
  }
  if (degree === 2) return { kind: "corner", degree, hostPair: null, branchRays: [] };
  if (degree === 3) return { kind: "hub3", degree, hostPair: null, branchRays: [] };
  return { kind: "hub", degree, hostPair: null, branchRays: [] };
}

function probeInsideRoom(plan, vertex, startDeg, sweepDeg) {
  const rooms = plan?.rooms || [];
  if (!rooms.length || !isFinitePt(vertex)) return null;
  const mid = startDeg + sweepDeg / 2;
  const rad = (mid * Math.PI) / 180;
  const probe = {
    x: vertex.x + Math.cos(rad) * PROBE_MM,
    y: vertex.y + Math.sin(rad) * PROBE_MM,
  };
  for (const room of rooms) {
    const poly = room?.polygon;
    if (poly?.length >= 3 && pointInPolygon(probe, poly)) return true;
  }
  return false;
}

/**
 * Choose the intended sector between two rays (degree-2 corner / open-L / room).
 * Never prefers the reflex exterior when a non-reflex interior exists.
 */
export function chooseIntendedSector(rayA, rayB, plan, vertex) {
  const sectors = adjacentSectors([rayA, rayB].sort((a, b) => {
    const d = a.angleDeg - b.angleDeg;
    if (Math.abs(d) > 1e-9) return d;
    return String(a.wallId).localeCompare(String(b.wallId));
  }));
  if (!sectors.length) return null;
  const nonReflex = sectors.filter((s) => s.sweepDeg <= 180 + STRAIGHT_TOL_DEG && s.sweepDeg > NEAR_ZERO_DEG);
  let pool = nonReflex.length ? nonReflex : sectors.filter((s) => s.sweepDeg > NEAR_ZERO_DEG);
  if (!pool.length) return null;

  // Prefer a non-reflex sector that probes inside a room. Never promote a reflex
  // exterior merely because the probe failed on the compact interior sector.
  const inside = pool.filter((s) => (
    s.sweepDeg <= 180 + STRAIGHT_TOL_DEG
    && probeInsideRoom(plan, vertex, s.startDeg, s.sweepDeg) === true
  ));
  if (inside.length) pool = inside;

  pool = [...pool].sort((a, b) => {
    if (Math.abs(a.sweepDeg - b.sweepDeg) > 1e-9) return a.sweepDeg - b.sweepDeg;
    const ka = [a.rayA.wallId, a.rayB.wallId].sort().join("|");
    const kb = [b.rayA.wallId, b.rayB.wallId].sort().join("|");
    return ka.localeCompare(kb);
  });
  return pool[0];
}

function sectorIdentity(nodeId, sector) {
  const walls = [sector.rayA.wallId, sector.rayB.wallId].sort();
  // Quantize start to avoid float identity churn; sector walls define identity.
  return `ang:${nodeId}:${walls[0]}:${walls[1]}:${Math.round(sector.sweepDeg * 10)}`;
}

function toAnnotation(nodeId, vertex, sector, {
  role = "corner",
  priority = 1,
  thk = 100,
} = {}) {
  const deg = sector.sweepDeg;
  if (!(deg > NEAR_ZERO_DEG) || deg >= 360 - NEAR_ZERO_DEG) return null;
  // Never paint host-host / near-straight continuations as primary angles.
  if (isContinuationSector(deg)) return null;
  if (deg > 180 + STRAIGHT_TOL_DEG && role !== "hub") {
    // Contract: do not emit reflex as primary corner/open-L/room angle.
    return null;
  }
  const displayDeg = displayCornerAngleDeg(deg);
  const text = formatCornerAngleDisplay(deg);
  const r1 = {
    x: vertex.x + sector.rayA.ux * 100,
    y: vertex.y + sector.rayA.uy * 100,
  };
  const r2 = {
    x: vertex.x + sector.rayB.ux * 100,
    y: vertex.y + sector.rayB.uy * 100,
  };
  return {
    id: sectorIdentity(nodeId, sector),
    kind: "corner_angle",
    role,
    nodeId,
    vertex: { x: vertex.x, y: vertex.y },
    wallIds: [sector.rayA.wallId, sector.rayB.wallId],
    rayA: {
      wallId: sector.rayA.wallId,
      angleDeg: sector.rayA.angleDeg,
      ux: sector.rayA.ux,
      uy: sector.rayA.uy,
    },
    rayB: {
      wallId: sector.rayB.wallId,
      angleDeg: sector.rayB.angleDeg,
      ux: sector.rayB.ux,
      uy: sector.rayB.uy,
    },
    startDeg: sector.startDeg,
    endDeg: normalizeDeg(sector.startDeg + sector.sweepDeg),
    sweepDeg: deg,
    deg,
    displayDeg,
    text,
    priority,
    thk,
    // Stable semantic fingerprint — presentation must not alter this.
    sectorKey: `${[sector.rayA.wallId, sector.rayB.wallId].sort().join("|")}:${displayDeg}`,
  };
}

function selectedWallIdSet(plan, wallId) {
  const chain = resolveLogicalWallChain(plan, wallId);
  const ids = new Set(chain?.wallIds?.length ? chain.wallIds : [wallId]);
  ids.add(wallId);
  return ids;
}

/**
 * Nodes where angles may appear for the selection.
 * Unlike length grips (outer-only for logical hosts), T junctions MUST be
 * included so branch↔host sectors are visible when a host half is selected.
 */
function angleNodeIdsForSelection(plan, wallId) {
  const chain = resolveLogicalWallChain(plan, wallId);
  const ids = new Set();
  if (chain?.nodeIds?.length) {
    for (const n of chain.nodeIds) ids.add(n);
  }
  const wall = (plan.walls || []).find((w) => w.id === wallId);
  if (wall?.a) ids.add(wall.a);
  if (wall?.b) ids.add(wall.b);
  return [...ids];
}

/**
 * Authoritative corner angles for a selected wall.
 * Visibility is selection-driven; pointer must not change the set.
 */
export function buildSelectedWallCornerAngles(plan, wallId, {
  maxAngles = MAX_VISIBLE_PER_WALL,
} = {}) {
  if (!plan || !wallId) return [];
  const wallIds = selectedWallIdSet(plan, wallId);
  const nodeIds = angleNodeIdsForSelection(plan, wallId);
  const out = [];
  const seen = new Set();

  for (const nodeId of nodeIds) {
    const vertex = plan.nodes?.[nodeId];
    if (!isFinitePt(vertex)) continue;
    const rays = collectIncidentRays(plan, nodeId);
    if (rays.length < 2) continue; // free endpoint — hide angle
    const cls = classifyNode(rays, plan, nodeId);
    const sectors = adjacentSectors(rays);
    const thk = rays.find((r) => wallIds.has(r.wallId))?.thk || 100;

    let chosen = [];
    if (cls.kind === "corner") {
      const intended = chooseIntendedSector(rays[0], rays[1], plan, vertex);
      if (intended) chosen = [intended];
    } else if (cls.kind === "t") {
      const hostIds = new Set(cls.hostPair.map((r) => r.wallId));
      const isBranchHostSector = (s) => hostIds.has(s.rayA.wallId) !== hostIds.has(s.rayB.wallId);
      for (const s of sectors) {
        if (isContinuationSector(s.sweepDeg)) continue; // never host-host 180°
        if (!isBranchHostSector(s)) continue;
        if (!sectorTouchesWall(s, wallIds)) continue;
        chosen.push(s);
      }
      // Host half selection: only one branch-host sector touches that half.
      // Surface both complementary branch-host sectors (90+90 / sum 180) so the
      // T reads the same whether the branch or either host half is selected.
      if (cls.branchRays.length >= 1) {
        for (const s of sectors) {
          if (isContinuationSector(s.sweepDeg)) continue;
          if (!isBranchHostSector(s)) continue;
          if (!chosen.some((c) => c.index === s.index)) chosen.push(s);
        }
      }
    } else {
      // hub3 / hub4+: only sectors adjacent to the selected wall; suppress straights.
      for (const s of sectors) {
        if (isContinuationSector(s.sweepDeg)) continue;
        if (!sectorTouchesWall(s, wallIds)) continue;
        if (s.sweepDeg > 180 + STRAIGHT_TOL_DEG) continue;
        chosen.push(s);
      }
      // Cap hub fan: at most two compact sectors touching the selection.
      chosen.sort((a, b) => a.sweepDeg - b.sweepDeg);
      chosen = chosen.slice(0, 2);
    }

    for (const s of chosen) {
      const ann = toAnnotation(nodeId, vertex, s, {
        role: cls.kind === "t" ? "t_branch" : "corner",
        priority: cls.kind === "t" ? 2 : 1,
        thk,
      });
      if (!ann || seen.has(ann.id)) continue;
      seen.add(ann.id);
      out.push(ann);
    }
  }

  out.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return String(a.id).localeCompare(String(b.id));
  });
  return out.slice(0, Math.max(0, maxAngles));
}

/** Screen-bounded arc radius in world mm (legacy / movement). */
export function cornerArcRadiusMm(zoom, thk = 100) {
  const z = Math.max(Number(zoom) || 1, 1e-6);
  const minPx = 18;
  const maxPx = 48;
  const targetPx = 32;
  let world = targetPx / z;
  const minWorld = (Number(thk) || 100) * 0.5 + 14;
  world = Math.max(world, minWorld);
  const px = world * z;
  if (px < minPx) world = minPx / z;
  if (px > maxPx) world = maxPx / z;
  return world;
}

/**
 * Presentation-only layout. May adjust radius / label offset; never the sector.
 */
export function presentCornerAngle(angle, {
  zoom = 1,
  radiusMm = null,
  labelShiftDeg = 0,
  occupancy = [],
  mode = "selected",
  pairIndex = 0,
  peerLabelPositions = [],
} = {}) {
  if (!angle?.vertex || !Number.isFinite(angle.sweepDeg)) {
    return { valid: false, angle, geometry: null, labelPos: null, radius: null };
  }
  const z = Math.max(Number(zoom) || 1, 1e-6);
  const defaultR = mode === "movement"
    ? movementCornerArcRadiusMm(z, angle.thk)
    : selectedArcRadiusScreenMm(z, angle.thk);
  let radius = Number.isFinite(radiusMm) ? radiusMm : defaultR;
  const maxScreen = mode === "movement" ? MOVEMENT_ARC_MAX_PX : SELECTED_ARC_MAX_PX;
  // Bounded collision: nudge radius away from foreign occupancy only.
  // Grip occupancy is centered on the pivot itself — never use it to inflate
  // the arc (labels already clear the visible grip via resolveAngleLabelPlacement).
  for (const occ of occupancy || []) {
    const p = occ?.point;
    if (!isFinitePt(p) || !isFinitePt(angle.vertex)) continue;
    const d = Math.hypot(p.x - angle.vertex.x, p.y - angle.vertex.y);
    if (d < 1e-6) continue;
    const clear = Number.isFinite(occ.clearMm) ? occ.clearMm : 0;
    if (d < clear + screenPxToWorldMm(4, z)) {
      const bumped = radius + screenPxToWorldMm(6, z);
      const cap = maxScreen / z;
      radius = Math.min(cap, bumped);
    }
  }
  const start = angle.startDeg;
  const sweep = angle.sweepDeg;
  const ray1 = {
    x: angle.vertex.x + Math.cos((start * Math.PI) / 180) * 100,
    y: angle.vertex.y + Math.sin((start * Math.PI) / 180) * 100,
  };
  const ray2 = {
    x: angle.vertex.x + Math.cos(((start + sweep) * Math.PI) / 180) * 100,
    y: angle.vertex.y + Math.sin(((start + sweep) * Math.PI) / 180) * 100,
  };
  const geometry = computeAngleArcGeometry({
    vertex: angle.vertex,
    ray1,
    ray2,
    radius,
  });
  const placed = resolveAngleLabelPlacement({
    vertex: angle.vertex,
    startDeg: start,
    sweepDeg: sweep,
    arcRadiusMm: radius,
    zoom: z,
    mode,
    pairIndex,
    text: angle.text,
    peerLabelPositions,
    labelShiftDeg,
  });
  const labelPos = placed?.labelPos || null;
  const labelR = placed?.labelRadiusMm ?? null;
  const fontPx = placed?.fontPx ?? angleFontPx(z, mode);
  const tickLen = Math.min(
    screenPxToWorldMm(10, z),
    radius * 0.22,
  );
  const ticks = [start, start + sweep].map((deg) => {
    const rad = (deg * Math.PI) / 180;
    const ux = Math.cos(rad);
    const uy = Math.sin(rad);
    return {
      a: { x: angle.vertex.x + ux * (radius - tickLen), y: angle.vertex.y + uy * (radius - tickLen) },
      b: { x: angle.vertex.x + ux * radius, y: angle.vertex.y + uy * radius },
    };
  });
  const chip = labelPos
    ? angleChipRectWorld(labelPos, angle.text, fontPx, z)
    : null;
  return {
    valid: !!(geometry?.valid && labelPos),
    angle,
    sectorKey: angle.sectorKey,
    sweepDeg: angle.sweepDeg,
    displayDeg: angle.displayDeg,
    text: angle.text,
    geometry,
    labelPos,
    labelRadiusMm: labelR,
    labelShiftDeg: placed?.labelShiftDeg ?? 0,
    radius,
    radiusScreenPx: radius * z,
    fontPx,
    chip,
    ticks,
    startDeg: start,
    sweepDegArc: sweep,
    mode,
  };
}

export function presentSelectedCornerAngles(angles, opts = {}) {
  const zoom = opts.zoom;
  const wasVisible = !!opts.wasVisible;
  // Angle LOD is independent of adaptiveGrid overview — stay visible longer.
  const lodHide = opts.forceHide === true
    || !anglesVisibleAtZoom(zoom, { wasVisible });
  if (lodHide) return [];
  // Extreme zoom fallback: keep the tighter (primary) sector only.
  let list = angles || [];
  if (Number.isFinite(zoom) && zoom < ANGLE_LOD_EXTREME_PAIR_ZOOM && list.length > 1) {
    list = [...list].sort((a, b) => a.sweepDeg - b.sweepDeg).slice(0, 1);
  }
  const peers = [];
  const out = [];
  const mode = opts.mode || "selected";
  const maxArcPx = mode === "movement" ? MOVEMENT_ARC_MAX_PX : SELECTED_ARC_MAX_PX;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const baseR = opts.radiusMm != null
      ? opts.radiusMm
      : (mode === "movement"
        ? movementCornerArcRadiusMm(zoom, a.thk)
        : selectedArcRadiusScreenMm(zoom, a.thk));
    const staggered = baseR + screenPxToWorldMm(i * ANGLE_PAIR_STAGGER_PX, zoom);
    const presented = presentCornerAngle(a, {
      ...opts,
      mode,
      pairIndex: i,
      peerLabelPositions: peers,
      // Keep pair stagger, but never exceed the screen arc clamp.
      radiusMm: Math.min(staggered, maxArcPx / Math.max(Number(zoom) || 1, 1e-6)),
    });
    if (!presented.valid) continue;
    peers.push(presented.labelPos);
    out.push(presented);
  }
  return out;
}

/** Below this, drop the secondary of a pair (presentation only). */
const ANGLE_LOD_EXTREME_PAIR_ZOOM = 0.072;

/** Adjacent sectors around a node (for tests / hub sum checks). */
export function nodeAdjacentSectors(plan, nodeId) {
  const rays = collectIncidentRays(plan, nodeId);
  return adjacentSectors(rays).map((s) => ({
    wallIds: [s.rayA.wallId, s.rayB.wallId],
    startDeg: s.startDeg,
    sweepDeg: s.sweepDeg,
  }));
}

export function sectorSumDeg(sectors) {
  return (sectors || []).reduce((acc, s) => acc + (Number(s.sweepDeg) || 0), 0);
}
