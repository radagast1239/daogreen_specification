import { LAYERS, LINE_STYLE, catalogByKind } from "./catalog.js";
import { resolveTool, flattenTools } from "./plannerTools.js";
import { farmCategoryForKind } from "./farmObjects.js";

const ALL_LAYER_IDS = LAYERS.map((l) => l.id);
const BASE_TOOLS = ["select", "measure", "label", "pan"];

function sheet(
  id,
  name,
  layerId,
  {
    color = "#116355",
    activeLayer = layerId,
    visibleLayers = [activeLayer, "room", "partitions", "labels"],
    mutedLayers = [],
    hiddenLayers = [],
    toolGroups = [],
    filters = [],
    pdfSheetName = name,
    clientVisible = true,
    exportDefault = true,
    defaultToolId,
    showDims = true,
    showLabels = true,
    sheetExportConfig = null,
  } = {},
) {
  return {
    id,
    name,
    layerId,
    color,
    activeLayer,
    visibleLayers,
    mutedLayers: mutedLayers.length ? mutedLayers : ALL_LAYER_IDS.filter((l) => !visibleLayers.includes(l) && !hiddenLayers.includes(l)),
    hiddenLayers,
    toolGroups,
    filters,
    pdfSheetName,
    clientVisible,
    exportDefault,
    defaultToolId,
    showDims,
    showLabels,
    sheetExportConfig: sheetExportConfig || {
      sheetId: id,
      title: name,
      scale: "1:100",
      showLegend: true,
      showTitleBlock: true,
      showDimensions: showDims,
      showWarnings: true,
    },
  };
}

export const REQUIRED_FARM_SHEET_IDS = [
  "base_plan",
  "partitions",
  "farm_zones",
  "racks",
  "irrigation",
  "drainage",
  "water_treatment",
  "electrical",
  "lighting",
  "climate",
  "ventilation",
  "plumbing",
  "equipment",
  "safety",
  "specification",
];

const FARM_SHEETS = [
  sheet("base_plan", "Исходный план", "room", {
    color: "#2f3431",
    activeLayer: "room",
    visibleLayers: ["room", "partitions", "zones", "labels"],
    defaultToolId: "wall_draw",
    toolGroups: [
      { id: "base", label: "Чертёж", tools: ["wall_draw", "door_std", "window_std", "doors_group", "windows_group", "column", "beam", "measure"] },
      { id: "common", label: "Общие", tools: BASE_TOOLS },
    ],
  }),
  sheet("partitions", "Перегородки", "partitions", {
    color: "#5a5f5c",
    visibleLayers: ["room", "partitions", "zones", "labels"],
    defaultToolId: "wall_draw",
    toolGroups: [
      { id: "walls", label: "Перегородки", tools: ["wall_draw", "wall_bearing", "wall_pgb", "wall_foam", "wall_brick", "wall_gkl", "wall_glass", "wall_lath", "wall_box", "door_std", "window_std", "doors_group", "windows_group", "column"] },
      { id: "common", label: "Общие", tools: BASE_TOOLS },
    ],
  }),
  sheet("farm_zones", "Зоны фермы", "room", {
    color: "#116355",
    activeLayer: "zones",
    visibleLayers: ["room", "partitions", "zones", "labels"],
    defaultToolId: "zone_assign",
    toolGroups: [
      { id: "zones", label: "Зоны", tools: ["zone_assign", "zone_clean", "zone_dirty", "zone_buffer", "measure"] },
      { id: "common", label: "Общие", tools: BASE_TOOLS },
    ],
  }),
  sheet("racks", "Стеллажи", "racks", {
    color: "#116355",
    visibleLayers: ["room", "partitions", "zones", "racks", "labels", "irrigation"],
    defaultToolId: "rack_nft_2000_740",
    filters: [
      { id: "all", label: "Все" },
      { id: "nft", label: "NFT" },
      { id: "flood", label: "Подтопление" },
      { id: "seed", label: "Рассада" },
      { id: "strawberry", label: "Клубника" },
      { id: "aero", label: "Аэропоника" },
      { id: "storage", label: "Хранение" },
      { id: "pick", label: "Выбрать" },
    ],
    toolGroups: [
      { id: "racks", label: "Стеллажи", tools: ["racks_group", "rack_row", "rack_block", "rack_number"] },
      { id: "dims", label: "Проходы и размеры", tools: ["measure"] },
      { id: "common", label: "Общие", tools: BASE_TOOLS },
    ],
  }),
  sheet("irrigation", "Полив", "irrigation", {
    color: "#2f6f8f",
    visibleLayers: ["room", "partitions", "racks", "water", "irrigation", "labels"],
    defaultToolId: "water_line",
    toolGroups: [
      { id: "irr", label: "Полив", tools: ["tank_clean", "tank_solution", "pump", "osmosis", "water_line", "water_valve_group"] },
      { id: "common", label: "Общие", tools: [...BASE_TOOLS, "link"] },
    ],
  }),
  sheet("drainage", "Дренаж", "drain", {
    color: "#7a5c3e",
    visibleLayers: ["room", "partitions", "racks", "drain", "labels"],
    defaultToolId: "drain_line",
    toolGroups: [
      { id: "drain", label: "Дренаж", tools: ["drain_line", "drain_main", "drain_emergency", "trap", "tank_drain_collection", "tank_waste_liquid"] },
      { id: "common", label: "Общие", tools: [...BASE_TOOLS, "link"] },
    ],
  }),
  sheet("water_treatment", "Водоподготовка", "water", {
    color: "#2f6f8f",
    visibleLayers: ["room", "partitions", "racks", "water", "irrigation", "labels"],
    defaultToolId: "water_prep",
    toolGroups: [
      { id: "wt", label: "Водоподготовка", tools: ["water_prep", "osmosis", "tank_clean", "pump", "water_line"] },
      { id: "common", label: "Общие", tools: [...BASE_TOOLS, "link"] },
    ],
  }),
  sheet("electrical", "Электрика", "power", {
    color: "#a5371f",
    visibleLayers: ["room", "partitions", "racks", "power", "sockets", "labels"],
    defaultToolId: "panel",
    toolGroups: [
      {
        id: "el",
        label: "Электрика",
        tools: ["panel", "socket_220", "socket_pump", "socket_service", "power_line", "wall_cable", "ceiling_cable", "tray_cable", "cable_tray", "junction_box", "switch", "sensor", "relay_box", "sensor_cable"],
      },
      { id: "common", label: "Общие", tools: [...BASE_TOOLS, "link"] },
    ],
  }),
  sheet("lighting", "Освещение", "light", {
    color: "#d4a017",
    visibleLayers: ["room", "partitions", "racks", "light", "power", "labels"],
    defaultToolId: "light_panel",
    toolGroups: [
      { id: "light", label: "Освещение", tools: ["light_linear_60", "light_linear_100", "light_linear_120", "light_quantum", "light_service", "light_germination", "lighting_group", "add_light_to_rack", "light_line", "link_light"] },
      { id: "common", label: "Общие", tools: [...BASE_TOOLS, "link"] },
    ],
  }),
  sheet("climate", "Климат", "climate", {
    color: "#5b7c9d",
    visibleLayers: ["room", "partitions", "zones", "climate", "labels"],
    defaultToolId: "indoor_unit",
    toolGroups: [
      {
        id: "climate",
        label: "Климат",
        tools: [
          "climate_system",
          "indoor_unit",
          "outdoor_unit",
          "dehumidifier",
          "humidifier",
          "climate_controller",
          "temperature_sensor",
          "humidity_sensor",
          "co2_sensor",
          "air_quality_sensor",
          "dew_point_sensor",
          "pressure_sensor",
          "fan_recirc",
          "ac_line",
        ],
      },
      { id: "common", label: "Общие", tools: [...BASE_TOOLS, "link", "view_show_airflow"] },
    ],
  }),
  sheet("ventilation", "Вентиляция", "vent", {
    color: "#6b7d74",
    visibleLayers: ["room", "partitions", "zones", "vent", "labels"],
    defaultToolId: "duct_tool",
    toolGroups: [
      {
        id: "vent",
        label: "Вентиляция",
        tools: [
          "duct_tool",
          "vent_line_in",
          "vent_line_out",
          "vent_recirc",
          "supply_grille",
          "exhaust_grille",
          "duct_damper",
          "fan_axial",
          "fan_duct",
          "vent_unit",
          "airflow_arrow",
        ],
      },
      { id: "common", label: "Общие", tools: [...BASE_TOOLS, "link", "view_show_airflow"] },
    ],
  }),
  sheet("plumbing", "Сантехника", "sanitary", {
    color: "#2f6f8f",
    visibleLayers: ["room", "partitions", "zones", "sanitary", "labels"],
    defaultToolId: "sink_susp",
    toolGroups: [
      { id: "plumb", label: "Сантехника", tools: ["sink_susp", "sink_double", "toilet", "shower_pan", "trap"] },
      { id: "common", label: "Общие", tools: [...BASE_TOOLS, "link"] },
    ],
  }),
  sheet("equipment", "Оборудование", "furn", {
    color: "#5b6b52",
    visibleLayers: ["room", "partitions", "racks", "furn", "water", "climate", "labels"],
    defaultToolId: "table_sow",
    toolGroups: [
      { id: "equip", label: "Оборудование", tools: ["table_sow", "table_manip", "trolley_plant", "fridge", "freezer", "pump"] },
      { id: "common", label: "Общие", tools: BASE_TOOLS },
    ],
  }),
  sheet("safety", "Санитария / безопасность", "sanitary", {
    color: "#a5371f",
    visibleLayers: ["room", "partitions", "zones", "sanitary", "staff", "labels"],
    defaultToolId: "dezmat_hygiene",
    toolGroups: [
      { id: "safe", label: "Санитария", tools: ["dezmat_hygiene", "dispenser", "comment", "route_staff"] },
      { id: "common", label: "Общие", tools: BASE_TOOLS },
    ],
  }),
  sheet("specification", "Спецификация", "spec", {
    color: "#116355",
    visibleLayers: [...ALL_LAYER_IDS, "labels"],
    defaultToolId: "sync_spec",
    showDims: false,
    showLabels: true,
    toolGroups: [
      { id: "spec", label: "Спецификация", tools: ["select", "sync_spec"] },
    ],
    sheetExportConfig: {
      sheetId: "specification",
      title: "Спецификация",
      scale: "1:100",
      showLegend: true,
      showTitleBlock: true,
      showDimensions: false,
      showWarnings: true,
    },
  }),
];

export const LEGACY_SHEET_MIGRATION = {
  source: "base_plan",
  furniture: "equipment",
  furn: "equipment",
  sockets: "electrical",
  light: "lighting",
  lighting: "lighting",
  sanitary: "plumbing",
  plumbing: "plumbing",
  vent: "ventilation",
  ventilation: "ventilation",
  conditioners: "climate",
  climate: "climate",
  water: "irrigation",
  drain: "drainage",
  wiring: "electrical",
  panel: "electrical",
  spec: "specification",
  hygiene: "safety",
  routes: "safety",
  demolition: "partitions",
};

export const LEGACY_SHEETS = Object.keys(LEGACY_SHEET_MIGRATION);
export const SHEETS = FARM_SHEETS;

export function resolveSheetId(id) {
  if (!id) return SHEETS[0].id;
  return LEGACY_SHEET_MIGRATION[id] || id;
}

export const PLAN_LEVELS = [
  "Этаж 1", "Производство", "Техзона", "Холодильная зона", "Отгрузка", "Внешняя зона",
];

export const PLAN_VARIANTS = [
  "Планировка 1", "Планировка 2", "Бюджет", "Оптимальная", "Премиум", "Черновик", "Утверждённая",
];

export const sheetById = (id) => SHEETS.find((s) => s.id === resolveSheetId(id)) || SHEETS[0];
export const sheetByLayerId = (layerId) => SHEETS.find((s) => s.layerId === layerId || s.activeLayer === layerId) || SHEETS[0];

export function defaultToolForSheet(sheet) {
  const id = sheet?.defaultToolId;
  if (id) return resolveTool(id) || resolveTool("select");
  const tools = flattenTools(sheet?.toolGroups?.flatMap((g) => g.tools) || []);
  return tools.find((t) => t.mode && t.mode !== "placeholder") || resolveTool("select");
}

export function buildVisibilityFromSheet(sheet) {
  const vis = Object.fromEntries(ALL_LAYER_IDS.map((id) => [id, false]));
  (sheet.visibleLayers || []).forEach((id) => { if (id in vis) vis[id] = true; });
  vis.labels = (sheet.visibleLayers || []).includes("labels");
  vis.zones = (sheet.visibleLayers || []).includes("zones");
  (sheet.hiddenLayers || []).forEach((id) => { vis[id] = false; });
  return vis;
}

export function sheetDisplayPatch(sheet) {
  const engineering = new Set(["irrigation", "drainage", "water_treatment", "electrical", "lighting", "climate", "ventilation", "plumbing"]);
  const patch = { dimInactive: true, highlightActive: true, labelHideInactive: true, showDims: sheet.showDims !== false, showLabels: sheet.showLabels !== false };
  if (engineering.has(sheet.id)) {
    patch.hideInactive = false;
    patch.highlightErrors = true;
    patch.showZoneFill = true;
    patch.zoneContoursOnly = false;
  }
  if (sheet.id === "specification") {
    patch.showDims = false;
    patch.highlightErrors = true;
  }
  return patch;
}

const CATEGORY_DEFAULT_SHEETS = {
  rack: ["racks", "equipment", "specification"],
  nft_channel: ["racks", "specification"],
  tray_rack: ["racks", "specification"],
  aeroponic_rack: ["racks", "specification"],
  strawberry_rack: ["racks", "specification"],
  tank: ["irrigation", "drainage", "water_treatment", "specification"],
  pump: ["irrigation", "water_treatment", "equipment", "specification"],
  filter: ["water_treatment", "irrigation", "specification"],
  dosing_unit: ["water_treatment", "irrigation", "specification"],
  pipe: ["irrigation", "specification"],
  drain_pipe: ["drainage", "specification"],
  valve: ["irrigation", "drainage", "specification"],
  light: ["lighting", "electrical", "specification"],
  lighting_group: ["lighting", "electrical", "specification"],
  electrical_panel: ["electrical", "specification"],
  power_line: ["electrical", "lighting", "specification"],
  cable_tray: ["electrical", "specification"],
  junction_box: ["electrical", "specification"],
  switch: ["electrical", "lighting", "specification"],
  socket: ["electrical", "specification"],
  sensor: ["electrical", "climate", "specification"],
  relay_box: ["electrical", "specification"],
  co2_sensor: ["climate", "ventilation", "specification"],
  temperature_sensor: ["climate", "specification"],
  humidity_sensor: ["climate", "specification"],
  air_quality_sensor: ["climate", "ventilation", "specification"],
  dew_point_sensor: ["climate", "ventilation", "specification"],
  pressure_sensor: ["climate", "ventilation", "specification"],
  climate_controller: ["climate", "specification"],
  indoor_unit: ["climate", "specification"],
  outdoor_unit: ["climate", "specification"],
  exhaust: ["ventilation", "climate", "specification"],
  supply: ["ventilation", "climate", "specification"],
  circulation_fan: ["ventilation", "climate", "specification"],
  duct: ["ventilation", "climate", "specification"],
  airflow_arrow: ["ventilation", "climate", "specification"],
  fan: ["ventilation", "climate", "specification"],
  air_conditioner: ["climate", "specification"],
  dehumidifier: ["climate", "specification"],
  humidifier: ["climate", "specification"],
  co2: ["climate", "specification"],
  sink: ["plumbing", "safety", "specification"],
  table: ["equipment", "racks", "specification"],
  cart: ["equipment", "racks", "specification"],
  cold_room_equipment: ["equipment", "climate", "specification"],
  sanitation: ["safety", "plumbing", "specification"],
  storage: ["equipment", "racks", "specification"],
  custom: ["equipment", "racks", "specification"],
};

function inferByLayer(item) {
  const layer = item.layer;
  if (layer === "racks") return ["racks", "equipment", "specification"];
  if (layer === "water" || layer === "irrigation") return ["irrigation", "water_treatment", "specification"];
  if (layer === "drain") return ["drainage", "specification"];
  if (layer === "power" || layer === "sockets") return ["electrical", "lighting", "specification"];
  if (layer === "light") return ["lighting", "electrical", "specification"];
  if (layer === "climate") return ["climate", "equipment", "specification"];
  if (layer === "vent") return ["ventilation", "climate", "specification"];
  if (layer === "sanitary") return ["plumbing", "safety", "specification"];
  if (layer === "furn") return ["equipment", "racks", "specification"];
  if (layer === "room" || layer === "partitions") return ["base_plan", "partitions", "farm_zones", "specification"];
  return ["base_plan", "specification"];
}

export function inferObjectVisibleSheets(item = {}) {
  if (Array.isArray(item.visibleOnSheets) && item.visibleOnSheets.length) {
    return item.visibleOnSheets.map((id) => resolveSheetId(id));
  }
  const category = item.category || farmCategoryForKind(item.kind);
  const byCategory = CATEGORY_DEFAULT_SHEETS[category];
  if (byCategory?.length) return byCategory;
  return inferByLayer(item);
}

export function objectVisibleOnSheet(item, sheetId) {
  if (!item || item.visible === false) return false;
  const sid = resolveSheetId(sheetId);
  return inferObjectVisibleSheets(item).includes(sid);
}

function legendLabelForObject(item) {
  if (item.category === "pipe" || item.category === "drain_pipe") {
    const d = item.params?.diameterMm || item.diameterMm || 0;
    const mat = (item.params?.material || "pp").toUpperCase();
    return `Труба ${mat} ${d}`;
  }
  if (item.category === "socket") {
    const wet = item.params?.waterproof === true || String(item.params?.protectionIp || "").toUpperCase().startsWith("IP");
    return wet ? "Розетка влагозащищенная" : "Розетка стандартная";
  }
  if (item.category === "electrical_panel") return "Электрощит";
  if (item.category === "sensor") return "Датчик";
  if (item.category === "light") return "Линейный светильник";
  if (item.category === "rack") return "Стеллаж";
  if (item.category === "tank") return "Бак";
  return item.name || item.label || catalogByKind(item.kind || "rack")?.label || item.kind || "Объект";
}

export function buildSheetLegend(plan, sheetId) {
  const sid = resolveSheetId(sheetId);
  const sheet = sheetById(sid);
  const seen = new Map();
  if ((sheet.visibleLayers || []).includes("room") || (sheet.visibleLayers || []).includes("partitions")) {
    if ((plan.walls || []).length) seen.set("walls", { id: "walls", type: "wall", label: "Стены" });
  }
  (plan.items || []).forEach((it) => {
    if (!objectVisibleOnSheet(it, sid)) return;
    if (!sheet.visibleLayers.includes(it.layer)) return;
    const label = legendLabelForObject(it);
    const key = `obj:${label}`;
    if (!seen.has(key)) seen.set(key, { id: key, type: "object", label });
  });
  (plan.lines || []).forEach((ln) => {
    const lid = ln.layer;
    if (!sheet.visibleLayers.includes(lid)) return;
    const style = LINE_STYLE[lid];
    const label = ln.type === "power_line" || lid === "power"
      ? "Кабельная линия"
      : (style?.label || "Линия");
    const key = `line:${label}`;
    if (!seen.has(key)) seen.set(key, { id: key, type: "line", label });
  });
  return [...seen.values()];
}

export function getSheetExportConfig(sheetId) {
  return sheetById(sheetId).sheetExportConfig;
}
