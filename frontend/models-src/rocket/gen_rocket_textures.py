#!/usr/bin/env python3
"""
Процедурные текстуры корпуса ракеты (детерминированные).
Развёртка корпуса: u — угол вокруг оси, v — высота (0 = сопло, 1 = нос).
  rocket_map.png    1024x1024 — белый перламутр, расшивка панелей, маркировка
  rocket_orm.png    1024x1024 — R=AO, G=roughness (копоть у сопла), B=metalness
  rocket_normal.png 1024x1024 — канавки панелей + заклёпки
"""
import os
import numpy as np
from PIL import Image, ImageFilter, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'textures', 'rocket')
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(42)
S = 1024


def save(name, arr):
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).save(os.path.join(OUT, name))
    print('  wrote', name)


yy, xx = np.mgrid[0:S, 0:S]
u = xx / S          # вокруг корпуса
v = 1.0 - yy / S    # 0 низ (сопло) → 1 нос

base = np.array([244, 246, 251], dtype=np.float32)
col = np.repeat(base[None, None, :], S, axis=0).repeat(S, axis=0).reshape(S, S, 3)

# Лёгкая перламутровая пятнистость
noise = rng.normal(0, 1, (S // 8 + 2, S // 8 + 2))
nz = np.asarray(Image.fromarray(np.clip(noise * 30 + 128, 0, 255).astype(np.uint8), 'L')
                .resize((S, S), Image.BILINEAR), dtype=np.float32) / 255.0
col *= (0.97 + 0.06 * nz)[..., None]

# Расшивка панелей: горизонтальные кольца + вертикальные швы
lines = np.zeros((S, S), dtype=np.float32)
for fy in (0.18, 0.34, 0.52, 0.68, 0.82):
    lines[int(S * (1 - fy)) - 1:int(S * (1 - fy)) + 2, :] = 1.0
for fx in (0.125, 0.375, 0.625, 0.875):
    lines[:, int(S * fx) - 1:int(S * fx) + 2] = 1.0
lines_blur = np.asarray(Image.fromarray((lines * 255).astype(np.uint8), 'L')
                        .filter(ImageFilter.GaussianBlur(0.8)), dtype=np.float32) / 255.0
col *= (1.0 - lines_blur[..., None] * 0.28)

# Заклёпки вдоль швов: точки
riv_img = Image.fromarray(np.zeros((S, S), np.uint8), 'L')
dr = ImageDraw.Draw(riv_img)
for fy in (0.18, 0.34, 0.52, 0.68, 0.82):
    for k in range(48):
        x = int((k + 0.5) / 48 * S)
        y = int(S * (1 - fy))
        dr.ellipse([x - 2, y - 2, x + 2, y + 2], fill=200)
riv = np.asarray(riv_img, dtype=np.float32) / 255.0
col *= (1.0 - riv[..., None] * 0.25)

# Маркировка: красная полоса у носа + золотая лента (дизайн-система)
band_red = ((v > 0.60) & (v < 0.66)).astype(np.float32)
band_gold = ((v > 0.55) & (v < 0.575)).astype(np.float32)
col = col * (1 - band_red[..., None]) + band_red[..., None] * np.array([216, 31, 63])
col = col * (1 - band_gold[..., None]) + band_gold[..., None] * np.array([245, 197, 66])

# Копоть у сопла: затемнение низа
soot = np.clip((0.22 - v) / 0.22, 0, 1) ** 1.6
soot = soot * (0.75 + 0.25 * nz)
col *= (1.0 - soot[..., None] * 0.8)
save('rocket_map.png', col)

# ORM
rough = np.full((S, S), 0.34 * 255)
rough += lines_blur * 60
rough += soot * 120                      # копоть — матовая
rough *= (0.92 + 0.16 * nz)
metal = np.full((S, S), 0.18 * 255)      # крашеный корпус
metal += soot * (0.9 - 0.18) * 255       # у сопла голый металл
orm = np.stack([np.full((S, S), 255.0), rough, metal], axis=-1)
save('rocket_orm.png', orm)

# Normal: канавки + заклёпки
height = -lines_blur * 1.2 + riv * 0.5
dy, dx = np.gradient(height.astype(np.float32))
nx, ny, nzz = -dx * 3.0, -dy * 3.0, np.ones_like(dx)
n = np.stack([nx, ny, nzz], -1)
n /= np.linalg.norm(n, axis=-1, keepdims=True)
save('rocket_normal.png', (n * 0.5 + 0.5) * 255)
print('rocket textures done')
