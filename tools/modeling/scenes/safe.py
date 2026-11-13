#!/usr/bin/env python3
"""
Сцена сейфа `safe.glb` — карточка K1 миссии V-1-1.

Направление C+A (docs/art-direction.md v1.2): референс refs/src/01-safe.jpg.
Функционал (карточка): корпус с толщиной металла, две петли, три ригеля,
золотой штурвал, красная табличка.

Пайплайн: tools/modeling/scenes/safe.py (этот файл)
    -> frontend/models-src/safe/safe.blend (исходник)
    -> frontend/public/models/safe.glb (доставка, бюджет budget.json)
    -> docs/art-direction/acceptance/safe/ (приёмочные рендеры)

Запуск:  /tmp/vault-bpy/bin/bpy-python tools/modeling/scenes/safe.py
(нужен модуль bpy — tools/modeling/setup_bpy.sh; текстуры уже в репозитории)

Координаты: модель строится в «сценных» (glTF) координатах — Y-up, пол на y=0,
лицо сейфа в +Z. Blender — Z-up, поэтому каждый объект строится через
обратный поворот S(x, y, z) = (x, -z, y) (см. common/geometry.py). После
export_yup glTF совпадает со сценными координатами. Иерархия:

  safe (root, empty НА ПЕТЛЕ ДВЕРИ)
   ├─ safe_body (плинт+корпус+рама+интерьер, сталь), safe_collar (обойма, хром),
   │  gold_bars (слитки+монеты, золото)
   ├─ safe_door (дверь-филёнка + посадочная плита + рёбра + блоки петель, сталь)
   │    ├─ safe_hinges (золотые цапфы петель), safe_wheel (золотой штурвал),
   │    ├─ red_plate + red_plate_rivets (красная табличка, красный+золото)
   │    └─ bolt_01..03 (три ригеля, хром)
   └─ Anchor_Light, Anchor_Floor

Клипы (60 fps): open 3.0 с / idle 3.0 с / spin 1.5 с — формулы ТЗ 4.4.
"""
import os
import sys
import math

import bpy
import bmesh
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
sys.path.insert(0, os.path.join(HERE, 'common'))

from geometry import (  # noqa: E402
    wipe, add_cube, bevel, apply_modifiers, uv_cube, join_objects,
    smooth_shade, add_anchor, parent_to)
from materials import build_safe_materials  # noqa: E402
from animation import (  # noqa: E402
    record_idle, record_spin, record_open, push_nla_mapped)

MODELS = os.path.join(ROOT, 'frontend', 'public', 'models')
SRC = os.path.join(ROOT, 'frontend', 'models-src', 'safe')
TEX = os.path.join(SRC, 'textures', 'safe')
FPS = 60

# ── Геометрические константы (сценные/glTF координаты) ───────────────────────
FLOOR_Y = -1.78
DOOR_R = 1.42
DOOR_Y = 2.08
HINGE_X = -1.55
DOOR_CX = 0.0
DOOR_Z = 0.06
HALF_T = 0.155           # половина толщины двери
BEV = 0.075              # фаска по краю двери
HINGE_TO_DOOR = DOOR_CX - HINGE_X      # 1.55

BOLT_ANGLES_DEG = [-30, 0, 30]         # три ригеля (карточка K1)


def S(x, y, z):
    """Сценная координата -> Blender (обратный экспортный поворот)."""
    return Vector((x, -z, y))


def SS(dx, dy, dz):
    """Сценный размер -> Blender."""
    return Vector((dx, dz, dy))


# ═══════════════════════════ ГЕОМЕТРИЯ ═══════════════════════════════════════
def cut_hole(ob, radius, depth, center):
    """Сквозной цилиндрический проём (ось двери = Y в Blender-фрейме)."""
    bpy.ops.mesh.primitive_cylinder_add(
        radius=radius, depth=depth, vertices=32,
        location=center)
    cutter = bpy.context.active_object
    cutter.name = '_cutter'
    cut = ob.modifiers.new('hole', 'BOOLEAN')
    cut.object = cutter
    cut.operation = 'DIFFERENCE'
    cut.solver = 'EXACT'
    apply_modifiers(ob)
    bpy.data.objects.remove(cutter, do_unlink=True)


def build_static(mats):
    """Плинт + корпус + рама — один steel-меш (один primitive)."""
    plinth = add_cube('safe_plinth', S(0, 0.13, -1.35),
                      SS(4.3, 0.26, 2.75), mats['steel'])
    bevel(plinth, 0.02)
    body = add_cube('safe_body', S(0, 1.93, -1.35),
                    SS(3.9, 3.6, 2.4), mats['steel'])
    bevel(body, 0.035)
    apply_modifiers(body)                 # фаска ДО булева
    cut_hole(body, DOOR_R + 0.02, 1.6, S(DOOR_CX, DOOR_Y, -0.35))
    frame = add_cube('safe_frame', S(0, 1.93, -0.14),
                     SS(4.14, 3.84, 0.26), mats['steel'])
    bevel(frame, 0.03)
    apply_modifiers(frame)
    cut_hole(frame, DOOR_R + 0.04, 1.4, S(DOOR_CX, DOOR_Y, -0.14))
    # рёбра жёсткости по бортам — корпус читается как литая конструкция
    ribs = []
    for sx in (-1, 1):
        for i in range(3):
            ribs.append(add_cube('body_rib', S(sx * 1.97, 0.75 + i * 1.2, -1.35),
                                 SS(0.08, 0.5, 2.2), mats['steel']))
    apply_modifiers(plinth)
    merged = join_objects([plinth, body, frame] + ribs, 'safe_body')
    uv_cube(merged, 4.0)
    return merged


def build_collar(mats):
    """Обойма вокруг проёма — хром, статична."""
    bpy.ops.mesh.primitive_torus_add(
        major_radius=DOOR_R + 0.20, minor_radius=0.155,
        major_segments=72, minor_segments=14,
        location=S(DOOR_CX, DOOR_Y, -0.02))
    ob = bpy.context.active_object
    ob.name = 'safe_collar'
    ob.rotation_euler = (math.pi / 2, 0, 0)      # ось -> -Y (дверь)
    ob.data.materials.append(mats['chrome'])
    smooth_shade(ob)
    return ob


def build_hinges(mats):
    """Две петли: стальные блоки (к дверному мешу) + золотые цапфы."""
    blocks, pins = [], []
    for hy in (-0.72, 0.92):
        blocks.append(add_cube('hinge_block',
                               S(HINGE_X + 0.02, DOOR_Y + hy, -0.02),
                               SS(0.3, 0.62, 0.42), mats['steel']))
        bpy.ops.mesh.primitive_cylinder_add(
            radius=0.075, depth=0.74, vertices=16,
            location=S(HINGE_X + 0.02, DOOR_Y + hy, 0.16))
        pin = bpy.context.active_object
        pin.name = 'hinge_pin'
        pin.data.materials.append(mats['gold'])
        pins.append(pin)
    return blocks, pins


def build_interior(mats):
    """Интерьер: раковина (front открыта в проём) + полки + рёбра — сталь."""
    ob = add_cube('safe_interior', S(0, DOOR_Y, -0.9),
                  SS(2.78, 2.78, 1.5), mats['steel'])
    # передняя грань удаляется булева-кавычкой (проём в дверной панель)
    bpy.ops.mesh.primitive_cube_add(size=1, location=S(0, DOOR_Y, -0.15))
    cutter = bpy.context.active_object
    cutter.name = '_cutter_front'
    cutter.scale = (1.4, 0.06, 1.4)
    bpy.ops.object.transform_apply(scale=True)
    cut = ob.modifiers.new('front', 'BOOLEAN')
    cut.object = cutter
    cut.operation = 'DIFFERENCE'
    cut.solver = 'EXACT'
    apply_modifiers(ob)
    bpy.data.objects.remove(cutter, do_unlink=True)
    # нормали внутрь раковины
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.flip_normals()
    bpy.ops.object.mode_set(mode='OBJECT')
    # полки и рёбра жёсткости на задней стенке — интерьер не «пустая коробка»
    extras = []
    for sy in (1.62, 2.34):
        sh = add_cube('shelf', S(0, sy, -1.05), SS(2.7, 0.05, 1.0), mats['steel'])
        extras.append(sh)
    for i in range(4):
        rb = add_cube('rib', S(-1.05 + i * 0.7, DOOR_Y, -1.62),
                      SS(0.09, 2.6, 0.06), mats['steel'])
        extras.append(rb)
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    for e in extras:
        e.select_set(True)
    bpy.ops.object.join()
    uv_cube(ob, 2.8)
    return ob


def build_gold_bars(mats):
    """Золото внутри: слитки-пирамида + стопка монет + боковая стопка."""
    parts = []
    for row, n in enumerate((4, 3, 2)):
        for i in range(n):
            x = (i - (n - 1) / 2) * 0.52 - 0.30
            y = 0.80 + row * 0.185
            b = add_cube('gold_bar', S(x, y, -1.24), SS(0.46, 0.17, 0.26),
                         mats['gold'])
            b.rotation_euler = (0, 0, math.sin(i * 3.7 + row) * 0.06)
            parts.append(b)
    for i in range(3):                                # боковая стопка слитков
        b = add_cube('gold_bar',
                     S(0.95, 0.80 + (i % 2) * 0.185, -1.05 + (i // 2) * 0.19),
                     SS(0.46, 0.17, 0.26), mats['gold'])
        b.rotation_euler = (0, 0, math.sin(i * 9.1) * 0.22)
        parts.append(b)
    for i in range(3):                                # слитки на полке
        b = add_cube('gold_bar', S(-0.55 + i * 0.55, 1.70, -1.15),
                     SS(0.46, 0.17, 0.26), mats['gold'])
        b.rotation_euler = (0, 0, math.sin(i * 7.7) * 0.12)
        parts.append(b)
    b = add_cube('gold_bar', S(-0.28, 1.885, -1.15),
                 SS(0.46, 0.17, 0.26), mats['gold'])
    b.rotation_euler = (0, 0, 0.1)
    parts.append(b)
    for cx, cn in ((-1.0, 7), (0.62, 5), (1.05, 6), (0.85, 6)):   # стопки монет
        for i in range(cn):
            bpy.ops.mesh.primitive_cylinder_add(
                radius=0.14, depth=0.035, vertices=24,
                location=S(cx + math.sin(i * 5.3) * 0.02,
                           0.78 + i * 0.037, -1.15),
                rotation=(math.pi / 2, 0, 0))
            c = bpy.context.active_object
            c.rotation_euler = (math.sin(i * 2.1) * 0.05,
                               math.sin(i * 3.3) * 0.05, 0)
            c.data.materials.append(mats['gold'])
            parts.append(c)
    ob = join_objects(parts, 'gold_bars')
    uv_cube(ob, 1.6)
    return ob


def build_door(mats, hinge_blocks):
    """Дверь-филёнка: латернь вокруг оси двери (Blender -Y), origin НА ПЕТЛЕ."""
    steps = 64
    profile = [(0.001, -HALF_T), (DOOR_R - BEV, -HALF_T)]
    seg = 8
    for i in range(1, seg + 1):
        a = (i / seg) * (math.pi / 2)
        profile.append((DOOR_R - BEV + math.sin(a) * BEV,
                        -HALF_T + BEV - math.cos(a) * BEV))
    for i in range(seg, 0, -1):
        a = (i / seg) * (math.pi / 2)
        profile.append((DOOR_R - BEV + math.sin(a) * BEV,
                        HALF_T - BEV + math.cos(a) * BEV))
    profile += [(DOOR_R - BEV, HALF_T), (0.001, HALF_T)]

    mesh = bpy.data.meshes.new('safe_door')
    bm = bmesh.new()
    C = Vector((HINGE_TO_DOOR, 0.0, 0.0))        # центр двери, door-local
    rings = []
    for s in range(steps):
        ang = (s / steps) * math.pi * 2
        ca, sa = math.cos(ang), math.sin(ang)
        ring = []
        for (r, z) in profile:
            # сце́нная (r·cosθ, r·sinθ, z) -> Blender (r·cosθ, -z, r·sinθ) + C
            ring.append(bm.verts.new((C.x + r * ca, -z, C.z + r * sa)))
        rings.append(ring)
    bm.verts.ensure_lookup_table()
    for s in range(steps):
        s2 = (s + 1) % steps
        for i in range(len(profile) - 1):
            bm.faces.new((rings[s][i], rings[s2][i],
                          rings[s2][i + 1], rings[s][i + 1]))
    c_back = bm.verts.new((C.x, HALF_T, C.z))
    c_front = bm.verts.new((C.x, -HALF_T, C.z))
    for s in range(steps):
        s2 = (s + 1) % steps
        bm.faces.new((c_back, rings[s2][0], rings[s][0]))
        bm.faces.new((c_front, rings[s][len(profile) - 1],
                      rings[s2][len(profile) - 1]))
    bm.to_mesh(mesh)
    bm.free()

    ob = bpy.data.objects.new('safe_door', mesh)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mats['steel'])
    for p in ob.data.polygons:
        p.use_smooth = True

    # Посадочная плита (сзади двери) + рёбра — тем же steel-материалом
    bpy.ops.mesh.primitive_cylinder_add(
        radius=DOOR_R - 0.14, depth=0.05, vertices=64,
        location=(HINGE_TO_DOOR, 0.19, 0.0))
    dish = bpy.context.active_object
    dish.data.materials.append(mats['steel'])
    ribs = []
    for i in range(8):
        a = (i / 8) * math.pi * 2 + math.pi / 8
        bpy.ops.mesh.primitive_cube_add(size=1,
            location=(HINGE_TO_DOOR + math.cos(a) * 0.56, 0.225,
                      math.sin(a) * 0.56))
        rib = bpy.context.active_object
        rib.scale = (0.99, 0.09, 0.09)
        bpy.ops.object.transform_apply(scale=True)
        rib.rotation_euler = (0, -a, 0)
        rib.data.materials.append(mats['steel'])
        ribs.append(rib)
    # Блоки петель — сталь, идут вместе с дверью
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    for r in [dish] + ribs + hinge_blocks:
        r.select_set(True)
    bpy.ops.object.join()
    uv_cube(ob, 3.0)
    return ob


def build_hinge_pins(mats, pins):
    """Золотые цапфы петель — отдельный меш, дитя двери."""
    return join_objects(pins, 'safe_hinges')


def build_wheel(mats):
    """Золотой штурвал: обоод + ступица + 3 спицы (карточка: золотой штурвал)."""
    parts = []
    bpy.ops.mesh.primitive_torus_add(
        major_radius=0.54, minor_radius=0.06,
        major_segments=48, minor_segments=10, location=(0, 0, 0))
    rim = bpy.context.active_object
    rim.name = 'wheel_rim'
    rim.rotation_euler = (math.pi / 2, 0, 0)       # ось торуса Z -> Y (дверь)
    rim.data.materials.append(mats['gold'])
    parts.append(rim)
    for i in range(3):
        a = (i / 3) * math.pi * 2
        bpy.ops.mesh.primitive_cylinder_add(
            radius=0.05, depth=0.40, vertices=12,
            location=(0.26 * math.cos(a), -0.09, 0.26 * math.sin(a)))
        spoke = bpy.context.active_object
        spoke.name = 'wheel_spoke'
        spoke.rotation_euler = (0, math.pi / 2 - a, 0)   # Y -> радиус (плоскость XZ)
        spoke.data.materials.append(mats['gold'])
        parts.append(spoke)
    bpy.ops.mesh.primitive_cylinder_add(
        radius=0.15, depth=0.18, vertices=24, location=(0, -0.09, 0))
    hub = bpy.context.active_object
    hub.name = 'wheel_hub'
    hub.data.materials.append(mats['gold'])
    parts.append(hub)
    for i in range(3):
        a = (i / 3) * math.pi * 2
        bpy.ops.mesh.primitive_uv_sphere_add(
            radius=0.062, segments=14, ring_count=10,
            location=(math.cos(a) * 0.54, 0.07, math.sin(a) * 0.54))
        knob = bpy.context.active_object
        knob.name = 'wheel_knob'
        knob.data.materials.append(mats['gold'])
        parts.append(knob)
    ob = join_objects(parts, 'safe_wheel')
    ob.location = Vector((HINGE_TO_DOOR, -0.255, -0.86))
    uv_cube(ob, 1.2)
    smooth_shade(ob)
    return ob


def build_red_plate(mats):
    """Красная табличка: прямоугольная плита + золотые заклёпки (референс)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    disc = bpy.context.active_object
    disc.name = 'red_plate'
    disc.scale = (1.7, 0.04, 0.68)
    bpy.ops.object.transform_apply(scale=True)
    disc.data.materials.append(mats['red'])
    disc.location = Vector((HINGE_TO_DOOR, -0.18, 1.02))
    parts = []
    spots = []
    for x in (0.7, 1.55, 2.4):
        spots.append((x, 1.36))
        spots.append((x, 0.68))
    for z in (0.83, 1.19):
        spots.append((0.7, z))
        spots.append((2.4, z))
    for (x, z) in spots:
        bpy.ops.mesh.primitive_uv_sphere_add(
            radius=0.035, segments=8, ring_count=5,
            location=(x, -0.22, z))
        rivet = bpy.context.active_object
        rivet.data.materials.append(mats['gold'])
        parts.append(rivet)
    rivets = join_objects(parts, 'red_plate_rivets')
    uv_cube(disc, 1.0)
    uv_cube(rivets, 1.0)
    return disc, rivets


def build_bolts(mats):
    """Три ригеля (карточка): по радиусу снаружи двери, уходят внутрь при открытии."""
    registry = []
    for i, deg in enumerate(BOLT_ANGLES_DEG):
        a = math.radians(deg)
        d = Vector((math.cos(a), 0.0, math.sin(a)))   # радиаль, door-local (плоскость XZ)
        base = Vector((HINGE_TO_DOOR, -0.365, 0.0)) + d * (DOOR_R + 0.10)
        bpy.ops.mesh.primitive_cylinder_add(
            radius=0.075, depth=0.42, vertices=20, location=(0, 0, 0))
        ob = bpy.context.active_object
        ob.name = f'bolt_{i + 1:02d}'
        ob.rotation_euler = (0.0, 0.0, 0.0)          # ось = Y (ось двери)
        ob.location = base
        ob.data.materials.append(mats['chrome'])
        registry.append((ob, base.copy(), d))
    return registry


# ═══════════════════════════ СБОРКА ══════════════════════════════════════════
def main():
    wipe()
    bpy.context.scene.render.fps = FPS
    mats = build_safe_materials(TEX)

    # ── Статика ──
    body = build_static(mats)
    collar = build_collar(mats)
    hinge_blocks, hinge_pins = build_hinges(mats)
    interior = build_interior(mats)
    gold_bars = build_gold_bars(mats)

    # ── Дверь + дети ──
    door = build_door(mats, hinge_blocks)
    hinges = build_hinge_pins(mats, hinge_pins)
    wheel = build_wheel(mats)
    red_plate, red_rivets = build_red_plate(mats)
    bolts = build_bolts(mats)

    # ── Иерархия (аналитический парентинг) ──
    root = bpy.data.objects.new('safe', None)
    root.empty_display_size = 0.2
    bpy.context.collection.objects.link(root)
    root.location = S(HINGE_X, DOOR_Y, DOOR_Z)      # петля

    for ob in (body, collar, interior, gold_bars):
        parent_to(ob, root, ob.location.copy() - root.location)
    parent_to(door, root, Vector((0.0, 0.0, 0.0)))
    for ob in (hinges, wheel, red_plate, red_rivets) + tuple(b for b, _, _ in bolts):
        parent_to(ob, door, ob.location.copy())

    # ── Якоря ──
    add_anchor('Anchor_Light', S(-HINGE_X, 1.88 - DOOR_Y, -0.7 - DOOR_Z), root)
    add_anchor('Anchor_Floor', S(-HINGE_X, 0.0 - DOOR_Y, 0.0 - DOOR_Z), root)
    add_anchor('Anchor_Drums', S(HINGE_TO_DOOR, DRUM_Y := 1.96 - DOOR_Y,
                                 HALF_T + 0.04), door)

    # ── Анимации ──
    record_idle(wheel, bolts)
    record_spin(wheel, bolts)
    record_open(door, wheel, bolts)
    push_nla_mapped()

    bpy.context.scene.frame_set(0)

    for ob in bpy.data.objects:
        if ob.type == 'MESH':
            ob.data.name = ob.name

    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(SRC, 'safe.blend'))

    out_glb = os.path.join(MODELS, 'safe.glb')
    bpy.ops.export_scene.gltf(
        filepath=out_glb,
        export_format='GLB',
        export_animations=True,
        export_animation_mode='NLA_TRACKS',
        export_yup=True,
        export_apply=True,
        export_lights=False,
        export_cameras=False,
        export_materials='EXPORT',
    )
    tris = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
    print(f'DONE safe.glb size={os.path.getsize(out_glb)} tris≈{tris}')


if __name__ == '__main__':
    main()
