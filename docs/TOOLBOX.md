# Инструменты «на всякий случай»

**Правило:** ничего из этого **не установлено сейчас** и не требуется для `npm run verify`.
Это список «быстро поднять, когда понадобится»: одна команда, без Docker, без
прав администратора (кроме winget), без постоянного фонового процесса на 6 ГБ RAM.
Активный контур — [`DEPLOY-FREE.md`](DEPLOY-FREE.md), решение — [D-126](../decisions/D-126.md).

Ставить по одному, по факту необходимости: одновременно Chromium и Blender уже
нагружают ноутбук, третий тяжёлый процесс не нужен.

## 1. Уже есть / обязательный минимум

| Инструмент | Зачем | Проверка |
|---|---|---|
| Git, Node ≥ 20, Python 3.11+ (`py`), Blender 5.3 portable | репозиторий, оркестратор, текстуры, 3D | [`LOCAL-DEV.md`](LOCAL-DEV.md) |
| `winget` (App Installer в Win10) | быстрая доставка всего ниже | `winget --version` |
| `curl.exe` (встроен в Win10) | смоук API без GUI-клиента | `curl.exe --version` |

## 2. Первый кандидат: GitHub CLI

| | |
|---|---|
| Зачем | PR + мерж по правилу Мастера, `gh pr checks`, `gh run view`, релизы, issues. В Arena это делает агент, но на локальном ПК пригодится, если захотите мержить сами |
| Установка | `winget install --id GitHub.cli -e` → новое окно терминала → `gh auth login` |
| Документация | [cli/cli · Installation](https://github.com/cli/cli#installation) |

## 3. Облачный контур (Ф2)

| Инструмент | Зачем | Быстрая установка | Важная оговорка |
|---|---|---|---|
| **Vercel CLI** | preview/prod деплой фронта, подтянуть env | `npm i -g vercel` → `vercel login` | [Getting started](https://vercel.com/docs/getting-started-with-vercel); статика, не backend |
| **Supabase CLI** | `npx supabase link`, `db push`, миграции, генерация типов | `npm i -D supabase` (или `npx supabase`) → Node ≥ 20 | **`supabase start` не использовать**: локальный стек требует Docker [Local Development](https://supabase.com/docs/guides/local-development). Работаем с удалённым Free-проектом |
| **Render CLI** | `render services`, логи, `render psql`, валидация Blueprint | `winget install render.cli` → `render login` | [Render CLI](https://render.com/docs/cli), `render blueprints validate` перед Ф2 |
| **`psql` (только клиент)** | прогнать `init.sql` / `schema-check.sql` против Supabase | `winget search PostgreSQL` → поставить клиент, либо `render psql`, либо SQL-редактор Supabase | сервер PostgreSQL на ноутбуке не поднимаем; схему уже проверяет CI job `schema` |
| **Render Blueprint `render.yaml`** | инфраструктура как код для API + бота | шаблон в [`DEPLOY-FREE.md`](DEPLOY-FREE.md) §5, файл создаём только в Ф2 | не коммитить раньше миссии, чтобы случайно не создать сервисы |

## 4. Диета контекста и деньги (дешёвые CLI)

| Инструмент | Зачем | Установка |
|---|---|---|
| **ripgrep `rg`** | точечный поиск вместо чтения `ARCHITECTURE.md` / `README.md` целиком | `winget install --id BurntSushi.ripgrep.MSVC -e` |
| **jq** | разбор `costs/ledger.jsonl`, вердиктов, JSON-ответов | `winget install --id jqlang.jq -e` |
| **`@gltf-transform/cli`** | инспекция/ужатие GLB, когда `audit_glb.py` покажет перебор | `npm i -g @gltf-transform/cli` ([npm](https://www.npmjs.com/package/@gltf-transform/cli)); помнить про WebP-ловушку — в репозитории `shrink_glb.mjs` пишет JPEG |
| **`Volta` / `nvm-windows`** | несколько версий Node без ручной возни | `winget search volta` / `winget search nvm` |
| **`httpyac`** | `.http`-файлы для смоука API, легче Postman | `npx httpyac` (или `curl.exe`) |

## 5. Медиа и 3D

| Инструмент | Зачем | Установка / примечание |
|---|---|---|
| **Playwright + Chromium** | кадры сцен, уже описаны в [`eyes.md`](eyes.md) | `cd frontend; npx playwright install chromium` |
| **ffmpeg** | перекодировать звук/превью, если появятся новые ассеты | `winget search ffmpeg`; текущий `audio:audit` работает без ffprobe |
| **Blender 5.2.4 LTS** | запасной путь, если 5.3 не заведётся | ссылка в [`tools/modeling/blender-version.json`](../tools/modeling/blender-version.json), `npm run blender:check -- --allow-lts` |

## 6. Что сознательно НЕ ставим

| Инструмент | Почему |
|---|---|
| **Docker Desktop / `docker compose`** | исключён Мастером (D-126): 6 ГБ RAM, тяжёлый демон. Файлы сохранены как архив, в CI не собираются |
| **Godot 4.7.2 (из `synapse`)** | Vault — Telegram Mini App на React/three.js, а не игра на Godot. Игровые элементы есть, но они серверная логика + браузерные сцены. См. [`DEPLOY-FREE.md`](DEPLOY-FREE.md) §7 |
| **Локальный PostgreSQL/Redis-сервер** | `pg-mem` + CI `postgres:16` + Supabase Free закрывают задачу; Redis в коде опционален |
| **Postman / Insomnia / DBeaver** | Electron-клиенты кушают оперативку; хватает `curl.exe`, `jq`, SQL-редактора Supabase |
| **Постоянный self-hosted runner GitHub Actions** | стандартных бесплатных раннеров хватает; свой раннер = ещё один процесс на ноутбуке |

## 7. Если инструмент всё-таки понадобился

1. Проверить, что он не тянет Docker (особенно Supabase CLI: `link`/`db push` — можно, `start` — нельзя).
2. Поставить одной командой из таблицы, проверить `--version`.
3. Не добавлять в `package.json`/`npm ci` без карточки и ADR: обязательный минимум
   остаётся офлайн-контур `tools/local/`.
4. Секреты CLI (`gh auth`, `vercel login`, `render login`, Supabase token) — только
   в профиле пользователя, не в `.env` репозитория и не в Git.
