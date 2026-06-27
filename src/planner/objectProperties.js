/** Свойства объектов планировщика: статусы, порты, сервисные зоны. */

import {
  defaultServiceZoneForKind,
  serviceZoneProfile,
  serviceZoneElements,
  serviceZoneRects,
  findServiceZoneCollisions,
  SERVICE_ZONE_PROFILES,
  ZONE_VIS,
} from "./serviceZones.js";

export {
  defaultServiceZoneForKind as defaultServiceZone,
  serviceZoneProfile,
  serviceZoneElements,
  serviceZoneRects,
  findServiceZoneCollisions,
  SERVICE_ZONE_PROFILES,
  ZONE_VIS,
};

export const OBJECT_STATUSES = {
  draft: { label: "Черновик", color: "#8f9a94" },
  review: { label: "На проверке", color: "#b9741d" },
  approved: { label: "Утверждено", color: "#116355" },
  excluded: { label: "Исключено", color: "#a5371f" },
  replacement: { label: "Замена", color: "#8a7a9c" },
};

export const PORT_TYPES = {
  water: { label: "Вода", color: "#1f6f8b", short: "H₂O" },
  drain: { label: "Слив", color: "#7a5c3e", short: "↓" },
  power: { label: "Электрика", color: "#a5371f", short: "⚡" },
  air: { label: "Воздух", color: "#6b7d74", short: "A" },
  control: { label: "Управление", color: "#5a5f5c", short: "C" },
};

export const PORT_SIDES = [
  { id: "front", label: "Спереди" },
  { id: "back", label: "Сзади" },
  { id: "left", label: "Слева" },
  { id: "right", label: "Справа" },
];

const KIND_PORTS = {
  rack: ["water", "drain", "power"],
  seed_rack: ["water", "power"],
  pump: ["water", "power"],
  tank: ["water", "drain"],
  tank_waste: [],
  osmosis: ["water", "drain"],
  water_prep: ["water"],
  panel: ["power", "control"],
  socket: ["power"],
  light_panel: ["power"],
  sink_susp: ["water", "drain"],
  sink_table: ["water", "drain"],
  sink_double: ["water", "drain"],
  toilet: ["drain"],
  bidet: ["water", "drain"],
  shower_pan: ["drain"],
  shower_sys: ["water", "drain"],
  trap: ["drain"],
  fridge: ["power"],
  freezer: ["power"],
  ac_indoor: ["air", "drain", "power"],
  ac_outdoor: ["air", "power"],
  ac_floor: ["air", "power"],
  vent_unit: ["air", "power"],
  blade_fan: ["air", "power"],
  recirc: ["power"],
  table_sow: ["water"],
  table_recv: ["control"],
  trolley: ["control"],
};

export function defaultPortsForKind(kind) {
  const types = KIND_PORTS[kind] || [];
  const sideByType = {
    water: "back",
    drain: "back",
    power: "back",
    air: "front",
    control: "right",
  };
  return types.map((type, i) => ({
    type,
    side: sideByType[type] || "back",
    offset: 0.25 + (i * 0.5) / Math.max(types.length, 1),
  }));
}

export function defaultObjectPropertyFields(kind) {
  const sz = defaultServiceZoneForKind(kind);
  return {
    locked: false,
    objectStatus: "draft",
    mountHeightMm: 0,
    weightKg: "",
    floorLoadKg: "",
    serviceZone: sz,
    accessZoneMm: sz.access || 0,
    commentInternal: "",
    commentClient: "",
    commentInstall: "",
    photoUrl: "",
    externalUrl: "",
    supplier: "",
    specUnit: "шт.",
    ports: defaultPortsForKind(kind),
  };
}

export function objectStatusStyle(status) {
  return OBJECT_STATUSES[status] || OBJECT_STATUSES.draft;
}

export function portPosition(it, port) {
  const { w, h } = it;
  const t = Math.max(0.05, Math.min(0.95, port.offset ?? 0.5));
  let lx;
  let ly;
  let nx = 0;
  let ny = 0;
  switch (port.side) {
    case "front": lx = -w / 2 + w * t; ly = h / 2; ny = 1; break;
    case "back": lx = -w / 2 + w * t; ly = -h / 2; ny = -1; break;
    case "left": lx = -w / 2; ly = -h / 2 + h * t; nx = -1; break;
    case "right": lx = w / 2; ly = -h / 2 + h * t; nx = 1; break;
    default: lx = 0; ly = h / 2; ny = 1;
  }
  const ang = ((it.angle || 0) * Math.PI) / 180;
  const cx = it.x + w / 2;
  const cy = it.y + h / 2;
  const rx = lx * Math.cos(ang) - ly * Math.sin(ang);
  const ry = lx * Math.sin(ang) + ly * Math.cos(ang);
  const rnx = nx * Math.cos(ang) - ny * Math.sin(ang);
  const rny = nx * Math.sin(ang) + ny * Math.cos(ang);
  return { x: cx + rx, y: cy + ry, nx: rnx, ny: rny };
}
