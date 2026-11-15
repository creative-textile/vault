# Учёт расходов на API

Единственный источник правды о деньгах — `ledger.jsonl` (append-only, в Git).
Плановые цены из стека v3 (`budget.json → planBaselineUsd`) — это **смета**, а не
факт. Факт приходит из `usage.cost` каждого ответа OpenRouter: дополнительный
запрос для учёта не нужен, потоковые и обычные ответы несут usage сами
[Usage Accounting](https://openrouter.ai/docs/cookbook/administration/usage-accounting).
У батча цена тоже приходит в `usage.cost`, результаты сопоставляются по
`custom_id` [Batch API](https://openrouter.ai/docs/guides/features/batch-api).

## Зачем это первым шагом

Пока нет журнала, «$13.46 за фазу» — арифметика на бумаге. Любая оптимизация
(Flash вместо Sol, батч, кэш, контекст-паки) проверяется только по фактическим
`cost_usd`, `cached_tokens` и числу повторов. Инструмент `budget.mjs` даёт три
вещи: запись факта, отчёт `$/карточка · $/роль · $/модель` и **жёсткий стоп**
перед выдачей следующей карточки.

Два независимых контура защиты (привычка из старого регламента):
1. локальный `budget check --add <ожидаемая цена>` перед каждым вызовом — exit 2
   при выходе за лимит фазы;
2. [Workspace Budgets](https://openrouter.ai/docs/guides/features/workspaces/workspace-budgets)
   в кабинете OpenRouter: дневной/недельный/месячный жёсткий предел, при
   превышении запрос отклоняется `403`. Рекомендуемая установка на старте:
   daily `$5`, weekly `$15`, monthly `$60` (лимиты должны строго убывать при
   сужении интервала).

## Формат строки `ledger.jsonl`

```json
{"v":1,"ts":"2026-11-15T10:00:00Z","kind":"api_call","phase":"F1","card":"V-1-1-K1","role":"executor","model":"<openrouter-id>","model_key":"executor","mode":"sync","call_id":"V-1-1-K1/executor/1","cost_usd":0.3812,"prompt_tokens":12400,"completion_tokens":910,"total_tokens":13310,"cached_tokens":8200,"cache_write_tokens":0,"reasoning_tokens":0,"upstream_inference_cost":0.3812,"source":"openrouter.usage"}
```

| Поле | Смысл |
|---|---|
| `call_id` | идемпотентный ключ. Повтор с той же ценой = no-op, с другой = ошибка (ловит двойной биллинг при ретрае) |
| `kind` | `api_call` — вызов модели; `topup_fee` — комиссия за пополнение (~5.5%), считается отдельно |
| `model_key` | роль из `tools/local/models.json`; по `critical` считается лимит ≤4 дорогих вызовов за фазу |
| `mode` | `sync` / `batch`; по нему видно, сработала ли скидка −50% |
| `cached_tokens` | прочитано из кэша; доля `cached / prompt` — главный KPI «диеты контекста» |
| `cost_usd` | `usage.cost`, сколько реально списано. Не умножать на комиссию пополнения |

Секретов, промптов и содержимого ответов в журнале нет: только числа, ID и
роль. Журнал коммитится вместе с карточкой — стоимость задачи видна в истории.

## Команды

```bash
# записать ответ (Chat Completions или Responses — форма разбирается сама)
node tools/local/budget.mjs record --file .state/last-response.json \
  --phase F1 --card V-1-1-K1 --role executor --model <id> --call-id V-1-1-K1/ex1

# записать все результаты батча (call_id берётся из custom_id)
node tools/local/budget.mjs record --file .state/batch-result.json --all \
  --phase F1 --card V-1-1-K1 --role auditor --mode batch --model <id>

# перед выдачей карточки: хватит ли денег
node tools/local/budget.mjs check --phase F1 --add 0.38 || exit 2

# где уходят деньги
node tools/local/budget.mjs report --phase F1
```

`npm run budget:check`, `npm run budget:report` — короткие алиасы.
`VAULT_LEDGER` и `VAULT_BUDGET_CONFIG` переопределяют пути (для тестов).
