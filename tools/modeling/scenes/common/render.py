"""Рендеры превью и приёмки (Cycles CPU, headless).

Свет — «плоский»: тёплый ключ + холодный филл, без цветных гиммиков и bloom
(инвариант: картинка не зависит от пост-эффектов).  Камера и свет — свои,
в .glb их нет (ТЗ 4.1).
"""
import math
import os

import bpy
import numpy as np
from mathutils import Vector, Quaternion


def setup_render(w, h, samples=48):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'Filmic'
    world = bpy.data.worlds.get('World') or bpy.data.worlds.new('World')
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = 1.0
    grad = nt.nodes.new('ShaderNodeValToRGB')
    grad.color_ramp.elements[0].color = (0.030, 0.020, 0.055, 1.0)   # низ: пурпурная тьма
    grad.color_ramp.elements[1].color = (0.075, 0.090, 0.160, 1.0)   # верх: холодная синь
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    geom = nt.nodes.new('ShaderNodeNewGeometry')
    nt.links.new(geom.outputs['Normal'], sep.inputs['Vector'])
    nt.links.new(sep.outputs['Z'], grad.inputs['Fac'])
    nt.links.new(grad.outputs['Color'], bg.inputs['Color'])
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])
    return scene


def clear_lights_cams():
    for ob in list(bpy.data.objects):
        if ob.type in ('LIGHT', 'CAMERA'):
            bpy.data.objects.remove(ob, do_unlink=True)


def add_light(kind, loc, target, energy, color, size=2.0, spot=0.9):
    data = bpy.data.lights.new('L', kind)
    data.energy = energy
    data.color = color
    if kind == 'AREA':
        data.size = size
    if kind == 'SPOT':
        data.spot_size = spot
    ob = bpy.data.objects.new('L', data)
    bpy.context.collection.objects.link(ob)
    ob.location = loc
    d = (Vector(target) - Vector(loc))
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return ob


def add_camera(loc, look_at, lens=50):
    cam_data = bpy.data.cameras.new('cam')
    cam_data.lens = lens
    cam = bpy.data.objects.new('cam', cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = loc
    direction = look_at - cam.location
    rot_quat = direction.to_track_quat('-Z', 'Y')
    cam.rotation_euler = rot_quat.to_euler()
    bpy.context.scene.camera = cam
    return cam


def render_to_image():
    """Рендер текущего кадра в memory-картинку (Render Result)."""
    bpy.context.scene.render.filepath = '//render.png'
    bpy.ops.render.render(write_still=False)
    return bpy.data.images['Render Result']


def save_image(img, path):
    img.save_render(path)
    return path


def grayscale_copy(src):
    """Светло-серая копия картинки (приёмка: силуэт без цвета)."""
    w, h = src.size
    px = np.array(src.pixels[:], dtype=np.float32).reshape(h, w, 4)
    lum = px[..., :3] @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    out = np.stack([lum, lum, lum, px[..., 3]], axis=-1)
    dst = bpy.data.images.new('gray', w, h)
    dst.colorspace_settings.name = 'sRGB'   # ДО пайпа пикселей
    dst.pixels[:] = out.ravel()
    return dst


def stitch_horizontal(images, gap=6, bg=(0.03, 0.02, 0.06, 1.0)):
    """Склеить картинки в один горизонтальный банер (превью)."""
    H = max(im.size[1] for im in images)
    W = sum(im.size[0] for im in images) + gap * (len(images) - 1)
    canvas = bpy.data.images.new('preview', W, H)
    canvas.colorspace_settings.name = 'sRGB'   # ДО пайпа пикселей
    px = np.full((H, W, 4), bg, dtype=np.float32)
    x = 0
    for im in images:
        w, h = im.size
        sp = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4)
        y0 = (H - h) // 2
        px[y0:y0 + h, x:x + w] = sp
        x += w + gap
    if px.size != len(canvas.pixels[:]):
        raise RuntimeError(f'stitch size mismatch: px {px.shape} '
                           f'canvas {canvas.size} sources {[im.size for im in images]}')
    canvas.pixels[:] = px.ravel()
    return canvas


def pose_open(door, wheel, bolts):
    """Финальная поза клипа open — напрямую, без микшера."""
    for ob in bpy.data.objects:
        if ob.animation_data:
            ob.animation_data_clear()
    door.rotation_mode = 'XYZ'
    door.rotation_euler = (0.0, 0.0, -1.12)
    door.location = (0.0, -0.16, 0.0)
    wheel.rotation_mode = 'QUATERNION'
    wheel.rotation_quaternion = Quaternion((0, -1, 0), math.pi * 3 % (2 * math.pi))
    for (b, base, d) in bolts:
        b.location = base - d * 0.34
