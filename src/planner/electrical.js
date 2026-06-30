import { pointInPolygon } from "./wallGeometry.js";
import { linePlanLengthMm } from "./lineProperties.js";

const DEFAULT_GROUPS = [
  { id: "eg-A", name: "A", voltage: 220, phases: 1, maxPowerW: 12000, breakerType: "C25", rcd: true, cableType: "ВВГнг-LS 3x4", color: "#a5371f", objectIds: [] },
  { id: "eg-B", name: "B", voltage: 220, phases: 1, maxPowerW: 8000, breakerType: "C20", rcd: true, cableType: "ВВГнг-LS 3x2.5", color: "#8b4a2b", objectIds: [] },
  { id: "eg-C", name: "C", voltage: 380, phases: 3, maxPowerW: 18000, breakerType: "C32", rcd: true, cableType: "ВВГнг-LS 5x4", color: "#7a5c3e", objectIds: [] },
  { id: "eg-D", name: "D", voltage: 220, phases: 1, maxPowerW: 10000, breakerType: "C16", rcd: true, cableType: "ВВГнг-LS 3x2.5", color: "#d4a017", objectIds: [] },
  { id: "eg-E", name: "E", voltage: 220, phases: 1, maxPowerW: 6000, breakerType: "C16", rcd: true, cableType: "ВВГнг-LS 3x2.5", color: "#5a5f5c", objectIds: [] },
];

const ELECTRICAL_OBJECT_CATEGORIES = new Set([
  "electrical_panel",
  "socket",
  "power_line",
  "cable_tray",
  "junction_box",
  "switch",
  "sensor",
  "relay_box",
  "lighting_group",
  "light",
]);

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function objectCategory(item = {}) {
  if (item.category) return item.category;
  const kindMap = {
    panel: "electrical_panel",
    socket: "socket",
    light_panel: "light",
    lighting_group: "lighting_group",
    sensor: "sensor",
    relay_box: "relay_box",
    switch: "switch",
    junction_box: "junction_box",
    cable_tray: "cable_tray",
    pump: "pump",
  };
  return kindMap[item.kind] || "";
}

function objectPowerW(item = {}) {
  const p = item.params || {};
  if (objectCategory(item) === "light" && p.powerW != null) {
    const count = Math.max(1, num(p.count, p.levels && p.perLevel ? num(p.levels) * num(p.perLevel) : 1));
    return Math.max(0, num(p.powerW, 0) * count);
  }
  if (item.powerW != null && item.powerW !== "") return Math.max(0, num(item.powerW, 0));
  if (p.powerW != null && p.powerW !== "") return Math.max(0, num(p.powerW, 0));
  if (item.kind === "light_panel") return Math.max(0, num(p.powerW, 120));
  if (item.kind === "pump") return Math.max(0, num(p.powerW, 450));
  if (item.kind === "ac_indoor" || item.kind === "ac_outdoor") return Math.max(0, num(p.powerW, 2500));
  return 0;
}

function groupNameForObject(item = {}) {
  return item.params?.groupName || item.groupName || "";
}

function objectVoltage(item = {}) {
  const p = item.params || {};
  if (p.voltage != null) return num(p.voltage, 220);
  if (p.socketType === "industrial_380") return 380;
  if (p.socketType === "pump_socket") return 220;
  return 220;
}

function objectPhases(item = {}) {
  const p = item.params || {};
  if (p.phases != null) return num(p.phases, 1);
  return objectVoltage(item) >= 380 ? 3 : 1;
}

function powerClass(item = {}) {
  const cat = objectCategory(item);
  const kind = item.kind || "";
  if (cat === "light" || kind === "light_panel") return "lightingPowerW";
  if (cat === "pump" || kind === "pump") return "pumpPowerW";
  if (cat === "air_conditioner" || cat === "fan" || ["ac_indoor", "ac_outdoor", "ac_floor", "ac_duct", "recirc", "vent_unit", "blade_fan"].includes(kind)) return "climatePowerW";
  if (cat === "sensor" || cat === "relay_box" || cat === "junction_box" || kind === "sensor") return "automationPowerW";
  return "otherPowerW";
}

function isWetZone(zone = {}) {
  const text = `${zone.name || ""} ${zone.category || ""} ${zone.climateZone || ""} ${zone.sanitationZone || ""}`.toLowerCase();
  return /(water|irrigation|drain|shower|toilet|waste|wet|мойк|влаж)/.test(text);
}

function zoneContainsPoint(zone, p) {
  if (zone.polygon?.length >= 3) return pointInPolygon(p, zone.polygon);
  if (zone.x == null || zone.y == null || zone.w == null || zone.h == null) return false;
  return p.x >= zone.x && p.x <= zone.x + zone.w && p.y >= zone.y && p.y <= zone.y + zone.h;
}

function zoneForItem(item, zones = []) {
  const p = { x: item.x + (item.w || item.widthMm || 0) / 2, y: item.y + (item.h || item.depthMm || 0) / 2 };
  return (zones || []).find((z) => zoneContainsPoint(z, p)) || null;
}

function normalizePowerLine(line = {}) {
  const pts = line.points || line.pts || [];
  const fromObjectId = line.fromObjectId || line.fromItemId || null;
  const toObjectId = line.toObjectId || line.toItemId || null;
  return {
    ...line,
    type: "power_line",
    lineType: line.lineType || (line.lineTag === "sensor" ? "sensor_wire" : "wall_cable"),
    points: pts,
    pts,
    fromObjectId,
    toObjectId,
    groupName: line.groupName || "",
    cableType: line.cableType || "ВВГнг-LS",
    powerW: num(line.powerW, 0),
    voltage: num(line.voltage, 220),
    phases: num(line.phases, line.voltage >= 380 ? 3 : 1),
    visibleOnSheets: Array.isArray(line.visibleOnSheets) && line.visibleOnSheets.length
      ? line.visibleOnSheets
      : (line.layer === "light" ? ["lighting", "electrical", "specification"] : ["electrical", "lighting", "specification"]),
  };
}

export function isElectricalObject(item = {}) {
  const cat = objectCategory(item);
  if (ELECTRICAL_OBJECT_CATEGORIES.has(cat)) return true;
  return ["panel", "socket", "light_panel", "sensor", "water_valve"].includes(item.kind || "");
}

export function isPowerLine(line = {}) {
  return line.type === "power_line" || line.layer === "power" || line.layer === "light" || line.lineTag === "sensor";
}

export function calculatePowerLineLength(line = {}) {
  const l = normalizePowerLine(line);
  return linePlanLengthMm(l.points || l.pts || []);
}

export function estimateCableSpecLength(plan = {}) {
  const lines = (plan.lines || []).filter(isPowerLine).map(normalizePowerLine);
  const totalMm = lines.reduce((s, l) => s + calculatePowerLineLength(l), 0);
  const m = totalMm / 1000;
  return Math.ceil(m * 1.15 * 100) / 100;
}

export function ensureElectricalGroups(groups = []) {
  const map = new Map((groups || []).map((g) => [g.name || g.id, g]));
  return DEFAULT_GROUPS.map((base) => {
    const src = map.get(base.name) || map.get(base.id) || {};
    return {
      ...base,
      ...src,
      id: src.id || base.id,
      name: src.name || base.name,
      voltage: num(src.voltage, base.voltage),
      phases: num(src.phases, base.phases),
      maxPowerW: num(src.maxPowerW, base.maxPowerW),
      currentPowerW: num(src.currentPowerW, 0),
      breakerType: src.breakerType || base.breakerType,
      rcd: src.rcd !== false,
      cableType: src.cableType || base.cableType,
      color: src.color || base.color,
      objectIds: uniq(src.objectIds || []),
    };
  });
}

export function calculateElectricalLoads(plan = {}) {
  const groups = ensureElectricalGroups(plan.electricalGroups || []);
  const groupByName = new Map(groups.map((g) => [g.name, { ...g, currentPowerW: 0, objectIds: [] }]));
  const totals = {
    totalPowerW: 0,
    lightingPowerW: 0,
    pumpPowerW: 0,
    climatePowerW: 0,
    automationPowerW: 0,
    otherPowerW: 0,
    objectCount: 0,
  };
  const objectLoads = [];
  (plan.items || []).forEach((it) => {
    if (!isElectricalObject(it) && objectPowerW(it) <= 0) return;
    const powerW = objectPowerW(it);
    const gName = groupNameForObject(it);
    const cls = powerClass(it);
    totals.totalPowerW += powerW;
    totals[cls] += powerW;
    totals.objectCount += 1;
    if (gName && groupByName.has(gName)) {
      const g = groupByName.get(gName);
      g.currentPowerW += powerW;
      g.objectIds.push(it.id);
    }
    objectLoads.push({
      objectId: it.id,
      category: objectCategory(it) || it.kind || "object",
      groupName: gName || null,
      powerW,
      voltage: objectVoltage(it),
      phases: objectPhases(it),
    });
  });

  const lines = (plan.lines || []).filter(isPowerLine).map(normalizePowerLine);
  const lineLoads = lines.map((l) => ({
    lineId: l.id,
    lengthMm: calculatePowerLineLength(l),
    groupName: l.groupName || null,
    powerW: l.powerW || 0,
  }));

  const resolvedGroups = groups.map((g) => {
    const src = groupByName.get(g.name) || g;
    return {
      ...g,
      currentPowerW: Math.round(src.currentPowerW || 0),
      objectIds: uniq(src.objectIds || []),
    };
  });
  return {
    objectLoads,
    groups: resolvedGroups,
    totals: {
      ...totals,
      totalPowerKw: Math.round((totals.totalPowerW / 1000) * 100) / 100,
    },
    lineLoads,
  };
}

export function syncRackLinkedLights(items = []) {
  const byId = new Map((items || []).map((it) => [it.id, it]));
  return (items || []).map((it) => {
    const cat = objectCategory(it);
    if (cat !== "light") return it;
    const params = { ...(it.params || {}) };
    const rackId = params.linkedRackId;
    if (!rackId || !byId.has(rackId)) return it;
    const rack = byId.get(rackId);
    const levels = Math.max(1, num(rack.params?.levels || rack.tierCount, 1));
    const perLevel = Math.max(1, num(params.perLevel || params.count || 1, 1));
    const count = levels * perLevel;
    const lengthCm = Math.round(num(params.lengthMm, 1000) / 10);
    const powerW = num(params.powerW, 0);
    const offsetX = params.offsetX != null ? num(params.offsetX) : num(it.x) - num(rack.x);
    const offsetY = params.offsetY != null ? num(params.offsetY) : num(it.y) - num(rack.y);
    return {
      ...it,
      x: rack.x + offsetX,
      y: rack.y + offsetY,
      params: {
        ...params,
        levels,
        perLevel,
        count,
        offsetX,
        offsetY,
      },
      label: `${perLevel}×${lengthCm} см / ярус · ${levels} ярусов · ${powerW * count} Вт`,
    };
  });
}

export function moveLinkedLightsWithRack(items = [], rackId, dx, dy) {
  return (items || []).map((it) => {
    const cat = objectCategory(it);
    const linkedRackId = it.params?.linkedRackId;
    if (cat !== "light" || linkedRackId !== rackId) return it;
    return { ...it, x: num(it.x) + dx, y: num(it.y) + dy };
  });
}

export function collectElectricalWarnings(plan = {}) {
  const warnings = [];
  const loads = calculateElectricalLoads(plan);
  const groupsByName = new Map(loads.groups.map((g) => [g.name, g]));
  const powerLines = (plan.lines || []).filter(isPowerLine).map(normalizePowerLine);
  const hasPowerLineForObject = (id) => powerLines.some((ln) => ln.fromObjectId === id || ln.toObjectId === id);
  const objectsById = new Map((plan.items || []).map((it) => [it.id, it]));

  (plan.items || []).forEach((it) => {
    const cat = objectCategory(it);
    const p = it.params || {};
    const gName = groupNameForObject(it);
    const zone = zoneForItem(it, plan.zones || []);
    const wet = zone && isWetZone(zone);

    if (cat === "socket" && !gName) {
      warnings.push({ id: `socket-no-group-${it.id}`, severity: "warning", objectIds: [it.id], text: "Розетка без группы" });
    }
    if (cat === "socket" && wet) {
      const ip = String(p.protectionIp || "").toUpperCase();
      const ipNum = Number(ip.replace(/[^0-9]/g, "").slice(0, 2) || 0);
      if (!p.waterproof && ipNum < 44) {
        warnings.push({ id: `socket-wet-${it.id}`, severity: "warning", objectIds: [it.id], text: "Розетка во влажной зоне без waterproof/IP" });
      }
    }
    if (cat === "pump" || it.kind === "pump") {
      const hasPumpSocket = (plan.items || []).some((s) => {
        const sp = s.params || {};
        return objectCategory(s) === "socket"
          && (sp.socketType === "pump_socket" || sp.linkedObjectId === it.id || distCenter(s, it) < 1400);
      });
      if (!hasPumpSocket) {
        warnings.push({ id: `pump-no-socket-${it.id}`, severity: "warning", objectIds: [it.id], text: "Насос без отдельной розетки" });
      }
    }
    if (objectPowerW(it) > 0 && !hasPowerLineForObject(it.id)) {
      warnings.push({ id: `power-no-line-${it.id}`, severity: "warning", objectIds: [it.id], text: "Объект с powerW без линии питания" });
    }
    if (cat === "electrical_panel" && !num(p.maxPowerKw, 0)) {
      warnings.push({ id: `panel-no-max-power-${it.id}`, severity: "warning", objectIds: [it.id], text: "Щит без maxPowerKw" });
    }
    if (cat === "light" && !gName) {
      warnings.push({ id: `light-no-group-${it.id}`, severity: "warning", objectIds: [it.id], text: "Светильник без группы" });
    }
    if (gName && groupsByName.has(gName)) {
      const g = groupsByName.get(gName);
      if (objectVoltage(it) >= 380 && num(g.voltage, 220) < 300) {
        warnings.push({ id: `voltage-mismatch-${it.id}`, severity: "warning", objectIds: [it.id], text: "380В объект подключен к 220В группе" });
      }
    }
  });

  powerLines.forEach((ln) => {
    if (!ln.fromObjectId || !ln.toObjectId || !objectsById.has(ln.fromObjectId) || !objectsById.has(ln.toObjectId)) {
      warnings.push({ id: `line-no-endpoints-${ln.id}`, severity: "warning", objectIds: [ln.id], text: "Линия питания без from/to" });
    }
  });

  loads.groups.forEach((g) => {
    if (num(g.maxPowerW, 0) > 0 && num(g.currentPowerW, 0) > num(g.maxPowerW, 0)) {
      warnings.push({
        id: `group-overload-${g.id}`,
        severity: "warning",
        objectIds: g.objectIds || [],
        text: `Группа ${g.name} перегружена`,
      });
    }
  });

  return warnings;
}

function distCenter(a, b) {
  const ac = { x: num(a.x) + num(a.w || a.widthMm, 0) / 2, y: num(a.y) + num(a.h || a.depthMm, 0) / 2 };
  const bc = { x: num(b.x) + num(b.w || b.widthMm, 0) / 2, y: num(b.y) + num(b.h || b.depthMm, 0) / 2 };
  return Math.hypot(ac.x - bc.x, ac.y - bc.y);
}

export function syncElectricalPlan(plan = {}) {
  const lines = (plan.lines || []).map((ln) => (isPowerLine(ln) ? normalizePowerLine(ln) : ln));
  const items = syncRackLinkedLights(plan.items || []);
  const loads = calculateElectricalLoads({ ...plan, items, lines });
  return {
    ...plan,
    items,
    lines,
    electricalGroups: loads.groups,
    electricalLoads: loads,
  };
}
