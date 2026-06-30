/** Расстояния между точками. */

export function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function near(a, b, thr) {
  return dist(a, b) <= thr;
}
