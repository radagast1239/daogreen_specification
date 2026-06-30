# GitHub Pages — настройка и типичные ошибки

## URL после успешного деплоя

**https://radagast1239.github.io/daogreen_specification/**

---

## Шаг 1 — включить Pages (Source: GitHub Actions)

1. https://github.com/radagast1239/daogreen_specification/settings/pages
2. **Build and deployment** → **Source** → **GitHub Actions**

---

## Шаг 2 — разрешить ветку `main` в environment `github-pages`

Если в Actions видите:

```
Branch "main" is not allowed to deploy to github-pages due to environment protection rules.
The deployment was rejected or didn't satisfy other protection rules.
```

Это **не ошибка кода** — сработали правила окружения `github-pages`.

### Исправление (1 минута)

1. Откройте: https://github.com/radagast1239/daogreen_specification/settings/environments
2. Нажмите **github-pages**
3. Блок **Deployment branches and tags**:
   - выберите **All branches** (проще всего), **или**
   - **Selected branches and tags** → **Add branch or tag** → введите `main` → **Add**
4. Блок **Environment protection rules** (если есть):
   - **Required reviewers** — **выключите** (для личного репо не нужно), иначе каждый деплой ждёт ручного approve
   - **Wait timer** — выключите
5. **Save protection rules**

### Перезапуск деплоя

https://github.com/radagast1239/daogreen_specification/actions/workflows/deploy-pages.yml  
→ **Run workflow** → branch `main`

---

## Шаг 3 (опционально) — API для фронта

1. Settings → Secrets and variables → Actions → **New repository secret**
2. Имя: `VITE_API_URL`, значение: `https://ваш-backend.onrender.com` (без `/` в конце)
3. На backend в `CORS_ORIGIN` добавьте: `https://radagast1239.github.io`

---

## Диагностика по логам

| Ошибка | Причина | Решение |
|--------|---------|---------|
| `404` на github.io | Pages не включены или деплой не прошёл | Шаги 1–2 |
| `Failed to create deployment (404)` | Source ≠ GitHub Actions | Шаг 1 |
| `main is not allowed to deploy` | Environment protection | Шаг 2 |
| `Required reviewers` / pending | Ждёт approve | Шаг 2, отключить reviewers |

---

## Ссылки

| Что | URL |
|-----|-----|
| Приложение | https://radagast1239.github.io/daogreen_specification/ |
| CI / тесты | https://github.com/radagast1239/daogreen_specification/actions/workflows/ci.yml |
| Деплой | https://github.com/radagast1239/daogreen_specification/actions/workflows/deploy-pages.yml |
| Environment | https://github.com/radagast1239/daogreen_specification/settings/environments |

Базовый путь сборки: `/daogreen_specification/` (`vite.config.js`, `GITHUB_PAGES=true`).

## Локально

```bash
npm install
npm run dev
```

→ http://localhost:5173
