# Чистый архив проекта

## Что нельзя включать в архив

| Папка / файл | Причина |
|---|---|
| `node_modules/` | Зависимости — восстанавливаются через `npm install` |
| `backend/node_modules/` | То же для backend |
| `dist/`, `build/` | Сборка — пересобирается через `npm run build` |
| `coverage/` | Отчёты тестового покрытия |
| `.vite/` | Кэш Vite |
| `.git/` | История репозитория — не нужна получателю |
| `.env` | Секреты: ключи, пароли, токены |
| `backend/.env`, `backend/.env.*` | То же для backend |
| `backend/data/*.db`, `*.sqlite` | База данных с реальными данными |
| `backend/uploads/`, `uploads/` | Загруженные пользователями файлы |
| `*.zip` | Старые архивы |
| `tmp*`, `*_backup*`, `*_old*` | Временные файлы и резервные копии |
| `daogreen-spec 1/`, `_planner-kits/`, `_planner-specsync/` | Дублирующие копии проекта |

## Что должно остаться в чистом архиве

```
daogreen-spec/
├── src/                  — исходный код фронтенда
├── backend/src/          — исходный код backend
├── shared/               — общие модули
├── tests/                — тесты
├── public/               — статика
├── docs/                 — документация
├── scripts/              — утилиты
├── import/               — исходники импорта (если есть)
├── .github/              — CI/CD конфиги
├── package.json
├── package-lock.json
├── vite.config.js
├── vitest.config.js
├── .gitignore
├── .env.example          — шаблон переменных окружения
├── backend/.env.example  — шаблон для backend
├── CLAUDE.md
└── README.md
```

## Проверка перед архивированием

```powershell
# 1. Убедиться что тесты проходят
npm test

# 2. Убедиться что git чист (нет незакоммиченных изменений)
git status --short

# 3. Проверить что .env не tracked
git ls-files .env backend/.env

# 4. Проверить что node_modules не tracked
git ls-files node_modules backend/node_modules
```

Если команды 3 и 4 вернули непустой вывод — остановиться и убрать файлы из git.

## Создание чистого архива

Использовать скрипт `scripts/make-clean-archive.ps1`:

```powershell
# Запускать из папки daogreen-spec
cd путь/к/daogreen-spec
.\scripts\make-clean-archive.ps1
```

Архив создаётся рядом с папкой проекта: `../daogreen-spec-clean-ДАТА.zip`

Скрипт **не удаляет** рабочие файлы. Он только упаковывает.

## Восстановление после распаковки

```bash
# Установить зависимости фронтенда
npm install

# Установить зависимости backend
npm install --prefix backend

# Создать .env из шаблона и заполнить
cp .env.example .env
cp backend/.env.example backend/.env

# Запустить тесты для проверки
npm test
```
