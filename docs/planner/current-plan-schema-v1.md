# Current Plan Schema v1 — фактическая модель плана планировщика

Статус: **descriptive baseline (PHASE 0A)**. Документ фиксирует ТЕКУЩЕЕ состояние
по реальному коду и golden fixtures. Он **не предлагает** новую архитектуру и не
описывает желаемое поведение — только то, что есть сейчас.

Расположение выбрано `docs/planner/` (новый подкаталог), т.к. существующая
`docs/` содержит смешанные документы (CAD_ARCHITECTURE.md, PLANNER_INVENTORY_003.md),
а PHASE 0A вводит отдельную серию planner-baseline артефактов.

Источники истины (файлы, а не догадки):

- `src/planner/catalog.js` — `DEFAULT_PLAN()`, `DEFAULT_DISPLAY()`
- `src/planner/planNormalize.js` — `normalizePlan(raw)` (единая точка входа)
- `src/planner/wallNetwork.js` — network-модель стен (`nodes` + `walls[].a/b`)
- `src/planner/core/walls/wallModel.js` — `normalizeWall`, `upgradeLegacyWall`
- `src/planner/core/dimensions/model.js` — размеры и их якоря
- `src/planner/core/rooms/*` — детекция и синк помещений
- `src/planner/doorGeometry.js`, `openingTypes.js`, `doorTypes.js` — проёмы
- `src/planner/farmObjects.js`, `specSync.js` — объекты фермы и спецификация
- `src/planner/pipes.js`, `electrical.js`, `climate.js` — инженерные слои
- backend: `backend/src/routes/projects.js`, `backend/src/db.js` — persistence

Golden fixtures, иллюстрирующие модель: `tests/fixtures/planner/*.json`.

---

## 3.1. Корневой объект плана

`DEFAULT_PLAN()` (`catalog.js`) — набор полей по умолчанию, поверх которого
`normalizePlan` накладывает `raw`. Неизвестные поля верхнего уровня **сохраняются**
(spread `...raw`), не вычищаются.

| Поле | Тип | Обязат. | По умолч. | Кто создаёт | Кто читает | Persisted | Persisted/Derived |
|---|---|---|---|---|---|---|---|
| `unit` | string | нет | `"mm"` | DEFAULT_PLAN | рендер/экспорт | да | persisted |
| `room` | object | да | `{ w, h, wallThk:120, height:3000, defaultRoomHeightMm:3000, showBoundary:false }` | DEFAULT_PLAN | стены/комнаты | да | persisted |
| `nodes` | object `{id:{x,y}}` | да | `{}` | wallNetwork | стены/snap/размеры | да | persisted (каноничный) |
| `walls` | array рёбер | да | `[]` | wallNetwork/UI | всё геометрическое | да | persisted (каноничный) |
| `items` | array | да | `[]` | UI/farmObjects | рендер/спец/проёмы | да | persisted |
| `lines` | array | да | `[]` | UI/pipes | инж. слои | да | persisted |
| `links` | array | да | `[]` | UI/linkRules | связи объектов | да | persisted |
| `zones` | array | да | `[]` | syncRooms | рендер (совмест.) | да* | **derived** из rooms (сохраняется, но перерасчёт при normalize) |
| `rooms` | array | да | `[]` | syncRooms/detectRooms | климат/спец/рендер | да* | **derived** из стен (identity сохраняется) |
| `labels` | array | да | `[]` | UI | рендер | да | persisted |
| `measurements` | array | да | `[]` | legacy UI | размеры (legacy) | да | persisted (legacy) |
| `rulers` | array | да | `[]` | legacy UI | размеры (legacy) | да | persisted (legacy) |
| `dimensions` | array | да | `[]` | core/dimensions | рендер размеров | да | persisted |
| `structurals` | array | да | `[]` | UI | конструктив | да | persisted |
| `farmObjectGroups` | array | да | `[]` | UI | группировка | да | persisted |
| `electricalGroups` | array | да | `[]` | electrical | эл. слой | да | persisted |
| `electricalLoads` | object/null | нет | `null` | syncElectricalPlan | эл. расчёт | да | **derived** |
| `climateSettings` | object | да | `{ forbidIndoorOverPassage:true, maxRackFanDistanceMm:4500 }` | DEFAULT_PLAN | климат | да | persisted |
| `climateLoads` | object/null | нет | `null` | syncClimatePlan | климат. расчёт | да | **derived** |
| `validationWarnings` | array | да | `[]` | syncRooms/validateRooms | UI-диагностика | да | **derived** |

\* `rooms`/`zones` сохраняются в JSON, но при каждом `normalizePlan` пересчитываются
из стен (`syncRooms`), сохраняя identity предыдущих помещений (см. §3.3).

`DEFAULT_DISPLAY()` (там же) — это **editor-only** настройки отображения
(showDims, snapOn, snapDistancePx:10, dimensionDisplayMode и т.д.). Они **не часть
plan JSON** и живут в UI-состоянии, а не в сохраняемом плане.

---

## 3.2. Геометрия

### Каноничная модель стен: `nodes` + рёбра `walls[].a/b`

- `plan.nodes` — словарь `{ nodeId: { x, y } }` (координаты в мм).
- `plan.walls[]` — рёбра графа. Поле стены (по `wallModel.normalizeWall` /
  `wallNetwork.pickWallMeta`):

| Поле | Тип | По умолч. | Смысл |
|---|---|---|---|
| `id` | string | `wl_*` / uid | id ребра |
| `a` | nodeId | — | узел начала (каноничный) |
| `b` | nodeId | — | узел конца (каноничный) |
| `thk` | number | `100` | толщина стены, мм |
| `role` | string | `"partition"` | роль |
| `kind` | string | `"new"` | тип |
| `thicknessSide` | string | `"center"` | сторона наращивания толщины |
| `height` | number | `3000` | высота стены, мм |
| `material` | string | `""` | материал |
| `type` | string | `"wall"` | тип сущности |
| `chainId` | string | `= id` | id цепочки |
| `locked` | bool | `false` | блокировка |
| `createdAt`/`updatedAt` | number | `Date.now()` | таймстемпы |

### Legacy-слой `pts[]`

- `wall.pts` — **legacy / derived**, НЕ источник истины (см. CLAUDE.md §8).
- Чтение стен для рендера/legacy-API — только через `resolvePlanWalls(plan)`:
  - если `nodes` пуст → возвращает стены с их исходными `pts` как есть (чистый legacy);
  - если есть `nodes` → derive `pts = [nodes[a], nodes[b]]`, добавляет `nodeA/nodeB`.
- Legacy-проекты со стенами `pts[]` без узлов мигрируются в network через
  `ensureWallNetwork` → `migratePtsWallsToNetwork` (дедуп узлов ~1 мм, `NODE_MERGE_MM=1`).

### Ключевые константы

- `NODE_MERGE_MM = 1` (`wallNetwork.js`) — дедуп при миграции pts→network.
- `NODE_LINK_THR = 85` (`core/walls/wallOps.js`) — порог связывания/сварки узлов и
  привязки при commit/mergeCloseNodes.
- `SNAP_VERTEX_RADIUS_MM = 120` (в `wallModel.js` и в `snapEngine.js`).

### Преобразования между форматами (в `normalizePlan`, по порядку)

1. `upgradeLegacyWall` на каждую стену — добавляет недостающие поля, не трогая `pts`.
2. `ensureWallNetwork(plan, uid)` — если план в pts-формате, мигрирует в nodes+рёбра.
3. `mergeCloseNodes(plan, NODE_LINK_THR)` — сваривает близкие узлы, remap рёбер,
   отбрасывает вырожденные/висячие рёбра, `pruneOrphanNodes`.

> Замечание по стабильности id: при миграции pts→network id узлов генерируются через
> `uid()` = `Date.now()+Math.random()` (`src/lib/ids.js`) → **недетерминированы** между
> независимыми нормализациями. Id 2-точечной стены при этом **сохраняется**
> (см. characterization-тест «legacy pts→network»). Стены уже в network-формате
> сохраняют и id узлов, и id рёбер.

---

## 3.3. Комнаты и зоны

- `plan.rooms` — каноничный слой авто-помещений. Модель помещения
  (`core/rooms/syncRooms.js` → `roomModelFromDetection`):
  `id, type:"room", name, category, contourId, polygon, areaMm2, areaM2, heightMm,
  labelPosition, fillColor, visible, locked, climateZone, sanitationZone,
  productionZone, targetTemperatureC, targetRh, targetCo2Ppm, targetAirChanges,
  targetAirVelocityMs, notes`.
- `plan.zones` — совместимый runtime-слой; при normalize остаются только `auto`-зоны
  (`stripManualZones`), затем `zones = rooms.map(roomToZone)`. То есть зоны —
  **derived-проекция** помещений (bbox + метаданные) для legacy-рендера.
- Восстановление identity: `matchRooms(oldRooms, detected)` сопоставляет ранее
  сохранённые помещения с заново детектированными контурами, чтобы имя/категория/
  климат-параметры/labelPosition «переезжали» на тот же контур.
- Что пересчитывается: `polygon`, `areaMm2/areaM2`, `contourId`, `labelPosition`.
  Что сохраняется от предыдущего: `id`, `name`, `category`, климат-поля, `heightMm`,
  `fillColor`, `visible`, `locked`, `notes`.
- Детекция комнат: `detectRooms(plan)` (в `core/rooms/detectRooms.js`) — по стенам.
  `id` помещения детерминирован по геометрии контура (напр. `rm-305-205-24000-1`
  в fixture `rectangle-room`).

> Наблюдение (baseline): на двух комнатах с общей перегородкой (fixture `two-rooms`)
> текущий детектор возвращает **больше двух** контуров (в baseline-прогоне — 4),
> с конечной положительной площадью. Characterization-тест фиксирует `>= 2`, не
> точное число. Это отмечено как кандидат в регрессии (см. §6 / regression #7).

Ошибки детекции: в `normalizePlan` синк комнат обёрнут в `try/catch`, где `catch`
**молча** сбрасывает rooms/zones (потенциальное «проглатывание» ошибок —
regression todo #7).

---

## 3.4. Размеры

`plan.dimensions` нормализуются `normalizeDimensions` → `normalizeLinearDimension`
(`core/dimensions/model.js`). Поля размера:

| Поле | Тип | По умолч. | Смысл |
|---|---|---|---|
| `id` | string | `dim-<n>` | id |
| `type` | string | `"dimension"` | тип |
| `mode` | string | `"linear"` | режим |
| `p1`, `p2` | `{x,y}` | `{0,0}` | концы (мм) |
| `offset` | number | `120` | смещение выноски |
| `orientation` | string | из p1/p2 | `horizontal`/`vertical` |
| `attachedTo` | object/null | `null` | якорь к геометрии |
| `labelOverride` | string/null | `null` | ручная подпись |
| `locked` | bool | `false` | блокировка |
| `invalid` | bool | `false` | не резолвится |
| `auto` | bool | `false` | автоматический |
| `kind` | string | `"manual"` | manual/auto |
| `style` | object/null | `null` | стиль |

**Автоматические** размеры генерируются из стен
(`core/dimensions/generateWallDimensions.js`, `wallDimChains.js`).
**Ручные** — с `kind:"manual"`.

### Якоря `attachedTo` (`resolveAttachedDimension`)

- К стене: `{ type:"wall", wallId|id, segIndex, t0, t1 }` — точки берутся как
  `pointOnSegment(wall.pts[segIndex], wall.pts[segIndex+1], t0|t1)`.
  Требует резолва стены через `resolvePlanWalls` (нужны `wall.pts`).
- К объекту: `{ type:"item", id|itemId, mode:"bbox-width"|"bbox-height" }` —
  берётся из bbox item (`x,y,w,h`).
- Если якорь не резолвится (нет стены/сегмента/item) → `invalid:true`.

Fixture: `manual-dimension.json`. Legacy `measurements`/`rulers` конвертируются в
`dimensions` при отсутствии `raw.dimensions` (`planNormalize.js`).

---

## 3.5. Двери и окна (проёмы)

Двери/окна/проёмы — это **items** (не отдельная коллекция), с `kind` из наборов
`doorTypes` / `OPENING_KINDS` (`openingTypes.js`): `door, door2, door_pivot,
door_cold, door_sanitary, door_gate, window, opening, opening_vent, opening_tech,
opening_serve, opening_arch` и т.п.

Связь со стеной (`doorGeometry.js` → `openingRangesOnSegment`,
`validateOpeningPlacement`):

| Поле item | Смысл |
|---|---|
| `wallId` | id стены, к которой привязан проём |
| `wallSeg` | `{ a:{x,y}, b:{x,y} }` — координаты сегмента стены (снимок) |
| `x, y, w, h` | bbox проёма; центр = `(x+w/2, y+h/2)` |
| `angle` | поворот |
| `doorSwing` | `"left"`/`"right"` (для дверей) |

Положение на стене вычисляется как параметр `t` проекции центра на сегмент.
Фильтрация: если `it.wallId && it.wallId !== wallId` → проём игнорируется для данной
стены; иначе — по геометрической близости (`OPENING_PERP_MAX_MM`).

> Поведение после split (текущее, `wallNetwork.breakWallEdgeAt`): операция создаёт
> новый узел и **новое** ребро для второй половины (новый `wallId`), но НЕ мигрирует
> `item.wallId` проёмов. Проём, оказавшийся на второй половине, сохраняет `wallId`
> исходной (теперь укороченной) стены → фактически «отвязывается». Зафиксировано как
> regression todo #1. Fixture: `door-on-wall.json`.

---

## 3.6. Объекты вертикальной фермы

Создаются `createFarmObject` / нормализуются `normalizePlannerObject`
(`farmObjects.js`). Item фермы (`type:"farm_object"`):
`id, type, category, subtype, name, x, y, widthMm, depthMm, heightMm, rotationDeg,
locked, visible, visibleOnSheets, layer, params, connectionPorts, connections,
label, notes, specRef` + совместимые `w, h, angle`.

- Стеллажи, оборудование, зоны, инженерные объекты — параметрические (`params`).
- Инженерные трассы — `plan.lines` (см. §инж. слои ниже), не farm_object.
- `visibleOnSheets` — на каких листах виден объект.
- `specRef` — ссылка объекта на позицию спецификации (ownership-хук).
- frame drawing / template / preset id: объекты стеллажей могут нести
  `presetId`/preset-параметры (`plannerMaterialPresets.js`, `rackPresetById`),
  а также спец-поля (`defaultObjectSpecSettings`).

### Связь со спецификацией (planner ownership)

`defaultObjectSpecSettings(kind)` (`specSync.js`) добавляет к item поля:
`includedInProject, visibleToClient, approved, specMode
(custom|projectSection|module|material), linkedMaterialId, specModuleName,
specSourceSection, specOutputSection, specQty, specPrice, specComment`.

`createPlannerSpecItems({ plan, materials, modules, existingItems })` разворачивает
объекты/линии/связи в позиции спецификации. Planner-owned позиция имеет:
`source:"planner"`, `sourceKey`, `sourceObjectIds:[itemId...]`. Это и есть
**ownership-метаданные**, которые не должны теряться при нормализации
(fixture `planner-spec-ownership.json`, regression #10 — активный тест).

### Инженерные слои (lines / links)

- `plan.lines` с `layer` (`irrigation`, `drain`, `vent`, `power` …). Для труб
  (`isPipeLine`) `normalizePipe` заполняет `pipeSystem, pipeRole, diameterMm,
  slopePercent` и т.п. Fixture: `engineering-route.json`.
- `syncPlanPipes`, `syncElectricalPlan`, `syncClimatePlan` — финальные проходы
  нормализации, наполняющие derived-слои (`electricalLoads`, `climateLoads`).

---

## 3.7. Сохранение (pipeline)

Фактический путь `UI → normalize → API → JSON → SQLite → load → parse → normalize → render`:

1. **UI/normalize:** `src/pages/admin/PlanPage.jsx` — при загрузке
   `normalizePlan(project?.plan)` (строки ~165–166, 290, 296); при импорте/снапшоте
   тоже `normalizePlan`. Правки идут через planner core, не напрямую в `wall.pts`.
2. **API (save):** проект отправляется на backend; в `backend/src/routes/projects.js`
   план сериализуется: `planner_plan: JSON.stringify(p.plan || {})` (строка ~279),
   колонки `planner_plan, planner_sync_at` (строки ~84–98).
3. **SQLite:** колонка `projects.planner_plan TEXT NOT NULL DEFAULT '{}'`
   (`backend/src/db.js`, `addCol` ~276–277). Отдельной таблицы/схемы для плана нет —
   это один JSON-текст.
4. **Load/parse:** `backend/src/db.js` ~520: `try { plan = JSON.parse(row.planner_plan
   || "{}") } catch { plan = {} }`. То есть **битый JSON молча превращается в `{}`**
   (regression todo #5).
5. **Normalize/render:** фронт снова прогоняет `normalizePlan(plan)` перед рендером.

---

## 3.8. Версионирование

- **`schemaVersion` отсутствует** — ни в `DEFAULT_PLAN`, ни в сохраняемом payload,
  ни где-либо в `src/` или `backend/src/` (grep пуст). Подтверждает гипотезу аудита.
- **Migrations:** `backend/src/migrations/runner.js` + `addCol` в `db.js` мигрируют
  **схему БД (колонки)**, а не JSON плана. Миграции самого plan JSON нет — вся
  «миграция» плана выполняется на лету в `normalizePlan`.
- **Legacy upgrades при normalize:**
  - `upgradeLegacyWall` — дополняет поля стен;
  - `migratePtsWallsToNetwork` — `pts[]` → `nodes`+рёбра;
  - `normalizeLegacyRoomsFromZones` — старые zones → rooms;
  - `measurements`/`rulers` → `dimensions`;
  - `migrateLayerId` — миграция id слоёв у `lines`/`items`;
  - `normalizePipe` — legacy-линии → трубы.
- **Меняются ли IDs:** id узлов при миграции pts→network **пересоздаются** (uid).
  id стен-рёбер (2-точечных) сохраняются; многосегментные pts-стены дробятся на
  `${w.id}_s${i}`. id помещений детерминированы по контуру.
- **Что может потеряться:** ссылки, завязанные на узловые id, у legacy-pts проектов
  (т.к. id узлов новые); привязки проёмов при split (см. §3.5); ownership спец —
  сохраняется (проверено).

---

## Приложение — golden fixtures

| Fixture | Формат | Иллюстрирует |
|---|---|---|
| `rectangle-room` | network | 4 стены → 1 помещение (24 м²), стабильные id |
| `legacy-pts-wall` | legacy pts | миграция pts→network, пересоздание id узлов |
| `t-junction` | network | T-соединение через общий узел |
| `door-on-wall` | network + item | привязка проёма (`wallId`+`wallSeg`) |
| `manual-dimension` | network + dim | якорь размера к стене (`attachedTo`) |
| `two-rooms` | network | общая перегородка, множественная детекция |
| `engineering-route` | line | инж. трасса → труба (`normalizePipe`) |
| `planner-spec-ownership` | item rack | planner-owned позиция спецификации |
