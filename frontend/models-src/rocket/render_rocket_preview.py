#!/usr/bin/env python3
"""Превью ракеты: 3 кадра Cycles CPU → ../rocket.preview.jpg (≤ 400 КБ)."""
import os
import math
import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(HERE, '..', '..', 'public', 'models')
BLEND = os.path.join(HERE, 'rocket.blend')
W, H, SAMPLES = 640, 480, 48


def setup_render():
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    scene.render.resolution_x = W
    scene.render.resolution_y = H
    scene.view_settings.view_transform = 'Filmic'
    world = bpy.data.worlds.new('World')
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = 1.0
    bg.inputs['Color'].default_value = (0.02, 0.02, 0.05, 1.0)   # космос
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])


def add_light(kind, loc, target, energy, color, size=2.0):
    data = bpy.data.lights.new('L', kind)
    data.energy = energy
    data.color = color
    if kind == 'AREA':
        data.size = size
    ob = bpy.data.objects.new('L', data)
    bpy.context.collection.objects.link(ob)
    ob.location = loc
    d = Vector(target) - Vector(loc)
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return ob


def add_camera(loc, look_at, lens=50):
    cam_data = bpy.data.cameras.new('cam')
    cam_data.lens = lens
    cam = bpy.data.objects.new('cam', cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = loc
    cam.rotation_euler = (Vector(look_at) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = cam
    return cam


def render(name):
    out = os.path.join(HERE, f'_shot_{name}.png')
    bpy.context.scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print('rendered', name)
    return out


def main():
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    setup_render()
    # Студия: тёплый ключ + пурпур/циан контровые (как в игре)
    add_light('AREA', (-3.5, -4.0, 3.5), (0, 0, 0), 900, (1.0, 0.92, 0.78), size=3.0)
    add_light('AREA', (4.5, 2.0, 1.5), (0, 0, 0), 350, (0.67, 0.33, 0.97), size=3.0)
    add_light('AREA', (-4.5, 2.5, -1.5), (0, 0, 0), 300, (0.13, 0.83, 0.93), size=2.5)

    # 1) 3/4 общий вид
    add_camera(Vector((3.6, -4.6, 1.6)), Vector((0, 0, 0.1)), lens=50)
    s1 = render('rocket_full')
    # 2) сопло и копоть
    add_camera(Vector((1.6, -2.2, -2.6)), Vector((0, 0, -1.3)), lens=55)
    s2 = render('rocket_nozzle')
    # 3) нос и иллюминатор
    add_camera(Vector((1.4, -2.0, 1.5)), Vector((0, 0.1, 0.7)), lens=60)
    s3 = render('rocket_nose')

    from PIL import Image
    imgs = [Image.open(p) for p in (s1, s2, s3)]
    gap = 6
    canvas = Image.new('RGB', (W * 3 + gap * 2, H), (6, 6, 14))
    for i, im in enumerate(imgs):
        canvas.paste(im.convert('RGB'), (i * (W + gap), 0))
    out = os.path.join(MODELS, 'rocket.preview.jpg')
    canvas.save(out, 'JPEG', quality=88)
    for p in (s1, s2, s3):
        os.remove(p)
    print('PREVIEW', out, os.path.getsize(out))


if __name__ == '__main__':
    main()
