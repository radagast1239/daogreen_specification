import {
  detectRooms,
  matchRooms,
  normalizeLegacyRoomsFromZones,
  resolveRoomLabelPosition,
} from "./detectRooms.js";
import { resolveWallPtsList, weldWallNodes } from "../walls/wallOps.js";
import {
  ROOM_CATEGORY_COLORS,
  normalizeRoomCategory,
  roomCategoryColor,
} from "./categories.js";
import { validateRooms } from "./validateRooms.js";
import { polygonBounds } from "../walls/wallOps.js";

export const DEFAULT_ROOM_HEIGHT_MM = 3000;

function roomName(index) {
  return `Помещение ${index + 1}`;
}

function roomModelFromDetection(match, idx, plan, walls, items) {
  const previous = match.previous;
  const detected = match.detected;
  const category = normalizeRoomCategory(previous?.category || "other");
  const heightMm = previous?.heightMm
    || previous?.height
    || plan?.room?.defaultRoomHeightMm
    || plan?.room?.height
    || DEFAULT_ROOM_HEIGHT_MM;
  const labelPosition = resolveRoomLabelPosition(
    detected.polygon,
    walls,
    items,
    previous?.labelPosition || null,
  );
  return {
    id: previous?.id || match.fallbackId,
    type: "room",
    name: previous?.name || roomName(idx),
    category,
    contourId: detected.contourId,
    polygon: detected.polygon,
    areaMm2: detected.areaMm2,
    areaM2: +(detected.areaMm2 / 1_000_000).toFixed(2),
    heightMm: Math.round(heightMm),
    labelPosition,
    fillColor: previous?.fillColor || roomCategoryColor(category),
    visible: previous?.visible !== false,
    locked: previous?.locked === true,
    climateZone: previous?.climateZone || null,
    sanitationZone: previous?.sanitationZone || null,
    productionZone: previous?.productionZone || null,
    targetTemperatureC: previous?.targetTemperatureC ?? null,
    targetRh: previous?.targetRh ?? null,
    targetCo2Ppm: previous?.targetCo2Ppm ?? null,
    targetAirChanges: previous?.targetAirChanges ?? null,
    targetAirVelocityMs: previous?.targetAirVelocityMs ?? null,
    notes: previous?.notes || "",
  };
}

export function roomToZone(room) {
  const b = polygonBounds(room.polygon || []);
  const fallback = b || { x: 0, y: 0, w: 0, h: 0 };
  const fillColor = room.fillColor || ROOM_CATEGORY_COLORS[normalizeRoomCategory(room.category)] || null;
  return {
    id: room.id,
    x: fallback.x,
    y: fallback.y,
    w: fallback.w,
    h: fallback.h,
    name: room.name,
    category: room.category,
    polygon: room.polygon,
    auto: true,
    height: room.heightMm,
    heightMm: room.heightMm,
    areaMm2: room.areaMm2,
    areaM2: room.areaM2,
    fillColor,
    zoneColor: fillColor,
    labelPosition: room.labelPosition,
    visible: room.visible,
    locked: room.locked,
    climateZone: room.climateZone,
    sanitationZone: room.sanitationZone,
    productionZone: room.productionZone,
    targetTemperatureC: room.targetTemperatureC,
    targetRh: room.targetRh,
    targetCo2Ppm: room.targetCo2Ppm,
    targetAirChanges: room.targetAirChanges,
    targetAirVelocityMs: room.targetAirVelocityMs,
    notes: room.notes,
    showName: true,
    showArea: true,
    showHeight: true,
  };
}

export function syncRooms(plan) {
  const detected = detectRooms(plan);
  const walls = weldWallNodes(resolveWallPtsList(plan?.walls, plan?.nodes));
  const items = plan?.items || [];
  const oldRooms = (plan?.rooms || []).length
    ? plan.rooms
    : normalizeLegacyRoomsFromZones(plan?.zones, plan?.room?.defaultRoomHeightMm || DEFAULT_ROOM_HEIGHT_MM);

  const matched = matchRooms(oldRooms, detected);
  const rooms = matched.map((m, idx) => roomModelFromDetection(m, idx, plan, walls, items));
  const zones = rooms.map((room) => roomToZone(room));
  const validationWarnings = validateRooms(plan, rooms);
  return { rooms, zones, validationWarnings };
}
