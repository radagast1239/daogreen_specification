import { snap, LINK_RULES } from "./catalog.js";
import {
  findWallIntersections, itemInAnyZone, nearestWallSegment,
} from "./wallGeometry.js";
import { itemHasLinkOfType } from "./linkGeometry.js";

/** Привязка точки к горизонтали/вертикали относительно предыдущей (как в CAD). */
export function orthogonalPoint(from, to, step = 50, snapOn = true) {
  const s = (v) => snap(v, step, snapOn);
  if (!from) return { x: s(to.x), y: s(to.y) };
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  if (dx >= dy) return { x: s(to.x), y: s(from.y) };
  return { x: s(from.x), y: s(to.y) };
}

const BASE_LAYERS = new Set(["room", "zones", "partitions"]);
const COMPOSITE_LAYERS = new Set(["client", "install"]);

/**
 * Прозрачность слоя на холсте.
 * Стены (room) всегда видны. Активный слой — полный цвет. Остальные приглушены или скрыты.
 */
export function layerOpacity(layerId, activeId, visible, display = {}) {
  if (!visible) return 0;
  const { dimInactive = true, hideInactive = false, highlightActive = true } = display;

  if (layerId === "room" || layerId === "partitions") return 1;

  if (activeId === "client") {
    if (layerId === "zones") return 0.25;
    if (COMPOSITE_LAYERS.has(layerId) || layerId === "spec" || layerId === "furn") return 0;
    return layerId === "room" ? 1 : 0.35;
  }

  if (activeId === "install") {
    if (layerId === "spec") return 0;
    return dimInactive ? 0.72 : 0.9;
  }

  if (activeId === "spec") {
    if (BASE_LAYERS.has(layerId)) return 0.4;
    return dimInactive ? 0.2 : 0.35;
  }

  if (layerId === activeId) return highlightActive ? 1 : 0.95;

  if (hideInactive && !BASE_LAYERS.has(layerId) && layerId !== "zones") return 0;

  if (layerId === "zones" && (activeId === "room" || activeId === "partitions")) return 0.35;

  return dimInactive ? 0.22 : 0.45;
}

export function labelsVisible(layerId, activeId, display = {}) {
  if (display.showLabels === false) return false;
  if (activeId === "install" || activeId === "client") return true;
  return layerId === activeId || layerId === "room";
}

export function wallsForLayer(walls, activeId) {
  if (activeId === "partitions") return walls.filter((w) => w.role !== "outer");
  if (activeId === "room") return walls.filter((w) => w.role === "outer");
  return walls;
}

/** Простые предупреждения для панели «Ошибки». */
export function collectPlannerWarnings(plan, sel = null) {
  const warnings = [];
  const racks = plan.items.filter((i) => i.layer === "racks");
  const minPass = 600;
  const zones = plan.zones || [];

  findWallIntersections(plan.walls || []).forEach((h) => {
    warnings.push({
      id: h.id,
      objectIds: [],
      text: "Перегородки пересекаются — проверьте стыковку стен",
    });
  });

  const partitionWalls = (plan.walls || []).filter((w) => w.role !== "outer");
  if (partitionWalls.length >= 2 && zones.length === 0) {
    warnings.push({
      id: "no-zones",
      objectIds: [],
      text: "Нет замкнутых помещений — замкните контур перегородок",
    });
  }

  const wallItems = ["door", "door2", "window"];
  plan.items.forEach((it) => {
    if (!wallItems.includes(it.kind) && !it.wall) return;
    const cx = it.x + it.w / 2;
    const cy = it.y + it.h / 2;
    const seg = nearestWallSegment({ x: cx, y: cy }, plan.walls || [], plan.room, 180);
    if (!seg) {
      warnings.push({ id: `nowall-${it.id}`, objectIds: [it.id], text: `${it.label}: не на стене` });
    }
  });

  if (zones.length > 0) {
    plan.items.forEach((it) => {
      if (it.wall || wallItems.includes(it.kind)) return;
      if (it.layer === "room") return;
      if (!itemInAnyZone(it, zones)) {
        warnings.push({ id: `outside-${it.id}`, objectIds: [it.id], text: `${it.label}: вне помещения` });
      }
    });
  }

  for (let i = 0; i < racks.length; i++) {
    for (let j = i + 1; j < racks.length; j++) {
      const a = racks[i];
      const b = racks[j];
      const gapX = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
      const gapY = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
      if (gapX > 0 && gapY > 0) continue;
      const pass = Math.max(gapX, gapY);
      if (pass > 0 && pass < minPass) {
        warnings.push({
          id: `pass-${a.id}-${b.id}`,
          objectIds: [a.id, b.id],
          text: `Недостаточный проход: ${Math.round(pass)} мм (нужно ≥ ${minPass})`,
        });
      }
    }
  }

  const supplyTanks = plan.items.filter((i) => i.kind === "tank" || i.kind === "tank_waste");
  const links = plan.links || [];
  const hasIrrTarget = plan.items.some((i) => LINK_RULES.irrigation.to.has(i.kind));
  const hasPanel = plan.items.some((i) => i.kind === "panel");

  if (hasIrrTarget) {
    racks.forEach((r) => {
      if (!itemHasLinkOfType(links, r.id, "irrigation")) {
        warnings.push({
          id: `link-irr-${r.id}`,
          objectIds: [r.id],
          text: `${r.label}: нет связи с баком/поливом`,
        });
      }
    });
  }

  if (hasPanel) {
    plan.items.filter((i) => i.kind === "socket" || i.kind === "light_panel").forEach((s) => {
      if (!itemHasLinkOfType(links, s.id, "power", "from")) {
        warnings.push({
          id: `link-pwr-${s.id}`,
          objectIds: [s.id],
          text: `${s.label}: не подключён к щиту`,
        });
      }
    });
  }

  racks.forEach((r) => {
    const nearTank = supplyTanks.some((t) => {
      const cx = t.x + t.w / 2;
      const cy = t.y + t.h / 2;
      return cx >= r.x - 2000 && cx <= r.x + r.w + 2000 && cy >= r.y - 2000 && cy <= r.y + r.h + 2000;
    });
    if (!nearTank && racks.length > 2) {
      warnings.push({
        id: `tank-${r.id}`,
        objectIds: [r.id],
        text: "Нет бака раствора рядом с зоной стеллажей",
      });
    }
  });

  if (sel?.coll === "items") {
    const it = plan.items.find((o) => o.id === sel.id);
    if (it) {
      const overlapsWall = plan.walls.some((w) => wallHitsItem(w, it));
      if (overlapsWall) {
        warnings.push({ id: `wall-${it.id}`, objectIds: [it.id], text: "Объект пересекает перегородку" });
      }
    }
  }

  return warnings;
}

function wallHitsItem(wall, it) {
  for (let i = 1; i < wall.pts.length; i++) {
    const a = wall.pts[i - 1];
    const b = wall.pts[i];
    if (segRectHit(a, b, it, wall.thk / 2)) return true;
  }
  return false;
}

function segRectHit(a, b, it, pad) {
  const rx1 = it.x - pad;
  const ry1 = it.y - pad;
  const rx2 = it.x + it.w + pad;
  const ry2 = it.y + it.h + pad;
  return lineIntersectsRect(a, b, rx1, ry1, rx2, ry2);
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
