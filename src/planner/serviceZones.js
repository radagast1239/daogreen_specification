/** Сервисные зоны объектов — профили по типам (блок 8). */

import { isDoorKind } from "./doorTypes.js";
import { doorSwingPolygon } from "./doorGeometry.js";

export const ZONE_VIS = {
  service: { fill: "#116355", stroke: "#116355", fillOpacity: 0.06, label: "Обслуживание" },
  access: { fill: "#b9741d", stroke: "#b9741d", fillOpacity: 0.07, label: "Доступ персонала" },
  swing: { fill: "#1f6f8b", stroke: "#1f6f8b", fillOpacity: 0.08, label: "Зона открывания" },
  flow: { fill: "#6b7d74", stroke: "#6b7d74", fillOpacity: 0.06, label: "Поток воздуха" },
};

/** Профили зон по типу объекта (мм). */
export const SERVICE_ZONE_PROFILES = {
  rack: {
    label: "Стеллаж",
    defaults: { enabled: true, front: 900, back: 700, left: 250, right: 250, access: 900 },
    hints: { front: "Проход спереди", back: "Проход сзади", left: "Зазор от стены", right: "Зазор от стены" },
  },
  seed_rack: {
    label: "Рассадный стеллаж",
    defaults: { enabled: true, front: 800, back: 600, left: 250, right: 250, access: 800 },
    hints: { front: "Проход спереди", back: "Проход сзади" },
  },
  shelf_cons: {
    label: "Стеллаж расходников",
    defaults: { enabled: true, front: 700, back: 500, left: 200, right: 200, access: 700 },
  },
  shelf_inv: {
    label: "Стеллаж инвентаря",
    defaults: { enabled: true, front: 700, back: 500, left: 200, right: 200, access: 700 },
  },
  tank: {
    label: "Бак",
    defaults: { enabled: true, front: 700, back: 600, left: 500, right: 500, access: 800 },
    hints: { front: "Крышка / доступ", back: "Патрубки", left: "Обслуживание", right: "Обслуживание" },
  },
  tank_waste: {
    label: "Бак для мусора",
    defaults: { enabled: true, front: 600, back: 500, left: 400, right: 400, access: 700 },
  },
  pump: {
    label: "Насос",
    defaults: { enabled: true, front: 600, back: 500, left: 400, right: 400, access: 600 },
    hints: { front: "Доступ к насосу" },
  },
  osmosis: {
    label: "Осмос",
    defaults: { enabled: true, front: 800, back: 600, left: 500, right: 500, access: 800 },
  },
  water_prep: {
    label: "Водоподготовка",
    defaults: { enabled: true, front: 800, back: 600, left: 500, right: 500, access: 800 },
  },
  fridge: {
    label: "Холодильник",
    defaults: { enabled: true, front: 1000, back: 150, left: 100, right: 100, access: 1000 },
    hints: { front: "Открывание двери / загрузка" },
  },
  freezer: {
    label: "Морозилка",
    defaults: { enabled: true, front: 1000, back: 150, left: 100, right: 100, access: 1000 },
  },
  panel: {
    label: "Электрощит",
    defaults: { enabled: true, front: 1200, back: 0, left: 0, right: 0, access: 1200 },
    hints: { front: "Свободная зона перед щитом" },
  },
  sink_susp: {
    label: "Раковина",
    defaults: { enabled: true, front: 800, back: 0, left: 0, right: 0, access: 800 },
    hints: { front: "Зона подхода" },
  },
  sink_table: {
    label: "Раковина на столе",
    defaults: { enabled: true, front: 800, back: 0, left: 0, right: 0, access: 800 },
  },
  sink_double: {
    label: "Двойная раковина",
    defaults: { enabled: true, front: 900, back: 0, left: 0, right: 0, access: 900 },
  },
  toilet: {
    label: "Унитаз",
    defaults: { enabled: true, front: 700, back: 200, left: 200, right: 200, access: 700 },
  },
  shower_pan: {
    label: "Душевой поддон",
    defaults: { enabled: true, front: 700, back: 0, left: 0, right: 0, access: 700 },
  },
  ac_indoor: {
    label: "Кондиционер внутр.",
    defaults: { enabled: true, front: 600, back: 400, left: 300, right: 300, access: 600 },
    hints: { front: "Фильтр / обслуживание", back: "Выброс воздуха" },
  },
  ac_outdoor: {
    label: "Кондиционер наружн.",
    defaults: { enabled: true, front: 1000, back: 800, left: 500, right: 500, access: 1000 },
  },
  ac_floor: {
    label: "Напольный кондиционер",
    defaults: { enabled: true, front: 800, back: 400, left: 300, right: 300, access: 800 },
  },
  vent_unit: {
    label: "Вентблок",
    defaults: { enabled: true, front: 700, back: 500, left: 400, right: 400, access: 700 },
  },
  blade_fan: {
    label: "Вентилятор",
    defaults: { enabled: true, front: 800, back: 400, left: 300, right: 300, access: 600, flow: 1200 },
    hints: { front: "Обслуживание", flow: "Направление потока" },
  },
  recirc: {
    label: "Рециркулятор",
    defaults: { enabled: true, front: 500, back: 300, left: 200, right: 200, access: 500 },
  },
  trolley: {
    label: "Тележка",
    defaults: { enabled: true, front: 700, back: 700, left: 300, right: 300, access: 700 },
  },
  table_sow: {
    label: "Стол посева",
    defaults: { enabled: true, front: 800, back: 500, left: 300, right: 300, access: 800 },
  },
  table_recv: {
    label: "Стол приёмки",
    defaults: { enabled: true, front: 800, back: 500, left: 300, right: 300, access: 800 },
  },
};

const DOOR_KINDS_WITH_SWING = new Set([
  "door_single", "door_double", "door_pend", "door_cold", "door_san", "door_dirty", "door_tech", "door_gate",
]);

function rotatePt(cx, cy, px, py, rad) {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: cx + (px - cx) * cos - (py - cy) * sin,
    y: cy + (px - cx) * sin + (py - cy) * cos,
  };
}

function zoneRectWorld(it, side, depth, zoneType = "service") {
  if (!depth || depth <= 0) return null;
  const { x, y, w, h } = it;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rad = ((it.angle || 0) * Math.PI) / 180;
  let lx;
  let ly;
  let lw;
  let lh;
  switch (side) {
    case "front": lx = 0; ly = h; lw = w; lh = depth; break;
    case "back": lx = 0; ly = -depth; lw = w; lh = depth; break;
    case "left": lx = -depth; ly = 0; lw = depth; lh = h; break;
    case "right": lx = w; ly = 0; lw = depth; lh = h; break;
    default: return null;
  }
  const corners = [
    rotatePt(cx, cy, x + lx, y + ly, rad),
    rotatePt(cx, cy, x + lx + lw, y + ly, rad),
    rotatePt(cx, cy, x + lx + lw, y + ly + lh, rad),
    rotatePt(cx, cy, x + lx, y + ly + lh, rad),
  ];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  return {
    id: side,
    type: zoneType,
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
    polygon: corners,
  };
}

function flowZoneWorld(it, depth) {
  if (!depth || depth <= 0) return null;
  const front = zoneRectWorld(it, "front", depth, "flow");
  return front ? { ...front, id: "flow" } : null;
}

export function serviceZoneProfile(kind) {
  return SERVICE_ZONE_PROFILES[kind] || null;
}

export function defaultServiceZoneForKind(kind) {
  const p = SERVICE_ZONE_PROFILES[kind];
  if (p) return { ...p.defaults };
  if (isDoorKind(kind)) {
    return { enabled: DOOR_KINDS_WITH_SWING.has(kind), swing: true, front: 0, back: 0, left: 0, right: 0, access: 0 };
  }
  return { enabled: false, front: 0, back: 0, left: 0, right: 0, access: 0 };
}

/** Все зоны объекта: прямоугольники и полигоны. */
export function serviceZoneElements(it) {
  if (isDoorKind(it.kind)) {
    if (it.serviceZone?.enabled === false) return [];
    if (it.kind === "door_slide") return [];
    if (!DOOR_KINDS_WITH_SWING.has(it.kind) && it.serviceZone?.swing === false) return [];
    const poly = doorSwingPolygon(it);
    if (poly.length < 3) return [];
    const xs = poly.map((p) => p.x);
    const ys = poly.map((p) => p.y);
    return [{
      id: "swing",
      type: "swing",
      polygon: poly,
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    }];
  }

  const sz = it.serviceZone;
  if (!sz?.enabled) return [];

  const access = Math.max(it.accessZoneMm || 0, sz.access || 0);
  const out = [];
  const frontDepth = Math.max(sz.front || 0, access);
  if (frontDepth > 0) {
    out.push(zoneRectWorld(it, "front", frontDepth, access > (sz.front || 0) ? "access" : "service"));
  } else if (sz.front > 0) {
    out.push(zoneRectWorld(it, "front", sz.front, "service"));
  }
  ["back", "left", "right"].forEach((side) => {
    const r = zoneRectWorld(it, side, sz[side] || 0, "service");
    if (r) out.push(r);
  });
  if (sz.flow > 0) {
    const f = flowZoneWorld(it, sz.flow);
    if (f) out.push(f);
  }
  return out;
}

/** @deprecated */
export function serviceZoneRects(it) {
  return serviceZoneElements(it).filter((z) => z.polygon?.length === 4 || (!z.polygon && z.w > 0));
}

function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    if (((yi > p.y) !== (yj > p.y)) && (p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function zoneHitsBox(zone, box, gap = 40) {
  if (zone.polygon?.length >= 3) {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    if (pointInPolygon({ x: cx, y: cy }, zone.polygon)) return true;
    const corners = [
      { x: box.x, y: box.y },
      { x: box.x + box.w, y: box.y },
      { x: box.x + box.w, y: box.y + box.h },
      { x: box.x, y: box.y + box.h },
    ];
    if (corners.some((c) => pointInPolygon(c, zone.polygon))) return true;
  }
  const a = zone;
  const b = box;
  return !(
    a.x + a.w + gap <= b.x ||
    b.x + b.w + gap <= a.x ||
    a.y + a.h + gap <= b.y ||
    b.y + b.h + gap <= a.y
  );
}

export function findServiceZoneCollisions(plan) {
  const warnings = [];
  const items = plan.items || [];
  items.forEach((it) => {
    const zones = serviceZoneElements(it);
    if (!zones.length) return;
    items.forEach((other) => {
      if (other.id === it.id || other.layer === "room") return;
      const ob = { x: other.x, y: other.y, w: other.w, h: other.h };
      zones.forEach((z) => {
        if (zoneHitsBox(z, ob)) {
          const vis = ZONE_VIS[z.type] || ZONE_VIS.service;
          warnings.push({
            id: `svc-${it.id}-${other.id}-${z.id}`,
            objectIds: [it.id, other.id],
            text: `${it.label}: ${vis.label.toLowerCase()} (${z.id}) пересекает «${other.label}»`,
          });
        }
      });
    });
  });
  return warnings;
}
