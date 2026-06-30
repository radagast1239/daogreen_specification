# ЗАДАЧА 003 — Инвентаризация стен, snap и размеров

Дата: 2026-06-30  
Проект: `daogreen-spec`  
Код приложения **не изменялся** — только анализ.

---

## A. Таблица файлов

### Стены (модель, операции, геометрия, рендер)

| Файл | За что отвечает | Риск изменения |
|------|-----------------|----------------|
| `src/planner/wallNetwork.js` | **Граф стен**: `plan.nodes` + рёбра `wall.a`/`wall.b`; `resolvePlanWalls`, `commitWallEdge`, `movePlanNode`, drag/split/merge | **high** |
| `src/planner/core/walls/wallModel.js` | Нормализация wall-объекта, `createWallChain` (pts-цепочка) | medium |
| `src/planner/core/walls/wallCommit.js` | Коммит цепочки в план (`commitWallChain`), миграция pts → network | **high** |
| `src/planner/core/walls/wallNormalize.js` | Слияние узлов, пересечения, `normalizeWalls` | **high** |
| `src/planner/core/walls/wallOps.js` | Геометрия: `resolveWallPtsList`, snap к стенам, split, weld, длины сегментов | **high** |
| `src/planner/core/walls/wallDraft.js` | Draft цепочки при рисовании (pts в памяти, не в plan) | low |
| `src/planner/core/walls/wallJoins.js` | Re-export joins/normalize | low |
| `src/planner/core/walls/wallRender.js` | Геометрия outline для размеров (точки на грани стены) | medium |
| `src/planner/core/walls/index.js` | Barrel export ядра стен | low |
| `src/planner/wallGeometry.js` | Deprecated re-export → `core/walls` | low |
| `src/planner/buildWallGeometry.js` | Miter/slabs, полигоны стен для SVG | **high** |
| `src/planner/wallRender.jsx` | Отрисовка стен (заливка, контуры, активная стена) | **high** |
| `src/planner/wallParallelGeometry.js` | Параллельные линии, inward normal, толщина | medium |
| `src/planner/wallCollision.js` | Коллизии стен с точкой/сегментом | medium |
| `src/planner/wallJoins.js` | Deprecated → core | low |
| `src/planner/wallTypes.js` | Типы/константы стен | low |
| `src/planner/wallToolPresets.js` | Пресеты инструмента стены | low |
| `src/planner/wallDraftOverlay.jsx` | UI draft-линии при рисовании | medium |
| `src/planner/wallEditOverlay.jsx` | Ручки узлов, углы, nudge при выделении | medium |
| `src/planner/wallDimChains.js` | Deprecated → `core/dimensions` | low |
| `src/planner/planNormalize.js` | Нормализация плана при загрузке, `ensureWallNetwork` | **high** |
| `src/pages/admin/PlanPage.jsx` | **Оркестратор**: создание, drag, snap, рендер, history | **high** |

### Snap / магнит

| Файл | За что отвечает | Риск изменения |
|------|-----------------|----------------|
| `src/planner/core/snap/snapEngine.js` | **Единый snap-движок** `runSnapEngine` (vertex, wall, grid, angle) | **high** |
| `src/planner/core/snap/snapTypes.js` | Типы snap, цвета | low |
| `src/planner/core/snap/snapPriority.js` | Приоритет кандидатов snap | medium |
| `src/planner/core/snap/angleSnap.js` | Угловой snap 0/45/90… | medium |
| `src/planner/core/snap/index.js` | Barrel export | low |
| `src/planner/plannerSnap.js` | Snap линий/трасс/стоек (legacy + line draft) | medium |
| `src/planner/draftSnap.js` | Deprecated → core/snap | low |
| `src/planner/objectSnap.js` | Snap объектов по осям/границам | medium |
| `src/planner/snapContour.js` | Snap по контуру комнаты/рулетке | medium |
| `src/planner/core/grid/gridSnap.js` | Привязка к шагу сетки, Alt → 1 мм | low |
| `src/planner/catalog.js` | Функция `snap()` для координат | low |

### Размеры

| Файл | За что отвечает | Риск изменения |
|------|-----------------|----------------|
| `src/planner/core/dimensions/generateWallDimensions.js` | **Авторазмеры** стен, проходы, room chain | **high** |
| `src/planner/core/dimensions/wallDimChains.js` | Цепочки размеров вдоль стен | medium |
| `src/planner/core/dimensions/model.js` | Модель dimension, привязка к wall.pts | medium |
| `src/planner/core/dimensions/runtime.js` | `resolvePlanDimensions` = manual + auto | medium |
| `src/planner/core/dimensions/display.js` | Форматы мм/см/м/remplanner | low |
| `src/planner/core/dimensions/index.js` | Barrel export | low |
| `src/planner/dimensionMarkers.jsx` | **Отрисовка** размерных линий на canvas | **high** |
| `src/planner/dimensionProperties.js` | Свойства ручного размера | low |
| `src/planner/clearanceDims.js` | Зазоры / clearance от объектов до стен | medium |

### Сетка

| Файл | За что отвечает | Риск изменения |
|------|-----------------|----------------|
| `src/planner/core/grid/gridSettings.js` | Уровни сетки 50/100/500/1000, zoom-правила | medium |
| `src/planner/core/grid/gridSnap.js` | Магнит к шагу сетки | low |
| `src/planner/core/grid/index.js` | Barrel export | low |
| `src/planner/gridSettings.js` | Re-export + legacy display prefs | low |
| `src/planner/canvasPrimitives.jsx` | `PlanGridScreen`, отрисовка линий сетки | medium |

### Тесты (опорные, не менять без нужды)

| Файл | Покрывает |
|------|-----------|
| `tests/coreCadWalls.test.js` | normalize, split, weld |
| `tests/coreWalls.test.js` | wallOps |
| `tests/wallToolCadBehavior.test.js` | draft + snap + drag |
| `tests/wallNetwork.test.js` | network graph |
| `tests/wallGeometry.test.js`, `tests/buildWallGeometry.test.js`, `tests/wallRender.test.js` | геометрия/рендер |
| `tests/coreCadSnap.test.js`, `tests/coreSnap.test.js` | snap |
| `tests/coreCadDimensionsRuntime.test.js`, `tests/wallDimChains.test.js`, `tests/wallDimensions.test.js` | размеры |
| `tests/gridSettings.test.js` | сетка |

---

## Ключевые точки по запросу

### 1–3. Стены / snap / размеры

См. таблицы выше.

### 4. Где используется `wall.pts`

| Область | Файлы |
|---------|-------|
| Рендер | `wallRender.jsx`, `canvasPrimitives.jsx`, `wallEditOverlay.jsx` |
| Геометрия | `buildWallGeometry.js`, `core/walls/wallRender.js`, `wallCollision.js`, `geometry.js` |
| Операции | `core/walls/wallOps.js` (split, length, neighbors) |
| Размеры | `generateWallDimensions.js`, `model.js`, `wallDimChains.js`, `dimensionMarkers.jsx` |
| UI/оркестратор | `PlanPage.jsx` (drag preview, selection) |

После `resolvePlanWalls()` у каждой стены **всегда** есть `pts` из двух точек (`nodes[a]`, `nodes[b]`).

### 5. Где `nodes` / `wall.a` / `wall.b`

| Концепция | Файлы |
|-----------|-------|
| `plan.nodes` | `wallNetwork.js`, `PlanPage.jsx`, `snapEngine.js`, `planNormalize.js` |
| `wall.a`, `wall.b` | `wallNetwork.js` (основной), `wallOps.js` (resolveWallPtsList), `wallNetwork.js` move/split |
| `wall.nodeA`/`nodeB` | алиасы в `resolvePlanWalls` |

### 6. Где создаётся новая стена

| Этап | Функция | Файл |
|------|---------|------|
| Draft (клики) | `wallDraftAddSegment`, `wallDraftFinishPts` | `core/walls/wallDraft.js` |
| Коммит в plan | `finishWallChain` → `commitWallChain` | `PlanPage.jsx` → `wallCommit.js` |
| Network edge | `commitWallEdge` | `wallNetwork.js` |
| Legacy pts chain | `createWallChain` + `normalizeWalls` | `wallModel.js`, `wallNormalize.js` |

### 7. Где стена рисуется

| Слой | Файл |
|------|------|
| Slab + outline | `wallRender.jsx` (`WallSlabFill`, `WallFaceOutlines`) |
| Legacy primitive | `canvasPrimitives.jsx` (`WallEl`) |
| Draft | `wallDraftOverlay.jsx` |
| Edit handles | `wallEditOverlay.jsx` |
| Монтаж в PlanPage | `weldedWalls` → слои canvas |

### 8. Где стена редактируется / перемещается

| Действие | Функция | Файл |
|----------|---------|------|
| Drag сегмента | `applyNetworkWallSegMove` | `wallNetwork.js`, вызов из `PlanPage.jsx` |
| Drag узла | `movePlanNode` | `wallNetwork.js` |
| Nudge клавишами | `nudgeWallInPlan` | `wallNetwork.js` → `PlanPage.jsx` |
| Split | `breakWallEdgeAt` / `breakWallAt` | `wallNetwork.js`, `wallOps.js` |
| Delete | `deleteWallEdge` | `wallNetwork.js` |
| Align/straighten | `alignWallEdgeToNeighbor`, `straightenWallEdge` | `wallNetwork.js` |

### 9. Где создаются размеры

| Тип | Где |
|-----|-----|
| **Авто** | `generateWallDimensions()` ← `resolvePlanDimensions()` ← `PlanPage.jsx` useMemo |
| **Ручные (3 клика)** | `PlanPage.jsx` — tool `measure`, `commitManualDimension` → `plan.dimensions` |
| **Отрисовка** | `dimensionMarkers.jsx` |

### 10. Где работает сетка

| Что | Файл |
|-----|------|
| Уровни и zoom | `core/grid/gridSettings.js` |
| Snap к сетке | `core/grid/gridSnap.js` → `snapEngine.js`, `PlanPage.jsx` |
| Отрисовка | `canvasPrimitives.jsx` (`PlanGridScreen`) |
| Настройки UI | `gridSettings.js`, `plannerVisualSettings.js` |

---

## B. Архитектурные выводы

### Источник истины стен сейчас

**Двухрежимная модель:**

1. **Network (целевой):** `plan.nodes` + `plan.walls[]` с полями `a`, `b` (id узлов). Координаты **не хранятся** в wall — вычисляются через `resolvePlanWalls(plan)`.
2. **Legacy pts:** `plan.walls[]` с `pts[]` (полилиния). Используется при старых планах и как промежуточный формат в `commitWallChain`.

Миграция: `ensureWallNetwork` / `migratePtsWallsToNetwork` в `wallNetwork.js`.

### Есть ли конфликт `wall.pts` и `nodes`

**Да, потенциальный.**

| Проблема | Детали |
|----------|--------|
| Два резолвера | `resolvePlanWalls(plan)` (wallNetwork) vs `resolveWallPtsList(walls, nodes)` (wallOps) — похожая логика, разные сигнатуры |
| Разные потребители | PlanPage/snap/dimensions → `resolvePlanWalls`; rooms/clearance/geometry → `resolveWallPtsList` |
| Запись pts в plan | `commitWallChain` в network-режиме всё равно прогоняет pts → migrate; прямое редактирование `wall.pts` в plan **не синхронизирует** `nodes` |
| Полилинии >2 точек | В network каждое ребро = 2 точки; длинная pts-цепочка дробится на рёбра при миграции |

**Правило:** для чтения геометрии всегда использовать резолвер, **никогда** сырой `plan.walls` без `resolvePlanWalls` / `resolveWallPtsList`.

### Какие функции менять первыми (низкий риск)

1. `core/grid/gridSnap.js` — шаг сетки, Alt-round
2. `core/snap/snapTypes.js`, `snapPriority.js` — приоритеты подсказок
3. `core/walls/wallDraft.js` — поведение draft без записи в plan
4. Унификация вызовов: заменить `resolveWallPtsList(plan.walls, plan.nodes)` на `resolvePlanWalls(plan)` в **не-core** модулях (`clearanceDims.js`, `geometry.js`)

### Какие функции не трогать

- `PlanPage.jsx` (явный запрет)
- `planner/core/**` (явный запрет до отдельной задачи)
- `buildWallGeometry.js`, `wallNormalize.js` — легко сломать miter/комнаты
- `dimensionMarkers.jsx` — связка UI + геометрия
- Все `tests/*wall*`, `tests/*snap*`, `tests/*dim*`

---

## C. Рекомендация: с чего начать

**Одно маленькое изменение:** в `clearanceDims.js` и `geometry.js` заменить вызовы `resolveWallPtsList(plan.walls, plan.nodes)` на `resolvePlanWalls(plan)` (один импорт из `wallNetwork.js`).

**Почему:** убирает расхождение двух резолверов без смены модели данных; затрагивает 2 файла вне `core/` и `PlanPage.jsx`; покрыто тестами `wallNetwork` + `wallGeometry`.

**Не начинать с:** рефакторинга `normalizeWalls` или переписывания `PlanPage` drag-логики.

---

## Проверка

```
npm test
```

Ожидание: 43 файла, 200 тестов — pass.
