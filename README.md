# 🏛️ VAULT — Telegram Mini App Игровая Платформа (v4)

Игровая платформа внутри Telegram с тремя игровыми режимами и системой пассивного дохода.
Валюта: **USDT (сеть TON)**. Единая комиссия: **10%** с игр, **1%** за вывод.

> Статус: ✅ Работающий MVP. Вся игровая математика, WebSocket-синхронизация, 3D-сцены, cron-задачи и админка реализованы.
> Включен демо-режим для быстрого тестирования без реального TON.

---

## 📚 Документация

- **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** — подробная архитектура проекта, потоки данных, схема БД, алгоритмы игр, диаграммы компонентов.
- **ТЗ (оригинал)** — в корне проекта (файл `TZ.md`).

---

## 🚀 Быстрый старт (3 способа)

### Способ 1: Docker Compose (рекомендуется для проверки)

```bash
git clone <repo-url> vault && cd vault
cp .env.example .env  # для демо можно не редактировать
docker-compose up --build
```

**Примечание для Windows (Docker Desktop):**
Если получаете ошибку `user declined directory sharing`, убедитесь, что в **Docker Desktop → Settings → Resources → File Sharing** разрешён доступ к диску, где лежит проект (обычно `C:`). Конфигурация проекта использует собственный Dockerfile для PostgreSQL без bind-mount файлов с хоста, поэтому дополнительная настройка прав для конкретных файлов не требуется.

После запуска:
| Сервис | URL |
|--------|-----|
| 🌐 Frontend (Mini App) | http://localhost:3000 |
| 🔌 Backend API | http://localhost:8000/api/health |
| 🐘 PostgreSQL | `localhost:5432` (пользователь: `vault`, пароль: `vault_pass`, БД: `vault`) |
| ⚡ Redis | `localhost:6379` |

Демо-режим включён по умолчанию (`DEMO_MODE=true`): при входе через браузер создаётся тестовый пользователь, а кнопка «Демо-пополнение» на экране депозита мгновенно зачисляет средства для тестирования всех игр.

### Способ 2: Режим разработки (с hot-reload)

Требования: Node.js 20+, PostgreSQL 16+, Redis 7+.

```bash
# 1. Запустите Postgres и Redis (локально или в докере)
docker-compose up -d db redis

# 2. Бэкенд
cd backend
npm install
npm run dev  # запустится на http://localhost:8000

# 3. Фронтенд (в другом терминале)
cd ../frontend
npm install
npm run dev  # запустится на http://localhost:3000
```

Бэкенд будет автоматически подключаться к Postgres/Redis из `docker-compose`, а фронтенд проксирует запросы на `localhost:8000` (настроено в `vite.config.ts`).

### Способ 3: Запуск в Telegram боте

1. Создайте бота через [@BotFather](https://t.me/BotFather), получите токен
2. В `.env` укажите:
   ```env
   BOT_TOKEN=ваш_токен
   WEBAPP_URL=https://ваш-домен
   DEMO_MODE=false
   ```
3. Установите TON-переменные для реальных платежей (см. раздел [Интеграция с TON](#интеграция-с-ton))
4. Запустите стек: `docker-compose up -d`

---

## 🎮 Что уже работает в MVP

Вы можете прямо сейчас:

| Функциональность | Статус | Описание |
|-----------------|--------|----------|
| ✅ Регистрация/авторизация | Готово | Telegram WebApp initData + JWT (в демо — автоматическое создание тестового пользователя) |
| ✅ Баланс и транзакции | Готово | Любое изменение баланса только через `modifyBalance()` с логированием в `transactions` |
| ✅ Пополнение / вывод | Готово | Демо-пополнение мгновенное, вывод с PIN-кодом (bcrypt), комиссия 1% |
| ✅ 🚀 **Ракета** | Готово | Реальная кривая `e^0.075t`, house edge 10% через `0.90/(1-r)`, WebSocket-тики в реальном времени, защита кассы (макс. ставка 50% от банка), 3D анимация полёта/взрыва/приземления, «красивые полёты» ~3% (когда ракета летит далеко после раннего вывода игрока) |
| ✅ ⚔️ **Дуэль** | Готово | PvP-лобби с открытыми вызовами, отмена/реванш, орёл-решка 50/50, выплата победителю 90%, 3D-подброс монеты с рандомизированной траекторией (скорость, высота, отскоки) |
| ✅ 🔒 **Сейф** | Готово | Ежедневный цикл: 09:00 — создание, 21:00 — фаза взлома, 21:00:30 — подведение итогов. Распределение призов ×1.5 по скорости взлома, пока хватает призового фонда. Бонусный режим (комиссия 5%) если 3+ дня сейф не вскрыт. 3D барабаны с вращающимися цифрами |
| ✅ 💎 **Vault Вклад** | Готово | Блокировка средств на 1/7/14/30 дней с множителями ×1.0/×1.3/×1.6/×2.0. Ежесуточное начисление в 00:00 пропорционально сумме×множителю. Макс. вклад = 10×вчерашний пул, с округлением вниз до первой значащей цифры. Досрочный возврат — тело 100%, доход сгорает. |
| ✅ 👥 Реферальная система | Готово | 3% от каждой ставки приглашённого мгновенно на баланс, навсегда. Ссылка, статистика по приглашённым |
| ✅ 🔐 PIN-код для вывода | Готово | 4 цифры, хранится как bcrypt-хеш |
| ✅ 🔔 Уведомления | Готово | In-app через WebSocket (о зачислении, завершении дуэли, начислении по вкладу и т.п.) |
| ✅ 🔧 Админ-панель | Готово | Статистика пользователей/оборотов, управление кассой Ракеты, ручное пополнение Пула Вклада, изменение настроек платформы, история начислений пула |
| ✅ 🤖 Telegram-бот | Готово | Telegraf-бот с командами `/start`, `/balance`, `/help`, открытие Mini App по кнопке, поддержка реферальных ссылок `/start ref_CODE` |
| ✅ 3D-сцены | Готово | Процедурные модели на Three.js (без внешних ассетов): сейф на онбординг, ракета с огнём/звёздами/взрывом/обломками, монета с ареной, сейф с тремя крутящимися барабанами под красной мигалкой |

---

## 📁 Структура проекта

```
vault/
├── frontend/                      # React + TypeScript + Vite
│   ├── src/
│   │   ├── components/            # Все экраны и UI-компоненты
│   │   │   ├── layout/            # Главный экран, хедер
│   │   │   ├── onboarding/        # 3 экрана онбординга
│   │   │   ├── rocket/            # Экран Ракеты (ставка / полёт / результат)
│   │   │   ├── duel/              # Экран Дуэли (лобби / процесс игры / результат)
│   │   │   ├── safe/              # Экран Сейфа (вклад / взлом / результаты)
│   │   │   ├── vault-deposit/     # Экран Vault Вклада (выбор срока / активный вклад / история)
│   │   │   ├── wallet/            # Пополнение, вывод, установка PIN
│   │   │   ├── profile/           # Профиль, рефералы, админ-панель
│   │   │   └── common/            # Переиспользуемые компоненты
│   │   ├── three/                 # Three.js 3D-сцены (React-компоненты)
│   │   │   ├── main/VaultScene.tsx     # Сейф для онбординга/главной
│   │   │   ├── rocket/RocketScene.tsx # Ракета: взлёт, огонь, взрыв, обломки
│   │   │   ├── duel/DuelScene.tsx     # Дуэль: арена, подброс монеты
│   │   │   └── safe/SafeCrackScene.tsx # Сейф: вращающиеся барабаны, красный свет
│   │   ├── api/
│   │   │   ├── client.ts          # Типизированный REST-клиент (fetch-обёртка)
│   │   │   └── socket.ts          # Socket.io клиент
│   │   ├── stores/auth.ts         # React Context авторизации (пользователь, токен, тосты)
│   │   ├── styles/app.css         # Все стили приложения (mobile-first, тёмная тема)
│   │   └── App.tsx                # Корневой компонент, роутер, провайдер контекста
│   ├── vite.config.ts             # Vite + dev-proxy на бэкенд
│   └── Dockerfile
│
├── backend/                       # Node.js + Express + TypeScript
│   ├── src/
│   │   ├── index.ts               # Точка входа: HTTP сервер, Socket.io, cron, TON listener
│   │   ├── config.ts              # Все константы, переменные окружения, `roundDownClean()`
│   │   ├── api/routes/            # REST-эндпоинты (по разделу на каждый модуль)
│   │   │   ├── user.ts            # Авторизация, профиль, транзакции
│   │   │   ├── wallet.ts          # Пополнение, вывод, PIN
│   │   │   ├── rocket.ts          # Ракета: старт, история, банкролл
│   │   │   ├── duel.ts            # Дуэль: создание, лобби, принятие, отмена
│   │   │   ├── safe.ts            # Сейф: текущий, взнос, взлом, результаты
│   │   │   ├── vault-deposit.ts   # Вклад: статус, блокировка, разблокировка
│   │   │   ├── referral.ts        # Реферальная статистика
│   │   │   └── admin.ts           # Админские эндпоинты
│   │   ├── api/middleware/auth.ts # JWT-авторизация, проверка администратора
│   │   ├── services/              # Бизнес-логика (единый источник истины)
│   │   │   ├── balance.ts         # modifyBalance() — единственный способ менять баланс
│   │   │   ├── rocket.ts          # Расчёт точки взрыва, ставки, кэшаут, красивые полёты
│   │   │   ├── duel.ts            # Создание дуэлей, выплаты, траектория монеты
│   │   │   ├── safe.ts            # Взносы в сейф, расчёт победителей, крон-задачи
│   │   │   ├── vault-deposit.ts   # Блокировка, распределение прибыли, досрочный выход
│   │   │   ├── referral.ts        # Начисление 3% рефоводу
│   │   │   ├── revenue.ts         # Учёт дохода платформы, getSetting/setSetting
│   │   │   ├── ton.ts             # TON-интеграция, демо-пополнение, вывод, PIN
│   │   │   ├── user.ts            # Авторизация, профиль, генерация реф-кода
│   │   │   └── notifications.ts   # Уведомления через WebSocket + рассылка
│   │   ├── websocket/rocket.ts    # WebSocket-тики Ракеты (множитель в реальном времени)
│   │   ├── cron/index.ts          # Ежедневные cron-задачи (09:00 сейф, 21:00 взлом, 00:00 вклад)
│   │   ├── db/
│   │   │   ├── pool.ts            # Подключение к PostgreSQL (pg)
│   │   │   ├── redis.ts           # Подключение к Redis
│   │   │   └── init.sql           # Схема БД + сид начальных настроек и $1500 банкролла
│   │   └── types/                 # TypeScript типы
│   ├── tsconfig.json
│   ├── Dockerfile
│   └── package.json
│
├── bot/                           # Telegram-бот (Telegraf)
│   └── src/index.ts               # Команды /start, /balance, /help, открытие Mini App
│
├── db/                            # Кастомный Dockerfile для PostgreSQL
│   ├── Dockerfile                 # Копирует init.sql внутрь образа при сборке
│   └── init.sql                   # Схема БД + сид настроек и $1500 банкролла
│
├── docker-compose.yml             # Вся инфраструктура одной командой
├── .env.example                   # Пример переменных окружения
├── ARCHITECTURE.md                # Подробное описание архитектуры
└── README.md                      # Этот файл
```

---

## 🔌 API эндпоинты

Все эндпоинты (кроме `/api/auth/telegram`) требуют заголовок `Authorization: Bearer <JWT>`.

### Авторизация и профиль
| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/api/auth/telegram` | Авторизация по Telegram initData или демо-строке |
| GET | `/api/profile` | Получить профиль пользователя (баланс, настройки, статистика) |
| PATCH | `/api/profile` | Обновить настройки (кошелёк вывода, автоненаправление в сейф, уведомления) |
| GET | `/api/transactions?limit=50` | История транзакций |

### Кошелёк
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/wallet/deposit-address` | Получить адрес для пополнения |
| POST | `/api/wallet/demo-deposit` | Демо-пополнение (только в `DEMO_MODE`) |
| POST | `/api/wallet/withdraw` | Вывод средств (`{amount, pin, address}`) |
| POST | `/api/wallet/set-pin` | Установить PIN-код вывода (4 цифры) |

### 🚀 Ракета
| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/api/rocket/start` | Сделать ставку, получить `round_id` и `crash_at` |
| GET | `/api/rocket/history?limit=50` | История последних раундов |
| GET | `/api/rocket/bankroll` | Текущий размер кассы |
| WS | `/rocket` | Канал тиков: события `tick {multiplier, elapsed}`, `crash {crash_at}`, `cashout` |

### ⚔️ Дуэль
| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/api/duel/create` | Создать вызов (`{amount}`) |
| GET | `/api/duel/lobby` | Список открытых вызовов |
| POST | `/api/duel/accept/:id` | Принять вызов, мгновенный розыгрыш |
| POST | `/api/duel/cancel/:id` | Отменить свой вызов, вернуть средства |
| GET | `/api/duel/history` | Последние завершенные дуэли |
| GET | `/api/duel/:id` | Данные дуэли для реплея |

### 🔒 Сейф
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/safe/current` | Текущий дневной сейф + ваш вклад |
| POST | `/api/safe/deposit` | Внести средства (`{amount}`) |
| POST | `/api/safe/cancel` | Отменить свой вклад до 21:00 |
| POST | `/api/safe/crack` | Отправить время взлома (`{time_ms}`) |
| GET | `/api/safe/results/:id` | Результаты сейфа с победителями |

### 💎 Vault Вклад
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/vault/status` | Активный вклад, история, данные пула (базовая ставка вчера, макс. вклад) |
| POST | `/api/vault/lock` | Заблокировать сумму на срок (`{amount, term_days}`) |
| POST | `/api/vault/early-unlock` | Досрочный возврат тела (`{deposit_id}`) |

### 👥 Рефералы
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/referral/stats` | Реф. ссылка, количество приглашённых, заработок |

### 🔧 Админка
| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/admin/stats` | Полная статистика платформы |
| POST | `/api/admin/rocket-bankroll` | Добавить/забрать из кассы Ракеты |
| POST | `/api/admin/add-pool` | Ручное добавление в Пул Вклада |
| GET/POST | `/api/admin/settings` | Получить/сохранить настройки (комиссии, проценты, лимиты) |

---

## 🧪 Тестирование математики

Весь движок изолирован в сервисах в `backend/src/services/`.
Пример теста алгоритма ракеты (можно выполнить в `node` после сборки):

```javascript
const { calculateCrashPoint } = require('./backend/dist/services/rocket');
// 10000 симуляций при ставке $10, банкролл $1500:
let totalWagered = 0, totalPaid = 0;
for (let i = 0; i < 10000; i++) {
  const bet = 10;
  const crash = calculateCrashPoint(bet, 1500 + totalWagered * 0.9 - totalPaid);
  totalWagered += bet;
  // Допустим игрок всегда забирает на x2.0
  if (crash >= 2.0) totalPaid += bet * 2;
}
console.log('House edge:', (1 - totalPaid/totalWagered * 0.9) * 100, '%');
// Ожидается ~10% ± дисперсия
```

---

## 🔧 Интеграция с TON

По умолчанию проект запускается в демо-режиме, где все переводы фейковые. Для подключения реальной сети TON нужно:

1. Создать кошелёк проекта, сохранить мнемонику
2. Деплоить USDT Jetton (использовать существующий в mainnet: `EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs` или сеть testnet)
3. Заполнить переменные в `.env`:
   ```env
   DEMO_MODE=false
   TON_API_KEY=ваш_ключ_от_toncenter_или_tonapi
   TON_WALLET_MNEMONIC=24 слова мнемоники проекта
   USDT_JETTON_ADDRESS=EQ...
   ADMIN_TELEGRAM_IDS=ваш_telegram_id
   BOT_TOKEN=токен_бота
   WEBAPP_URL=https://vault-app.com
   ```
4. Дописать логику в `backend/src/services/ton.ts`:
   - `startDepositListener()` — слушать входящие Jetton транзакции на кошельки пользователей, зачислять баланс
   - Реальная отправка USDT в `processWithdrawal()` вместо демо-транзакции

Все места, которые нужно доработать, помечены комментарием `// TODO: TON mainnet`.

---

## 🚧 Roadmap до production

1. **Блокчейн**: реальная интеграция с TON (listener + отправка USDT)
2. **Безопасность**:
   - Проверка HMAC подписи Telegram initData
   - Server-side валидация времени взлома Сейфа (сейчас измеряется на клиенте)
   - Rate limiting по IP/пользователю (заглушки в конфиге готовы)
   - Детекция мультиаккаунтов (один TON-кошелёк = один аккаунт)
3. **Геймплей**:
   - Реплеи всех игр в формате ~200 байт JSON (кнопка ▶️)
   - Поделиться реплеем
   - Звуковое сопровождение
   - Система уведомлений в Telegram (не только in-app)
   - Мёртвые балансы (30 дней без активности → перевод в призовой фонд Сейфа)
4. **3D и перформанс**:
   - Замена процедурных моделей на качественные GLTF (сейф, ракета, монета)
   - Fallback на 2D при FPS < 20
   - Оптимизация текстур (WebP, до 1024×1024)
   - Полигонаж до 5k на модель
5. **Инфраструктура**:
   - Let's Encrypt SSL
   - Ежедневные бэкапы БД
   - Нагрузочное тестирование (100 одновременных пользователей)
   - Мониторинг

---

## 💡 Экономическая модель (в цифрах, из ТЗ)

**Единая комиссия 10%** с каждой ставки/вклада. Вывод — 1%.

Распределение комиссии на каждые **$100** ставки:
- $90 — идёт в игру (касса Ракеты / приз победителя Дуэли / призовой фонд Сейфа)
- $3 — рефоводу (если нет — админу)
- $1.05 — в Пул Вклада (15% от $7, оставшихся после выплаты рефовода)
- $5.95 — чистый доход админа

При обороте **$10,000/день** ожидается ~$608 чистого дохода админа в день (~$18,240/мес до операционных расходов).

---

## 📞 Контрибьюция

Перед отправкой PR убедитесь, что:
- `cd backend && npx tsc --noEmit` выполняется без ошибок
- `cd frontend && npx tsc --noEmit` выполняется без ошибок
- `cd frontend && npm run build` собирает фронтенд
- Вы добавили тесты для новой игровой математики (если меняли формулы)
- Обновили этот README и ARCHITECTURE.md при изменении архитектуры

---

## 📄 Лицензия

MIT

## Security and access control

The non-blockchain security stage is implemented:

- Redis-backed general and endpoint-specific rate limits with an in-memory outage fallback;
- 15-minute PIN lockout after five failed attempts and a withdrawal rate limit;
- bounded JSON and strict money/PIN validation before service execution;
- administrator access requires both an allowed Telegram ID and `ADMIN_PASSWORD`;
- every mutating administrator request is written to `admin_audit_log` with sensitive fields redacted;
- privacy-preserving HMAC hashes of IP/device identifiers detect shared-account patterns;
- one withdrawal wallet cannot be linked to multiple users;
- the admin panel contains antifraud review and financial reconciliation views;
- Redis coordinates Socket.io across instances and leases cron/Rocket launch work;
- CORS is restricted by `ALLOWED_ORIGINS`.

Required secrets are documented in `.env.example`. Real Telegram `initData` signature validation and real TON wallet checks intentionally remain in the final Telegram/TON stage.

### Локальный вход в админку

Docker Compose передаёт `ADMIN_PASSWORD` в backend. Если корневого `.env` нет, локальный пароль — **`admin`**. Чтобы использовать свой пароль:

```bash
cp .env.example .env
# измените ADMIN_PASSWORD в .env
docker compose up -d --build backend frontend
```

После неправильного пароля обновите страницу админки: ошибочное значение удаляется из `sessionStorage`, и приложение запросит пароль снова. Строки `replace_with_...` в старом `.env.example` были обозначениями-заглушками, а не фактически переданными контейнеру значениями.
