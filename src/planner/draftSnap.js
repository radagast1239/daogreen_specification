import { snap } from "./catalog.js";

const BASE_ANGLE_DEG = [0, 45, 90, 135, 180, 225, 270, 315];
export const DEFAULT_ANGLE_TOLERANCE_DEG = 5;

export function normalizeAngleDeg(deg) {
  let a = deg % 360;
  if (a < 0) a += 360;
  return a;
}

export function angleBetweenDeg(from, to) {
  if (!from) return 0;
  return normalizeAngleDeg((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI);
}

export function projectPointToAngle(from, angleDeg, len) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: from.x + Math.cos(rad) * len, y: from.y + Math.sin(rad) * len };
}

function axisLabel(deg) {
  const a = normalizeAngleDeg(deg);
  if (a === 0 || a === 180) return "горизонталь";
  if (a === 90 || a === 270) return "вертикаль";
  if (a === 45 || a === 225) return "45°";
  if (a === 135 || a === 315) return "135°";
  return null;
}

function collectAngleCandidates(prevSegAngleDeg, walls) {
  const out = [];
  const add = (angle, type, label) => {
    out.push({ angle: normalizeAngleDeg(angle), type, label });
  };

  BASE_ANGLE_DEG.forEach((a) => add(a, "axis", axisLabel(a)));

  if (prevSegAngleDeg != null) {
    const pa = normalizeAngleDeg(prevSegAngleDeg);
    add(pa, "continue", "продолжение");
    add(pa + 180, "parallel", "параллельно");
    add(pa + 90, "perpendicular", "перпендикулярно");
    add(pa - 90, "perpendicular", "перпендикулярно");
  }

  (walls || []).forEach((w) => {
    for (let i = 1; i < w.pts.length; i++) {
      const wa = angleBetweenDeg(w.pts[i - 1], w.pts[i]);
      add(wa, "wall-parallel", "параллельно стене");
      add(wa + 90, "wall-perp", "перпендикулярно стене");
      add(wa + 180, "wall-parallel", "параллельно стене");
      add(wa - 90, "wall-perp", "перпендикулярно стене");
    }
  });

  return out;
}

/**
 * Мягкий или жёсткий (Shift) angle snap при рисовании стен/трасс.
 */
export function snapAngle(from, rawEnd, options = {}) {
  const {
    shiftHard = false,
    snapOn = true,
    angleSnapOn = true,
    toleranceDeg = DEFAULT_ANGLE_TOLERANCE_DEG,
    snapStep = 50,
    gridSnap = true,
    walls = [],
    prevSegAngleDeg = null,
  } = options;

  const gridPt = (p) => ({
    x: gridSnap && snapOn ? snap(p.x, snapStep, true) : p.x,
    y: gridSnap && snapOn ? snap(p.y, snapStep, true) : p.y,
  });

  if (!from) {
    return {
      snappedEnd: gridPt(rawEnd),
      snappedAngle: null,
      guideType: null,
      guideLabel: null,
      isSnapped: false,
    };
  }

  const rawAngle = angleBetweenDeg(from, rawEnd);
  const len = Math.hypot(rawEnd.x - from.x, rawEnd.y - from.y);
  if (len < 1) {
    return {
      snappedEnd: { x: from.x, y: from.y },
      snappedAngle: rawAngle,
      guideType: null,
      guideLabel: null,
      isSnapped: false,
    };
  }

  if (!snapOn || !angleSnapOn) {
    return {
      snappedEnd: gridPt(rawEnd),
      snappedAngle: rawAngle,
      guideType: null,
      guideLabel: null,
      isSnapped: false,
    };
  }

  const candidates = collectAngleCandidates(prevSegAngleDeg, walls);
  let best = null;
  let bestDiff = Infinity;
  candidates.forEach((c) => {
    let diff = Math.abs(rawAngle - c.angle);
    if (diff > 180) diff = 360 - diff;
    if (diff < bestDiff) {
      bestDiff = diff;
      best = c;
    }
  });

  const useSnap = shiftHard || (best && bestDiff <= toleranceDeg);
  if (useSnap && best) {
    const snappedEnd = gridPt(projectPointToAngle(from, best.angle, len));
    return {
      snappedEnd,
      snappedAngle: best.angle,
      guideType: best.type,
      guideLabel: best.label || axisLabel(best.angle),
      isSnapped: true,
    };
  }

  return {
    snappedEnd: gridPt(rawEnd),
    snappedAngle: rawAngle,
    guideType: null,
    guideLabel: null,
    isSnapped: false,
  };
}

export function resolveDraftPoint(from, rawEnd, options = {}) {
  const angleResult = snapAngle(from, rawEnd, options);
  return {
    point: angleResult.snappedEnd,
    angleSnap: angleResult,
  };
}
