import { LAYERS } from "./catalog.js";
import { resolveTool, flattenTools } from "./plannerTools.js";

const CONTEXT_LAYERS = ["room", "partitions"];
const ALL_LAYER_IDS = LAYERS.map((l) => l.id);

const BASE_TOOLS = ["select", "measure", "label", "pan"];

function sheet(
  id,
  name,
  layerId,
  {
    color = "#116355",
    activeLayer = layerId,
    visibleLayers,
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
  } = {},
) {
  const vis = visibleLayers || [activeLayer, ...CONTEXT_LAYERS, "labels"];
  return {
    id,
    name,
    layerId,
    color,
    activeLayer,
    visibleLayers: vis,
    mutedLayers: mutedLayers.length ? mutedLayers : ALL_LAYER_IDS.filter((l) => !vis.includes(l) && !hiddenLayers.includes(l)),
    hiddenLayers,
    toolGroups,
    filters,
    pdfSheetName,
    clientVisible,
    exportDefault,
    defaultToolId,
    showDims,
    showLabels,
  };
}

export const SHEETS = [
  sheet("source", "Исходный план", "room", {
    color: "#2f3431",
    visibleLayers: ["room", "partitions", "zones", "labels"],
    mutedLayers: ["racks", "furn", "irrigation", "drain", "water", "power", "sockets", "light", "climate", "vent", "staff", "sanitary"],
    defaultToolId: "select",
    toolGroups: [
      { id: "draw", label: "Чертёж", tools: ["wall_draw", "wall_outline", "room_by_size"] },
      { id: "openings", label: "Проёмы", tools: ["doors_group", "windows_group", "opening_tech", "opening_comm", "opening_floor"] },
      { id: "struct", label: "Конструкции", tools: ["column", "beam", "gate_zone", "ext_pad"] },
      { id: "backdrop", label: "Подложка", tools: ["backdrop", "backdrop_scale"] },
      { id: "common", label: "Общие", tools: BASE_TOOLS },
    ],
  }),

  sheet("demolition", "Демонтаж", "room", {
    color: "#8a4a3a",
    visibleLayers: ["room", "partitions", "labels"],
    mutedLayers: ALL_LAYER_IDS.filter((l) => !["room", "partitions", "labels"].includes(l)),
    defaultToolId: "select",
    toolGroups: [
      { id: "demo", label: "Демонтаж", tools: ["select", "label", "measure", "comment"] },
    ],
  }),

  sheet("partitions", "Перегородки", "partitions", {
    color: "#5a5f5c",
    visibleLayers: ["room", "partitions", "zones", "labels"],
    defaultToolId: "wall_draw",
    toolGroups: [
      { id: "walls", label: "Перегородки", tools: ["wall_draw", "wall_sandwich", "wall_food", "wall_cold", "wall_pvc", "wall_brick", "wall_gkl", "wall_glass", "wall_light", "wall_box"] },
      { id: "zones", label: "Зонирование", tools: ["zone_room", "sanitary_lock", "part_opening", "part_door"] },
      { id: "common", label: "Общие", tools: BASE_TOOLS },
    ],
  }),

  sheet("zones", "Помещения", "zones", {
    color: "#8a7a9c",
    visibleLayers: ["room", "partitions", "zones", "labels"],
    defaultToolId: "zone_assign",
    toolGroups: [
      { id: "zones", label: "Назначение", tools: ["zone_assign", "zone_clean", "zone_dirty", "zone_buffer", "zone_seed", "zone_grow", "zone_pack", "zone_gas", "zone_waste", "zone_water_prep", "zone_storage", "zone_cold_room", "zone_sanlock", "zone_tech", "zone_staff", "zone_shower", "zone_wc", "zone_corridor", "zone_ship", "zone_recv"] },
      { id: "common", label: "Общие", tools: BASE_TOOLS },
    ],
  }),

  sheet("racks", "Стеллажи", "racks", {
    color: "#116355",
    visibleLayers: ["room", "partitions", "zones", "racks", "irrigation", "labels"],
    mutedLayers: ["furn", "water", "power", "vent", "staff", "sanitary"],
    defaultToolId: "rack_nft",
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
      { id: "racks", label: "Стеллажи", tools: ["racks_group", "rack_storage", "rack_cons"] },
      { id: "layout", label: "Размещение", tools: ["rack_row", "rack_block", "rack_number", "rack_aisle", "rack_service"] },
      { id: "links", label: "Привязки", tools: ["link_tank", "link_pump", "link_drain", "link_socket", "link_light", "link"] },
      { id: "common", label: "Общие", tools: BASE_TOOLS },
    ],
  }),

  sheet("furn", "Мебель", "furn", {
    color: "#5b6b52",
    visibleLayers: ["room", "partitions", "zones", "furn", "labels"],
    defaultToolId: "table_sow",
    toolGroups: [
      { id: "tables", label: "Столы", tools: ["table_sow", "table_manip", "table_pack", "table_recv", "table_subs"] },
      { id: "equip", label: "Оборудование", tools: ["trolley_plant", "scales_fl", "scales_tb", "fridge", "freezer", "trashcan", "tank_waste", "ladder"] },
      { id: "storage", label: "Хранение", tools: ["wardrobe", "bench", "hanger", "chair", "shelf_inv", "rack_cons"] },
      { id: "common", label: "Общие", tools: BASE_TOOLS },
    ],
  }),

  sheet("sanitary", "Сантехника", "sanitary", {
    color: "#2f6f8f",
    visibleLayers: ["room", "partitions", "zones", "sanitary", "labels"],
    defaultToolId: "sink_susp",
    toolGroups: [
      { id: "plumb", label: "Сантехника", tools: ["sink_susp", "sink_double", "sink_table", "toilet", "shower_pan", "shower_sys", "trap", "dispenser"] },
      { id: "common", label: "Общие", tools: [...BASE_TOOLS, "link"] },
    ],
  }),

  sheet("water", "Водоснабжение", "water", {
    color: "#2f6f8f",
    visibleLayers: ["room", "partitions", "zones", "water", "irrigation", "labels"],
    mutedLayers: ["racks", "furn", "power", "vent"],
    defaultToolId: "tank_solution",
    filters: [
      { id: "all", label: "Все трубы" },
      { id: "clean", label: "Чистая вода" },
      { id: "solution", label: "Раствор" },
      { id: "acid", label: "Кислота" },
      { id: "fert_a", label: "Удобрение А" },
      { id: "fert_b", label: "Удобрение Б" },
      { id: "return", label: "Обратка" },
      { id: "pick", label: "Выбрать" },
    ],
    toolGroups: [
      { id: "tanks", label: "Ёмкости", tools: ["tanks_group"] },
      { id: "equip", label: "Оборудование", tools: ["pump", "osmosis", "water_prep"] },
      { id: "pipes", label: "Трубопровод", tools: ["water_line", "line", "water_valve", "link"] },
      { id: "common", label: "Общие", tools: BASE_TOOLS },
    ],
  }),

  sheet("drain", "Дренаж", "drain", {
    color: "#7a5c3e",
    visibleLayers: ["room", "partitions", "zones", "drain", "labels"],
    defaultToolId: "drain_line",
    filters: [
      { id: "all", label: "Все линии" },
      { id: "main", label: "Основной слив" },
      { id: "emergency", label: "Аварийный слив" },
      { id: "condensate", label: "Конденсат" },
      { id: "waste", label: "Отходы" },
      { id: "pick", label: "Выбрать" },
    ],
    toolGroups: [
      { id: "drain", label: "Дренаж", tools: ["drain_line", "drain_main", "drain_emergency", "trap", "line", "link"] },
      { id: "common", label: "Общие", tools: BASE_TOOLS },
    ],
  }),

  sheet("sockets", "Розетки", "sockets", {
    color: "#c44a2f",
    visibleLayers: ["room", "partitions", "zones", "sockets", "power", "labels"],
    defaultToolId: "socket",
    toolGroups: [
      { id: "sockets", label: "Розетки", tools: ["sockets_group", "socket"] },
      { id: "links", label: "Привязки", tools: ["link"] },
      { id: "common", label: "Общие", tools: BASE_TOOLS },
    ],
  }),

  sheet("light", "Освещение", "light", {
    color: "#d4a017",
    visibleLayers: ["room", "partitions", "zones", "light", "labels"],
    defaultToolId: "light_panel",
    toolGroups: [
      { id: "light", label: "Освещение", tools: ["light_panel", "light_line", "light_zone", "link"] },
      { id: "common", label: "Общие", tools: BASE_TOOLS },
    ],
  }),

  sheet("wiring", "Электропроводка", "power", {
    color: "#a5371f",
    visibleLayers: ["room", "partitions", "zones", "power", "light", "labels"],
    defaultToolId: "power_line",
    filters: [
      { id: "all", label: "Все линии" },
      { id: "power", label: "Силовые" },
      { id: "low", label: "Слаботочные" },
      { id: "light", label: "Освещение" },
      { id: "sensor", label: "Датчики" },
      { id: "ground", label: "Заземление" },
      { id: "pick", label: "Выбрать" },
    ],
    toolGroups: [
      { id: "cables", label: "Кабели", tools: ["power_line", "low_line", "light_cable", "sensor_cable", "ground_line", "line"] },
      { id: "common", label: "Общие", tools: [...BASE_TOOLS, "link"] },
    ],
  }),

  sheet("panel", "Электрощит", "power", {
    color: "#a5371f",
    visibleLayers: ["room", "partitions", "zones", "power", "labels"],
    defaultToolId: "panel",
    toolGroups: [
      { id: "panel", label: "Щит", tools: ["panel", "link"] },
      { id: "common", label: "Общие", tools: BASE_TOOLS },
    ],
  }),

  sheet("climate", "Климат", "climate", {
    color: "#5b7c9d",
    visibleLayers: ["room", "partitions", "zones", "climate", "labels"],
    defaultToolId: "fan_recirc",
    toolGroups: [
      { id: "climate", label: "Климат", tools: ["fan_recirc", "fridge", "freezer", "link"] },
      { id: "common", label: "Общие", tools: BASE_TOOLS },
    ],
  }),

  sheet("ac", "Кондиционеры", "climate", {
    color: "#5b7c9d",
    visibleLayers: ["room", "partitions", "zones", "climate", "labels"],
    defaultToolId: "ac_indoor",
    toolGroups: [
      { id: "ac", label: "Кондиционеры", tools: ["ac_indoor", "ac_outdoor", "ac_duct", "ac_floor", "ac_line", "link"] },
      { id: "common", label: "Общие", tools: BASE_TOOLS },
    ],
  }),

  sheet("vent", "Вентиляция", "vent", {
    color: "#6b7d74",
    visibleLayers: ["room", "partitions", "zones", "vent", "labels"],
    defaultToolId: "vent_line_out",
    filters: [
      { id: "all", label: "Всё" },
      { id: "supply", label: "Приток" },
      { id: "exhaust", label: "Вытяжка" },
      { id: "recirc", label: "Рециркуляция" },
      { id: "grilles", label: "Решётки" },
      { id: "fans", label: "Вентиляторы" },
      { id: "pick", label: "Выбрать" },
    ],
    toolGroups: [
      { id: "ducts", label: "Воздуховоды", tools: ["vent_line_in", "vent_line_out", "vent_recirc", "line"] },
      { id: "equip", label: "Оборудование", tools: ["vent_unit", "fans_group"] },
      { id: "common", label: "Общие", tools: [...BASE_TOOLS, "link"] },
    ],
  }),

  sheet("safety", "Безопасность", "sanitary", {
    color: "#a5371f",
    visibleLayers: ["room", "partitions", "zones", "sanitary", "labels"],
    defaultToolId: "select",
    toolGroups: [
      { id: "safety", label: "Безопасность", tools: ["select", "label", "comment", "dezmat"] },
    ],
  }),

  sheet("hygiene", "Санитария", "sanitary", {
    color: "#2f6f8f",
    visibleLayers: ["room", "partitions", "zones", "sanitary", "labels"],
    defaultToolId: "dezmat_hygiene",
    toolGroups: [
      { id: "hygiene", label: "Санитария", tools: ["dezmat_hygiene", "dispenser", "recirc_hygiene", "zone_clean", "zone_dirty"] },
      { id: "common", label: "Общие", tools: BASE_TOOLS },
    ],
  }),

  sheet("routes", "Маршруты", "staff", {
    color: "#b9741d",
    visibleLayers: ["room", "partitions", "zones", "staff", "labels"],
    defaultToolId: "route_staff",
    filters: [
      { id: "all", label: "Всё" },
      { id: "staff", label: "Персонал" },
      { id: "raw", label: "Сырьё" },
      { id: "product", label: "Готовая продукция" },
      { id: "waste", label: "Отходы" },
      { id: "clean", label: "Чистый поток" },
      { id: "dirty", label: "Грязный поток" },
      { id: "pick", label: "Выбрать" },
    ],
    toolGroups: [
      { id: "routes", label: "Потоки", tools: ["route_staff", "route_raw", "route_product", "route_waste", "line"] },
      { id: "common", label: "Общие", tools: BASE_TOOLS },
    ],
  }),

  sheet("spec", "Спецификация", "spec", {
    color: "#116355",
    visibleLayers: ALL_LAYER_IDS,
    defaultToolId: "select",
    toolGroups: [
      { id: "spec", label: "Спецификация", tools: ["select", "sync_spec"] },
    ],
  }),

  sheet("client", "Клиентский вид", "client", {
    color: "#477ca8",
    visibleLayers: ALL_LAYER_IDS.filter((l) => l !== "spec"),
    hiddenLayers: ["spec"],
    defaultToolId: "select",
    toolGroups: [
      { id: "view", label: "Отображение", tools: ["select", "pan", "view_client_layers", "view_hide_comments", "view_show_dims"] },
    ],
    clientVisible: true,
  }),

  sheet("install", "Монтажный вид", "install", {
    color: "#3d5a4c",
    visibleLayers: ALL_LAYER_IDS,
    defaultToolId: "select",
    showDims: true,
    toolGroups: [
      { id: "view", label: "Монтажный", tools: ["select", "measure", "label", "pan", "view_show_dims", "view_show_errors", "view_show_ports"] },
    ],
  }),
];

export const PLAN_LEVELS = [
  "Этаж 1", "Производство", "Техзона", "Холодильная зона", "Отгрузка", "Внешняя зона",
];

export const PLAN_VARIANTS = [
  "Планировка 1", "Планировка 2", "Бюджет", "Оптимальная", "Премиум", "Черновик", "Утверждённая",
];

export const sheetById = (id) => SHEETS.find((s) => s.id === id) || SHEETS[0];
export const sheetByLayerId = (layerId) => SHEETS.find((s) => s.layerId === layerId) || SHEETS[0];

export function defaultToolForSheet(sheet) {
  const id = sheet?.defaultToolId;
  if (id) return resolveTool(id);
  const tools = flattenTools(sheet?.toolGroups?.flatMap((g) => g.tools) || []);
  return tools.find((t) => t.mode && t.mode !== "placeholder") || resolveTool("select");
}

export function buildVisibilityFromSheet(sheet) {
  const vis = Object.fromEntries(ALL_LAYER_IDS.map((id) => [id, false]));
  (sheet.visibleLayers || []).forEach((id) => { vis[id] = true; });
  CONTEXT_LAYERS.forEach((id) => { vis[id] = true; });
  vis.labels = (sheet.visibleLayers || []).includes("labels") || true;
  (sheet.hiddenLayers || []).forEach((id) => { vis[id] = false; });
  return vis;
}

export function sheetDisplayPatch(sheet) {
  const patch = { dimInactive: true, highlightActive: true, labelHideInactive: true };
  if (sheet.showDims === false) patch.showDims = false;
  if (sheet.showLabels === false) patch.showLabels = false;
  if (sheet.id === "client") {
    patch.hideInactive = true;
    patch.highlightErrors = false;
  }
  if (sheet.id === "install") {
    patch.showDims = true;
    patch.showPorts = true;
    patch.highlightErrors = true;
  }
  return patch;
}
