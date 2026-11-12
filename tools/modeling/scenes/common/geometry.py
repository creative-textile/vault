"""Общие геометрические хелперы для Blender-сцен Vault (headless, bpy).

Пайплайн: tools/modeling/scenes/<asset>.py -> frontend/models-src/<asset>/ ->
frontend/public/models/<asset>.glb.  правила — tools/modeling/README.md.

Координаты: сцена строится в «сценных» единицах (1 блок = 1 метр, пол на y=0,
лицо модели смотрит в +Z), а Blender — Z-up.  Финальный glTF (export_yup) должен
попасть в те же сце́нные координаты, поэтому каждый объект строится через
обратный поворот R4^-1 = rotX(-90°):  Blender = (x, -z, y)  для сце́нной (x, y, z).
Размеры аналогично переставляются:  (dx, dy, dz)_scene -> (dx, dz, dy)_blender.
"""
import math

import bpy
import bmesh
from mathutils import Vector, Matrix


def wipe():
    """Полная очистка сцены: объекты, меши, материалы, изображения, клипы."""
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images,
                 bpy.data.actions):
        for item in list(coll):
            coll.remove(item)


def S(x, y, z):
    """Сценная координата -> Blender (обратный экспортный поворот)."""
    return Vector((x, -z, y))


def SS(dx, dy, dz):
    """Сценный размер -> Blender."""
    return Vector((dx, dz, dy))


def add_cube(name, center, size, mat):
    """Куб со смещением центра и размером `size` (описание — Vector)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    bpy.ops.object.transform_apply(scale=True)
    ob.data.materials.append(mat)
    return ob


def bevel(ob, width, seg=3):
    """Фасковый модификатор: металл имеет толщину, углы не острые."""
    m = ob.modifiers.new('bev', 'BEVEL')
    m.width = width
    m.segments = seg
    m.limit_method = 'ANGLE'
    m.angle_limit = math.radians(30)
    return m


def apply_modifiers(ob):
    """Применить все модификаторы объекта (по порядку стека)."""
    bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def uv_cube(ob, size=4.0):
    """Cube-projection UV: одна текстура на всю модель, атлас не нужен."""
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
    """Объединить меши в один объект (один примитив на функциональную деталь)."""
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = parts[0]
    for p in parts:
        p.select_set(True)
    bpy.ops.object.join()
    ob = bpy.context.active_object
    ob.name = name
    bpy.ops.object.select_all(action='DESELECT')
    return ob


def smooth_shade(ob, angle_deg=38.0):
    """Smooth-shading + авто-сглаживание по углу (металл без резких граней)."""
    for pgn in ob.data.polygons:
        pgn.use_smooth = True
    try:
        bpy.ops.object.select_all(action='DESELECT')
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.shade_auto_smooth(angle=math.radians(angle_deg))
    except Exception:
        pass


def add_anchor(name, location, parent=None):
    """Пустышка-якорь (Anchor_*) для VFX-цепочек сцены."""
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.08
    bpy.context.collection.objects.link(e)
    if parent is not None:
        e.parent = parent
        e.matrix_parent_inverse = Matrix.Identity(4)
    e.location = location
    return e


def parent_to(child, parent, local_loc):
    """Аналитический парентинг: local = world - world(parent)."""
    child.parent = parent
    child.matrix_parent_inverse = Matrix.Identity(4)
    child.location = local_loc
