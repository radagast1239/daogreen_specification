/** 2D-точки. */

export function point(x, y) {
  return { x, y };
}

export function clonePoint(p) {
  return p ? { x: p.x, y: p.y } : null;
}

export function pointsEqual(a, b, eps = 0.01) {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
}

export function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function near(a, b, thr) {
  return dist(a, b) <= thr;
}

export function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
