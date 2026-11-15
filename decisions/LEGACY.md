# Указатель решений до локального контура (архив удалён)

Старый журнал `docs/DECISIONS.md` (124 решения, 550 КБ) и вся обвязка
ScriptCat/Notion/Drive удалены по решению Мастера (D-125). Здесь оставлены
только те продуктовые решения, которые **продолжают действовать**, и ссылки на
их нынешние носители. Номера сохранены для преемственности; текста старых
обоснований больше нет — они описывали браузерный транспорт.

| Было | Суть | Где живёт сейчас |
|---|---|---|
| Ф0-1 | 30 FPS на слабом Android — обязательный гейт | `docs/perf-budget.md` |
| Ф0-2 | Арт-направление C «техно-аркада» + элементы A «кино-нуар», 10 референсов | `docs/art-direction.md` |
| Ф0-3 | 3D-пайплайн в репозитории, генерация скриптами | `tools/modeling/`, `tools/modeling/blender-version.json` |
| Ф0-4 | USDT: TON → BEP-20 → ERC-20; testnet — ручная подпись | `docs/architecture/payments-multichain.md`, `docs/security/key-custody.md` |
| Ф0-5 | Тестовый контур без Docker; Vercel = фронт, не API | `docs/LOCAL-DEV.md`, `docs/environments.md` |
| Ф0-6 | Звук и музыка — только скачанные записи, не синтез | `audio/CREDITS.md`, `docs/audio.md` |
| Ф0-7 | Первая миссия Ф1 — V-1-1 | `tasks/F1/mission.json` |
| Ф0-8 | Два языка ru + en, новых локалей без Мастера не добавляем | `docs/i18n.md` |
| Ф0-9 | Тестовый бот `@my_vault_dev_bot`, боевой — Ф2 | `docs/setup/telegram.md` |
| D-111 | Экран «Сервер API недоступен» вместо белого | `frontend/src/` (код), `README.md` |
| D-112 / D-114 / D-116 | ru + en, автоопределение языка, перевод названий игр, глоссарий | `docs/i18n.md` |
| D-113 / D-115 | Токен бота только у Мастера, `BOT_USERNAME` в `.env.example` | `docs/setup/telegram.md`, `.env.example` |
| D-117 / D-118 | Хостинг API $0 на тесте; для РФ-аудитории — 152-ФЗ и локальный хостинг | `docs/costs.md` |
| D-119 / D-120 | Схема на настоящем PostgreSQL; визуал — кадрами, не числами | `.github/workflows/ci.yml`, `docs/eyes.md` |

**Что утрачено сознательно:** все D-решения о маркерах, бюджетах промпта в
знаках, DOM-вводе Arena, provisioning агентов, Drive Gateway, payload-канале,
ntfy-пульсе и гейте D-027. Их заменяют `docs/PROCESS.md`, `tools/local/` и D-125.
