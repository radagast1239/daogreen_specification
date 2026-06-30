# CLAUDE.md — Daogreen Spec / Daogreen CAD

Версия: 1.0
Назначение: правила работы Claude Code в проекте `daogreen-spec`.

Главная цель этого файла — экономить токены, не ломать архитектуру и не давать Claude Code превращать маленькую задачу в глобальный рефакторинг.

---

## 0. Project identity

Это не обычный сайт и не просто React-приложение.

Это платформа Daogreen для:

- спецификаций вертикальных ферм;
- клиентских закупочных листов;
- проектных материалов;
- 2D CAD-планировщика вертикальных ферм;
- будущей связки планировщика со спецификацией.

Самый чувствительный модуль: `src/planner` и страница `src/pages/admin/PlanPage.jsx`.

---

## 1. Main working rule

**Одна задача = одно маленькое изменение.**

Запрещено:

- решать несколько задач одновременно;
- делать глобальный рефакторинг;
- “улучшать заодно” соседний код;
- менять UI без прямого запроса;
- менять модель данных без прямого запроса;
- переписывать большие файлы целиком;
- начинать архитектурные изменения самостоятельно.

Если задача кажется большой — остановись и предложи разбить её на маленькие шаги.

---

## 2. Token saving rules

Claude Code должен экономить контекст.

### 2.1. Не читать весь проект

Запрещено без прямого запроса:

- искать по всему проекту;
- делать recursive search от корня;
- открывать все файлы в папке;
- читать большие файлы целиком;
- анализировать архитектуру всего проекта.

### 2.2. Работать только с указанными файлами

Если пользователь указал файлы — работай только с ними.

Если для выполнения задачи нужен другой файл — сначала объясни зачем и попроси разрешение.

### 2.3. Не открывать мусорные папки

Никогда не читать:

- `node_modules/`
- `backend/node_modules/`
- `dist/`
- `build/`
- `coverage/`
- `.git/`
- `uploads/`
- `backend/uploads/`
- `backend/data/`
- `backend/data/backups/`
- `import-sources/`
- `backend/import-sources/`
- `_planner-kits/`
- `_planner-specsync/`
- `daogreen-spec 1/`

### 2.4. Большие файлы открывать только по запросу

Не открывать автоматически:

- `src/pages/admin/PlanPage.jsx`
- `src/planner/ui/PropertiesPanel.jsx`
- `src/planner/canvasPrimitives.jsx`
- `src/pages/admin/ModulesPage.jsx`
- `src/pages/admin/SpecEditorPage.jsx`
- `src/pages/admin/ProjectBuilderPage.jsx`
- `backend/src/routes/projects.js`
- `backend/src/db.js`
- `src/styles/theme.css`
- `src/planner/planner.css`
- `src/data/seedMaterials.js`

Если без большого файла задачу нельзя выполнить — прочитай только нужный фрагмент, а не весь файл.

---

## 3. Safe modes

### 3.1. Default mode

Для большинства задач:

- модель: Sonnet 4.6;
- effort: Low;
- mode: Ask permissions или Auto mode;
- не использовать Bypass permissions.

### 3.2. Plan mode

Использовать Plan mode только когда задача требует плана, но не требует правок.

В Plan mode запрещено менять файлы.

### 3.3. Accept edits

Accept edits допустим только после того, как задача маленькая и понятная.

### 3.4. Bypass permissions

Не использовать для этого проекта.

Причина: проект большой, есть `.env`, backend, deploy-скрипты и данные. Риск случайной порчи выше выгоды.

---

## 4. Required response format

В конце каждой задачи всегда писать:

```text
Files changed:
- ...

Tests:
- ...

Risks:
- ...

Summary:
- ...
```

Если код не менялся — явно написать:

```text
Code changed: no
```

---

## 5. Test rules

После любой правки кода запускать:

```bash
npm test
```

Если правка может повлиять на сборку:

```bash
npm run build
```

Если задача касается backend:

```bash
npm test
npm run build
npm install --prefix backend
```

Если тесты не запускаются из-за окружения, не чинить приложение вслепую. Сначала сообщить ошибку.

---

## 6. Git / archive hygiene

В архив и git не должны попадать:

- `node_modules/`
- `backend/node_modules/`
- `dist/`
- `build/`
- `.env`
- `.env.*`, кроме `.env.example`
- `backend/.env`
- `backend/data/*.db`
- `backend/data/*.sqlite`
- `backend/data/*.json`
- `uploads/`
- `backend/uploads/`
- дубликаты проекта

`.env.example` можно хранить, но без реальных секретов.

---

## 7. Architecture rules

### 7.1. React is UI only

React-компоненты не должны быть CAD-движком.

React может:

- принимать события мыши;
- показывать панели;
- хранить UI-состояние;
- вызывать функции ядра;
- рисовать результат.

React не должен:

- считать пересечения;
- нормализовать стены;
- рассчитывать площади;
- рассчитывать размеры;
- делать snap-логику;
- мутировать CAD-геометрию напрямую.

### 7.2. Pure core

CAD-логика должна жить в:

- `src/planner/core/geometry/`
- `src/planner/core/walls/`
- `src/planner/core/snap/`
- `src/planner/core/grid/`
- `src/planner/core/dimensions/`
- `src/planner/core/rooms/`
- `src/planner/core/history/`

Функции ядра должны быть по возможности pure functions.

---

## 8. Wall data model

Каноническая модель стен:

```text
plan.nodes
plan.walls[].a
plan.walls[].b
```

`wall.pts` — только legacy / derived слой.

Правила:

- новый код не должен использовать `wall.pts` как источник истины;
- новый код должен читать стены через `resolvePlanWalls(plan)`;
- прямая запись в `wall.pts` запрещена;
- все изменения стен должны идти через `wallNetwork`, `wallOps` или отдельные wall operations;
- legacy-проекты с `wall.pts` должны продолжать открываться.

Если задача требует изменения модели стен — остановись и запроси подтверждение.

---

## 9. Planner modules map

### 9.1. Planner page

Главная страница:

```text
src/pages/admin/PlanPage.jsx
```

Это большой оркестратор. Не открывать и не менять без прямого запроса.

### 9.2. Wall files

Основные файлы стен:

- `src/planner/wallNetwork.js`
- `src/planner/wallGeometry.js`
- `src/planner/wallJoins.js`
- `src/planner/wallRender.jsx`
- `src/planner/wallDraftOverlay.jsx`
- `src/planner/wallEditOverlay.jsx`
- `src/planner/buildWallGeometry.js`
- `src/planner/core/walls/wallCommit.js`
- `src/planner/core/walls/wallDraft.js`
- `src/planner/core/walls/wallJoins.js`
- `src/planner/core/walls/wallModel.js`
- `src/planner/core/walls/wallNormalize.js`
- `src/planner/core/walls/wallOps.js`
- `src/planner/core/walls/wallRender.js`

Менять wall-файлы осторожно. После любой правки запускать wall-related tests и полный `npm test`.

### 9.3. Snap files

- `src/planner/core/snap/snapEngine.js`
- `src/planner/core/snap/snapPriority.js`
- `src/planner/core/snap/snapTypes.js`
- `src/planner/core/snap/angleSnap.js`
- `src/planner/plannerSnap.js`
- `src/planner/objectSnap.js`
- `src/planner/snapContour.js`
- `src/planner/draftSnap.js`

Snap не должен переезжать в UI.

### 9.4. Dimension files

- `src/planner/core/dimensions/generateWallDimensions.js`
- `src/planner/core/dimensions/runtime.js`
- `src/planner/core/dimensions/wallDimChains.js`
- `src/planner/dimensionMarkers.jsx`
- `src/planner/dimensionProperties.js`
- `src/planner/clearanceDims.js`

Размеры не должны становиться источником истины. Они зависят от геометрии.

### 9.5. Rooms

- `src/planner/core/rooms/detectRooms.js`
- `src/planner/core/rooms/syncRooms.js`
- `src/planner/core/rooms/validateRooms.js`
- `src/planner/roomZones.js`
- `src/planner/serviceZones.js`

Помещения выводятся из стен и зон. Не хранить противоречивую геометрию.

### 9.6. Farm objects

- `src/planner/farmObjects.js`
- `src/planner/farmRules.js`
- `src/planner/rackProperties.js`
- `src/planner/tankProperties.js`
- `src/planner/pipes.js`
- `src/planner/electrical.js`
- `src/planner/climate.js`

Объекты должны быть параметрическими.

---

## 10. Specification / business logic

Сильная часть проекта — спецификации и закупочные листы.

Важные файлы:

- `shared/clientSections.js`
- `shared/materialModules.js`
- `shared/materialFarmSections.js`
- `shared/stellageComposition.js`
- `shared/projectReadiness.js`
- `shared/purchaseMerge.js`
- `shared/publishRules.js`
- `src/lib/clientPdfExport.js`
- `src/lib/clientExcelExport.js`
- `src/lib/pdfExport.js`
- `src/lib/exportXlsx.js`

Не менять эти файлы при задачах планировщика, если пользователь явно не просит.

---

## 11. Backend rules

Backend находится в:

```text
backend/src
```

Крупные рискованные файлы:

- `backend/src/routes/projects.js`
- `backend/src/db.js`

Не делить и не рефакторить их без отдельной задачи.

Не трогать auth, tokens, uploads, database migrations без прямого запроса.

Не выводить секреты в лог.

Не добавлять публичную раздачу новых папок без проверки безопасности.

---

## 12. Security rules

Никогда не печатать реальные значения:

- `ADMIN_KEY`
- токены клиента;
- приватные URL;
- DB paths;
- SSH пароли;
- API keys.

Если найден секрет — написать только название переменной и рекомендацию поменять его.

---

## 13. Task size rules

Хорошая задача:

- меняет 1–3 файла;
- имеет понятную проверку;
- не требует глобального поиска;
- не меняет архитектуру;
- завершается за 15–60 минут.

Плохая задача:

- “переделай планировщик”;
- “исправь стены полностью”;
- “сделай как RemPlanner”;
- “проведи аудит всего проекта”;
- “оптимизируй всё”.

Если задача плохая — остановись и предложи 3–5 маленьких шагов.

---

## 14. How to inspect code cheaply

Перед чтением файла:

1. Проверь, нужен ли он точно.
2. Если файл большой — читай фрагмент по поиску функции.
3. Не читай весь файл ради одного импорта.
4. Не ищи по проекту, если можно открыть конкретный файл.
5. Не открывай тесты все сразу — сначала только тест нужного модуля.

---

## 15. How to modify code

Перед правкой:

1. Назови файлы, которые планируешь менять.
2. Убедись, что это не запрещенные большие файлы.
3. Сделай минимальный diff.
4. Не форматируй весь файл.
5. Не меняй стиль соседнего кода.
6. Не добавляй зависимости без прямого запроса.
7. После правки запусти тесты.

---

## 16. Required tests by area

При правках стен:

```bash
npm test -- wall
npm test
```

При правках snap:

```bash
npm test -- snap
npm test
```

При правках размеров:

```bash
npm test -- dimension
npm test
```

При правках комнат:

```bash
npm test -- room
npm test
```

При правках спецификаций:

```bash
npm test -- purchase
npm test
```

Если фильтр не поддерживается, запусти полный `npm test`.

---

## 17. Current known project state

На момент создания этого файла:

- тестовый набор: 43 файла, 200 тестов;
- `PlanPage.jsx` очень большой и рискованный;
- каноническая модель стен — `nodes + wall.a/b`;
- `wall.pts` — legacy/derived;
- есть документация `docs/CAD_ARCHITECTURE.md` и `docs/PLANNER_INVENTORY_003.md`;
- проект уже содержит planner core;
- запрещено возвращать новую логику стен обратно в React.

---

## 18. Claude must not do these things

Никогда не делать без прямого разрешения:

- удалять файлы;
- менять package.json;
- менять package-lock.json;
- менять vite config;
- менять backend auth;
- менять deploy scripts;
- менять `.env`;
- менять database schema;
- менять migrations;
- менять PlanPage.jsx целиком;
- переносить код между модулями;
- переписывать CSS глобально;
- добавлять библиотеки;
- создавать новый state manager;
- менять роутинг;
- менять формат сохраненных проектов.

---

## 19. If user asks to audit

Не читать весь проект сразу.

Сначала спросить scope:

- planner only?
- backend only?
- specifications only?
- one module?

Если scope задан — работать только в нем.

---

## 20. If user asks to continue plan

Продолжать строго по маленьким задачам.

Формат задачи:

```text
TASK-XXX
Goal:
Files allowed:
Files forbidden:
Steps:
Tests:
Report:
```

---

## 21. Final instruction

Ты исполнитель маленькой задачи, а не архитектор всего проекта.

Если возникает желание “сначала разобраться во всём проекте” — не делай этого.

Если возникает желание “улучшить заодно” — не делай этого.

Если возникает желание “переписать нормально” — остановись.

Сделай только то, что попросили.
