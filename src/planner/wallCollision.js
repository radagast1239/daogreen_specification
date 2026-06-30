/** Пересечение предмета с телом стены (центральная линия + толщина). */

function pointInRect(p, x1, y1, x2, y2) {
  return p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2;
}

function segmentsIntersect(a, b, c, d) {
  const det = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(det) < 1e-9) return false;
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / det;
  const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / det;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function lineIntersectsRect(a, b, rx1, ry1, rx2, ry2) {
  if (pointInRect(a, rx1, ry1, rx2, ry2) || pointInRect(b, rx1, ry1, rx2, ry2)) return true;
  const edges = [
    [{ x: rx1, y: ry1 }, { x: rx2, y: ry1 }],
    [{ x: rx2, y: ry1 }, { x: rx2, y: ry2 }],
    [{ x: rx2, y: ry2 }, { x: rx1, y: ry2 }],
    [{ x: rx1, y: ry2 }, { x: rx1, y: ry1 }],
  ];
  return edges.some(([p1, p2]) => segmentsIntersect(a, b, p1, p2));
}

function segRectHit(a, b, it, pad) {
  const rx1 = it.x - pad;
  const ry1 = it.y - pad;
  const rx2 = it.x + it.w + pad;
  const ry2 = it.y + it.h + pad;
  return lineIntersectsRect(a, b, rx1, ry1, rx2, ry2);
}

export function wallHitsItem(wall, it) {
  if (!wall?.pts || wall.pts.length < 2) return false;
  for (let i = 1; i < wall.pts.length; i++) {
    const a = wall.pts[i - 1];
    const b = wall.pts[i];
    if (segRectHit(a, b, it, (wall.thk || 100) / 2)) return true;
  }
  return false;
}

export function itemOverlapsAnyWall(item, walls = []) {
  return (walls || []).some((w) => wallHitsItem(w, item));
}
