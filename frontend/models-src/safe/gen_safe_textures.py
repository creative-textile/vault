#!/usr/bin/env python3
"""
Процедурные PBR-текстуры сейфа (детерминированные, без внешних ассетов).

Выход (1024×1024, если не указано иначе):
  steel_map.png    — цвет воронёной стали: брашированный металл + швы панелей
  steel_normal.png — микрорельеф: брашинг + царапины + фаски швов
  steel_orm.png    — glTF-упаковка: R=AO(≈1), G=roughness, B=metalness
  gold_map.png     — цвет золота (512)
  gold_orm.png     — roughness/металл золота с потёртостями (512)

Износ по ТЗ 7.2: потёртости на кромках панелей (сниженная roughness у швов —
там, за что берутся руками), микроцарапины в normal-карте.
"""
import os
import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'textures', 'safe')
os.makedirs(OUT, exist_ok=True)

rng = np.random.default_rng(20260916)


def save(name: str, arr: np.ndarray) -> None:
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).save(os.path.join(OUT, name))
    print('  wrote', name, arr.shape)


def value_noise(size: int, cell: int, amp: float) -> np.ndarray:
    """Плавный шум: апскейл сетки случайных значений (билинейно)."""
    small = rng.random((size // cell + 2, size // cell + 2))
    img = Image.fromarray((small * 255).astype(np.uint8), 'L')
    img = img.resize((size, size), Image.BILINEAR)
    return (np.asarray(img, dtype=np.float32) / 255.0 - 0.5) * amp


def height_to_normal(height: np.ndarray, strength: float) -> np.ndarray:
    dy, dx = np.gradient(height.astype(np.float32))
    nx = -dx * strength
    ny = -dy * strength
    nz = np.ones_like(nx)
    n = np.stack([nx, ny, nz], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return (n * 0.5 + 0.5) * 255.0


# ═══════════════════════════ СТАЛЬ (1024) ═══════════════════════════════════
S = 1024

# Горизонтальный брашинг: строковые шумовые полосы
brush = rng.normal(0, 1, (S, 1)).astype(np.float32)
brush = np.repeat(brush, S, axis=1)
brush_img = Image.fromarray(np.clip(brush * 18 + 128, 0, 255).astype(np.uint8), 'L')
brush = np.asarray(brush_img.filter(ImageFilter.GaussianBlur(0.6)), dtype=np.float32) / 128.0 - 1.0

height = brush * 0.35
height += value_noise(S, 128, 0.5)   # крупная пятнистость
height += value_noise(S, 24, 0.25)   # средняя

# Швы панелей: сетка 3×2 (каркас сейфа читается даже на расстоянии)
seams = np.zeros((S, S), dtype=np.float32)
for fx in (0.33, 0.66):
    seams[:, int(S * fx) - 2:int(S * fx) + 2] = 1.0
for fy in (0.5,):
    seams[int(S * fy) - 2:int(S * fy) + 2, :] = 1.0
seams_img = Image.fromarray((seams * 255).astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(2.2))
seams = np.asarray(seams_img, dtype=np.float32) / 255.0
height -= seams * 1.6

# Царапины: тонкие линии под случайными углами
scratch_layer = Image.new('L', (S, S), 0)
from PIL import ImageDraw
dr = ImageDraw.Draw(scratch_layer)
for i in range(46):
    x0, y0 = rng.integers(0, S, 2)
    ang = rng.uniform(0, np.pi)
    ln = rng.integers(40, 260)
    x1 = int(x0 + np.cos(ang) * ln) % S
    y1 = int(y0 + np.sin(ang) * ln) % S
    dr.line([(int(x0), int(y0)), (x1, y1)], fill=int(rng.integers(60, 130)),
            width=int(rng.integers(1, 3)))
scratches = np.asarray(scratch_layer, dtype=np.float32) / 255.0
height += scratches * 0.55

# ── Карта цвета ──
base = np.array([58, 63, 87], dtype=np.float32)          # #3a3f57 из lib/materials
col = base[None, None, :] * (1.0 + (brush * 0.05)[..., None])
col *= (1.0 + value_noise(S, 128, 0.12)[..., None])
col *= (1.0 - seams[..., None] * 0.35)                   # швы темнее
col *= (1.0 - scratches[..., None] * 0.12)
save('steel_map.png', col)

# ── Normal ──
save('steel_normal.png', height_to_normal(height, 2.6))

# ── ORM: R=AO, G=roughness, B=metalness ──
rough = np.full((S, S), 118.0)                            # ≈0.46
rough += value_noise(S, 96, 46.0)
rough += brush * 8
rough += seams * 46                                       # швы грубее
# Потёртости до блеска вокруг швов и по центру (там, за что берутся)
worn = Image.fromarray((seams * 255).astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(14))
worn = np.asarray(worn, dtype=np.float32) / 255.0
rough -= worn * 34
rough -= scratches * 18                                   # царапины полируют? нет — блестят
metal = np.full((S, S), 236.0)
# Сколы краски: редкие пятна с низкой металличностью
chips = (value_noise(S, 16, 1.0) > 0.86).astype(np.float32)
chips = Image.fromarray((chips * 255).astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(0.7))
chips = np.asarray(chips, dtype=np.float32) / 255.0
metal -= chips * 120
orm = np.stack([np.full((S, S), 255.0), rough, metal], axis=-1)
save('steel_orm.png', orm)

# ═══════════════════════════ ЗОЛОТО (512) ═══════════════════════════════════
G = 512
gbrush = rng.normal(0, 1, (G, 1)).astype(np.float32)
gbrush = np.repeat(gbrush, G, axis=1)
gbrush_img = Image.fromarray(np.clip(gbrush * 14 + 128, 0, 255).astype(np.uint8), 'L')
gbrush = np.asarray(gbrush_img.filter(ImageFilter.GaussianBlur(0.5)), dtype=np.float32) / 128.0 - 1.0

gcol = np.array([245, 197, 66], dtype=np.float32)          # #f5c542 — золото дизайн-системы
gcol = gcol[None, None, :] * (1.0 + (gbrush * 0.06)[..., None])
gcol *= (1.0 + value_noise(G, 64, 0.10)[..., None])
save('gold_map.png', gcol)

grough = np.full((G, G), 56.0)                             # ≈0.22 полированное
grough += value_noise(G, 48, 26.0)
gscratch = Image.new('L', (G, G), 0)
dr2 = ImageDraw.Draw(gscratch)
for i in range(60):
    x0, y0 = rng.integers(0, G, 2)
    ang = rng.uniform(0, np.pi)
    ln = rng.integers(20, 140)
    dr2.line([(int(x0), int(y0)), (int((x0 + np.cos(ang) * ln) % G), int((y0 + np.sin(ang) * ln) % G))],
             fill=int(rng.integers(40, 110)), width=1)
gs = np.asarray(gscratch, dtype=np.float32) / 255.0
grough += gs * 60                                          # потёртости кромочные
gorm = np.stack([np.full((G, G), 255.0), grough, np.full((G, G), 255.0)], axis=-1)
save('gold_orm.png', gorm)

print('safe textures done')
