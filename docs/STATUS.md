# Где сейчас Vault и что дальше

**Дата:** 2026-11-15 · **ветка:** `arena/dfcd10d2-vault` · **решения:** [D-125](../decisions/D-125.md), [D-126](../decisions/D-126.md).
**Стадия:** фаза **Ф1 «Ядро продукта и 3D»** активна; первая миссия —
`V-1-1` ([`../tasks/F1/mission.json`](../tasks/F1/mission.json)). Разработка
на локальном ПК через API OpenRouter; деплой — без Docker.

> **Правило Мастера:** любое обновление репозитория завершается **PR + мержем**,
> а не коммитом «просто на ветке».

## 1. Коротко

| Было | Стало |
|---|---|
| разработка в Arena, ИИ условно бесплатен | локальный ПК, `$15` на фазу, факт из `usage.cost` |
| ScriptCat + Notion + Google Drive + ntfy | Git: `tasks/`, `decisions/`, `verdicts/`, `costs/`, доска HTML |
| 219 файлов транспорта, 550 КБ журнала решений | удалены; инварианты перенесены в `docs/PROCESS.md` и D-125 |
| промпт 7500 знаков, маркеры `CF_*` | контекст-пак ≤12 000 токенов, JSON по схеме |
| `bpy` из PyPI + X11-стабы, кадры коммитятся в ветку | нативный Blender 5.3 portable, кадры локально/артефактом CI |
| `docker compose up --build` как «полный стек» | Vercel · Render · Supabase · GitHub Free (D-126), Docker исключён |

Что сделано: `tools/local/` (бюджет, контекст-паки, оркестратор с батчем, доска,
preflight, обёртки Blender/Python), карточки Ф1 в `tasks/`,
`docs/PROCESS.md` как кэшируемый system-prefix, `AGENTS.md` как короткий вход,
CI без `scriptcat` и без `docker`-джобы, `scripts/go-live-check.mjs`,
`docs/DEPLOY-FREE.md` и `docs/TOOLBOX.md`. **Godot из `synapse` не переносится**:
Vault — Telegram Mini App на React/three.js, игровые элементы — серверная логика
и браузерные 3D-сцены, а не отдельный игровой движок.

## 2. Проверки (2026-11-15)

| Команда | Результат |
|---|---|
| `npm run verify` | локальный контур зелёный (32 пробы, доска, контекст-паки, бюджет, `git diff --check`); продуктовые проверки — `SKIP` до `npm ci`, `models:audit` — `KNOWN` |
| `npm run preflight:full` | ожидаемо красный по `models:audit` (долг V-1-1) и при отсутствии `node_modules`; оракул не ослабляется |
| `npm run test:local` | пробы бюджета, контекст-паков, роутинга, доски, Blender, контура без Docker |
| `npm run card:plan -- --card tasks/F1/LOCAL-0-K1.json` | сухой прогон офлайн, `$0` |
| `npm run board` / `board:check` | доска собрана из Git (включая D-126) |
| `npm run budget:report` | `$0 / $15`, план `$13.46` |
| CI | `backend`, `schema` (PostgreSQL 16), `frontend`, `bot`, `local-tools`; джоба `docker` удалена |

Продуктовые джобы CI: типы, смоук-тесты на `pg-mem`, реальная схема на Postgres,
three.js-валидация GLB, сборка, кадры сцен. Образы Docker больше не собираются —
это перестало быть доказательством после D-126.

## 3. Физически в репозитории

```
AGENTS.md                       короткий вход агента / диета контекста / PR+мерж
docs/LOCAL-DEV.md               установка на Win10, первая карточка
docs/LOCAL-DEV-API.md           архитектура контура и экономика
docs/DEPLOY-FREE.md             Vercel/Render/Supabase/GitHub Free без Docker
docs/TOOLBOX.md                 инструменты «на всякий случай»
docs/PROCESS.md                 system-prefix: роли, зоны, оракул, цикл
docs/board/index.html           доска, генерируется из Git
tasks/F1/*.json                 миссия V-1-1 + 7 карточек + LOCAL-0-K1
decisions/D-125.md              миграция; D-126.md — хостинг; LEGACY.md — указатель
verdicts/                       вердикты с evidence (появляются после прогонов)
costs/ledger.jsonl              факт расходов (коммитится)
tools/local/                    оркестратор, бюджет, контекст, доска, preflight
tools/modeling/blender-version.json  зафиксированный Blender 5.3.0 / запасной 5.2.4 LTS
scripts/go-live-check.mjs       оракул Ф2
docker-compose.yml, Dockerfile'ы  архивная справка, не в активном контуре
```

Продукт без изменений: `backend/`, `frontend/`, `bot/`, `audio/`,
`docs/art-direction.md`, `docs/i18n.md`, `docs/perf-budget.md`, `TZ*.md` (в TZ
добавлен только исторический баннер).

## 4. Открытые вопросы

1. **Бюджет 3D-моделей** — исходная точка V-1-1: `coin.glb` вне бюджета
   (7 текстур при лимите 4), `safe.glb` и `rocket.glb` в бюджете; поэтому
   `npm run modeling:audit` и `preflight:full` красные. Карточки K1/K3/K4/K5
   в `draft` до исправления; платные вызовы на красных гейтах оркестратор не
   допускает.
2. **Хранилище ключей на mainnet** — рекомендация: аппаратный кошелёк +
   ручное подтверждение крупных выплат; testnet уже решён (ручная подпись).
3. **Хостинг выбран (D-126)** — `$0` на разработке/testnet: Vercel + Render +
   Supabase + GitHub Free, Docker исключён. Открытым остаётся только
   **152-ФЗ / локализация данных для РФ-аудитории** перед реальными игроками,
   плюс проверка лимитов Free (cold start, пауза Supabase, Redis-локи) в Ф2.
   Российские площадки в `docs/costs.md` — fallback.
4. **Точные slug'ы моделей OpenRouter** — заполняются Мастером в локальном
   `.env` из каталога провайдера; алиасы v3 зафиксированы в `tools/local/models.json`.

## 5. Честно про визуал

Числа (`audit_glb.py`, `validate_glb.mjs`, `npm test`) не видят чёрного кадра,
уехавшей камеры и «продукт или примитив». Кадры снимаются локально
(`cd frontend && npm run eyes`) и в CI, но решение о качестве остаётся за
Мастером: это единственный гейт, который нельзя автоматизировать.
