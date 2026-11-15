# Локальная разработка · быстрый старт (Windows 10 x64)

**Прочитай [`AGENTS.md`](../AGENTS.md) первым** — это короткий вход для агента с
диетой контекста. Здесь — пошаговая подготовка машины. Цель: клонировал →
запустил → потратил на первую карточку не больше `$0.14`.

## 1. Что поставить

| Инструмент | Версия | Зачем | Проверка |
|---|---|---|---|
| Git | любая свежая | репозиторий — единственный носитель процесса | `git --version` |
| Node.js | **≥ 20** (LTS) | оркестратор, бюджет, доска, сборка продукта | `node -v` |
| Python | **3.11+** | Pillow/numpy для текстур, медиа, аудит GLB | `py -3 -c "import PIL,numpy"` |
| Blender | **5.3.0 portable** (`blender-version.json`) | 3D headless, CPU-рендер | `npm run blender:check` |
| Playwright + Chromium | по необходимости | кадры 3D-сцен | `cd frontend && npx playwright install chromium` |
| Docker Desktop | **не используется** (D-126) | — | см. [`DEPLOY-FREE.md`](DEPLOY-FREE.md) |

> На 6 ГБ RAM не держите Chromium и Blender одновременно; Docker не ставим
> вовсе. Повседневные проверки идут без контейнеров (`pg-mem`, `tsc`, локальные
> тесты), а тестовый деплой — на Vercel/Render/Supabase/GitHub Free.

Установка Python-зависимостей (без pip-`bpy` и X11-стабов — они удалены):

```powershell
py -3 -m pip install pillow numpy
npm run py:check
```

Blender: скачать **portable ZIP 5.3.0** (406 МБ) с
[официальной страницы релиза](https://www.blender.org/releases/5-3/) или
[прямой ссылкой](https://download.blender.org/release/Blender5.3/blender-5.3.0-windows-x64.zip),
распаковать в `C:\tools\blender-5.3.0-windows-x64\` (внутри `blender.exe` и
папка `5.3\`), в `.env` указать
`BLENDER_EXE=C:/tools/blender-5.3.0-windows-x64/blender.exe`. Установщик, права
администратора и интернет после скачивания не нужны: portable-сборка работает
из папки [«Truly Portable»](https://www.blender.org/download/requirements/).

Контрольная сумма из [официального `.sha256`](https://download.blender.org/release/Blender5.3/blender-5.3.0.sha256):
`3ac567a63d59d9934f7b9213bfb27ba05760e1fb366f8f55c381573ec3eabfa8`.

```powershell
(Get-FileHash .\blender-5.3.0-windows-x64.zip -Algorithm SHA256).Hash.ToLower()
```

Официальный минимум Windows: Windows 8.1 x64, **4 ядра с SSE4.2, 8 ГБ RAM**,
2 ГБ VRAM, OpenGL 4.3 / Vulkan 1.3
([требования](https://www.blender.org/download/requirements/)). В 5.3 Vulkan
стал бэкендом по умолчанию, но его минимальная версия снижена до 1.1
([release notes](https://developer.blender.org/docs/release_notes/5.3/eevee/)).
На HD 620 / 940MX с 6 ГБ RAM обёртка принудительно ставит
`--gpu-backend opengl`, поэтому Vulkan для нашего headless-контура не нужен.
Если 5.3 не заведётся —
[5.2.4 LTS portable](https://download.blender.org/release/Blender5.2/blender-5.2.4-windows-x64.zip)
и `npm run blender:check -- --allow-lts`. Версия всегда сверяется с
`tools/modeling/blender-version.json` (там же ссылка и SHA-256).

## 2. Секреты (только локально)

```powershell
Copy-Item .env.example .env
# заполнить OPENROUTER_API_KEY и точные VAULT_MODEL_* из https://openrouter.ai/models
```

`.env` в `.gitignore`. Ключ не попадает в Git, логи, промпты и вердикты.
В кабинете OpenRouter выставить **Workspace Budgets**: daily `$5`, weekly `$15`,
monthly `$60` — внешний предохранитель от бесконечного ретрая (при превышении
запрос отклоняется `403`). Лимиты должны строго убывать при сужении интервала.

Модели в `.env` — точные slug'ы провайдера. Алиасы стека v3 (Sol / Flash /
Argon / Terra / Carbon / Opus 5.5) перечислены в `tools/local/models.json` как
**роли** с оценкой цены; оценка нужна только для `budget check --add`, факт
всегда приходит из `usage.cost`.

## 3. Первый запуск (без платных вызовов)

```powershell
git clone https://github.com/Creative-textile/vault.git
cd vault
npm run verify          # пробы, доска, контекст-паки, бюджет, git diff --check
npm run budget:report   # пока $0 / $15
npm run board           # docs/board/index.html — открыть двойным щелчком
npm run blender:check   # GLB + CPU-рендер 640×360 в .state/blender/
npm run py:check
```

`npm run verify` печатает `SKIP` для продуктовых проверок, если в `backend/`,
`frontend/`, `bot/` нет `node_modules`. Пропуск — **не pass**. Строка `KNOWN`
тоже не pass: это записанный долг продукта (`coin.glb`: 7 текстур при лимите 4,
`docs/STATUS.md` §4). Быстрый `verify` поэтому зелёный по локальному контуру,
но ничего не скрывает; `preflight:full` не ослабляет гейт и покажет `FAIL` по
`models:audit` — это и есть исходная точка миссии V-1-1, а не поломка
оркестратора. Полный прогон:

```powershell
cd backend;  npm ci; cd ..
cd frontend; npm ci; cd ..
cd bot;      npm ci; cd ..
npm run preflight:full
```

Ожидаемо: до исправления бюджета моделей `preflight:full` красный только по
`models:audit` (плюс `SKIP`, если зависимости не поставлены). Остальные шесть
проверок локального контура обязаны быть зелёными всегда.

## 4. Первая карточка

```powershell
# 1) сухой прогон: ни сети, ни ключа, ни списания
npm run card:plan -- --card tasks/F1/LOCAL-0-K1.json

# 2) реальный вызов (нужны OPENROUTER_API_KEY и VAULT_MODEL_FLASH)
npm run card:run  -- --card tasks/F1/LOCAL-0-K1.json

# 3) факт расходов и вердикт
npm run budget:report
type verdicts\LOCAL-0-K1.json
npm run board
```

`card:plan` показывает модель (для этой карточки — Flash `$0.14`, потому что
оракул полностью скриптовый), оценку бюджета, ~токены контекста и хеш
system-prefix. `card:run` перед вызовом гоняет бесплатные гейты; красный rc
останавливает выдачу, деньги не тратятся. Ответ модели — строго JSON; два
независимых локальных замера проверяются кодом. Если вердикт не принят,
карточка уходит в `blocked` и ждёт Мастера.

## 5. Повседневные команды

| Задача | Команда |
|---|---|
| Проверить всё локально | `npm run verify` |
| Где уходят деньги | `npm run budget:report` |
| Лимит перед выдачей | `npm run budget:check` |
| Обновить доску | `npm run board` |
| Проверить контекст всех карточек | `npm run context:check` |
| Батч аудита (−50 %) | `npm run card:batch -- --role auditor` → `npm run card:collect -- <id>` |
| Пересобрать модель | `node tools/local/blender.mjs --script frontend/models-src/coin/build_coin.py` |
| Текстуры (системный Python) | `node tools/local/py.mjs --script frontend/models-src/coin/gen_coin_textures.py` |
| Кадры сцен | `cd frontend; npm run eyes` |
| Аудит 3D / звука | `npm run modeling:audit`, `npm run audio:audit` |
| Тестовый деплой (Ф2) | Vercel + Render + Supabase + GitHub Actions, см. [`DEPLOY-FREE.md`](DEPLOY-FREE.md) |
| Инструменты «на всякий случай» | [`TOOLBOX.md`](TOOLBOX.md) |

## 6. Куда что писать

| Что | Файл |
|---|---|
| Карточка, статус, оракул, зона | `tasks/<фаза>/<карточка>.json` |
| Миссия и её оракул | `tasks/<фаза>/mission.json` |
| ADR | `decisions/D-<номер>.md` |
| Вердикт + evidence | `verdicts/<карточка>.json` |
| Факт расходов | `costs/ledger.jsonl` (коммитится!) |
| Доска | `docs/board/index.html` (генерируется) |
| Правила игры | `docs/PROCESS.md` (system-prefix, менять только ADR) |

Сырые ответы API и контекст-паки лежат в `.state/` и в Git не попадают.
Контур без Docker и решение D-126: [`DEPLOY-FREE.md`](DEPLOY-FREE.md),
[`../decisions/D-126.md`](../decisions/D-126.md). Инструменты, которые можно
быстро доставить позже: [`TOOLBOX.md`](TOOLBOX.md).

## 7. Если что-то не так

| Симптом | Причина / действие |
|---|---|
| `нет VAULT_MODEL_*` | заполнить точные slug'ы в `.env` |
| `бюджет фазы исчерпан` | `budget:report`; либо кончить фазу, либо ADR на лимит (только Мастер) |
| `контекст-пак … > 12000 токенов` | уменьшить `contextFiles`/`decisions`, не поднимать лимит |
| `красный локальный гейт` | починить локально, платный вызов не последует |
| `нужны два независимых замера` | вердикту нужны два разных инструмента с разными SHA |
| `доска устарела` | `npm run board` и закоммитить HTML |
| Blender не стартует | `--gpu-backend opengl` уже стоит; попробовать `--allow-lts` (5.2.4) |
| `npm run verify` показывает SKIP | `npm ci` в `backend/`, `frontend/`, `bot/` → `preflight:full` |
| `npm run verify` показывает KNOWN | записанный долг продукта; в `--full` это честный `FAIL`, см. `docs/STATUS.md` §4 |
| `preflight:full` красный по `models:audit` | исходная точка V-1-1: `coin.glb` с 7 текстурами при лимите 4; карточки K1/K3/K4/K5 в `draft` |
| `supabase start` просит Docker | это локальный стек Supabase, он исключён (D-126); используйте удалённый Free-проект: `npx supabase link` / SQL-редактор |
| нужен «полный стек» | он больше не поднимается локально: `DEPLOY-FREE.md`; Docker-файлы — архив |
