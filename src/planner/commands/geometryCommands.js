/**
 * PHASE 1A (+ corrective pass) — единая command boundary для production-
 * мутаций wall/node geometry.
 *
 * Чистый orchestration-слой поверх существующих low-level mutator'ов
 * (wallNetwork.js, core/walls/wallOps.js) и safe room-sync pipeline
 * (PHASE 0G, syncRoomsSafe). Повторяет РЕАЛЬНУЮ production-семантику
 * PlanPage.jsx (mounted-item refresh scope, dimension self-healing через
 * read-time resolver) — не изобретает новую, см. таблицу в RESULT —
 * PHASE 1A-1 CORRECTIVE PASS, «Production post-processing audit».
 *
 * Гарантии:
 *   • не импортирует React/DOM/window/PlanPage/backend;
 *   • не вызывает setPlan — только вычисляет result-контракт, caller (UI
 *     dispatcher) решает, что делать с ним дальше;
 *   • не знает про autosave;
 *   • rejected/no-op возвращают исходный plan по той же ссылке;
 *   • не мутирует вход;
 *   • result детерминирован при одинаковом context;
 *   • ID generation передаётся через context.makeId (injectable для тестов);
 *   • raw Error/stack не попадают в result — только structured error;
 *   • неизвестная команда не бросает исключение наружу.
 *
 * Leaf imports только: wallNetwork.js, core/walls/wallOps.js,
 * core/dimensions/model.js (dependency-free), core/rooms/syncRooms.js,
 * и (PHASE 1A-2C2D3B, item.bulkDelete) climate.js/electrical.js/pipes.js —
 * НЕ core/rooms/index.js и НЕ wallGeometry.js (broad barrels, см. PHASE 0G
 * import-order fragility). Этот модуль не входит в известный 15-файловый
 * SCC — он лишь ЗАВИСИТ от его членов (wallNetwork.js, wallOps.js уже в
 * цикле), но ничто из цикла не импортирует обратно этот модуль, поэтому
 * новой strongly-connected компоненты не образуется.
 */
import {
  resolvePlanWalls,
  pruneOrphanNodes,
  applyNetworkWallSegMove,
  applyNetworkNodeAtWall,
  nudgeWallInPlan,
  tryMergeWallEdge,
  breakWallEdgeAt,
  straightenWallEdge,
  alignWallEdgeToNeighbor,
} from "../wallNetwork.js";
import { commitWallChain } from "../core/walls/wallCommit.js";
import { refreshWallMountedItems } from "../core/walls/wallOps.js";
import { resolveAttachedDimension } from "../core/dimensions/model.js";
import { syncRoomsSafe } from "../core/rooms/syncRooms.js";
// PHASE 1A-2C2D3B — same 3 authoritative pure engineering-derived-sync
// functions PlanPage.jsx's own syncEngineeringPlan composes (climate/
// electrical/pipe recompute over items/lines); not a duplicated algorithm,
// just the same exported functions recomposed here so item.bulkDelete can
// run the identical production post-processing exactly once.
import { syncClimatePlan } from "../climate.js";
import { syncElectricalPlan } from "../electrical.js";
import { syncPlanPipes } from "../pipes.js";

export const GEOMETRY_COMMAND_UNKNOWN = "GEOMETRY_COMMAND_UNKNOWN";
export const GEOMETRY_COMMAND_INVALID = "GEOMETRY_COMMAND_INVALID";
export const GEOMETRY_COMMAND_FAILED = "GEOMETRY_COMMAND_FAILED";
export const GEOMETRY_COMMAND_NO_TARGET = "GEOMETRY_COMMAND_NO_TARGET";
export const DIMENSION_DETACHED_AFTER_WALL_REMOVED = "DIMENSION_DETACHED_AFTER_WALL_REMOVED";
export const DIMENSION_DETACHED_AFTER_ITEM_REMOVED = "DIMENSION_DETACHED_AFTER_ITEM_REMOVED";

// PHASE 1B-1A — wall.setLength-specific structured error codes (не переиспользуют
// generic GEOMETRY_COMMAND_INVALID/NO_TARGET — вызывающий код должен различать
// "неверная длина" от "неверный anchor" от "стена не найдена" без парсинга message).
export const WALL_SET_LENGTH_WALL_NOT_FOUND = "WALL_SET_LENGTH_WALL_NOT_FOUND";
export const WALL_SET_LENGTH_INVALID_LENGTH = "WALL_SET_LENGTH_INVALID_LENGTH";
export const WALL_SET_LENGTH_INVALID_ANCHOR = "WALL_SET_LENGTH_INVALID_ANCHOR";
export const WALL_SET_LENGTH_DEGENERATE_WALL = "WALL_SET_LENGTH_DEGENERATE_WALL";

// ── result helpers ──────────────────────────────────────────────────────

function dedupe(ids) {
  return [...new Set(ids.filter((id) => id != null))];
}

// PHASE 1A-2C2B corrective — "links" добавлен минимально и последовательно:
// emptyEntityChanges/normalizeEntityChanges/flattenEntityChanges все
// итерируют по этому списку, так что добавление одного элемента здесь даёт
// links полноценный typed-contract bucket (created/changed/deleted) без
// отдельного shape.
// PHASE 1A-2C2D3E2 — "lines" добавлен тем же способом для line.bulkDelete:
// normalizeEntityChanges/flattenEntityChanges выводят пустой lines:[] bucket
// для ЛЮБОЙ команды (не только line.bulkDelete) через generic iteration
// ниже — существующие wall.bulkDelete/item.bulkDelete consumers должны
// допускать этот новый пустой bucket (см. обновлённые exhaustive
// entityChanges.created-проверки в тестах).
const ENTITY_KINDS = ["walls", "nodes", "items", "dimensions", "links", "lines"];

/**
 * PHASE 1A-2C2D3E2 REQUIRED FIX F-01 — fresh per-call bucket derived from
 * ENTITY_KINDS (single source of truth), not a hand-maintained literal that
 * can silently fall behind when a new kind is added. Each call returns a
 * brand-new object with brand-new arrays — no bucket/array reference is ever
 * shared between created/changed/deleted, nor between separate
 * emptyEntityChanges() calls (see fresh-reference regression tests).
 */
function emptyEntityBucket() {
  return Object.fromEntries(ENTITY_KINDS.map((kind) => [kind, []]));
}

/**
 * PHASE 1A-2A P2 — typed entity-change contract. Additive: старый flat
 * createdEntityIds/changedEntityIds/deletedEntityIds сохраняется, но теперь
 * ВЫВОДИТСЯ из typed contract (единственный источник правды — не может
 * разойтись с ним). entityType сообщает caller'у (UI selection/diagnostics),
 * какого рода сущность изменилась, не заставляя угадывать по префиксу id.
 */
function emptyEntityChanges() {
  return {
    created: emptyEntityBucket(),
    changed: emptyEntityBucket(),
    deleted: emptyEntityBucket(),
  };
}

function normalizeEntityChanges(patch = {}) {
  const out = emptyEntityChanges();
  for (const bucket of ["created", "changed", "deleted"]) {
    for (const kind of ENTITY_KINDS) {
      out[bucket][kind] = dedupe(patch?.[bucket]?.[kind] || []);
    }
  }
  return out;
}

function flattenEntityChanges(entityChanges) {
  const flat = { created: [], changed: [], deleted: [] };
  for (const bucket of ["created", "changed", "deleted"]) {
    flat[bucket] = dedupe(ENTITY_KINDS.flatMap((kind) => entityChanges[bucket][kind]));
  }
  return flat;
}

function baseResult(commandType, plan) {
  const entityChanges = emptyEntityChanges();
  const flat = flattenEntityChanges(entityChanges);
  return {
    ok: true,
    changed: false,
    commandType,
    plan,
    entityRemap: {},
    entityChanges,
    createdEntityIds: flat.created,
    changedEntityIds: flat.changed,
    deletedEntityIds: flat.deleted,
    diagnostics: [],
    warnings: [],
    error: null,
    // operation-specific поля (напр. wall.split: splitT/childWallIds) —
    // держим контракт единообразным для всех command types, см. секцию 10
    // corrective pass.
    operationResult: null,
  };
}

function rejected(commandType, plan, code, message, extra = {}) {
  return {
    ...baseResult(commandType, plan),
    ok: false,
    error: { code, message, ...extra },
  };
}

function noop(commandType, plan) {
  return baseResult(commandType, plan); // ok:true, changed:false, plan по той же ссылке
}

/**
 * @param {object} patch — может содержать entityChanges (typed, предпочтительно)
 *   и/или operation-specific поля (warnings, entityRemap, operationResult).
 *   Flat createdEntityIds/changedEntityIds/deletedEntityIds в patch
 *   ИГНОРИРУЮТСЯ — они всегда выводятся из entityChanges, чтобы не рассинхронизироваться.
 */
function changedOk(commandType, plan, patch = {}) {
  const { entityChanges: rawEntityChanges, createdEntityIds, changedEntityIds, deletedEntityIds, ...rest } = patch;
  const entityChanges = normalizeEntityChanges(rawEntityChanges);
  const flat = flattenEntityChanges(entityChanges);
  return {
    ...baseResult(commandType, plan),
    changed: true,
    ...rest,
    entityChanges,
    createdEntityIds: flat.created,
    changedEntityIds: flat.changed,
    deletedEntityIds: flat.deleted,
  };
}

// ── finite coordinate guards (section 8) ──────────────────────────────────

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function isFinitePoint(p) {
  return p != null && typeof p === "object" && isFiniteNumber(p.x) && isFiniteNumber(p.y);
}

// ── node/entity diff helpers (section 6) ──────────────────────────────────

/** ID узлов, чьи координаты действительно отличаются между двумя nodes-объектами. */
function diffNodeIds(before, after) {
  const ids = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const out = [];
  for (const id of ids) {
    const a = before?.[id];
    const b = after?.[id];
    if (!a || !b || a.x !== b.x || a.y !== b.y) out.push(id);
  }
  return out;
}

function nodesEqual(a, b) {
  return diffNodeIds(a, b).length === 0;
}

/** ID стен, ссылающихся хотя бы на один из данных узлов (a или b). */
function wallsUsingNodes(walls, nodeIds) {
  const set = new Set(nodeIds);
  return (walls || []).filter((w) => set.has(w.a) || set.has(w.b)).map((w) => w.id);
}

/** ID объектов (двери/окна), у которых wallId/wallSeg/x/y/angle реально изменились. */
function diffChangedItemIds(before, after) {
  const beforeById = new Map((before || []).map((it) => [it.id, it]));
  const out = [];
  for (const it of after || []) {
    const prev = beforeById.get(it.id);
    if (!prev) continue;
    if (prev.wallId !== it.wallId || prev.x !== it.x || prev.y !== it.y || prev.angle !== it.angle) out.push(it.id);
  }
  return out;
}

// ── mounted-entity refresh (unified post-processing, section 2/5) ────────

/**
 * Production-семантика refreshWallMountedItems после coordinate-мутации:
 * scopeWallId=null → глобальный refresh ВСЕХ wall-mounted items (как
 * production для node.move/wall.merge — единственный узел/операция может
 * затронуть несколько стен через общий узел); конкретный wallId → refresh
 * только items этой стены (как production для straighten/align/moveSegment/
 * nudge — одна геометрически изменённая стена).
 *
 * Dimensions НЕ обрабатываются здесь: wall-attached размеры — read-time view
 * (resolveAttachedDimension пересчитывает p1/p2 из ЖИВОЙ геометрии стены по
 * attachedTo.wallId+t0/t1 на каждый resolve), а t0/t1 остаются валидными
 * параметрами, пока wallId не изменился — production НЕ делает для них
 * никакого explicit refresh на coordinate-only операциях (подтверждено
 * аудитом: ни один из этих call site в PlanPage.jsx не трогает dimensions).
 * НЕ применять к wall.split — split уже полностью и явно мигрировал
 * openings/dimensions внутри breakWallEdgeAt; повторный proximity-refresh
 * может дать другой (proximity-based, не geometry-exact) результат.
 */
function refreshMountedItemsForCoordinateChange(plan, scopeWallId) {
  const resolved = resolvePlanWalls(plan);
  return refreshWallMountedItems(plan.items || [], resolved, plan.room, scopeWallId ?? null);
}

// ── room sync integration (единожды, централизованно) ───────────────────

/**
 * Применяет existing safe room-sync pipeline ровно один раз после успешной
 * geometry mutation. На ok:false (сбой движка) geometry НЕ откатывается —
 * rooms/zones остаются как были в nextPlan (safe policy PHASE 0G), diagnostic
 * возвращается вызывающему коду, не пишется в plan.
 */
function applyRoomSync(nextPlan, context) {
  const withResolved = { ...nextPlan, walls: resolvePlanWalls(nextPlan) };
  const synced = context.roomSyncFn ? syncRoomsSafe(withResolved, context.roomSyncFn) : syncRoomsSafe(withResolved);
  if (!synced.ok) {
    return { plan: nextPlan, diagnostics: synced.diagnostics };
  }
  const dimWarnings = (nextPlan.validationWarnings || []).filter((w) => w.source === "dimensions");
  return {
    plan: {
      ...nextPlan,
      rooms: synced.rooms,
      zones: synced.zones,
      validationWarnings: [...dimWarnings, ...(synced.validationWarnings || [])],
    },
    diagnostics: [],
  };
}

// ── command handlers ─────────────────────────────────────────────────────
// handler(plan, command, context) → result БЕЗ room sync (room sync
// применяется централизованно в executeGeometryCommand после changed:true).

function handleWallSplit(plan, command, context) {
  const { wallId, point } = command;
  if (!wallId || !isFinitePoint(point)) {
    return rejected("wall.split", plan, GEOMETRY_COMMAND_INVALID, "wall.split требует wallId и конечную точку point");
  }
  const res = breakWallEdgeAt(plan, wallId, point, context.makeId);
  if (!res) return rejected("wall.split", plan, GEOMETRY_COMMAND_NO_TARGET, "Не удалось разорвать стену — кликните ближе к сегменту.");
  if (res.ok === false) {
    return rejected("wall.split", plan, res.error.code, res.error.message, {
      entityId: res.error.entityId,
      ...(res.error.wallId ? { wallId: res.error.wallId } : {}),
    });
  }
  // PHASE 1A-2A P2 §3: changed openings/dimensions приходят из РЕАЛЬНЫХ
  // entityRemap-записей breakWallEdgeAt (openings/dimensions), не угадываются
  // по геометрии. entityRemap.dimensions уже покрывает и reattached, и
  // detached-cross-split записи (см. wallNetwork.js remapWallDimension).
  return changedOk("wall.split", res.plan, {
    entityRemap: res.entityRemap,
    entityChanges: {
      created: { nodes: [res.splitNodeId], walls: [res.newWallId] },
      changed: {
        walls: [res.originalWallId],
        items: res.entityRemap.openings.map((r) => r.entityId),
        dimensions: res.entityRemap.dimensions.map((r) => r.entityId),
      },
    },
    warnings: res.warnings || [],
    operationResult: {
      originalWallId: res.originalWallId,
      splitNodeId: res.splitNodeId,
      splitT: res.splitT,
      childWallIds: res.childWallIds,
      sourceRange: res.sourceRange,
      targetRange: res.targetRange,
    },
  });
}

/**
 * PHASE 1A-2C2D2 — shared bulk-safe wall-deletion mutation. Used by both
 * wall.delete (single ID) and wall.bulkDelete (N IDs) — the single source of
 * this cleanup policy, not duplicated between them. Computes the FINAL
 * surviving wall/node set ONCE, before any mounted-item/link/dimension
 * cleanup runs — critical for bulk deletes, where an opening must resolve
 * directly against the final surviving walls and never "hop" through an
 * intermediate wall that is also being deleted in the same call (see
 * RESULT — PHASE 1A-2C2D2, "Order independence").
 *
 * @param {object} plan
 * @param {string[]} wallIds — may contain duplicates and/or IDs absent from
 *   plan.walls (both silently normalized away) — matches wall.delete's own
 *   "operate only on what actually exists" policy.
 * @returns {object|null} internal result, or null if none of wallIds exist.
 */
function deleteWallsFromPlan(plan, wallIds) {
  const existingWallIdSet = new Set((plan.walls || []).map((w) => w.id));
  const deletedWallIds = [...new Set(wallIds)].filter((id) => existingWallIdSet.has(id));
  if (deletedWallIds.length === 0) return null;
  const deletedWallIdSet = new Set(deletedWallIds);

  const beforeNodeIds = new Set(Object.keys(plan.nodes || {}));
  const remainingWalls = (plan.walls || []).filter((w) => !deletedWallIdSet.has(w.id));
  const nodes = pruneOrphanNodes(plan.nodes || {}, remainingWalls);
  const topologyPlan = { ...plan, walls: remainingWalls, nodes };
  const removedNodeIds = [...beforeNodeIds].filter((id) => !topologyPlan.nodes[id]);

  // Production-политика: single-wall delete keeps the exact prior scoped
  // refresh call (byte-for-byte unchanged). Bulk delete (>1 wall) must NOT
  // run a blanket global refresh: refreshWallMountedItems(..., null) has no
  // filter at all in that mode, so an UNRELATED item mounted on a surviving
  // wall would also go through placeOnWall's 400mm proximity search and
  // could re-snap onto a different nearby surviving wall — silently
  // changing wallId/x/y/angle without ever being reported in changed.items
  // (CORRECTIVE PASS F3). Only items whose ORIGINAL wallId is itself in the
  // delete set are recomputed, resolved against the final surviving wall set
  // (topologyPlan/resolvedWalls already exclude every deleted wall — same
  // order-independence guarantee as before); every other item is carried
  // over as the exact same reference, untouched.
  let refreshedItems;
  if (deletedWallIds.length === 1) {
    refreshedItems = refreshMountedItemsForCoordinateChange(topologyPlan, deletedWallIds[0]);
  } else {
    const resolvedWalls = resolvePlanWalls(topologyPlan);
    refreshedItems = (plan.items || []).map((it) => {
      if (!deletedWallIdSet.has(it.wallId)) return it;
      const [refreshed] = refreshWallMountedItems([it], resolvedWalls, topologyPlan.room, null);
      return refreshed;
    });
  }
  const danglingItemIds = [];
  const changedItemIds = [];
  const items = refreshedItems.filter((item, i) => {
    const original = plan.items[i];
    if (!original || !deletedWallIdSet.has(original.wallId)) return true; // этих стен не касалось
    if (deletedWallIdSet.has(item.wallId)) {
      // Стена(ы) удалена(ы), но переставить в радиусе 400мм не на что —
      // dangling wallId недопустим (см. corrective pass §3): удаляем сам
      // объект, а не оставляем повисшую ссылку.
      danglingItemIds.push(item.id);
      return false;
    }
    changedItemIds.push(item.id);
    return true;
  });

  // PHASE 1A-2C2B corrective F-02: links, ссылающиеся (fromId/toId) на
  // удалённый dangling item, теряют смысл вместе с ним — оставлять их значило
  // бы дать surviving link ссылаться на несуществующий объект
  // (ROUTE_ENDPOINT_REFERENCE_NOT_FOUND). Re-placed items не в этом списке —
  // их links продолжают резолвиться нормально и не трогаются.
  const danglingItemIdSet = new Set(danglingItemIds);
  const deletedLinkIds = [];
  const links = (plan.links || []).filter((l) => {
    if (danglingItemIdSet.has(l.fromId) || danglingItemIdSet.has(l.toId)) {
      deletedLinkIds.push(l.id);
      return false;
    }
    return true;
  });

  // Wall-attached MANUAL размеры на любой удаляемой стене — detach с
  // сохранением ЖИВОГО (resolveAttachedDimension), а не потенциально
  // устаревшего p1/p2.
  //
  // PHASE 1A-2C2B corrective F-01: persisted auto/derived размеры на любой
  // удаляемой стене — УДАЛЯЮТСЯ, а не detach-ятся и не оставляются как есть.
  // resolvePlanDimensions (core/dimensions/runtime.js) всегда явно
  // ИГНОРИРУЕТ persisted auto-записи для отображения (`.filter(d => d.auto
  // !== true)`) и генерирует auto-набор заново из живой геометрии — то есть
  // persisted auto-запись никогда не читается как authoritative уже сегодня.
  // Detach-ить в manual тоже неверно: это превратило бы машинно-
  // сгенерированную запись в фантомную пользовательскую. Убираем её из
  // plan.dimensions полностью.
  const dimensionWarnings = [];
  const changedDimensionIds = [];
  const deletedDimensionIds = [];
  const withResolvedForDims = { ...plan, walls: resolvePlanWalls(plan) };
  const dimensions = (plan.dimensions || []).flatMap((dim) => {
    const at = dim?.attachedTo;
    const attachedWallId = at?.wallId ?? at?.id;
    if (at?.type !== "wall" || !deletedWallIdSet.has(attachedWallId)) return [dim];
    if (dim.auto === true) {
      deletedDimensionIds.push(dim.id);
      return [];
    }
    const resolved = resolveAttachedDimension(dim, withResolvedForDims);
    changedDimensionIds.push(dim.id);
    dimensionWarnings.push({ code: DIMENSION_DETACHED_AFTER_WALL_REMOVED, entityId: dim.id, wallId: attachedWallId });
    return [{
      ...dim,
      p1: resolved.invalid ? dim.p1 : resolved.p1,
      p2: resolved.invalid ? dim.p2 : resolved.p2,
      attachedTo: null,
      kind: "manual",
      auto: false,
    }];
  });

  const nextPlan = { ...topologyPlan, items, dimensions, links };
  return {
    plan: nextPlan,
    deletedWallIds,
    removedNodeIds,
    danglingItemIds,
    changedItemIds,
    deletedLinkIds,
    deletedDimensionIds,
    changedDimensionIds,
    dimensionWarnings,
  };
}

function handleWallDelete(plan, command) {
  const { wallId } = command;
  if (!wallId) return rejected("wall.delete", plan, GEOMETRY_COMMAND_INVALID, "wall.delete требует wallId");
  if (!(plan.walls || []).some((w) => w.id === wallId)) {
    return rejected("wall.delete", plan, GEOMETRY_COMMAND_NO_TARGET, "Стена не найдена");
  }
  const result = deleteWallsFromPlan(plan, [wallId]);
  return changedOk("wall.delete", result.plan, {
    entityChanges: {
      deleted: {
        walls: result.deletedWallIds,
        nodes: result.removedNodeIds,
        items: result.danglingItemIds,
        dimensions: result.deletedDimensionIds,
        links: result.deletedLinkIds,
      },
      changed: { items: result.changedItemIds, dimensions: result.changedDimensionIds },
    },
    warnings: result.dimensionWarnings,
  });
}

/**
 * PHASE 1A-2C2D2 — atomic multi-wall delete. Payload carries only explicit
 * canonical wallIds — no UI layer/label/outer-wall policy is known here; the
 * caller (UI) is responsible for computing which wallIds to send (e.g. "every
 * non-outer wall" for a partitions-sheet clear).
 */
function handleWallBulkDelete(plan, command) {
  const { wallIds } = command;
  if (!Array.isArray(wallIds) || wallIds.length === 0) {
    return rejected("wall.bulkDelete", plan, GEOMETRY_COMMAND_INVALID, "wall.bulkDelete требует непустой массив wallIds");
  }
  const result = deleteWallsFromPlan(plan, wallIds);
  if (!result) {
    return rejected("wall.bulkDelete", plan, GEOMETRY_COMMAND_NO_TARGET, "Ни одна из указанных стен не найдена");
  }
  return changedOk("wall.bulkDelete", result.plan, {
    entityChanges: {
      deleted: {
        walls: result.deletedWallIds,
        nodes: result.removedNodeIds,
        items: result.danglingItemIds,
        dimensions: result.deletedDimensionIds,
        links: result.deletedLinkIds,
      },
      changed: { items: result.changedItemIds, dimensions: result.changedDimensionIds },
    },
    warnings: result.dimensionWarnings,
  });
}

function isFiniteConsecutivePoint(p) {
  return isFinitePoint(p);
}

// Численный guard для de-dup соседних точек (НЕ snap tolerance — просто
// схлопывает буквальные/почти-нулевые повторы, напр. двойной клик).
const POINT_DEDUPE_EPS_MM = 1e-6;

function dedupeConsecutivePoints(points) {
  const out = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) <= POINT_DEDUPE_EPS_MM) continue;
    out.push(p);
  }
  return out;
}

function handleWallCreate(plan, command, context) {
  const { points, wallProps = {}, closed = false } = command;
  if (!Array.isArray(points)) {
    return rejected("wall.create", plan, GEOMETRY_COMMAND_INVALID, "wall.create требует points: массив точек");
  }
  if (!points.every(isFiniteConsecutivePoint)) {
    return rejected("wall.create", plan, GEOMETRY_COMMAND_INVALID, "wall.create: точки должны быть конечными числами");
  }
  const deduped = dedupeConsecutivePoints(points);
  // < 2 точек (в т.ч. после dedup) — как и commitWallChain, честный no-op
  // (напр. один клик при рисовании стены), а не ошибка ввода.
  if (deduped.length < 2) return noop("wall.create", plan);

  const wallsBefore = new Set((plan.walls || []).map((w) => w.id));
  const nodesBefore = new Set(Object.keys(plan.nodes || {}));
  const nextPlan = commitWallChain(plan, deduped, wallProps, context.makeId, { closed });
  if (nextPlan === plan) return noop("wall.create", plan);
  const createdWallIds = (nextPlan.walls || []).map((w) => w.id).filter((id) => !wallsBefore.has(id));
  const createdNodeIds = Object.keys(nextPlan.nodes || {}).filter((id) => !nodesBefore.has(id));
  return changedOk("wall.create", nextPlan, {
    entityChanges: { created: { nodes: createdNodeIds, walls: createdWallIds } },
  });
}

function straightenMode(commandType) {
  if (commandType === "wall.straightenHorizontal") return "h";
  if (commandType === "wall.straightenVertical") return "v";
  return null;
}

function handleWallStraighten(plan, command, context, commandType) {
  const { wallId } = command;
  const mode = command.mode || straightenMode(commandType) || "h";
  if (!wallId) return rejected(commandType, plan, GEOMETRY_COMMAND_INVALID, "wall.straighten требует wallId");
  const rw = resolvePlanWalls(plan).find((w) => w.id === wallId);
  if (!rw) return rejected(commandType, plan, GEOMETRY_COMMAND_NO_TARGET, "Стена не найдена");
  const geomPlan = straightenWallEdge(plan, wallId, mode);
  const changedNodeIds = diffNodeIds(plan.nodes, geomPlan.nodes);
  if (changedNodeIds.length === 0) return noop(commandType, plan);

  const items = refreshMountedItemsForCoordinateChange(geomPlan, wallId);
  const changedItemIds = diffChangedItemIds(plan.items, items);
  const nextPlan = { ...geomPlan, items };
  return changedOk(commandType, nextPlan, {
    entityChanges: {
      changed: { walls: [wallId], nodes: changedNodeIds, items: changedItemIds },
    },
  });
}

function handleWallAlignToNeighbor(plan, command) {
  const { wallId } = command;
  if (!wallId) return rejected("wall.alignToNeighbor", plan, GEOMETRY_COMMAND_INVALID, "wall.alignToNeighbor требует wallId");
  const exists = (plan.walls || []).some((w) => w.id === wallId);
  if (!exists) return rejected("wall.alignToNeighbor", plan, GEOMETRY_COMMAND_NO_TARGET, "Стена не найдена");
  const geomPlan = alignWallEdgeToNeighbor(plan, wallId);
  if (!geomPlan) {
    return rejected("wall.alignToNeighbor", plan, GEOMETRY_COMMAND_FAILED, "Не найдена соседняя стена для выравнивания.");
  }
  const changedNodeIds = diffNodeIds(plan.nodes, geomPlan.nodes);
  if (changedNodeIds.length === 0) return noop("wall.alignToNeighbor", plan);

  const items = refreshMountedItemsForCoordinateChange(geomPlan, wallId);
  const changedItemIds = diffChangedItemIds(plan.items, items);
  const nextPlan = { ...geomPlan, items };
  return changedOk("wall.alignToNeighbor", nextPlan, {
    entityChanges: {
      changed: { walls: [wallId], nodes: changedNodeIds, items: changedItemIds },
    },
  });
}

function handleWallMerge(plan, command) {
  const { wallId } = command;
  if (!wallId) return rejected("wall.merge", plan, GEOMETRY_COMMAND_INVALID, "wall.merge требует wallId");
  const exists = (plan.walls || []).some((w) => w.id === wallId);
  if (!exists) return rejected("wall.merge", plan, GEOMETRY_COMMAND_NO_TARGET, "Стена не найдена");

  const res = tryMergeWallEdge(plan, wallId);
  if (!res) {
    return rejected("wall.merge", plan, GEOMETRY_COMMAND_FAILED, "Не найдена соседняя стена с общим узлом для объединения.");
  }
  if (res.blocked?.length) {
    const first = res.blocked[0];
    return rejected("wall.merge", plan, GEOMETRY_COMMAND_FAILED,
      "Не удалось безопасно перенести проём или размер на объединённую стену.",
      { entityId: first.entityId, entityType: first.entityType });
  }

  const changedItemIds = res.entityRemap.openings.map((r) => r.entityId);
  const changedDimensionIds = res.entityRemap.dimensions.map((r) => r.entityId);
  return changedOk("wall.merge", res.plan, {
    entityRemap: res.entityRemap,
    entityChanges: {
      deleted: { walls: [res.removedWallId], nodes: res.removedNodeIds },
      changed: { walls: [res.survivingWallId], items: changedItemIds, dimensions: changedDimensionIds },
    },
  });
}

function handleWallMoveSegment(plan, command) {
  const { wallId, a, b } = command;
  if (!wallId || !isFinitePoint(a) || !isFinitePoint(b)) {
    return rejected("wall.moveSegment", plan, GEOMETRY_COMMAND_INVALID, "wall.moveSegment требует wallId и конечные точки a, b");
  }
  const exists = (plan.walls || []).some((w) => w.id === wallId);
  if (!exists) return rejected("wall.moveSegment", plan, GEOMETRY_COMMAND_NO_TARGET, "Стена не найдена");
  const geomPlan = applyNetworkWallSegMove(plan, wallId, a, b);
  const changedNodeIds = diffNodeIds(plan.nodes, geomPlan.nodes);
  if (changedNodeIds.length === 0) return noop("wall.moveSegment", plan);

  const items = refreshMountedItemsForCoordinateChange(geomPlan, wallId);
  const changedItemIds = diffChangedItemIds(plan.items, items);
  const otherWallIds = wallsUsingNodes(geomPlan.walls, changedNodeIds).filter((id) => id !== wallId);
  const nextPlan = { ...geomPlan, items };
  return changedOk("wall.moveSegment", nextPlan, {
    entityChanges: {
      changed: { walls: [wallId, ...otherWallIds], nodes: changedNodeIds, items: changedItemIds },
    },
  });
}

/**
 * PHASE 1B-1A — общая (pure) реализация "переместить существующий node на
 * wallId/nodeIdx в point": network node move + no-op guard + ГЛОБАЛЬНЫЙ
 * mounted-item refresh (узел может быть общим для нескольких стен) + diff
 * связанных стен. Единственный источник cascade-логики для node.move
 * (handleNodeMove ниже) и wall.setLength (handleWallSetLength) — оба знают
 * целевую точку перемещаемого узла (wall.setLength вычисляет её из
 * lengthMm/fixedEndpoint ДО вызова этого helper'а) и делегируют сюда
 * саму мутацию + cascade, не дублируя её.
 */
function applyNodeMoveGeometry(plan, { wallId, nodeIdx, point }) {
  const geomPlan = applyNetworkNodeAtWall(plan, wallId, nodeIdx, point);
  const changedNodeIds = diffNodeIds(plan.nodes, geomPlan.nodes);
  if (changedNodeIds.length === 0) return { changed: false, plan };

  const items = refreshMountedItemsForCoordinateChange(geomPlan, null);
  const changedItemIds = diffChangedItemIds(plan.items, items);
  const wallIds = wallsUsingNodes(geomPlan.walls, changedNodeIds);
  const nextPlan = { ...geomPlan, items };
  return {
    changed: true,
    plan: nextPlan,
    entityChanges: {
      changed: { nodes: changedNodeIds, walls: wallIds, items: changedItemIds },
    },
  };
}

function handleNodeMove(plan, command) {
  const { wallId, nodeIdx, point } = command;
  if (!wallId || nodeIdx == null || !isFinitePoint(point)) {
    return rejected("node.move", plan, GEOMETRY_COMMAND_INVALID, "node.move требует wallId, nodeIdx и конечную точку point");
  }
  const wall = (plan.walls || []).find((w) => w.id === wallId);
  if (!wall) return rejected("node.move", plan, GEOMETRY_COMMAND_NO_TARGET, "Стена не найдена");
  const applied = applyNodeMoveGeometry(plan, { wallId, nodeIdx, point });
  if (!applied.changed) return noop("node.move", plan);
  return changedOk("node.move", applied.plan, { entityChanges: applied.entityChanges });
}

function handleNodeNudge(plan, command) {
  const { wallId, nodeIdx = null, dx = 0, dy = 0, round } = command;
  if (!wallId) return rejected("node.nudge", plan, GEOMETRY_COMMAND_INVALID, "node.nudge требует wallId");
  if (!isFiniteNumber(dx) || !isFiniteNumber(dy)) {
    return rejected("node.nudge", plan, GEOMETRY_COMMAND_INVALID, "node.nudge требует конечные dx/dy");
  }
  const exists = (plan.walls || []).some((w) => w.id === wallId);
  if (!exists) return rejected("node.nudge", plan, GEOMETRY_COMMAND_NO_TARGET, "Стена не найдена");
  if (dx === 0 && dy === 0) return noop("node.nudge", plan);
  const geomPlan = nudgeWallInPlan(plan, wallId, nodeIdx, dx, dy, typeof round === "function" ? round : (v) => v);
  const changedNodeIds = diffNodeIds(plan.nodes, geomPlan.nodes);
  if (changedNodeIds.length === 0) return noop("node.nudge", plan);

  // PHASE 1A-2A P2 §4: nudge может двигать УЗЕЛ, общий с другой стеной
  // (junction) — plan.nodes хранится по ссылке (id), а не копией per-wall, так
  // что movePlanNode внутри nudgeWallInPlan сразу меняет геометрию ЛЮБОЙ
  // стены, использующей этот node. Scoped-к-wallId refresh (как раньше)
  // пропускал mounted items на ДРУГИХ стенах, которые визуально тоже
  // сдвинулись. Глобальный refresh — тот же безопасный выбор, что уже
  // применяется в node.move (см. выше) для того же класса риска.
  const items = refreshMountedItemsForCoordinateChange(geomPlan, null);
  const changedItemIds = diffChangedItemIds(plan.items, items);
  const otherWallIds = wallsUsingNodes(geomPlan.walls, changedNodeIds).filter((id) => id !== wallId);
  const nextPlan = { ...geomPlan, items };
  return changedOk("node.nudge", nextPlan, {
    // Реально изменённый узел/стена, а не всегда весь wallId (nodeIdx может
    // адресовать только один конец).
    entityChanges: {
      changed: { nodes: changedNodeIds, walls: [wallId, ...otherWallIds], items: changedItemIds },
    },
  });
}

// PHASE 1B-1A: минимальная длина стены через typed-input — тот же порядок
// величины, что и производственный UX для ручного ввода размеров (не 0, не
// доли миллиметра). Не путать с NODE_LINK_THR (85мм, snap-допуск склейки
// узлов) — это отдельная, чисто UX-валидационная граница.
const WALL_SET_LENGTH_MIN_MM = 50;
// Тот же порядок величины, что и POINT_DEDUPE_EPS_MM выше — guard от
// floating-point дребезга при сравнении вычисленного Math.hypot с типизированным
// значением, а не snap/UI-допуск.
const WALL_SET_LENGTH_EPS_MM = 1e-6;

/**
 * PHASE 1B-1A — изменяет длину существующей стены, сохраняя её направление и
 * закрепляя один endpoint (fixedEndpoint). Anchor приходит ТОЛЬКО из payload —
 * команда не читает UI selection. Мутация делегирована в
 * applyNodeMoveGeometry (та же cascade-логика, что и у node.move — shared-node
 * walls, глобальный mounted-item refresh, room sync остаётся централизованным
 * в executeGeometryCommand и здесь не вызывается).
 */
function handleWallSetLength(plan, command) {
  const { wallId, lengthMm, fixedEndpoint } = command;
  if (!plan || !wallId) {
    return rejected("wall.setLength", plan, WALL_SET_LENGTH_WALL_NOT_FOUND, "wall.setLength требует wallId существующей стены");
  }
  if (fixedEndpoint !== "a" && fixedEndpoint !== "b") {
    return rejected("wall.setLength", plan, WALL_SET_LENGTH_INVALID_ANCHOR, 'wall.setLength требует fixedEndpoint: "a" | "b"');
  }
  if (!isFiniteNumber(lengthMm) || lengthMm <= 0 || lengthMm < WALL_SET_LENGTH_MIN_MM) {
    return rejected("wall.setLength", plan, WALL_SET_LENGTH_INVALID_LENGTH, `lengthMm должен быть конечным числом не меньше ${WALL_SET_LENGTH_MIN_MM} мм`);
  }
  const wall = (plan.walls || []).find((w) => w.id === wallId);
  if (!wall || !wall.a || !wall.b) {
    return rejected("wall.setLength", plan, WALL_SET_LENGTH_WALL_NOT_FOUND, "Стена не найдена");
  }
  const nodeA = plan.nodes?.[wall.a];
  const nodeB = plan.nodes?.[wall.b];
  if (!isFinitePoint(nodeA) || !isFinitePoint(nodeB)) {
    return rejected("wall.setLength", plan, WALL_SET_LENGTH_DEGENERATE_WALL, "Координаты концов стены недоступны");
  }

  const dx = nodeB.x - nodeA.x;
  const dy = nodeB.y - nodeA.y;
  const currentLength = Math.hypot(dx, dy);
  if (!(currentLength > WALL_SET_LENGTH_EPS_MM)) {
    return rejected("wall.setLength", plan, WALL_SET_LENGTH_DEGENERATE_WALL, "Стена имеет нулевую длину — направление не определено");
  }
  if (Math.abs(lengthMm - currentLength) <= WALL_SET_LENGTH_EPS_MM) {
    return noop("wall.setLength", plan);
  }

  // Направление a->b сохраняется в обоих случаях: fixedEndpoint="a" продлевает/
  // укорачивает ОТ a в текущую сторону b; fixedEndpoint="b" — от b в сторону,
  // откуда пришёл исходный a (тот же единичный вектор ux/uy, с обратным знаком).
  const ux = dx / currentLength;
  const uy = dy / currentLength;
  const movingNodeIdx = fixedEndpoint === "a" ? 1 : 0;
  const point = fixedEndpoint === "a"
    ? { x: nodeA.x + ux * lengthMm, y: nodeA.y + uy * lengthMm }
    : { x: nodeB.x - ux * lengthMm, y: nodeB.y - uy * lengthMm };

  const applied = applyNodeMoveGeometry(plan, { wallId, nodeIdx: movingNodeIdx, point });
  if (!applied.changed) return noop("wall.setLength", plan);
  return changedOk("wall.setLength", applied.plan, { entityChanges: applied.entityChanges });
}

// ── item deletion (PHASE 1A-2C2D3B) ──────────────────────────────────────

/**
 * Same 3 authoritative pure functions PlanPage.jsx's own syncEngineeringPlan
 * composes, in the same order — not a re-derived algorithm, just the shared
 * exported functions recomposed here so the command layer can run the exact
 * same production post-processing.
 */
function runEngineeringSync(nextPlan) {
  return syncClimatePlan(syncElectricalPlan(syncPlanPipes(nextPlan)));
}

/**
 * PHASE 1A-2C2D3B — shared bulk-safe item-deletion mutation. Used by
 * item.bulkDelete (single ID or many) — the single source of this cleanup
 * policy. Computes the FINAL surviving item set ONCE, cleans up links and
 * item-attached dimensions against it, then runs the same engineering-
 * derived sync production already runs once per item delete
 * (see PlanPage.jsx syncEngineeringPlan) — exactly once, not per item.
 *
 * Deleting an item never changes wall topology or other items' placement:
 * no mounted-item refresh, no wall/node mutation is performed here.
 *
 * @param {object} plan
 * @param {string[]} itemIds — may contain duplicates and/or IDs absent from
 *   plan.items (both silently normalized away) — matches wall.bulkDelete's
 *   own "operate only on what actually exists" policy.
 * @returns {object|null} internal result, or null if none of itemIds exist.
 */
function deleteItemsFromPlan(plan, itemIds) {
  const existingItemIdSet = new Set((plan.items || []).map((it) => it.id));
  const deletedItemIds = [...new Set(itemIds)].filter((id) => existingItemIdSet.has(id));
  if (deletedItemIds.length === 0) return null;
  const deletedItemIdSet = new Set(deletedItemIds);

  const items = (plan.items || []).filter((it) => !deletedItemIdSet.has(it.id));

  // PHASE 1A-2C2B corrective F-02 policy, applied to items: links referencing
  // (fromId/toId) a deleted item lose their meaning along with it.
  const deletedLinkIds = [];
  const links = (plan.links || []).filter((l) => {
    if (deletedItemIdSet.has(l.fromId) || deletedItemIdSet.has(l.toId)) {
      deletedLinkIds.push(l.id);
      return false;
    }
    return true;
  });

  // Item-attached размеры (attachedTo.type==="item") на удаляемом item:
  // persisted auto — УДАЛЯЮТСЯ (тот же F-01 policy, что и для wall
  // auto-dims — resolvePlanDimensions всегда игнорирует persisted auto-
  // записи и генерирует их заново из живой геометрии, см. runtime.js).
  // Manual — detach с сохранением ЖИВОГО p1/p2 (resolveAttachedDimension),
  // аналогично wall-attached manual dimension detach.
  const dimensionWarnings = [];
  const changedDimensionIds = [];
  const deletedDimensionIds = [];
  const dimensions = (plan.dimensions || []).flatMap((dim) => {
    const at = dim?.attachedTo;
    const attachedItemId = at?.id ?? at?.itemId;
    if (at?.type !== "item" || !deletedItemIdSet.has(attachedItemId)) return [dim];
    if (dim.auto === true) {
      deletedDimensionIds.push(dim.id);
      return [];
    }
    const resolved = resolveAttachedDimension(dim, plan);
    changedDimensionIds.push(dim.id);
    dimensionWarnings.push({ code: DIMENSION_DETACHED_AFTER_ITEM_REMOVED, entityId: dim.id, itemId: attachedItemId });
    return [{
      ...dim,
      p1: resolved.invalid ? dim.p1 : resolved.p1,
      p2: resolved.invalid ? dim.p2 : resolved.p2,
      attachedTo: null,
      kind: "manual",
      auto: false,
    }];
  });

  const nextPlan = runEngineeringSync({ ...plan, items, links, dimensions });

  return {
    plan: nextPlan,
    deletedItemIds,
    deletedLinkIds,
    deletedDimensionIds,
    changedDimensionIds,
    dimensionWarnings,
  };
}

function handleItemBulkDelete(plan, command) {
  const { itemIds } = command;
  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    return rejected("item.bulkDelete", plan, GEOMETRY_COMMAND_INVALID, "item.bulkDelete требует непустой массив itemIds");
  }
  const result = deleteItemsFromPlan(plan, itemIds);
  if (!result) {
    return rejected("item.bulkDelete", plan, GEOMETRY_COMMAND_NO_TARGET, "Ни один из указанных объектов не найден");
  }
  return changedOk("item.bulkDelete", result.plan, {
    entityChanges: {
      deleted: {
        items: result.deletedItemIds,
        links: result.deletedLinkIds,
        dimensions: result.deletedDimensionIds,
      },
      changed: { dimensions: result.changedDimensionIds },
    },
    warnings: result.dimensionWarnings,
  });
}

// ── line deletion (PHASE 1A-2C2D3E2) ──────────────────────────────────────

/**
 * PHASE 1A-2C2D3E2 — shared bulk-safe line-deletion mutation. Used by
 * line.bulkDelete (single ID or many) — the single source of this cleanup
 * policy, mirroring deleteItemsFromPlan's contract for lines. Computes the
 * FINAL surviving line set ONCE, then runs the same engineering-derived
 * sync production already runs once per item delete (see runEngineeringSync
 * above) — exactly once, not per line.
 *
 * No attached-dimension type exists for lines today (dimensions attach only
 * to attachedTo.type "item"/"wall" — see validatePlanIntegrity.js), and
 * plan.links reference items (fromId/toId), never lines — so there is
 * nothing to detach/prune directly here. Deleting a line never changes
 * plan.items, plan.walls, or plan.nodes: no mounted-item refresh, no wall/
 * node mutation is performed here. Any derived item.connections / line
 * fromItemId-toItemId recompute is left entirely to runEngineeringSync's
 * own existing policy (unchanged by this command).
 *
 * @param {object} plan
 * @param {string[]} lineIds — may contain duplicates and/or IDs absent from
 *   plan.lines (both silently normalized away) — matches item.bulkDelete's
 *   own "operate only on what actually exists" policy.
 * @returns {object|null} internal result, or null if none of lineIds exist.
 */
function deleteLinesFromPlan(plan, lineIds) {
  const existingLineIdSet = new Set((plan.lines || []).map((l) => l.id));
  const deletedLineIds = [...new Set(lineIds)].filter((id) => existingLineIdSet.has(id));
  if (deletedLineIds.length === 0) return null;
  const deletedLineIdSet = new Set(deletedLineIds);

  const lines = (plan.lines || []).filter((l) => !deletedLineIdSet.has(l.id));

  const nextPlan = runEngineeringSync({ ...plan, lines });

  return {
    plan: nextPlan,
    deletedLineIds,
  };
}

function handleLineBulkDelete(plan, command) {
  const { lineIds } = command;
  if (!Array.isArray(lineIds) || lineIds.length === 0) {
    return rejected("line.bulkDelete", plan, GEOMETRY_COMMAND_INVALID, "line.bulkDelete требует непустой массив lineIds");
  }
  const result = deleteLinesFromPlan(plan, lineIds);
  if (!result) {
    return rejected("line.bulkDelete", plan, GEOMETRY_COMMAND_NO_TARGET, "Ни одна из указанных линий не найдена");
  }
  return changedOk("line.bulkDelete", result.plan, {
    entityChanges: {
      deleted: { lines: result.deletedLineIds },
    },
  });
}

// ── dispatch table ────────────────────────────────────────────────────────

const HANDLERS = {
  "wall.split": handleWallSplit,
  "wall.delete": handleWallDelete,
  "wall.bulkDelete": handleWallBulkDelete,
  "item.bulkDelete": handleItemBulkDelete,
  "line.bulkDelete": handleLineBulkDelete,
  "wall.create": handleWallCreate,
  "wall.finishDraft": handleWallCreate,
  "wall.straighten": handleWallStraighten,
  "wall.straightenHorizontal": handleWallStraighten,
  "wall.straightenVertical": handleWallStraighten,
  "wall.alignToNeighbor": handleWallAlignToNeighbor,
  "wall.merge": handleWallMerge,
  "wall.moveSegment": handleWallMoveSegment,
  "wall.setLength": handleWallSetLength,
  "node.move": handleNodeMove,
  "node.nudge": handleNodeNudge,
  // PHASE 1A-1 corrective pass: node.moveToWall УДАЛЁН — не существует
  // отдельного production action с этой семантикой (снап узла на тело другой
  // стены/T-junction). Настоящий snap-to-wall — отдельная будущая фаза.
  // Неизвестная команда с этим type корректно вернёт GEOMETRY_COMMAND_UNKNOWN.
};

/**
 * Единственная публичная точка входа command boundary.
 *
 * @param {object} plan     текущий (актуальный) plan
 * @param {object} command  { type, ...payload }
 * @param {object} context  { makeId, roomSyncFn?, now? } — makeId обязателен
 *                          для команд, создающих сущности (split/create).
 * @returns {object} result-контракт (см. шапку файла)
 */
export function executeGeometryCommand(plan, command, context = {}) {
  const commandType = command?.type;
  if (!commandType || typeof commandType !== "string") {
    return rejected(commandType || null, plan, GEOMETRY_COMMAND_INVALID, "Команда должна содержать поле type (строка).");
  }
  const handler = HANDLERS[commandType];
  if (!handler) {
    return rejected(commandType, plan, GEOMETRY_COMMAND_UNKNOWN, `Неизвестный тип команды: ${commandType}`);
  }

  let result;
  try {
    result = handler(plan, command, context, commandType);
  } catch (err) {
    console.error(`[geometry-command] ${commandType} failed`, err);
    return rejected(commandType, plan, GEOMETRY_COMMAND_FAILED, "Не удалось выполнить операцию с геометрией.");
  }

  if (!result.ok || !result.changed) return result;

  // Room sync — ровно один раз, только после успешной реальной мутации
  // (включая mounted-item refresh, который уже применён внутри handler'а).
  let synced;
  try {
    synced = applyRoomSync(result.plan, context);
  } catch (err) {
    console.error(`[geometry-command] ${commandType} room sync failed unexpectedly`, err);
    return rejected(commandType, plan, GEOMETRY_COMMAND_FAILED, "Не удалось выполнить операцию с геометрией.");
  }
  return { ...result, plan: synced.plan, diagnostics: synced.diagnostics };
}

export const GEOMETRY_COMMAND_TYPES = Object.freeze(Object.keys(HANDLERS));
