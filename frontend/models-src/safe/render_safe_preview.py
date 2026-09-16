#!/usr/bin/env python3
"""
Превью-рендеры сейфа (ТЗ 4.5): 3 кадра — общий вид, открытая дверь, крупный
план штурвала. Cycles CPU (headless). Выход: ../safe.preview.jpg (≤ 400 КБ).
Рендер использует СВОИ свет и камеру — в .glb они не попадают.
"""
import os
import math
import bpy
from mathutils import Vector, Quaternion, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(HERE, '..', '..', 'public', 'models')
BLEND = os.path.join(HERE, 'safe.blend')
SHOTS = os.path.join(HERE, 'shots')
os.makedirs(SHOTS, exist_ok=True)

W, H, SAMPLES = 640, 480, 48


def setup_render():
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    scene.render.resolution_x = W
    scene.render.resolution_y = H
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'Filmic'
    # Мир: мягкий вертикальный градиент — металлу нужно, что отражать
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


def pose_open():
    """Финальная поза клипа open — без миксера, напрямую."""
    R4 = Matrix.Rotation(math.pi / 2, 4, 'X')
    # Рендеру анимация не нужна: глушим NLA, иначе она перекрывает ручную позу
    for ob in bpy.data.objects:
        if ob.animation_data:
            ob.animation_data_clear()
    door = bpy.data.objects['safe_door']
    door.rotation_mode = 'QUATERNION'
    door.rotation_quaternion = Quaternion((0, 0, 1), -1.12)
    door.location = (0, -0.16, 0)
    wheel = bpy.data.objects['safe_wheel']
    wheel.rotation_mode = 'QUATERNION'
    wheel.rotation_quaternion = Quaternion((0, -1, 0), math.pi * 3 % (2 * math.pi))
    angles_deg = [-30, 0, 30, 78, 102, 258, 282]
    HINGE_BL = R4 @ Vector((-1.55, 2.08, 0.06))
    for i, deg in enumerate(angles_deg):
        b = bpy.data.objects[f'bolt_{i + 1:02d}']
        a = math.radians(deg)
        d = Vector((math.cos(a), math.sin(a), 0.0))
        base = R4 @ (Vector((0.0, 2.08, 0.195)) + d * (1.42 + 0.10))
        b.location = (base - (R4 @ d) * 0.34) - HINGE_BL


def render(name):
    out = os.path.join(SHOTS, f'{name}.png')
    bpy.context.scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print('rendered', name)
    return out


def main():
    bpy.ops.wm.open_mainfile(filepath=BLEND)
    setup_render()
    clear_lights_cams()

    # Свет «неоновой студии»: тёплый софит сверху + цветные контровые.
    # Дверь смотрит в -Y (Blender-конвенция после поворота осей).
    add_light('SPOT', (-2.8, -4.0, 5.2), (0, -0.2, 2.0), 1400, (1.0, 0.92, 0.75), spot=1.2)
    add_light('AREA', (4.6, 2.0, 2.6), (0, 0, 2.0), 300, (0.67, 0.33, 0.97), size=3.0)   # пурпур
    add_light('AREA', (-4.8, -2.0, 0.6), (0, 0, 2.0), 240, (0.13, 0.83, 0.93), size=2.6)  # циан
    add_light('AREA', (0.0, -5.6, 1.6), (0, 0, 2.0), 150, (1.0, 0.85, 0.55), size=4.0)   # тёплое лицо

    # 1) Общий вид, дверь закрыта
    add_camera(Vector((3.4, -5.6, 2.8)), Vector((0, -0.1, 2.0)), lens=42)
    shot1 = render('safe_closed')

    # 2) Крупный план: штурвал и фактура двери (дверь ещё закрыта)
    wheel_world = Vector((0.0, -0.315, 1.22))
    add_camera(Vector((1.5, -2.2, 1.75)), wheel_world + Vector((0, 0, 0.05)), lens=60)
    shot3 = render('safe_wheel')

    # 3) Открытая дверь (заглянуть внутрь)
    pose_open()
    gold = bpy.data.lights.new('gold', 'POINT')
    gold.energy = 250
    gold.color = (1.0, 0.78, 0.3)
    gold.shadow_soft_size = 1.5
    gl = bpy.data.objects.new('gold', gold)
    bpy.context.collection.objects.link(gl)
    gl.location = (0, 0.45, 1.9)
    add_camera(Vector((5.2, -3.6, 2.6)), Vector((-0.5, 0.5, 1.6)), lens=38)
    shot2 = render('safe_open')
    bpy.data.objects.remove(gl, do_unlink=True)

    # Склейка
    from PIL import Image
    imgs = [Image.open(p) for p in (shot1, shot2, shot3)]
    gap = 6
    canvas = Image.new('RGB', (W * 3 + gap * 2, H), (8, 6, 15))
    for i, im in enumerate(imgs):
        canvas.paste(im.convert('RGB'), (i * (W + gap), 0))
    out = os.path.join(MODELS, 'safe.preview.jpg')
    canvas.save(out, 'JPEG', quality=88)
    print('PREVIEW', out, os.path.getsize(out), 'bytes')


if __name__ == '__main__':
    main()
