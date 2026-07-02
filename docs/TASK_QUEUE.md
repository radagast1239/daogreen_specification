# TASK_QUEUE — очередь задач

Формат задачи: одна цель, 1–5 файлов, понятные тесты, отчёт по шаблону из `CLAUDE.md`.

Приоритет: **P0** критично · **P1** важно · **P2** можно отложить

---

## CAD walls / dimensions

| ID | Приоритет | Задача | Статус |
|---|---|---|---|
| WALL-BUGFIX-001 | P0 | Замыкание помещения, dedupe размеров, nudge стен, hit-test по телу | **done** (нужен commit) |
| WALL-SELECT-002 | P1 | Двойной клик — выделение контура / цепочки стен | backlog |
| WALL-DIM-EDIT-001 | P1 | Редактирование длины стены по введённому размеру | backlog |
| WALL-JOIN-001 | P2 | Улучшение T/X-стыков и miter в сложных узлах | backlog |
| DIM-DEDUP-002 | P2 | Проверить dedupe на L-образных и многосегментных контурах | backlog |
| ROOM-AUTO-001 | P2 | Стабильность auto-zones после move/nudge стен | backlog |

**Разрешённые файлы (типично):** `wallDraft.js`, `wallCommit.js`, `wallOps.js`, `wallNetwork.js`, `wallRender.jsx`, `generateWallDimensions.js`, `PlanPage.jsx` (точечно), `tests/**`

---

## CAD snap / grid

| ID | Приоритет | Задача | Статус |
|---|---|---|---|
| SNAP-CLOSE-001 | P1 | Визуальный индикатор snap-to-close при замыкании | backlog |
| SNAP-GRID-001 | P2 | Согласовать fine snap (Ctrl) и display.snapRoundMm | backlog |
| SNAP-T-001 | P2 | T-стык: стабильный snap при черновике стены | backlog |
| SNAP-OBJ-001 | P2 | Snap объектов к стенам / сетке без sticky-артефактов | backlog |

**Разрешённые файлы (типично):** `core/snap/**`, `plannerSnap.js`, `objectSnap.js`, `draftSnap.js`, `tests/coreCadSnap.test.js`

---

## CAD objects

| ID | Приоритет | Задача | Статус |
|---|---|---|---|
| OBJ-PLACE-001 | P1 | Preview размещения: валидация вне стены / вне зоны | backlog |
| RACK-AISLE-001 | P2 | Размеры проходов между стеллажами — UI warning | backlog |
| OBJ-NUDGE-001 | P2 | Единый шаг стрелок для объектов и стен (display.arrowStepMm) | backlog |
| LINK-001 | P2 | Связи между объектами на инженерных слоях | backlog |

**Разрешённые файлы (типично):** `farmObjects.js`, `placementPreview.js`, `rackSnap.js`, `tests/farmObjects.test.js`

---

## Spec / materials

| ID | Приоритет | Задача | Статус |
|---|---|---|---|
| SPEC-EXPORT-001 | P2 | Регрессия PDF/Excel после изменений каталога | backlog |
| MAT-PRESET-001 | P2 | Material presets в planner ↔ spec modules | backlog |
| PURCHASE-MERGE-001 | P2 | Проверка merge закупочных листов | backlog |
| CLIENT-PDF-001 | P2 | Мета и шрифты в client PDF export | backlog |

**Запрещено при planner-задачах:** менять `shared/**` без явного запроса

**Разрешённые файлы (типично):** `shared/*.js`, `src/lib/*Export*.js`, `tests/purchaseMerge.test.js`, `tests/clientPdfExportMeta.test.js`

---

## Backend / data

| ID | Приоритет | Задача | Статус |
|---|---|---|---|
| FIX-AUTH-IDEMPOTENT-001 | P0 | Идемпотентный seed admin users | **done** (нужен commit) |
| RESTORE-DATA-002 | P1 | Документировать процедуру restore с VPS | backlog |
| BACKUP-AUTO-001 | P2 | Регулярный backup `backend/data/` вне git | backlog |
| PROJECTS-API-001 | P2 | CRUD проектов (сейчас 0 в БД) | backlog |
| POSTGRES-001 | P3 | Миграция SQLite → PostgreSQL (этап 2) | backlog |

**Правило:** `backend/data/*.db` не коммитить. Любая работа с БД — только с бэкапом.

---

## UI / client

| ID | Приоритет | Задача | Статус |
|---|---|---|---|
| PLANNER-UI-001 | P2 | Properties panel: pinned mode / tabs | backlog |
| WARNINGS-001 | P2 | Панель ошибок planner ↔ validation warnings | backlog |
| CLIENT-LIST-001 | P2 | Группы категорий в клиентском списке | backlog |
| PAGES-DEPLOY-001 | P3 | GitHub Pages / VPS deploy docs актуализация | backlog |

**Запрещено без задачи:** глобальный CSS (`theme.css`, `planner.css`), рефакторинг роутов

---

## Документация / процесс

| ID | Приоритет | Задача | Статус |
|---|---|---|---|
| PROJECT-DOCS-001 | P1 | Рабочие документы `docs/` | **in progress** |
| CHECKPOINT-001 | P1 | Git checkpoint после WALL-BUGFIX + auth | backlog |

---

## Как брать задачу в работу

1. Выбрать одну строку из таблицы.
2. Сформулировать: Goal, Files allowed, Files forbidden, Tests, Report.
3. Не смешивать блоки (walls ≠ backend ≠ shared).
4. После выполнения — `npm test`, обновить статус в этом файле.
