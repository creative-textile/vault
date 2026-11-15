# 3D-пайплайн Vault (локальный ПК)

**D-125:** pip-модуль `bpy`, X11/GL-стабы, `setup_bpy.sh`, `env_setup.sh` и
«восстановление окружения после рестарта песочницы» удалены. Нужен обычный
нативный Blender, запускаемый headless.

## 1. Установка

1. Скачать **Blender 5.3.0 portable** (`blender-5.3.0-windows-x64.zip`),
   распаковать, например, в `C:\tools\blender-5.3.0\`.
2. В `.env`: `BLENDER_EXE=C:/tools/blender-5.3.0/blender.exe`.
3. `npm run blender:check` — сверит версию с
   [`blender-version.json`](blender-version.json), создаст куб, экспортирует GLB
   и сделает CPU-рендер 640×360 в `.state/blender/`.

Обёртка [`../local/blender.mjs`](../local/blender.mjs) всегда ставит
`--background --factory-startup --gpu-backend opengl -t 2 --python-exit-code 1`.
На 6 ГБ RAM и HD 620/940MX это надёжнее Vulkan по умолчанию. Если 5.3 не
заводится — `npm run blender:check -- --allow-lts` с 5.2.4 LTS.

Для генерации текстур **не нужен bpy**: системный Python 3.11+ с Pillow/numpy.

```powershell
py -3 -m pip install pillow numpy
npm run py:check
node tools/local/py.mjs --script frontend/models-src/coin/gen_coin_textures.py
```

## 2. Сборка моделей

```powershell
# сцена из скрипта (GLB + .blend + превью)
node tools/local/blender.mjs --script frontend/models-src/coin/build_coin.py
node tools/local/blender.mjs --script frontend/models-src/rocket/build_rocket.py
node tools/local/blender.mjs --script frontend/models-src/safe/build_safe.py

# приёмочные кадры сейфа (Cycles, CPU)
node tools/local/blender.mjs --script tools/modeling/scenes/render_safe_acceptance.py
```

Исходники `.blend` в репозитории созданы в **4.5.3**. Не пересохраняйте их в
5.3 до зелёных гейтов: 5.3 меняет glTF-экспорт (KTX2, animation pointers,
фиксы NLA), а `.blend` новой версии не открывается в старой.

## 3. Три обязательных гейта (два независимых замера)

```bash
# 1) числа: вес, полигоны, VRAM
npm run modeling:audit          # или python3 tools/modeling/audit_glb.py <файл>

# 2) реальная загрузка three.js — аудит JSON её не проверяет
node tools/modeling/validate_glb.mjs frontend/public/models/safe.glb

# 3) глаза: кадры сцен
cd frontend && npm run eyes
```

`tools/modeling/budget.json` — числа бюджета. Ловушки, уже пойманные практикой:

- аудит по весу проходит, а `GLTFLoader` падает на **WebP** → всегда проверять
  шагом 2; `shrink_glb.mjs` поэтому пишет **JPEG**;
- VRAM для JPEG когда-то считался нулём → теперь размеры читаются из заголовка;
- `vite preview` вместо dev-сервера отдаёт `index.html` с кодом 200, и в кадр
  попадает онбординг, а не 3D-сцена.

## 4. Что где

| Файл | Роль |
|---|---|
| `blender-version.json` | зафиксированная версия, аргументы, параметры рендера |
| `smoke.py` | куб → GLB → CPU-рендер, печать фактов |
| `audit_glb.py` | бюджет без Blender и зависимостей |
| `validate_glb.mjs` | GLB разбирается three.js (нужны `frontend/node_modules`) |
| `shrink_glb.mjs` | ужатие в бюджет, JPEG 512 |
| `scenes/` | сцены и приёмочные рендеры сейфа |
| `../local/blender.mjs`, `../local/py.mjs` | кросс-платформенные обёртки |

## 5. Чего здесь нет осознанно

Записи видео/GIF (12 кадров дешевле), FPS из CI (SwiftShader считает на CPU,
гейт 30 FPS — только на устройстве), автоматического «красиво ли» (вкус не
автоматизируется; визуальная подпись — за Мастером).
