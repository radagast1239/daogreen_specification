import { uid } from "../store/helpers.js";

export const ROOM_NAME_HINTS = [
  "Манипуляционная",
  "Водоподготовка",
  "Рассадное отделение",
  "Теплица / ферма",
  "Склад",
  "Постамент / цоколь",
];

export function newRoom(name = "") {
  const n = (name || "").trim();
  return {
    id: uid("room"),
    name: n || "Комната",
    area: "",
    height: "",
    volume: "",
    heatGainW: "",
    lightingW: "",
    peopleEquipW: "",
    targetTempC: "",
    reservePct: 15,
    recommendedCoolingKw: "",
    selectedItemId: "",
    actualCoolingKw: "",
    comment: "",
  };
}

export function defaultRooms() {
  return [
    newRoom("Манипуляционная"),
    newRoom("Водоподготовка"),
    newRoom("Рассадное отделение"),
  ];
}

export function roomLabel(rooms, roomId) {
  if (!roomId) return "";
  const r = rooms?.find((x) => x.id === roomId);
  if (!r) return "";
  const area = r.area != null && r.area !== "" ? ` · ${r.area} м²` : "";
  return `${r.name}${area}`;
}

/** Позиция из разделов «Ферма целиком», не из стеллажа */
export function isFarmGeneralItem(project, item) {
  const stellageNames = new Set((project?.stellageConfigs || []).map((s) => s.name));
  return item?.module && !stellageNames.has(item.module);
}
