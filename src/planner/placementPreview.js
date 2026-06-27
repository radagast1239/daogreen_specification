import { catalogByKind, clamp } from "./catalog.js";
import { pointInPolygon } from "./wallGeometry.js";
import { zoneForItem } from "./farmRules.js";
import { isStrictWallItem } from "./doorTypes.js";
import { attachItemZoneFields } from "./roomZones.js";

function zonePolygon(z) {
  if (z.polygon?.length >= 3) return z.polygon;
  return [
    { x: z.x, y: z.y },
    { x: z.x + z.w, y: z.y },
    { x: z.x + z.w, y: z.y + z.h },
    { x: z.x, y: z.y + z.h },
  ];
}

/**
 * Расчёт позиции объекта при установке (preview и клик).
 * @returns {{ valid, blocking, warning, item, guides }}
 */
export function computeItemPlacement({
  mm,
  kind,
  size,
  plan,
  display,
  snapObj,
  attachWall,
  innerL,
  innerR,
  innerT,
  innerB,
}) {
  const c = catalogByKind(kind);
  if (!c) {
    return { valid: false, blocking: true, warning: "Неизвестный тип", item: null, guides: [] };
  }

  const iw = size?.w ?? c.w;
  const ih = size?.h ?? c.h;
  let x = mm.x - iw / 2;
  let y = mm.y - ih / 2;
  let angle = 0;
  let valid = true;
  let blocking = false;
  let warning = null;
  let guides = [];

  if (c.wall) {
    const placed = attachWall({ w: iw, h: ih, kind: c.kind }, x, y);
    if (!placed || placed.error) {
      return {
        valid: false,
        blocking: isStrictWallItem(c.kind),
        warning: placed?.error || (isStrictWallItem(c.kind) ? "Только на стене" : "Нет стены рядом"),
        item: {
          kind: c.kind,
          icon: c.icon,
          layer: c.layer,
          label: c.label,
          color: c.color,
          w: iw,
          h: ih,
          x,
          y,
          angle: 0,
          wall: true,
        },
        guides: [],
      };
    }
    x = placed.x;
    y = placed.y;
    angle = placed.angle || 0;
  } else {
    const zones = plan.zones || [];
    const insideAny = zones.some((z) => pointInPolygon({ x: mm.x, y: mm.y }, zonePolygon(z)));

    if (display.onlyInsideRooms && zones.length > 0 && !insideAny) {
      valid = false;
      blocking = true;
      warning = "Объект вне помещения";
    } else if (zones.length > 0 && !insideAny) {
      warning = "Объект вне помещения";
    }

    const s = snapObj("items", { id: "_new", w: iw, h: ih }, x, y);
    x = clamp(s.x, innerL, innerR - iw);
    y = clamp(s.y, innerT, innerB - ih);
    guides = display.snapGuides !== false ? (s.guides || []) : [];
  }

  let item = {
    kind: c.kind,
    icon: c.icon,
    layer: c.layer,
    label: c.label,
    color: c.color,
    w: iw,
    h: ih,
    x,
    y,
    angle,
    wall: !!c.wall,
    wallId: null,
  };

  if (c.wall) {
    const again = attachWall(item, x, y);
    if (again?.error) {
      return { valid: false, blocking: true, warning: again.error, item, guides: [] };
    }
    if (again) {
      item = {
        ...item,
        x: again.x,
        y: again.y,
        angle: again.angle ?? item.angle,
        wallId: again.wallId,
        wallSeg: again.wallSeg,
      };
    }
  } else {
    item = attachItemZoneFields(plan, item);
  }

  return { valid, blocking, warning, item, guides };
}

export function placementZoneLabel(plan, item) {
  if (!item) return null;
  const z = zoneForItem(plan, item);
  return z?.name || null;
}
