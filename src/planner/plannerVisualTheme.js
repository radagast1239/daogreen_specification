/** Цвета объектов и слоёв для SVG-рендера (синхрон с planner-tokens.css). */
import { isRackKind } from "./rackProperties.js";

export const DG_THEME = {
  brand: "#116355",
  wall: "#2f3431",
  wallInner: "#4b504d",
  wallFill: "#ecefed",
  wallFillAlpha: 0.08,
  demolish: "#a5371f",
  window: "#5b7c9d",
  doorArc: "rgba(47, 52, 49, 0.55)",
  dimNormal: "#8f9a94",
  dimActive: "#116355",
  dimError: "#a5371f",
  labelText: "#2f3431",
  labelBorder: "#d9e0dc",
  labelLeader: "#8f9a94",
  rack: "#116355",
  rackFill: 0.05,
  water: "#1f6f8b",
  drain: "#7a5c3e",
  electric: "#a5371f",
  vent: "#6b7d74",
  ac: "#5b7c9d",
  route: "#b9741d",
  trash: "#6d5c52",
  sanitary: "#1f6f8b",
  furniture: "#6b7d74",
  zoneNeutral: "rgba(17, 99, 85, 0.09)",
  zoneClean: "rgba(31, 111, 139, 0.045)",
  zoneDirty: "rgba(122, 92, 62, 0.045)",
  zoneWaste: "rgba(165, 55, 31, 0.045)",
  zoneTech: "rgba(107, 125, 116, 0.045)",
};

const LAYER_COLORS = {
  racks: DG_THEME.rack,
  irrigation: DG_THEME.water,
  supply: DG_THEME.water,
  drain: DG_THEME.drain,
  power: DG_THEME.electric,
  sockets: DG_THEME.electric,
  vent: DG_THEME.vent,
  climate: DG_THEME.ac,
  ac: DG_THEME.ac,
  light: "#b9741d",
  furn: DG_THEME.furniture,
  sanitary: DG_THEME.sanitary,
  staff: DG_THEME.route,
  water: DG_THEME.water,
};

const KIND_COLORS = {
  tank: DG_THEME.water,
  tank_waste: DG_THEME.trash,
  tank_acid: DG_THEME.demolish,
  pump: DG_THEME.water,
  osmosis: DG_THEME.rack,
  water_prep: DG_THEME.water,
  fridge: DG_THEME.ac,
  freezer: DG_THEME.ac,
  ac_indoor: DG_THEME.ac,
  ac_outdoor: DG_THEME.ac,
  fan: DG_THEME.vent,
  fan_round: DG_THEME.vent,
  vent: DG_THEME.vent,
  vent_duct: DG_THEME.vent,
  panel: DG_THEME.electric,
  socket: DG_THEME.electric,
  light: "#b9741d",
  sink_single: DG_THEME.sanitary,
  sink_double: DG_THEME.sanitary,
  toilet: DG_THEME.sanitary,
  shower: DG_THEME.sanitary,
  trap: DG_THEME.sanitary,
  person: DG_THEME.route,
  bin_trash: DG_THEME.trash,
  trashcan: DG_THEME.trash,
};

/** Цвет контура глифа по типу объекта / слою. */
export function glyphColorForItem(it) {
  if (!it) return "#3d4a46";
  if (isRackKind(it.kind)) return DG_THEME.rack;
  if (KIND_COLORS[it.kind]) return KIND_COLORS[it.kind];
  if (it.layer && LAYER_COLORS[it.layer]) return LAYER_COLORS[it.layer];
  return it.color || "#3d4a46";
}

/** Заливка глифа — слабая, без ярких пятен. */
export function glyphFillOpacityForItem(it) {
  if (isRackKind(it.kind)) return 0.07;
  if (["tank", "tank_waste", "tank_acid"].includes(it.kind)) return 0.06;
  if (["sink_single", "sink_double", "sink_susp", "sink_table", "toilet", "shower_pan", "trap"].includes(it.kind)) {
    return 0.05;
  }
  if (["fridge", "freezer", "ac_indoor", "ac_out"].includes(it.kind)) return 0.06;
  return 0.05;
}
