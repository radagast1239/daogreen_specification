/**
 * Конфиг отрисовки узнаваемых объектов сверху.
 * Контур — цвет слоя/объекта, заливка 0.04–0.08, линии стабильны через k = 1/zoom.
 */
import { catalogByKind } from "./catalog.js";
import { isRackKind, rackIconForType } from "./rackProperties.js";
import { glyphColorForItem, glyphFillOpacityForItem } from "./plannerVisualTheme.js";

/** @deprecated — используйте DG_THEME.brand */
export const GLYPH_BRAND = "#116355";

/** Иконки с детальной отрисовкой в icons.jsx */
const GLYPH_ICONS = new Set([
  "rack_nft", "rack", "rack_flood", "rack_seedling", "rack_strawberry", "rack_shelf", "rack_aero",
  "table_sowing", "table_receiving", "table_packaging", "table",
  "tank_round", "tank", "tank_waste",
  "pump_inline", "pump",
  "osmosis_filters", "osmosis",
  "sink_single", "sink_double",
  "toilet", "bidet", "shower", "showerhead", "trap",
  "fridge", "freezer",
  "trolley_plant", "trolley",
  "scales_floor", "scales_bench",
  "ac_indoor", "ac_out",
  "fan_round", "fan", "vent", "vent_duct",
  "chair", "bench", "wardrobe", "hanger", "notebook", "ladder",
  "dezmat", "recirc", "dispenser", "mirror",
  "panel", "socket", "light",
  "person", "bin_trash", "bin",
]);

const KIND_ICON_FALLBACK = {
  table_subs: "table_packaging",
  table_manip: "table_packaging",
  table_recv: "table_receiving",
  table_sow: "table_sowing",
  sink_susp: "sink_single",
  sink_table: "sink_single",
  sink_double: "sink_double",
  shower_pan: "shower",
  shower_sys: "showerhead",
  water_prep: "osmosis_filters",
  blade_fan: "fan_round",
  vent_unit: "vent",
  ac_floor: "ac_indoor",
  ac_duct: "vent_duct",
  trolley: "trolley_plant",
  scales_fl: "scales_floor",
  scales_tb: "scales_bench",
  trashcan: "bin_trash",
  shelf_cons: "rack_shelf",
  shelf_inv: "rack_shelf",
  seed_rack: "rack_seedling",
  light_panel: "light",
};

export function resolveGlyphIcon(it) {
  if (!it) return null;
  let icon = it.icon || catalogByKind(it.kind)?.icon || null;
  if (isRackKind(it.kind)) {
    icon = rackIconForType(it.rackType) || icon || "rack_nft";
  }
  if (icon && !GLYPH_ICONS.has(icon) && KIND_ICON_FALLBACK[icon]) {
    icon = KIND_ICON_FALLBACK[icon];
  }
  if (icon && !GLYPH_ICONS.has(icon) && KIND_ICON_FALLBACK[it.kind]) {
    icon = KIND_ICON_FALLBACK[it.kind];
  }
  if (icon && GLYPH_ICONS.has(icon)) return icon;
  if (it.kind && KIND_ICON_FALLBACK[it.kind] && GLYPH_ICONS.has(KIND_ICON_FALLBACK[it.kind])) {
    return KIND_ICON_FALLBACK[it.kind];
  }
  return icon && GLYPH_ICONS.has(icon) ? icon : null;
}

export function hasObjectGlyph(it) {
  return !!resolveGlyphIcon(it);
}

export function glyphStrokeColor(it, visState = {}) {
  if (visState.stroke) return visState.stroke;
  return glyphColorForItem(it);
}

export function glyphFillOpacity(it) {
  return glyphFillOpacityForItem(it);
}

export function glyphRenderProps(it, visState = {}) {
  const icon = resolveGlyphIcon(it);
  return {
    icon,
    hasGlyph: !!icon,
    stroke: glyphStrokeColor(it, visState),
    fillOpacity: glyphFillOpacity(it),
    hitFillOpacity: 0.012,
  };
}
