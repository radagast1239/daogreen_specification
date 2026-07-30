/**
 * PHASE 0C — validatePlanIntegrity(plan, options?)
 *
 * Чистый детерминированный валидатор ссылочной и числовой целостности плана
 * планировщика. ТОЛЬКО читает план и собирает структурированные diagnostics.
 *
 * Гарантии:
 *   • не мутирует вход;
 *   • ничего не нормализует, не мигрирует, не чинит, не пересчитывает;
 *   • не создаёт id, не сваривает узлы, не перепривязывает проёмы;
 *   • детерминированный порядок diagnostics;
 *   • не бросает исключения на мусорном входе (null/строка/массив/NaN/…);
 *   • НЕ импортирует ничего (React/DOM/backend/legacy) — self-contained,
 *     чтобы не добавлять нарушений границы CAD Core и не входить в цикл.
 *
 * Значения kind ниже зеркалят src/planner/doorTypes.js и openingTypes.js
 * (копия во избежание импорта legacy-модуля). Держать в синхронизации вручную.
 */

// ── Локальные константы (зеркало legacy без импорта) ────────────────────────

const DOOR_KINDS = new Set([
  "door", "door2", "door_slide", "door_pivot", "door_cold",
  "door_sanitary", "door_wash", "door_tech", "door_gate",
]);
const OPENING_KINDS = new Set([
  "window", "opening", "opening_vent", "opening_tech", "opening_serve", "opening_arch",
]);
/**
 * Объединённый набор kind настенных проёмов (двери + окна/проёмы).
 * Экспортируется для drift-guard теста, сравнивающего его с актуальными
 * DOOR_KINDS/OPENING_KINDS из doorTypes.js/openingTypes.js.
 */
export const WALL_OPENING_KINDS = new Set([...DOOR_KINDS, ...OPENING_KINDS]);
function isWallOpeningKind(kind) {
  return WALL_OPENING_KINDS.has(kind);
}

// Порог «слишком короткой» стены — зеркало MIN_SEGMENT_MM (core/walls/wallModel.js).
// Экспортируется для drift-guard теста.
export const MIN_WALL_SEGMENT_MM = 50;
// Допуск совпадения геометрии (мм). Зеркало NODE_MERGE_MM=1; берём слегка шире.
const GEOMETRY_EPS_MM = 1.5;

const SEVERITY_RANK = { error: 0, warning: 1, info: 2 };

// ── Мелкие чистые помощники ─────────────────────────────────────────────────

function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}
function isFiniteNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}
function isFinitePoint(p) {
  return isPlainObject(p) && isFiniteNum(p.x) && isFiniteNum(p.y);
}
function unorderedEdgeKey(a, b) {
  return String(a) < String(b) ? `${a}|${b}` : `${b}|${a}`;
}
function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
function pointsClose(a, b, eps = GEOMETRY_EPS_MM) {
  return isFinitePoint(a) && isFinitePoint(b) && dist(a, b) <= eps;
}
/** Совпадают ли неориентированные пары точек (учёт разворота). */
function segmentsClose(s1, s2, eps = GEOMETRY_EPS_MM) {
  return (
    (pointsClose(s1.a, s2.a, eps) && pointsClose(s1.b, s2.b, eps)) ||
    (pointsClose(s1.a, s2.b, eps) && pointsClose(s1.b, s2.a, eps))
  );
}

// ── Сборщик diagnostics ─────────────────────────────────────────────────────

function createCollector() {
  const diagnostics = [];
  return {
    diagnostics,
    add(d) {
      diagnostics.push({
        code: d.code,
        severity: d.severity,
        entityType: d.entityType,
        entityId: d.entityId !== undefined ? d.entityId : null,
        path: d.path,
        message: d.message,
        relatedEntityIds: d.relatedEntityIds || [],
        metadata: d.metadata || {},
      });
    },
  };
}

// ── Извлечение геометрии стены из СЫРОГО плана (без нормализации) ────────────

/** Вернуть {a:{x,y}, b:{x,y}} стены из nodes или legacy pts, или null. */
function wallEndpoints(wall, nodes) {
  if (wall && wall.a != null && wall.b != null && nodes) {
    const na = nodes[wall.a];
    const nb = nodes[wall.b];
    if (isFinitePoint(na) && isFinitePoint(nb)) return { a: { x: na.x, y: na.y }, b: { x: nb.x, y: nb.y } };
  }
  if (wall && Array.isArray(wall.pts) && wall.pts.length >= 2) {
    const a = wall.pts[0];
    const b = wall.pts[wall.pts.length - 1];
    if (isFinitePoint(a) && isFinitePoint(b)) return { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } };
  }
  return null;
}

/** Параметр проекции точки p на отрезок ab (может быть <0 или >1). */
function projectParam(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 0) return 0;
  return ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
}

// ── Секции проверок ─────────────────────────────────────────────────────────

function checkNodes(col, plan, usedNodeIds) {
  const nodes = plan.nodes;
  if (nodes === undefined) return;
  if (!isPlainObject(nodes)) {
    col.add({ code: "PLAN_FIELD_INVALID_TYPE", severity: "error", entityType: "plan", entityId: null, path: "nodes", message: "Поле nodes должно быть объектом" });
    return;
  }
  for (const key of Object.keys(nodes).sort()) {
    const val = nodes[key];
    const path = `nodes.${key}`;
    if (key === "") {
      col.add({ code: "NODE_ID_MISSING", severity: "error", entityType: "node", entityId: null, path, message: "Узел без идентификатора" });
    }
    if (!isFinitePoint(val)) {
      col.add({ code: "NODE_COORDINATE_INVALID", severity: "error", entityType: "node", entityId: key, path, message: "Координаты узла не являются конечными числами", metadata: { x: val && val.x, y: val && val.y } });
      continue;
    }
    if (!usedNodeIds.has(key)) {
      col.add({ code: "NODE_ORPHAN", severity: "warning", entityType: "node", entityId: key, path, message: "Узел не используется ни одной стеной" });
    }
  }
}

function checkWalls(col, plan) {
  const walls = plan.walls;
  if (walls === undefined) return;
  if (!Array.isArray(walls)) {
    col.add({ code: "PLAN_FIELD_INVALID_TYPE", severity: "error", entityType: "plan", entityId: null, path: "walls", message: "Поле walls должно быть массивом" });
    return;
  }
  const nodes = isPlainObject(plan.nodes) ? plan.nodes : {};
  const seenIds = new Set();
  const edgeGroups = new Map(); // unorderedEdgeKey -> первый wallId

  walls.forEach((wall, i) => {
    const path = `walls[${i}]`;
    const id = wall && wall.id;
    if (id == null || id === "") {
      col.add({ code: "WALL_ID_MISSING", severity: "error", entityType: "wall", entityId: null, path: `${path}.id`, message: "Стена без идентификатора" });
    } else if (seenIds.has(id)) {
      col.add({ code: "WALL_ID_DUPLICATE", severity: "error", entityType: "wall", entityId: id, path: `${path}.id`, message: "Дубликат идентификатора стены" });
    } else {
      seenIds.add(id);
    }

    const isNetwork = wall && wall.a != null && wall.b != null;
    const isLegacy = wall && Array.isArray(wall.pts);

    if (isNetwork) {
      const na = nodes[wall.a];
      const nb = nodes[wall.b];
      if (!isFinitePoint(na)) {
        col.add({ code: "WALL_NODE_MISSING", severity: "error", entityType: "wall", entityId: id, path: `${path}.a`, message: "Стена ссылается на отсутствующий/некорректный узел", relatedEntityIds: [wall.a], metadata: { endpoint: "a" } });
      }
      if (!isFinitePoint(nb)) {
        col.add({ code: "WALL_NODE_MISSING", severity: "error", entityType: "wall", entityId: id, path: `${path}.b`, message: "Стена ссылается на отсутствующий/некорректный узел", relatedEntityIds: [wall.b], metadata: { endpoint: "b" } });
      }
      if (wall.a === wall.b) {
        col.add({ code: "WALL_ENDPOINTS_EQUAL", severity: "error", entityType: "wall", entityId: id, path, message: "Начальный и конечный узлы стены совпадают", relatedEntityIds: [wall.a] });
      } else {
        // duplicate unordered edge (одинаковая пара узлов)
        const key = unorderedEdgeKey(wall.a, wall.b);
        if (edgeGroups.has(key)) {
          col.add({ code: "WALL_DUPLICATE_EDGE", severity: "error", entityType: "wall", entityId: id, path, message: "Дубликат ребра стены между теми же узлами", relatedEntityIds: [edgeGroups.get(key)] });
        } else {
          edgeGroups.set(key, id != null ? id : `#${i}`);
        }
      }

      if (isFinitePoint(na) && isFinitePoint(nb)) {
        const len = dist(na, nb);
        if (!isFiniteNum(len)) {
          col.add({ code: "WALL_COORDINATE_INVALID", severity: "error", entityType: "wall", entityId: id, path, message: "Длина стены не является конечным числом" });
        } else if (len <= GEOMETRY_EPS_MM) {
          col.add({ code: "WALL_TOO_SHORT", severity: "warning", entityType: "wall", entityId: id, path, message: "Стена практически нулевой длины", metadata: { lengthMm: len } });
        } else if (len < MIN_WALL_SEGMENT_MM) {
          col.add({ code: "WALL_TOO_SHORT", severity: "warning", entityType: "wall", entityId: id, path, message: `Стена короче минимального сегмента (${MIN_WALL_SEGMENT_MM} мм)`, metadata: { lengthMm: len } });
        }
      }

      // Смешанная модель: одновременно network-ссылки и независимый pts.
      if (isLegacy && wall.pts.length >= 2 && isFinitePoint(na) && isFinitePoint(nb)) {
        const p0 = wall.pts[0];
        const p1 = wall.pts[wall.pts.length - 1];
        if (isFinitePoint(p0) && isFinitePoint(p1)) {
          const consistent = segmentsClose({ a: p0, b: p1 }, { a: na, b: nb });
          if (!consistent) {
            col.add({ code: "WALL_GEOMETRY_MODEL_AMBIGUOUS", severity: "error", entityType: "wall", entityId: id, path, message: "Стена содержит network-ссылки и pts[], которые геометрически расходятся" });
          }
        }
      }
    } else if (isLegacy) {
      // Чистая legacy pts-стена.
      col.add({ code: "LEGACY_WALL_MODEL_PRESENT", severity: "info", entityType: "wall", entityId: id, path, message: "Стена использует legacy-модель pts[]" });
      if (id == null || id === "") {
        col.add({ code: "LEGACY_WALL_ID_MISSING", severity: "error", entityType: "wall", entityId: null, path: `${path}.id`, message: "Legacy-стена без идентификатора" });
      }
      if (!Array.isArray(wall.pts) || wall.pts.length < 2) {
        col.add({ code: "LEGACY_WALL_PTS_INVALID", severity: "error", entityType: "wall", entityId: id, path: `${path}.pts`, message: "Legacy-стена должна иметь минимум две точки" });
      } else {
        for (let k = 0; k < wall.pts.length; k++) {
          if (!isFinitePoint(wall.pts[k])) {
            col.add({ code: "LEGACY_WALL_POINT_INVALID", severity: "error", entityType: "wall", entityId: id, path: `${path}.pts[${k}]`, message: "Точка legacy-стены имеет некорректные координаты", metadata: { index: k } });
          } else if (k > 0 && isFinitePoint(wall.pts[k - 1]) && pointsClose(wall.pts[k - 1], wall.pts[k], 0.0001)) {
            col.add({ code: "LEGACY_WALL_SEGMENT_ZERO_LENGTH", severity: "warning", entityType: "wall", entityId: id, path: `${path}.pts[${k}]`, message: "Соседние точки legacy-стены совпадают (нулевой сегмент)", metadata: { index: k } });
          }
        }
      }
    } else if (isPlainObject(wall)) {
      // Ни network, ни legacy — стена без пригодной геометрии.
      col.add({ code: "WALL_COORDINATE_INVALID", severity: "error", entityType: "wall", entityId: id, path, message: "Стена не содержит ни узловых ссылок (a/b), ни pts[]" });
    }
  });
}

function checkItemsAndOpenings(col, plan, wallsById, nodes) {
  const items = plan.items;
  if (items === undefined) return;
  if (!Array.isArray(items)) {
    col.add({ code: "PLAN_FIELD_INVALID_TYPE", severity: "error", entityType: "plan", entityId: null, path: "items", message: "Поле items должно быть массивом" });
    return;
  }
  const seenIds = new Set();

  items.forEach((item, i) => {
    const path = `items[${i}]`;
    if (!isPlainObject(item)) {
      col.add({ code: "ITEM_POSITION_INVALID", severity: "error", entityType: "item", entityId: null, path, message: "Элемент плана не является объектом" });
      return;
    }
    const id = item.id;
    if (id == null || id === "") {
      col.add({ code: "ITEM_ID_MISSING", severity: "error", entityType: "item", entityId: null, path: `${path}.id`, message: "Объект без идентификатора" });
    } else if (seenIds.has(id)) {
      col.add({ code: "ITEM_ID_DUPLICATE", severity: "error", entityType: "item", entityId: id, path: `${path}.id`, message: "Дубликат идентификатора объекта" });
    } else {
      seenIds.add(id);
    }

    if (!isFiniteNum(item.x) || !isFiniteNum(item.y)) {
      col.add({ code: "ITEM_POSITION_INVALID", severity: "error", entityType: "item", entityId: id, path, message: "Позиция объекта не является конечными числами", metadata: { x: item.x, y: item.y } });
    }
    const rot = item.rotationDeg != null ? item.rotationDeg : item.angle;
    if (rot != null && !isFiniteNum(rot)) {
      col.add({ code: "ITEM_ROTATION_INVALID", severity: "warning", entityType: "item", entityId: id, path: `${path}.rotation`, message: "Поворот объекта не является конечным числом" });
    }
    for (const [field, val] of [["w", item.w], ["h", item.h], ["widthMm", item.widthMm], ["depthMm", item.depthMm], ["heightMm", item.heightMm]]) {
      if (val != null && (!isFiniteNum(val) || val < 0)) {
        col.add({ code: "ITEM_DIMENSION_INVALID", severity: "warning", entityType: "item", entityId: id, path: `${path}.${field}`, message: "Габарит объекта некорректен (не конечное число или отрицательный)", metadata: { field, value: val } });
      }
    }

    // Planner ownership metadata.
    if (item.source === "planner" && item.sourceObjectIds != null) {
      if (!Array.isArray(item.sourceObjectIds) || item.sourceObjectIds.some((x) => typeof x !== "string" && typeof x !== "number")) {
        col.add({ code: "ITEM_SPEC_OWNERSHIP_INVALID", severity: "warning", entityType: "item", entityId: id, path: `${path}.sourceObjectIds`, message: "sourceObjectIds должен быть массивом строк/чисел" });
      }
    }

    // Проёмы (двери/окна) — привязка к стене.
    if (isWallOpeningKind(item.kind)) {
      checkOpening(col, item, path, wallsById, nodes);
    }
  });
}

function checkOpening(col, item, path, wallsById, nodes) {
  const id = item.id;
  const wallId = item.wallId;
  let wall = null;
  if (wallId == null || wallId === "") {
    col.add({ code: "OPENING_WALL_ID_MISSING", severity: "error", entityType: "opening", entityId: id, path: `${path}.wallId`, message: "Проём не привязан к стене (нет wallId)", metadata: { kind: item.kind } });
  } else {
    wall = wallsById.get(wallId) || null;
    if (!wall) {
      col.add({ code: "OPENING_WALL_NOT_FOUND", severity: "error", entityType: "opening", entityId: id, path: `${path}.wallId`, message: "Проём ссылается на несуществующую стену", relatedEntityIds: [wallId] });
    }
  }

  const width = item.w != null ? item.w : item.widthMm;
  if (width == null || !isFiniteNum(width) || width <= 0) {
    col.add({ code: "OPENING_DIMENSION_INVALID", severity: "error", entityType: "opening", entityId: id, path: `${path}.w`, message: "Ширина проёма некорректна (не конечное положительное число)", metadata: { width } });
  }

  const wallSeg = item.wallSeg;
  const wallEnds = wall ? wallEndpoints(wall, nodes) : null;

  if (wallSeg != null) {
    if (!isFinitePoint(wallSeg.a) || !isFinitePoint(wallSeg.b)) {
      col.add({ code: "OPENING_WALL_SEG_INVALID", severity: "error", entityType: "opening", entityId: id, path: `${path}.wallSeg`, message: "wallSeg проёма имеет некорректные точки" });
    } else if (wallEnds) {
      const matchesWall = segmentsClose({ a: wallSeg.a, b: wallSeg.b }, wallEnds);
      if (!matchesWall) {
        // Проверяем, не соответствует ли wallSeg другой стене → неоднозначность.
        let otherWallId = null;
        for (const [wid, w] of wallsById) {
          if (wid === wallId) continue;
          const ends = wallEndpoints(w, nodes);
          if (ends && segmentsClose({ a: wallSeg.a, b: wallSeg.b }, ends)) { otherWallId = wid; break; }
        }
        if (otherWallId) {
          col.add({ code: "OPENING_REFERENCE_AMBIGUOUS", severity: "error", entityType: "opening", entityId: id, path: `${path}.wallSeg`, message: "wallId и wallSeg проёма указывают на разные стены", relatedEntityIds: [wallId, otherWallId] });
        } else {
          col.add({ code: "OPENING_WALL_SEG_INVALID", severity: "warning", entityType: "opening", entityId: id, path: `${path}.wallSeg`, message: "wallSeg проёма устарел и не совпадает с геометрией стены", relatedEntityIds: wallId != null ? [wallId] : [] });
        }
      }
    }
  }

  // Проём вне длины стены (если геометрию можно надёжно определить).
  if (wallEnds && isFiniteNum(item.x) && isFiniteNum(item.y) && isFiniteNum(width) && width > 0) {
    const h = isFiniteNum(item.h) ? item.h : 0;
    const center = { x: item.x + width / 2, y: item.y + h / 2 };
    const len = dist(wallEnds.a, wallEnds.b);
    if (len > GEOMETRY_EPS_MM) {
      const t = projectParam(center, wallEnds.a, wallEnds.b);
      const half = width / (2 * len);
      if (t + half < 0 || t - half > 1) {
        col.add({ code: "OPENING_OUTSIDE_WALL", severity: "warning", entityType: "opening", entityId: id, path, message: "Проём расположен вне длины стены", relatedEntityIds: wallId != null ? [wallId] : [], metadata: { t } });
      }
    }
  }
}

function checkDimensions(col, plan, wallsById, itemsById) {
  const dims = plan.dimensions;
  if (dims === undefined) return;
  if (!Array.isArray(dims)) {
    col.add({ code: "PLAN_FIELD_INVALID_TYPE", severity: "error", entityType: "plan", entityId: null, path: "dimensions", message: "Поле dimensions должно быть массивом" });
    return;
  }
  dims.forEach((dim, i) => {
    const path = `dimensions[${i}]`;
    if (!isPlainObject(dim)) {
      col.add({ code: "DIMENSION_POINT_INVALID", severity: "error", entityType: "dimension", entityId: null, path, message: "Размер не является объектом" });
      return;
    }
    const id = dim.id;
    if (id == null || id === "") {
      col.add({ code: "DIMENSION_ID_MISSING", severity: "error", entityType: "dimension", entityId: null, path: `${path}.id`, message: "Размер без идентификатора" });
    }

    const at = dim.attachedTo;
    const hasAnchor = at != null;

    // Координаты p1/p2.
    if (dim.p1 != null && !isFinitePoint(dim.p1)) {
      col.add({ code: "DIMENSION_POINT_INVALID", severity: "error", entityType: "dimension", entityId: id, path: `${path}.p1`, message: "Точка p1 размера некорректна" });
    }
    if (dim.p2 != null && !isFinitePoint(dim.p2)) {
      col.add({ code: "DIMENSION_POINT_INVALID", severity: "error", entityType: "dimension", entityId: id, path: `${path}.p2`, message: "Точка p2 размера некорректна" });
    }
    if (!hasAnchor && (!isFinitePoint(dim.p1) || !isFinitePoint(dim.p2))) {
      col.add({ code: "DIMENSION_POINT_INVALID", severity: "error", entityType: "dimension", entityId: id, path, message: "Свободный размер без валидных p1/p2" });
    }

    if (!hasAnchor) return;
    if (!isPlainObject(at)) {
      col.add({ code: "DIMENSION_ANCHOR_INVALID", severity: "error", entityType: "dimension", entityId: id, path: `${path}.attachedTo`, message: "attachedTo размера некорректен" });
      return;
    }
    if (at.type === "wall") {
      const wid = at.wallId != null ? at.wallId : at.id;
      const wall = wid != null ? wallsById.get(wid) : null;
      if (!wall) {
        col.add({ code: "DIMENSION_WALL_NOT_FOUND", severity: "error", entityType: "dimension", entityId: id, path: `${path}.attachedTo`, message: "Размер привязан к несуществующей стене", relatedEntityIds: wid != null ? [wid] : [] });
      }
      for (const key of ["t0", "t1"]) {
        if (at[key] != null && (!isFiniteNum(at[key]) || at[key] < 0 || at[key] > 1)) {
          col.add({ code: "DIMENSION_ANCHOR_INVALID", severity: "warning", entityType: "dimension", entityId: id, path: `${path}.attachedTo.${key}`, message: `Параметр ${key} привязки вне диапазона [0,1]`, metadata: { [key]: at[key] } });
        }
      }
      if (at.segIndex != null && (!Number.isInteger(at.segIndex) || at.segIndex < 0)) {
        col.add({ code: "DIMENSION_ANCHOR_INVALID", severity: "warning", entityType: "dimension", entityId: id, path: `${path}.attachedTo.segIndex`, message: "segIndex привязки некорректен", metadata: { segIndex: at.segIndex } });
      }
    } else if (at.type === "item") {
      const iid = at.id != null ? at.id : at.itemId;
      if (iid == null || !itemsById.has(iid)) {
        col.add({ code: "DIMENSION_ITEM_NOT_FOUND", severity: "error", entityType: "dimension", entityId: id, path: `${path}.attachedTo`, message: "Размер привязан к несуществующему объекту", relatedEntityIds: iid != null ? [iid] : [] });
      }
    } else {
      col.add({ code: "DIMENSION_ANCHOR_INVALID", severity: "error", entityType: "dimension", entityId: id, path: `${path}.attachedTo.type`, message: "Неизвестный тип привязки размера", metadata: { type: at.type } });
    }
  });
}

function checkRoutes(col, plan, itemsById) {
  // Инженерные трассы = plan.lines (polyline с pts/points).
  const lines = plan.lines;
  if (lines !== undefined) {
    if (!Array.isArray(lines)) {
      col.add({ code: "PLAN_FIELD_INVALID_TYPE", severity: "error", entityType: "plan", entityId: null, path: "lines", message: "Поле lines должно быть массивом" });
    } else {
      const seen = new Set();
      lines.forEach((line, i) => {
        const path = `lines[${i}]`;
        if (!isPlainObject(line)) {
          col.add({ code: "ROUTE_POINTS_INVALID", severity: "error", entityType: "route", entityId: null, path, message: "Трасса не является объектом" });
          return;
        }
        const id = line.id;
        if (id == null || id === "") {
          col.add({ code: "ROUTE_ID_MISSING", severity: "error", entityType: "route", entityId: null, path: `${path}.id`, message: "Трасса без идентификатора" });
        } else if (seen.has(id)) {
          col.add({ code: "ROUTE_ID_DUPLICATE", severity: "error", entityType: "route", entityId: id, path: `${path}.id`, message: "Дубликат идентификатора трассы" });
        } else {
          seen.add(id);
        }
        const pts = Array.isArray(line.pts) ? line.pts : (Array.isArray(line.points) ? line.points : null);
        if (!pts) {
          col.add({ code: "ROUTE_POINTS_INVALID", severity: "error", entityType: "route", entityId: id, path: `${path}.pts`, message: "Точки трассы отсутствуют или не массив" });
        } else if (pts.length < 2) {
          col.add({ code: "ROUTE_TOO_SHORT", severity: "warning", entityType: "route", entityId: id, path: `${path}.pts`, message: "Трасса содержит менее двух точек", metadata: { count: pts.length } });
        } else {
          for (let k = 0; k < pts.length; k++) {
            if (!isFinitePoint(pts[k])) {
              col.add({ code: "ROUTE_POINT_INVALID", severity: "error", entityType: "route", entityId: id, path: `${path}.pts[${k}]`, message: "Точка трассы имеет некорректные координаты", metadata: { index: k } });
            }
          }
        }
        for (const [field, ref] of [["fromItemId", line.fromItemId], ["toItemId", line.toItemId]]) {
          if (ref != null && ref !== "" && !itemsById.has(ref)) {
            col.add({ code: "ROUTE_ENDPOINT_REFERENCE_NOT_FOUND", severity: "warning", entityType: "route", entityId: id, path: `${path}.${field}`, message: "Конец трассы ссылается на несуществующий объект", relatedEntityIds: [ref], metadata: { field } });
          }
        }
      });
    }
  }

  // Связи объектов = plan.links (fromId/toId → item).
  const links = plan.links;
  if (links !== undefined) {
    if (!Array.isArray(links)) {
      col.add({ code: "PLAN_FIELD_INVALID_TYPE", severity: "error", entityType: "plan", entityId: null, path: "links", message: "Поле links должно быть массивом" });
    } else {
      const seen = new Set();
      links.forEach((link, i) => {
        const path = `links[${i}]`;
        if (!isPlainObject(link)) return;
        const id = link.id;
        if (id != null && id !== "") {
          if (seen.has(id)) {
            col.add({ code: "ROUTE_ID_DUPLICATE", severity: "error", entityType: "link", entityId: id, path: `${path}.id`, message: "Дубликат идентификатора связи" });
          } else {
            seen.add(id);
          }
        }
        for (const [field, ref] of [["fromId", link.fromId], ["toId", link.toId]]) {
          if (ref != null && ref !== "" && !itemsById.has(ref)) {
            col.add({ code: "ROUTE_ENDPOINT_REFERENCE_NOT_FOUND", severity: "warning", entityType: "link", entityId: id != null ? id : null, path: `${path}.${field}`, message: "Связь ссылается на несуществующий объект", relatedEntityIds: [ref], metadata: { field } });
          }
        }
      });
    }
  }
}

function checkRooms(col, plan) {
  const rooms = plan.rooms;
  if (rooms === undefined) return;
  if (!Array.isArray(rooms)) {
    col.add({ code: "PLAN_FIELD_INVALID_TYPE", severity: "error", entityType: "plan", entityId: null, path: "rooms", message: "Поле rooms должно быть массивом" });
    return;
  }
  const zonesById = new Map();
  if (Array.isArray(plan.zones)) {
    for (const z of plan.zones) if (isPlainObject(z) && z.id != null) zonesById.set(z.id, z);
  }
  const seen = new Set();
  rooms.forEach((room, i) => {
    const path = `rooms[${i}]`;
    if (!isPlainObject(room)) {
      col.add({ code: "ROOM_POLYGON_INVALID", severity: "warning", entityType: "room", entityId: null, path, message: "Помещение не является объектом" });
      return;
    }
    const id = room.id;
    if (id != null && id !== "") {
      if (seen.has(id)) {
        col.add({ code: "ROOM_ID_DUPLICATE", severity: "warning", entityType: "room", entityId: id, path: `${path}.id`, message: "Дубликат идентификатора помещения" });
      } else {
        seen.add(id);
      }
    }
    if (room.polygon != null) {
      if (!Array.isArray(room.polygon)) {
        col.add({ code: "ROOM_POLYGON_INVALID", severity: "warning", entityType: "room", entityId: id, path: `${path}.polygon`, message: "Полигон помещения не является массивом" });
      } else {
        let invalidPoint = false;
        const uniq = new Set();
        room.polygon.forEach((p, k) => {
          if (!isFinitePoint(p)) {
            invalidPoint = true;
            col.add({ code: "ROOM_POINT_INVALID", severity: "warning", entityType: "room", entityId: id, path: `${path}.polygon[${k}]`, message: "Точка полигона помещения некорректна", metadata: { index: k } });
          } else {
            uniq.add(`${p.x}|${p.y}`);
          }
        });
        if (!invalidPoint && uniq.size < 3) {
          col.add({ code: "ROOM_POLYGON_INVALID", severity: "warning", entityType: "room", entityId: id, path: `${path}.polygon`, message: "Полигон помещения содержит менее трёх уникальных точек", metadata: { uniquePoints: uniq.size } });
        }
      }
    }
    for (const [field, val] of [["areaMm2", room.areaMm2], ["areaM2", room.areaM2]]) {
      if (val != null && !isFiniteNum(val)) {
        col.add({ code: "ROOM_POLYGON_INVALID", severity: "warning", entityType: "room", entityId: id, path: `${path}.${field}`, message: "Площадь помещения не является конечным числом", metadata: { field } });
      }
    }
    // Конфликт identity room/zone по одному id.
    if (id != null && zonesById.has(id)) {
      const zone = zonesById.get(id);
      if (isPlainObject(zone) && room.name != null && zone.name != null && room.name !== zone.name) {
        col.add({ code: "ROOM_ZONE_IDENTITY_CONFLICT", severity: "warning", entityType: "room", entityId: id, path, message: "Помещение и зона с одним id имеют разные имена", relatedEntityIds: [id], metadata: { roomName: room.name, zoneName: zone.name } });
      }
    }
  });
}

// ── Публичный API ───────────────────────────────────────────────────────────

/**
 * @param {*} plan   план планировщика (любой ввод; мусор безопасен)
 * @param {object} [options]  зарезервировано; поведение не настраивается в 0C
 * @returns {{ valid: boolean, summary: object, diagnostics: object[] }}
 */
export function validatePlanIntegrity(plan, options = {}) {
  void options; // зарезервировано
  const col = createCollector();

  if (!isPlainObject(plan)) {
    col.add({ code: "PLAN_NOT_OBJECT", severity: "error", entityType: "plan", entityId: null, path: "", message: "План не является объектом", metadata: { received: plan === null ? "null" : Array.isArray(plan) ? "array" : typeof plan } });
    return finalize(col.diagnostics);
  }

  // Индексы (O(n)).
  const usedNodeIds = new Set();
  if (Array.isArray(plan.walls)) {
    for (const w of plan.walls) {
      if (isPlainObject(w)) {
        if (w.a != null) usedNodeIds.add(w.a);
        if (w.b != null) usedNodeIds.add(w.b);
      }
    }
  }
  const wallsById = new Map();
  if (Array.isArray(plan.walls)) {
    for (const w of plan.walls) if (isPlainObject(w) && w.id != null) { if (!wallsById.has(w.id)) wallsById.set(w.id, w); }
  }
  const itemsById = new Map();
  if (Array.isArray(plan.items)) {
    for (const it of plan.items) if (isPlainObject(it) && it.id != null) { if (!itemsById.has(it.id)) itemsById.set(it.id, it); }
  }
  const nodes = isPlainObject(plan.nodes) ? plan.nodes : {};

  checkNodes(col, plan, usedNodeIds);
  checkWalls(col, plan);
  checkItemsAndOpenings(col, plan, wallsById, nodes);
  checkDimensions(col, plan, wallsById, itemsById);
  checkRoutes(col, plan, itemsById);
  checkRooms(col, plan);

  return finalize(col.diagnostics);
}

function finalize(diagnostics) {
  const sorted = [...diagnostics].sort(compareDiagnostics);
  let errors = 0;
  let warnings = 0;
  let info = 0;
  for (const d of sorted) {
    if (d.severity === "error") errors++;
    else if (d.severity === "warning") warnings++;
    else if (d.severity === "info") info++;
  }
  return {
    valid: errors === 0,
    summary: { errors, warnings, info, total: sorted.length },
    diagnostics: sorted,
  };
}

function compareDiagnostics(a, b) {
  const s = (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99);
  if (s !== 0) return s;
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  if (a.entityType !== b.entityType) return a.entityType < b.entityType ? -1 : 1;
  const ai = a.entityId == null ? "" : String(a.entityId);
  const bi = b.entityId == null ? "" : String(b.entityId);
  if (ai !== bi) return ai < bi ? -1 : 1;
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;
  return 0;
}

export default validatePlanIntegrity;
