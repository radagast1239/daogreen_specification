# Production Manifest — 2026-07-07

Документ фиксирует **текущее production-состояние** после read-only server audit (`tmp-server-audit-20260707-1727/`).

**Статус:** snapshot only — ничего не менялось на сервере при составлении.

| | |
|---|---|
| Production URL | https://spec.nikita-daogreen.ru/spec/ |
| Server | `62.233.35.206` (`ruvds-h2pnh`) |
| App path | `/opt/daogreen-spec` |
| Local main (reference) | `168a1b507014eff32299313c0912d89a215da53d` |
| Audit date | 2026-07-07 |

---

## 1. Current production state

### Frontend

| Параметр | Значение |
|----------|----------|
| HTTP `/spec/` | **200 OK** |
| Dist updated | **2026-07-07 13:32 UTC** |
| Index bundle | `index-TGDRMzUj.js` |
| Index HTML SHA256 | `acab50839e118d3f89321e5302cb1612907eb408fc776f2d78b8bfdbc3caeca3` |
| Vendor bundle | `vendor-BaB_WSUd.js` |
| CSS | `index-BbNaS7pr.css` |
| Base path | `/spec/` (подтверждено в `dist/index.html`) |
| Dist size | ~4.7M |
| Dist permissions | `drwxrwxrwx` (777) — **риск** |
| Source commit (deploy artifact) | **168a1b5** — `dist-168a1b5-frame-crabs.tar.gz` в корне app, backup `backups/pre_168a1b5_frontend_20260707_133543/` |

Frontend **соответствует** локальному `main @ 168a1b5` (tarball deploy, не server git).

### Backend

| Параметр | Значение |
|----------|----------|
| Service | `daogreen-spec.service` — **active (running)** |
| Running since | **2026-07-06 09:12 UTC** |
| Node runtime | `/opt/node-v22.16.0-linux-x64/bin/node` |
| WorkingDirectory | `/opt/daogreen-spec/backend` |
| Listen port | **3002** (nginx → proxy) |
| Server git HEAD | `759394239e104c8bc61f0838692b48bb9d951e7a` |
| Server git message | `selective apply 2c5127f attach frame drawings to projects` |
| Server working tree | **dirty** — modified `db.js`, `index.js`, `projects.js`, `frameDrawings.js` + сотни untracked |
| Sync with local `168a1b5` | **НЕТ** — backend code на сервере старше и расходится с local main |

Backend **не обновлялся** до `168a1b5`; работает код от selective deploy ~Jul 6.

### Database

| Параметр | Значение |
|----------|----------|
| Path | `/opt/daogreen-spec/backend/data/daogreen.db` |
| File size | 3.9M (4009984 bytes) |
| Last modified | 2026-07-05 22:32 UTC |
| WAL/SHM | present (`daogreen.db-wal` 894K, `daogreen.db-shm` 32K) |
| API `/api/health` | `materials: 158`, `projects: 6`, `ok: true` |
| Expected counts | materials **158**, projects **6** — **совпадает** |
| Integrity (CLI) | не проверялся — `sqlite3` не установлен на сервере |
| Risk 206 materials | **НЕТ** |
| `dbBackup` in health | **false** |

### Uploads

| Параметр | Значение |
|----------|----------|
| Path | `/opt/daogreen-spec/backend/uploads/` |
| Files | **347** |
| Size | **122M** |
| Types | 272 png, 74 jpg |
| nginx route | `/uploads/` → `http://127.0.0.1:3002/uploads/` |

### Service / nginx / SSL

| Компонент | Статус |
|-----------|--------|
| `daogreen-spec` | enabled, active |
| nginx | enabled, active |
| SSL cert | `spec.nikita-daogreen.ru`, valid until **2026-09-24** (79 days) |
| certbot timer | active, last run 2026-07-07 13:34 UTC |
| Health monitor cron | `*/5 * * * *` → `health-monitor.sh` |
| DB backup cron | `0 3 * * *` → `backup-cron.sh` |

### Known split-deploy state

```
┌─────────────────────────────────────────────────────────┐
│  PRODUCTION (2026-07-07)                                │
├─────────────────────────────────────────────────────────┤
│  dist/          ← 168a1b5 frontend (Jul 7 tarball)  ✅  │
│  backend/src/   ← dirty git @ 7593942 (Jul 6 code)   ⚠️  │
│  daogreen.db    ← 158 mat / 6 proj (Jul 5 mtime)      ✅  │
│  server .git    ← diverged from local main            ❌  │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Why production is split-state

### Frontend: dist из clean worktree

- Frontend деплоился **не через `git pull`**, а через **dist tarball** из чистого checkout `168a1b5`.
- Доказательства: `dist-168a1b5-frame-crabs.tar.gz`, `backups/pre_168a1b5_frontend_20260707_133543/dist_before.tar.gz`, mtime dist Jul 7 13:32.
- Server git HEAD (`7593942`) **не содержит** коммиты `808074b`, `ecfdf39`, `168a1b5`.

### Backend: не синхронизирован с local main

- Последний restart backend: Jul 6 09:12 — selective deploy `808074b` frame racks.
- На сервере modified: `backend/src/db.js`, `index.js`, `routes/projects.js`, `routes/frameDrawings.js`.
- Локальный `main @ 168a1b5` содержит crab fixes и другие изменения, которых **нет** в server git history.

### Поэтому `git pull` на сервере запрещён

| Причина | Детали |
|---------|--------|
| Diverged history | server `7593942` ≠ local `168a1b5` — разные линии коммитов |
| Dirty working tree | сотни untracked + staged/modified файлов |
| Risk to DB/uploads | pull/checkout может затронуть tracked paths или вызвать merge-конфликты в runtime code |
| Split deploy model | production обслуживается tarball/rsync, не git-sync |

**Правило:** на production **никогда** не делать `git pull`, `git reset`, `git checkout`, `git clean`.

---

## 3. Current risks

### Production server

| # | Риск | Уровень | Детали |
|---|------|---------|--------|
| R1 | Server git drift | **HIGH** | HEAD `7593942`, dirty tree, ≠ local main |
| R2 | `dbBackup: false` | **HIGH** | Нет `SUPABASE_*` в env; health loop не видит backup |
| R3 | Split deploy | **MEDIUM** | Frontend 168a1b5 + backend Jul 6 — расхождение feature set |
| R4 | dist permissions 777 | **MEDIUM** | `drwxrwxrwx` на live dist |
| R5 | env backups 644 | **MEDIUM** | `backups/*/backend.env` читаемы |
| R6 | Root password shared | **HIGH** | Пароль root был передан в чат — **ротация обязательна** |
| R7 | sqlite3 missing | **LOW** | Нет CLI для ops-аудита DB |
| R8 | Disk pressure | **MEDIUM** | 57% used; backups ~763M in app + 1.8G `/opt/backups` + archives |
| R9 | Low RAM VPS | **MEDIUM** | 875Mi total |
| R10 | Jul 5 outage history | **LOW** | Connection refused :3002 во время failed deploy |

### Local development

| # | Риск | Уровень | Детали |
|---|------|---------|--------|
| L1 | Active local DB broken | **CRITICAL** | `daogreen.db`: **1 material**, **1 project** (Test) |
| L2 | 206-material backup nearby | **HIGH** | `daogreen.local-206.before-restore.db` — нельзя деплоить |
| L3 | Planner WIP uncommitted | **MEDIUM** | `generateWallDimensions.js` + tests |
| L4 | Untracked deploy scripts | **MEDIUM** | `scripts/_prod_*`, `scripts/_selective_*` |

---

## 4. What must NOT be touched

### Production server (без явного подтверждения)

- `backend/data/daogreen.db` (+ wal/shm) — **production source of truth**
- `backend/uploads/` — 347 файлов, 122M
- `backend/.env` — secrets (содержимое не читать/не менять)
- `backups/` на сервере — rollback points
- Server `.git` — не pull/reset/checkout/clean
- `systemctl restart daogreen-spec` / `nginx`
- `npm run seed` / любые SQL writes
- `chmod` / `chown` / `rm` / `mv` / `cp` на сервере

### Local (до восстановления среды)

- Не коммитить planner WIP (`generateWallDimensions.js`, `wallDimensions.test.js`)
- Не коммитить `scripts/_*`, deploy archives, DB files
- Не запускать `npm run seed` локально
- Не синхронизировать local 206 DB на production

### Операции, запрещённые всегда на production

```
git pull | git reset | git checkout | git clean
npm install | npm ci | npm run build | npm run seed
systemctl restart daogreen-spec | systemctl restart nginx
INSERT/UPDATE/DELETE/VACUUM в SQLite
замена backend/data | замена uploads
```

---

## 5. Safe next steps

Порядок строгий — каждый шаг только после подтверждения предыдущего.

### Step 1 — Security (срочно)

- [ ] **Ротировать root password** на `62.233.35.206` (пароль был в чате)
- [ ] Рассмотреть ротацию `ADMIN_KEY` (prefix мог попасть в journal при старте сервиса)

### Step 2 — Verify production backup (read-only check first)

- [ ] Проверить `/var/log/daogreen-backup.log` — результат cron 03:00
- [ ] Проверить наличие свежих `.db` в `/opt/backups/daogreen/`
- [ ] Подтвердить rollback points:
  - `backups/pre_168a1b5_frontend_20260707_133543/`
  - `backups/daogreen_20260704_221349_after_material_responsibles.db`
  - `backups/uploads_20260704_102134_pre_cleanup.tar.gz`
- [ ] При необходимости — **создать новый verified backup** (отдельная задача с подтверждением)

### Step 3 — Fix `dbBackup=false` (backend env only, с подтверждением)

Вариант A (проще): добавить в `backend/.env`:
```env
LOCAL_BACKUP_DIR=/opt/backups/daogreen
```
Убедиться что каталог существует и cron пишет туда `.db`.

Вариант B: настроить `SUPABASE_URL` + `SUPABASE_SERVICE_KEY`.

После изменения env потребуется **restart service** — только с явным approval.

### Step 4 — Restore local DB

- [ ] Восстановить `backend/data/daogreen.db` из:
  - production backup (`local-backups/daogreen_local_before_live_20260704` — 158 mat), или
  - скачанной prod DB (отдельная задача)
- [ ] **Не использовать** `daogreen.local-206.before-restore.db`
- [ ] Проверить counts: materials=158, projects=6

### Step 5 — Clean local git tree

- [ ] Убрать planner WIP из рабочего дерева (stash / отдельная ветка)
- [ ] Добавить `scripts/_*` в `.git/info/exclude` локально
- [ ] Не коммитить deploy scripts и archives

### Step 6 — Plan backend sync (после steps 1–5)

- [ ] Сравнить server backend src vs `168a1b5` backend (diff по файлам)
- [ ] Решить: selective file deploy vs full backend replace
- [ ] Обязательно: DB backup + uploads backup перед любым backend deploy
- [ ] Тесты: `npm test -- frame`, `client`, `purchase`, full `npm test`

---

## 6. Deploy policy from this state

### Frontend-only deploy

| Условие | Требование |
|---------|------------|
| Источник | **Только clean worktree** на коммите `168a1b5` или новее release tag |
| Сборка | `VITE_BASE_PATH=/spec/ npm run build` локально |
| Доставка | dist tarball / rsync — **не git pull** |
| Pre-deploy | backup текущего dist (`backups/pre_*/dist_before.tar.gz`) |
| Сейчас | **Не нужен** — 168a1b5 frontend уже на production (Jul 7 13:32) |

### Backend deploy

| Условие | Требование |
|---------|------------|
| Когда | Только при явной необходимости синхронизации API с frontend |
| Pre-deploy | backup `daogreen.db` + `uploads/` + `backend/.env` (файл, не содержимое в лог) |
| Post-deploy | restart `daogreen-spec` (с подтверждением) |
| Сейчас | **Не нужен** — API стабилен, health OK |

### DB migration

| Условие | Требование |
|---------|------------|
| Когда | Только при изменении schema в backend code |
| Pre-migration | verified DB backup |
| Сейчас | **Не нужна** — counts совпадают, service stable |
| Проверить | наличие `frame_drawings` table при будущем backend deploy |

### Запрещённые операции на production

```
git pull / git reset / git checkout / git clean / git stash pop
npm install / npm ci / npm run build / npm run seed
systemctl restart (без approval)
любые SQL writes
```

---

## 7. Rollback notes

### Frontend rollback

**Триггер:** новый dist ломает UI / client link / frame constructor.

**Путь:**
```bash
# Только с явным подтверждением — не выполнять автоматически
cd /opt/daogreen-spec
# Вариант A: из backup перед последним deploy
tar -xzf backups/pre_168a1b5_frontend_20260707_133543/dist_before.tar.gz -C dist/
# Вариант B: предыдущий dist tarball
# tar -xzf backups/pre_ecfdf39_frontend_20260706_201721/dist_before.tar.gz -C dist/
```

**Проверка:** `curl -I https://spec.nikita-daogreen.ru/spec/` → 200, bundle hash изменился.

**Restart:** не требуется (static dist через node static).

### Backend rollback

**Триггер:** API errors, 502, import failures после backend deploy.

**Путь:**
```bash
# Только с явным подтверждением
# 1. Восстановить файлы из backups/pre_808074b_*/
#    projects.js.before, db.js.before, frameDrawings.js.before
# 2. systemctl restart daogreen-spec  ← требует approval
# 3. curl https://spec.nikita-daogreen.ru/api/health
```

**Артефакты:** `backups/pre_808074b_frame_racks_20260706_091142/`, `backups/after_808074b_frame_racks_20260706_091219/`

### DB rollback

**Триггер:** потеря данных, wrong counts, corruption.

**Путь:**
```bash
# Только с explicit approval + service stop
# 1. systemctl stop daogreen-spec  ← approval
# 2. cp backups/daogreen_20260704_221349_after_material_responsibles.db backend/data/daogreen.db
# 3. systemctl start daogreen-spec  ← approval
# 4. curl /api/health → materials=158, projects=6
```

**Кандидаты backup (verified counts 158/6):**
- `backups/daogreen_20260704_221349_after_material_responsibles.db` (3.9M)
- `backups/after_808074b_frame_racks_20260706_091219/daogreen.db` (1.9M — проверить counts перед use)

**Никогда:** восстанавливать DB с 206 materials.

---

## Appendix: reference hashes

| Artifact | SHA256 / ID |
|----------|-------------|
| Production `dist/index.html` | `acab50839e118d3f89321e5302cb1612907eb408fc776f2d78b8bfdbc3caeca3` |
| Production `index-TGDRMzUj.js` | `98f97baba06321120bdff2384f3e42cdfd0902d0cd6e7d09d8a124f319d8c922` |
| Local build `index.html` (168a1b5) | `370477832259f40cb12a8f0feec6f5a745b069be3667038fd3bfa2e1cdb67151` |
| Local bundle | `index-yl2JD-uL.js` (different build time — expected) |
| Server git HEAD | `759394239e104c8bc61f0838692b48bb9d951e7a` |
| Local git HEAD | `168a1b507014eff32299313c0912d89a215da53d` |
| `backend/.env` sha256 (server) | `31e72702cbe6e472dcc870c15be3966205beb1c4c171eda0ed58bf458273273f` (presence only) |

---

## Related audit artifacts

| Path | Описание |
|------|----------|
| `tmp-server-audit-20260707-1727/` | Full server read-only audit |
| `tmp-audit-full-20260707-1714/` | Local + comparison audit |
| `docs/PRODUCTION_MANIFEST_20260707.md` | Этот документ |

**Не коммитить** audit folders и этот manifest без явного review.
