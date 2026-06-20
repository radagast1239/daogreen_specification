# Daogreen Spec v1.0

Конструктор спецификаций вертикальной фермы + клиентский чек-лист закупки.

**Стек:** React + Vite · Node.js API · SQLite (файл `backend/data/daogreen.db`)

## Быстрый старт

### 1. API (терминал 1)

```bash
cd backend
cp .env.example .env    # при необходимости смени ADMIN_KEY
npm install
npm run dev
```

API: http://localhost:3001

### 2. Фронтенд (терминал 2)

```bash
npm install
npm run dev
```

Приложение: http://localhost:5173

При первом входе укажи ключ из `backend/.env` → `ADMIN_KEY` (по умолчанию `daogreen-admin-change-me`).

## Что внутри v1.0

| Функция | Статус |
|---------|--------|
| База 205+ материалов, 21 модуль | ✅ |
| API + SQLite, не localStorage | ✅ |
| Защищённая ссылка `/client/:token` | ✅ |
| Поставщик, фото, тип позиции, НДС-поля | ✅ |
| Зоны + ручные параметры в проекте | ✅ |
| Версии спецификации + дельта клиенту | ✅ |
| Импорт Excel (твой формат) | ✅ |
| Дашборд: без фото/цены, проблемы | ✅ |
| Экспорт Excel / PDF | ✅ |

## Структура

```
backend/           — Express API, SQLite, импорт Excel
src/
  lib/api.js       — HTTP-клиент
  store/           — StoreContext → API
  pages/admin/     — проекты, материалы, импорт
  pages/client/    — закупка по токену
```

## Полное ТЗ

[SPEC.md](./SPEC.md)

## Клиентская ссылка

В редакторе проекта → «Ссылка клиенту». Формат:

```
http://localhost:5173/client/<32-символьный-токен>
```

Токен можно перегенерировать через API `POST /api/projects/:id/regenerate-token`.

## Импорт Excel

Админка → Импорт Excel. Колонки: наименование, ед., кол-во, цена, ссылка, поставщик, категория. Лист = модуль.

## Продакшен

### Репозиторий

https://github.com/radagast1239/daogreen_specification

### Вариант 1 — одна ссылка (рекомендуется, как «просто открыл и работает»)

Старый [калькулятор](https://radagast1239.github.io/daogreen-calculator/) — это чистый HTML без сервера, поэтому хватало GitHub Pages.

**Daogreen Spec** хранит проекты в базе на сервере — нужен backend. Проще всего поднять всё одним сервисом на Render:

1. [Deploy to Render](https://render.com/deploy?repo=https://github.com/radagast1239/daogreen_specification)
2. После деплоя откройте URL вида `https://daogreen-spec.onrender.com`
3. `/login` → ключ `ADMIN_KEY` из настроек Render

Клиентские ссылки: `https://ваш-сервис.onrender.com/client/p/<токен>`

### Вариант 2 — фронт на github.io (как калькулятор)

Фронт: **https://radagast1239.github.io/daogreen_specification/**

Нужны два шага (API отдельно от Pages):

1. **Render** — backend по инструкции выше (только API, тот же репозиторий)
2. **GitHub** → Settings → Pages → Source: **GitHub Actions**
3. **GitHub** → Settings → Secrets → `VITE_API_URL` = `https://ваш-сервис.onrender.com` (без слэша в конце)
4. На Render в `CORS_ORIGIN` добавьте: `https://radagast1239.github.io`

После push в `main` сайт обновится автоматически (workflow `.github/workflows/deploy-pages.yml`).

### Деплой на Render (детали)

1. Открой [Deploy to Render](https://render.com/deploy?repo=https://github.com/radagast1239/daogreen_specification)
2. Подключи GitHub и создай Blueprint из `render.yaml`
3. После деплоя скопируй `ADMIN_KEY` из переменных окружения Render
4. Войди в приложение → `/login` → вставь ключ

Один сервис отдаёт и API, и фронтенд. База SQLite хранится на диске Render (1 GB).

### Локальный продакшен-сборка

```bash
npm run build:all
cd backend
set NODE_ENV=production   # Windows
npm start
```

Открой http://localhost:3001

### Свой сервер

1. Смени `ADMIN_KEY` в `.env`
2. `npm run build:all`
3. `NODE_ENV=production npm start` — Express раздаёт `dist/` и API
4. Для PostgreSQL — замени слой `backend/src/db.js` (схема в SPEC.md)
