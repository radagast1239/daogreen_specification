/** Кондиционеры на плане: подписи, defaults. */

export const AC_WALL_KINDS = new Set(["ac_indoor", "ac_duct"]);

export function isAcWallUnit(kind) {
  return AC_WALL_KINDS.has(kind);
}

/** Подпись высоты от пола на символе (как H=210 на референсе, мм → см). */
export function acMountHeightPlanLabel(mountHeightMm) {
  const mm = Number(mountHeightMm);
  if (!Number.isFinite(mm) || mm <= 0) return null;
  return `H=${Math.round(mm / 10)}`;
}

export const AC_MOUNT_HEIGHT_DEFAULT_MM = {
  ac_indoor: 2100,
  ac_duct: 2100,
};

export function defaultAcMountHeightMm(kind) {
  return AC_MOUNT_HEIGHT_DEFAULT_MM[kind] ?? 0;
}
