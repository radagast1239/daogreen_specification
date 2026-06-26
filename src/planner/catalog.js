// Слои планировщика (листы). mode задаёт тип редактирования на листе.
export const LAYERS = [
  { id: "room",        name: "Исходный план",       color: "#2f3431", sheet: "Исходный план",        mode: "room",        pdf: true },
  { id: "zones",       name: "Помещения",           color: "#8a7a9c", sheet: "Помещения",            mode: "zones",       pdf: true },
  { id: "partitions",  name: "Перегородки",         color: "#5a5f5c", sheet: "Перегородки",          mode: "walls",       pdf: true },
  { id: "racks",       name: "Стеллажи",            color: "#116355", sheet: "Стеллажи",             mode: "items",       pdf: true },
  { id: "irrigation",  name: "Полив",               color: "#1f6f8b", sheet: "Полив",                mode: "both",        pdf: true },
  { id: "drain",       name: "Дренаж",              color: "#7a5c3e", sheet: "Дренаж",               mode: "lines",       pdf: true },
  { id: "water",       name: "Водоснабжение",       color: "#2f6f8f", sheet: "Водоснабжение",        mode: "items",       pdf: true },
  { id: "power",       name: "Электрика",           color: "#a5371f", sheet: "Электрика",            mode: "both",        pdf: true },
  { id: "sockets",     name: "Розетки",             color: "#c44a2f", sheet: "Розетки",              mode: "items",       pdf: true },
  { id: "light",       name: "Свет",                color: "#d4a017", sheet: "Свет",                 mode: "both",        pdf: true },
  { id: "climate",     name: "Климат",              color: "#5b7c9d", sheet: "Климат",               mode: "items",       pdf: true },
  { id: "vent",        name: "Вентиляция",          color: "#6b7d74", sheet: "Вентиляция",           mode: "both",        pdf: true },
  { id: "staff",       name: "Движение персонала",  color: "#b9741d", sheet: "Движение персонала",   mode: "lines",       pdf: true },
  { id: "sanitary",    name: "Санитария",           color: "#2f6f8f", sheet: "Санитария",            mode: "items",       pdf: true },
  { id: "furn",        name: "Мебель",              color: "#5b6b52", sheet: "Мебель",               mode: "items",       pdf: false },
  { id: "client",      name: "Клиентский вид",      color: "#477ca8", sheet: "Клиентский вид",       mode: "view",        pdf: true },
  { id: "install",     name: "Монтажный вид",       color: "#3d5a4c", sheet: "Монтажный вид",        mode: "view",        pdf: true },
  { id: "spec",        name: "Спецификация",        color: "#116355", sheet: "Спецификация",         mode: "spec",        pdf: true },
];

export const PDF_SHEETS = LAYERS.filter((l) => l.pdf);
export const layerById = (id) => LAYERS.find((l) => l.id === id) || LAYERS[0];

// Инструменты, доступные на каждом листе
export const LAYER_TOOLS = {
  room:        ["select", "measure", "label", "pan"],
  zones:       ["select", "zone", "measure", "label", "pan"],
  partitions:  ["select", "wall", "measure", "label", "pan"],
  racks:       ["select", "measure", "label", "pan"],
  irrigation:  ["select", "line", "link", "measure", "label", "pan"],
  drain:       ["select", "line", "link", "measure", "label", "pan"],
  water:       ["select", "link", "measure", "label", "pan"],
  power:       ["select", "line", "link", "measure", "label", "pan"],
  sockets:     ["select", "link", "measure", "label", "pan"],
  light:       ["select", "line", "link", "measure", "label", "pan"],
  climate:     ["select", "measure", "label", "pan"],
  vent:        ["select", "line", "measure", "label", "pan"],
  staff:       ["select", "line", "measure", "label", "pan"],
  sanitary:    ["select", "measure", "label", "pan"],
  furn:        ["select", "measure", "label", "pan"],
  client:      ["select", "pan"],
  install:     ["select", "measure", "label", "pan"],
  spec:        ["select"],
};

export const WALL_THK_PRESETS = [80, 100, 120, 150, 200];
export const ROOM_HEIGHT_PRESETS = [2700, 3000];

// Линии-трассы по слоям
export const LINE_STYLE = {
  drain:      { color: "#7a5c3e", dash: false, w: 5, label: "Труба слива", arrow: true },
  irrigation: { color: "#1f6f8b", dash: false, w: 4, label: "Труба полива", arrow: true },
  supply:     { color: "#1f6f8b", dash: false, w: 4, label: "Труба полива", arrow: true },
  power:      { color: "#a5371f", dash: true,  w: 2.5, label: "Кабель", arrow: true },
  vent:       { color: "#6b7d74", dash: false, w: 6, label: "Воздуховод", arrow: true },
  climate:    { color: "#5b7c9d", dash: true,  w: 2.5, label: "Трасса кондиционера", arrow: true },
  ac:         { color: "#5b7c9d", dash: true,  w: 2.5, label: "Трасса кондиционера", arrow: true },
  light:      { color: "#d4a017", dash: true,  w: 2, label: "Линия света", arrow: false },
  staff:      { color: "#b9741d", dash: true,  w: 3, label: "Маршрут персонала", arrow: true },
};
export const lineLayers = ["drain", "irrigation", "power", "vent", "climate", "light", "staff"];

// Миграция старых id слоёв из сохранённых планов
const LAYER_MIGRATE = {
  plumb: "sanitary",
  supply: "irrigation",
  ac: "climate",
};
const KIND_LAYER_MIGRATE = {
  osmosis: "water",
  water_prep: "water",
  tank: "irrigation",
  tank_waste: "drain",
  pump: "irrigation",
  fridge: "climate",
  freezer: "climate",
  recirc: "climate",
  ac_indoor: "climate",
  ac_outdoor: "climate",
  ac_floor: "climate",
  ac_duct: "climate",
  sink_susp: "sanitary",
  sink_table: "sanitary",
  sink_double: "sanitary",
  toilet: "sanitary",
  bidet: "sanitary",
  shower_pan: "sanitary",
  shower_sys: "sanitary",
  trap: "sanitary",
  mirror: "sanitary",
  dispenser: "sanitary",
  dezmat: "sanitary",
};

export function migrateLayerId(id, kind) {
  if (KIND_LAYER_MIGRATE[kind]) return KIND_LAYER_MIGRATE[kind];
  return LAYER_MIGRATE[id] || id;
}

// КАТАЛОГ. Размеры в мм. icon — тип отрисовки сверху. wall:true — настенный.
export const CATALOG = [
  // ── Стеллажи ──
  { kind: "rack",        label: "Стеллаж",            w: 1220, h: 600, color: "#116355", icon: "rack_nft",   layer: "racks", params: { tiers: 5, levels: 4 } },
  { kind: "seed_rack",   label: "Рассадный стеллаж",  w: 1220, h: 600, color: "#2f7d4f", icon: "rack_seedling", layer: "racks", params: { tiers: 5 } },
  { kind: "shelf_cons",  label: "Стеллаж расходников", w: 800, h: 400, color: "#5b7c9d", icon: "rack_shelf", layer: "racks" },
  { kind: "shelf_inv",   label: "Стеллаж инвентаря",  w: 1000, h: 500, color: "#5b6b52", icon: "rack_shelf", layer: "racks" },
  // ── Мебель / рабочие места ──
  { kind: "table_sow",   label: "Стол посева",        w: 2000, h: 800, color: "#8a6d3b", icon: "table_sowing",  layer: "furn" },
  { kind: "table_recv",  label: "Стол приёмки",       w: 2000, h: 800, color: "#8a6d3b", icon: "table_receiving", layer: "furn" },
  { kind: "table_manip", label: "Стол манипуляций",   w: 1500, h: 700, color: "#8a6d3b", icon: "table_packaging", layer: "furn" },
  { kind: "table_subs",  label: "Стол субстрата",     w: 1500, h: 700, color: "#8a6d3b", icon: "table_packaging", layer: "furn" },
  { kind: "chair",       label: "Стул",               w: 450, h: 450, color: "#5b6b52", icon: "chair",  layer: "furn" },
  { kind: "bench",       label: "Лавочка",            w: 1200, h: 350, color: "#5b6b52", icon: "bench",  layer: "furn" },
  { kind: "wardrobe",    label: "Шкаф раздевалки",    w: 500, h: 600, color: "#8a6d3b", icon: "wardrobe", layer: "furn" },
  { kind: "hanger",      label: "Вешалка",            w: 900, h: 250, color: "#8a6d3b", icon: "hanger", layer: "furn" },
  { kind: "notebook",    label: "Ноутбук",            w: 370, h: 260, color: "#475c52", icon: "notebook", layer: "furn" },
  { kind: "trolley",     label: "Тележка растений",   w: 1000, h: 600, color: "#b9741d", icon: "trolley_plant", layer: "furn" },
  { kind: "ladder",      label: "Стремянка",          w: 500, h: 600, color: "#b9741d", icon: "ladder", layer: "furn" },
  { kind: "trashcan",    label: "Мусорный бак",       w: 500, h: 500, color: "#475c52", icon: "bin_trash", layer: "furn" },
  { kind: "scales_fl",   label: "Весы напольные",     w: 700, h: 700, color: "#475c52", icon: "scales_floor", layer: "furn" },
  { kind: "scales_tb",   label: "Весы настольные",    w: 320, h: 280, color: "#475c52", icon: "scales_bench", layer: "furn" },
  // ── Климат ──
  { kind: "fridge",      label: "Холодильник",        w: 800, h: 600, color: "#5b7c9d", icon: "fridge", layer: "climate" },
  { kind: "freezer",     label: "Морозилка",          w: 1000, h: 500, color: "#5b7c9d", icon: "freezer", layer: "climate" },
  { kind: "recirc",      label: "Бактерицидный рециркулятор", w: 300, h: 310, color: "#5b7c9d", icon: "recirc", layer: "climate", wall: true },
  { kind: "ac_indoor",   label: "Внутренний блок",    w: 800, h: 250, color: "#5b7c9d", icon: "ac_indoor", layer: "climate", wall: true },
  { kind: "ac_outdoor",  label: "Внешний блок",       w: 850, h: 350, color: "#5b7c9d", icon: "ac_out", layer: "climate" },
  { kind: "ac_floor",    label: "Напольный кондиционер", w: 600, h: 350, color: "#5b7c9d", icon: "ac_indoor", layer: "climate" },
  { kind: "ac_duct",     label: "Канальный блок",     w: 1000, h: 700, color: "#5b7c9d", icon: "vent_duct", layer: "climate" },
  // ── Водоснабжение ──
  { kind: "osmosis",     label: "Обратный осмос",     w: 1000, h: 400, color: "#2f6f8f", icon: "osmosis_filters", layer: "water" },
  { kind: "water_prep",  label: "Водоподготовка",     w: 2030, h: 410, color: "#2f6f8f", icon: "osmosis_filters", layer: "water" },
  // ── Санитария ──
  { kind: "sink_susp",   label: "Раковина подвесная", w: 600, h: 400, color: "#2f6f8f", icon: "sink_single", layer: "sanitary", wall: true },
  { kind: "sink_table",  label: "Раковина настольная", w: 600, h: 500, color: "#2f6f8f", icon: "sink_single", layer: "sanitary" },
  { kind: "sink_double", label: "Двойная раковина",   w: 1200, h: 450, color: "#2f6f8f", icon: "sink_double", layer: "sanitary", wall: true },
  { kind: "toilet",      label: "Унитаз",             w: 380, h: 650, color: "#475c52", icon: "toilet", layer: "sanitary", wall: true },
  { kind: "bidet",       label: "Биде",               w: 380, h: 600, color: "#475c52", icon: "bidet", layer: "sanitary", wall: true },
  { kind: "shower_pan",  label: "Душевой поддон",     w: 900, h: 900, color: "#2f6f8f", icon: "shower", layer: "sanitary" },
  { kind: "shower_sys",  label: "Душевая система",    w: 250, h: 120, color: "#2f6f8f", icon: "showerhead", layer: "sanitary", wall: true },
  { kind: "trap",        label: "Трап",               w: 200, h: 200, color: "#7a5c3e", icon: "trap",   layer: "sanitary" },
  { kind: "mirror",      label: "Зеркало",            w: 600, h: 80, color: "#5b7c9d", icon: "mirror", layer: "sanitary", wall: true },
  { kind: "dispenser",   label: "Диспенсер/санитайзер", w: 150, h: 110, color: "#2f6f8f", icon: "dispenser", layer: "sanitary", wall: true },
  { kind: "dezmat",      label: "Диз. коврик",        w: 900, h: 600, color: "#9c6b9c", icon: "dezmat", layer: "sanitary" },
  // ── Полив ──
  { kind: "tank",        label: "Ёмкость",            w: 800, h: 800, color: "#1f6f8b", icon: "tank_round", layer: "irrigation" },
  { kind: "pump",        label: "Насос",              w: 350, h: 250, color: "#b9741d", icon: "pump_inline", layer: "irrigation" },
  // ── Дренаж ──
  { kind: "tank_waste",  label: "Бак отходов",        w: 600, h: 600, color: "#7a5c3e", icon: "tank_waste", layer: "drain" },
  // ── Электрика ──
  { kind: "panel",       label: "Электрощит",         w: 600, h: 200, color: "#a5371f", icon: "panel",  layer: "power", wall: true, params: { ratedW: 22000 } },
  { kind: "socket",      label: "Розетка/блок",       w: 150, h: 80, color: "#c44a2f", icon: "socket",  layer: "sockets", wall: true },
  { kind: "light_panel", label: "Светильник",         w: 600, h: 120, color: "#d4a017", icon: "light",   layer: "light", wall: true },
  // ── Вентиляция ──
  { kind: "vent_unit",   label: "Вентустановка",      w: 800, h: 600, color: "#6b7d74", icon: "vent",   layer: "vent" },
  { kind: "blade_fan",   label: "Вентилятор",         w: 600, h: 600, color: "#6b7d74", icon: "fan_round", layer: "vent", wall: true },
  // ── Исходный план: двери / окна ──
  { kind: "door",        label: "Дверь",              w: 900, h: 120, color: "#14201b", icon: "door",   layer: "room", wall: true },
  { kind: "door2",       label: "Дверь распашная",    w: 1400, h: 120, color: "#14201b", icon: "door2",  layer: "room", wall: true },
  { kind: "window",      label: "Окно",               w: 1200, h: 120, color: "#14201b", icon: "window", layer: "room", wall: true },
  // ── Персонал ──
  { kind: "person",      label: "Человек",            w: 450, h: 450, color: "#b9741d", icon: "person", layer: "staff" },
];
export const catalogByKind = (kind) => CATALOG.find((c) => c.kind === kind) || CATALOG[0];
export const catalogForLayer = (layer) => CATALOG.filter((c) => c.layer === layer);

export const RACK_PRESETS = [
  { w: 1000, h: 500 }, { w: 1220, h: 600 }, { w: 1500, h: 600 },
  { w: 2000, h: 600 }, { w: 3000, h: 600 }, { w: 1220, h: 800 },
];

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const snap = (v, step, on = true) => (on ? Math.round(v / step) * step : Math.round(v));
export function polyLength(pts) { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); return l; }
export const fmt = (mm, unit = "mm") => {
  const v = Math.round(mm);
  if (unit === "m") return (v / 1000).toFixed(2).replace(/\.?0+$/, "") + " м";
  return v.toLocaleString("ru-RU") + " мм";
};
export const areaM2 = (w, h) => ((w / 1000) * (h / 1000)).toFixed(2);

export const DEFAULT_PLAN = () => ({
  unit: "mm",
  room: { w: 12000, h: 8000, wallThk: 120, height: 3000, showBoundary: false },
  walls: [], items: [], lines: [], links: [], zones: [], labels: [],
});

/** Правила инженерных связей: от кого → к кому. */
export const LINK_RULES = {
  irrigation: {
    label: "Полив",
    color: "#1f6f8b",
    from: new Set(["rack", "seed_rack", "pump"]),
    to: new Set(["tank", "pump", "osmosis", "water_prep"]),
  },
  power: {
    label: "Электрика",
    color: "#a5371f",
    from: new Set(["socket", "light_panel", "rack", "seed_rack", "pump"]),
    to: new Set(["panel"]),
  },
  drain: {
    label: "Дренаж",
    color: "#7a5c3e",
    from: new Set(["trap", "sink_susp", "sink_table", "sink_double", "shower_pan"]),
    to: new Set(["tank_waste"]),
  },
};

export const DEFAULT_DISPLAY = () => ({
  showDims: true,
  showLabels: true,
  showHints: true,
  showGrid: true,
  showMinorGrid: true,
  showZoneNames: true,
  showZoneAreas: true,
  snapOn: true,
  snapWalls: true,
  snapObjects: true,
  snapGrid: true,
  dimInactive: true,
  hideInactive: false,
  highlightActive: true,
  highlightRacks: false,
  highlightSockets: false,
  highlightFurniture: false,
  highlightErrors: true,
  showZoneFlow: true,
  showLinks: true,
  onlyInsideRooms: false,
});
