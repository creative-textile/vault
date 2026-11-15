# Среды и контуры проверки

**Версия 2.1 · 2026-11-15 · решение [D-126](../decisions/D-126.md).**
Раньше здесь описывалось, чего агент Arena не может без вашего Docker. Теперь
источник правды — локальные проверки, CI на GitHub Actions и бесплатный облачный
контур. **Docker не используется ни локально, ни в CI.**

## 1. Три контура

| Контур | Где | Что проверяет | Docker |
|---|---|---|---|
| **Локальный (основной)** | Win10, 6 ГБ RAM | `npm run verify`, типы, `pg-mem`-тесты, GLB-аудит, кадры сцен, Blender | **нет** |
| **CI (обязательный)** | GitHub Actions / GitHub Free | то же на чистой машине + PostgreSQL 16 + сборка frontend/bot | **нет** |
| **Облачный тест/превью (Ф2)** | Vercel + Render + Supabase | HTTPS-ссылка для телефона, долгоживущий API/бот, managed Postgres | **нет** |

Полная карта сервисов, переменных и шаблон `render.yaml` —
[`DEPLOY-FREE.md`](DEPLOY-FREE.md). Инструменты, которые можно быстро доставить, —
[`TOOLBOX.md`](TOOLBOX.md). `docker-compose.yml` и Dockerfile'ы остались в
репозитории как архивная справка, но в CI больше не собираются.

## 2. Что считается «проверено»

| Изменение | Минимальная проверка |
|---|---|
| Логика денег, игры, API | `cd backend && npm test` (pg-mem) + `npx tsc --noEmit` |
| Схема БД | CI job `schema`: `init.sql` дважды + `schema-check.sql` на PostgreSQL 16 |
| Frontend | `npx tsc --noEmit`, `npm test`, `npm run build` |
| 3D-модели | `npm run modeling:audit` + `node tools/modeling/validate_glb.mjs <файл>` |
| Визуал сцен | `cd frontend && npm run eyes`, PNG открыть глазами |
| Процесс и деньги | `npm run verify`, `npm run board:check`, `npm run budget:report` |
| Образы Docker | **не проверяются и не собираются** (D-126) |

`SKIP` в выводе `preflight` (нет `node_modules`) — **не pass**, `KNOWN` — тоже не
pass (записанный долг `coin.glb`). `not run`, тайм-аут, мок и «у меня запустилось»
доказательством не являются.

## 3. Тестовая база

Смоук-тесты денег и игр работают на `pg-mem` без живой БД. Настоящая схема
проверяется в CI на PostgreSQL 16. Если нужно прогнать её вручную, используйте
**удалённый Supabase Free-проект** (SQL-редактор либо `psql` со строкой
`DATABASE_URL`) — локальный сервер PostgreSQL на ноутбуке не поднимаем:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/src/db/init.sql          # дважды
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/src/db/schema-check.sql
```

`supabase start` **не применяется**: локальный стек Supabase CLI требует Docker
([документация](https://supabase.com/docs/guides/local-development)). Допустимы
`npx supabase link` и `npx supabase db push` против удалённого проекта. Строка
подключения — секрет: только в локальном `.env` / GitHub Secrets / Render, не в
Git, не в чате, не в логах. Боевая база локально не подключается.

## 4. Деплой

1. **Разработка/тест:** фронтенд — Vercel (preview на каждый PR), API и бот —
   Render Free web service (Express + socket.io не живут в serverless), база —
   Supabase Free, проверки — GitHub Actions. Всё на бесплатных тарифах, `$0`.
2. **Redis:** переменная необязательна, код имеет fallback; решение о
   распределённых локах — Ф2.
3. **Прод:** тот же контур до первых реальных игроков. Перед этим отдельно
   решается вопрос 152-ФЗ/локализации данных для РФ-аудитории; российские
   площадки из [`costs.md`](costs.md) — **fallback, а не активный выбор**.
4. **Секреты:** только в хранилищах платформ и GitHub Secrets.

## 5. Godot

В `synapse` был Godot, но Vault — Telegram Mini App на React/three.js, а не игра
на движке. Godot в контур не переносится; см. [`DEPLOY-FREE.md`](DEPLOY-FREE.md) §7.
