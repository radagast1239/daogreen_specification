import { catalogByKind } from "./catalog.js";
import { itemRect, rectsIntersect } from "./selectionHelpers.js";

/** Столы — поверхность, на которую можно ставить мелкие предметы. */
export const TABLE_SURFACE_KINDS = new Set([
  "table_sow",
  "table_recv",
  "table_manip",
  "table_subs",
]);

/** Предметы, которые можно ставить поверх стола (но не на пол/другие объекты). */
export const STACKABLE_ON_TABLE_KINDS = new Set([
  "notebook",
  "scales_tb",
]);

export function isTableSurface(kind) {
  return TABLE_SURFACE_KINDS.has(kind);
}

export function canStackOnTable(kind) {
  return STACKABLE_ON_TABLE_KINDS.has(kind);
}

export function isFloorFootprintItem(it) {
  return !!it && !it.wall;
}

/** Разрешено ли размещение candidate поверх base (например ноутбук на столе). */
export function isAllowedTableStack(candidate, base) {
  if (!candidate || !base) return false;
  if (candidate.id && candidate.id === base.id) return false;
  return canStackOnTable(candidate.kind) && isTableSurface(base.kind);
}

export function itemsFootprintOverlap(a, b) {
  if (!a || !b) return false;
  return rectsIntersect(itemRect(a), itemRect(b));
}

export function overlapConflictLabel(item) {
  if (!item) return "объектом";
  return item.label || catalogByKind(item.kind)?.label || "объектом";
}

/**
 * Блокирует пересечение footprint с другими напольными объектами.
 * Исключение: мелкие предметы (ноутбук, настольные весы) на столе.
 */
export function itemOverlapsBlocked(item, existingItems, options = {}) {
  if (!item || !isFloorFootprintItem(item)) {
    return { blocked: false };
  }

  const exclude = new Set(options.excludeIds || []);
  if (options.excludeId) exclude.add(options.excludeId);

  for (const other of existingItems || []) {
    if (!other || exclude.has(other.id)) continue;
    if (!isFloorFootprintItem(other)) continue;
    if (!itemsFootprintOverlap(item, other)) continue;
    if (isAllowedTableStack(item, other) || isAllowedTableStack(other, item)) continue;
    return { blocked: true, conflicting: other };
  }

  return { blocked: false };
}
