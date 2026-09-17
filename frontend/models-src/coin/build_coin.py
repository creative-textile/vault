#!/usr/bin/env python3
"""
Сборка `coin.glb` (bpy headless) — монета Дуэли, ТЗ приоритет 3.

Авторим в сценных координатах (ось толщины = +Z, как coinFlip в DuelScene),
переводим в Blender Z-up объектным поворотом R4 (см. safe/rocket).

  coin (root в центре)
   ├─ coin_heads — аверс (звезда в лучах), планарная развёртка
   ├─ coin_tails — реверс (штурвал хранилища), зеркальная развёртка
   └─ coin_edge  — фаска + гурт с насечкой, цилиндрическая развёртка

Материалы (3): coin_heads, coin_tails, coin_edge — PBR золото
(map/normal/ORM). Габариты как в сцене: R=1.18, T=0.16.
"""
import os
import math
import bpy
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(HERE, '..', '..', 'public', 'models')
TEX = os.path.join(HERE, 'textures', 'coin')
R = 1.18
T = 0.16
SEG = 96
R4 = Matrix.Rotation(math.pi / 2, 4, 'X')
R4q = R4.to_quaternion()


def wipe():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for item in list(coll):
            coll.remove(item)


def load_image(name, srgb):
    img = bpy.data.images.load(os.path.join(TEX, name), check_existing=False)
    img.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
    return img


def gold_material(name, map_img=None, normal_img=None, orm_img=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.92, 0.72, 0.20, 1)
    b.inputs['Metallic'].default_value = 1.0
    b.inputs['Roughness'].default_value = 0.24
    if map_img is not None:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = map_img
        nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    if orm_img is not None:
        o = nt.nodes.new('ShaderNodeTexImage'); o.image = orm_img
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(o.outputs['Color'], sep.inputs[0])
        nt.links.new(sep.outputs[1], b.inputs['Roughness'])
    if normal_img is not None:
        n = nt.nodes.new('ShaderNodeTexImage'); n.image = normal_img
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(n.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    return mat


def new_obj(name, mat):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new()
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat)
    return ob, bm, uv


def main():
    wipe()
    m_heads = gold_material('coin_heads',
                            load_image('coin_heads_map.png', True),
                            load_image('coin_heads_normal.png', False),
                            load_image('coin_heads_orm.png', False))
    m_tails = gold_material('coin_tails',
                            load_image('coin_tails_map.png', True),
                            load_image('coin_tails_normal.png', False),
                            load_image('coin_tails_orm.png', False))
    m_edge = gold_material('coin_edge',
                           normal_img=load_image('coin_edge_normal.png', False))

    # ── аверс (+Z): веер с лёгким куполом ──
    heads, bm, uv = new_obj('coin_heads', m_heads)
    center = bm.verts.new((0, 0, T / 2 - 0.006 + 0.014))
    ring = []
    for s in range(SEG):
        a = s / SEG * 2 * math.pi
        r = R - 0.055
        ring.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r,
                                  T / 2 - 0.006 + 0.014 * (1 - (r / R) ** 2))))
    for s in range(SEG):
        s2 = (s + 1) % SEG
        f = bm.faces.new((center, ring[s], ring[s2]))
        for loop in f.loops:
            x, y, _ = loop.vert.co
            loop[uv].uv = (x / (2 * R) + 0.5, y / (2 * R) + 0.5)
    bm.to_mesh(heads.data); bm.free()

    # ── реверс (-Z): зеркальная развёртка ──
    tails, bm, uv = new_obj('coin_tails', m_tails)
    center = bm.verts.new((0, 0, -T / 2 + 0.006 - 0.014))
    ring = []
    for s in range(SEG):
        a = s / SEG * 2 * math.pi
        r = R - 0.055
        ring.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r,
                                  -T / 2 + 0.006 - 0.014 * (1 - (r / R) ** 2))))
    for s in range(SEG):
        s2 = (s + 1) % SEG
        f = bm.faces.new((center, ring[s2], ring[s]))   # нормаль в -Z
        for loop in f.loops:
            x, y, _ = loop.vert.co
            loop[uv].uv = (-x / (2 * R) + 0.5, y / (2 * R) + 0.5)
    bm.to_mesh(tails.data); bm.free()

    # ── гурт с фасками ──
    edge, bm, uv = new_obj('coin_edge', m_edge)
    profile = [
        (R - 0.055, T / 2 - 0.008, 0.0),
        (R - 0.02, T / 2 - 0.004, 0.18),
        (R - 0.004, T / 2 - 0.02, 0.3),
        (R, T / 2 - 0.055, 0.42),
        (R, -T / 2 + 0.055, 0.58),
        (R - 0.004, -T / 2 + 0.02, 0.7),
        (R - 0.02, -T / 2 + 0.004, 0.82),
        (R - 0.055, -T / 2 + 0.008, 1.0),
    ]
    rings = []
    for s in range(SEG):
        a = s / SEG * 2 * math.pi
        ring = [bm.verts.new((math.cos(a) * r, math.sin(a) * r, z))
                for (r, z, v) in profile]
        rings.append((ring, s / SEG))
    for s in range(SEG):
        r1, u1 = rings[s]
        r2, u2 = rings[(s + 1) % SEG]
        for i in range(len(profile) - 1):
            f = bm.faces.new((r1[i], r1[i + 1], r2[i + 1], r2[i]))
            for loop in f.loops:
                uu = u1 if loop.vert in r1 else u2
                vi = r1.index(loop.vert) if loop.vert in r1 else r2.index(loop.vert)
                loop[uv].uv = (uu * 8, profile[vi][2])   # 8 повторов насечки
    bm.to_mesh(edge.data); bm.free()

    for ob in (heads, tails, edge):
        for p in ob.data.polygons:
            p.use_smooth = True

    # ── сценные → Blender: только данные мешей (как в safe) ──
    for ob in (heads, tails, edge):
        ob.data.transform(R4)
        ob.data.update()

    root = bpy.data.objects.new('coin', None)
    root.empty_display_size = 0.3
    bpy.context.collection.objects.link(root)
    for ob in (heads, tails, edge):
        ob.parent = root
        ob.matrix_parent_inverse = Matrix.Identity(4)

    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'coin.blend'))
    out = os.path.join(MODELS, 'coin.glb')
    bpy.ops.export_scene.gltf(
        filepath=out, export_format='GLB',
        export_animations=False, export_yup=True, export_apply=True,
        export_lights=False, export_cameras=False, export_materials='EXPORT')
    tris = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
    print(f'DONE coin.glb size={os.path.getsize(out)} tris≈{tris}')


if __name__ == '__main__':
    main()
