# Plan Integrity Validator — `validatePlanIntegrity`

Статус: **PHASE 0C**, read-only библиотека. Не подключена к UI/save/backend
(это задача PHASE 0D). Дополняет [current-plan-schema-v1.md](current-plan-schema-v1.md).

Модуль: `src/planner/core/validation/validatePlanIntegrity.js`
Тесты: `tests/plannerIntegrityValidation.test.js`

---

## Назначение

Единый независимый валидатор, который читает план планировщика и сообщает о
структурных дефектах ссылочной и числовой целостности — **не изменяя план**.

Служит фундаментом для: кнопки «Проверить план», безопасных migrations, CAD Core v2,
защиты перед save, обнаружения дефектов старых проектов, regression-тестов и
будущего диагностического UI.

## Контракт

```js
import { validatePlanIntegrity } from "src/planner/core/validation/validatePlanIntegrity.js";

const result = validatePlanIntegrity(plan, options);
```

- `plan` — любой ввод (мусор безопасен: `null`, строка, массив, частичный объект).
- `options` — зарезервировано; поведение в 0C **не настраивается** (в т.ч. severity).

### Результат

```js
{
  valid: true,                                  // valid === (summary.errors === 0)
  summary: { errors: 0, warnings: 0, info: 0, total: 0 },
  diagnostics: [ /* см. ниже, отсортированы детерминированно */ ]
}
```

### Diagnostic

```js
{
  code: "WALL_NODE_MISSING",
  severity: "error",              // "error" | "warning" | "info"
  entityType: "wall",
  entityId: "w1",                 // null, если неизвестен
  path: "walls[0].a",
  message: "Стена ссылается на отсутствующий/некорректный узел",
  relatedEntityIds: ["missing-node-id"],
  metadata: { endpoint: "a" }
}
```

Поля всегда присутствуют: `code, severity, entityType, entityId, path, message,
relatedEntityIds, metadata` (последние два — `[]`/`{}` по умолчанию).

## Severity

- **error** — нарушена ссылочная/числовая целостность; геометрия не может надёжно
  использоваться (`valid: false`).
- **warning** — план открывается, но есть риск/неоднозначность.
- **info** — диагностическое наблюдение, не поломка (напр. legacy-модель).

`valid` определяется как **отсутствие error**. Warning/info не делают план невалидным.

## Детерминированность

Один и тот же план всегда даёт одинаковые diagnostics, в одинаковом порядке, без
timestamps/random. Порядок сортировки:

1. severity (error → warning → info);
2. code;
3. entityType;
4. entityId;
5. path.

Обход `nodes` идёт по отсортированным ключам, чтобы не зависеть от порядка вставки.

## Иммутабельность и отсутствие авто-починки

Валидатор **только читает**. Он не нормализует, не мигрирует `pts→nodes`, не создаёт
id, не сваривает узлы, не удаляет дубли/стены, не перепривязывает проёмы, не
пересчитывает комнаты, не запускает room detection. Тест
`validatePlanIntegrity does not mutate input plan` проверяет это на `deepFreeze`-входе.

## Что проверяется

| Code | Severity | Entity | Что обнаруживает |
|---|---|---|---|
| `PLAN_NOT_OBJECT` | error | plan | План не объект (null/строка/массив/число) |
| `PLAN_FIELD_INVALID_TYPE` | error | plan | Коллекция неверного типа (nodes не объект, walls не массив, …) |
| `NODE_ID_MISSING` | error | node | Узел с пустым ключом-идентификатором |
| `NODE_COORDINATE_INVALID` | error | node | `x`/`y` не конечные числа (NaN/Infinity/не число) |
| `NODE_ORPHAN` | warning | node | Узел не используется ни одной стеной |
| `WALL_ID_MISSING` | error | wall | Стена без id |
| `WALL_ID_DUPLICATE` | error | wall | Дубликат id стены |
| `WALL_NODE_MISSING` | error | wall | Ссылка `a`/`b` на отсутствующий/некорректный узел |
| `WALL_ENDPOINTS_EQUAL` | error | wall | `a === b` |
| `WALL_COORDINATE_INVALID` | error | wall | Нет пригодной геометрии / длина не конечна |
| `WALL_TOO_SHORT` | warning | wall | Длина ~0 или короче `MIN_WALL_SEGMENT_MM` (50 мм) |
| `WALL_DUPLICATE_EDGE` | error | wall | Дубликат неориентированного ребра (та же пара узлов, в т.ч. в обратном порядке) |
| `WALL_GEOMETRY_MODEL_AMBIGUOUS` | error | wall | Одновременно `a/b` и независимый `pts[]`, геометрически расходящиеся |
| `LEGACY_WALL_MODEL_PRESENT` | info | wall | Стена использует legacy `pts[]` (не ошибка) |
| `LEGACY_WALL_PTS_INVALID` | error | wall | `pts` не массив или < 2 точек |
| `LEGACY_WALL_POINT_INVALID` | error | wall | Точка legacy-стены с некорректными координатами |
| `LEGACY_WALL_SEGMENT_ZERO_LENGTH` | warning | wall | Соседние точки legacy-стены совпадают |
| `LEGACY_WALL_ID_MISSING` | error | wall | Legacy-стена без id |
| `OPENING_WALL_ID_MISSING` | error | opening | Проём без `wallId` |
| `OPENING_WALL_NOT_FOUND` | error | opening | `wallId` указывает на несуществующую стену |
| `OPENING_WALL_SEG_INVALID` | error/warning | opening | `wallSeg` с битыми точками (error) или устарел и не совпадает с геометрией стены — дефект split (warning) |
| `OPENING_REFERENCE_AMBIGUOUS` | error | opening | `wallId` и `wallSeg` указывают на разные стены |
| `OPENING_OUTSIDE_WALL` | warning | opening | Центр проёма спроецирован вне длины стены |
| `OPENING_DIMENSION_INVALID` | error | opening | Ширина не конечна/не положительна |
| `DIMENSION_ID_MISSING` | error | dimension | Размер без id |
| `DIMENSION_POINT_INVALID` | error | dimension | `p1`/`p2` некорректны или отсутствуют у свободного размера |
| `DIMENSION_ANCHOR_INVALID` | error/warning | dimension | Неизвестный тип привязки (error); `t0/t1`/`segIndex` вне диапазона (warning) |
| `DIMENSION_WALL_NOT_FOUND` | error | dimension | Привязка к несуществующей стене |
| `DIMENSION_ITEM_NOT_FOUND` | error | dimension | Привязка к несуществующему объекту |
| `ROUTE_ID_MISSING` | error | route | Трасса без id |
| `ROUTE_ID_DUPLICATE` | error | route/link | Дубликат id трассы/связи |
| `ROUTE_POINTS_INVALID` | error | route | Точки трассы отсутствуют/не массив/не объект |
| `ROUTE_POINT_INVALID` | error | route | Точка трассы с некорректными координатами |
| `ROUTE_TOO_SHORT` | warning | route | Менее двух точек |
| `ROUTE_ENDPOINT_REFERENCE_NOT_FOUND` | warning | route/link | `fromItemId/toItemId`/`fromId/toId` ссылается на отсутствующий объект |
| `ITEM_ID_MISSING` | error | item | Объект без id |
| `ITEM_ID_DUPLICATE` | error | item | Дубликат id объекта |
| `ITEM_POSITION_INVALID` | error | item | `x`/`y` не конечны, либо элемент не объект |
| `ITEM_ROTATION_INVALID` | warning | item | Поворот не конечное число |
| `ITEM_DIMENSION_INVALID` | warning | item | Габарит не конечен/отрицателен |
| `ITEM_SPEC_OWNERSHIP_INVALID` | warning | item | `source:"planner"` с некорректным `sourceObjectIds` |
| `ROOM_POLYGON_INVALID` | warning | room | Полигон не массив / < 3 уникальных точек / площадь не конечна |
| `ROOM_POINT_INVALID` | warning | room | Точка полигона помещения некорректна |
| `ROOM_ID_DUPLICATE` | warning | room | Дубликат id помещения |
| `ROOM_ZONE_IDENTITY_CONFLICT` | warning | room | Помещение и зона с одним id имеют разные имена |
| `ROOM_METADATA_ORPHAN` | warning | room | (зарезервирован) metadata ссылается на отсутствующую identity |

> `ITEM_REFERENCE_NOT_FOUND`, `NODE_ID_DUPLICATE`, `DIMENSION_TARGET_NOT_FOUND`,
> `OPENING_WALL_SEG_INVALID`(варианты) перечислены в контракте кодов; часть из них
> зарезервирована и срабатывает только в специфических конфигурациях (например,
> `NODE_ID_DUPLICATE` невозможен для nodes-как-объекта). Конкретные wall/item коды
> предпочитаются общему числовому коду.

## Что валидатор намеренно НЕ делает

- не чинит геометрию, не удаляет дубли, не сваривает узлы, не мигрирует `pts`;
- не меняет id, не перепривязывает проёмы, не пересчитывает/не детектит комнаты;
- не сравнивает сохранённые комнаты с заново рассчитанными;
- не обращается к API материалов (внешний `materialId` не считается отсутствующим);
- не блокирует save/editor, не пишет diagnostics в план, не добавляет API-поле;
- не настраивает severity; не добавляет spatial index.

## Legacy/network coexistence

План может одновременно содержать network-стены (`nodes` + `a/b`) и legacy `pts[]`.
Правила валидатора:

- чистая legacy `pts`-стена → `info: LEGACY_WALL_MODEL_PRESENT` (+ проверки точек);
- network-стена без `pts` → обычные network-проверки;
- стена с обоими: если `pts[0]/pts[last]` совпадают с `nodes[a]/nodes[b]` в пределах
  допуска (`GEOMETRY_EPS_MM = 1.5` мм) — расхождения нет; иначе
  `error: WALL_GEOMETRY_MODEL_AMBIGUOUS`.

Сравнения геометрии tolerant к округлениям текущего проекта (мм-единицы).

## Производительность

Индексы через `Map`/`Set`; проверка дублей рёбер — O(n) по неориентированному ключу.
Baseline (смешанный план 100 nodes / 150 walls / 500 items / 400 route points) —
единицы миллисекунд, широкий бюджет `< 500 ms`. Spatial index в 0C не вводится.

## Пример result

```js
validatePlanIntegrity({
  nodes: { n1: { x: 0, y: 0 } },
  walls: [{ id: "w1", a: "n1", b: "nX" }],
});
// →
{
  valid: false,
  summary: { errors: 1, warnings: 0, info: 0, total: 1 },
  diagnostics: [{
    code: "WALL_NODE_MISSING", severity: "error", entityType: "wall",
    entityId: "w1", path: "walls[0].b",
    message: "Стена ссылается на отсутствующий/некорректный узел",
    relatedEntityIds: ["nX"], metadata: { endpoint: "b" },
  }],
}
```
