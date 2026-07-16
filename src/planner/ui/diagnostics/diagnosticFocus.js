/**
 * PHASE 0D — чистый резолвер «куда перейти» для diagnostic.
 *
 * По плану и diagnostic пытается найти существующую сущность и её геометрию,
 * чтобы UI мог выделить её и центрировать viewport. Ничего не мутирует,
 * не импортирует React/CAD Core; читает текущую schema напрямую.
 *
 * Возвращает:
 *   {
 *     selection: { coll, id } | null,   // формат существующей selection PlanPage
 *     point:     { x, y } | null,       // куда центрировать (мм)
 *     bounds:    { minX,minY,maxX,maxY } | null,
 *     canFocus:  boolean,               // можно ли безопасно центрировать
 *     reason:    string | null          // код причины, если canFocus=false
 *   }
 */

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}
function isPt(p) {
  return p != null && typeof p === "object" && isNum(p.x) && isNum(p.y);
}
function boundsOfPoints(pts) {
  const valid = pts.filter(isPt);
  if (!valid.length) return null;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of valid) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}
function centerOfBounds(b) {
  return b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : null;
}
function boundsAroundPoint(p, pad = 500) {
  return { minX: p.x - pad, minY: p.y - pad, maxX: p.x + pad, maxY: p.y + pad };
}
function result(partial) {
  return {
    selection: null,
    point: null,
    bounds: null,
    canFocus: false,
    reason: null,
    ...partial,
  };
}
const CANNOT_FOCUS_GEOMETRY = "geometry_invalid";
const NOT_FOUND = "entity_not_found";
const NO_GEOMETRY = "no_geometry";

/** Конечные точки стены из nodes или legacy pts. */
function wallPoints(wall, nodes) {
  if (!wall) return [];
  if (wall.a != null && wall.b != null && nodes) {
    const na = nodes[wall.a];
    const nb = nodes[wall.b];
    if (isPt(na) && isPt(nb)) return [{ x: na.x, y: na.y }, { x: nb.x, y: nb.y }];
  }
  if (Array.isArray(wall.pts)) return wall.pts.filter(isPt);
  return [];
}

function findWallUsingNode(walls, nodeId) {
  for (const w of walls) {
    if (w && (w.a === nodeId || w.b === nodeId)) return w;
  }
  return null;
}

export function getDiagnosticFocusTarget(plan, diagnostic) {
  if (!plan || typeof plan !== "object" || !diagnostic) return result({ reason: NOT_FOUND });
  const nodes = plan.nodes && typeof plan.nodes === "object" ? plan.nodes : {};
  const walls = Array.isArray(plan.walls) ? plan.walls : [];
  const items = Array.isArray(plan.items) ? plan.items : [];
  const lines = Array.isArray(plan.lines) ? plan.lines : [];
  const rooms = Array.isArray(plan.rooms) ? plan.rooms : [];
  const zones = Array.isArray(plan.zones) ? plan.zones : [];
  const links = Array.isArray(plan.links) ? plan.links : [];
  const dims = Array.isArray(plan.dimensions) ? plan.dimensions : [];
  const { entityType, entityId } = diagnostic;

  switch (entityType) {
    case "wall": {
      const wall = walls.find((w) => w && w.id === entityId);
      if (!wall) return result({ reason: NOT_FOUND });
      const selection = { coll: "walls", id: wall.id };
      const pts = wallPoints(wall, nodes);
      const bounds = boundsOfPoints(pts);
      if (!bounds) return result({ selection, reason: CANNOT_FOCUS_GEOMETRY });
      return result({ selection, point: centerOfBounds(bounds), bounds, canFocus: true });
    }
    case "node": {
      const coord = nodes[entityId];
      const wall = findWallUsingNode(walls, entityId);
      const selection = wall ? { coll: "walls", id: wall.id } : null;
      if (!isPt(coord)) return result({ selection, reason: CANNOT_FOCUS_GEOMETRY });
      const point = { x: coord.x, y: coord.y };
      return result({ selection, point, bounds: boundsAroundPoint(point), canFocus: true });
    }
    case "opening":
    case "item": {
      const item = items.find((it) => it && it.id === entityId);
      if (!item) return result({ reason: NOT_FOUND });
      const selection = { coll: "items", id: item.id };
      const w = isNum(item.w) ? item.w : 0;
      const h = isNum(item.h) ? item.h : 0;
      if (!isNum(item.x) || !isNum(item.y)) return result({ selection, reason: CANNOT_FOCUS_GEOMETRY });
      const point = { x: item.x + w / 2, y: item.y + h / 2 };
      return result({ selection, point, bounds: boundsAroundPoint(point, Math.max(w, h, 500) / 2 + 200), canFocus: true });
    }
    case "route": {
      const line = lines.find((l) => l && l.id === entityId);
      if (!line) return result({ reason: NOT_FOUND });
      const selection = { coll: "lines", id: line.id };
      const pts = (Array.isArray(line.pts) ? line.pts : (Array.isArray(line.points) ? line.points : [])).filter(isPt);
      const bounds = boundsOfPoints(pts);
      if (!bounds) return result({ selection, reason: CANNOT_FOCUS_GEOMETRY });
      return result({ selection, point: centerOfBounds(bounds), bounds, canFocus: true });
    }
    case "link": {
      const link = links.find((l) => l && l.id === entityId);
      // Связь центрируем по объектам-концам.
      const from = link ? items.find((it) => it && it.id === link.fromId) : null;
      const to = link ? items.find((it) => it && it.id === link.toId) : null;
      const selection = link && link.id != null ? { coll: "links", id: link.id } : null;
      const centers = [];
      for (const it of [from, to]) {
        if (it && isNum(it.x) && isNum(it.y)) centers.push({ x: it.x + (isNum(it.w) ? it.w / 2 : 0), y: it.y + (isNum(it.h) ? it.h / 2 : 0) });
      }
      const bounds = boundsOfPoints(centers);
      if (!bounds) return result({ selection, reason: NO_GEOMETRY });
      return result({ selection, point: centerOfBounds(bounds), bounds, canFocus: true });
    }
    case "room": {
      const room = rooms.find((r) => r && r.id === entityId);
      const zone = zones.find((z) => z && z.id === entityId);
      const poly = (room && Array.isArray(room.polygon) ? room.polygon : (zone && Array.isArray(zone.polygon) ? zone.polygon : [])).filter(isPt);
      const selection = (room || zone) ? { coll: "zones", id: entityId } : null;
      const bounds = boundsOfPoints(poly);
      if (!bounds) return result({ selection, reason: CANNOT_FOCUS_GEOMETRY });
      return result({ selection, point: centerOfBounds(bounds), bounds, canFocus: true });
    }
    case "dimension": {
      // Размеры не входят в существующую selection-модель PlanPage — только центрируем.
      const dim = dims.find((d) => d && d.id === entityId);
      const pts = [];
      if (dim) {
        if (isPt(dim.p1)) pts.push(dim.p1);
        if (isPt(dim.p2)) pts.push(dim.p2);
      }
      const bounds = boundsOfPoints(pts);
      if (!bounds) return result({ reason: dim ? CANNOT_FOCUS_GEOMETRY : NOT_FOUND });
      return result({ point: centerOfBounds(bounds), bounds, canFocus: true });
    }
    case "plan":
    default:
      // Проблемы уровня плана не имеют геометрии.
      return result({ reason: NO_GEOMETRY });
  }
}
