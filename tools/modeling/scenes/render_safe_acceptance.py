#!/usr/bin/env python3
"""
Приёмочные и превью-рендеры сейфа (карточка K1, ТЗ 4.5).

3 кадра — общий вид (дверь закрыта), открытая дверь, крупный план штурвала.
Cycles CPU (headless). Свет и камера — свои, в .glb они не попадают.

Выход:
  frontend/public/models/safe.preview.jpg/.png  (3 кадра, склеенные, ≤ 400 КБ)
  docs/art-direction/acceptance/safe/render_{closed,open,wheel}_{color,bw}.png
    (256×256 — цвет + светло-серый силуэт для приёмки)

Запуск: /tmp/vault-bpy/bin/bpy-python tools/modeling/scenes/render_safe_acceptance.py
"""
import os
import sys
import math

import bpy
from mathutils import Vector, Quaternion

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(HERE, 'common'))

from render import (  # noqa: E402
    setup_render, clear_lights_cams, add_light, add_camera, render_to_image,
    save_image, grayscale_copy, stitch_horizontal)

MODELS = os.path.join(ROOT, 'frontend', 'public', 'models')
BLEND = os.path.join(ROOT, 'frontend', 'models-src', 'safe', 'safe.blend')
ACCEPT = os.path.join(ROOT, 'docs', 'art-direction', 'acceptance', 'safe')
os.makedirs(ACCEPT, exist_ok=True)

W, H, SAMPLES = 640, 480, 48
ANGLES_DEG = [-30, 0, 30]      # три ригеля (карточка K1)


def pose_open():
    """Финальная поза клипа open — напрямую, без микшера."""
    for ob in bpy.data.objects:
        if ob.animation_data:
            ob.animation_data_clear()
    door = bpy.data.objects['safe_door']
    door.rotation_mode = 'QUATERNION'
    door.rotation_quaternion = Quaternion((0, 1, 0), -1.12)
    door.location = (0, -0.16, 0)
    wheel = bpy.data.objects['safe_wheel']
    wheel.rotation_mode = 'QUATERNION'
    wheel.rotation_quaternion = Quaternion((0, 1, 0), math.pi * 3 % (2 * math.pi))
    for i, deg in enumerate(ANGLES_DEG):
        b = bpy.data.objects[f'bolt_{i + 1:02d}']
        a = math.radians(deg)
        d = Vector((math.cos(a), 0.0, math.sin(a)))
        b.location = Vector((1.55, -0.025, 0.0)) + d * (1.42 + 0.10)


def main():
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    setup_render(W, H, SAMPLES)
    clear_lights_cams()

    # Свет «неоновой студии»: тёплый ключ + холодный филл, цветные контровые.
    add_light('SPOT', (-2.8, -4.0, 5.2), (0, -0.2, 2.0), 2200, (1.0, 0.92, 0.75), spot=1.2)
    add_light('AREA', (4.6, 2.0, 2.6), (0, 0, 2.0), 450, (0.67, 0.33, 0.97), size=3.0)   # пурпур
    add_light('AREA', (-4.8, -2.0, 0.6), (0, 0, 2.0), 350, (0.13, 0.83, 0.93), size=2.6)  # циан
    add_light('AREA', (0.0, -5.2, 1.6), (0, 0, 2.0), 500, (1.0, 0.85, 0.55), size=4.0)   # тёплое лицо

    # 1) Общий вид, дверь закрыта
    add_camera(Vector((2.9, -4.9, 2.6)), Vector((0, -0.1, 2.0)), lens=45)
    p1 = os.path.join(MODELS, 'safe.preview.shot1.png')
    save_image(render_to_image(), p1)
    img_closed = bpy.data.images.load(p1)   # Render Result в headless не expose пиксели

    # 2) Открытая дверь (заглянуть внутрь)
    pose_open()
    gold = bpy.data.lights.new('gold', 'POINT')
    gold.energy = 2500
    gold.color = (1.0, 0.78, 0.3)
    gold.shadow_soft_size = 0.8
    gl = bpy.data.objects.new('gold', gold)
    bpy.context.collection.objects.link(gl)
    gl.location = (0, 1.1, 1.3)
    add_camera(Vector((4.5, -2.8, 2.3)), Vector((0.3, 0.9, 1.4)), lens=42)
    p2 = os.path.join(MODELS, 'safe.preview.shot2.png')
    save_image(render_to_image(), p2)
    img_open = bpy.data.images.load(p2)
    bpy.data.objects.remove(gl, do_unlink=True)

    # 3) Крупный план: штурвал и фактура двери (дверь ещё закрыта)
    pose_closed = None
    for ob in bpy.data.objects:
        if ob.animation_data:
            ob.animation_data_clear()
    door = bpy.data.objects['safe_door']
    door.rotation_mode = 'QUATERNION'
    door.rotation_quaternion = Quaternion((0, 0, 1), 0.0)
    door.location = (0, 0, 0)
    wheel = bpy.data.objects['safe_wheel']
    wheel.rotation_mode = 'QUATERNION'
    wheel.rotation_quaternion = Quaternion((0, -1, 0), 0.0)
    for i, deg in enumerate(ANGLES_DEG):
        b = bpy.data.objects[f'bolt_{i + 1:02d}']
        a = math.radians(deg)
        d = Vector((math.cos(a), 0.0, math.sin(a)))
        b.location = Vector((1.55, -0.365, 0.0)) + d * (1.42 + 0.10)
    wheel_world = Vector((0.0, -0.315, 1.22))
    add_camera(Vector((1.5, -2.2, 1.75)), wheel_world + Vector((0, 0, 0.05)), lens=60)
    p3 = os.path.join(MODELS, 'safe.preview.shot3.png')
    save_image(render_to_image(), p3)
    img_wheel = bpy.data.images.load(p3)

    # Склейка превью (3 кадра)
    band = stitch_horizontal([img_closed, img_open, img_wheel], gap=6)
    png = os.path.join(MODELS, 'safe.preview.png')
    bpy.context.scene.render.image_settings.file_format = 'PNG'
    band.save_render(png)
    jpg = os.path.join(MODELS, 'safe.preview.jpg')
    bpy.context.scene.render.image_settings.file_format = 'JPEG'
    bpy.context.scene.render.image_settings.quality = 75
    band.save_render(jpg)
    print(f'PREVIEW {jpg} {os.path.getsize(jpg)} bytes')

    # ── Приёмочные кадры: 256×256, цвет + светло-серый силуэт ──
    shots = {'closed': img_closed, 'open': img_open, 'wheel': img_wheel}
    for name, img in shots.items():
        small = bpy.data.images.new(f'acc_{name}', 256, 256)
        small.colorspace_settings.name = 'sRGB'   # ДО пайпа пикселей (иначе save чёрный)
        small.pixels[:] = _resize(img, 256, 256)
        color_path = os.path.join(ACCEPT, f'render_{name}_color.png')
        small.save_render(color_path)
        gray = grayscale_copy(small)
        gray.save_render(os.path.join(ACCEPT, f'render_{name}_bw.png'))
        print(f'ACCEPT {name} {os.path.getsize(color_path)} bytes')


def _resize(img, w, h):
    """Простое bilinear-масштабирование картинки bpy-пикселями."""
    import numpy as np
    sw, sh = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(sh, sw, 4)
    xs = (np.arange(w) * sw / w).astype(int)
    ys = (np.arange(h) * sh / h).astype(int)
    out = px[np.ix_(ys, xs)]
    return out.ravel()


if __name__ == '__main__':
    main()
