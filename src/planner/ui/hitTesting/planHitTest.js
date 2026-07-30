/**
 * PHASE 0E — screen-space hit testing стен и узлов.
 *
 * Проблема, которую решает модуль (подтверждена аудитом):
 *   core/walls/wallOps.js:861  `nodeThr = 320 / Math.max(zoom, 0.05)` — порог
 *   узла задан в мировых мм, полученных делением ЭКРАННОЙ величины на zoom, то
 *   есть радиус узла ≈ 320 экранных пикселей при видимом маркере в 6 px. Плюс
 *   узел возвращался безусловно (до проверки тела стены), поэтому далёкая
 *   вершина перехватывала клик по стене, на которой стоит курсор.
 *
 * Здесь пороги задаются ТОЛЬКО в экранных пикселях и ровно один раз переводятся
 * в мир через zoom. Модуль:
 *   • чистый (без React/DOM/backend/мутаций), детерминированный;
 *   • живёт в ui/, а не в CAD core (это UX-логика, не геометрия);
 *   • импортирует core в разрешённом направлении UI → CAD Core;
 *   • не вызывает normalizePlan и не меняет план;
 *   • НЕ является snap: snap (runSnapEngine) — отдельный путь и не затронут.
 */
import { hitTestWallBody } from "../../core/walls/wallOps.js";

/**
 * Пороги в ЭКРАННЫХ пикселях.
 * Обоснование значений:
 *   nodeRadiusPx  — видимый маркер узла рендерится r=6px (8px при hover)
 *                   (canvasPrimitives.jsx WallEl), поэтому 10px = маркер + запас;
 *   wallDistancePx— допуск вокруг тела стены: тело уже занимает thk*zoom px,
 *                   8px добавляют удобство для тонкой стены и мелкого зума;
 *   nodeBiasPx    — небольшое преимущество узла при почти равном попадании,
 *                   чтобы endpoint выигрывал у тела стены только вблизи.
 */
export const PLAN_HIT_TEST = {
  // Максимальный радиус захвата узла (внешнее кольцо).
  nodeRadiusPx: 10,
  // Видимый маркер узла (r=6px в WallEl). Внутри него узел выигрывает всегда:
  // маркер нарисован поверх стены, и пользователь целится именно в него.
  nodeMarkerPx: 6,
  // Допуск вокруг ТЕЛА стены (тело уже занимает thk*zoom px).
  wallDistancePx: 8,
  // Небольшое преимущество узла во внешнем кольце при почти равном попадании.
  nodeBiasPx: 3,
};

// Минимальный zoom для перевода px→world (защита от деления на ~0).
const MIN_ZOOM = 0.005;
// Доли вдоль стены, на которых клик считается «серединой» (совместимо с прежним
// поведением wallInteractionAt: t в [0.12, 0.88] → kind "segment").
const SEGMENT_T_MIN = 0.12;
const SEGMENT_T_MAX = 0.88;

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}
function isPt(p) {
  return p != null && typeof p === "object" && isNum(p.x) && isNum(p.y);
}
function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
function safeZoom(zoom) {
  return Math.max(isNum(zoom) ? zoom : MIN_ZOOM, MIN_ZOOM);
}
/** Единственная точка перевода экранных пикселей в мировые мм. */
export function pxToWorld(px, zoom) {
  return px / safeZoom(zoom);
}
/** Единственная точка перевода мировых мм в экранные пиксели. */
export function worldToPx(mm, zoom) {
  return mm * safeZoom(zoom);
}

/** Проекция точки на отрезок + параметр t (0..1, зажат). */
function projectOnSeg(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 0) return { point: { x: a.x, y: a.y }, t: 0 };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { point: { x: a.x + dx * t, y: a.y + dy * t }, t };
}

/** Точки стены: network (nodes + a/b) — канонично; legacy pts — read-only. */
export function wallPointsForHit(wall, nodes) {
  if (!wall) return [];
  if (wall.a != null && wall.b != null && nodes) {
    const na = nodes[wall.a];
    const nb = nodes[wall.b];
    if (isPt(na) && isPt(nb)) return [{ x: na.x, y: na.y }, { x: nb.x, y: nb.y }];
    return [];
  }
  if (Array.isArray(wall.pts)) {
    const pts = wall.pts.filter(isPt);
    return pts.length >= 2 ? pts : [];
  }
  return [];
}

/**
 * Ближайший узел стены в пределах nodeRadiusPx.
 * @returns {{idx:number, point:{x,y}, screenDistancePx:number, worldDistanceMm:number}|null}
 */
export function hitTestWallNodes(pts, worldPoint, zoom, radiusPx = PLAN_HIT_TEST.nodeRadiusPx) {
  if (!isPt(worldPoint) || !Array.isArray(pts) || !pts.length) return null;
  const maxWorld = pxToWorld(radiusPx, zoom);
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (!isPt(p)) continue;
    const d = dist(worldPoint, p);
    if (d > maxWorld) continue;
    if (!best || d < best.worldDistanceMm) {
      best = { idx: i, point: { x: p.x, y: p.y }, worldDistanceMm: d, screenDistancePx: worldToPx(d, zoom) };
    }
  }
  return best;
}

/**
 * Экранное расстояние от точки до ТЕЛА стены (0 — курсор внутри тела).
 * Тело аппроксимируется полосой centerline ± thk/2; для точного попадания в
 * слэб используется core hitTestWallBody (учитывает thicknessSide/миттеры).
 */
export function wallBodyScreenDistance(pts, wall, worldPoint, zoom) {
  if (!isPt(worldPoint) || !Array.isArray(pts) || pts.length < 2) return null;
  let bestGapPx = Infinity;
  let bestT = 0;
  let bestSeg = 0;
  const halfThk = Math.max(isNum(wall?.thk) ? wall.thk : 100, 0) / 2;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (!isPt(a) || !isPt(b)) continue;
    const { point, t } = projectOnSeg(worldPoint, a, b);
    const dCenter = dist(worldPoint, point);
    const gapWorld = Math.max(0, dCenter - halfThk); // 0 — внутри полосы тела
    const gapPx = worldToPx(gapWorld, zoom);
    if (gapPx < bestGapPx) {
      bestGapPx = gapPx;
      bestT = t;
      bestSeg = i - 1;
    }
  }
  if (!Number.isFinite(bestGapPx)) return null;
  return { screenDistancePx: bestGapPx, t: bestT, segIdx: bestSeg };
}

/**
 * Сравнение кандидатов: побеждает наименьший score.
 *
 * Две зоны для узла (важно, т.к. endpoint всегда лежит ВНУТРИ тела своей стены,
 * где расстояние до тела = 0, и «честное» сравнение расстояний иначе всегда
 * отдавало бы победу стене):
 *   • внутри видимого маркера (<= nodeMarkerPx) — узел выигрывает всегда;
 *   • во внешнем кольце (nodeMarkerPx..nodeRadiusPx) — сравнение по экранному
 *     расстоянию с небольшим bias, поэтому значительно более близкая стена
 *     побеждает (узел в 10px не перехватывает стену в 2px).
 * Узел за пределами nodeRadiusPx кандидатом вообще не становится.
 *
 * Tie-break детерминирован: node → wall, затем entityId, затем nodeIdx.
 */
export function pickBestHitCandidate(candidates = []) {
  const valid = candidates.filter((c) => c && Number.isFinite(c.screenDistancePx));
  if (!valid.length) return null;
  const scored = valid.map((c) => {
    const isNode = c.type === "node";
    const onMarker = isNode && c.screenDistancePx <= PLAN_HIT_TEST.nodeMarkerPx;
    // Маркер узла имеет абсолютный приоритет → уводим score ниже любого другого.
    const score = onMarker
      ? -1000 + c.screenDistancePx
      : c.screenDistancePx - (isNode ? PLAN_HIT_TEST.nodeBiasPx : 0);
    return { ...c, score };
  });
  scored.sort((x, y) => {
    if (x.score !== y.score) return x.score - y.score;
    if (x.type !== y.type) return x.type === "node" ? -1 : 1;
    const xi = String(x.entityId ?? "");
    const yi = String(y.entityId ?? "");
    if (xi !== yi) return xi < yi ? -1 : 1;
    return (x.nodeIdx ?? -1) - (y.nodeIdx ?? -1);
  });
  return scored[0];
}

function layerAllowed(wall, visibleLayers, lockedLayers) {
  const layer = wall?.layer || "walls";
  if (visibleLayers && visibleLayers[layer] === false) return false;
  if (lockedLayers && lockedLayers[layer] === true) return false;
  return true;
}

/**
 * Общий резолвер по плану: что под курсором — узел или стена.
 *
 * @param {object}  args
 * @param {object}  args.plan          сырой план (не мутируется)
 * @param {{x,y}}   args.worldPoint    курсор в мировых мм
 * @param {number}  args.zoom          текущий zoom (world→screen)
 * @param {object}  [args.visibleLayers] { layerId: boolean } — скрытые не выбираются
 * @param {object}  [args.lockedLayers]  { layerId: boolean } — locked не выбираются
 * @returns {{type:"node"|"wall"|null, entityId, nodeId, nodeIdx, worldPoint, screenDistancePx, worldDistanceMm, priority, metadata}}
 */
export function hitTestPlan({ plan, worldPoint, zoom, visibleLayers = null, lockedLayers = null } = {}) {
  const miss = { type: null, entityId: null, nodeId: null, nodeIdx: null, worldPoint: null, screenDistancePx: null, worldDistanceMm: null, priority: 0, metadata: {} };
  if (!plan || typeof plan !== "object" || !isPt(worldPoint)) return miss;
  const walls = Array.isArray(plan.walls) ? plan.walls : [];
  const nodes = plan.nodes && typeof plan.nodes === "object" ? plan.nodes : {};

  const candidates = [];
  for (const wall of walls) {
    if (!wall || wall.id == null) continue;
    if (!layerAllowed(wall, visibleLayers, lockedLayers)) continue;
    const pts = wallPointsForHit(wall, nodes);
    if (pts.length < 2) continue;
    // вырожденная стена (нулевая длина) — не кандидат
    if (dist(pts[0], pts[pts.length - 1]) <= 0 && pts.length === 2) continue;

    const node = hitTestWallNodes(pts, worldPoint, zoom);
    if (node) {
      const nodeId = node.idx === 0 ? wall.a : (node.idx === pts.length - 1 ? wall.b : null);
      candidates.push({
        type: "node",
        entityId: wall.id,
        nodeId: nodeId ?? null,
        nodeIdx: node.idx,
        worldPoint: node.point,
        screenDistancePx: node.screenDistancePx,
        worldDistanceMm: node.worldDistanceMm,
        priority: 1,
        metadata: {},
      });
    }
    const body = wallBodyScreenDistance(pts, wall, worldPoint, zoom);
    if (body && body.screenDistancePx <= PLAN_HIT_TEST.wallDistancePx) {
      candidates.push({
        type: "wall",
        entityId: wall.id,
        nodeId: null,
        nodeIdx: null,
        worldPoint: { x: worldPoint.x, y: worldPoint.y },
        screenDistancePx: body.screenDistancePx,
        worldDistanceMm: pxToWorld(body.screenDistancePx, zoom),
        priority: 2,
        metadata: { segIdx: body.segIdx, t: body.t },
      });
    }
  }

  const best = pickBestHitCandidate(candidates);
  if (!best) return miss;
  const { score, ...rest } = best;
  return rest;
}

/**
 * Резолвер для уже выбранной SVG-стены: узел / середина / стена.
 * Заменяет `wallInteractionAt` в PlanPage, сохраняя прежний контракт возврата
 * ({kind:"node"|"segment"|"wall"|"none", idx}), но со screen-space порогами и
 * честным сравнением «узел против тела стены».
 */
export function hitTestWallInteraction({ wall, worldPoint, zoom, allWalls = null, room = null, nodes = null } = {}) {
  if (!wall?.pts?.length) return { kind: "wall" };
  const pts = wall.pts.filter(isPt);
  if (pts.length < 2) return allWalls ? { kind: "none" } : { kind: "wall" };
  if (!isPt(worldPoint)) return allWalls ? { kind: "none" } : { kind: "wall" };
  void nodes;

  const node = hitTestWallNodes(pts, worldPoint, zoom);
  const body = wallBodyScreenDistance(pts, wall, worldPoint, zoom);
  // Точное попадание в слэб (учитывает thicknessSide) — приоритетный признак стены.
  const insideSlab = allWalls ? !!hitTestWallBody(worldPoint, wall, allWalls, room) : false;
  const wallScreenDist = insideSlab ? 0 : (body ? body.screenDistancePx : Infinity);
  const wallIsCandidate = insideSlab || wallScreenDist <= PLAN_HIT_TEST.wallDistancePx;

  // Маркер узла нарисован поверх стены → внутри него узел выигрывает всегда.
  // Во внешнем кольце сравниваем по экранному расстоянию (см. pickBestHitCandidate).
  const onMarker = node && node.screenDistancePx <= PLAN_HIT_TEST.nodeMarkerPx;
  if (node && (onMarker || !wallIsCandidate || node.screenDistancePx - PLAN_HIT_TEST.nodeBiasPx <= wallScreenDist)) {
    return { kind: "node", idx: node.idx, screenDistancePx: node.screenDistancePx };
  }

  if (wallIsCandidate) {
    if (pts.length === 2 && body && body.t >= SEGMENT_T_MIN && body.t <= SEGMENT_T_MAX) {
      return { kind: "segment", screenDistancePx: wallScreenDist };
    }
    return { kind: "wall", screenDistancePx: wallScreenDist };
  }

  return allWalls ? { kind: "none" } : { kind: "wall" };
}
