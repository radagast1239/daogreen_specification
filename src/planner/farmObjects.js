import { catalogByKind } from "./catalog.js";
import { defaultConnectionPortsForKind } from "./objectProperties.js";
import { calculatePipeLength, estimatePipeFittings, normalizePipe } from "./pipes.js";
import { estimateCableSpecLength } from "./electrical.js";

export const FARM_OBJECT_CATEGORIES = [
  "rack",
  "nft_channel",
  "tray_rack",
  "aeroponic_rack",
  "strawberry_rack",
  "tank",
  "pump",
  "filter",
  "dosing_unit",
  "pipe",
  "drain_pipe",
  "valve",
  "light",
  "lighting_group",
  "electrical_panel",
  "power_line",
  "cable_tray",
  "junction_box",
  "switch",
  "socket",
  "sensor",
  "relay_box",
  "fan",
  "air_conditioner",
  "indoor_unit",
  "outdoor_unit",
  "duct",
  "exhaust",
  "supply",
  "circulation_fan",
  "dehumidifier",
  "humidifier",
  "co2_sensor",
  "temperature_sensor",
  "humidity_sensor",
  "air_quality_sensor",
  "dew_point_sensor",
  "pressure_sensor",
  "airflow_arrow",
  "climate_controller",
  "sink",
  "table",
  "cart",
  "cold_room_equipment",
  "sanitation",
  "storage",
  "custom",
];

export const RACK_TYPES = [
  "flood_table",
  "nft",
  "aeroponic",
  "strawberry",
  "seedling",
  "microgreens",
  "storage",
];

export const FARM_RACK_PRESETS = [
  { id: "nft_2000_740", name: "NFT 2000×740 мм", rackType: "nft", w: 2000, h: 740, levels: 6 },
  { id: "nft_2000_1000", name: "NFT 2000×1000 мм", rackType: "nft", w: 2000, h: 1000, levels: 6 },
  { id: "aeroponic_2000_1000", name: "Аэропоника 2000×1000 мм", rackType: "aeroponic", w: 2000, h: 1000, levels: 5 },
  { id: "strawberry_2000_1000", name: "Клубника 2000×1000 мм", rackType: "strawberry", w: 2000, h: 1000, levels: 5 },
  { id: "seedling_2000_600", name: "Рассадный 2000×600 мм", rackType: "seedling", w: 2000, h: 600, levels: 5 },
  { id: "microgreens_1200_600", name: "Микрозелень 1200×600 мм", rackType: "microgreens", w: 1200, h: 600, levels: 5 },
  { id: "storage_1500_600", name: "Хранение 1500×600 мм", rackType: "storage", w: 1500, h: 600, levels: 4 },
];

const KIND_TO_CATEGORY = {
  rack: "rack",
  seed_rack: "rack",
  shelf_cons: "storage",
  shelf_inv: "storage",
  tank: "tank",
  tank_waste: "tank",
  pump: "pump",
  osmosis: "filter",
  water_prep: "dosing_unit",
  water_valve: "valve",
  light_panel: "light",
  lighting_group: "lighting_group",
  panel: "electrical_panel",
  cable_tray: "cable_tray",
  junction_box: "junction_box",
  switch: "switch",
  socket: "socket",
  sensor: "sensor",
  relay_box: "relay_box",
  recirc: "circulation_fan",
  blade_fan: "fan",
  vent_unit: "fan",
  air_conditioner: "air_conditioner",
  ac_indoor: "indoor_unit",
  ac_outdoor: "outdoor_unit",
  ac_floor: "indoor_unit",
  ac_duct: "indoor_unit",
  exhaust: "exhaust",
  supply: "supply",
  duct_damper: "duct",
  dehumidifier: "dehumidifier",
  humidifier: "humidifier",
  co2_sensor: "co2_sensor",
  temperature_sensor: "temperature_sensor",
  humidity_sensor: "humidity_sensor",
  air_quality_sensor: "air_quality_sensor",
  dew_point_sensor: "dew_point_sensor",
  pressure_sensor: "pressure_sensor",
  airflow_arrow: "airflow_arrow",
  climate_controller: "climate_controller",
  sink_susp: "sink",
  sink_table: "sink",
  sink_double: "sink",
  table_sow: "table",
  table_recv: "table",
  table_manip: "table",
  table_subs: "table",
  trolley: "cart",
  fridge: "cold_room_equipment",
  freezer: "cold_room_equipment",
  toilet: "sanitation",
  bidet: "sanitation",
  shower_pan: "sanitation",
  shower_sys: "sanitation",
  trap: "sanitation",
  dispenser: "sanitation",
  dezmat: "sanitation",
};

const DEFAULT_VISIBLE_BY_CATEGORY = {
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
  fan: ["ventilation", "climate", "specification"],
  air_conditioner: ["climate", "specification"],
  indoor_unit: ["climate", "specification"],
  outdoor_unit: ["climate", "specification"],
  duct: ["ventilation", "climate", "specification"],
  exhaust: ["ventilation", "climate", "specification"],
  supply: ["ventilation", "climate", "specification"],
  circulation_fan: ["ventilation", "climate", "specification"],
  dehumidifier: ["climate", "specification"],
  humidifier: ["climate", "specification"],
  co2_sensor: ["climate", "ventilation", "specification"],
  temperature_sensor: ["climate", "specification"],
  humidity_sensor: ["climate", "specification"],
  air_quality_sensor: ["climate", "ventilation", "specification"],
  dew_point_sensor: ["climate", "ventilation", "specification"],
  pressure_sensor: ["climate", "ventilation", "specification"],
  airflow_arrow: ["ventilation", "climate", "specification"],
  climate_controller: ["climate", "specification"],
  sink: ["plumbing", "safety", "specification"],
  table: ["equipment", "racks", "specification"],
  cart: ["equipment", "racks", "specification"],
  cold_room_equipment: ["equipment", "climate", "specification"],
  sanitation: ["safety", "plumbing", "specification"],
  storage: ["equipment", "racks", "specification"],
  custom: ["equipment", "racks", "specification"],
};

function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}

export function farmCategoryForKind(kind) {
  return KIND_TO_CATEGORY[kind] || "custom";
}

function inferVisibleOnSheets(category, layer) {
  if (DEFAULT_VISIBLE_BY_CATEGORY[category]) return [...DEFAULT_VISIBLE_BY_CATEGORY[category]];
  if (layer === "racks") return ["racks", "equipment", "specification"];
  if (layer === "irrigation" || layer === "water") return ["irrigation", "water_treatment", "specification"];
  if (layer === "drain") return ["drainage", "specification"];
  if (layer === "power" || layer === "sockets") return ["electrical", "lighting", "specification"];
  if (layer === "light") return ["lighting", "electrical", "specification"];
  if (layer === "climate") return ["climate", "equipment", "specification"];
  if (layer === "vent") return ["ventilation", "specification"];
  if (layer === "sanitary") return ["plumbing", "safety", "specification"];
  if (layer === "furn") return ["equipment", "racks", "specification"];
  return ["base_plan", "specification"];
}

export function rackPresetById(id) {
  return FARM_RACK_PRESETS.find((p) => p.id === id) || null;
}

export function calcRackUsefulAreaM2(source = {}) {
  const widthMm = source.widthMm ?? source.w ?? source.params?.lengthMm ?? 0;
  const depthMm = source.depthMm ?? source.h ?? source.params?.depthMm ?? 0;
  const levels = source.params?.levels ?? source.levels ?? 1;
  return round2((widthMm * depthMm * Math.max(1, levels)) / 1_000_000);
}

export function calcTankFilledWeightKg(params = {}) {
  const volumeL = Number(params.volumeL || 0);
  const tareKg = Number(params.tareWeightKg || 0);
  // 1 liter of water-based solution ~= 1 kg.
  return Math.round(volumeL + tareKg);
}

export function calcPipeLengthMm(pipe = {}) {
  return calculatePipeLength(pipe).planMm;
}

export function formatSocketHeightLabel(heightMm) {
  return `H=${Math.round((Number(heightMm) || 0) / 10)}`;
}

function rackParamsFromPreset(preset, widthMm, depthMm, base = {}) {
  const levels = Number(base.levels || preset?.levels || base.params?.levels || 5);
  const out = {
    rackType: base.rackType || preset?.rackType || "nft",
    levels,
    lengthMm: widthMm,
    depthMm,
    heightMm: Number(base.heightMm || 2400),
    aisleType: base.aisleType || "service",
    cropType: base.cropType || "",
    irrigationType: base.irrigationType || "",
    lightingPerLevel: Number(base.lightingPerLevel || 1),
    traysPerLevel: Number(base.traysPerLevel || 1),
    trayWidthMm: Number(base.trayWidthMm || Math.round(widthMm / 2)),
    trayDepthMm: Number(base.trayDepthMm || depthMm),
    usefulAreaM2: 0,
    powerW: Number(base.powerW || 0),
    waterFlowLh: Number(base.waterFlowLh || 0),
    weightKg: Number(base.weightKg || 0),
    costRub: Number(base.costRub || 0),
  };
  out.usefulAreaM2 = calcRackUsefulAreaM2({ widthMm, depthMm, params: out });
  return out;
}

function tankParams(base = {}) {
  const tankType = base.tankType || "nutrient_solution";
  const p = {
    volumeL: Number(base.volumeL || 750),
    tankType,
    material: base.material || "plastic",
    diameterMm: Number(base.diameterMm || 1200),
    lengthMm: Number(base.lengthMm || 1200),
    widthMm: Number(base.widthMm || 1000),
    heightMm: Number(base.heightMm || 1200),
    tareWeightKg: Number(base.tareWeightKg || 120),
  };
  p.filledWeightKg = calcTankFilledWeightKg(p);
  return p;
}

function pumpParams(base = {}) {
  return {
    flowLh: Number(base.flowLh || 0),
    headM: Number(base.headM || 0),
    powerW: Number(base.powerW || 0),
    system: base.system || "irrigation",
  };
}

function valveParams(base = {}) {
  return {
    valveType: base.valveType || "manual",
    system: base.system || "irrigation",
    diameterMm: Number(base.diameterMm || 32),
    normallyOpen: base.normallyOpen === true,
  };
}

function socketParams(base = {}) {
  const protectionIp = base.protectionIp || (base.waterproof ? "IP54" : "IP20");
  const ipNum = Number(String(protectionIp).replace(/[^0-9]/g, "").slice(0, 2) || 0);
  return {
    socketType: base.socketType || "standard_220",
    voltage: Number(base.voltage || 220),
    phases: Number(base.phases || 1),
    heightMm: Number(base.heightMm || 1200),
    powerW: Number(base.powerW || 0),
    protectionIp,
    waterproof: base.waterproof === true || ipNum >= 44,
    phase: base.phase || "A",
    groupName: base.groupName || "A",
    linkedObjectId: base.linkedObjectId || null,
  };
}

function panelParams(base = {}) {
  return {
    panelType: base.panelType || "distribution",
    voltage: Number(base.voltage || 380),
    phases: Number(base.phases || 3),
    maxPowerKw: Number(base.maxPowerKw || 0),
    protectionIp: base.protectionIp || "IP31",
    heightMm: Number(base.heightMm || 1200),
    groupName: base.groupName || "A",
    notes: base.notes || "",
  };
}

function lightParams(base = {}) {
  const levels = Number(base.levels || 1);
  const perLevel = Number(base.perLevel || base.count || 1);
  return {
    lightType: base.lightType || "linear_100",
    lengthMm: Number(base.lengthMm || 1000),
    powerW: Number(base.powerW || 0),
    spectrum: base.spectrum || "full_spectrum",
    ppfd: Number(base.ppfd || 0),
    mountingHeightMm: Number(base.mountingHeightMm || 2200),
    linkedRackId: base.linkedRackId || null,
    groupName: base.groupName || "D",
    count: Number(base.count || levels * perLevel),
    perLevel,
    levels,
    powerSupplyType: base.powerSupplyType || "",
  };
}

function electricalGroupParams(base = {}) {
  return {
    name: base.name || "A",
    voltage: Number(base.voltage || 220),
    phases: Number(base.phases || 1),
    maxPowerW: Number(base.maxPowerW || 0),
    currentPowerW: Number(base.currentPowerW || 0),
    breakerType: base.breakerType || "C16",
    rcd: base.rcd !== false,
    cableType: base.cableType || "ВВГнг-LS 3x2.5",
    color: base.color || "#a5371f",
    objectIds: Array.isArray(base.objectIds) ? base.objectIds : [],
  };
}

function powerLineParams(base = {}) {
  return {
    lineType: base.lineType || "wall_cable",
    points: base.points || [],
    fromObjectId: base.fromObjectId || null,
    toObjectId: base.toObjectId || null,
    groupName: base.groupName || "A",
    cableType: base.cableType || "ВВГнг-LS 3x2.5",
    powerW: Number(base.powerW || 0),
    voltage: Number(base.voltage || 220),
    phases: Number(base.phases || 1),
  };
}

function airConditionerParams(base = {}) {
  return {
    coolingPowerKw: Number(base.coolingPowerKw || 0),
    heatingPowerKw: Number(base.heatingPowerKw || 0),
    airflowM3h: Number(base.airflowM3h || 0),
    powerW: Number(base.powerW || 0),
    drainRequired: base.drainRequired !== false,
    indoorUnits: Number(base.indoorUnits || 1),
    outdoorUnits: Number(base.outdoorUnits || 1),
    manufacturer: base.manufacturer || "",
    model: base.model || "",
    notes: base.notes || "",
  };
}

function fanParams(base = {}) {
  return {
    airflowM3h: Number(base.airflowM3h || 0),
    diameter: Number(base.diameter || 0),
    pressure: Number(base.pressure || 0),
    power: Number(base.power || base.powerW || 0),
    rpm: Number(base.rpm || 0),
    direction: base.direction || "forward",
  };
}

function dehumidifierParams(base = {}) {
  return {
    capacityLDay: Number(base.capacityLDay || 0),
    powerW: Number(base.powerW || base.power || 0),
    airflow: Number(base.airflow || 0),
    noise: Number(base.noise || 0),
  };
}

function humidifierParams(base = {}) {
  return {
    capacityLh: Number(base.capacityLh || 0),
    powerW: Number(base.powerW || base.power || 0),
    waterConnection: base.waterConnection !== false,
  };
}

function sensorParams(base = {}) {
  return {
    sensorType: base.sensorType || "temperature",
    value: base.value ?? null,
    unit: base.unit || "",
    rangeMin: base.rangeMin ?? null,
    rangeMax: base.rangeMax ?? null,
  };
}

function ductParams(base = {}) {
  return {
    diameterMm: Number(base.diameterMm || base.diameter || 250),
    airflowM3h: Number(base.airflowM3h || 0),
    flowDirection: base.flowDirection || "forward",
    lineType: base.lineType || "duct",
  };
}

function climateControllerParams(base = {}) {
  return {
    targetTemperatureC: Number(base.targetTemperatureC || 0),
    targetRh: Number(base.targetRh || 0),
    targetCo2Ppm: Number(base.targetCo2Ppm || 0),
    mode: base.mode || "auto",
    notes: base.notes || "",
  };
}

function defaultFarmParams(category, options = {}) {
  if (category === "rack") {
    return rackParamsFromPreset(options.preset, options.widthMm, options.depthMm, options.params || {});
  }
  if (category === "tank") return tankParams(options.params || {});
  if (category === "pump") return pumpParams(options.params || {});
  if (category === "valve") return valveParams(options.params || {});
  if (category === "electrical_panel") return panelParams(options.params || {});
  if (category === "socket") return socketParams(options.params || {});
  if (category === "light") return lightParams(options.params || {});
  if (category === "lighting_group") return electricalGroupParams(options.params || {});
  if (category === "power_line" || category === "cable_tray") return powerLineParams(options.params || {});
  if (category === "air_conditioner" || category === "indoor_unit" || category === "outdoor_unit") return airConditionerParams(options.params || {});
  if (category === "fan" || category === "circulation_fan" || category === "exhaust" || category === "supply") return fanParams(options.params || {});
  if (category === "dehumidifier") return dehumidifierParams(options.params || {});
  if (category === "humidifier") return humidifierParams(options.params || {});
  if (
    category === "co2_sensor"
    || category === "temperature_sensor"
    || category === "humidity_sensor"
    || category === "air_quality_sensor"
  ) return sensorParams(options.params || {});
  if (category === "dew_point_sensor") return sensorParams({ sensorType: "dew_point", ...(options.params || {}) });
  if (category === "pressure_sensor") return sensorParams({ sensorType: "pressure", ...(options.params || {}) });
  if (category === "duct" || category === "airflow_arrow") return ductParams(options.params || {});
  if (category === "climate_controller") return climateControllerParams(options.params || {});
  if (category === "pipe" || category === "drain_pipe") {
    return normalizePipe({
      ...options.params,
      type: "pipe",
      pipeSystem: options.params?.pipeSystem || (category === "drain_pipe" ? "drainage" : "irrigation"),
      pipeRole: options.params?.pipeRole || (category === "drain_pipe" ? "drain" : "supply"),
      points: options.params?.points || [],
      diameterMm: Number(options.params?.diameterMm || (category === "drain_pipe" ? 50 : 32)),
      material: options.params?.material || (category === "drain_pipe" ? "pvc" : "pp"),
      flowDirection: options.params?.flowDirection || "forward",
      connectedObjectIds: options.params?.connectedObjectIds || [],
    });
  }
  return { ...(options.params || {}) };
}

export function createFarmObject(base = {}, { presetId = null } = {}) {
  const widthMm = Number(base.widthMm ?? base.w ?? 1000);
  const depthMm = Number(base.depthMm ?? base.h ?? 600);
  const heightMm = Number(base.heightMm ?? base.height ?? 2400);
  const category = FARM_OBJECT_CATEGORIES.includes(base.category) ? base.category : "custom";
  const preset = presetId ? rackPresetById(presetId) : null;
  const params = defaultFarmParams(category, {
    preset,
    widthMm,
    depthMm,
    params: base.params,
  });
  return {
    ...base,
    id: base.id,
    type: "farm_object",
    category,
    subtype: base.subtype || base.kind || category,
    name: base.name || base.label || catalogByKind(base.kind || "rack")?.label || "Объект",
    x: Number(base.x || 0),
    y: Number(base.y || 0),
    widthMm,
    depthMm,
    heightMm,
    rotationDeg: Number(base.rotationDeg ?? base.angle ?? 0),
    locked: base.locked === true,
    visible: base.visible !== false,
    visibleOnSheets: Array.isArray(base.visibleOnSheets) && base.visibleOnSheets.length
      ? [...base.visibleOnSheets]
      : inferVisibleOnSheets(category, base.layer || catalogByKind(base.kind || "rack")?.layer || "racks"),
    layer: base.layer || catalogByKind(base.kind || "rack")?.layer || "racks",
    params,
    connectionPorts: Array.isArray(base.connectionPorts) && base.connectionPorts.length
      ? [...base.connectionPorts]
      : defaultConnectionPortsForKind(base.kind || base.subtype || category),
    connections: Array.isArray(base.connections) ? base.connections : [],
    label: base.label || base.name || "",
    notes: base.notes || "",
    specRef: base.specRef || null,
    // Compatibility with existing planner rendering/state.
    w: widthMm,
    h: depthMm,
    angle: Number(base.angle ?? base.rotationDeg ?? 0),
  };
}

export function normalizePlannerObject(obj = {}) {
  const widthMm = Number(obj.widthMm ?? obj.w ?? 0);
  const depthMm = Number(obj.depthMm ?? obj.h ?? 0);
  const heightMm = Number(obj.heightMm ?? obj.height ?? 0);
  if (!obj.type) {
    return {
      ...obj,
      type: "legacy_object",
      widthMm,
      depthMm,
      heightMm,
      rotationDeg: Number(obj.rotationDeg ?? obj.angle ?? 0),
      visibleOnSheets: Array.isArray(obj.visibleOnSheets) && obj.visibleOnSheets.length
        ? [...obj.visibleOnSheets]
        : inferVisibleOnSheets(farmCategoryForKind(obj.kind), obj.layer),
      connectionPorts: Array.isArray(obj.connectionPorts) && obj.connectionPorts.length
        ? [...obj.connectionPorts]
        : defaultConnectionPortsForKind(obj.kind),
    };
  }
  if (obj.type === "farm_object") {
    const category = FARM_OBJECT_CATEGORIES.includes(obj.category) ? obj.category : farmCategoryForKind(obj.kind);
    const params = obj.params || defaultFarmParams(category, { widthMm, depthMm });
    if (category === "rack" && (params.usefulAreaM2 == null || params.usefulAreaM2 === 0)) {
      params.usefulAreaM2 = calcRackUsefulAreaM2({ widthMm, depthMm, params });
    }
    if (category === "tank" && (params.filledWeightKg == null || params.filledWeightKg === 0)) {
      params.filledWeightKg = calcTankFilledWeightKg(params);
    }
    return {
      ...obj,
      category,
      widthMm,
      depthMm,
      heightMm,
      rotationDeg: Number(obj.rotationDeg ?? obj.angle ?? 0),
      w: Number(obj.w ?? widthMm),
      h: Number(obj.h ?? depthMm),
      angle: Number(obj.angle ?? obj.rotationDeg ?? 0),
      params,
      visibleOnSheets: Array.isArray(obj.visibleOnSheets) && obj.visibleOnSheets.length
        ? [...obj.visibleOnSheets]
        : inferVisibleOnSheets(category, obj.layer),
      connectionPorts: Array.isArray(obj.connectionPorts) && obj.connectionPorts.length
        ? [...obj.connectionPorts]
        : defaultConnectionPortsForKind(obj.kind || obj.subtype || category),
    };
  }
  return {
    ...obj,
    widthMm,
    depthMm,
    heightMm,
    rotationDeg: Number(obj.rotationDeg ?? obj.angle ?? 0),
    visibleOnSheets: Array.isArray(obj.visibleOnSheets) && obj.visibleOnSheets.length
      ? [...obj.visibleOnSheets]
      : inferVisibleOnSheets(farmCategoryForKind(obj.kind), obj.layer),
    connectionPorts: Array.isArray(obj.connectionPorts) && obj.connectionPorts.length
      ? [...obj.connectionPorts]
      : defaultConnectionPortsForKind(obj.kind),
  };
}

export function shouldRenderPlannerObject(obj) {
  if (!obj) return false;
  if (!obj.type || obj.type === "legacy_object") return true;
  return obj.type === "farm_object";
}

export function resolveArrowMoveStepMm(e, display = {}) {
  if (e.ctrlKey) return display.arrowStepCtrlMm ?? 1;
  if (e.shiftKey) return display.arrowStepShiftMm ?? 100;
  if (e.altKey) return display.arrowStepAltMm ?? 1;
  return display.arrowStepMm ?? 10;
}

export function createRackGroup(template, params = {}, uidFactory = (p = "eq") => `${p}_${Math.random().toString(36).slice(2, 8)}`) {
  const count = Math.max(1, Number(params.count || 1));
  const rows = Math.max(1, Number(params.rows || 1));
  const spacingMm = Number(params.spacingMm ?? 800);
  const aisleMm = Number(params.aisleMm ?? 900);
  const direction = params.direction === "y" ? "y" : "x";
  const groupId = uidFactory("fog");
  const children = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < count; col++) {
      const idx = row * count + col;
      const x = direction === "x"
        ? template.x + col * (template.w + spacingMm)
        : template.x + row * (template.w + aisleMm);
      const y = direction === "x"
        ? template.y + row * (template.h + aisleMm)
        : template.y + col * (template.h + spacingMm);
      children.push({
        ...template,
        id: idx === 0 && template.id ? template.id : uidFactory("eq"),
        x,
        y,
        groupId,
      });
    }
  }

  return {
    group: {
      id: groupId,
      type: "farm_object_group",
      category: "rack_group",
      childrenIds: children.map((c) => c.id),
      params: {
        rackType: template.params?.rackType || template.rackType || "nft",
        count,
        rows,
        spacingMm,
        direction,
        aisleMm,
      },
    },
    children,
  };
}

export function getFarmObjectSpecPreview(object, plan = null) {
  const obj = normalizePlannerObject(object);
  if (obj.type !== "farm_object") return [];
  const p = obj.params || {};
  if (obj.category === "rack") {
    const levels = Number(p.levels || 1);
    return [
      { item: "Каркас стеллажа", qty: 1, unit: "шт", note: p.rackType || "rack" },
      { item: "Лотки", qty: Math.max(1, levels * Number(p.traysPerLevel || 1)), unit: "шт", note: `${p.trayWidthMm || obj.widthMm}×${p.trayDepthMm || obj.depthMm}` },
      { item: "Светильники", qty: Math.max(0, levels * Number(p.lightingPerLevel || 0)), unit: "шт", note: `~${Number(p.powerW || 0)} Вт` },
      { item: "Фитинги", qty: Math.max(4, levels * 2), unit: "шт", note: "оценка" },
    ];
  }
  if (obj.category === "tank") {
    return [
      { item: "Бак", qty: 1, unit: "шт", note: `${p.volumeL || 0} л` },
      { item: "Врезки", qty: 2, unit: "шт", note: "вход/выход" },
      { item: "Краны", qty: 2, unit: "шт", note: "шаровые" },
    ];
  }
  if (obj.category === "pipe" || obj.category === "drain_pipe") {
    const pipe = normalizePipe({
      ...obj,
      ...p,
      points: p.points || obj.points || [],
      pipeSystem: p.pipeSystem || (obj.category === "drain_pipe" ? "drainage" : "irrigation"),
      pipeRole: p.pipeRole || (obj.category === "drain_pipe" ? "drain" : "supply"),
    });
    const len = calculatePipeLength(pipe);
    const fittings = estimatePipeFittings(pipe, [pipe]);
    return [
      { item: "Труба", qty: round2(len.withReserveRoundedM), unit: "м", note: `${pipe.material || "pp"} ${pipe.diameterMm || 0} (+10%)` },
      { item: "Углы 90°", qty: fittings.corners90, unit: "шт", note: "предварительный расчет" },
      { item: "Тройники", qty: fittings.tees, unit: "шт", note: "предварительный расчет" },
      { item: "Муфты/врезки", qty: fittings.objectConnections, unit: "шт", note: "по подключениям к объектам" },
      { item: "Заглушки", qty: fittings.endCaps, unit: "шт", note: "неподключенные концы" },
    ];
  }
  if (obj.category === "light") {
    const qty = Math.max(1, Number(p.count || 1));
    return [
      { item: "Светильник", qty, unit: "шт", note: `${p.lightType || "linear_100"} · ${p.lengthMm || obj.widthMm} мм` },
      { item: "Кабель", qty: round2(((obj.widthMm || 0) / 1000) * qty), unit: "м", note: `${p.powerW || 0} Вт` },
      ...(p.powerSupplyType ? [{ item: "Блок питания", qty: 1, unit: "шт", note: p.powerSupplyType }] : []),
    ];
  }
  if (obj.category === "socket") {
    return [
      { item: "Розетка", qty: 1, unit: "шт", note: `${p.socketType || "standard_220"} ${p.protectionIp || ""}`.trim() },
    ];
  }
  if (obj.category === "electrical_panel") {
    const rows = [
      { item: "Электрощит", qty: 1, unit: "шт", note: `${p.panelType || "distribution"} ${p.maxPowerKw || 0} кВт` },
      { item: "Автоматика", qty: 1, unit: "компл", note: p.notes || "по проекту" },
    ];
    if (plan) {
      const cableM = estimateCableSpecLength(plan);
      if (cableM > 0) rows.push({ item: "Кабель", qty: round2(cableM), unit: "м", note: "по длине линий × 1.15" });
    }
    return rows;
  }
  if (obj.category === "sensor" || obj.category === "relay_box") {
    return [
      { item: obj.category === "sensor" ? "Датчик" : "Релейный блок", qty: 1, unit: "шт", note: obj.subtype || obj.kind || "" },
    ];
  }
  if (
    obj.category === "temperature_sensor"
    || obj.category === "humidity_sensor"
    || obj.category === "co2_sensor"
    || obj.category === "air_quality_sensor"
    || obj.category === "dew_point_sensor"
    || obj.category === "pressure_sensor"
  ) {
    return [
      { item: "Датчик", qty: 1, unit: "шт", note: p.sensorType || obj.category },
    ];
  }
  if (obj.category === "climate_controller") {
    return [
      { item: "Климат-контроллер", qty: 1, unit: "шт", note: p.mode || "auto" },
    ];
  }
  if (obj.category === "duct" || obj.category === "airflow_arrow") {
    return [
      { item: obj.category === "airflow_arrow" ? "Стрелка потока" : "Элемент воздуховода", qty: 1, unit: "шт", note: `Ø${p.diameterMm || 0}` },
    ];
  }
  if (obj.category === "dehumidifier") {
    return [
      { item: "Осушитель", qty: 1, unit: "шт", note: `${p.capacityLDay || 0} л/сут` },
    ];
  }
  if (obj.category === "humidifier") {
    return [
      { item: "Увлажнитель", qty: 1, unit: "шт", note: `${p.capacityLh || 0} л/ч` },
    ];
  }
  if (obj.category === "exhaust" || obj.category === "supply") {
    return [
      { item: obj.category === "exhaust" ? "Вытяжная решетка" : "Приточная решетка", qty: 1, unit: "шт", note: `${p.airflowM3h || 0} м3/ч` },
    ];
  }
  if (obj.category === "fan" || obj.category === "circulation_fan" || obj.category === "air_conditioner") {
    return [
      { item: (obj.category === "air_conditioner" ? "Кондиционер" : "Вентилятор"), qty: 1, unit: "шт", note: `${p.airflowM3h || p.coolingKw || 0}` },
      { item: "Воздуховод", qty: p.airflowM3h ? 2 : 0, unit: "м", note: "оценка" },
    ];
  }
  if (obj.category === "indoor_unit" || obj.category === "outdoor_unit") {
    return [
      { item: obj.category === "indoor_unit" ? "Внутренний блок" : "Внешний блок", qty: 1, unit: "шт", note: `${p.model || ""}`.trim() || `${p.airflowM3h || 0} м3/ч` },
    ];
  }
  return [{ item: obj.name || obj.label || "Объект", qty: 1, unit: "шт", note: obj.category }];
}
