/** Свойства объектов планировщика: статусы, порты, сервисные зоны. */

import {
  defaultServiceZoneForKind,
  serviceZoneProfile,
  serviceZoneElements,
  serviceZoneRects,
  findServiceZoneCollisions,
  resolveServiceZone,
  isServiceZoneEnabled,
  SERVICE_ZONE_PROFILES,
  ZONE_VIS,
} from "./serviceZones.js";
import { defaultAcMountHeightMm } from "./acProperties.js";

export {
  defaultServiceZoneForKind as defaultServiceZone,
  serviceZoneProfile,
  serviceZoneElements,
  serviceZoneRects,
  findServiceZoneCollisions,
  resolveServiceZone,
  isServiceZoneEnabled,
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
  inlet: { label: "Вход", color: "#1f6f8b", short: "IN" },
  outlet: { label: "Выход", color: "#116355", short: "OUT" },
  overflow: { label: "Перелив", color: "#7a5c3e", short: "OF" },
  branch: { label: "Врезка", color: "#2f6f8f", short: "BR" },
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
  lighting_group: ["power", "control"],
  cable_tray: ["power"],
  junction_box: ["power", "control"],
  switch: ["power", "control"],
  sensor: ["power", "control"],
  relay_box: ["power", "control"],
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
  air_conditioner: ["air", "power", "control"],
  dehumidifier: ["air", "drain", "power"],
  humidifier: ["air", "water", "power"],
  climate_controller: ["control", "power"],
  temperature_sensor: ["control", "power"],
  humidity_sensor: ["control", "power"],
  co2_sensor: ["control", "power"],
  air_quality_sensor: ["control", "power"],
  dew_point_sensor: ["control", "power"],
  pressure_sensor: ["control", "power"],
  supply: ["air"],
  exhaust: ["air"],
  duct_damper: ["air"],
  vent_unit: ["air", "power"],
  blade_fan: ["air", "power"],
  recirc: ["power"],
  table_sow: ["water"],
  table_recv: ["control"],
  trolley: ["control"],
  water_valve: ["water"],
};

const KIND_CONNECTION_PORTS = {
  rack: [
    { id: "in", name: "Inlet", type: "inlet", side: "left", offset: 0.35, direction: "left", diameterMm: 20, system: "irrigation" },
    { id: "out", name: "Return", type: "outlet", side: "right", offset: 0.35, direction: "right", diameterMm: 20, system: "irrigation" },
    { id: "dr", name: "Drain", type: "drain", side: "right", offset: 0.7, direction: "right", diameterMm: 32, system: "drainage" },
  ],
  seed_rack: [
    { id: "in", name: "Inlet", type: "inlet", side: "left", offset: 0.35, direction: "left", diameterMm: 20, system: "irrigation" },
    { id: "out", name: "Return", type: "outlet", side: "right", offset: 0.35, direction: "right", diameterMm: 20, system: "irrigation" },
  ],
  tank: [
    { id: "out", name: "Outlet", type: "outlet", side: "right", offset: 0.35, direction: "right", diameterMm: 32, system: "irrigation" },
    { id: "in", name: "Inlet", type: "inlet", side: "left", offset: 0.35, direction: "left", diameterMm: 32, system: "clean_water" },
    { id: "dr", name: "Drain", type: "drain", side: "left", offset: 0.75, direction: "left", diameterMm: 50, system: "drainage" },
    { id: "ov", name: "Overflow", type: "overflow", side: "right", offset: 0.75, direction: "right", diameterMm: 50, system: "waste" },
  ],
  tank_waste: [
    { id: "dr", name: "Drain", type: "drain", side: "left", offset: 0.5, direction: "left", diameterMm: 50, system: "drainage" },
    { id: "ov", name: "Overflow", type: "overflow", side: "right", offset: 0.5, direction: "right", diameterMm: 50, system: "waste" },
  ],
  pump: [
    { id: "in", name: "Inlet", type: "inlet", side: "left", offset: 0.5, direction: "left", diameterMm: 32, system: "irrigation" },
    { id: "out", name: "Outlet", type: "outlet", side: "right", offset: 0.5, direction: "right", diameterMm: 32, system: "irrigation" },
  ],
  osmosis: [
    { id: "in", name: "Inlet", type: "inlet", side: "left", offset: 0.5, direction: "left", diameterMm: 25, system: "clean_water" },
    { id: "out", name: "Outlet", type: "outlet", side: "right", offset: 0.5, direction: "right", diameterMm: 20, system: "clean_water" },
    { id: "dr", name: "Drain", type: "drain", side: "right", offset: 0.75, direction: "right", diameterMm: 32, system: "waste" },
  ],
  water_prep: [
    { id: "in", name: "Inlet", type: "inlet", side: "left", offset: 0.4, direction: "left", diameterMm: 25, system: "clean_water" },
    { id: "out", name: "Outlet", type: "outlet", side: "right", offset: 0.4, direction: "right", diameterMm: 25, system: "irrigation" },
  ],
  water_valve: [
    { id: "in", name: "Inlet", type: "inlet", side: "left", offset: 0.5, direction: "left", diameterMm: 32, system: "irrigation" },
    { id: "out", name: "Outlet", type: "outlet", side: "right", offset: 0.5, direction: "right", diameterMm: 32, system: "irrigation" },
  ],
  panel: [
    { id: "in", name: "Input", type: "inlet", side: "left", offset: 0.5, direction: "left", diameterMm: 25, system: "power" },
    { id: "out", name: "Output", type: "outlet", side: "right", offset: 0.5, direction: "right", diameterMm: 25, system: "power" },
  ],
  socket: [
    { id: "pwr", name: "Power", type: "branch", side: "back", offset: 0.5, direction: "back", diameterMm: 16, system: "power" },
  ],
  light_panel: [
    { id: "pwr", name: "Power", type: "inlet", side: "back", offset: 0.5, direction: "back", diameterMm: 16, system: "power" },
  ],
  cable_tray: [
    { id: "in", name: "Cable In", type: "inlet", side: "left", offset: 0.5, direction: "left", diameterMm: 25, system: "power" },
    { id: "out", name: "Cable Out", type: "outlet", side: "right", offset: 0.5, direction: "right", diameterMm: 25, system: "power" },
  ],
  junction_box: [
    { id: "in", name: "Input", type: "inlet", side: "left", offset: 0.5, direction: "left", diameterMm: 20, system: "power" },
    { id: "out", name: "Output", type: "outlet", side: "right", offset: 0.5, direction: "right", diameterMm: 20, system: "power" },
    { id: "ctrl", name: "Control", type: "branch", side: "back", offset: 0.5, direction: "back", diameterMm: 12, system: "control" },
  ],
  switch: [
    { id: "in", name: "Input", type: "inlet", side: "left", offset: 0.5, direction: "left", diameterMm: 16, system: "power" },
    { id: "out", name: "Output", type: "outlet", side: "right", offset: 0.5, direction: "right", diameterMm: 16, system: "power" },
  ],
  sensor: [
    { id: "pwr", name: "Power", type: "inlet", side: "left", offset: 0.4, direction: "left", diameterMm: 12, system: "power" },
    { id: "ctrl", name: "Control", type: "branch", side: "right", offset: 0.6, direction: "right", diameterMm: 8, system: "control" },
  ],
  relay_box: [
    { id: "in", name: "Input", type: "inlet", side: "left", offset: 0.45, direction: "left", diameterMm: 20, system: "power" },
    { id: "out", name: "Output", type: "outlet", side: "right", offset: 0.45, direction: "right", diameterMm: 20, system: "power" },
    { id: "ctrl", name: "Control", type: "branch", side: "right", offset: 0.75, direction: "right", diameterMm: 10, system: "control" },
  ],
  ac_indoor: [
    { id: "air-in", name: "Air in", type: "inlet", side: "left", offset: 0.5, direction: "left", diameterMm: 200, system: "air" },
    { id: "air-out", name: "Air out", type: "outlet", side: "right", offset: 0.5, direction: "right", diameterMm: 200, system: "air" },
  ],
  ac_outdoor: [
    { id: "air", name: "Air", type: "branch", side: "front", offset: 0.5, direction: "front", diameterMm: 250, system: "air" },
  ],
  vent_unit: [
    { id: "in", name: "Inlet", type: "inlet", side: "left", offset: 0.45, direction: "left", diameterMm: 250, system: "air" },
    { id: "out", name: "Outlet", type: "outlet", side: "right", offset: 0.45, direction: "right", diameterMm: 250, system: "air" },
  ],
  blade_fan: [
    { id: "air", name: "Air", type: "branch", side: "front", offset: 0.5, direction: "front", diameterMm: 200, system: "air" },
  ],
  recirc: [
    { id: "air", name: "Air", type: "branch", side: "front", offset: 0.5, direction: "front", diameterMm: 200, system: "air" },
  ],
  supply: [
    { id: "air", name: "Supply", type: "outlet", side: "front", offset: 0.5, direction: "front", diameterMm: 200, system: "air" },
  ],
  exhaust: [
    { id: "air", name: "Exhaust", type: "inlet", side: "front", offset: 0.5, direction: "front", diameterMm: 200, system: "air" },
  ],
  duct_damper: [
    { id: "in", name: "Inlet", type: "inlet", side: "left", offset: 0.5, direction: "left", diameterMm: 200, system: "air" },
    { id: "out", name: "Outlet", type: "outlet", side: "right", offset: 0.5, direction: "right", diameterMm: 200, system: "air" },
  ],
  dew_point_sensor: [
    { id: "pwr", name: "Power", type: "inlet", side: "left", offset: 0.4, direction: "left", diameterMm: 12, system: "power" },
    { id: "ctrl", name: "Control", type: "branch", side: "right", offset: 0.6, direction: "right", diameterMm: 8, system: "control" },
  ],
  pressure_sensor: [
    { id: "pwr", name: "Power", type: "inlet", side: "left", offset: 0.4, direction: "left", diameterMm: 12, system: "power" },
    { id: "ctrl", name: "Control", type: "branch", side: "right", offset: 0.6, direction: "right", diameterMm: 8, system: "control" },
  ],
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

export function defaultConnectionPortsForKind(kind) {
  const base = KIND_CONNECTION_PORTS[kind];
  if (base?.length) {
    return base.map((p) => ({ ...p }));
  }
  const legacy = defaultPortsForKind(kind);
  return legacy.map((port, i) => ({
    id: `${kind || "obj"}-${i + 1}`,
    name: port.type || `Port ${i + 1}`,
    type: port.type || "inlet",
    side: port.side || "back",
    offset: port.offset ?? 0.5,
    direction: port.side || "back",
    diameterMm: 32,
    system: port.type === "drain" ? "drainage" : port.type === "air" ? "air" : port.type === "power" ? "power" : "irrigation",
  }));
}

export function defaultObjectPropertyFields(kind) {
  const sz = defaultServiceZoneForKind(kind);
  const connectionPorts = defaultConnectionPortsForKind(kind);
  return {
    locked: false,
    objectStatus: "draft",
    mountHeightMm: defaultAcMountHeightMm(kind),
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
    ports: connectionPorts.map((p) => ({ ...p })),
    connectionPorts,
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
