# tools/local · локальный контур без зависимостей

Всё на чистом Node ≥ 20, без npm-пакетов и без сети до шага вызова модели.
Список проверок зашит в коде (`preflight.mjs`), а не читается из `package.json`:
коммит не может подменить собственную проверку.

| Файл | Роль |
|---|---|
| `budget.mjs` | `ledger.jsonl`, `$/роль`, `$/модель`, `cached_share`, жёсткий `check --add` (exit 2) |
| `context-pack.mjs` | system-prefix + scope + ADR, ≤12 000 токенов, ошибка с разбивкой по секциям |
| `run.mjs` | оркестратор: гейты → бюджет → OpenRouter → JSON-вердикт → журнал → статус |
| `board.mjs` | `docs/board/index.html` из Git; `--check` для CI |
| `preflight.mjs` | фиксированный узел проверок; `--full` требует `npm ci` и не скрывает записанный долг продукта (`KNOWN` → `FAIL`) |
| `blender.mjs` / `py.mjs` | нативный Blender и системный Python, кросс-платформенные обёртки |
| `models.json` | роли моделей, оценки цены, маршрутизация по путям, лимит контекста |
| `test.mjs` | собирает список `tests/*.test.mjs` без glob оболочки (работает и в cmd.exe) |
| `tests/*.test.mjs` | пробы всего контура (`npm run test:local`) |

## Команды

```bash
npm run verify                        # быстрый локальный контур
npm run preflight:full                # + продукт (после npm ci)
npm run budget:report                 # где уходят деньги
npm run card:plan -- --card tasks/F1/LOCAL-0-K1.json   # офлайн, $0
npm run card:run  -- --card tasks/F1/LOCAL-0-K1.json   # один платный вызов
npm run card:batch -- --role auditor  # POST /batches
npm run card:collect -- <batch-id>   # GET /batches/<id>
npm run board                        # пересобрать доску
npm run blender:check                # версия + GLB + CPU-рендер
npm run py:check                     # Pillow/numpy
```

## Контракты

- **Ответ модели** — JSON по `RESULT_SCHEMA` (`run.mjs`): `status`
  (`submitted|need_master`), `summary`, `changed_files`, `commands[{cmd,rc,sha}]`,
  `evidence[{tool,result_sha}]`, `reason`. Никаких маркеров в конце строки.
- **Два независимых замера** — минимум два разных `tool` и два разных hex-SHA;
  иначе вердикт принудительно `need_master`.
- **Идемпотентность** — `call_id = <карточка>/<роль>/<попытка>`; повторная
  запись той же цены в ledger no-op, другой цены — ошибка.
- **Батч** — одна модель и один endpoint на запрос, `custom_id` =
  `<карточка>/<роль>`; незавершённый батч просто печатает статус.
- **Секреты** — `OPENROUTER_API_KEY` и `VAULT_MODEL_*` читаются из `.env`;
  в логи, вердикты и ledger не попадают.

## Коды возврата `run.mjs`

`0` ок · `1` ввод/конфиг/красный гейт · `2` бюджет или контекст · `3` сеть/API ·
`4` вердикт не принят (нужен Мастер, деньги уже списаны и записаны).
