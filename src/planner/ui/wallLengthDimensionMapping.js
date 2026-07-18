/**
 * PHASE 1B-1B — классифицирует dimension для inline wall-length editor'а.
 *
 * Единственный безопасный случай для geometry-edit — dimension, который
 * ДОКАЗУЕМО охватывает ВСЮ одну network-wall (segIndex 0, t0/t1 = {0,1} с
 * маленьким epsilon). Partial-range, multi-segment legacy walls, missing
 * attachment и item-attached размеры НЕ подходят под этот предикат — вместо
 * угадывания возвращается "wall-partial"/"item", и caller обязан показать
 * понятное сообщение, а не открыть editor.
 *
 * Не импортирует React/DOM. Не переиспользует resolveAttachedDimension
 * (model.js) напрямую — та функция ожидает уже РЕЗОЛВЛЕННЫЙ plan.walls (с
 * .pts от resolvePlanWalls), тогда как здесь нужны сырые wall.a/wall.b node
 * ID для degree-подсчёта; собственные проверки ниже (wall существует, a/b
 * существуют, координаты конечны, segIndex===0, t0/t1 конечны и span 0..1)
 * строго покрывают то же самое условие invalid, что и resolveAttachedWallDimension.
 */

const FULL_SPAN_EPS = 1e-6;

export const WALL_PARTIAL_DIMENSION_MESSAGE =
  "Изменение длины участка стены пока не поддерживается. Выберите размер всей стены.";
export const ITEM_DIMENSION_MESSAGE =
  "Изменение размера предмета по размерной линии пока не поддерживается.";

function isFinitePoint(p) {
  return p != null && typeof p === "object" && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** Сколько раз nodeId встречается как a/b среди всех стен плана (>1 => shared/junction). */
function countWallsAtNode(plan, nodeId) {
  return (plan?.walls || []).reduce(
    (n, w) => n + (w.a === nodeId ? 1 : 0) + (w.b === nodeId ? 1 : 0),
    0,
  );
}

/**
 * @returns {
 *   {kind:"manual"} | {kind:"item"} | {kind:"wall-partial"} |
 *   {kind:"wall-full", wallId, currentLengthMm, point1Endpoint:"a"|"b",
 *    point2Endpoint:"a"|"b", defaultFixedEndpoint:"a"|"b"}
 * }
 */
export function classifyWallLengthDimension(dim, plan) {
  const attachedTo = dim?.attachedTo;
  if (!attachedTo) return { kind: "manual" };
  if (attachedTo.type === "item") return { kind: "item" };
  if (attachedTo.type !== "wall") return { kind: "manual" };

  // Тот же приоритет полей, что и resolveAttachedDimension (model.js) — наша
  // классификация обязана смотреть на ТУ ЖЕ стену, которую реально резолвит
  // resolver, иначе classify и resolve могут разойтись на кривых данных.
  const wallId = attachedTo.id || attachedTo.wallId;
  const wall = (plan?.walls || []).find((w) => w.id === wallId);
  if (!wall || !wall.a || !wall.b) return { kind: "wall-partial" };

  const nodeA = plan?.nodes?.[wall.a];
  const nodeB = plan?.nodes?.[wall.b];
  if (!isFinitePoint(nodeA) || !isFinitePoint(nodeB)) return { kind: "wall-partial" };

  // segIndex !== 0 — legacy multi-segment wall.pts запись без единого a/b
  // ребра; какой из сегментов "вся стена" неоднозначно, не угадываем.
  const segIndex = Number.isInteger(attachedTo.segIndex) ? attachedTo.segIndex : 0;
  if (segIndex !== 0) return { kind: "wall-partial" };

  const { t0, t1 } = attachedTo;
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) return { kind: "wall-partial" };

  let point1Endpoint;
  let point2Endpoint;
  if (Math.abs(t0) <= FULL_SPAN_EPS && Math.abs(t1 - 1) <= FULL_SPAN_EPS) {
    point1Endpoint = "a";
    point2Endpoint = "b";
  } else if (Math.abs(t0 - 1) <= FULL_SPAN_EPS && Math.abs(t1) <= FULL_SPAN_EPS) {
    point1Endpoint = "b";
    point2Endpoint = "a";
  } else {
    return { kind: "wall-partial" }; // any sub-range (incl. reversed partial) — not the full wall
  }

  const currentLengthMm = Math.hypot(nodeB.x - nodeA.x, nodeB.y - nodeA.y);
  const degreeA = countWallsAtNode(plan, wall.a);
  const degreeB = countWallsAtNode(plan, wall.b);
  // Policy (PHASE 1B-1B §5): ровно один shared (degree>1) endpoint => закрепить
  // его, двигать свободный. Оба shared или оба свободные => default = point 1.
  let defaultFixedEndpoint;
  if (degreeA > 1 && degreeB <= 1) defaultFixedEndpoint = "a";
  else if (degreeB > 1 && degreeA <= 1) defaultFixedEndpoint = "b";
  else defaultFixedEndpoint = point1Endpoint;

  return {
    kind: "wall-full",
    wallId: wall.id,
    currentLengthMm,
    point1Endpoint,
    point2Endpoint,
    defaultFixedEndpoint,
  };
}

/** Переводит пользовательский выбор точки 1/2 в внутренний fixedEndpoint "a"|"b". Не читает stale selection — только явную classification. */
export function resolveFixedEndpointForPoint(pointNumber, classification) {
  if (classification?.kind !== "wall-full") return null;
  return pointNumber === 2 ? classification.point2Endpoint : classification.point1Endpoint;
}
