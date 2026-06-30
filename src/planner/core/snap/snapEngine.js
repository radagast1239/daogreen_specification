/**
 * Единый snap-движок планировщика.
 * Вход: { point, mode, plan, draft, view, modifiers, options }
 * Выход: { point, type, targetId, guides, label, angleSnap, fromAdjust, snapped }
 */
import { dist, near, midpoint } from "../geometry/point.js";
import { angleBetweenDeg } from "../geometry/angles.js";
import { projectOnSegment } from "../geometry/segment.js";
import { snapAltRound, gridSnapCandidate } from "../grid/gridSnap.js";
import { GRID_DEFAULT_SNAP_STEP } from "../grid/gridSettings.js";
import { snapAngle } from "./angleSnap.js";
import { SNAP_TYPES, SNAP_COLORS } from "./snapTypes.js";
import { pickBestSnap } from "./snapPriority.js";
import {
  snapWallPoint, refineWallDraftSnap, wallSegments, alignmentGuides,
} from "../walls/wallOps.js";
import { resolvePlanWalls } from "../../wallNetwork.js";
import { nearestItemAttach } from "../../lineProperties.js";
import { snapLineDraftPoint } from "../../plannerSnap.js";
import { snapRulerPoint } from "../../snapContour.js";

const BASE_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];
const SNAP_VERTEX_RADIUS_MM = 120;
const MIN_WALL_LENGTH_MM = 50;

function snapThr(zoom, px = 10) {
  return px / Math.max(zoom || 0.08, 0.05);
}

function collectVertexSnaps(pt, walls, thr) {
  const out = [];
  (walls || []).forEach((w) => {
    (w.pts || []).forEach((p, i) => {
      const d = dist(pt, p);
      if (d <= thr) {
        out.push({
          point: { x: p.x, y: p.y },
          type: SNAP_TYPES.VERTEX,
          targetId: `${w.id}:${i}`,
          distance: d,
          label: "узел",
        });
      }
    });
  });
  return out;
}

function collectWallLineSnaps(pt, walls, thr) {
  const out = [];
  wallSegments(walls).forEach((s) => {
    const proj = projectOnSegment(pt, s.a, s.b);
    const d = dist(pt, proj);
    if (d > thr) return;
    const atEnd = near(proj, s.a, 15) || near(proj, s.b, 15);
    const atMid = Math.abs(dist(s.a, proj) - dist(s.a, s.b) / 2) < 20;
    out.push({
      point: proj,
      type: atEnd ? SNAP_TYPES.WALL_END : atMid ? SNAP_TYPES.WALL_MID : SNAP_TYPES.WALL_LINE,
      targetId: s.wallId,
      distance: d,
      label: atMid ? "середина" : "на стене",
    });
  });
  return out;
}

function projectPointToAxis(from, raw, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  const dx = raw.x - from.x;
  const dy = raw.y - from.y;
  const t = dx * ux + dy * uy;
  return { x: from.x + ux * t, y: from.y + uy * t };
}

function collectExtensionSnaps(pt, from, walls, prevAngleDeg, thr) {
  if (!from) return [];
  const out = [];
  wallSegments(walls).forEach((s) => {
    if (near(from, s.a, 80) || near(from, s.b, 80)) {
      const ang = angleBetweenDeg(s.a, s.b);
      const proj = projectPointToAxis(from, pt, ang);
      const d = dist(pt, proj);
      if (d > thr) return;
      out.push({
        point: proj,
        type: SNAP_TYPES.WALL_EXTENSION,
        targetId: s.wallId,
        distance: d,
        label: "продолжение",
        guideAngle: ang,
      });
    }
  });
  if (prevAngleDeg != null) {
    const proj = projectPointToAxis(from, pt, prevAngleDeg);
    const d = dist(pt, proj);
    if (d <= thr) {
      out.push({
        point: proj,
        type: SNAP_TYPES.PARALLEL,
        distance: d,
        label: "параллельно",
        guideAngle: prevAngleDeg,
      });
    }
    const perp = prevAngleDeg + 90;
    const pproj = projectPointToAxis(from, pt, perp);
    const pd = dist(pt, pproj);
    if (pd <= thr) {
      out.push({
        point: pproj,
        type: SNAP_TYPES.PERPENDICULAR,
        distance: pd,
        label: "перпендикулярно",
        guideAngle: perp,
      });
    }
  }
  return out;
}

function collectCloseSnap(pt, chainStart, from, thr) {
  if (!chainStart || !from) return null;
  if (dist(from, chainStart) < 200) return null;
  const d = dist(pt, chainStart);
  if (d <= thr) {
    return {
      point: { x: chainStart.x, y: chainStart.y },
      type: SNAP_TYPES.CLOSE,
      distance: d,
      label: "замыкание",
    };
  }
  return null;
}

function mapLineSnapKind(kind = "") {
  if (kind === "wall" || kind === "wall-line") return SNAP_TYPES.WALL_LINE;
  if (kind === "wall-mid") return SNAP_TYPES.WALL_MID;
  if (kind === "wall-end" || kind === "wall-node" || kind === "node") return SNAP_TYPES.WALL_END;
  if (kind === "port" || kind === "object") return SNAP_TYPES.OBJECT_EDGE;
  return SNAP_TYPES.OBJECT_CENTER;
}

function collectLineToolCandidates(pt, plan, walls, {
  zoom, snapOn, snapGrid, snapWalls, snapObjects, snapStep,
}) {
  const out = [];
  const lineSnap = snapLineDraftPoint(pt, {
    items: plan.items || [],
    walls,
    room: plan.room,
    lines: plan.lines || [],
    zoom,
    snapOn,
    snapGrid,
    snapWalls,
    snapObjects,
    snapStep,
  });
  if (lineSnap?.snapped) {
    out.push({
      point: { x: lineSnap.x, y: lineSnap.y },
      type: mapLineSnapKind(lineSnap.kind),
      targetId: lineSnap.itemId || lineSnap.lineId || null,
      distance: lineSnap.d ?? dist(pt, { x: lineSnap.x, y: lineSnap.y }),
      label: lineSnap.kind === "trass" ? "узел трассы" : null,
    });
  }
  if (snapObjects) {
    const attach = nearestItemAttach(pt, plan.items || [], 240 / Math.max(zoom || 0.08, 0.05));
    if (attach?.pt) {
      out.push({
        point: { x: attach.pt.x, y: attach.pt.y },
        type: SNAP_TYPES.OBJECT_EDGE,
        targetId: attach.itemId || null,
        distance: dist(pt, attach.pt),
        label: attach.portType ? "порт" : "объект",
      });
    }
  }
  return out;
}

function collectMeasureToolCandidates(pt, plan, walls, {
  zoom, snapOn, snapGrid, snapStep,
}) {
  const out = [];
  const rulerSnap = snapRulerPoint(pt, {
    items: plan.items || [],
    walls,
    room: plan.room,
    zoom,
    snapOn,
    altOff: false,
    gridSnap: snapGrid,
    snapStep,
  });
  if (rulerSnap?.snapped) {
    out.push({
      point: { x: rulerSnap.x, y: rulerSnap.y },
      type: rulerSnap.kind === "grid" ? SNAP_TYPES.GRID
        : rulerSnap.kind === "node" ? SNAP_TYPES.WALL_END
          : rulerSnap.kind === "wall" ? SNAP_TYPES.WALL_LINE
            : SNAP_TYPES.OBJECT_EDGE,
      targetId: rulerSnap.itemId || null,
      distance: dist(pt, { x: rulerSnap.x, y: rulerSnap.y }),
      label: null,
    });
  }
  return out;
}

export function runSnapEngine(input) {
  const {
    point: raw,
    mode = "wall",
    plan = {},
    draft = {},
    view = {},
    modifiers = {},
    options = {},
  } = input;

  const {
    shift = false,
    alt = false,
  } = modifiers;

  const {
    snapOn = true,
    snapStep = GRID_DEFAULT_SNAP_STEP,
    snapGrid = true,
    snapWalls = true,
    angleSnapOn = true,
    toleranceDeg = 5,
    snapDistancePx = 10,
    wallThk = 100,
    prevSegAngleDeg = null,
    chainStart = null,
    from = null,
  } = options;

  const zoom = view.zoom || 0.08;
  const thr = snapThr(zoom, snapDistancePx);
  const vertexThr = Math.max(thr, SNAP_VERTEX_RADIUS_MM / Math.max(zoom, 0.05));
  const walls = resolvePlanWalls(plan);

  if (alt) {
    const pt = snapAltRound(raw, 1);
    return {
      point: pt,
      type: SNAP_TYPES.GRID,
      targetId: null,
      guides: [],
      label: null,
      snapped: true,
      angleSnap: null,
      fromAdjust: null,
      color: SNAP_COLORS.primary,
    };
  }

  let pt = { x: raw.x, y: raw.y };
  const candidates = [];

  if (snapOn && snapWalls && mode === "wall") {
    candidates.push(...collectVertexSnaps(pt, walls, vertexThr));
    candidates.push(...collectWallLineSnaps(pt, walls, thr));
    candidates.push(...collectExtensionSnaps(pt, from, walls, prevSegAngleDeg, thr));
    const close = collectCloseSnap(pt, chainStart, from, thr);
    if (close) candidates.push(close);
  }
  if (mode === "line") {
    candidates.push(...collectLineToolCandidates(pt, plan, walls, {
      zoom,
      snapOn,
      snapGrid,
      snapWalls,
      snapObjects: options.snapObjects !== false,
      snapStep,
    }));
  }
  if (mode === "measure") {
    candidates.push(...collectMeasureToolCandidates(pt, plan, walls, {
      zoom,
      snapOn,
      snapGrid,
      snapStep,
    }));
  }

  const angleResult = from
    ? snapAngle(from, pt, {
      shiftHard: shift,
      snapOn,
      angleSnapOn,
      toleranceDeg,
      snapStep,
      gridSnap: false,
      walls,
      prevSegAngleDeg,
    })
    : null;

  if (angleResult?.isSnapped) {
    candidates.push({
      point: angleResult.snappedEnd,
      type: angleResult.guideType?.includes("perp") ? SNAP_TYPES.PERPENDICULAR
        : angleResult.guideType?.includes("parallel") ? SNAP_TYPES.PARALLEL
          : SNAP_TYPES.ANGLE,
      distance: dist(pt, angleResult.snappedEnd),
      label: angleResult.guideLabel,
      guideAngle: angleResult.snappedAngle,
    });
  }

  if (snapOn && snapGrid) {
    const g = gridSnapCandidate(pt, snapStep, true);
    if (g) {
      candidates.push({
        point: g.point,
        type: SNAP_TYPES.GRID,
        distance: g.distance,
        label: "сетка",
      });
    }
  }

  let best = pickBestSnap(candidates);
  let fromAdjust = null;
  let refinedSnap = null;

  if (best) {
    pt = { ...best.point };
  } else if (angleResult) {
    pt = angleResult.snappedEnd;
  } else if (snapOn && snapGrid) {
    pt = gridSnapCandidate(raw, snapStep, true)?.point || pt;
  }

  if (from && snapOn && snapWalls && mode === "wall") {
    const refined = refineWallDraftSnap(from, pt, angleResult, walls, plan.room, zoom, {
      snapOn: true,
      toleranceDeg: toleranceDeg + 3,
      wallThk,
    });
    pt = refined.pt;
    if (refined.fromAdjust) fromAdjust = refined.fromAdjust;
    if (refined.snap) {
      refinedSnap = refined.snap;
      best = {
        point: pt,
        type: SNAP_TYPES.PERPENDICULAR,
        targetId: refined.snap.wallId,
        distance: 0,
        label: "T-стык",
      };
    }
  }

  const guides = (snapOn && options.snapGuides !== false && from)
    ? alignmentGuides(plan.nodes, walls, pt, plan.room, from)
    : [];

  if (from && angleResult?.isSnapped && angleResult?.snappedEnd) {
    guides.push({
      type: angleResult.guideType || "angle",
      a: { x: from.x, y: from.y },
      b: { x: angleResult.snappedEnd.x, y: angleResult.snappedEnd.y },
      color: SNAP_COLORS.guide,
    });
  }

  if (best?.guideAngle != null) {
    guides.push({
      type: "angle",
      angle: best.guideAngle,
      at: from || pt,
      color: SNAP_COLORS.guide,
    });
  }

  return {
    point: pt,
    type: best?.type || (angleResult?.isSnapped ? SNAP_TYPES.ANGLE : SNAP_TYPES.GRID),
    targetId: best?.targetId || refinedSnap?.wallId || null,
    guides,
    label: best?.label || angleResult?.guideLabel || null,
    snapped: !!(best || angleResult?.isSnapped || refinedSnap),
    angleSnap: angleResult,
    fromAdjust,
    color: SNAP_COLORS.primary,
    kind: refinedSnap?.kind || best?.type,
    minWallLengthMm: MIN_WALL_LENGTH_MM,
  };
}

export { BASE_ANGLES };
