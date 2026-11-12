# 🧰 Инструменты агента: что запускать и когда

Каталог проверяемых инструментов репозитория. Назначение — чтобы **любой** агент
(не только автор) нашёл нужную проверку без чтения исходников.

Правило: если инструмент меняет файлы — он не входит в `npm run verify`.
Проверки, которые только читают, — входят.

## Быстрый выбор

| Что нужно проверить | Команда | Где работает |
|---|---|---|
| Ничего не сломано во всём репо | `npm run verify` | везде (node + python3) |
| Математика 3D-анимаций, шейдеры | `cd frontend && npm test` | везде |
| **Как выглядит сцена** (кадры) | `cd frontend && npm run eyes` | **только CI** — нужен браузер |
| Бюджет 3D-модели (вес, VRAM, трейсы) | `python3 tools/modeling/audit_glb.py <файл>` | везде |
| Модель реально загрузится three.js | `node tools/modeling/validate_glb.mjs <файл>` | нужен `frontend/node_modules` |
| Модель тяжелее бюджета — ужать | `node tools/modeling/shrink_glb.mjs <файл>` | нужен `frontend/node_modules` |
| Звук (громкость, клиппинг, формат) | `python3 tools/audio/audit_audio.py` | везде |

## 1. Глаза: кадры 3D-сцен (`npm run eyes`)

Подробно — [../eyes.md](../eyes.md). Кратко:

- Поднимает dev-сервер Vite, снимает `/scenes.html` в 12 PNG за 6 секунд.
- Работает **только там, где есть Chromium** (CI). В песочнице агента браузера нет:
  скрипт печатает причину и выходит с кодом 0 — это не ошибка.
- В CI кадры уезжают артефактом `scene-frames`, а сводная картинка коммитится
  в ветку как `frontend/frames/preview.jpg`.

**Забрать кадр агенту:**

```bash
gh api "repos/creative-textile/vault/contents/frontend/frames/preview.jpg?ref=<ветка>" \
  -H "Accept: application/vnd.github.raw" > preview.jpg
```

**Ловушка, уже поймана:** `vite preview` раздаёт `dist/`, куда `scenes.html`
намеренно не входит. Он отдаёт `index.html` с кодом **200**, и в кадр попадает
онбординг вместо 3D. Поэтому сервер проверяется по содержимому (`scenes.tsx`),
а не по коду ответа. Не «оптимизируйте» это обратно на `preview`.

## 2. Модели: три шага

```bash
# 1) бюджет
python3 tools/modeling/audit_glb.py frontend/public/models/safe.glb

# 2) если вне бюджета — ужать (пишет рядом .shrunk.glb)
node tools/modeling/shrink_glb.mjs frontend/public/models/safe.glb --size 512

# 3) ОБЯЗАТЕЛЬНО проверить, что модель разбирается three.js
node tools/modeling/validate_glb.mjs frontend/public/models/safe.shrunk.glb
```

**Почему шаг 3 обязателен.** Аудит читает JSON и структуру, но не загружает
модель. Уже поймано: модель, ужатая в **WebP**, проходила аудит, а `GLTFLoader`
падал с `WebP required by asset but unsupported` — у игрока был бы процедурный
fallback вместо сейфа. `shrink_glb.mjs` поэтому пишет **JPEG**, он читается везде.

**Ловушка аудита (исправлена).** Раньше VRAM считался только для PNG, а для JPEG
молча возвращал 0. После сжатия аудит показывал «VRAM ≈ 0 Б» — ложное «всё
хорошо», хотя текстура 1024×1024 занимает 5.3 МБ. Теперь размеры читаются из
заголовка JPEG.

## 3. Что запускать перед PR

```bash
npm run verify                      # обязательно, зелёный до PR
cd frontend && npm test             # если трогали сцены
python3 tools/modeling/audit_glb.py frontend/public/models/*.glb   # если трогали модели
node tools/modeling/validate_glb.mjs <изменённая модель>           # если трогали модели
```

Кадры (`npm run eyes`) локально не запустятся — их снимет CI. Результат смотреть
глазами: `frontend/frames/preview.jpg` в ветке.

## Чего в наборе нет (осознанно)

- **Запись видео/GIF** — 12 кадров дают ту же информацию о движении дешевле.
- **FPS из CI** — SwiftShader считает на CPU, числа ничего не говорят о телефоне.
  Гейт 30 FPS проверяется только на реальном устройстве.
- **Авто-тест «красиво ли»** — вкус не автоматизируется. Кадры смотрит человек
  или агент, но решение «нормально» остаётся за Мастером.
