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

1. Смени `ADMIN_KEY` в `.env`
2. `npm run build` — статика в `dist/`
3. Раздай `dist/` через nginx, проксируй `/api` и `/uploads` на backend
4. Для PostgreSQL — замени слой `backend/src/db.js` (схема в SPEC.md)
