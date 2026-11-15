# Где сейчас Vault и что дальше

**Дата:** 2026-11-15 · **ветка:** `arena/18e12252-vault` · **решение:** [D-125](../decisions/D-125.md).
**Стадия:** фаза **Ф1 «Ядро продукта и 3D»** активна; первая миссия —
`V-1-1` ([`../tasks/F1/mission.json`](../tasks/F1/mission.json)). Разработка
переведена на локальный ПК и API OpenRouter.

## 1. Коротко

| Было | Стало |
|---|---|
| разработка в Arena, ИИ условно бесплатен | локальный ПК, `$15` на фазу, факт из `usage.cost` |
| ScriptCat + Notion + Google Drive + ntfy | Git: `tasks/`, `decisions/`, `verdicts/`, `costs/`, доска HTML |
| 219 файлов транспорта, 550 КБ журнала решений | удалены; инварианты перенесены в `docs/PROCESS.md` и D-125 |
| промпт 7500 знаков, маркеры `CF_*` | контекст-пак ≤12 000 токенов, JSON по схеме |
| `bpy` из PyPI + X11-стабы, кадры коммитятся в ветку | нативный Blender 5.3 portable, кадры локально/артефактом CI |

Что сделано в миграции: `tools/local/` (бюджет, контекст-паки, оркестратор с
батчем, доска, preflight, обёртки Blender/Python), карточки Ф1 в `tasks/`,
`docs/PROCESS.md` как кэшируемый system-prefix, `AGENTS.md` как короткий вход,
CI без `scriptcat`-джобы и без авто-коммита кадров, `scripts/go-live-check.mjs`
(раньше ссылка была мёртвой).

## 2. Проверки (2026-11-15)

| Команда | Результат |
|---|---|
| `npm run verify` | локальный контур зелёный (31 проба, доска, контекст-паки, бюджет, `git diff --check`); продуктовые проверки — `SKIP` до `npm ci`, `models:audit` — `KNOWN` |
| `npm run preflight:full` | ожидаемо красный по `models:audit` (долг V-1-1) и при отсутствии `node_modules`; оракул не ослабляется |
| `npm run test:local` | пробы бюджета, контекст-паков, роутинга, доски, Blender |
| `npm run card:plan -- --card tasks/F1/LOCAL-0-K1.json` | сухой прогон офлайн, `$0` |
| `npm run board` / `board:check` | доска собрана из Git |
| `npm run budget:report` | `$0 / $15`, план `$13.46` |
| CI | backend, schema (PostgreSQL 16), frontend, bot, local-tools, docker |

Продуктовые джобы CI остались без изменений по составу проверок: типы,
смоук-тесты на `pg-mem`, реальная схема на Postgres, three.js-валидация GLB,
сборка, кадры сцен, образы Docker.

## 3. Физически в репозитории

```
AGENTS.md                       короткий вход агента / диета контекста
docs/LOCAL-DEV.md               установка на Win10, первая карточка
docs/LOCAL-DEV-API.md           архитектура контура и экономика
docs/PROCESS.md                 system-prefix: роли, зоны, оракул, цикл
docs/board/index.html           доска, генерируется из Git
tasks/F1/*.json                 миссия V-1-1 + 7 карточек + LOCAL-0-K1
decisions/D-125.md              решение о миграции; LEGACY.md — указатель старых решений
verdicts/                       вердикты с evidence (появляются после прогонов)
costs/ledger.jsonl              факт расходов (коммитится)
tools/local/                    оркестратор, бюджет, контекст, доска, preflight
tools/modeling/blender-version.json  зафиксированный Blender 5.3.0 / запасной 5.2.4 LTS
scripts/go-live-check.mjs       оракул Ф2
```

Продукт без изменений: `backend/`, `frontend/`, `bot/`, `audio/`,
`docs/art-direction.md`, `docs/i18n.md`, `docs/perf-budget.md`, `TZ*.md`.

## 4. Открытые вопросы

1. **Бюджет 3D-моделей** — исходная точка V-1-1: `coin.glb` вне бюджета
   (7 текстур при лимите 4), `safe.glb` и `rocket.glb` в бюджете; поэтому
   `npm run modeling:audit` и `preflight:full` красные. Карточки K1/K3/K4/K5
   в `draft` до исправления; платные вызовы на красных гейтах оркестратор не
   допускает.
2. **Хранилище ключей на mainnet** — рекомендация: аппаратный кошелёк +
   ручное подтверждение крупных выплат; testnet уже решён (ручная подпись).
3. **Хостинг API** — `$0` на тесте; для РФ-аудитории 152-ФЗ и локальный хостинг
   (`docs/costs.md`). Выбор сервиса — Ф2.
4. **Точные slug'ы моделей OpenRouter** — заполняются Мастером в локальном
   `.env` из каталога провайдера; алиасы v3 зафиксированы в `tools/local/models.json`.

## 5. Честно про визуал

Числа (`audit_glb.py`, `validate_glb.mjs`, `npm test`) не видят чёрного кадра,
уехавшей камеры и «продукт или примитив». Кадры снимаются локально
(`cd frontend && npm run eyes`) и в CI, но решение о качестве остаётся за
Мастером: это единственный гейт, который нельзя автоматизировать.
