export function formatRoomHeightCm(heightMm) {
  return Math.round((Number(heightMm) || 0) / 10);
}

export function formatRoomHeightLabel(heightMm) {
  return `H=${formatRoomHeightCm(heightMm)}`;
}

export function formatRoomAreaLabel(areaMm2) {
  const areaM2 = (Number(areaMm2) || 0) / 1_000_000;
  return `S=${areaM2.toFixed(2)} м²`;
}
