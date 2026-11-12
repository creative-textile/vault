# Настройка: ID баз Notion, профиль ScriptCat, Drive Gateway

Создано Warden 2026-11-12 для Vault. Здесь только идентификаторы ресурсов, **никаких секретов**.
Ссылки на страницы — только `https://app.notion.com/p/<page_id>` или голый `page_id`;
публичные адреса `notion.site` не используются (правило — `docs/agents/notion.md`).

## 1. Notion

Родительская страница: **«Vault — разработка платформы»** (создана на корне воркспейса)
`https://app.notion.com/p/Vault-4166f0cf570581668891cdebc635b114`
page_id: `4166f0cf-5705-8166-8891-cdebc635b114`

| База | database_id | **data source id (нужен профилю)** |
|---|---|---|
| Роли | `51ae357e-ff18-4b69-a5fd-f3ffe9acea8f` | `024b7678-4880-4764-b9a5-570dd6ca72cc` |
| Миссии | `acd5a423-e1a8-4906-bdfb-62729931839b` | `b12d8576-fc57-4361-8a7e-5d08ed2b2aab` |
| Запросы | `a04dc85f-1193-4ec0-8c2b-512e678fd2ac` | `85cbca4a-7093-429a-b569-b82d24927ff2` |
| Обратная связь | `1ed11e3c-4904-4c8b-bd31-45a3494acbd7` | `abf2d533-04ec-4bbf-a261-ab21eb001e57` |

Ссылки для формы профиля (если удобнее вставлять URL, а не UUID):

- Роли: `https://app.notion.com/p/51ae357eff184b69a5fdf3ffe9acea8f`
- Миссии: `https://app.notion.com/p/acd5a423e1a84906bdfb62729931839b`
- Запросы: `https://app.notion.com/p/a04dc85f11934ec08c2b512e678fd2ac`
- Обратная связь: `https://app.notion.com/p/1ed11e3c49044c8bbd3145a3494acbd7`

Схема совпадает с `tools/script-cat/NOTION-TEMPLATE.json` по типам и значениям `select`;
`Статус` и `Dispatch State` — именно `select`, не Notion Status.

**Заменено 09.11 (D-081); 12.11 проверено для Vault.** `Тип` — обычный `select` («Вопрос» /
«Предложение»), формулу `Тип (формула)` в базу Vault не добавляли: именно она когда-то была
создана поверх шаблона в соседнем проекте, и транспорт писал поле, которого в схеме нет. Причина
записана, чтобы её не повторили при копировании базы.

`Кому` в «Запросах» создан сразу с опциями ролей Vault — ровно теми же написаниями, что `Роль`:

```
Warden, Coordinator, Executor App, Executor Chain, Data & Ledger Architect,
Spec Auditor, Security & Payments Auditor, Platform Architect, Transport Maintainer,
Locale & UX Auditor
```

## 2. Регламент

| Что | page_id | Для чего |
|---|---|---|
| Регламент команды Vault (полный, v1.1) | страница в Notion создаётся Мастером из `docs/REGULATION.md` | справочник: человек и Warden |
| **Регламент · краткая версия (вход для агентов)** | вшита в бандл; репозиторная копия `docs/regulation-digest.md` | вход агента в каждом ходе |
| План фаз и журнал решений фазы 0 | `docs/PHASES.md` | опубликованная редакция; шапку читает гейт D-086 |
| ТЗ · V-1-1 · 3D-модели под бюджет телефона | `docs/missions/V-1-1.md` | ТЗ миссии фазы 1 |
| V-1-1 · очередь карточек | `docs/missions/V-1-1-card-queue.md` | редакция очереди |

Краткая версия с 1.8.0 приходит в промпте: страницу для этого открывать не нужно. `pageUrl` в
профиле — ссылка на справочник (полная страница). Совпадение вшитого текста с
`docs/regulation-digest.md` проверяет `npm run verify`.

## 3. Профиль ScriptCat

| Поле профиля | Значение |
|---|---|
| Имя проекта | `Vault` |
| Notion: 4 источника | см. таблицу выше (data source id) |
| Страница регламента (HTTPS) | ссылка на полную страницу «Регламент команды Vault» |
| База обратной связи (HTTPS) | `https://app.notion.com/p/1ed11e3c49044c8bbd3145a3494acbd7` |
| GitHub | `creative-textile/vault` |
| Базовая ветка | `main` |
| Папка Drive | `vault` |
| Зона записи по умолчанию | `tools/script-cat/**, docs/**, package.json` |
| ID профиля | появится в строке «ID:» после создания — нужен для Gateway |

## 4. Drive Gateway (действия Мастера, один раз)

Порядок важен: **сначала профиль ScriptCat, потом Gateway**, потому что `CF_SETUP_PROJECT_ID` —
это UUID профиля.

1. Папку `Arena/vault` **не создавать вручную**: `setupProjectGateway()` откажется регистрировать
   проект, если папка уже существует, и не присоединяет чужую. У Vault папки `vault` в `Arena` нет
   — проверено 2026-11-12.
2. Открыть существующий Apps Script `Arena/Gateway` — он мультипроектный (1.8.0), второй скрипт не
   нужен. Код для сверки — `tools/script-cat/drive-gateway.gs`, манифест —
   `tools/script-cat/appsscript.json`.
3. Project Settings → Script Properties:
   - `CF_SETUP_PROJECT_ID` = UUID профиля ScriptCat (из строки «ID:»)
   - `CF_SETUP_PROJECT_FOLDER` = `vault`
4. Запустить `setupProjectGateway()` один раз. Она создаст `Arena/vault/{logs,payloads}`,
   зарегистрирует проект и выпустит **проектный** ключ в журнале выполнения. Ключ переносится
   только в поле «Ключ шлюза» в ScriptCat.
5. Deploy → Manage deployments → текущее → Edit → New version → Deploy, если код обновлялся.
6. В ScriptCat: «Проверить всё» → «Сохранить» → «Проверить подключения и разрешить работу».

Мастер-ключ шлюза (`setupGatewayKey()`) не копируется никуда: он управляет всеми проектами.

Если при регистрации была ошибка — не запускать функцию повторно вслепую и не удалять папки:
сначала разобрать состояние реестра (`CF_GATEWAY_PROJECTS_V1`).

## 5. GitHub-токен для транспорта

Репозиторий `creative-textile/vault` публичный, поэтому для чтения PR достаточно токена с
`Contents: Read-only`, `Pull requests: Read-only`; вводит Мастер в поле GitHub. Этот токен не даёт
агенту прав на push/merge — доступ агентов к репозиторию идёт через коннектор Arena.

## 6. Что уже лежит в базах

### «Роли» — 10 строк, `Статус = Ждёт`, Agent URL пуст

| Роль | Функция | Зона записи |
|---|---|---|
| Warden | Reviewer | `docs/missions/**`, `docs/REGULATION.md`, `docs/DECISIONS.md` |
| Coordinator | Coordinator | Notion: «Миссии», «Запросы» |
| Executor App | Executor | `frontend/**`, `bot/**`, `backend/src/api/**`, сервисы без платежей |
| Executor Chain | Executor | `backend/src/services/ton.ts`, `services/chain/**`, админ-выводы |
| Data & Ledger Architect | Executor | `backend/src/db/**` |
| Platform Architect | Executor | `docker-compose.yml`, `deploy/**`, `scripts/**`, `index.ts`, `config.ts` |
| Spec Auditor | Auditor | `tests/**`, `scripts/verify/**` |
| Security & Payments Auditor | Auditor | `docs/security/**`, `scripts/audit/**` |
| Locale & UX Auditor | Auditor | `locales/**`, `docs/I18N.md` |
| Transport Maintainer | Maintainer | `tools/script-cat/**`, `tools/relay-build.mjs` |

`Статус = Ждёт` — не ошибка: цикл не стартует на ролях без `Agent URL` (D-008). Мастер создаёт
агентов и вписывает URL, после чего роль переводится в `Активна`.

### «Миссии» — 1 строка (фаза 1)

`V-1-1 · 3D-модели и сцены под бюджет телефона`, `Состояние = Активна`, `Круг = 0`,
`Координатор` — ссылка на строку Coordinator в «Ролях».
ТЗ: `docs/missions/V-1-1.md` (Версия ТЗ 1.2), очередь: `docs/missions/V-1-1-card-queue.md`
(редакция 1.1, ТЗ 1.2).
Строка `VAULT-1` из фазы 0 остаётся в корзине Notion как история; файлы — в `docs/missions/archive/`.

**12.11 карточка активна** (по указанию Мастера): транспорт нарезал очередь, K1 `Draft` у
Platform Architect, Мастер запускает цикл. Номер версии ТЗ в шапке обязан совпасть с
`docs/PHASES.md` (сейчас 1.2) — это сверяет `relay-repo-visibility-smoke`.

### «Обратная связь»

Поле `Тип` — `select` («Вопрос» / «Предложение»), значение ставит транспорт при создании строки
(D-080). Записывать обратную связь руками не нужно: правильный путь — поле `question` в маркере
хода, транспорт сам создаст строку.

## 7. Чек-лист Мастера (по порядку)

1. Создать агентов Arena под 10 ролей Vault (список в §1 — ровно столько строк в «Ролях»), вписать `Agent URL`, перевести в `Активна`.
2. Дать ролям доступ к репозиторию `creative-textile/vault` (коннектор Arena).
3. Установить `tools/script-cat/relay.user.js` как userscript, создать профиль `Vault` (ID из §3).
4. Зарегистрировать проект в Gateway (§4), получить проектный ключ, вставить в ScriptCat.
5. «Проверить всё» → «Сохранить» → «Проверить подключения и разрешить работу».
6. ~~Утвердить решения фазы 0~~ — **сделано 2026-11-12**: направление C+A, 30 FPS на `low`,
   порядок сетей TON → BEP-20 → ERC-20, хостинг $0.
7. Создать остальных агентов Arena и вписать `Agent URL` в «Роли» — первыми нужны
   **Platform Architect** (пишет модели), **Coordinator** (нарезает очередь) и **Spec Auditor**
   (проверяет числа). Warden уже активен.
8. Ввести боевые ключи и переключить режим `mainnet` — **только после** приёмки фазы платежей
   (Ф2) и подписи Security & Payments Auditor.
