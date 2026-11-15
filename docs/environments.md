# Среды и контуры проверки

**Версия 2.0 · 2026-11-15.** Раньше этот документ описывал, чего агент Arena
не может без вашего Docker. Теперь разработка идёт на локальном ПК, и источник
правды — локальные проверки плюс CI.

## 1. Три контура

| Контур | Где | Что проверяет | Docker |
|---|---|---|---|
| **Локальный (основной)** | Win10, 6 ГБ RAM | `npm run verify`, типы, `pg-mem`-тесты, GLB-аудит, кадры сцен, Blender | **нет** |
| **CI (обязательный)** | GitHub Actions | то же на чистой машине + PostgreSQL 16 + сборка всех образов | только в job `docker` |
| **Облачный превью** | Vercel (фронт), тестовый API в Ф2 | HTTPS-ссылка для телефона, поведение на чужом железе | нет |

Полный стек `docker compose up --build` остаётся личным удобством для
сквозного сценария «зашёл → баланс → ставка → выплата». На 6 ГБ RAM не держите
Docker Desktop одновременно с Chromium и Blender.

## 2. Что считается «проверено»

| Изменение | Минимальная проверка |
|---|---|
| Логика денег, игры, API | `cd backend && npm test` (pg-mem) + `npx tsc --noEmit` |
| Схема БД | CI job `schema`: `init.sql` дважды + `schema-check.sql` на PostgreSQL 16 |
| Frontend | `npx tsc --noEmit`, `npm test`, `npm run build` |
| 3D-модели | `npm run modeling:audit` + `node tools/modeling/validate_glb.mjs <файл>` |
| Визуал сцен | `cd frontend && npm run eyes`, PNG открыть глазами |
| Процесс и деньги | `npm run verify`, `npm run board:check`, `npm run budget:report` |
| Образы | только CI |

`SKIP` в выводе `preflight` (нет `node_modules`) — **не pass**. `not run`,
тайм-аут, мок и «у меня запустилось» доказательством не являются.

## 3. Тестовая база

Смоук-тесты денег и игр работают на `pg-mem` без живой БД. Настоящая схема
проверяется в CI на PostgreSQL 16; при необходимости локально — любым Postgres
или облачным тестовым проектом, применяя два файла:

```sh
psql "$DB_URL" -v ON_ERROR_STOP=1 -f backend/src/db/init.sql          # дважды
psql "$DB_URL" -v ON_ERROR_STOP=1 -f backend/src/db/schema-check.sql
```

Строка подключения — секрет: только в локальном `.env` / GitHub Secrets, не в
Git, не в чате, не в логах. Боевая база локально не подключается.

## 4. Деплой

1. Тест: фронтенд — Vercel preview, API и бот — отдельный постоянный процесс
   (Express + socket.io не живут в serverless), база — тестовый Postgres.
2. Прод: VPS с Docker Compose, домен, SSL, бэкапы; решение Мастера, миссия Ф2.
3. Секреты прода — только в хранилище сервера/платформы.

Ограничения для РФ-аудитории и смета — [`costs.md`](costs.md).
