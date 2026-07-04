/**
 * Pure helpers for the "cooling calculator → room" workflow (Step 1).
 *
 * These are pure functions only: they never persist anything and never mutate
 * their arguments — they return new objects. The saved project format is NOT
 * changed by this module. The applied cooling data is kept in a single,
 * namespaced `room.cooling` snapshot so the storage decision (on the room vs.
 * a separate structure) can be made later without touching this logic.
 */

import { enrichRoom, recommendedCoolingKw, roomVolume } from "./roomCoolingCalc.js";
import { actualCoolingFromRoom, blankAcUnit, roomAcUnits } from "./roomAcSpec.js";

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

export const ROOM_COOLING_STATUS = {
  NO_CALC: { id: "no_calc", label: "Нет расчёта" },
  NO_MODEL: { id: "no_model", label: "Модель не выбрана" },
  ENOUGH: { id: "enough", label: "Мощности хватает" },
  NOT_ENOUGH: { id: "not_enough", label: "Недостаточно мощности" },
};

/**
 * Build a normalized cooling snapshot from a CoolingFarmTab calculation.
 * `inputs` — raw form inputs (length/width/height/safetyFactor…),
 * `calc`   — computeCoolingFarm(inputs) result (totalKwSafety, modelBtu…).
 */
export function coolingSnapshotFromFarmCalc(inputs = {}, calc = {}) {
  const length = toNum(inputs.length);
  const width = toNum(inputs.width);
  const height = toNum(inputs.height);
  const area = length > 0 && width > 0 ? round2(length * width) : toNum(inputs.area);
  const volume = area > 0 && height > 0 ? round2(area * height) : 0;
  const reservePct =
    inputs.safetyFactor != null && inputs.safetyFactor !== ""
      ? Math.round((toNum(inputs.safetyFactor) - 1) * 100)
      : toNum(inputs.reservePct);
  return {
    params: { ...inputs },
    area,
    height,
    volume,
    reservePct,
    recommendedKw: round2(toNum(calc.totalKwSafety)),
    btu: Math.round(toNum(calc.modelBtu)),
    standardBtu: Math.round(toNum(calc.standardBtu)),
    model: inputs.model || "",
  };
}

/**
 * Apply a cooling snapshot to a single room. Returns a NEW room object.
 * Additive: stores everything under a namespaced `room.cooling` snapshot and
 * refreshes the flat fields the room table already reads (area/height/volume/
 * reservePct). Nothing is persisted here.
 */
export function applyCoolingCalcToRoom(room, snapshot = {}) {
  if (!room) return room;
  const area = toNum(snapshot.area) || toNum(room.area);
  const height = toNum(snapshot.height) || toNum(room.height);
  const volume =
    toNum(snapshot.volume) || (area > 0 && height > 0 ? round2(area * height) : roomVolume(room));
  const reservePct =
    snapshot.reservePct != null && snapshot.reservePct !== "" ? snapshot.reservePct : room.reservePct;
  const existingAcUnits = Array.isArray(room.acUnits) ? room.acUnits : [];
  const acUnits = existingAcUnits.length ? existingAcUnits : [blankAcUnit()];
  return {
    ...room,
    area: area || room.area || "",
    height: height || room.height || "",
    volume: volume || room.volume || "",
    reservePct,
    acUnits,
    cooling: {
      name: room.name,
      area,
      height,
      volume,
      params: snapshot.params ? { ...snapshot.params } : {},
      recommendedKw: round2(toNum(snapshot.recommendedKw)),
      btu: Math.round(toNum(snapshot.btu)),
      standardBtu: Math.round(toNum(snapshot.standardBtu)),
      reservePct: snapshot.reservePct != null ? snapshot.reservePct : "",
      model: snapshot.model || "",
      actualKw: actualCoolingFromRoom(room) || 0,
    },
  };
}

/**
 * Apply a snapshot to the active room and pick the next room in the list.
 * Returns { rooms, nextRoomId, hasNext }. When the active room is last (or
 * missing) `nextRoomId` is null and `hasNext` is false — the UI then offers to
 * add a new room or stay put.
 */
export function applyAndSelectNextRoom(rooms, activeRoomId, snapshot = {}) {
  const list = rooms || [];
  const idx = list.findIndex((r) => r.id === activeRoomId);
  const nextRooms = list.map((r) =>
    r.id === activeRoomId ? applyCoolingCalcToRoom(r, snapshot) : r
  );
  const nextRoomId = idx >= 0 && idx < list.length - 1 ? list[idx + 1].id : null;
  return { rooms: nextRooms, nextRoomId, hasNext: nextRoomId != null };
}

/** Recommended kW for a room — prefers the applied snapshot, else the per-room load model. */
export function roomRecommendedKw(room) {
  const applied = toNum(room?.cooling?.recommendedKw);
  if (applied > 0) return applied;
  return recommendedCoolingKw(enrichRoom(room || {}));
}

/** True when a cooling calculation has been applied to the room (snapshot present). */
export function isRoomCoolingFilled(room) {
  const c = room?.cooling;
  return !!c && (toNum(c.recommendedKw) > 0 || toNum(c.volume) > 0 || toNum(c.area) > 0);
}

/** Compute the workflow status of a room. Returns one of ROOM_COOLING_STATUS entries. */
export function roomCoolingStatus(room) {
  const rec = roomRecommendedKw(room);
  const actual = actualCoolingFromRoom(room);
  // Выбрана фактическая модель — сравниваем её холод с рекомендованным.
  if (actual > 0) {
    return actual + 1e-6 >= rec ? ROOM_COOLING_STATUS.ENOUGH : ROOM_COOLING_STATUS.NOT_ENOUGH;
  }
  // Есть расчёт, но модель ещё не выбрана.
  if (rec > 0) return ROOM_COOLING_STATUS.NO_MODEL;
  return ROOM_COOLING_STATUS.NO_CALC;
}

/**
 * Copy the room's recommended kW into an AC spec row (unit). Returns a NEW room.
 * Only fills an empty `coolingKw` so a manual pick is never overwritten.
 */
export function fillAcUnitFromRecommendation(room, unitId) {
  if (!room) return room;
  const rec = roomRecommendedKw(room);
  if (!(rec > 0)) return room;
  const units = roomAcUnits(room).map((u) => {
    if (u.id !== unitId) return u;
    if (u.coolingKw != null && u.coolingKw !== "") return u;
    return { ...u, coolingKw: rec };
  });
  return { ...room, acUnits: units };
}

/** Stored calc params for prefilling a new room ("Дублировать параметры"). */
export function coolingParamsFromRoom(room) {
  return room?.cooling?.params ? { ...room.cooling.params } : {};
}

/** Clear the applied cooling snapshot from a room ("Очистить расчёт комнаты"). Returns a NEW room. */
export function clearRoomCooling(room) {
  if (!room) return room;
  const { cooling, ...rest } = room;
  return { ...rest };
}
