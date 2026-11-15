# AGENTS.md — Vault · локальная разработка через API

**Прочитай этот файл первым.** Он короче `README.md` (62 КБ) и `ARCHITECTURE.md`
(168 КБ) специально: при работе через API контекст стоит денег. Полные документы
читай точечно, по оглавлению, только если они нужны карточке.

## 1. Что за проект

Telegram Mini App: backend `backend/` (Express + socket.io + PostgreSQL + Redis),
frontend `frontend/` (Vite + React + three.js), бот `bot/`, схема
`backend/src/db/init.sql`. **Docker исключён (D-126)**: тестовый контур —
Vercel · Render · Supabase · GitHub Free (`docs/DEPLOY-FREE.md`), повседневные
проверки идут локально без контейнеров: `npm run verify`, `cd backend && npm test`,
`cd frontend && npm test && npx tsc --noEmit`. `docker-compose.yml` — архив.

## 2. Диета контекста (обязательная)

| Не делать | Делать вместо |
|---|---|
| Читать весь `ARCHITECTURE.md` / `README.md` / `TZ.md` | `grep -n '^#' <файл>` → прочитать только нужный раздел |
| Просить «весь журнал решений» | `decisions/D-<номер>.md` по `decisions[]` карточки |
| Класть регламент/роли/инструменты в каждый запрос заново | один неизменный system-prefix `docs/PROCESS.md` + `session_id` → кэш провайдера |
| Просить модель «проверить ещё раз» вместо замера | два **локальных** независимых замера (команда + rc + SHA), разные инструменты |
| Расширять промпт «на всякий случай» | `context-pack.mjs`, лимит 12 000 токенов; превышение — дефект пака |

Правило: в промпт попадает **только контекст-пак карточки**. Собери его
`node tools/local/context-pack.mjs --card <путь> --json` и посмотри разбивку по
секциям. Лимит не поднимается без ADR.

## 3. Деньги (обязательная)

```bash
# ДО вызова (делает run.mjs сам): хватит ли лимита фазы $15
node tools/local/budget.mjs check --add 0.38 || exit 2
# ПОСЛЕ вызова: факт из usage.cost, без домыслов
node tools/local/budget.mjs record --file .state/last-response.json \
  --phase F1 --card <id> --role <роль> --model <id> --call-id <id>/<попытка>
```

`call_id` идемпотентен: повтор с той же ценой не удваивает счёт, с другой —
ошибка. Схема — `costs/README.md`. Смета `$13.46/фаза` из стека v3 — ориентир,
**источник правды — `costs/ledger.jsonl`**. Журнал коммитится в Git.

## 4. Порядок хода

```bash
npm run card:plan -- --card tasks/F1/<id>.json   # сухой прогон: офлайн, $0
npm run card:run  -- --card tasks/F1/<id>.json   # гейты → бюджет → 1 вызов → вердикт
npm run budget:report && npm run board
```

`run.mjs` до платного вызова гоняет `gates[]` карточки. Красный rc — стоп,
деньги не тратятся. Ответ — строго JSON (`status`, `summary`, `changed_files`,
`commands`, `evidence`, `reason`): маркеров `CF_*` больше нет. Два независимых
замера проверяются кодом; без них вердикт `need_master`, карточка `blocked`.

Оракул не ослаблять никому. Отчёт без команды, rc и SHA — не доказательство.
Проверки зашиты в `tools/local/preflight.mjs`, а не берутся из `package.json`;
`SKIP` и `KNOWN` в его выводе — не pass (`KNOWN` = записанный долг продукта,
в `preflight:full` это честный `FAIL`).

## 5. Где живёт состояние

Всё в одном репозитории Git: `tasks/` (карточки, миссии, статусы),
`decisions/` (ADR), `verdicts/` (вердикты + evidence), `costs/ledger.jsonl`
(деньги), `docs/board/index.html` (доска из тех же файлов). Notion, Google Drive,
Arena-агенты и ScriptCat **не участвуют и удалены** (D-125).

**Не в Git:** секреты (`.env`, `OPENROUTER_API_KEY`, `BOT_TOKEN`, строки БД),
сырые ответы API, контекст-паки и кадры (`.state/`, `frontend/frames/`),
`node_modules`, локальные venv.

## 6. Инструменты и железо

- Node ≥ 20, Python 3.11+ (`py -3 -m pip install pillow numpy`), Git.
- Blender 5.3.0 portable, headless: `npm run blender:check`; скрипты —
  `node tools/local/blender.mjs --script <путь>`. pip-`bpy` и X11-стабы удалены.
- Машина: Win10 x64, i3-7100U (4 потока), 6 ГБ RAM. Docker не ставим; не
  поднимать одновременно Chromium и Blender. Дополнительные CLI — по одному из
  `docs/TOOLBOX.md`.
- **Каждое обновление репозитория → PR и мерж** (правило Мастера, 2026-11-15):
  коммит на активной ветке, PR, зелёные проверки, `gh pr merge`. Не оставлять
  правку «просто запушенной» без PR.
- Неясность → пауза и вопрос Мастеру, а не тихий дефолт (`docs/PROCESS.md` §6).
  Сомнение в зоне записи — карточка владельцу зоны, не правка «попутно».

## 7. Быстрые ссылки

`docs/LOCAL-DEV.md` (установка), `docs/PROCESS.md` (правила/system-prefix),
`docs/LOCAL-DEV-API.md` (архитектура), `docs/DEPLOY-FREE.md` (без Docker),
`docs/TOOLBOX.md` (быстрые инструменты), `decisions/D-125.md` (миграция),
`decisions/D-126.md` (хостинг/PR+мерж), `tools/local/README.md` (команды оркестратора).
