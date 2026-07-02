# WORKING_STATE — текущее состояние проекта

Обновлено: 2026-06-30  
Репозиторий: `daogreen-spec` (Daogreen Spec / Daogreen CAD)

---

## Статус проекта

| Область | Состояние |
|---|---|
| Frontend (Vite + React) | Работает локально |
| Backend API (Express + SQLite) | Работает локально |
| Тесты (`npm test`) | **225 passed** (46 файлов, vitest) |
| CAD planner (`src/planner`) | Активная разработка, ядро вынесено в `core/` |
| Спецификации / закупочные листы | Стабильная бизнес-логика в `shared/` |
| Локальная БД | Восстановлена с production-сервера (материалы, поставщики, uploads) |
| Проекты в БД | 0 (на сервере тоже 0) |

### Недавно сделано (в рабочей копии, часть не закоммичена)

- **WALL-BUGFIX-001** — замыкание помещения, dedupe размеров, nudge стен, hit-test по телу стены
- **FIX-AUTH-IDEMPOTENT-001** — идемпотентный `initAdminUsers` в `backend/src/auth.js`
- **RESTORE-DATA-FROM-SERVER** — локальная `daogreen.db` восстановлена из `server-restore-full/`
- Коммит `ea52ad8` — prefer network wall nodes over legacy pts

### Последний стабильный checkpoint (git)

```
ea52ad8  fix: prefer network wall nodes over legacy pts
4541b48  chore: add clean archive workflow
334eb62  checkpoint: stabilize current planner baseline
```

Ветка `main` — **ahead 3** от `origin/main` (локальные коммиты не запушены).

**Важно:** в рабочей копии есть незакоммиченные изменения (planner, auth, tests). Перед деплоем — отдельный checkpoint-коммит.

---

## Как запускать локально

### Предварительно (один раз)

```bash
npm install
npm install --prefix backend
```

Скопировать env-файлы (без реальных секретов в git):

```bash
copy backend\.env.example backend\.env
# опционально для frontend:
copy .env.example .env.local
```

Минимальный `backend/.env`:

- `PORT=3001`
- `DATABASE_PATH=./data/daogreen.db`
- `CORS_ORIGIN=http://localhost:5173`
- `ADMIN_KEY=<свой ключ>`

### Запуск (два терминала)

```bash
# Терминал 1 — API
npm run dev:api

# Терминал 2 — frontend
npm run dev
```

- Frontend: http://localhost:5173  
- API: http://localhost:3001  

### Проверка после правок кода

```bash
npm test
```

При риске для сборки:

```bash
npm run build
```

### Production-like backend

```bash
npm run start          # backend only
npm run build:all      # install + frontend build + backend install
```

---

## Что сейчас в работе

| Задача | Статус |
|---|---|
| WALL-BUGFIX-001 | Реализовано в рабочей копии, тесты зелёные; **не закоммичено** |
| CHECKPOINT после restore + auth fix | Отложен — в индексе смешаны planner + auth |
| PROJECT-DOCS-001 | Создание рабочих документов (`docs/`) |

Следующие логичные шаги (см. `docs/TASK_QUEUE.md`):

- Закоммитить WALL-BUGFIX-001 отдельным коммитом
- Ручная проверка planner по `docs/MANUAL_TESTS.md`
- Мелкие CAD-задачи по snap / objects / dimensions

---

## Что нельзя трогать без отдельной задачи

### Код и конфиг

- `package.json`, `package-lock.json`, `vite.config.js`
- `backend/**` (кроме явно разрешённой задачи)
- `shared/**` при задачах planner
- `PlanPage.jsx` — только точечные правки, без глобального рефакторинга
- Роутинг, формат сохранения проектов, миграции схемы БД

### Данные

- `backend/data/*.db` — **не коммитить**, не удалять без бэкапа
- `backend/uploads/`, `uploads/` — рабочие файлы
- `.env`, `backend/.env` — секреты

### Архитектурные ограничения

- Не писать CAD-логику в React-компонентах
- Не использовать `wall.pts` как source of truth (см. `docs/DECISIONS.md`)
- Не копировать RemPlanner, не делать 3D
- Одна задача = один маленький фикс

### Папки-мусор (не открывать в аудите)

`node_modules/`, `dist/`, `uploads/`, `backend/data/`, `server-restore/`, `local-backup-before-server-restore/`

---

## Полезные ссылки внутри репо

| Документ | Назначение |
|---|---|
| `CLAUDE.md` | Правила для AI-агентов |
| `docs/CAD_ARCHITECTURE.md` | Модель стен, migration path |
| `docs/PLANNER_INVENTORY_003.md` | Инвентарь модулей planner |
| `docs/TASK_QUEUE.md` | Очередь задач |
| `docs/MANUAL_TESTS.md` | Ручные проверки |
| `docs/DECISIONS.md` | Архитектурные решения |
| `backend/docs/DATABASE.md` | БД backend |
