# GitHub Pages — почему 404 и как включить

## Симптом

Открываете https://radagast1239.github.io/daogreen_specification/ — видите:

> **404** — There isn't a GitHub Pages site here.

## Причина (проверено 2026-06-30)

Workflow **Deploy GitHub Pages** запускается, job `build` **успешен**, job `deploy` **падает**:

```
Failed to create deployment (status: 404)
Ensure GitHub Pages has been enabled:
https://github.com/radagast1239/daogreen_specification/settings/pages
```

API `GET /repos/.../pages` → **404** — Pages в репозитории **не включены**.

## Одноразовая настройка (2 минуты)

1. Откройте: https://github.com/radagast1239/daogreen_specification/settings/pages

2. **Build and deployment** → **Source** → выберите **GitHub Actions** (не «Deploy from a branch»).

3. Перезапустите деплой:
   - https://github.com/radagast1239/daogreen_specification/actions/workflows/deploy-pages.yml
   - **Run workflow** → branch `main` → Run

4. (Опционально) Secret для API:
   - Settings → Secrets and variables → Actions
   - `VITE_API_URL` = `https://ваш-backend.onrender.com` (без `/` в конце)
   - На backend в `CORS_ORIGIN` добавьте: `https://radagast1239.github.io`

## После успешного деплоя

| Что | URL |
|-----|-----|
| Приложение (фронт) | https://radagast1239.github.io/daogreen_specification/ |
| CI / тесты | https://github.com/radagast1239/daogreen_specification/actions/workflows/ci.yml |
| Деплой Pages | https://github.com/radagast1239/daogreen_specification/actions/workflows/deploy-pages.yml |

Базовый путь сборки: `/daogreen_specification/` (см. `vite.config.js`, `GITHUB_PAGES=true`).

## Локально без Pages

```bash
npm install
npm run dev
```

→ http://localhost:5173 (нужен backend на :3001 для API).
