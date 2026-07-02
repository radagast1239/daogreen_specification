# DECISIONS — архитектурные решения

Журнал принятых решений. Новый код и задачи должны им соответствовать.  
При конфликте с задачей — остановиться и согласовать изменение решения.

---

## D-001. Source of truth для стен

**Решение:** каноническая модель стен в плане:

```text
plan.nodes           — map: nodeId → { x, y }
plan.walls[].a       — nodeId начала ребра
plan.walls[].b       — nodeId конца ребра
```

**Чтение:** всегда через `resolvePlanWalls(plan)` — возвращает стены с derived `pts` для рендера.

**Запись:** через `wallNetwork` / `wallOps` (`commitWallEdge`, `movePlanNode`, `deleteWallEdge`, …).

**Дата:** зафиксировано в planner core refactor  
**Статус:** активно  
**См. также:** `docs/CAD_ARCHITECTURE.md`, `CLAUDE.md` §8

---

## D-002. wall.pts — legacy / derived

**Решение:** `wall.pts` — **не** источник истины.

- Допустим на старых планах без `nodes`
- На network-планах вычисляется из `a/b + nodes`
- Прямая запись в `wall.pts` в новом коде запрещена
- Legacy-планы должны открываться; миграция: `ensureWallNetwork(plan, makeId)`

**Дата:** planner network model  
**Статус:** активно

---

## D-003. React — только UI, не CAD-движок

**Решение:** геометрия, snap, размеры, нормализация стен — в `src/planner/core/**` (pure functions).

`PlanPage.jsx` — оркестратор событий и состояния UI, не место для расчётов пересечений / площадей / snap.

**Статус:** активно  
**См.:** `CLAUDE.md` §7

---

## D-004. 3D не делаем

**Решение:** планировщик остаётся **2D** (SVG/canvas). Трёхмерная визуализация, BIM, extrude стен — **вне scope**.

`viewMode` в UI — только 2D workflow.

**Причина:** фокус на спецификации вертикальных ферм и 2D планировке, не на CAD-конкуренте.

**Статус:** активно, не пересматривать без отдельного product-решения

---

## D-005. RemPlanner не копируем

**Решение:** не копировать UX/код RemPlanner один в один. Берём идеи (snap, размерные цепочки, wall chain), реализуем в своей модели `nodes + edges`.

Запрещены задачи вида «сделать как RemPlanner» без конкретного маленького scope.

**Статус:** активно

---

## D-006. Данные и БД не коммитим

**Решение:**

| Артефакт | В git |
|---|---|
| `backend/data/*.db` | **Нет** |
| `backend/uploads/`, `uploads/` | **Нет** |
| `.env`, `backend/.env` | **Нет** |
| `.env.example` | Да (без секретов) |
| `node_modules/`, `dist/` | **Нет** |

Восстановление данных — с VPS/бэкапа (`server-restore-full/`, `local-backup-before-server-restore/`), не из git.

**Статус:** активно  
**См.:** `CLAUDE.md` §6, `.gitignore`

---

## D-007. Одна задача = один маленький фикс

**Решение:**

- 1 цель, 1–5 файлов, 15–60 минут
- Без «улучшим заодно» и глобального рефакторинга
- После правки — `npm test`
- Отчёт: Files changed / Tests / Risks / Summary

Большие файлы (`PlanPage.jsx`, `PropertiesPanel.jsx`) — только фрагментарные правки по задаче.

**Статус:** активно  
**См.:** `CLAUDE.md` §1, §13

---

## D-008. Backend — точечные изменения

**Решение:** `backend/src/routes/projects.js`, `db.js`, auth, migrations — не рефакторить без отдельной задачи.

Auth seed (`initAdminUsers`) — идемпотентный upsert, не blind INSERT.

**Статус:** активно

---

## D-009. shared/ — отдельный контур от planner

**Решение:** `shared/clientSections.js`, `materialModules.js`, `purchaseMerge.js` и др. — бизнес-логика спецификаций.

При задачах planner **не менять** `shared/**` без явного запроса.

**Статус:** активно

---

## D-010. Тесты — vitest, обязательны после кода

**Решение:** `npm test` (vitest run) после любой правки кода. Wall/snap/dimension — по возможности targeted tests + полный прогон.

Текущий baseline: **225 tests / 46 files** (2026-06-30).

**Статус:** активно

---

## D-011. commitWallChain через network edges

**Решение:** новая цепочка стен коммитится через последовательные `commitWallEdge`, с флагом `{ closed: true }` для замыкающего сегмента. Узлы сливаются по координатам (`findOrCreateNode`).

**Дата:** WALL-BUGFIX-001  
**Статус:** активно

---

## D-012. Размеры — derived, не source of truth

**Решение:** `generateWallDimensions` строит auto-dimensions из геометрии. Dedupe по пролёту; скрытие артефактов <100 мм для wall-span.

Редактирование геометрии по размеру — отдельная будущая задача (TODO в PlanPage).

**Статус:** активно

---

## Как добавлять новое решение

```markdown
## D-0XX. Краткое название

**Решение:** ...
**Причина:** ...
**Дата:** YYYY-MM-DD
**Статус:** активно | устарело | заменено D-0YY
```

Устаревшее решение не удалять — пометить статус и ссылку на замену.
