/**
 * Реестр инструментов планировщика.
 * mode: select | wall | zone | line | link | measure | label | pan | add | comment | action | view-toggle | placeholder
 */
export const TOOL_REGISTRY = {
  select: { id: "select", label: "Выбор", mode: "select", categories: ["*"] },
  erase: { id: "erase", label: "Удалить", mode: "erase", categories: ["*"] },
  pan: { id: "pan", label: "Рука", mode: "pan", categories: ["*"] },
  measure: { id: "measure", label: "Размер", mode: "measure", categories: ["*"] },
  label: { id: "label", label: "Подпись", mode: "label", categories: ["*"] },
  comment: { id: "comment", label: "Комментарий", mode: "label", categories: ["comments"] },
  link: { id: "link", label: "Связь", mode: "link", categories: ["racks", "water", "drain", "power", "light"] },
  line: { id: "line", label: "Трасса", mode: "line", categories: ["water", "drain", "power", "light", "vent", "routes"] },

  wall_draw: { id: "wall_draw", label: "Нарисовать стену", mode: "wall", categories: ["walls", "parts"] },
  wall_bearing: { id: "wall_bearing", label: "Несущая стена", mode: "wall", categories: ["walls", "parts"] },
  wall_pgb: { id: "wall_pgb", label: "Перегородка из ПГБ", mode: "wall", categories: ["parts"] },
  wall_foam: { id: "wall_foam", label: "Перегородка из пеноблоков", mode: "wall", categories: ["parts"] },
  wall_outline: { id: "wall_outline", label: "Нарисовать внешний контур", mode: "wall", categories: ["walls"], hint: "Замкните контур по периметру" },
  room_by_size: { id: "room_by_size", label: "Нарисовать помещение по размерам", mode: "zone", categories: ["zones"] },
  column: { id: "column", label: "Колонна", mode: "structural", kind: "column", categories: ["walls"] },
  beam: { id: "beam", label: "Ригель", mode: "structural", kind: "beam", categories: ["walls"] },
  border: { id: "border", label: "Бордюр", mode: "structural", kind: "border", categories: ["walls"] },
  opening_floor: { id: "opening_floor", label: "Проём в полу", mode: "placeholder", categories: ["openings"] },
  opening_tech: { id: "opening_tech", label: "Технический проём", mode: "add", kind: "opening", categories: ["openings"] },
  opening_comm: { id: "opening_comm", label: "Коммуникационная проходка", mode: "placeholder", categories: ["openings"] },
  gate_zone: { id: "gate_zone", label: "Ворота / зона отгрузки", mode: "add", kind: "door_gate", categories: ["openings"] },
  ext_pad: { id: "ext_pad", label: "Внешняя площадка", mode: "zone", categories: ["zones"] },
  backdrop: { id: "backdrop", label: "Загрузить подложку PNG/JPG", mode: "action", action: "backdrop_upload", categories: ["walls"] },
  backdrop_scale: { id: "backdrop_scale", label: "Масштаб подложки", mode: "action", action: "backdrop_scale", categories: ["walls"] },
  backdrop_clear: { id: "backdrop_clear", label: "Убрать подложку", mode: "action", action: "backdrop_clear", categories: ["walls"] },

  doors_group: {
    id: "doors_group", label: "Двери и проёмы", categories: ["openings"],
    children: ["opening_none", "door_std", "door2", "door_pivot", "door_cold", "door_gate", "door_sanitary"],
  },
  opening_none: { id: "opening_none", label: "Проём без двери", mode: "add", kind: "opening", categories: ["openings"] },
  door_std: { id: "door_std", label: "Дверь стандартная", mode: "add", kind: "door", categories: ["openings"] },
  door2: { id: "door2", label: "Дверь 2-створчатая", mode: "add", kind: "door2", categories: ["openings"] },
  door_pivot: { id: "door_pivot", label: "Дверь маятниковая", mode: "add", kind: "door_pivot", categories: ["openings"] },
  door_cold: { id: "door_cold", label: "Дверь холодильная", mode: "add", kind: "door_cold", categories: ["openings"] },
  door_sanitary: { id: "door_sanitary", label: "Санитарный шлюз", mode: "add", kind: "door_sanitary", categories: ["openings"] },
  windows_group: {
    id: "windows_group", label: "Окна", categories: ["openings"],
    children: ["window_std"],
  },
  window_std: { id: "window_std", label: "Окно", mode: "add", kind: "window", categories: ["openings"] },

  wall_sandwich: { id: "wall_sandwich", label: "Сэндвич-панель PIR/PUR", mode: "wall", categories: ["parts"] },
  wall_food: { id: "wall_food", label: "Пищевая моющаяся панель", mode: "wall", categories: ["parts"] },
  wall_cold: { id: "wall_cold", label: "Холодильная панель", mode: "wall", categories: ["parts"] },
  wall_pvc: { id: "wall_pvc", label: "ПВХ-панель / санитарная облицовка", mode: "wall", categories: ["parts"] },
  wall_brick: { id: "wall_brick", label: "Кирпичная перегородка", mode: "wall", categories: ["parts"] },
  wall_gkl: { id: "wall_gkl", label: "Гипсокартон", mode: "wall", categories: ["parts"] },
  wall_glass: { id: "wall_glass", label: "Стеклянная перегородка", mode: "wall", categories: ["parts"] },
  wall_lath: { id: "wall_lath", label: "Реечная перегородка", mode: "wall", categories: ["parts"] },
  wall_light: { id: "wall_light", label: "Лёгкая перегородка / сетка", mode: "wall", categories: ["parts"] },
  wall_box: { id: "wall_box", label: "Гипсокартонный короб", mode: "wall", categories: ["parts"] },
  sanitary_lock: { id: "sanitary_lock", label: "Санитарный шлюз", mode: "add", kind: "door_sanitary", categories: ["parts"] },
  zone_room: { id: "zone_room", label: "Зонировать помещение", mode: "zone", categories: ["parts", "zones"] },
  part_opening: { id: "part_opening", label: "Проём в перегородке", mode: "add", kind: "opening", categories: ["parts"] },
  part_door: { id: "part_door", label: "Дверь в перегородке", mode: "add", kind: "door", categories: ["parts"] },

  zone_assign: { id: "zone_assign", label: "Назначить помещение", mode: "zone", categories: ["zones"] },
  zone_clean: { id: "zone_clean", label: "Чистая зона", mode: "zone", categories: ["zones"], zoneFlow: "clean" },
  zone_dirty: { id: "zone_dirty", label: "Грязная зона", mode: "zone", categories: ["zones"], zoneFlow: "dirty" },
  zone_buffer: { id: "zone_buffer", label: "Условно чистая зона", mode: "zone", categories: ["zones"], zoneFlow: "buffer" },
  zone_seed: { id: "zone_seed", label: "Посевная зона", mode: "zone", categories: ["zones"] },
  zone_grow: { id: "zone_grow", label: "Выращивание", mode: "zone", categories: ["zones"] },
  zone_pack: { id: "zone_pack", label: "Упаковка", mode: "zone", categories: ["zones"] },
  zone_gas: { id: "zone_gas", label: "Газация", mode: "zone", categories: ["zones"] },
  zone_waste: { id: "zone_waste", label: "Отходы", mode: "zone", categories: ["zones"] },
  zone_water_prep: { id: "zone_water_prep", label: "Водоподготовка", mode: "zone", categories: ["zones"] },
  zone_storage: { id: "zone_storage", label: "Склад", mode: "zone", categories: ["zones"] },
  zone_cold_room: { id: "zone_cold_room", label: "Холодильная камера", mode: "zone", categories: ["zones"] },
  zone_sanlock: { id: "zone_sanlock", label: "Санпропускник", mode: "zone", categories: ["zones"] },
  zone_tech: { id: "zone_tech", label: "Техническая зона", mode: "zone", categories: ["zones"] },
  zone_staff: { id: "zone_staff", label: "Комната персонала", mode: "zone", categories: ["zones"] },
  zone_shower: { id: "zone_shower", label: "Душевая", mode: "zone", categories: ["zones"] },
  zone_wc: { id: "zone_wc", label: "Санузел", mode: "zone", categories: ["zones"] },
  zone_corridor: { id: "zone_corridor", label: "Коридор / транзит", mode: "zone", categories: ["zones"] },
  zone_ship: { id: "zone_ship", label: "Отгрузка", mode: "zone", categories: ["zones"] },
  zone_recv: { id: "zone_recv", label: "Приёмка", mode: "zone", categories: ["zones"] },

  racks_group: {
    id: "racks_group", label: "Стеллажи", categories: ["racks"],
    children: [
      "rack_nft_2000_740",
      "rack_nft_2000_1000",
      "rack_aeroponic_2000_1000",
      "rack_strawberry_2000_1000",
      "rack_seedling_2000_600",
      "rack_microgreens_1200_600",
      "rack_storage_1500_600",
      "rack_custom",
    ],
  },
  rack_nft: { id: "rack_nft", label: "Стеллаж NFT", mode: "add", kind: "rack", categories: ["racks"] },
  rack_nft_2000_740: {
    id: "rack_nft_2000_740", label: "NFT 2000×740 мм", mode: "add", kind: "rack", categories: ["racks"],
    farmPresetId: "nft_2000_740", size: { w: 2000, h: 740 },
  },
  rack_nft_2000_1000: {
    id: "rack_nft_2000_1000", label: "NFT 2000×1000 мм", mode: "add", kind: "rack", categories: ["racks"],
    farmPresetId: "nft_2000_1000", size: { w: 2000, h: 1000 },
  },
  rack_aeroponic_2000_1000: {
    id: "rack_aeroponic_2000_1000", label: "Аэропоника 2000×1000 мм", mode: "add", kind: "rack", categories: ["racks"],
    farmPresetId: "aeroponic_2000_1000", size: { w: 2000, h: 1000 },
  },
  rack_strawberry_2000_1000: {
    id: "rack_strawberry_2000_1000", label: "Клубника 2000×1000 мм", mode: "add", kind: "rack", categories: ["racks"],
    farmPresetId: "strawberry_2000_1000", size: { w: 2000, h: 1000 },
  },
  rack_seedling_2000_600: {
    id: "rack_seedling_2000_600", label: "Рассадный 2000×600 мм", mode: "add", kind: "seed_rack", categories: ["racks"],
    farmPresetId: "seedling_2000_600", size: { w: 2000, h: 600 },
  },
  rack_microgreens_1200_600: {
    id: "rack_microgreens_1200_600", label: "Микрозелень 1200×600 мм", mode: "add", kind: "rack", categories: ["racks"],
    farmPresetId: "microgreens_1200_600", size: { w: 1200, h: 600 },
  },
  rack_storage_1500_600: {
    id: "rack_storage_1500_600", label: "Хранение 1500×600 мм", mode: "add", kind: "shelf_cons", categories: ["racks"],
    farmPresetId: "storage_1500_600", size: { w: 1500, h: 600 },
  },
  rack_storage: { id: "rack_storage", label: "Стеллаж хранения", mode: "add", kind: "shelf_cons", categories: ["racks"], farmPresetId: "storage_1500_600", size: { w: 1500, h: 600 } },
  rack_cons: { id: "rack_cons", label: "Стеллаж расходников", mode: "add", kind: "shelf_cons", categories: ["racks"] },
  rack_custom: { id: "rack_custom", label: "Пользовательский размер", mode: "add", kind: "rack", categories: ["racks"] },
  rack_row: { id: "rack_row", label: "Создать ряд", mode: "action", action: "rack_row", categories: ["racks"] },
  rack_block: { id: "rack_block", label: "Создать блок", mode: "action", action: "rack_grid", categories: ["racks"] },
  rack_number: { id: "rack_number", label: "Нумерация стеллажей", mode: "action", action: "rack_number", categories: ["racks"] },
  rack_aisle: { id: "rack_aisle", label: "Проходы между рядами", mode: "placeholder", categories: ["racks"] },
  rack_service: { id: "rack_service", label: "Сервисная зона стеллажа", mode: "placeholder", categories: ["racks"] },
  link_tank: { id: "link_tank", label: "Привязать к баку", mode: "link", categories: ["racks"] },
  link_pump: { id: "link_pump", label: "Привязать к насосу", mode: "link", categories: ["racks"] },
  link_drain: { id: "link_drain", label: "Привязать к дренажу", mode: "link", categories: ["racks"] },
  link_socket: { id: "link_socket", label: "Привязать к розетке", mode: "link", categories: ["racks"] },
  link_light: { id: "link_light", label: "Привязать к группе света", mode: "link", categories: ["racks"] },

  table_sow: { id: "table_sow", label: "Стол посева", mode: "add", kind: "table_sow", categories: ["furn"] },
  table_manip: { id: "table_manip", label: "Стол манипуляций", mode: "add", kind: "table_manip", categories: ["furn"] },
  table_pack: { id: "table_pack", label: "Стол упаковки", mode: "add", kind: "table_subs", categories: ["furn"] },
  table_recv: { id: "table_recv", label: "Стол приёмки", mode: "add", kind: "table_recv", categories: ["furn"] },
  table_subs: { id: "table_subs", label: "Стол субстрата", mode: "add", kind: "table_subs", categories: ["furn"] },
  trolley_plant: { id: "trolley_plant", label: "Тележка растений", mode: "add", kind: "trolley", categories: ["furn"] },
  scales_fl: { id: "scales_fl", label: "Весы напольные", mode: "add", kind: "scales_fl", categories: ["furn"] },
  scales_tb: { id: "scales_tb", label: "Весы настольные", mode: "add", kind: "scales_tb", categories: ["furn"] },
  fridge: { id: "fridge", label: "Холодильник", mode: "add", kind: "fridge", categories: ["furn", "cold", "climate"] },
  freezer: { id: "freezer", label: "Морозилка", mode: "add", kind: "freezer", categories: ["furn", "cold", "climate"] },
  wardrobe: { id: "wardrobe", label: "Шкаф", mode: "add", kind: "wardrobe", categories: ["furn"] },
  bench: { id: "bench", label: "Лавка", mode: "add", kind: "bench", categories: ["furn"] },
  hanger: { id: "hanger", label: "Вешалка", mode: "add", kind: "hanger", categories: ["furn"] },
  chair: { id: "chair", label: "Стул", mode: "add", kind: "chair", categories: ["furn"] },
  trashcan: { id: "trashcan", label: "Мусорный бак", mode: "add", kind: "trashcan", categories: ["furn"] },
  ladder: { id: "ladder", label: "Стремянка", mode: "add", kind: "ladder", categories: ["furn"] },
  shelf_inv: { id: "shelf_inv", label: "Стеллаж инвентаря", mode: "add", kind: "shelf_inv", categories: ["furn"] },

  sink_susp: { id: "sink_susp", label: "Раковина", mode: "add", kind: "sink_susp", categories: ["plumb"] },
  sink_double: { id: "sink_double", label: "Двойная мойка", mode: "add", kind: "sink_double", categories: ["plumb"] },
  sink_table: { id: "sink_table", label: "Мойка рук", mode: "add", kind: "sink_table", categories: ["plumb"] },
  toilet: { id: "toilet", label: "Унитаз", mode: "add", kind: "toilet", categories: ["plumb"] },
  shower_pan: { id: "shower_pan", label: "Душевой поддон", mode: "add", kind: "shower_pan", categories: ["plumb"] },
  shower_sys: { id: "shower_sys", label: "Душевая система", mode: "add", kind: "shower_sys", categories: ["plumb"] },
  trap: { id: "trap", label: "Трап", mode: "add", kind: "trap", categories: ["plumb", "drain"] },
  dispenser: { id: "dispenser", label: "Диспенсер", mode: "add", kind: "dispenser", categories: ["plumb", "hygiene"] },
  dezmat: { id: "dezmat", label: "Дизковрик", mode: "add", kind: "dezmat", categories: ["plumb", "hygiene"] },

  tanks_group: {
    id: "tanks_group", label: "Баки", categories: ["water"],
    children: ["tank_clean", "tank_solution", "tank_drain_collection", "tank_waste_liquid", "tank_acid", "tank_a", "tank_b", "tank_rect", "tank_round"],
  },
  tank_clean: { id: "tank_clean", label: "Бак чистой воды", mode: "add", kind: "tank", categories: ["water"], params: { tankType: "clean_water_tank", system: "clean_water" } },
  tank_solution: { id: "tank_solution", label: "Бак раствора", mode: "add", kind: "tank", categories: ["water"], params: { tankType: "nutrient_solution", system: "irrigation" } },
  tank_drain_collection: { id: "tank_drain_collection", label: "Бак сбора дренажа", mode: "add", kind: "tank", categories: ["water", "drain"], defaultLabel: "Бак дренажа", params: { tankType: "drain_collection", system: "drainage" } },
  tank_waste_liquid: { id: "tank_waste_liquid", label: "Бак отходов", mode: "add", kind: "tank", categories: ["water", "drain"], defaultLabel: "Бак отходов", params: { tankType: "waste", system: "waste" } },
  tank_waste: { id: "tank_waste", label: "Бак для мусора", mode: "add", kind: "tank_waste", categories: ["furn"] },
  tank_acid: { id: "tank_acid", label: "Бак кислоты", mode: "add", kind: "tank", categories: ["water"], defaultLabel: "Бак кислоты" },
  tank_a: { id: "tank_a", label: "Бак удобрения А", mode: "add", kind: "tank", categories: ["water"], defaultLabel: "Бак удобрения А" },
  tank_b: { id: "tank_b", label: "Бак удобрения Б", mode: "add", kind: "tank", categories: ["water"], defaultLabel: "Бак удобрения Б" },
  tank_rect: { id: "tank_rect", label: "Прямоугольная ёмкость", mode: "add", kind: "tank", icon: "tank_rect", size: { w: 2080, h: 1370 }, categories: ["water"] },
  tank_round: { id: "tank_round", label: "Круглая ёмкость", mode: "add", kind: "tank", icon: "tank_round", size: { w: 2000, h: 2000 }, categories: ["water"] },
  pump: { id: "pump", label: "Насосная станция", mode: "add", kind: "pump", categories: ["water"] },
  osmosis: { id: "osmosis", label: "Обратный осмос", mode: "add", kind: "osmosis", categories: ["water"] },
  water_prep: { id: "water_prep", label: "Водоподготовка", mode: "add", kind: "water_prep", categories: ["water"] },
  water_line: {
    id: "water_line",
    label: "Труба подачи",
    mode: "line",
    categories: ["water"],
    lineLayer: "irrigation",
    pipeSystem: "irrigation",
    pipeRole: "supply",
    diameterMm: 32,
    material: "pp",
  },
  water_valve_group: {
    id: "water_valve_group",
    label: "Клапаны",
    categories: ["water"],
    children: ["water_valve_manual", "water_valve_solenoid", "water_valve_check", "water_valve_ball"],
  },
  water_valve: { id: "water_valve", label: "Клапан", mode: "add", kind: "water_valve", categories: ["water"], defaultLabel: "Клапан" },
  water_valve_manual: { id: "water_valve_manual", label: "Клапан ручной", mode: "add", kind: "water_valve", categories: ["water"], defaultLabel: "Клапан ручной", params: { valveType: "manual" } },
  water_valve_solenoid: { id: "water_valve_solenoid", label: "Клапан соленоид", mode: "add", kind: "water_valve", categories: ["water"], defaultLabel: "Клапан соленоид", params: { valveType: "solenoid" } },
  water_valve_check: { id: "water_valve_check", label: "Клапан обратный", mode: "add", kind: "water_valve", categories: ["water"], defaultLabel: "Клапан обратный", params: { valveType: "check" } },
  water_valve_ball: { id: "water_valve_ball", label: "Клапан шаровой", mode: "add", kind: "water_valve", categories: ["water"], defaultLabel: "Клапан шаровой", params: { valveType: "ball" } },

  drain_line: {
    id: "drain_line",
    label: "Труба слива",
    mode: "line",
    categories: ["drain"],
    lineLayer: "drain",
    pipeSystem: "drainage",
    pipeRole: "drain",
    diameterMm: 50,
    material: "pvc",
  },
  drain_main: {
    id: "drain_main",
    label: "Основной слив",
    mode: "line",
    categories: ["drain"],
    lineLayer: "drain",
    lineTag: "main",
    pipeSystem: "drainage",
    pipeRole: "main",
    diameterMm: 110,
    material: "pvc",
  },
  drain_emergency: {
    id: "drain_emergency",
    label: "Аварийный слив",
    mode: "line",
    categories: ["drain"],
    lineLayer: "drain",
    lineTag: "emergency",
    pipeSystem: "drainage",
    pipeRole: "overflow",
    diameterMm: 50,
    material: "pvc",
  },

  sockets_group: {
    id: "sockets_group", label: "Розетки", categories: ["power"],
    children: ["socket_220", "socket_380", "socket_ip44", "socket_ip54", "socket_ip65", "socket_single", "socket_double", "socket_block"],
  },
  socket: { id: "socket", label: "Розетка", mode: "add", kind: "socket", categories: ["power"] },
  socket_220: { id: "socket_220", label: "220 В", mode: "add", kind: "socket", categories: ["power"], params: { socketType: "standard_220", voltage: 220, phases: 1 } },
  socket_380: { id: "socket_380", label: "380 В", mode: "add", kind: "socket", categories: ["power"], params: { socketType: "industrial_380", voltage: 380, phases: 3 } },
  socket_ip44: { id: "socket_ip44", label: "IP44", mode: "add", kind: "socket", categories: ["power"], params: { socketType: "waterproof_220", waterproof: true, protectionIp: "IP44" } },
  socket_ip54: { id: "socket_ip54", label: "IP54", mode: "placeholder", categories: ["power"] },
  socket_ip65: { id: "socket_ip65", label: "IP65", mode: "placeholder", categories: ["power"] },
  socket_single: { id: "socket_single", label: "Одинарная", mode: "add", kind: "socket", categories: ["power"] },
  socket_double: { id: "socket_double", label: "Двойная", mode: "placeholder", categories: ["power"] },
  socket_block: { id: "socket_block", label: "Розеточный блок", mode: "add", kind: "socket", categories: ["power"] },
  socket_pump: { id: "socket_pump", label: "Розетка насоса", mode: "add", kind: "socket", categories: ["power"], params: { socketType: "pump_socket", groupName: "B", linkedObjectId: null } },
  socket_light: { id: "socket_light", label: "Розетка света", mode: "add", kind: "socket", categories: ["power"], params: { socketType: "light_socket", groupName: "D" } },
  socket_service: { id: "socket_service", label: "Сервисная розетка", mode: "add", kind: "socket", categories: ["power"], params: { socketType: "service_socket", groupName: "E" } },
  socket_sensor: { id: "socket_sensor", label: "Розетка датчика", mode: "add", kind: "socket", categories: ["power"], params: { socketType: "sensor_socket", groupName: "E" } },

  light_panel: { id: "light_panel", label: "Светильник", mode: "add", kind: "light_panel", categories: ["light"], params: { lightType: "linear_100", lengthMm: 1000, groupName: "D" } },
  light_linear_60: { id: "light_linear_60", label: "Линейный 60 см", mode: "add", kind: "light_panel", categories: ["light"], params: { lightType: "linear_60", lengthMm: 600, groupName: "D" } },
  light_linear_100: { id: "light_linear_100", label: "Линейный 100 см", mode: "add", kind: "light_panel", categories: ["light"], params: { lightType: "linear_100", lengthMm: 1000, groupName: "D" } },
  light_linear_120: { id: "light_linear_120", label: "Линейный 120 см", mode: "add", kind: "light_panel", categories: ["light"], params: { lightType: "linear_120", lengthMm: 1200, groupName: "D" } },
  light_quantum: { id: "light_quantum", label: "Quantum board", mode: "add", kind: "light_panel", categories: ["light"], params: { lightType: "quantum_board", lengthMm: 600, groupName: "D" } },
  light_service: { id: "light_service", label: "Сервисный свет", mode: "add", kind: "light_panel", categories: ["light"], params: { lightType: "service_light", lengthMm: 1200, groupName: "E" } },
  light_germination: { id: "light_germination", label: "Свет для рассады", mode: "add", kind: "light_panel", categories: ["light"], params: { lightType: "germination_light", lengthMm: 1000, groupName: "D" } },
  lighting_group: { id: "lighting_group", label: "Группа освещения", mode: "add", kind: "lighting_group", categories: ["light"], params: { name: "D", groupName: "D", voltage: 220, phases: 1 } },
  add_light_to_rack: { id: "add_light_to_rack", label: "Добавить свет на стеллаж", mode: "action", action: "rack_add_light", categories: ["light", "racks"] },
  light_line: { id: "light_line", label: "LED-линия", mode: "line", categories: ["light"], lineLayer: "light" },
  light_zone: { id: "light_zone", label: "Зона света", mode: "zone", categories: ["light"] },

  power_line: { id: "power_line", label: "Силовой кабель", mode: "line", categories: ["power"], lineLayer: "power", lineTag: "power" },
  wall_cable: { id: "wall_cable", label: "Кабель по стене", mode: "line", categories: ["power"], lineLayer: "power", lineTag: "wall_cable" },
  ceiling_cable: { id: "ceiling_cable", label: "Кабель по потолку", mode: "line", categories: ["power"], lineLayer: "power", lineTag: "ceiling_cable" },
  floor_cable: { id: "floor_cable", label: "Кабель по полу", mode: "line", categories: ["power"], lineLayer: "power", lineTag: "floor_cable" },
  tray_cable: { id: "tray_cable", label: "Линия в лотке", mode: "line", categories: ["power"], lineLayer: "power", lineTag: "cable_tray" },
  low_line: { id: "low_line", label: "Слаботочный кабель", mode: "line", categories: ["power"], lineLayer: "power", lineTag: "low" },
  light_cable: { id: "light_cable", label: "Кабель освещения", mode: "line", categories: ["power", "light"], lineLayer: "light" },
  sensor_cable: { id: "sensor_cable", label: "Кабель датчиков", mode: "line", categories: ["power"], lineLayer: "power", lineTag: "sensor" },
  ground_line: { id: "ground_line", label: "Заземление", mode: "line", categories: ["power"], lineLayer: "power", lineTag: "ground" },

  panel: { id: "panel", label: "Щит", mode: "add", kind: "panel", categories: ["power"] },
  cable_tray: { id: "cable_tray", label: "Кабельный лоток", mode: "add", kind: "cable_tray", categories: ["power"] },
  junction_box: { id: "junction_box", label: "Распредкоробка", mode: "add", kind: "junction_box", categories: ["power"] },
  switch: { id: "switch", label: "Выключатель", mode: "add", kind: "switch", categories: ["power", "light"] },
  sensor: { id: "sensor", label: "Датчик", mode: "add", kind: "sensor", categories: ["power", "light", "climate"] },
  relay_box: { id: "relay_box", label: "Релейный блок", mode: "add", kind: "relay_box", categories: ["power"] },
  climate_system: {
    id: "climate_system",
    label: "Система кондиционирования",
    mode: "add",
    kind: "air_conditioner",
    categories: ["ac", "climate"],
    params: { coolingPowerKw: 0, heatingPowerKw: 0, airflowM3h: 2000, drainRequired: true },
  },
  indoor_unit: { id: "indoor_unit", label: "Внутренний блок", mode: "add", kind: "ac_indoor", categories: ["ac", "climate"], params: { airflowM3h: 1200 } },
  outdoor_unit: { id: "outdoor_unit", label: "Внешний блок", mode: "add", kind: "ac_outdoor", categories: ["ac", "climate"], params: { airflowM3h: 1800 } },
  ac_indoor: { id: "ac_indoor", label: "Внутренний блок", mode: "add", kind: "ac_indoor", categories: ["ac", "climate"], params: { airflowM3h: 1200 } },
  ac_outdoor: { id: "ac_outdoor", label: "Внешний блок", mode: "add", kind: "ac_outdoor", categories: ["ac", "climate"], params: { airflowM3h: 1800 } },
  ac_duct: { id: "ac_duct", label: "Канальный блок", mode: "add", kind: "ac_duct", categories: ["ac", "climate"], params: { airflowM3h: 1600 } },
  ac_floor: { id: "ac_floor", label: "Напольный блок", mode: "add", kind: "ac_floor", categories: ["ac", "climate"], params: { airflowM3h: 1500 } },
  dehumidifier: { id: "dehumidifier", label: "Осушитель", mode: "add", kind: "dehumidifier", categories: ["climate"], params: { capacityLDay: 80, powerW: 1200, airflow: 900 } },
  humidifier: { id: "humidifier", label: "Увлажнитель", mode: "add", kind: "humidifier", categories: ["climate"], params: { capacityLh: 5, powerW: 300, waterConnection: true } },
  climate_controller: { id: "climate_controller", label: "Климат-контроллер", mode: "add", kind: "climate_controller", categories: ["climate"] },
  temperature_sensor: { id: "temperature_sensor", label: "Датчик температуры", mode: "add", kind: "temperature_sensor", categories: ["climate"], params: { sensorType: "temperature" } },
  humidity_sensor: { id: "humidity_sensor", label: "Датчик влажности", mode: "add", kind: "humidity_sensor", categories: ["climate"], params: { sensorType: "humidity" } },
  co2_sensor: { id: "co2_sensor", label: "Датчик CO2", mode: "add", kind: "co2_sensor", categories: ["climate"], params: { sensorType: "co2" } },
  air_quality_sensor: { id: "air_quality_sensor", label: "Датчик качества воздуха", mode: "add", kind: "air_quality_sensor", categories: ["climate"], params: { sensorType: "air_quality" } },
  dew_point_sensor: { id: "dew_point_sensor", label: "Датчик точки росы", mode: "add", kind: "dew_point_sensor", categories: ["climate"], params: { sensorType: "dew_point" } },
  pressure_sensor: { id: "pressure_sensor", label: "Датчик давления", mode: "add", kind: "pressure_sensor", categories: ["climate"], params: { sensorType: "pressure" } },
  ac_line: { id: "ac_line", label: "Трасса кондиционера", mode: "line", categories: ["ac", "climate"], lineLayer: "climate", lineTag: "duct", lineType: "duct", diameterMm: 200, flowDirection: "forward" },

  duct_tool: { id: "duct_tool", label: "Воздуховод", mode: "line", categories: ["vent", "climate"], lineLayer: "vent", lineTag: "duct", lineType: "duct", diameterMm: 250, flowDirection: "forward" },
  vent_line_out: { id: "vent_line_out", label: "Воздуховод вытяжной", mode: "line", categories: ["vent"], lineLayer: "vent", lineTag: "exhaust", lineType: "exhaust_duct", diameterMm: 250, flowDirection: "forward" },
  vent_line_in: { id: "vent_line_in", label: "Воздуховод приточный", mode: "line", categories: ["vent"], lineLayer: "vent", lineTag: "supply", lineType: "supply_duct", diameterMm: 250, flowDirection: "forward" },
  vent_recirc: { id: "vent_recirc", label: "Рециркуляция", mode: "line", categories: ["vent"], lineLayer: "vent", lineTag: "recirc", lineType: "recirculation_duct", diameterMm: 200, flowDirection: "forward" },
  airflow_arrow: { id: "airflow_arrow", label: "Стрелка потока", mode: "line", categories: ["vent", "climate"], lineLayer: "vent", lineTag: "airflow_arrow", lineType: "airflow_arrow", diameterMm: 100, flowDirection: "forward" },
  vent_unit: { id: "vent_unit", label: "Вентустановка", mode: "add", kind: "vent_unit", categories: ["vent"], params: { airflowM3h: 3500 } },
  supply_grille: { id: "supply_grille", label: "Приточная решетка", mode: "add", kind: "supply", categories: ["vent"], params: { airflowM3h: 1200 } },
  exhaust_grille: { id: "exhaust_grille", label: "Вытяжная решетка", mode: "add", kind: "exhaust", categories: ["vent"], params: { airflowM3h: 1200 } },
  duct_damper: { id: "duct_damper", label: "Заслонка", mode: "add", kind: "duct_damper", categories: ["vent"] },
  fans_group: {
    id: "fans_group", label: "Вентиляторы", categories: ["vent"],
    children: ["fan_axial", "fan_duct", "fan_wall", "fan_recirc"],
  },
  fan_axial: { id: "fan_axial", label: "Осевой вентилятор", mode: "add", kind: "blade_fan", categories: ["vent"], params: { airflowM3h: 2500, diameter: 400 } },
  fan_duct: { id: "fan_duct", label: "Канальный вентилятор", mode: "add", kind: "blade_fan", categories: ["vent"], defaultLabel: "Канальный вентилятор", params: { airflowM3h: 3200, diameter: 315 } },
  fan_wall: { id: "fan_wall", label: "Настенный вентилятор", mode: "add", kind: "blade_fan", categories: ["vent"], params: { airflowM3h: 1800, diameter: 300 } },
  fan_recirc: { id: "fan_recirc", label: "Рециркуляционный вентилятор", mode: "add", kind: "recirc", categories: ["vent", "climate"], params: { airflowM3h: 2000, direction: "clockwise" } },

  person: { id: "person", label: "Человек", mode: "add", kind: "person", categories: ["routes"] },
  route_staff: { id: "route_staff", label: "Персонал", mode: "line", categories: ["routes"], lineLayer: "staff", lineTag: "staff" },
  route_raw: { id: "route_raw", label: "Сырьё", mode: "line", categories: ["routes"], lineLayer: "staff", lineTag: "raw" },
  route_product: { id: "route_product", label: "Готовая продукция", mode: "line", categories: ["routes"], lineLayer: "staff", lineTag: "product" },
  route_waste: { id: "route_waste", label: "Отходы", mode: "line", categories: ["routes"], lineLayer: "staff", lineTag: "waste" },

  dezmat_hygiene: { id: "dezmat_hygiene", label: "Дизковрик", mode: "add", kind: "dezmat", categories: ["hygiene"] },
  recirc_hygiene: { id: "recirc_hygiene", label: "УФ-рециркулятор", mode: "add", kind: "recirc", categories: ["hygiene"] },

  view_client_layers: { id: "view_client_layers", label: "Показывать только разрешённые слои", mode: "view-toggle", displayKey: "hideInactive", categories: ["*"] },
  view_hide_comments: { id: "view_hide_comments", label: "Скрывать внутренние комментарии", mode: "view-toggle", displayKey: "showLabels", categories: ["*"] },
  view_show_dims: { id: "view_show_dims", label: "Показывать размеры", mode: "view-toggle", displayKey: "showDims", categories: ["*"] },
  view_show_errors: { id: "view_show_errors", label: "Показывать ошибки", mode: "view-toggle", displayKey: "highlightErrors", categories: ["*"] },
  view_show_ports: { id: "view_show_ports", label: "Показывать привязки", mode: "view-toggle", displayKey: "showPorts", categories: ["*"] },
  view_show_airflow: { id: "view_show_airflow", label: "Show Airflow", mode: "view-toggle", displayKey: "showLineArrows", categories: ["*"] },

  sync_spec: { id: "sync_spec", label: "Синхронизировать спецификацию", mode: "action", action: "sync_spec", categories: ["*"] },
};

export function resolveTool(id) {
  return TOOL_REGISTRY[id] || null;
}

export function resolveToolList(ids = []) {
  return ids.map((id) => resolveTool(id)).filter(Boolean);
}

export function flattenTools(ids = [], depth = 0) {
  if (depth > 4) return [];
  const out = [];
  for (const id of ids) {
    const t = resolveTool(id);
    if (!t) continue;
    if (t.children?.length) out.push(...flattenTools(t.children, depth + 1));
    else if (t.mode !== "placeholder") out.push(t);
  }
  return out;
}

/** Инструмент доступен пользователю (не заглушка). */
export function isImplementedTool(tool) {
  return !!tool && tool.mode !== "placeholder";
}

export function toolMatchesCategory(tool, categoryId) {
  if (!categoryId || categoryId === "search") return true;
  if (!tool?.categories) return true;
  if (tool.categories.includes("*")) return true;
  return tool.categories.includes(categoryId);
}

export function filterToolGroups(groups, categoryId) {
  if (!categoryId || categoryId === "search") return groups;
  return groups
    .map((g) => ({
      ...g,
      tools: (g.tools || []).filter((tid) => {
        const t = resolveTool(tid);
        if (!t) return false;
        if (t.children) return t.children.some((cid) => toolMatchesCategory(resolveTool(cid), categoryId));
        return toolMatchesCategory(t, categoryId);
      }),
    }))
    .filter((g) => g.tools.length > 0);
}
