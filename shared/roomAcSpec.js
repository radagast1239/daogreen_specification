import {
  aggregateSplitCoolingKw,
  normalizeSplitSpecs,
  splitSpecsClientNote,
} from "./splitSpecs.js";
import { enrichRoom, recommendedCoolingKw } from "./roomCoolingCalc.js";

function uid(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export const AC_ITEM_NAME = "Сплит-система / кондиционер";
export const AC_ITEM_SECTION = "Климат и вентиляция";

export function blankAcUnit(overrides = {}) {
  return {
    id: uid("acu"),
    qty: 1,
    coolingKw: "",
    link: "",
    comment: "",
    ...overrides,
  };
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Рекомендованная мощность по комнате: применённый расчёт в приоритете, иначе — модель нагрузки. */
export function roomAcRecommendedKw(room) {
  const applied = toNum(room?.cooling?.recommendedKw);
  if (applied > 0) return applied;
  return recommendedCoolingKw(enrichRoom(room || {}));
}

/** Рекомендованный BTU/ч по комнате: стандарт из расчёта, иначе BTU расчёта, иначе из кВт. */
export function roomAcRecommendedBtu(room) {
  const standard = Math.round(toNum(room?.cooling?.standardBtu));
  if (standard > 0) return standard;

  const btu = Math.round(toNum(room?.cooling?.btu));
  if (btu > 0) return btu;

  const kw = roomAcRecommendedKw(room);
  return kw > 0 ? Math.round(kw * 3412.142) : 0;
}

/** Строки сплита по комнате — минимум одна для редактора */
export function roomAcUnits(room) {
  if (Array.isArray(room?.acUnits) && room.acUnits.length) {
    return room.acUnits.map((u) => ({
      ...blankAcUnit(),
      ...u,
      id: u.id || uid("acu"),
    }));
  }
  return [blankAcUnit()];
}

export function splitSpecsFromAcUnits(units) {
  return normalizeSplitSpecs(
    (units || []).map((u) => ({
      qty: u.qty,
      coolingKw: u.coolingKw,
    }))
  );
}

export function actualCoolingKwFromUnits(units) {
  return aggregateSplitCoolingKw(splitSpecsFromAcUnits(units));
}

export function actualCoolingFromRoom(room) {
  return actualCoolingKwFromUnits(room?.acUnits);
}

export function flattenRoomAcSpecRows(rooms) {
  return (rooms || []).flatMap((room) =>
    roomAcUnits(room).map((unit) => ({
      unit,
      roomId: room.id,
      roomName: room.name,
      recommendedKw: roomAcRecommendedKw(room),
      recommendedBtu: roomAcRecommendedBtu(room),
      rowKey: `${room.id}__${unit.id}`,
    }))
  );
}

export function patchRoomAcUnits(rooms, roomId, unitId, patch) {
  return (rooms || []).map((room) => {
    if (room.id !== roomId) return room;
    const units = roomAcUnits(room).map((u) => (u.id === unitId ? { ...u, ...patch } : u));
    return { ...room, acUnits: units };
  });
}

export function addRoomAcUnit(rooms, roomId) {
  return (rooms || []).map((room) => {
    if (room.id !== roomId) return room;
    const units = [...roomAcUnits(room), blankAcUnit()];
    return { ...room, acUnits: units };
  });
}

export function removeRoomAcUnit(rooms, roomId, unitId) {
  return (rooms || []).map((room) => {
    if (room.id !== roomId) return room;
    const units = roomAcUnits(room).filter((u) => u.id !== unitId);
    return { ...room, acUnits: units.length ? units : [blankAcUnit()] };
  });
}

export function moveAcUnitRoom(rooms, unitId, fromRoomId, toRoomId) {
  if (!toRoomId || fromRoomId === toRoomId) return rooms;
  let moved = null;
  const stripped = (rooms || []).map((room) => {
    if (room.id !== fromRoomId) return room;
    const units = roomAcUnits(room).filter((u) => {
      if (u.id === unitId) {
        moved = u;
        return false;
      }
      return true;
    });
    return { ...room, acUnits: units.length ? units : [blankAcUnit()] };
  });
  if (!moved) return rooms;
  return stripped.map((room) => {
    if (room.id !== toRoomId) return room;
    return { ...room, acUnits: [...roomAcUnits(room), moved] };
  });
}

export function buildAcLineFromRoom(room, sortOrder = 0) {
  const specs = splitSpecsFromAcUnits(room.acUnits);
  if (!specs.length) return null;
  const link = (room.acUnits || []).map((u) => u.link?.trim()).find(Boolean) || "";
  const comment = (room.acUnits || []).map((u) => u.comment?.trim()).filter(Boolean).join("; ");
  const note = splitSpecsClientNote(specs);
  return {
    id: room.acItemId || `ac__${room.id}`,
    materialId: null,
    module: AC_ITEM_SECTION,
    section: AC_ITEM_SECTION,
    name: AC_ITEM_NAME,
    unit: "шт.",
    category: AC_ITEM_SECTION,
    qty: 1,
    price: 0,
    roomId: room.id,
    splitSpecs: specs,
    coolingKw: aggregateSplitCoolingKw(specs),
    clientNote: note ? `${room.name}: ${note}` : room.name,
    link,
    techNote: comment,
    included: true,
    includedInProject: true,
    visibleToClient: true,
    sortOrder,
  };
}

export function buildAcLinesFromRooms(rooms) {
  return (rooms || [])
    .map((room) => buildAcLineFromRoom(room))
    .filter(Boolean);
}
