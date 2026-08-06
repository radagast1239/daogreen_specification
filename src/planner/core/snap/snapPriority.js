import { SNAP_TYPES } from "./snapTypes.js";

/**
 * Меньше число = выше приоритет.
 * Wall body / mid must beat angle+grid so live drawing can start/end on walls.
 * Order matches CAD wall tool: node → wall body → extension/perp → angle → grid.
 */
export const SNAP_PRIORITY = {
  [SNAP_TYPES.VERTEX]: 1,
  [SNAP_TYPES.WALL_END]: 1,
  [SNAP_TYPES.CLOSE]: 1,
  [SNAP_TYPES.WALL_MID]: 2,
  [SNAP_TYPES.WALL_LINE]: 2,
  [SNAP_TYPES.WALL_EXTENSION]: 3,
  [SNAP_TYPES.PERPENDICULAR]: 4,
  [SNAP_TYPES.PARALLEL]: 5,
  [SNAP_TYPES.ANGLE]: 6,
  [SNAP_TYPES.OBJECT_EDGE]: 7,
  [SNAP_TYPES.OBJECT_CENTER]: 7,
  [SNAP_TYPES.GRID]: 8,
};

export function compareSnapCandidates(a, b) {
  const pa = SNAP_PRIORITY[a.type] ?? 99;
  const pb = SNAP_PRIORITY[b.type] ?? 99;
  if (pa !== pb) return pa - pb;
  return (a.distance ?? 0) - (b.distance ?? 0);
}

export function pickBestSnap(candidates) {
  if (!candidates.length) return null;
  return [...candidates].sort(compareSnapCandidates)[0];
}
