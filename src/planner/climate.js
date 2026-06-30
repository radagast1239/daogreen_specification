import { linePlanLengthMm, nearestItemAttach } from "./lineProperties.js";

const PRODUCTION_ROOM_CATEGORIES = new Set([
  "production_main",
  "production_seedling",
  "microgreens",
  "nursery",
]);

const PASSAGE_ROOM_CATEGORIES = new Set([
  "corridor",
  "loading",
]);

const DUCT_LINE_TYPES = new Set([
  "duct",
  "supply_duct",
  "exhaust_duct",
  "recirculation_duct",
  "airflow_arrow",
]);

const DUCT_LINE_TAGS = new Set([
  "duct",
  "supply",
  "exhaust",
  "recirc",
  "airflow",
  "airflow_arrow",
]);

const SENSOR_TYPE_BY_KIND = {
  temperature_sensor: "temperature",
  humidity_sensor: "humidity",
  co2_sensor: "co2",
  air_quality_sensor: "air_quality",
  dew_point_sensor: "dew_point",
  pressure_sensor: "pressure",
};

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round2(v) {
  return Math.round(num(v) * 100) / 100;
}

function uniq(arr = []) {
  return [...new Set(arr.filter(Boolean))];
}

function center(it) {
  return {
    x: num(it.x) + num(it.w || it.widthMm, 0) / 2,
    y: num(it.y) + num(it.h || it.depthMm, 0) / 2,
  };
}

function pointToSegmentDistance(p, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;
  const vv = vx * vx + vy * vy;
  if (vv <= 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / vv));
  const px = a.x + vx * t;
  const py = a.y + vy * t;
  return Math.hypot(p.x - px, p.y - py);
}

function pointToPolylineDistance(p, points = []) {
  if (!Array.isArray(points) || points.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const d = pointToSegmentDistance(p, points[i], points[i + 1]);
    if (d < best) best = d;
  }
  return best;
}

function zoneContainsPoint(zone, p) {
  if (zone.polygon?.length >= 3) {
    let inside = false;
    for (let i = 0, j = zone.polygon.length - 1; i < zone.polygon.length; j = i++) {
      const xi = zone.polygon[i].x;
      const yi = zone.polygon[i].y;
      const xj = zone.polygon[j].x;
      const yj = zone.polygon[j].y;
      const cross = ((yi > p.y) !== (yj > p.y))
        && (p.x < ((xj - xi) * (p.y - yi)) / ((yj - yi) || 1e-9) + xi);
      if (cross) inside = !inside;
    }
    return inside;
  }
  if (zone.x == null || zone.y == null || zone.w == null || zone.h == null) return false;
  return p.x >= zone.x && p.x <= zone.x + zone.w && p.y >= zone.y && p.y <= zone.y + zone.h;
}

function roomForItem(item, rooms = []) {
  const c = center(item);
  return (rooms || []).find((room) => zoneContainsPoint(room, c)) || null;
}

function roomText(room = {}) {
  return `${room.name || ""} ${room.category || ""}`.toLowerCase();
}

function itemCategory(item = {}) {
  if (item.category) return item.category;
  const map = {
    ac_indoor: "indoor_unit",
    ac_outdoor: "outdoor_unit",
    ac_floor: "air_conditioner",
    ac_duct: "indoor_unit",
    blade_fan: "fan",
    vent_unit: "fan",
    recirc: "circulation_fan",
    temperature_sensor: "temperature_sensor",
    humidity_sensor: "humidity_sensor",
    co2_sensor: "co2_sensor",
    air_quality_sensor: "air_quality_sensor",
    dew_point_sensor: "dew_point_sensor",
    pressure_sensor: "pressure_sensor",
  };
  return map[item.kind] || "";
}

function itemAirflowM3h(item = {}) {
  const p = item.params || {};
  if (p.airflowM3h != null) return Math.max(0, num(p.airflowM3h));
  if (item.airflowM3h != null) return Math.max(0, num(item.airflowM3h));
  const cat = itemCategory(item);
  if (cat === "indoor_unit" || cat === "air_conditioner") return Math.max(0, num(p.airflowM3h, 1500));
  if (cat === "fan" || cat === "circulation_fan") return Math.max(0, num(p.airflowM3h, 2500));
  if (cat === "supply" || cat === "exhaust") return Math.max(0, num(p.airflowM3h, 1800));
  if (cat === "dehumidifier") return Math.max(0, num(p.airflow, 1000));
  return 0;
}

function isClimateUnit(item = {}) {
  const cat = itemCategory(item);
  return new Set([
    "air_conditioner",
    "indoor_unit",
    "outdoor_unit",
    "fan",
    "exhaust",
    "supply",
    "duct",
    "circulation_fan",
    "dehumidifier",
    "humidifier",
    "co2_sensor",
    "temperature_sensor",
    "humidity_sensor",
    "air_quality_sensor",
    "dew_point_sensor",
    "pressure_sensor",
    "climate_controller",
  ]).has(cat);
}

function isProductionRoom(room = {}) {
  if (PRODUCTION_ROOM_CATEGORIES.has(room.category)) return true;
  return /(production|выращ|рассад|microgreens|ферм)/i.test(roomText(room));
}

function isPassageRoom(room = {}) {
  if (PASSAGE_ROOM_CATEGORIES.has(room.category)) return true;
  return /(проход|коридор|corridor|passage)/i.test(roomText(room));
}

function requiredAirChanges(room = {}) {
  const v = num(room.targetAirChanges, num(room.airChanges, 0));
  if (v > 0) return v;
  return isProductionRoom(room) ? 8 : 4;
}

function defaultLineType(line = {}) {
  if (line.lineType) return line.lineType;
  if (line.lineTag === "supply") return "supply_duct";
  if (line.lineTag === "exhaust") return "exhaust_duct";
  if (line.lineTag === "recirc") return "recirculation_duct";
  if (line.lineTag === "airflow" || line.lineTag === "airflow_arrow") return "airflow_arrow";
  return "duct";
}

function canConnectDuctTo(item = {}, portType = "") {
  const cat = itemCategory(item);
  const allowedCats = new Set([
    "air_conditioner",
    "indoor_unit",
    "outdoor_unit",
    "fan",
    "exhaust",
    "supply",
    "circulation_fan",
    "dehumidifier",
    "humidifier",
    "climate_controller",
  ]);
  if (!allowedCats.has(cat)) return false;
  if (!portType) return true;
  return ["air", "inlet", "outlet", "branch"].includes(portType);
}

export function isDuctLine(line = {}) {
  if (line.type === "duct") return true;
  if (DUCT_LINE_TYPES.has(line.lineType)) return true;
  if (DUCT_LINE_TAGS.has(line.lineTag)) return true;
  if (line.layer === "vent") return true;
  return false;
}

export function normalizeDuct(line = {}) {
  const points = line.points || line.pts || [];
  const lineType = defaultLineType(line);
  const diameterMm = Math.max(80, num(line.diameterMm, lineType === "airflow_arrow" ? 100 : 250));
  const fromObjectId = line.fromObjectId || line.fromItemId || null;
  const toObjectId = line.toObjectId || line.toItemId || null;
  return {
    ...line,
    type: "duct",
    layer: line.layer || "vent",
    lineType,
    ductType: line.ductType || (lineType === "supply_duct"
      ? "supply"
      : lineType === "exhaust_duct"
        ? "exhaust"
        : lineType === "recirculation_duct"
          ? "recirculation"
          : lineType === "airflow_arrow"
            ? "arrow"
            : "main"),
    points,
    pts: points,
    diameterMm,
    airflowM3h: Math.max(0, num(line.airflowM3h, 0)),
    flowDirection: line.flowDirection === "reverse" ? "reverse" : "forward",
    fromObjectId,
    toObjectId,
    fromItemId: line.fromItemId || fromObjectId,
    toItemId: line.toItemId || toObjectId,
    connectedObjectIds: uniq(line.connectedObjectIds || [fromObjectId, toObjectId]),
    label: line.label || (lineType === "airflow_arrow" ? "Поток воздуха" : `Воздуховод Ø${diameterMm}`),
    showArrows: line.showArrows !== false,
    reservePct: Math.max(0, num(line.reservePct, 10)),
  };
}

export function calculateDuctLength(line = {}) {
  return linePlanLengthMm(line.points || line.pts || []);
}

export function calculateRoomVolume(room = {}) {
  const areaMm2 = num(room.areaMm2, num(room.areaM2, 0) * 1_000_000);
  const heightMm = num(room.heightMm, num(room.height, 3000));
  return round2((areaMm2 / 1_000_000) * (heightMm / 1000));
}

export function calculateRoomAirExchange(room = {}) {
  const volumeM3 = calculateRoomVolume(room);
  const ach = requiredAirChanges(room);
  const requiredAirflowM3h = round2(volumeM3 * ach);
  return {
    volumeM3,
    airChanges: ach,
    requiredAirflowM3h,
    recommendedFanM3h: Math.ceil(requiredAirflowM3h / 500) * 500,
  };
}

function attachDuctEndpoints(line, items = []) {
  const points = line.points || line.pts || [];
  if (points.length < 2) return line;
  const head = points[0];
  const tail = points[points.length - 1];
  const from = nearestItemAttach(head, items, 320);
  const to = nearestItemAttach(tail, items, 320);
  const fromOk = from && canConnectDuctTo(items.find((i) => i.id === from.itemId), from.portType);
  const toOk = to && canConnectDuctTo(items.find((i) => i.id === to.itemId), to.portType);
  const fromObjectId = fromOk ? from.itemId : line.fromObjectId || line.fromItemId || null;
  const toObjectId = toOk ? to.itemId : line.toObjectId || line.toItemId || null;
  return normalizeDuct({
    ...line,
    fromObjectId,
    toObjectId,
    fromItemId: fromObjectId,
    toItemId: toObjectId,
    connectedObjectIds: uniq([...(line.connectedObjectIds || []), fromObjectId, toObjectId]),
  });
}

export function calculateClimateLoads(plan = {}) {
  const rooms = ((plan.rooms && plan.rooms.length ? plan.rooms : plan.zones) || []).filter(Boolean);
  const items = plan.items || [];
  const ducts = (plan.lines || []).filter(isDuctLine).map(normalizeDuct);
  const roomLoads = rooms.map((room) => {
    const exchange = calculateRoomAirExchange(room);
    const roomItems = items.filter((it) => roomForItem(it, [room]));
    const airflowUnits = roomItems.filter((it) => (
      ["fan", "circulation_fan", "supply", "exhaust", "air_conditioner", "indoor_unit", "dehumidifier", "humidifier"].includes(itemCategory(it))
    ));
    const installedAirflowM3h = round2(airflowUnits.reduce((s, it) => s + itemAirflowM3h(it), 0));
    const roomDucts = ducts.filter((ln) => {
      const pts = ln.points || ln.pts || [];
      return pts.some((p) => zoneContainsPoint(room, p));
    });
    const hasVentilation = airflowUnits.some((it) => ["fan", "circulation_fan", "supply", "exhaust"].includes(itemCategory(it))) || roomDucts.length > 0;
    const hasAc = roomItems.some((it) => ["air_conditioner", "indoor_unit"].includes(itemCategory(it)));
    const hasDehumidifier = roomItems.some((it) => itemCategory(it) === "dehumidifier");
    const hasHumidifier = roomItems.some((it) => itemCategory(it) === "humidifier");
    const sensorTypes = new Set(roomItems
      .map((it) => SENSOR_TYPE_BY_KIND[it.kind] || it.params?.sensorType || itemCategory(it))
      .filter(Boolean));
    return {
      roomId: room.id,
      roomName: room.name || room.id,
      category: room.category || "other",
      ...exchange,
      installedAirflowM3h,
      airflowDeficitM3h: Math.max(0, round2(exchange.requiredAirflowM3h - installedAirflowM3h)),
      hasVentilation,
      hasAc,
      hasDehumidifier,
      hasHumidifier,
      sensorTypes: [...sensorTypes],
      targetTemperatureC: room.targetTemperatureC ?? room.temperatureTargetC ?? null,
      targetRh: room.targetRh ?? room.rhTarget ?? null,
      targetCo2Ppm: room.targetCo2Ppm ?? room.co2TargetPpm ?? null,
      targetAirVelocityMs: room.targetAirVelocityMs ?? room.airVelocity ?? null,
      roomDuctCount: roomDucts.length,
    };
  });
  const totals = {
    totalVolumeM3: round2(roomLoads.reduce((s, r) => s + r.volumeM3, 0)),
    totalRequiredAirflowM3h: round2(roomLoads.reduce((s, r) => s + r.requiredAirflowM3h, 0)),
    totalInstalledAirflowM3h: round2(roomLoads.reduce((s, r) => s + r.installedAirflowM3h, 0)),
  };
  return { rooms: roomLoads, totals };
}

export function collectClimateWarnings(plan = {}) {
  const warnings = [];
  const loads = calculateClimateLoads(plan);
  const items = plan.items || [];
  const settings = {
    forbidIndoorOverPassage: plan.climateSettings?.forbidIndoorOverPassage !== false,
    maxRackFanDistanceMm: Math.max(1200, num(plan.climateSettings?.maxRackFanDistanceMm, 4500)),
    indoorPassageClearanceMm: Math.max(200, num(plan.climateSettings?.indoorPassageClearanceMm, 700)),
  };
  const staffPassageRoutes = (plan.lines || []).filter((ln) => {
    if (ln.layer !== "staff") return false;
    const tag = String(ln.lineTag || ln.traffic || "").toLowerCase();
    return !tag || tag === "staff";
  });
  const fans = items.filter((it) => ["fan", "circulation_fan"].includes(itemCategory(it)) || ["blade_fan", "vent_unit", "recirc"].includes(it.kind));
  const racks = items.filter((it) => it.kind === "rack" || it.kind === "seed_rack");
  const rooms = (plan.rooms && plan.rooms.length ? plan.rooms : plan.zones) || [];

  loads.rooms.forEach((r) => {
    if (!isProductionRoom({ category: r.category, name: r.roomName })) return;
    if (r.targetTemperatureC == null || r.targetTemperatureC === "") {
      warnings.push({ id: `climate-no-target-temp-${r.roomId}`, severity: "warning", objectIds: [r.roomId], text: `${r.roomName}: не задана целевая температура` });
    }
    if (!r.sensorTypes.includes("temperature") && !r.sensorTypes.includes("temperature_sensor")) {
      warnings.push({ id: `climate-no-temp-sensor-${r.roomId}`, severity: "warning", objectIds: [r.roomId], text: `${r.roomName}: нет датчика температуры` });
    }
    if (!r.sensorTypes.includes("humidity") && !r.sensorTypes.includes("humidity_sensor")) {
      warnings.push({ id: `climate-no-humidity-sensor-${r.roomId}`, severity: "warning", objectIds: [r.roomId], text: `${r.roomName}: нет датчика влажности` });
    }
    if (!r.hasVentilation) {
      warnings.push({ id: `climate-no-vent-${r.roomId}`, severity: "warning", objectIds: [r.roomId], text: `${r.roomName}: нет вентиляции` });
    }
    if (!r.hasAc) {
      warnings.push({ id: `climate-no-ac-${r.roomId}`, severity: "warning", objectIds: [r.roomId], text: `${r.roomName}: нет кондиционера` });
    }
    if (!r.hasDehumidifier) {
      warnings.push({ id: `climate-no-dehumidifier-${r.roomId}`, severity: "warning", objectIds: [r.roomId], text: `${r.roomName}: нет осушителя` });
    }
    if (r.requiredAirflowM3h > 0 && r.installedAirflowM3h < r.requiredAirflowM3h * 0.9) {
      warnings.push({
        id: `climate-airflow-deficit-${r.roomId}`,
        severity: "warning",
        objectIds: [r.roomId],
        text: `${r.roomName}: недостаточный воздухообмен (${Math.round(r.installedAirflowM3h)}/${Math.round(r.requiredAirflowM3h)} м3/ч)`,
      });
    }
  });

  (plan.lines || []).filter(isDuctLine).map(normalizeDuct).forEach((ln) => {
    if (ln.lineType === "airflow_arrow") return;
    if (!ln.fromObjectId || !ln.toObjectId) {
      warnings.push({
        id: `duct-no-connection-${ln.id}`,
        severity: "warning",
        objectIds: [ln.id],
        text: "Воздуховод без подключений from/to",
      });
    }
  });

  items.forEach((it) => {
    const room = roomForItem(it, rooms);
    const cat = itemCategory(it);
    if ((cat === "outdoor_unit" || it.kind === "ac_outdoor") && room && isProductionRoom(room)) {
      warnings.push({
        id: `outdoor-in-production-${it.id}`,
        severity: "warning",
        objectIds: [it.id],
        text: `${it.label || "Внешний блок"}: внешний блок не должен быть в помещении выращивания`,
      });
    }
    if (settings.forbidIndoorOverPassage && (cat === "indoor_unit" || it.kind === "ac_indoor")) {
      const c = center(it);
      const inPassageRoom = !!(room && isPassageRoom(room));
      const overPassageRoute = staffPassageRoutes.some((route) => (
        pointToPolylineDistance(c, route.points || route.polyline || []) <= settings.indoorPassageClearanceMm
      ));
      if (inPassageRoom || overPassageRoute) {
        warnings.push({
          id: `indoor-over-passage-${it.id}`,
          severity: "warning",
          objectIds: [it.id],
          text: `${it.label || "Внутренний блок"}: расположен над проходом персонала`,
        });
      }
    }
  });

  racks.forEach((rack) => {
    const c = center(rack);
    let best = Infinity;
    fans.forEach((fan) => {
      const d = Math.hypot(center(fan).x - c.x, center(fan).y - c.y);
      if (d < best) best = d;
    });
    if (!Number.isFinite(best)) {
      warnings.push({
        id: `rack-no-circulation-${rack.id}`,
        severity: "warning",
        objectIds: [rack.id],
        text: `${rack.label || "Стеллаж"}: стеллаж вне зоны циркуляции`,
      });
      return;
    }
    if (best > settings.maxRackFanDistanceMm) {
      warnings.push({
        id: `rack-fan-far-${rack.id}`,
        severity: "warning",
        objectIds: [rack.id],
        text: `${rack.label || "Стеллаж"}: вентилятор слишком далеко (${Math.round(best)} мм)`,
      });
    }
  });

  return warnings;
}

export function syncClimatePlan(plan = {}) {
  const lines = (plan.lines || []).map((ln) => {
    if (!isDuctLine(ln)) return ln;
    return attachDuctEndpoints(normalizeDuct(ln), plan.items || []);
  });
  const climateLoads = calculateClimateLoads({ ...plan, lines });
  return {
    ...plan,
    lines,
    climateLoads,
  };
}
