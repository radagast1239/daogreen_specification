/** Углы и проекции на направление. */

export function normalizeAngleDeg(deg) {
  let a = deg % 360;
  if (a < 0) a += 360;
  return a;
}

export function angleBetweenDeg(from, to) {
  if (!from) return 0;
  return normalizeAngleDeg((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI);
}

export function angleDiff(a, b) {
  let d = Math.abs(normalizeAngleDeg(a) - normalizeAngleDeg(b));
  if (d > 180) d = 360 - d;
  return d;
}

export function projectPointToAngle(from, angleDeg, len) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: from.x + Math.cos(rad) * len, y: from.y + Math.sin(rad) * len };
}
