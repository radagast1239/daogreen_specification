# База данных

## Сейчас: SQLite

Файл: `backend/data/daogreen.db` (путь через `DATABASE_PATH` в `.env`).

Бэкап: **Настройки → Скачать бэкап** или cron `scripts/backup-cron.sh`.

## PostgreSQL (следующий этап)

План миграции:

1. Поднять PostgreSQL 16 на VPS или managed (Yandex Cloud / Supabase).
2. Экспорт схемы из `backend/src/db.js` → SQL для Postgres (`SERIAL` → `TEXT`, `JSON` columns).
3. Env:
   ```env
   DATABASE_URL=postgresql://user:pass@localhost:5432/daogreen
   DATABASE_DRIVER=postgres
   ```
4. Драйвер: заменить `node:sqlite` на `pg` с тем же API (`prepare/run/all/get`).
5. Одноразовый скрипт `scripts/migrate-sqlite-to-pg.mjs`.

Пока `DATABASE_DRIVER` не задан — используется SQLite (текущее поведение).

## S3 для фото

Env в `backend/.env`:

```env
STORAGE_DRIVER=s3
S3_BUCKET=daogreen-uploads
S3_REGION=ru-central1
S3_ENDPOINT=https://storage.yandexcloud.net
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_PUBLIC_URL=https://cdn.example.com/uploads
```

Без `STORAGE_DRIVER=s3` файлы пишутся в `backend/uploads/` (как сейчас).

Модуль: `backend/src/storage/index.js` — подключение к upload routes в следующем PR.
