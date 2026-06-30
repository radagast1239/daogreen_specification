import { dist, pointInPolygon, polygonBounds, projectOnSegment } from "../walls/wallOps.js";
import { isDoorKind } from "../../doorTypes.js";

const WET_CATEGORIES = new Set(["water_treatment", "irrigation_room", "shower", "toilet", "sanitary_lock"]);
const PRODUCTION_CATEGORIES = new Set(["production_main", "production_seedling", "microgreens", "nursery"]);

function warning(id, level, targetType, targetId, message) {
  return {
    id,
    level,
    targetType,
    targetId,
    message,
    source: "rooms",
  };
}

function centroid(poly) {
  if (!poly?.length) return { x: 0, y: 0 };
  const s = poly.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: s.x / poly.length, y: s.y / poly.length };
}

function overlapBBox(a, b) {
  const ba = polygonBounds(a?.polygon || []);
  const bb = polygonBounds(b?.polygon || []);
  if (!ba || !bb) return 0;
  const ix = Math.max(0, Math.min(ba.x + ba.w, bb.x + bb.w) - Math.max(ba.x, bb.x));
  const iy = Math.max(0, Math.min(ba.y + ba.h, bb.y + bb.h) - Math.max(ba.y, bb.y));
  const intersection = ix * iy;
  const union = ba.w * ba.h + bb.w * bb.h - intersection;
  return union > 0 ? intersection / union : 0;
}

function pointToPolygonDistance(p, poly) {
  if (!poly?.length) return Infinity;
  if (pointInPolygon(p, poly)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const proj = projectOnSegment(p, a, b);
    best = Math.min(best, dist(p, proj));
  }
  return best;
}

function roomDoors(plan, room) {
  const items = plan?.items || [];
  return items.filter((it) => {
    if (!isDoorKind(it.kind)) return false;
    const c = { x: it.x + it.w / 2, y: it.y + it.h / 2 };
    return pointToPolygonDistance(c, room.polygon || []) <= 450;
  });
}

function corridorMinWidth(room) {
  const b = polygonBounds(room?.polygon || []);
  if (!b) return 0;
  return Math.min(b.w, b.h);
}

export function validateRooms(plan, rooms = []) {
  const out = [];
  const byCategory = new Map();
  rooms.forEach((room) => {
    const cat = room.category || "other";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(room);
  });

  const electrical = byCategory.get("electrical_room") || [];
  const wet = rooms.filter((r) => WET_CATEGORIES.has(r.category));
  electrical.forEach((er) => {
    const insideWet = wet.some((wr) => wr.id !== er.id && overlapBBox(er, wr) > 0.2);
    if (insideWet) {
      out.push(warning(`elec-wet-${er.id}`, "error", "room", er.id, "Electrical room не должен пересекаться с wet zone"));
    }
  });

  (byCategory.get("cold_room") || []).forEach((cr) => {
    if (!roomDoors(plan, cr).length) {
      out.push(warning(`cold-door-${cr.id}`, "warning", "room", cr.id, "Cold room должна иметь дверь"));
    }
  });

  const nearTargets = [
    ...(byCategory.get("irrigation_room") || []),
    ...(byCategory.get("production_main") || []),
    ...(byCategory.get("production_seedling") || []),
    ...(byCategory.get("microgreens") || []),
    ...(byCategory.get("nursery") || []),
  ];
  (byCategory.get("water_treatment") || []).forEach((wr) => {
    const c = centroid(wr.polygon);
    const nearest = nearTargets.reduce((best, t) => {
      const d = dist(c, centroid(t.polygon));
      return d < best ? d : best;
    }, Infinity);
    if (!Number.isFinite(nearest) || nearest > 5000) {
      out.push(warning(`water-far-${wr.id}`, "warning", "room", wr.id, "Water treatment желательно размещать рядом с irrigation/production"));
    }
  });

  const productionMain = byCategory.get("production_main") || [];
  const sanitaryRooms = [
    ...(byCategory.get("toilet") || []),
    ...(byCategory.get("shower") || []),
  ];
  sanitaryRooms.forEach((sr) => {
    const doors = roomDoors(plan, sr);
    const direct = doors.some((d) => {
      const p = { x: d.x + d.w / 2, y: d.y + d.h / 2 };
      return productionMain.some((pr) => pointToPolygonDistance(p, pr.polygon) <= 220);
    });
    if (direct) {
      out.push(warning(`san-prod-door-${sr.id}`, "warning", "room", sr.id, "Toilet/Shower не должен напрямую открываться в production_main"));
    }
  });

  const cleanStorage = byCategory.get("storage_clean") || [];
  (byCategory.get("waste") || []).forEach((wr) => {
    const cross = cleanStorage.some((cs) => overlapBBox(wr, cs) > 0.1);
    if (cross) {
      out.push(warning(`waste-clean-${wr.id}`, "error", "room", wr.id, "Waste зона не должна пересекаться с clean storage"));
    }
  });

  (byCategory.get("corridor") || []).forEach((cr) => {
    const width = corridorMinWidth(cr);
    if (width > 0 && width < 900) {
      out.push(warning(`corridor-width-${cr.id}`, "warning", "room", cr.id, `Corridor проход ${Math.round(width)} мм меньше 900 мм`));
    }
  });

  productionMain.forEach((pr) => {
    if (!roomDoors(plan, pr).length) {
      out.push(warning(`prod-entry-${pr.id}`, "warning", "room", pr.id, "Production_main должен иметь хотя бы один вход"));
    }
  });

  return out;
}

export function roomValidationToPlannerWarnings(validationWarnings = []) {
  return (validationWarnings || []).map((w) => ({
    id: w.id,
    severity: w.level === "error" ? "critical" : "warning",
    objectIds: w.targetType === "room" ? [w.targetId] : [],
    text: w.message,
    source: w.source || "rooms",
  }));
}
