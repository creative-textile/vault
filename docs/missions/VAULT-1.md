# ТЗ · VAULT-1 · Контур агентов

Версия ТЗ **1.0** · редакция от 2026-11-12 · владелец: Мастер · автор: Warden.
Базовая ревизия: `cef9a70d2115a974cfc858690d91436523d1923e` (`main`).
Notion: страница «ТЗ · VAULT-1 · Контур агентов» (`4166f0cf-5705-81cb-9645-f6a2120f4943`).

## 1. Цель

Перенести транспорт ScriptCat из `creative-textile/vault-relay` внутрь единого репозитория
`creative-textile/vault`, адаптировать его под один проект и поднять собственный регламент
команды Vault. После миссии рабочая копия `vault-relay` не нужна: транспорт, документы и
проверки живут в `/vault`.

## 2. Что уже сделано до ТЗ

- Страница «Vault — разработка платформы» создана на корне воркспейса Notion
  (`4166f0cf-5705-8166-8891-cdebc635b114`).
- Созданы четыре базы по `NOTION-TEMPLATE.json`:
  «Роли» `024b7678-4880-4764-b9a5-570dd6ca72cc`, «Миссии»
  `b12d8576-fc57-4361-8a7e-5d08ed2b2aab`, «Запросы»
  `85cbca4a-7093-429a-b569-b82d24927ff2`, «Обратная связь»
  `abf2d533-04ec-4bbf-a261-ab21eb001e57`.
- Заведены 11 ролей команды Vault; `Agent URL` заполняет Мастер после создания агентов.
- Транспорт скопирован в `tools/script-cat/**`, узел и сторож — в `tools/`.

## 3. Scope

Разрешено менять только:

```
tools/script-cat/**
tools/relay-build.mjs
tools/relay-watchdog.mjs
docs/regulation-digest.md
docs/REGULATION.md
docs/scriptcat-update.md
docs/agents/**
docs/DECISIONS.md
docs/setup/notion-ids.md
docs/missions/**
docs/PHASES.md
package.json
```

Код продукта (`backend/**`, `frontend/**`, `bot/**`) в этой миссии не меняется.

## 4. Оракул миссии

1. `node tools/script-cat/build.mjs --check` → rc=0.
2. `node tools/script-cat/portability-guard.mjs` → rc=0, прежних имён нет.
3. `npm test` → все пробы транспорта, fail 0.
4. `npm run test:regression` → fail 0.
5. `npm run verify` → rc=0 и `# fail 0`; бандл допущен, отпечаток и версии совпадают.
6. В `tools/**` нет строк `synapse`, `synapse-cortex`, `Creative36711`, `narthex`.

## 5. Инварианты

- Код транспорта не переписывается под Vault: проектные адреса задаются профилем и настройками.
- Оракул не ослабляется: пробы можно дополнять и переносить на данные Vault, удалять и
  подгонять — нельзя.
- Секреты не попадают в чат, логи, документы и Git.
- Один репозиторий: маршрутизация по репозиториям сохраняется как механизм, но цель у Vault одна.

## 6. Definition of Done

- `tools/script-cat/**` + узел + сторож живут в `/vault`, сборка и guard зелёные.
- `docs/REGULATION.md` v1.0 и `docs/regulation-digest.md` (вшивается в бандл) для Vault.
- `docs/setup/notion-ids.md` с ID баз Vault и правилами заполнения.
- Корневой `package.json` со скриптами `scriptcat:build|check|guard`, `test`,
  `test:regression`, `test:tool-limit`, `verify`.
- Отчёт с командами, rc, SHA и списком изменённых файлов.
