import { pointInZone } from "./wallGeometry.js";
import { itemHasLinkOfType, linksForItem } from "./linkGeometry.js";

/** Типы зонирования по чистоте потока. */
export const ZONE_FLOW = {
  neutral: { label: "Обычная", color: "#8a7a9c", fill: 0.05 },
  clean:   { label: "Чистая зона", color: "#116355", fill: 0.07 },
  dirty:   { label: "Грязная зона", color: "#7a5c3e", fill: 0.07 },
  buffer:  { label: "Буфер / санпропускник", color: "#9c6b9c", fill: 0.08 },
};

const DIRTY_KINDS = new Set([
  "trashcan", "tank_waste", "toilet", "bidet", "trap",
  "sink_susp", "sink_table", "sink_double", "shower_pan", "shower_sys",
]);

const CLEAN_KINDS = new Set([
  "rack", "seed_rack", "table_sow", "table_recv", "table_manip", "table_subs",
  "trolley", "osmosis", "water_prep", "tank", "pump",
]);

/** Ориентировочная мощность объекта, Вт. */
const POWER_W = {
  rack: 900,
  seed_rack: 700,
  pump: 450,
  light_panel: 180,
  socket: 120,
  panel: 0,
  ac_indoor: 2500,
  ac_outdoor: 3200,
  fridge: 350,
  freezer: 500,
  recirc: 80,
  vent_unit: 800,
  blade_fan: 400,
};

export function itemPowerW(item) {
  if (item.powerW != null && item.powerW !== "") return Math.max(0, +item.powerW || 0);
  return POWER_W[item.kind] || 0;
}

export function panelCapacityW(panel) {
  if (!panel) return 0;
  if (panel.powerW != null && panel.powerW !== "") return Math.max(0, +panel.powerW || 0);
  return panel.params?.ratedW || 22000;
}

export function zoneAtPoint(plan, pt) {
  return (plan.zones || []).find((z) => pointInZone(pt, z)) || null;
}

export function zoneForItem(plan, item) {
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  return zoneAtPoint(plan, { x: cx, y: cy });
}

function distPt(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function itemCenter(it) {
  return { x: it.x + it.w / 2, y: it.y + it.h / 2 };
}

/** Предупреждения фермерской логики: чистый/грязный поток, дизковрик, мощность. */
export function collectFarmWarnings(plan) {
  const warnings = [];
  const zones = plan.zones || [];
  const items = plan.items || [];
  const links = plan.links || [];

  const cleanZones = zones.filter((z) => z.flow === "clean");
  const dirtyZones = zones.filter((z) => z.flow === "dirty");
  const hasFlowZones = cleanZones.length > 0 || dirtyZones.length > 0;

  if (hasFlowZones) {
    items.forEach((it) => {
      if (it.layer === "room") return;
      const z = zoneForItem(plan, it);
      if (!z?.flow || z.flow === "neutral" || z.flow === "buffer") return;
      if (z.flow === "clean" && DIRTY_KINDS.has(it.kind)) {
        warnings.push({
          id: `flow-dirty-in-clean-${it.id}`,
          objectIds: [it.id],
          text: `${it.label}: грязный объект в чистой зоне «${z.name}»`,
        });
      }
      if (z.flow === "dirty" && CLEAN_KINDS.has(it.kind)) {
        warnings.push({
          id: `flow-clean-in-dirty-${it.id}`,
          objectIds: [it.id],
          text: `${it.label}: производственный объект в грязной зоне «${z.name}»`,
        });
      }
    });

    const dezmats = items.filter((i) => i.kind === "dezmat");
    if (cleanZones.length && dirtyZones.length && !dezmats.length) {
      warnings.push({
        id: "no-dezmat",
        objectIds: [],
        text: "Есть чистая и грязная зоны — нужен дизинфекционный коврик на границе",
      });
    }

    const doors = items.filter((i) => i.kind === "door" || i.kind === "door2");
    if (cleanZones.length && dirtyZones.length && dezmats.length) {
      const doorOnBoundary = doors.some((door) => {
        const c = itemCenter(door);
        const zc = zoneAtPoint(plan, c);
        if (!zc) return false;
        const nearDirty = dirtyZones.some((dz) => distPt(c, { x: dz.x + dz.w / 2, y: dz.y + dz.h / 2 }) < 2500);
        const nearClean = cleanZones.some((cz) => distPt(c, { x: cz.x + cz.w / 2, y: cz.y + cz.h / 2 }) < 2500);
        return nearDirty && nearClean;
      });
      if (doorOnBoundary) {
        const ok = dezmats.some((dm) => doors.some((d) => distPt(itemCenter(dm), itemCenter(d)) < 1800));
        if (!ok) {
          warnings.push({
            id: "dezmat-far",
            objectIds: dezmats.map((d) => d.id),
            text: "Дизковрик далеко от двери между чистой и грязной зоной (нужно ≤ 1800 мм)",
          });
        }
      }
    }
  }

  const panels = items.filter((i) => i.kind === "panel");
  if (panels.length) {
    const powered = items.filter((i) => {
      if (i.kind === "panel") return false;
      const w = itemPowerW(i);
      if (!w) return false;
      return linksForItem(links, i.id).some((l) => l.type === "power") || ["rack", "seed_rack", "pump", "light_panel"].includes(i.kind);
    });
    const totalW = powered.reduce((s, it) => s + itemPowerW(it), 0);
    const capW = panels.reduce((s, p) => s + panelCapacityW(p), 0);
    if (capW > 0 && totalW > capW * 0.85) {
      warnings.push({
        id: "power-over",
        objectIds: [...panels.map((p) => p.id), ...powered.map((p) => p.id)],
        text: `Нагрузка ~${Math.round(totalW / 1000)} кВт при ёмкости щита ~${Math.round(capW / 1000)} кВт (запас < 15%)`,
      });
    }
    powered.forEach((it) => {
      if (!itemHasLinkOfType(links, it.id, "power") && itemPowerW(it) >= 400) {
        warnings.push({
          id: `power-nolink-${it.id}`,
          objectIds: [it.id],
          text: `${it.label}: нет связи с щитом (нагрузка ${itemPowerW(it)} Вт)`,
        });
      }
    });
  }

  const racks = items.filter((i) => i.kind === "rack" || i.kind === "seed_rack");
  racks.forEach((r) => {
    if (r.specMode === "projectSection" || r.includedInProject === false) return;
    if (!r.specModuleName && !r.specSourceSection) {
      warnings.push({
        id: `rack-spec-${r.id}`,
        objectIds: [r.id],
        text: `${r.label}: не привязан комплект спецификации`,
      });
    }
  });

  return warnings;
}

export const PDF_LEGEND = [
  { icon: "rack_nft", label: "Стеллаж NFT", color: "#116355" },
  { icon: "tank_round", label: "Ёмкость полива", color: "#1f6f8b" },
  { icon: "pump_inline", label: "Насос", color: "#b9741d" },
  { icon: "panel", label: "Электрощит", color: "#a5371f" },
  { icon: "socket", label: "Розетка", color: "#c44a2f" },
  { icon: "dezmat", label: "Дизковрик", color: "#9c6b9c" },
  { icon: "door", label: "Дверь", color: "#2f3431" },
  { icon: "sink_single", label: "Раковина", color: "#2f6f8f" },
];
