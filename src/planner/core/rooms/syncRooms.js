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

/** Next free "Помещение N" not present in usedNames. */
function nextUniqueRoomName(usedNames, preferredIndex = 0) {
  let n = Math.max(1, preferredIndex + 1);
  while (usedNames.has(`Помещение ${n}`)) n += 1;
  return `Помещение ${n}`;
}

/**
 * Ensure display labels are unique after sync. Prefer previous names when free;
 * never emit two identical "Помещение N" labels.
 */
export function ensureUniqueRoomLabels(rooms) {
  const usedNames = new Set();
  const usedIds = new Set();
  return (rooms || []).map((room, idx) => {
    let id = room.id;
    if (!id || usedIds.has(id)) {
      id = `${room.id || "rm"}-${idx + 1}`;
      let suffix = 2;
      while (usedIds.has(id)) {
        id = `${room.id || "rm"}-${idx + 1}-${suffix}`;
        suffix += 1;
      }
    }
    usedIds.add(id);

    let name = (room.name || "").trim();
    if (!name || usedNames.has(name)) {
      name = nextUniqueRoomName(usedNames, idx);
    }
    usedNames.add(name);
    return id === room.id && name === room.name ? room : { ...room, id, name };
  });
}

function roomModelFromDetection(match, idx, plan, walls, items, usedNames) {
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
  let name = previous?.name || null;
  if (!name || usedNames.has(name)) {
    name = nextUniqueRoomName(usedNames, idx);
  }
  usedNames.add(name);
  return {
    id: previous?.id || match.fallbackId,
    type: "room",
    name,
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
  const usedNames = new Set();
  const roomsRaw = matched.map((m, idx) => roomModelFromDetection(m, idx, plan, walls, items, usedNames));
  const rooms = ensureUniqueRoomLabels(roomsRaw);
  const zones = rooms.map((room) => roomToZone(room));
  const validationWarnings = validateRooms(plan, rooms);
  return { rooms, zones, validationWarnings };
}

export const ROOM_DETECTION_FAILED = "ROOM_DETECTION_FAILED";

function roomDetectionFailedDiagnostic() {
  return {
    code: ROOM_DETECTION_FAILED,
    severity: "error",
    entityType: "plan",
    entityId: null,
    path: "",
    message: "Не удалось определить помещения. Проверьте соединения и пересечения стен.",
    relatedEntityIds: [],
    metadata: { source: "room-detection" },
  };
}

function logRoomDetectionFailure(err) {
  if (typeof process !== "undefined" && process.env?.NODE_ENV === "production") return;
  if (typeof import.meta !== "undefined" && import.meta.env?.PROD) return;
  console.error("[room-detection] syncRooms failed", err);
}

/**
 * Единственная точка перехвата исключений room detection.
 *
 * Превращает исключение низкоуровневого движка в структурированный
 * result-контракт вместо того, чтобы каждый caller (normalizePlan, PlanPage)
 * держал собственный catch { rooms: [] }.
 *
 * Успех и «нет замкнутых контуров» различимы: оба ok:true, но последнее —
 * честный rooms:[] БЕЗ diagnostics, а сбой движка — ok:false, rooms:null,
 * zones:null, validationWarnings:null, с diagnostic ROOM_DETECTION_FAILED.
 * Caller обязан не записывать rooms:null/zones:null напрямую, а сохранить
 * предыдущие корректные rooms/zones.
 *
 * @param {object} plan
 * @param {(plan:object)=>{rooms,zones,validationWarnings}} [syncFn] — точка
 *   инъекции для тестов controlled-failure; production вызывает без аргумента.
 */
export function syncRoomsSafe(plan, syncFn = syncRooms) {
  try {
    const { rooms, zones, validationWarnings } = syncFn(plan);
    return { ok: true, rooms, zones, validationWarnings, diagnostics: [] };
  } catch (err) {
    logRoomDetectionFailure(err);
    return { ok: false, rooms: null, zones: null, validationWarnings: null, diagnostics: [roomDetectionFailedDiagnostic()] };
  }
}
