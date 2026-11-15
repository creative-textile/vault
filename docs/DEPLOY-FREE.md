# Контур без Docker · Vercel · Render · Supabase · GitHub Free

**Решение:** [D-126](../decisions/D-126.md) · **Дата:** 2026-11-15 · **Фаза:** Ф1 (деплой готовится в Ф2).
Сюда же: [`TOOLBOX.md`](TOOLBOX.md) — инструменты, которые можно быстро доставить.

## 1. Почему так

Мастер исключил Docker: на Win10 x64 / i3-7100U / 6 ГБ RAM Docker Desktop съедает
память, ради которой мы и оптимизировали весь локальный контур. Вместо «полного
стека на ноутбуке» — четыре бесплатных сервиса и те же проверки в GitHub Actions.
`docker-compose.yml`, `db/Dockerfile`, `backend/Dockerfile`, `frontend/Dockerfile`,
`bot/Dockerfile` и `frontend/nginx.conf` **остаются в репозитории как архивная
справка**: они больше не собираются в CI и не нужны для локальной работы. Удалить
их можно отдельным ADR, когда станет окончательно ясно, что self-host не вернётся.

## 2. Кто за что

| Сервис | Роль | Что хранит | Стоимость |
|---|---|---|---|
| **GitHub / GitHub Actions** | репозиторий, PR + мерж, CI, Secrets, артефакты кадров | код, задачи, ADR, вердикты, `costs/ledger.jsonl`, доска | Free (на public-репозитории стандартные раннеры бесплатны) |
| **Vercel** | статика фронтенда и preview на каждый PR | `frontend/dist`, `WEBAPP_URL`, публичные переменные | Hobby / Free |
| **Render** | backend API + Telegram-бот: **постоянный процесс** Express + socket.io + node-cron | секреты backend/бота, `DATABASE_URL`, `REDIS_URL` (опц.) | Free web service |
| **Supabase** | managed PostgreSQL 15/16, SQL-редактор, миграции | схема `backend/src/db/init.sql`, данные | Free project |
| **OpenRouter** | вызовы моделей | только запросы/ответы, факт в `usage.cost` | по лимиту `$15`/фазу |

Vercel **не** держит backend: serverless не живёт с WebSocket и cron. Render нужен
именно как долгоживущий процесс. Supabase используется как **удалённый** проект:
`supabase start` поднимает локальный стек через Docker и в нашем контуре
**не применяется** (см. [Local Development & CLI](https://supabase.com/docs/guides/local-development)).

## 3. Переменные окружения

| Переменная | Откуда | Комментарий |
|---|---|---|
| `DATABASE_URL` | Supabase → Project Settings → Database → Connection string | заменяет `localhost:5432` из архивного compose; для боевого контура не должен указывать на localhost |
| `WEBAPP_URL` | Vercel preview/prod URL | HTTPS, без `*` в `ALLOWED_ORIGINS` |
| `ALLOWED_ORIGINS` | домен Vercel | совпадает с `WEBAPP_URL` |
| `JWT_SECRET`, `SECURITY_PEPPER`, `ADMIN_PASSWORD`, `BOT_TOKEN` | GitHub Secrets → Render / локальный `.env` | никогда не в Git |
| `REDIS_URL` | — | **необязателен**: в коде есть fallback на in-process/БД-гварды; на free-тарифе оставляем пустым. Если в Ф2 понадобятся распределённые локи/socket.io-adapter — отдельное решение |
| `OPENROUTER_API_KEY`, `VAULT_MODEL_*` | только локальный `.env` | модели в облако не уезжают: оркестратор запускается на ПК Мастера |

Проверка боевой готовности: `npm run go-live:check` (оракул Ф2). Он теперь
требует `docs/DEPLOY-FREE.md` вместо `docker-compose.yml` и ругается на
`DATABASE_URL` с `localhost`.

## 4. Как это проверяется без Docker

| Проверка | Где | Заменяет |
|---|---|---|
| `npm run verify`, `npm run test:local` | локальный ПК | «поднять всё и посмотреть» |
| `cd backend && npm test` | `pg-mem`, без живой БД | локальный Postgres-контейнер |
| job `schema` | GitHub Actions + `postgres:16` | `db/Dockerfile` |
| `npx tsc --noEmit`, `npm test`, `npm run build` | backend / frontend / bot | сборку образов |
| `npm run eyes` | локальный Chromium / артефакт CI | визуальный осмотр в контейнере |
| `psql "$DATABASE_URL" -f init.sql` (по желанию) | удалённый Supabase | ручной прогон схемы на ноутбуке |

## 5. Шаблон Render Blueprint (не активен до Ф2)

Лежит здесь текстом, а не файлом `render.yaml`, чтобы случайно не подключить
инфраструктуру раньше миссии Ф2. Перед включением проверяется
`render blueprints validate` ([Render CLI](https://render.com/docs/cli)).

```yaml
services:
  - type: web
    name: vault-api
    runtime: node
    plan: free
    buildCommand: cd backend && npm ci && npm run build
    startCommand: cd backend && npm start
    healthCheckPath: /api/health
    envVars:
      - key: DATABASE_URL
        sync: false          # из Supabase, через Dashboard/Secrets
      - key: JWT_SECRET
        sync: false
      - key: REDIS_URL
        sync: false          # опционально
  - type: web
    name: vault-bot
    runtime: node
    plan: free
    buildCommand: cd bot && npm ci && npm run build
    startCommand: cd bot && npm start
    envVars:
      - key: BOT_TOKEN
        sync: false
```

Фронтенд на Vercel собирается из `frontend/` командой `npm run build`; отдельный
`vercel.json` пока не нужен.

## 6. Что осталось открытым

1. **152-ФЗ и география игроков.** Бесплатные зарубежные тарифы не снимают
   вопроса локализации персональных данных для РФ-аудитории. Российские площадки
   (Amvera / Beget) остаются **fallback**, а не активным выбором; прежняя смета
   сохранена в [`costs.md`](costs.md) как архивная справка.
2. **Ограничения Free:** холодные старты, паузы при неактивности, лимит
   соединений/хранения. Проверить на testnet в Ф2 до реальных игроков.
3. **Redis** — см. таблицу выше.
4. **Свой домен, mainnet-ключи, бэкапы/restore** — Ф2/Ф3, решение Мастера.

## 7. Godot

В `synapse` был Godot 4.7.2 и Agent Bridge. **В Vault он не нужен**: это Telegram
Mini App на React + Vite + three.js, игровые механики считаются сервером, а 3D —
браузерные сцены и `.glb` из Blender. Переносить Godot «на всякий случай» нельзя:
лишний движок, экспорт и второй пайплайн ассетов. Если позже понадобится
нативный клиент или отдельная игра — это новый ADR и новая миссия, а не инструмент
быстрой установки.
