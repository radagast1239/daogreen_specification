/** Расчёт охлаждения по комнатам проекта */

export function roomVolume(room) {
  const area = Number(room?.area) || 0;
  const height = Number(room?.height) || 0;
  if (area > 0 && height > 0) return area * height;
  if (room?.volume != null && room.volume !== "") return Number(room.volume) || 0;
  return 0;
}

export function recommendedCoolingKw(room) {
  const lighting = Number(room?.lightingW) || 0;
  const heatManual = Number(room?.heatGainW) || 0;
  const peopleEquip = Number(room?.peopleEquipW) || 0;
  const reserve = Number(room?.reservePct) || 0;
  const loadW = lighting + heatManual + peopleEquip;
  if (!loadW) return 0;
  const baseKw = loadW / 1000;
  return Math.round(baseKw * (1 + reserve / 100) * 100) / 100;
}

export function enrichRoom(room) {
  const volume = roomVolume(room);
  const rec = recommendedCoolingKw(room);
  const volumeStored = room?.volume != null && room.volume !== "";
  return {
    ...room,
    volume: volumeStored ? room.volume : volume || "",
    recommendedCoolingKw: rec || "",
  };
}

export function enrichRooms(rooms) {
  return (rooms || []).map(enrichRoom);
}

export function actualCoolingFromItem(item) {
  if (!item) return 0;
  return Number(item.coolingKw) || 0;
}
