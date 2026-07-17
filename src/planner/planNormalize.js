/**
 * Нормализация и миграция сохранённых планов (ТЗ §16).
 * plan.rooms — каноничные авто-помещения; plan.zones — совместимый runtime-слой.
 */
import { DEFAULT_PLAN, migrateLayerId } from "./catalog.js";
import { defaultObjectSpecSettings } from "./specSync.js";
import { planHasDrawnWalls } from "./wallGeometry.js";
import { ensureWallNetwork, mergeCloseNodes, resolvePlanWalls } from "./wallNetwork.js";
import { upgradeLegacyWall } from "./core/walls/wallModel.js";
import { normalizeDimensions } from "./core/dimensions/model.js";
import { normalizeLegacyRoomsFromZones, syncRoomsSafe } from "./core/rooms/index.js";
import { normalizePlannerObject } from "./farmObjects.js";
import { isPipeLine, normalizePipe, syncPlanPipes } from "./pipes.js";
import { syncElectricalPlan } from "./electrical.js";
import { syncClimatePlan } from "./climate.js";
import { DEFAULT_DUCT_SIZE_H_MM, DEFAULT_DUCT_SIZE_W_MM } from "./ventDuctRender.jsx";
import { uid } from "../store/helpers.js";

export function stripManualZones(zones = []) {
  return zones.filter((z) => z.auto);
}

// PHASE 0G: options.roomSyncFn — точка инъекции для controlled-failure тестов
// room detection (см. syncRoomsSafe). Production-код всегда вызывает с одним
// аргументом; параметр не меняет схему plan.
export function normalizePlan(raw, options = {}) {
  const d = DEFAULT_PLAN();
  if (!raw) return d;

  const plan = {
    ...d,
    ...raw,
    climateSettings: { ...(d.climateSettings || {}), ...(raw.climateSettings || {}) },
    room: { ...d.room, showBoundary: false, ...raw.room },
    zones: stripManualZones(raw.zones),
    rooms: normalizeLegacyRoomsFromZones(raw.rooms || raw.zones, raw.room?.defaultRoomHeightMm || raw.room?.height || 3000),
    labels: raw.labels || [],
    walls: (raw.walls || []).map((w) => upgradeLegacyWall({
      role: "partition",
      kind: "new",
      thicknessSide: "center",
      height: raw.room?.height || 3000,
      material: "",
      ...w,
    })),
    lines: (raw.lines || []).map((l) => {
      const layer = migrateLayerId(l.layer, null);
      const vent = layer === "vent";
      const line = {
        ...l,
        layer,
        ...(vent && !l.strokeStyle ? { strokeStyle: "duct" } : {}),
        ...(vent && l.ductSizeWmm == null ? { ductSizeWmm: DEFAULT_DUCT_SIZE_W_MM } : {}),
        ...(vent && l.ductSizeHmm == null ? { ductSizeHmm: DEFAULT_DUCT_SIZE_H_MM } : {}),
        ...(vent && l.showArrows === undefined ? { showArrows: false } : {}),
      };
      if (isPipeLine(line) || layer === "irrigation" || layer === "drain") {
        return normalizePipe(line);
      }
      return line;
    }),
    links: (raw.links || []).map((l) => ({ ortho: true, riseMm: null, ...l })),
    measurements: (raw.measurements || []).map((m) => ({
      id: m.id,
      a: { ...m.a },
      b: { ...m.b },
    })),
    rulers: (raw.rulers || raw.measurements || []).map((m) => ({
      id: m.id,
      a: { ...m.a },
      b: { ...m.b },
    })),
    dimensions: normalizeDimensions(
      raw.dimensions || (raw.rulers || raw.measurements || []).map((m) => ({
        id: m.id || uid("dim"),
        type: "dimension",
        mode: "linear",
        p1: { ...m.a },
        p2: { ...m.b },
        offset: 0,
        orientation: Math.abs((m.b?.x || 0) - (m.a?.x || 0)) >= Math.abs((m.b?.y || 0) - (m.a?.y || 0)) ? "horizontal" : "vertical",
        attachedTo: null,
        labelOverride: null,
        locked: false,
      })),
    ),
    validationWarnings: (raw.validationWarnings || []).map((w) => ({ ...w })),
    structurals: (raw.structurals || []).map((s) => ({ ...s })),
    farmObjectGroups: (raw.farmObjectGroups || []).map((g) => ({ ...g })),
    items: (raw.items || []).map((i) => {
      const base = { angle: 0, ...defaultObjectSpecSettings(i.kind), ...i };
      const layer = migrateLayerId(base.layer, base.kind);
      const normalized = base.kind === "socket" && layer === "power"
        ? { ...base, layer: "sockets" }
        : { ...base, layer };
      return normalizePlannerObject(normalized);
    }),
  };

  const hasDrawnWalls = planHasDrawnWalls(plan.walls);
  if (hasDrawnWalls) {
    const resolved = resolvePlanWalls(plan);
    const synced = options.roomSyncFn
      ? syncRoomsSafe({ ...plan, walls: resolved }, options.roomSyncFn)
      : syncRoomsSafe({ ...plan, walls: resolved });
    // PHASE 0G: на ok:false (сбой room-engine, не «нет комнат») сохраняем уже
    // вычисленные выше legacy rooms/zones как есть — без auto-fix и без записи
    // runtime diagnostic внутрь plan (diagnostics session-only, живут в UI).
    if (synced.ok) {
      plan.rooms = synced.rooms;
      plan.zones = synced.zones;
      plan.validationWarnings = [
        ...(plan.validationWarnings || []).filter((w) => w.source !== "rooms"),
        ...(synced.validationWarnings || []),
      ];
    }
  } else {
    plan.zones = [];
    plan.rooms = [];
  }

  const networked = mergeCloseNodes(ensureWallNetwork(plan, (p) => uid(p)));
  plan.nodes = networked.nodes;
  plan.walls = networked.walls;

  return syncClimatePlan(syncElectricalPlan(syncPlanPipes(plan)));
}
