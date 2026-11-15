# Вердикты

Один файл `verdicts/<id карточки>.json` на принятый ход. Пишет
`tools/local/run.mjs` после платного вызова (в том числе когда ответ не разобран —
деньги уже списаны, и это должно быть видно).

Поля: `card`, `phase`, `role`, `model`, `status`, `summary`, `reason`,
`cost_usd`, `context_tokens`, `gates[{cmd,rc,sha}]`, `changed_files`,
`commands[{cmd,rc,sha}]`, `evidence[{tool,result_sha}]`.

Правило двух независимых замера проверяется кодом: как минимум два разных
`tool` и два разных `result_sha`, каждый SHA — hex. Без этого вердикт
принудительно становится `need_master`, а карточка — `blocked`.

Вердикты коммитятся в Git: доска и отчёт по фазе строятся только из репозитория.
