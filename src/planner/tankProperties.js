export const TANK_KINDS = new Set(["tank"]);

export const TANK_SIZE_PRESETS = [
  { w: 2080, h: 1370, label: "208×137" },
  { w: 2000, h: 2000, label: "200×200" },
  { w: 3000, h: 2000, label: "300×200" },
  { w: 5000, h: 2500, label: "500×250" },
];

export function isTankKind(kind) {
  return TANK_KINDS.has(kind);
}

/** Подпись размеров как на чертеже: 2080×1370 → «208×137». */
export function formatTankPlanSize(wMm, hMm) {
  const w = Number(wMm);
  const h = Number(hMm);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return "";
  const wLabel = Math.round(w / 10);
  const hLabel = Math.round(h / 10);
  return `${wLabel}×${hLabel}`;
}
