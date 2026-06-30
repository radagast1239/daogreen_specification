/**
 * Нормализованная модель стены с обратной совместимостью pts[].
 */

export const WALL_TYPE = "wall";
export const DEFAULT_MERGE_VERTEX_MM = 10;
export const MIN_SEGMENT_MM = 50;
export const SNAP_VERTEX_RADIUS_MM = 120;
export const INTERSECTION_TOLERANCE_MM = 2;
export const COLLINEAR_TOLERANCE_DEG = 1;

export function normalizeWall(raw = {}, defaults = {}) {
  const now = Date.now();
  const id = raw.id || defaults.makeId?.("wl") || `wl_${now}`;
  return {
    ...raw,
    id,
    type: raw.type || WALL_TYPE,
    chainId: raw.chainId || id,
    pts: (raw.pts || []).map((p) => ({ x: p.x, y: p.y })),
    thk: raw.thk ?? defaults.thk ?? 100,
    role: raw.role || defaults.role || "partition",
    kind: raw.kind || defaults.kind || "new",
    material: raw.material ?? defaults.material ?? "",
    height: raw.height ?? defaults.height ?? 3000,
    thicknessSide: raw.thicknessSide || "center",
    locked: raw.locked ?? false,
    createdAt: raw.createdAt || now,
    updatedAt: now,
  };
}

export function normalizeWallsList(walls = [], defaults = {}) {
  return walls.map((w) => normalizeWall(w, defaults));
}

/** Создать одну wall-chain (полилиния centerline). */
export function createWallChain(pts, props = {}, makeId) {
  if (!pts || pts.length < 2) return null;
  const id = makeId("wl");
  return normalizeWall({
    ...props,
    id,
    chainId: props.chainId || id,
    pts: pts.map((p) => ({ x: p.x, y: p.y })),
  }, props);
}

/** Миграция legacy: добавить недостающие поля без изменения pts. */
export function upgradeLegacyWall(w) {
  if (!w) return w;
  if (w.type === WALL_TYPE && w.chainId) return w;
  return normalizeWall(w);
}
