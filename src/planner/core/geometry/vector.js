import { normalizeAngleDeg } from "./angles.js";

export function vec(dx, dy) {
  return { x: dx, y: dy };
}

export function vecLen(v) {
  return Math.hypot(v.x, v.y);
}

export function vecUnit(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

export function vecNormal(a, b) {
  const u = vecUnit(a, b);
  return { x: -u.y, y: u.x };
}

export function vecDot(a, b) {
  return a.x * b.x + a.y * b.y;
}

export function angleDeg(a, b) {
  return normalizeAngleDeg((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);
}

export function projectPointToAngle(from, angleDeg, len) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: from.x + Math.cos(rad) * len, y: from.y + Math.sin(rad) * len };
}
