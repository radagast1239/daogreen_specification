# GitHub Pages — настройка

## URL приложения

**https://radagast1239.github.io/daogreen_specification/**

---

## Настройка (один раз)

### 1. Source = ветка `gh-pages`

1. https://github.com/radagast1239/daogreen_specification/settings/pages
2. **Build and deployment** → **Source** → **Deploy from a branch**
3. **Branch** → `gh-pages` → папка **`/ (root)`** → Save

> Не используйте «GitHub Actions» как Source — workflow публикует сборку **в ветку `gh-pages`**, без environment `github-pages` и его protection rules.

### 2. Перезапуск деплоя

https://github.com/radagast1239/daogreen_specification/actions/workflows/deploy-pages.yml  
→ **Run workflow** → branch `main`

Через 1–2 минуты откройте URL выше.

### 3. (Опционально) API

- Secrets → Actions → `VITE_API_URL` = `https://ваш-backend.onrender.com`
- На backend в `CORS_ORIGIN`: `https://radagast1239.github.io`

---

## Если раньше была ошибка environment

```
Branch "main" is not allowed to deploy to github-pages
```

Старый способ (`actions/deploy-pages` + environment `github-pages`) **больше не используется**.  
Достаточно шага 1: Source = **Deploy from a branch** → `gh-pages`.

Окружение `github-pages` в Settings → Environments можно не трогать.

---

## Ссылки

| Что | URL |
|-----|-----|
| Приложение | https://radagast1239.github.io/daogreen_specification/ |
| CI / тесты | https://github.com/radagast1239/daogreen_specification/actions/workflows/ci.yml |
| Деплой | https://github.com/radagast1239/daogreen_specification/actions/workflows/deploy-pages.yml |
| Pages settings | https://github.com/radagast1239/daogreen_specification/settings/pages |

Базовый путь: `/daogreen_specification/` (`vite.config.js`, `GITHUB_PAGES=true`).
