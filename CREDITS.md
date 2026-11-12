# CREDITS — источники и инструменты ассетов

Правило репозитория: **файл без строки в этом документе не попадает в Git**.

## frontend/public/models/safe.glb — сейф миссии V-1-1 (карточка K1)

 rebuild: 2026-11-12 (режим C+A, референс `docs/art-direction/refs/src/01-safe.jpg`).

| Файл | Описание | Инструмент |
|---|---|---|
| `frontend/models-src/safe/safe.blend` | Исходник сцены (Blender 4.5) | `tools/modeling/scenes/safe.py` |
| `frontend/public/models/safe.glb` | Доставка (glTF 2.0 binary, KHR_meshopt) | экспортер Blender 4.5 (`export_yup`, `export_animation_mode='NLA_TRACKS'`) |
| `frontend/public/models/safe.preview.jpg/.png` | Превью 3 кадра (общий вид, открытая дверь, штурвал) | `tools/modeling/scenes/render_safe_acceptance.py` (Cycles CPU) |
| `docs/art-direction/acceptance/safe/render_*.png` | Приёмочные кадры 256×256 (цвет + светло-серый силуэт) | то же |
| `frontend/models-src/safe/textures/safe/*.png` | 4 текстуры PBR (сталь, золото — map+orm) | генерация (процедурные, 512×512) |

**Конструкция (карточка K1):** корпус с толщиной металла (плинт+корпус+рама,
один steel-меш), две петли (стальные блоки + золотые цапфы), три ригеля
(хром), золотой штурвал (обод+ступица+3 спицы+3 ручки), красная табличка
с золотыми заклёпками, золотые слитки+монеты внутри, обойма (хром).

**Анимации (60 fps):** open 3.0 с (ригели→штурвал 3π→дверь -1.12 rad),
idle 3.0 с (±2°), spin 1.5 с. Клипы как NLA-strips → 3 glTF-animации.

**Бюджет (audit_glb.py, rc=0):** tris 11 128 ≤ 25 000, primitive 12 ≤ 12,
материалы 4 ≤ 4, текстуры 4 ≤ 4 (459 КиБ), общий вес 949 КиБ ≤ 1.2 МБ,
VRAM ≈ 13.3 МиБ.

## frontend/models-src/safe/build_safe.py

Исходный скрипт сборки (предшественник, сохраняется для истории).
Текущий пайплайн — `tools/modeling/scenes/safe.py` (общие хелперы в
`tools/modeling/scenes/common/`).
