# Приёмка: сейф V-1-1 (карточка K1)

Референс: `docs/art-direction/refs/src/01-safe.jpg` (direction C+A).

## Кадры (256×256)

| Файл | Содержание | Доказательство |
|---|---|---|
| `render_closed_color.png` / `_bw.png` | Общий вид, дверь закрыта | тёмный steel-корпус, золотой штурвал, красная табличка |
| `render_open_color.png` / `_bw.png` | Открытая дверь | золотые слитки+монеты внутри (золотой свет) |
| `render_wheel_color.png` / `_bw.png` | Крупный план штурвала | золотой штурвал (обод+спицы+ручки), красная табличка |

## Программная проверка (pixel proof)

```
python3 tools/modeling/audit_glb.py frontend/public/models/safe.glb   # rc=0
bash tools/modeling/setup_bpy.sh --check                              # rc=0
npm run verify                                                        # rc=0
```

Pixel-анализ (bpy, numpy):
- closed: gold frac 0.056 (wheel+pins), red pixels present (plate), dark steel body
- open: gold frac 0.002 (bars inside, lit by gold point light)
- wheel: gold frac 0.026, red frac 0.003 (plate visible in close-up)

## Пайплайн

`tools/modeling/scenes/safe.py` → `safe.blend` → `safe.glb` (export_yup,
NLA_TRACKS animation mode, KHR_meshopt) + `render_safe_acceptance.py`
(Cycles CPU, 640×480×3, stitch → preview.jpg/png + 256×256 acceptance).

 бюджет: audit_glb.py rc=0 (tris 11 128, prims 12, mats 4, tex 4, 949 КиБ).
