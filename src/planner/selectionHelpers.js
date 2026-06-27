/** Прямоугольники пересекаются. */
export function rectsIntersect(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function itemRect(it) {
  return { x: it.x, y: it.y, w: it.w, h: it.h };
}

export function normalizeMarquee(x1, y1, x2, y2) {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  };
}

/** Объекты, пересекающие рамку выделения. */
export function itemsInMarquee(items, x1, y1, x2, y2) {
  const box = normalizeMarquee(x1, y1, x2, y2);
  if (box.w < 2 && box.h < 2) return [];
  return items.filter((it) => rectsIntersect(itemRect(it), box)).map((it) => it.id);
}

export function boundsOfItems(items, ids) {
  const set = new Set(ids);
  const list = items.filter((it) => set.has(it.id));
  if (!list.length) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  list.forEach((it) => {
    x1 = Math.min(x1, it.x);
    y1 = Math.min(y1, it.y);
    x2 = Math.max(x2, it.x + it.w);
    y2 = Math.max(y2, it.y + it.h);
  });
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Все id в той же группе, что и объект. */
export function groupMemberIds(items, item) {
  if (!item?.groupId) return [item.id];
  return items.filter((i) => i.groupId === item.groupId).map((i) => i.id);
}

export function uniqueGroupIds(items) {
  const ids = new Set();
  items.forEach((it) => { if (it.groupId) ids.add(it.groupId); });
  return [...ids];
}
