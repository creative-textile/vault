#!/usr/bin/env python3
"""
Текстуры монеты Дуэли (детерминированные): чеканка орла/решки и насечка гурта.
Выход (512²): coin_heads_map/normal/orm, coin_tails_map/normal/orm, coin_edge_normal.
Рельеф рисуется в heightmap → normal; карта цвета — золото с затемнёнными
впадинами (свет НЕ запекается, только материал).
"""
import os
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'textures', 'coin')
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)
S = 512
CX = CY = S / 2


def save(name, arr):
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).save(os.path.join(OUT, name))
    print('  wrote', name)


def height_to_normal(h, strength=3.0):
    dy, dx = np.gradient(h.astype(np.float32))
    n = np.stack([-dx * strength, -dy * strength, np.ones_like(dx)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return (n * 0.5 + 0.5) * 255


def base_height():
    """Общий рельеф: буртик по краю + бусины."""
    h = np.zeros((S, S), np.float32)
    img = Image.fromarray((h * 255).astype(np.uint8), 'L')
    dr = ImageDraw.Draw(img)
    # буртик
    dr.ellipse([14, 14, S - 14, S - 14], outline=200, width=10)
    # бусины
    for k in range(48):
        a = k / 48 * 2 * math.pi
        x = CX + math.cos(a) * (S / 2 - 40)
        y = CY + math.sin(a) * (S / 2 - 40)
        dr.ellipse([x - 5, y - 5, x + 5, y + 5], fill=170)
    h = np.asarray(img, np.float32) / 255.0
    return h


def star_points(cx, cy, r_out, r_in, n=5, rot=-math.pi / 2):
    pts = []
    for i in range(n * 2):
        r = r_out if i % 2 == 0 else r_in
        a = rot + i * math.pi / n
        pts.append((cx + math.cos(a) * r, cy + math.sin(a) * r))
    return pts


def heads_height():
    h = base_height()
    img = Image.fromarray((h * 255).astype(np.uint8), 'L')
    dr = ImageDraw.Draw(img)
    # ОРЁЛ: звезда в лучах (как в процедурной чеканке сцены)
    dr.polygon(star_points(CX, CY, 150, 62), fill=230)
    for k in range(12):
        a = k / 12 * 2 * math.pi + 0.26
        x0 = CX + math.cos(a) * 165
        y0 = CY + math.sin(a) * 165
        x1 = CX + math.cos(a) * 195
        y1 = CY + math.sin(a) * 195
        dr.line([(x0, y0), (x1, y1)], fill=200, width=8)
    h = np.asarray(img, np.float32) / 255.0
    return h


def tails_height():
    h = base_height()
    img = Image.fromarray((h * 255).astype(np.uint8), 'L')
    dr = ImageDraw.Draw(img)
    # РЕШКА: герб хранилища — круглая дверь хранилища со штурвалом
    dr.ellipse([CX - 150, CY - 150, CX + 150, CY + 150], outline=230, width=16)
    dr.ellipse([CX - 96, CY - 96, CX + 96, CY + 96], outline=210, width=10)
    for k in range(3):
        a = k / 3 * 2 * math.pi - math.pi / 2
        dr.line([(CX, CY), (CX + math.cos(a) * 92, CY + math.sin(a) * 92)], fill=220, width=14)
    dr.ellipse([CX - 26, CY - 26, CX + 26, CY + 26], fill=235)
    h = np.asarray(img, np.float32) / 255.0
    return h


def color_from_height(h):
    gold = np.array([245, 197, 66], np.float32)
    col = gold[None, None, :] * (0.72 + 0.38 * h)[..., None]
    # микрошум металла
    noise = rng.normal(0, 1, (S // 4 + 2, S // 4 + 2))
    nz = np.asarray(Image.fromarray(np.clip(noise * 20 + 128, 0, 255).astype(np.uint8), 'L')
                    .resize((S, S), Image.BILINEAR), np.float32) / 255.0
    col *= (0.97 + 0.06 * nz)[..., None]
    # потёртости: редкие светлые царапины
    return col


def orm_from_height(h):
    rough = 0.22 * 255 * np.ones((S, S), np.float32)
    rough += (1 - h) * 30                 # впадины матовее
    orm = np.stack([np.full((S, S), 255.0), rough, np.full((S, S), 255.0)], -1)
    return np.round(orm / 16) * 16        # постеризация → маленький PNG


for name, hfn in (('heads', heads_height), ('tails', tails_height)):
    h = hfn()
    h = np.asarray(Image.fromarray((h * 255).astype(np.uint8), 'L')
                   .filter(ImageFilter.GaussianBlur(0.7)), np.float32) / 255.0
    col = np.asarray(Image.fromarray(np.clip(color_from_height(h), 0, 255).astype(np.uint8))
             .filter(ImageFilter.GaussianBlur(0.5)), np.float32)
    save(f'coin_{name}_map.png', col)
    save(f'coin_{name}_normal.png', height_to_normal(h, 3.2))
    save(f'coin_{name}_orm.png', orm_from_height(h))

# Гурт: вертикальная насечка
E = 256
edge = np.zeros((E, E), np.float32)
for k in range(64):
    x0 = int(k / 64 * E)
    edge[:, x0:x0 + 3] = 1.0
edge = np.asarray(Image.fromarray((edge * 255).astype(np.uint8), 'L')
                  .filter(ImageFilter.GaussianBlur(1.0)), np.float32) / 255.0
# развёртка гурта: u вдоль окружности, v по толщине → normal с горизонт. штрихами
save('coin_edge_normal.png', height_to_normal(edge, 2.0))
print('coin textures done')
