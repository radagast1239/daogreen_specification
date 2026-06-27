import { polygonArea } from "./wallGeometry.js";
import { zoneForItem } from "./farmRules.js";
import { isDoorKind } from "./doorTypes.js";
import { isOpeningKind } from "./openingTypes.js";

export const ZONE_PURPOSE_PRESETS = [
  { id: "", label: "— не указано —" },
  { id: "grow", label: "Выращивание" },
  { id: "seedling", label: "Рассада" },
  { id: "sanitary", label: "Санузел / санитарная" },
  { id: "technical", label: "Техническая" },
  { id: "storage", label: "Склад / хранение" },
  { id: "buffer", label: "Буфер / санпропускник" },
  { id: "office", label: "Офис / бытовая" },
];

const GROWING_KINDS = new Set([
  "rack", "seed_rack", "table_sow", "table_recv", "table_manip", "table_subs",
  "trolley", "light_panel",
]);

const SAN_KINDS = new Set([
  "toilet", "bidet", "sink_susp", "sink_table", "sink_double",
  "shower_pan", "shower_sys", "trap", "tank_waste", "trashcan",
]);

export function zonePolygon(z) {
  if (z.polygon?.length >= 3) return z.polygon;
  return [
    { x: z.x, y: z.y },
    { x: z.x + z.w, y: z.y },
    { x: z.x + z.w, y: z.y + z.h },
    { x: z.x, y: z.y + z.h },
  ];
}

export function zoneAreaMm2(z) {
  const poly = zonePolygon(z);
  return poly.length >= 3 ? polygonArea(poly) : Math.max(0, (z.w || 0) * (z.h || 0));
}

export function formatZoneAreaM2(z) {
  return (zoneAreaMm2(z) / 1e6).toFixed(2);
}

export function zonePerimeterMm(z) {
  const poly = zonePolygon(z);
  let len = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    len += Math.hypot(poly[j].x - poly[i].x, poly[j].y - poly[i].y);
  }
  return len;
}

/** Привязать объект к помещению по центру. */
export function attachItemZoneFields(plan, item) {
  const z = zoneForItem(plan, item);
  const zoneId = z?.id ?? null;
  const zoneName = z?.name ?? null;
  if (item.zoneId === zoneId && item.zoneName === zoneName) return item;
  return { ...item, zoneId, zoneName };
}

function purposeText(zone) {
  const p = (zone.purpose || "").toLowerCase();
  const preset = ZONE_PURPOSE_PRESETS.find((x) => x.id === zone.purpose);
  return preset ? preset.label.toLowerCase() : p;
}

/** Причина несоответствия назначению помещения или null. */
export function wrongRoomReason(zone, item) {
  if (!zone) return null;
  const p = purposeText(zone);
  if (!p || p === "— не указано —") return null;

  const isSan = zone.purpose === "sanitary" || p.includes("сан") || p.includes("туал") || p.includes("душ");
  const isGrow = zone.purpose === "grow" || zone.purpose === "seedling"
    || p.includes("выращ") || p.includes("производ") || p.includes("рассад");

  if (isSan && GROWING_KINDS.has(item.kind)) {
    return "оборудование выращивания в санитарной зоне";
  }
  if (isGrow && SAN_KINDS.has(item.kind)) {
    return "санитарное оборудование в зоне выращивания";
  }
  return null;
}

/** Предупреждения о несоответствии назначению помещения. */
export function collectRoomPurposeWarnings(plan) {
  const warnings = [];
  const zones = plan.zones || [];
  if (!zones.length) return warnings;

  (plan.items || []).forEach((it) => {
    if (it.wall || isDoorKind(it.kind) || isOpeningKind(it.kind)) return;
    if (it.layer === "room") return;
    const z = zoneForItem(plan, it);
    if (!z) return;
    const reason = wrongRoomReason(z, it);
    if (reason) {
      warnings.push({
        id: `wrong-room-${it.id}`,
        severity: "warning",
        objectIds: [it.id],
        text: `${it.label}: ${reason} («${z.name}»)`,
      });
    }
  });
  return warnings;
}
