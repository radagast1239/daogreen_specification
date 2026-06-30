import { snap, LINK_RULES, LAYERS, migrateLayerId } from "./catalog.js";
import {
  findWallIntersections, itemInAnyZone, nearestWallSegment,
  findWallOverlaps, findWallsOverItems,
} from "./wallGeometry.js";
import { resolvePlanWalls } from "./wallNetwork.js";
import { orthogonalPoint, constrainedOrthoPoint } from "./core/geometry/index.js";
import { itemHasLinkOfType } from "./linkGeometry.js";
import { collectLinkWarnings } from "./linkRules.js";
import { collectFarmWarnings } from "./farmRules.js";
import { collectRoomPurposeWarnings } from "./roomZones.js";
import { collectRackWarnings } from "./rackProperties.js";
import { collectLineWarnings } from "./lineProperties.js";
import { collectPipeWarnings } from "./pipes.js";
import { collectElectricalWarnings } from "./electrical.js";
import { collectClimateWarnings } from "./climate.js";
import { collectLabelWarnings } from "./labelProperties.js";
import { findServiceZoneCollisions } from "./objectProperties.js";
import { isDoorKind, isWallOpeningKind, doorStyle } from "./doorTypes.js";
import { doorSwingCollisions } from "./doorGeometry.js";

export { orthogonalPoint, constrainedOrthoPoint };

const BASE_LAYERS = new Set(["room", "zones", "partitions"]);
const COMPOSITE_LAYERS = new Set(["client", "install"]);
const LINE_LAYER_IDS = ["drain", "irrigation", "supply", "power", "vent", "climate", "ac", "light", "staff"];
const ITEM_LAYER_IDS = LAYERS.map((l) => l.id).filter(
  (id) => !["room", "zones", "partitions", "client", "install", "spec"].includes(id),
);
const CLIENT_HIDDEN = new Set([
  "drain", "irrigation", "supply", "power", "vent", "climate", "ac", "light", "staff", "sockets", "spec", "furn",
]);
const ENGINEERING_SHEET_IDS = new Set([
  "irrigation", "drainage", "water_treatment", "electrical", "lighting", "climate", "ventilation", "plumbing",
  // legacy sheet ids
  "water", "drain", "wiring", "panel", "light", "vent", "sanitary", "sockets",
]);

/**
 * Видимость слоя (0 = скрыт, 1 = рисуется). Приглушение неактивных — через isLayerMuted + PlanLayerGroup.
 */
export function layerOpacity(layerId, activeId, visible, display = {}, sheet = null) {
  if (!visible) return 0;
  const { hideInactive = false } = display;
  const sheetActive = sheet?.activeLayer || activeId;

  if (layerId === "room" || layerId === "partitions") return 1;

  if (sheet?.hiddenLayers?.includes(layerId)) return 0;

  if (activeId === "client") {
    if (CLIENT_HIDDEN.has(layerId)) return 0;
    if (layerId === "zones") return 1;
    if (layerId === "room") return 1;
    if (hideInactive && layerId !== sheetActive) return 0;
    return 1;
  }

  if (activeId === "install") {
    if (layerId === "spec") return 0;
    return 1;
  }

  if (activeId === "spec") {
    if (BASE_LAYERS.has(layerId)) return 1;
    return hideInactive ? 0 : 1;
  }

  if (hideInactive && !BASE_LAYERS.has(layerId) && layerId !== "zones"
    && layerId !== sheetActive && layerId !== activeId) {
    return 0;
  }

  return 1;
}

/** Неактивный слой — светло-серый (контекст room/partitions и зоны на листе «Исходный план» остаются яркими). */
export function isLayerMuted(layerId, activeId, display = {}, sheet = null) {
  if (display.dimInactive === false) return false;
  if (display.hideInactive) return false;

  const sheetActive = sheet?.activeLayer || activeId;
  const isEngineeringSheet = ENGINEERING_SHEET_IDS.has(sheet?.id || "");

  if (layerId === "room" || layerId === "partitions") {
    if (isEngineeringSheet && layerId !== sheetActive && layerId !== activeId) return true;
    return false;
  }
  if (layerId === sheetActive || layerId === activeId) return false;

  if (layerId === "zones") {
    if (activeId === "room" || activeId === "partitions" || sheetActive === "room" || sheetActive === "partitions") {
      return false;
    }
  }

  if (activeId === "client") return false;
  if (activeId === "spec" && BASE_LAYERS.has(layerId)) return true;

  return true;
}

export { labelsVisible } from "./labelProperties.js";

export function wallsForLayer(walls, activeId) {
  if (activeId === "partitions") return walls.filter((w) => w.role !== "outer");
  if (activeId === "room") return walls.filter((w) => w.role === "outer");
  return walls;
}

/** Границы содержимого активного листа для «Вместить слой». */
export function boundsForActiveLayer(plan, activeId) {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  let has = false;

  const add = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    has = true;
    x1 = Math.min(x1, x);
    y1 = Math.min(y1, y);
    x2 = Math.max(x2, x);
    y2 = Math.max(y2, y);
  };
  const addRect = (x, y, w, h) => {
    add(x, y);
    add(x + w, y + h);
  };

  const includeWalls = ["room", "partitions", "zones", "client", "install"].includes(activeId)
    || ITEM_LAYER_IDS.includes(activeId)
    || LINE_LAYER_IDS.includes(activeId);

  if (includeWalls) {
    wallsForLayer(resolvePlanWalls(plan), activeId).forEach((w) => {
      (w.pts || []).forEach((p) => add(p.x, p.y));
    });
  }

  if (activeId === "zones" || activeId === "client") {
    (plan.zones || []).forEach((z) => addRect(z.x, z.y, z.w, z.h));
  }

  (plan.lines || []).forEach((l) => {
    const lid = migrateLayerId(l.layer);
    const onLayer = lid === activeId;
    const onInstall = activeId === "install" && !CLIENT_HIDDEN.has(lid);
    if (onLayer || onInstall) (l.pts || []).forEach((p) => add(p.x, p.y));
  });

  (plan.items || []).forEach((it) => {
    const lid = migrateLayerId(it.layer);
    let vis = false;
    if (ITEM_LAYER_IDS.includes(activeId)) vis = lid === activeId;
    else if (activeId === "client") vis = !CLIENT_HIDDEN.has(lid);
    else if (activeId === "install") vis = lid !== "spec";
    if (vis) addRect(it.x, it.y, it.w, it.h);
  });

  if (!has) return null;
  const pad = 500;
  return { x: x1 - pad, y: y1 - pad, w: x2 - x1 + pad * 2, h: y2 - y1 + pad * 2 };
}

/** Простые предупреждения для панели «Ошибки». */
export function collectPlannerWarnings(plan, sel = null, display = {}) {
  const warnings = [];
  const racks = plan.items.filter((i) => i.layer === "racks");
  const minPass = 600;
  const zones = plan.zones || [];
  const walls = resolvePlanWalls(plan);

  findWallIntersections(walls).forEach((h) => {
    warnings.push({
      id: h.id,
      severity: "critical",
      wallIds: h.wallIds,
      objectIds: [],
      text: "Перегородки пересекаются — проверьте стыковку стен",
    });
  });

  findWallOverlaps(walls).forEach((h) => {
    warnings.push({
      id: h.id,
      severity: "critical",
      wallIds: h.wallIds,
      objectIds: [],
      text: "Стены наложены друг на друга",
    });
  });

  findWallsOverItems(walls, plan.items || []).forEach((h) => {
    warnings.push({
      id: h.id,
      severity: "warning",
      wallIds: h.wallIds,
      objectIds: h.objectIds,
      text: "Стена проходит поверх оборудования",
    });
  });

  const partitionWalls = walls.filter((w) => w.role !== "outer");
  if (partitionWalls.length >= 2 && zones.length === 0) {
    warnings.push({
      id: "no-rooms",
      severity: "warning",
      objectIds: [],
      text: "Нет замкнутых помещений — замкните контур перегородок",
    });
  }

  plan.items.forEach((it) => {
    if (!isDoorKind(it.kind)) return;
    const hits = doorSwingCollisions(it, plan.items);
    hits.forEach((obj) => {
      warnings.push({
        id: `door-swing-${it.id}-${obj.id}`,
        severity: "warning",
        objectIds: [it.id, obj.id],
        text: `${it.doorNum || it.label}: открывание пересекает «${obj.label}»`,
      });
    });
  });

  plan.items.forEach((it) => {
    if (!it.wall && !isDoorKind(it.kind) && !isWallOpeningKind(it.kind)) return;
    const cx = it.x + it.w / 2;
    const cy = it.y + it.h / 2;
    const maxDist = isDoorKind(it.kind) || isWallOpeningKind(it.kind) ? 160 : 180;
    const seg = nearestWallSegment({ x: cx, y: cy }, walls, plan.room, maxDist);
    if (!seg) {
      warnings.push({ id: `nowall-${it.id}`, objectIds: [it.id], text: `${it.label}: не на стене` });
    }
  });

  if (zones.length > 0) {
    plan.items.forEach((it) => {
      if (it.wall || isDoorKind(it.kind) || isWallOpeningKind(it.kind)) return;
      if (it.layer === "room") return;
      if (!itemInAnyZone(it, zones)) {
        warnings.push({ id: `outside-${it.id}`, objectIds: [it.id], text: `${it.label}: вне помещения` });
      }
    });
  }

  for (let i = 0; i < racks.length; i++) {
    for (let j = i + 1; j < racks.length; j++) {
      const a = racks[i];
      const b = racks[j];
      const gapX = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
      const gapY = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
      if (gapX > 0 && gapY > 0) continue;
      const pass = Math.max(gapX, gapY);
      if (pass > 0 && pass < minPass) {
        warnings.push({
          id: `pass-${a.id}-${b.id}`,
          objectIds: [a.id, b.id],
          text: `Недостаточный проход: ${Math.round(pass)} мм (нужно ≥ ${minPass})`,
        });
      }
    }
  }

  const supplyTanks = plan.items.filter((i) => i.kind === "tank");
  const links = plan.links || [];
  const hasPanel = plan.items.some((i) => i.kind === "panel");

  if (hasPanel) {
    plan.items.filter((i) => i.kind === "socket" || i.kind === "light_panel").forEach((s) => {
      if (!itemHasLinkOfType(links, s.id, "power", "from")) {
        warnings.push({
          id: `link-pwr-${s.id}`,
          objectIds: [s.id],
          text: `${s.label}: не подключён к щиту`,
        });
      }
    });
  }

  racks.forEach((r) => {
    const nearTank = supplyTanks.some((t) => {
      const cx = t.x + t.w / 2;
      const cy = t.y + t.h / 2;
      return cx >= r.x - 2000 && cx <= r.x + r.w + 2000 && cy >= r.y - 2000 && cy <= r.y + r.h + 2000;
    });
    if (!nearTank && racks.length > 2) {
      warnings.push({
        id: `tank-${r.id}`,
        objectIds: [r.id],
        text: "Нет бака раствора рядом с зоной стеллажей",
      });
    }
  });

  if (sel?.coll === "items") {
    const it = plan.items.find((o) => o.id === sel.id);
    if (it) {
      const overlapsWall = walls.some((w) => wallHitsItem(w, it));
      if (overlapsWall) {
        warnings.push({ id: `wall-${it.id}`, objectIds: [it.id], text: "Объект пересекает перегородку" });
      }
    }
  }

  findServiceZoneCollisions(plan).forEach((w) => {
    warnings.push({ ...w, severity: "warning" });
  });

  warnings.push(...collectRoomPurposeWarnings(plan));
  warnings.push(...collectRackWarnings(plan));
  warnings.push(...collectLineWarnings(plan));
  warnings.push(...collectPipeWarnings(plan));
  warnings.push(...collectElectricalWarnings(plan));
  warnings.push(...collectClimateWarnings(plan));
  warnings.push(...collectLinkWarnings(plan));
  warnings.push(...collectLabelWarnings(plan, display));
  warnings.push(...collectFarmWarnings(plan));
  warnings.push(...((plan.validationWarnings || []).map((w) => ({
    id: w.id,
    severity: w.severity || (w.level === "error" ? "critical" : "warning"),
    objectIds: w.objectIds || [],
    wallIds: w.wallIds || [],
    text: w.text || w.message || "",
    source: w.source,
    targetType: w.targetType,
    targetId: w.targetId,
  }))));

  return warnings;
}

function wallHitsItem(wall, it) {
  if (!wall?.pts || wall.pts.length < 2) return false;
  for (let i = 1; i < wall.pts.length; i++) {
    const a = wall.pts[i - 1];
    const b = wall.pts[i];
    if (segRectHit(a, b, it, wall.thk / 2)) return true;
  }
  return false;
}

function segRectHit(a, b, it, pad) {
  const rx1 = it.x - pad;
  const ry1 = it.y - pad;
  const rx2 = it.x + it.w + pad;
  const ry2 = it.y + it.h + pad;
  return lineIntersectsRect(a, b, rx1, ry1, rx2, ry2);
}

function lineIntersectsRect(a, b, rx1, ry1, rx2, ry2) {
  if (pointInRect(a, rx1, ry1, rx2, ry2) || pointInRect(b, rx1, ry1, rx2, ry2)) return true;
  const edges = [
    [{ x: rx1, y: ry1 }, { x: rx2, y: ry1 }],
    [{ x: rx2, y: ry1 }, { x: rx2, y: ry2 }],
    [{ x: rx2, y: ry2 }, { x: rx1, y: ry2 }],
    [{ x: rx1, y: ry2 }, { x: rx1, y: ry1 }],
  ];
  return edges.some(([p1, p2]) => segmentsIntersect(a, b, p1, p2));
}

function pointInRect(p, x1, y1, x2, y2) {
  return p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2;
}

function segmentsIntersect(a, b, c, d) {
  const det = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
  if (Math.abs(det) < 1e-9) return false;
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / det;
  const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / det;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
