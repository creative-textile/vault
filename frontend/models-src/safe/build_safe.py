#!/usr/bin/env python3
"""
Сборка модели сейфа `safe.glb` в Blender (bpy) — ТЗ «3D-модели», разделы 4 и 7.

Запуск:  python3 build_safe.py   (нужен модуль bpy, текстуры уже сгенерированы)
Выход:   frontend/public/models/safe.glb
         frontend/public/models/src/safe.blend  (исходник)

Модельное пространство: метры, пол на y=0, «лицо» сейфа смотрит в +Z.
Все координаты = координаты сцены SafeCrackScene.tsx + 1.78 по Y
(FLOOR_Y = -1.78), поэтому нормализация лоадера (высота ~4.0) ставит модель
ровно на место процедурного сейфа.

Иерархия:
  safe (root, origin НА ПЕТЛЕ ДВЕРИ — ТЗ 4.1)
   ├─ safe_plinth, safe_body, safe_frame, safe_collar, safe_hinges,
   │  safe_interior, gold_bars, safe_indicator            (статика)
   ├─ safe_door  (вращается вокруг петли; меш двери + заклёпки)
   │    ├─ bolt_01..bolt_07 (ригели, утапливаются при открытии)
   │    ├─ safe_wheel       (штурвал)
   │    ├─ Anchor_Drums, Anchor_Sparks
   ├─ Anchor_Light, Anchor_Floor

Клипы (60 fps): idle 3.0с / spin 1.5с / open 3.0с — формулы СЦЕНЫ (ТЗ 4.4).
"""
import os
import math
import bpy          # noqa: F401 — должен быть импортирован ДО bmesh
import bmesh
from mathutils import Vector, Quaternion, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(HERE, '..', '..', 'public', 'models')
TEX = os.path.join(HERE, 'textures', 'safe')
FPS = 60
R4 = Matrix.Rotation(math.pi / 2, 4, 'X')

# ── Геометрические константы (сцена + 1.78 по Y) ─────────────────────────────
DOOR_R = 1.42
DOOR_Y = 2.08
DOOR_Z = 0.06
HALF_T = 0.155
HINGE_X = -1.55
DOOR_CX = 0.0
HINGE_TO_DOOR = DOOR_CX - HINGE_X                  # 1.55
DRUM_Y = 1.96
BODY_C = (0.0, 1.93, -1.35)
FRAME_C = (0.0, 1.93, -0.14)

MAT_STEEL = 'safe_steel'
MAT_GOLD = 'safe_gold'
MAT_CHROME = 'safe_chrome'
MAT_IND = 'safe_indicator'

ACTION_MAP = {}                                    # obj.name -> {clip: action}


def ease_out_cubic(t): return 1.0 - (1.0 - t) ** 3
def ease_in_out(t): return 2 * t * t if t < 0.5 else 1.0 - ((-2 * t + 2) ** 2) / 2
def clamp01(t): return max(0.0, min(1.0, t))


# ═══════════════════════════ ПОДГОТОВКА ══════════════════════════════════════
def wipe():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images,
                 bpy.data.actions):
        for item in list(coll):
            coll.remove(item)


def load_image(name, srgb):
    img = bpy.data.images.load(os.path.join(TEX, name), check_existing=False)
    img.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
    return img


def make_material(name, base_rgba, metallic, roughness,
                  map_img=None, orm_img=None, normal_img=None,
                  emissive=None, emissive_strength=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = base_rgba
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    if map_img is not None:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = map_img
        nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    if orm_img is not None:
        orm = nt.nodes.new('ShaderNodeTexImage')
        orm.image = orm_img
        try:
            sep = nt.nodes.new('ShaderNodeSeparateColor')
        except RuntimeError:
            sep = nt.nodes.new('ShaderNodeSeparateRGB')
        nt.links.new(orm.outputs['Color'], sep.inputs[0])
        nt.links.new(sep.outputs[1], bsdf.inputs['Roughness'])
        nt.links.new(sep.outputs[2], bsdf.inputs['Metallic'])
    if normal_img is not None:
        nrm = nt.nodes.new('ShaderNodeTexImage')
        nrm.image = normal_img
        nmap = nt.nodes.new('ShaderNodeNormalMap')
        nmap.inputs['Strength'].default_value = 1.0
        nt.links.new(nrm.outputs['Color'], nmap.inputs['Color'])
        nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    if emissive is not None:
        bsdf.inputs['Emission Color'].default_value = emissive
        bsdf.inputs['Emission Strength'].default_value = emissive_strength
    return mat


def build_materials():
    mats = {}
    mats[MAT_STEEL] = make_material(
        MAT_STEEL, (0.045, 0.052, 0.098, 1.0), 0.94, 0.56,
        map_img=load_image('steel_map.png', True),
        orm_img=load_image('steel_orm.png', False),
        normal_img=load_image('steel_normal.png', False))
    mats[MAT_GOLD] = make_material(
        MAT_GOLD, (0.927, 0.564, 0.055, 1.0), 1.0, 0.3,
        map_img=load_image('gold_map.png', True),
        orm_img=load_image('gold_orm.png', False))
    mats[MAT_CHROME] = make_material(
        MAT_CHROME, (0.74, 0.78, 0.88, 1.0), 1.0, 0.24)
    mats[MAT_IND] = make_material(
        MAT_IND, (0.01, 0.012, 0.02, 1.0), 0.2, 0.4,
        emissive=(0.133, 0.827, 0.933, 1.0), emissive_strength=2.4)  # циан #22d3ee
    return mats


# ═══════════════════════════ ГЕОМЕТРИЯ ═══════════════════════════════════════
def add_cube(name, center, size, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    bpy.ops.object.transform_apply(scale=True)
    ob.data.materials.append(mat)
    return ob


def bevel(ob, width, seg=3):
    m = ob.modifiers.new('bev', 'BEVEL')
    m.width = width
    m.segments = seg
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(30)


def uv_cube(ob, size=4.0):
    if ob.data.uv_layers.active is None:
        ob.data.uv_layers.new()
    prev = bpy.context.active_object
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.cube_project(cube_size=size, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.context.view_layer.objects.active = prev


def join_objects(parts, name):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = parts[0]
    for p in parts:
        p.select_set(True)
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name
    bpy.ops.object.select_all(action='DESELECT')
    return ob


def build_plinth(mats):
    ob = add_cube('safe_plinth', (0, 0.13, -1.35), (4.3, 0.26, 2.75), mats[MAT_STEEL])
    bevel(ob, 0.02)
    uv_cube(ob, 4.4)
    return ob


def build_body(mats):
    ob = add_cube('safe_body', BODY_C, (3.9, 3.6, 2.4), mats[MAT_STEEL])
    bevel(ob, 0.035)
    # сквозной проём под дверь: при открытии виден интерьер, а не стенка
    bpy.ops.mesh.primitive_cylinder_add(
        radius=DOOR_R + 0.02, depth=1.6, location=(DOOR_CX, DOOR_Y, -0.35))
    body_cutter = bpy.context.active_object
    body_cutter.name = '_cutter_body'
    cut = ob.modifiers.new('body_hole', 'BOOLEAN')
    cut.object = body_cutter
    cut.operation = 'DIFFERENCE'
    cut.solver = 'EXACT'
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier='body_hole')
    bpy.data.objects.remove(body_cutter, do_unlink=True)
    # рёбра жёсткости по бортам — корпус читается как литая конструкция
    ribs = []
    for sx in (-1, 1):
        for i in range(3):
            bpy.ops.mesh.primitive_cube_add(size=1, location=(sx * 1.97, 0.75 + i * 1.2, -1.35))
            r = bpy.context.active_object
            r.scale = (0.08, 0.5, 2.2)
            bpy.ops.object.transform_apply(scale=True)
            ribs.append(r)
    for r in ribs:
        r.select_set(True)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.join()
    uv_cube(ob, 4.0)
    return ob


def build_frame(mats):
    ob = add_cube('safe_frame', FRAME_C, (4.14, 3.84, 0.26), mats[MAT_STEEL])
    bevel(ob, 0.03)
    bpy.ops.mesh.primitive_cylinder_add(
        radius=DOOR_R + 0.04, depth=1.4, location=(DOOR_CX, DOOR_Y, FRAME_C[2]),
        rotation=(math.pi / 2, 0, 0))
    cutter = bpy.context.active_object
    cutter.name = '_cutter_door'
    cut = ob.modifiers.new('door_hole', 'BOOLEAN')
    cut.object = cutter
    cut.operation = 'DIFFERENCE'
    cut.solver = 'EXACT'
    uv_cube(ob, 4.2)
    return ob, cutter


def build_frame_bolts(mats):
    parts = []
    spots = [(-1.92, 1.72), (1.92, 1.72), (-1.92, -1.72), (1.92, -1.72),
             (0, 1.84), (0, -1.84), (-2.0, 0), (2.0, 0)]
    for px, py in spots:
        bpy.ops.mesh.primitive_cylinder_add(
            radius=0.07, depth=0.1, vertices=6,
            location=(px, DOOR_Y + py, FRAME_C[2] + 0.13))
        b = bpy.context.active_object
        b.data.materials.append(mats[MAT_CHROME])
        parts.append(b)
    ob = join_objects(parts, 'frame_bolts')
    return ob


def build_collar(mats):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=DOOR_R + 0.20, minor_radius=0.155,
        major_segments=72, minor_segments=14,
        location=(DOOR_CX, DOOR_Y, -0.02))
    ob = bpy.context.active_object
    ob.name = 'safe_collar'
    ob.data.materials.append(mats[MAT_CHROME])
    return ob


def build_hinges(mats):
    parts = []
    for hy in (-0.72, 0.92):
        parts.append(add_cube('hinge_block', (HINGE_X + 0.02, DOOR_Y + hy, -0.02),
                              (0.3, 0.62, 0.42), mats[MAT_CHROME]))
        bpy.ops.mesh.primitive_cylinder_add(
            radius=0.075, depth=0.74,
            location=(HINGE_X + 0.02, DOOR_Y + hy, 0.16))
        pin = bpy.context.active_object
        pin.name = 'hinge_pin'
        pin.data.materials.append(mats[MAT_GOLD])
        parts.append(pin)
    ob = join_objects(parts, 'safe_hinges')
    uv_cube(ob, 1.0)
    return ob


def build_interior(mats):
    ob = add_cube('safe_interior', (0, DOOR_Y, -0.9), (2.78, 2.78, 1.5), mats[MAT_STEEL])
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.faces.ensure_lookup_table()
    front = [f for f in bm.faces if f.normal.z > 0.9]
    bmesh.ops.delete(bm, geom=front, context='FACES')
    # нормали внутрь раковины
    bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    bm.to_mesh(ob.data)
    bm.free()
    # полки и рёбра жёсткости на задней стенке — интерьер не «пустая коробка»
    extras = []
    for sy in (1.62, 2.34):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, sy, -1.05))
        sh = bpy.context.active_object
        sh.scale = (2.7, 0.05, 1.0)
        bpy.ops.object.transform_apply(scale=True)
        extras.append(sh)
    for i in range(4):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(-1.05 + i * 0.7, DOOR_Y, -1.62))
        rb = bpy.context.active_object
        rb.scale = (0.09, 2.6, 0.06)
        bpy.ops.object.transform_apply(scale=True)
        extras.append(rb)
    bpy.ops.object.select_all(action='DESELECT')
    for e in extras:
        e.select_set(True)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.join()
    uv_cube(ob, 2.8)
    return ob


def build_gold_bars(mats):
    bars = []
    for row, n in enumerate((4, 3, 2)):
        for i in range(n):
            x = (i - (n - 1) / 2) * 0.52 - 0.30
            y = 0.80 + row * 0.185
            b = add_cube('gold_bar', (x, y, -1.24), (0.46, 0.17, 0.26), mats[MAT_GOLD])
            b.rotation_euler = (0, 0, math.sin(i * 3.7 + row) * 0.06)
            bars.append(b)
    # боковая стопка слитков
    for i in range(3):
        b = add_cube('gold_bar', (0.95, 0.80 + (i % 2) * 0.185, -1.05 + (i // 2) * 0.19),
                     (0.46, 0.17, 0.26), mats[MAT_GOLD])
        b.rotation_euler = (0, 0, math.sin(i * 9.1) * 0.22)
        bars.append(b)
    # слитки и монеты на нижней полке — золото видно в центре проёма
    for i in range(3):
        b = add_cube('gold_bar', (-0.55 + i * 0.55, 1.70, -1.15),
                     (0.46, 0.17, 0.26), mats[MAT_GOLD])
        b.rotation_euler = (0, 0, math.sin(i * 7.7) * 0.12)
        bars.append(b)
    b = add_cube('gold_bar', (-0.28, 1.885, -1.15), (0.46, 0.17, 0.26), mats[MAT_GOLD])
    b.rotation_euler = (0, 0, 0.1)
    bars.append(b)
    # стопки монет
    for cx, cn in ((-1.0, 7), (0.62, 5), (1.05, 6), (0.85, 6)):
        for i in range(cn):
            bpy.ops.mesh.primitive_cylinder_add(
                radius=0.14, depth=0.035, vertices=24,
                location=(cx + math.sin(i * 5.3) * 0.02, 0.78 + i * 0.037, -1.15))
            c = bpy.context.active_object
            c.rotation_euler = (math.sin(i * 2.1) * 0.05, math.sin(i * 3.3) * 0.05, 0)
            c.data.materials.append(mats[MAT_GOLD])
            bars.append(c)
    ob = join_objects(bars, 'gold_bars')
    uv_cube(ob, 1.6)
    return ob


def build_indicator(mats):
    return add_cube('safe_indicator', (0, 3.62, 0.03), (0.62, 0.09, 0.05), mats[MAT_IND])


def build_door(mats):
    """Дверь — тело вращения с фаской; origin объекта НА ПЕТЛЕ."""
    bev = 0.075
    profile = [(0.001, -HALF_T), (DOOR_R - bev, -HALF_T)]
    seg = 8
    for i in range(1, seg + 1):
        a = (i / seg) * (math.pi / 2)
        profile.append((DOOR_R - bev + math.sin(a) * bev, -HALF_T + bev - math.cos(a) * bev))
    for i in range(seg, 0, -1):
        a = (i / seg) * (math.pi / 2)
        profile.append((DOOR_R - bev + math.sin(a) * bev, HALF_T - bev + math.cos(a) * bev))
    profile += [(DOOR_R - bev, HALF_T), (0.001, HALF_T)]

    steps = 96
    mesh = bpy.data.meshes.new('safe_door')
    bm = bmesh.new()
    rings = []
    for s in range(steps):
        ang = (s / steps) * math.pi * 2
        ca, sa = math.cos(ang), math.sin(ang)
        ring = []
        for (r, z) in profile:
            # профиль вокруг оси Z; сдвиг +1.55 по X: origin = петля
            ring.append(bm.verts.new((r * ca + HINGE_TO_DOOR, r * sa, z)))
        rings.append(ring)
    bm.verts.ensure_lookup_table()
    for s in range(steps):
        s2 = (s + 1) % steps
        for i in range(len(profile) - 1):
            bm.faces.new((rings[s][i], rings[s2][i], rings[s2][i + 1], rings[s][i + 1]))
    # торцы (веера к центру)
    c_back = bm.verts.new((HINGE_TO_DOOR, 0, -HALF_T))
    c_front = bm.verts.new((HINGE_TO_DOOR, 0, HALF_T))
    for s in range(steps):
        s2 = (s + 1) % steps
        bm.faces.new((c_back, rings[s2][0], rings[s][0]))
        bm.faces.new((c_front, rings[s][len(profile) - 1], rings[s2][len(profile) - 1]))
    bm.to_mesh(mesh)
    bm.free()

    ob = bpy.data.objects.new('safe_door', mesh)
    bpy.context.collection.objects.link(ob)
    ob.location = (HINGE_X, DOOR_Y, DOOR_Z)        # origin НА ПЕТЛЕ
    ob.data.materials.append(mats[MAT_STEEL])
    for p in ob.data.polygons:
        p.use_smooth = True
    uv_cube(ob, 3.0)
    return ob


def build_rivets(mats):
    parts = []
    for i in range(14):
        a = (i / 14) * math.pi * 2 + math.pi / 14
        bpy.ops.mesh.primitive_uv_sphere_add(
            radius=0.055, segments=14, ring_count=10,
            location=(DOOR_CX + math.cos(a) * (DOOR_R - 0.11),
                      DOOR_Y + math.sin(a) * (DOOR_R - 0.11),
                      DOOR_Z + HALF_T + 0.012))
        r = bpy.context.active_object
        r.name = 'rivet'
        r.scale.z = 0.62
        bpy.ops.object.transform_apply(scale=True)
        r.data.materials.append(mats[MAT_CHROME])
        parts.append(r)
    return join_objects(parts, 'door_rivets')


def build_wheel(mats):
    parts = []
    bpy.ops.mesh.primitive_torus_add(
        major_radius=0.54, minor_radius=0.06, major_segments=64, minor_segments=12,
        location=(0, 0, 0))
    rim = bpy.context.active_object
    rim.name = 'wheel_rim'
    rim.data.materials.append(mats[MAT_CHROME])
    parts.append(rim)
    for i in range(6):
        a = (i / 6) * math.pi * 2
        bpy.ops.mesh.primitive_cylinder_add(radius=0.045, depth=0.52, location=(0, 0, 0))
        spoke = bpy.context.active_object
        spoke.name = 'wheel_spoke'
        spoke.rotation_mode = 'QUATERNION'
        spoke.rotation_quaternion = Quaternion((0, 0, 1), a) @ Quaternion((1, 0, 0), math.pi / 2)
        spoke.data.materials.append(mats[MAT_CHROME])
        parts.append(spoke)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.15, depth=0.18, location=(0, 0, 0.02))
    hub = bpy.context.active_object
    hub.name = 'wheel_hub'
    hub.rotation_mode = 'QUATERNION'
    hub.rotation_quaternion = Quaternion((1, 0, 0), math.pi / 2)
    hub.data.materials.append(mats[MAT_GOLD])
    parts.append(hub)
    for i in range(3):
        a = (i / 3) * math.pi * 2
        bpy.ops.mesh.primitive_uv_sphere_add(
            radius=0.062, segments=14, ring_count=10,
            location=(math.cos(a) * 0.54, math.sin(a) * 0.54, 0.07))
        knob = bpy.context.active_object
        knob.name = 'wheel_knob'
        knob.data.materials.append(mats[MAT_GOLD])
        parts.append(knob)
    bpy.ops.mesh.primitive_circle_add(radius=0.66, vertices=64, location=(0, 0, -0.07))
    dial = bpy.context.active_object
    dial.name = 'wheel_dial'
    dial.data.materials.append(mats[MAT_STEEL])
    parts.append(dial)
    ob = join_objects(parts, 'safe_wheel')
    uv_cube(ob, 1.2)
    ob.location = (DOOR_CX, DOOR_Y - 0.86, DOOR_Z + HALF_T + 0.10)
    return ob


def build_doorback(mats):
    parts = []
    bpy.ops.mesh.primitive_cylinder_add(
        radius=DOOR_R - 0.14, depth=0.07, vertices=64,
        location=(DOOR_CX, DOOR_Y, DOOR_Z - HALF_T - 0.035))
    dish = bpy.context.active_object
    dish.data.materials.append(mats[MAT_STEEL])
    parts.append(dish)
    for i in range(8):
        a = (i / 8) * math.pi * 2 + math.pi / 8
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
        rib = bpy.context.active_object
        rib.scale = ((DOOR_R - 0.30) * 0.9, 0.09, 0.09)
        bpy.ops.object.transform_apply(scale=True)
        rib.rotation_euler = (0, 0, a)
        rib.location = (DOOR_CX + math.cos(a) * (DOOR_R - 0.30) * 0.5,
                        DOOR_Y + math.sin(a) * (DOOR_R - 0.30) * 0.5,
                        DOOR_Z - HALF_T - 0.07)
        rib.data.materials.append(mats[MAT_STEEL])
        parts.append(rib)
    for i in range(8):
        a = (i / 8) * math.pi * 2
        bpy.ops.mesh.primitive_uv_sphere_add(
            radius=0.05, segments=12, ring_count=8,
            location=(DOOR_CX + math.cos(a) * (DOOR_R - 0.24),
                      DOOR_Y + math.sin(a) * (DOOR_R - 0.24),
                      DOOR_Z - HALF_T - 0.07))
        b = bpy.context.active_object
        b.data.materials.append(mats[MAT_CHROME])
        parts.append(b)
    ob = join_objects(parts, 'safe_doorback')
    uv_cube(ob, 2.4)
    return ob


BOLT_ANGLES_DEG = [-30, 0, 30, 78, 102, 258, 282]
bolt_registry = []                                 # (obj, base_vec, dir_vec) мировые


def build_bolts(mats):
    z = DOOR_Z + HALF_T - 0.02
    for i, deg in enumerate(BOLT_ANGLES_DEG):
        a = math.radians(deg)
        d = Vector((math.cos(a), math.sin(a), 0.0))
        base = Vector((DOOR_CX, DOOR_Y, z)) + d * (DOOR_R + 0.10)
        bpy.ops.mesh.primitive_cylinder_add(radius=0.075, depth=0.42, vertices=20,
                                            location=(base.x, base.y, base.z))
        ob = bpy.context.active_object
        ob.name = f'bolt_{i + 1:02d}'
        ob.rotation_mode = 'QUATERNION'
        ob.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d)
        ob.data.materials.append(mats[MAT_CHROME])
        bolt_registry.append((ob, base.copy(), d))


def add_anchor(name, location, parent=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.08
    bpy.context.collection.objects.link(e)
    if parent is not None:
        e.parent = parent
        e.matrix_parent_inverse = Matrix.Identity(4)
    e.location = location
    return e


# ═══════════════════════════ АНИМАЦИИ ════════════════════════════════════════
def prep_action(obj, clip):
    ad = obj.animation_data_create()
    act = bpy.data.actions.new(clip)
    ad.action = act
    ACTION_MAP.setdefault(obj.name, {})[clip] = act
    return act


def record_open():
    door = bpy.data.objects['safe_door']
    wheel = bpy.data.objects['safe_wheel']
    door.rotation_mode = 'QUATERNION'
    wheel.rotation_mode = 'QUATERNION'
    prep_action(door, 'open')
    prep_action(wheel, 'open')
    for (b, _, _) in bolt_registry:
        prep_action(b, 'open')
    frames = int(3.0 * FPS)
    for f in range(frames + 1):
        t = f / FPS
        bp = clamp01(t / 0.45)
        w = ease_out_cubic(clamp01((t - 0.35) / 0.9)) * math.pi * 3
        dd = ease_in_out(clamp01((t - 1.15) / 1.6))
        # Оси — в Blender-фрейме (петль вертикальна = +Z, нормаль двери = -Y)
        door.rotation_quaternion = Quaternion((0, 0, 1), -1.12 * dd)
        door.location = (0, -0.16 * dd, 0)         # выезд двери на камеру
        door.keyframe_insert('rotation_quaternion', frame=f)
        door.keyframe_insert('location', frame=f)
        wheel.rotation_quaternion = Quaternion((0, -1, 0), w)
        wheel.keyframe_insert('rotation_quaternion', frame=f)
        for (b, base, d) in bolt_registry:
            b.location = base - (R4 @ d) * (0.34 * bp)
            b.keyframe_insert('location', frame=f)


def record_loop(clip, dur, wheel_fn, bolt_fn):
    wheel = bpy.data.objects['safe_wheel']
    wheel.rotation_mode = 'QUATERNION'
    prep_action(wheel, clip)
    for (b, _, _) in bolt_registry:
        prep_action(b, clip)
    frames = int(dur * FPS)
    for f in range(frames + 1):
        t = f / FPS
        wheel.rotation_quaternion = Quaternion((0, -1, 0), wheel_fn(t))
        wheel.keyframe_insert('rotation_quaternion', frame=f)
        for i, (b, base, d) in enumerate(bolt_registry):
            b.location = base + (R4 @ d) * bolt_fn(t, i)
            b.keyframe_insert('location', frame=f)


def record_idle():
    amp = 0.006
    phases = [i * 0.9 for i in range(len(bolt_registry))]
    record_loop(
        'idle', 3.0,
        lambda t: math.radians(2.0) * math.sin(2 * math.pi * t / 3.0),
        lambda t, i: amp * math.sin(2 * math.pi * 2 * t / 3.0 + phases[i]))


def record_spin():
    record_loop(
        'spin', 1.5,
        lambda t: 2 * math.pi * t / 1.5,
        lambda t, i: 0.008 * math.sin(2 * math.pi * 6 * t / 1.5 + i * 1.3))


def push_nla_mapped():
    for obj_name, clips in ACTION_MAP.items():
        obj = bpy.data.objects[obj_name]
        ad = obj.animation_data_create()
        ad.action = None
        for clip, act in clips.items():
            track = ad.nla_tracks.new()
            track.name = clip
            strip = track.strips.new(clip, 0, act)
            strip.name = clip


# ═══════════════════════════ СБОРКА ══════════════════════════════════════════
def main():
    wipe()
    bpy.context.scene.render.fps = FPS
    mats = build_materials()

    plinth = build_plinth(mats)
    body = build_body(mats)
    frame, cutter = build_frame(mats)
    collar = build_collar(mats)
    hinges = build_hinges(mats)
    interior = build_interior(mats)
    bars = build_gold_bars(mats)
    indicator = build_indicator(mats)
    frame_bolts = build_frame_bolts(mats)
    static = [plinth, body, frame, collar, hinges, interior, bars, indicator,
              frame_bolts]

    door = build_door(mats)
    doorback = build_doorback(mats)
    rivets = build_rivets(mats)
    wheel = build_wheel(mats)
    build_bolts(mats)

    # ── Оси: авторим в «сценных» координатах (Y — высота, +Z — на камеру),
    #    Blender — Z-up. Поворачиваем ДАННЫЕ МЕШЕЙ и позиции на +90° вокруг X
    #    (объекты остаются с единичными поворотами — так экспортер корректно
    #    пересчитает и статику, и анимации в glTF Y-up). ──
    R4 = Matrix.Rotation(math.pi / 2, 4, 'X')
    R4q = R4.to_quaternion()
    for ob in bpy.data.objects:
        if ob.type == 'MESH' and not ob.name.startswith('bolt_'):
            me = ob.data
            me.transform(R4)
            me.update()
        if ob.rotation_mode == 'QUATERNION' and (
                ob.rotation_quaternion.x or ob.rotation_quaternion.y or
                ob.rotation_quaternion.z or abs(ob.rotation_quaternion.w - 1) > 1e-9):
            # сопряжение: локальный фрейм двери/корня = Blender-оси после
            # поворота иерархии; в glTF локаль уйдёт через conv = R4^-1
            ob.rotation_quaternion = R4q @ ob.rotation_quaternion @ R4q.inverted()
        else:
            ob.rotation_euler = (0, 0, 0)
        ob.location = R4 @ ob.location
    for nm in ('safe_collar', 'safe_wheel', 'safe_hinges', 'safe_doorback', 'frame_bolts'):
        ob = bpy.data.objects.get(nm)
        if ob:
            for pgn in ob.data.polygons:
                pgn.use_smooth = True
            try:
                bpy.ops.object.select_all(action='DESELECT')
                ob.select_set(True)
                bpy.context.view_layer.objects.active = ob
                bpy.ops.object.shade_auto_smooth(angle=math.radians(38))
            except Exception:
                pass
    bpy.context.view_layer.update()

    # ── Иерархия: только аналитический парентинг (без ops и зависимостей от
    #    устаревших матриц вида). Родитель без поворота → локальная поза =
    #    мировая − мировая позиция родителя. ──
    HINGE = R4 @ Vector((HINGE_X, DOOR_Y, DOOR_Z))

    def parent_to(child, parent, local_loc):
        child.parent = parent
        child.matrix_parent_inverse = Matrix.Identity(4)
        child.location = local_loc

    # Корень НА ПЕТЛЕ
    root = bpy.data.objects.new('safe', None)
    root.empty_display_size = 0.2
    bpy.context.collection.objects.link(root)
    root.location = HINGE

    for ob in static:
        parent_to(ob, root, ob.location.copy() - HINGE)
    # Дверь: её origin и есть петля
    parent_to(door, root, Vector((0, 0, 0)))
    # Дети двери: локальная = мировая − петля (оси совпадают)
    for ob in [rivets, wheel, doorback] + [b for (b, _, _) in bolt_registry]:
        parent_to(ob, door, ob.location.copy() - HINGE)

    # После парентинга запоминаем ЛОКАЛЬНЫЕ позы ригелей — анимация пишет
    # ключи в локальных координатах
    for i, (b, _base, d) in enumerate(bolt_registry):
        bolt_registry[i] = (b, b.location.copy(), d)

    # Якоря: локальные значения заданы в «сценных» осях → в родительский
    # (Blender) фрейм через тот же поворот R4. Задаются ПОСЛЕ родителя.
    def rl(x, y, z):
        return R4 @ Vector((x, y, z))
    a_drums = add_anchor('Anchor_Drums', rl(HINGE_TO_DOOR, DRUM_Y - DOOR_Y, HALF_T + 0.04), door)
    a_sparks = add_anchor('Anchor_Sparks', rl(HINGE_TO_DOOR, 0.0, HALF_T + 0.24), door)
    add_anchor('Anchor_Light', rl(0 - HINGE_X, 1.88 - DOOR_Y, -0.7 - DOOR_Z), root)
    add_anchor('Anchor_Floor', rl(0 - HINGE_X, 0.0 - DOOR_Y, 0.0 - DOOR_Z), root)

    # Применить модификаторы (булев/фаски) ПОСЛЕ резки, ДО удаления резака
    for ob in (plinth, body, frame):
        bpy.context.view_layer.objects.active = ob
        for m in list(ob.modifiers):
            bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.data.objects.remove(cutter, do_unlink=True)
    bpy.ops.object.select_all(action='DESELECT')

    # ── Анимации ──
    record_idle()
    record_spin()
    record_open()
    push_nla_mapped()

    # Закрытая поза в кадре 0 (все клипы в нуле дают нейтральную позу)
    bpy.context.scene.frame_set(0)

    # Имена меш-блоков = имена объектов (без «Cube.017» в glTF — ТЗ 4.1)
    for ob in bpy.data.objects:
        if ob.type == 'MESH':
            ob.data.name = ob.name

    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'safe.blend'))

    out_glb = os.path.join(MODELS, 'safe.glb')
    bpy.ops.export_scene.gltf(
        filepath=out_glb,
        export_format='GLB',
        export_animations=True,
        export_nla_strips=True,
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
