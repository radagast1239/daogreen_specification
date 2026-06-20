import { uid } from "../store/helpers.js";

export function newRoom(name = "") {
  const n = (name || "").trim();
  return { id: uid("room"), name: n || "Комната" };
}

export function defaultRooms() {
  return [newRoom("Комната 1")];
}

export function roomLabel(rooms, roomId) {
  if (!roomId) return "";
  return rooms?.find((r) => r.id === roomId)?.name || "";
}

/** Позиция из разделов «Ферма целиком», не из стеллажа */
export function isFarmGeneralItem(project, item) {
  const stellageNames = new Set((project?.stellageConfigs || []).map((s) => s.name));
  return item?.module && !stellageNames.has(item.module);
}
