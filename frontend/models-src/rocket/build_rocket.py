#!/usr/bin/env python3
"""
Сборка `rocket.glb` (bpy, headless) — ТЗ «3D-модели», приоритет 2.

Авторим в «сценных» координатах (Y — высота ракеты, +Z — на камеру), затем
поворотом данных мешей на +90° вокруг X переводим в Blender Z-up (см. safe).

  rocket (root на срезе сопла)
   ├─ rocket_hull    — корпус-тело вращения (оживало), перламутр с расшивкой
   ├─ rocket_nose    — красный носовой обтекатель
   ├─ rocket_nozzle  — раструб сопла (воронёная сталь)
   ├─ fin_01..04     — стабилизаторы с фаской (красный лак)
   ├─ porthole_ring / porthole_glass — иллюминатор
   ├─ Anchor_Flame (срез сопла), Anchor_Nose (остриё)

Материалы (≤4): rocket_hull, rocket_red, rocket_steel, rocket_glass.
"""
import os
import math
import bpy
import bmesh
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(HERE, '..', '..', 'public', 'models')
TEX = os.path.join(HERE, 'textures', 'rocket')
FPS = 60
R4 = Matrix.Rotation(math.pi / 2, 4, 'X')

H = 2.5            # высота корпуса
R = 0.46           # радиус миделя


def ease_out_cubic(t): return 1.0 - (1.0 - t) ** 3


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
                  clearcoat=0.0, transmission=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = base_rgba
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = roughness
    if clearcoat:
        b.inputs['Coat Weight'].default_value = clearcoat
        b.inputs['Coat Roughness'].default_value = 0.07
    if transmission:
        b.inputs['Transmission Weight'].default_value = transmission
        b.inputs['IOR'].default_value = 1.5
    if map_img is not None:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = map_img
        nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    if orm_img is not None:
        o = nt.nodes.new('ShaderNodeTexImage'); o.image = orm_img
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(o.outputs['Color'], sep.inputs[0])
        nt.links.new(sep.outputs[1], b.inputs['Roughness'])
        nt.links.new(sep.outputs[2], b.inputs['Metallic'])
    if normal_img is not None:
        n = nt.nodes.new('ShaderNodeTexImage'); n.image = normal_img
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(n.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    return mat


def lathe(name, profile, steps, mat, smooth=True):
    """profile: список (r, y, v) — радиус, высота, v-координата развёртки."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new()
    rings = []
    for s in range(steps):
        a = (s / steps) * math.pi * 2
        ring = []
        for (r, y, v) in profile:
            ring.append(bm.verts.new((r * math.cos(a), y, r * math.sin(a))))
        rings.append((ring, s / steps))
    for s in range(steps):
        ring1, u1 = rings[s]
        ring2, u2 = rings[(s + 1) % steps]
        for i in range(len(profile) - 1):
            f = bm.faces.new((ring1[i], ring2[i], ring2[i + 1], ring1[i + 1]))
            vs = [profile[i][2], profile[i + 1][2]]
            for loop in f.loops:
                vi = ring1.index(loop.vert) if loop.vert in ring1 else ring2.index(loop.vert)
                uu = u1 if loop.vert in ring1 else u2
                loop[uv_layer].uv = (uu, vs[vi] if vi < len(vs) else 0)
    # торцы-веера
    if profile[0][0] > 0.002:
        c1 = bm.verts.new((0, profile[0][1], 0))
        for s in range(steps):
            s2 = (s + 1) % steps
            bm.faces.new((c1, rings[s2][0][0], rings[s][0][0]))
    if profile[-1][0] > 0.002:
        c2 = bm.verts.new((0, profile[-1][1], 0))
        for s in range(steps):
            s2 = (s + 1) % steps
            bm.faces.new((c2, rings[s][0][-1], rings[s2][0][-1]))
    bm.to_mesh(mesh)
    bm.free()
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat)
    if smooth:
        for p in ob.data.polygons:
            p.use_smooth = True
    return ob


def main():
    wipe()
    mats = {
        'rocket_hull': make_material(
            'rocket_hull', (0.93, 0.94, 0.97, 1), 0.18, 0.34,
            map_img=load_image('rocket_map.png', True),
            orm_img=load_image('rocket_orm.png', False),
            normal_img=load_image('rocket_normal.png', False),
            clearcoat=1.0),
        'rocket_red': make_material('rocket_red', (0.70, 0.02, 0.07, 1), 0.3, 0.26,
                                    clearcoat=1.0),
        'rocket_steel': make_material('rocket_steel', (0.10, 0.11, 0.19, 1), 0.94, 0.42),
        'rocket_glass': make_material('rocket_glass', (0.03, 0.05, 0.09, 1), 0.1, 0.08),
    }

    # ── Корпус: профиль как в процедурной сцене ──
    profile = []
    steps = 26
    for i in range(steps + 1):
        t = i / steps
        y = -H / 2 + t * H
        if t < 0.16:
            r = R * (0.56 + 0.44 * ease_out_cubic(t / 0.16))
        elif t < 0.62:
            k = (t - 0.16) / 0.46
            r = R * (1 + 0.035 * math.sin(k * math.pi))
        else:
            k = (t - 0.62) / 0.38
            r = R * math.sqrt(max(0.0, 1 - k * k)) * (1 - 0.1 * k)
        profile.append((max(0.001, r), y, t))
    hull = lathe('rocket_hull', profile, 56, mats['rocket_hull'])

    # ── Носовой обтекатель (красный лак) ──
    nose = []
    for i in range(15):
        t = i / 14
        y = H * 0.18 + t * H * 0.32
        r = R * math.sqrt(max(0.0, 1 - t * t)) * (1 - 0.1 * t) * 1.012
        nose.append((max(0.001, r), y, 0.6 + 0.4 * t))
    nose_ob = lathe('rocket_nose', nose, 56, mats['rocket_red'])

    # ── Сопло: раструб ──
    noz = []
    for i in range(11):
        t = i / 10
        y = -H / 2 + 0.06 - t * 0.34
        r = 0.26 + 0.16 * ease_out_cubic(t)
        noz.append((r, y, t * 0.2))
    nozzle = lathe('rocket_nozzle', noz, 48, mats['rocket_steel'])

    # ── Стабилизаторы: фаска + сужение к законцовке ──
    fins = []
    for i in range(4):
        a = (i / 4) * math.pi * 2 + math.pi / 4
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
        fin = bpy.context.active_object
        fin.name = f'fin_{i + 1:02d}'
        fin.scale = (0.62, 0.05, 0.95)
        bpy.ops.object.transform_apply(scale=True)
        bm = bmesh.new()
        bm.from_mesh(fin.data)
        for v in bm.verts:
            if v.co.z > 0.3:                      # скос законцовки
                v.co.x *= 0.45
        bm.to_mesh(fin.data)
        bm.free()
        m = fin.modifiers.new('bev', 'BEVEL')
        m.width = 0.02
        m.segments = 2
        bpy.context.view_layer.objects.active = fin
        bpy.ops.object.modifier_apply(modifier='bev')
        fin.rotation_euler = (0, 0, a)
        fin.location = (math.cos(a) * 0.62, math.sin(a) * 0.62, -0.78)
        fin.data.materials.append(mats['rocket_red'])
        fins.append(fin)

    # ── Иллюминатор: кольцо + стекло (лицо ракеты = +Z сцены) ──
    bpy.ops.mesh.primitive_torus_add(major_radius=0.17, minor_radius=0.035,
                                     major_segments=40, minor_segments=12,
                                     location=(0, 0.55, R * 0.97))
    ring = bpy.context.active_object
    ring.name = 'porthole_ring'
    ring.data.materials.append(mats['rocket_steel'])
    bpy.ops.mesh.primitive_circle_add(radius=0.155, vertices=40, fill_type='NGON',
                                      location=(0, 0.55, R * 0.985))
    glassd = bpy.context.active_object
    glassd.name = 'porthole_glass'
    glassd.data.materials.append(mats['rocket_glass'])

    # ── Оси: сценные → Blender (поворот данных и позиций) ──
    bpy.context.view_layer.update()
    for ob in list(bpy.data.objects):
        if ob.type == 'MESH':
            ob.data.transform(R4)
            ob.data.update()
        ob.location = R4 @ ob.location
    bpy.context.view_layer.update()

    # ── Иерархия: root на срезе сопла ──
    NOZZLE_Y = -H / 2 - 0.28
    root = bpy.data.objects.new('rocket', None)
    root.empty_display_size = 0.2
    bpy.context.collection.objects.link(root)
    root.location = R4 @ Vector((0, NOZZLE_Y, 0))

    def parent_to(child, local):
        child.parent = root
        child.matrix_parent_inverse = Matrix.Identity(4)
        child.location = local

    HINGE = R4 @ Vector((0, NOZZLE_Y, 0))
    for ob in [hull, nose_ob, nozzle, ring, glassd] + fins:
        parent_to(ob, ob.location.copy() - HINGE)

    def anchor(name, scene_pos):
        e = bpy.data.objects.new(name, None)
        e.empty_display_size = 0.1
        bpy.context.collection.objects.link(e)
        e.parent = root
        e.matrix_parent_inverse = Matrix.Identity(4)
        e.location = (R4 @ Vector(scene_pos)) - HINGE
        return e
    anchor('Anchor_Flame', (0, NOZZLE_Y - 0.02, 0))
    anchor('Anchor_Nose', (0, H / 2, 0))

    for ob in bpy.data.objects:
        if ob.type == 'MESH':
            ob.data.name = ob.name

    bpy.context.scene.frame_set(0)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'rocket.blend'))
    out = os.path.join(MODELS, 'rocket.glb')
    bpy.ops.export_scene.gltf(
        filepath=out, export_format='GLB',
        export_animations=False, export_yup=True, export_apply=True,
        export_lights=False, export_cameras=False, export_materials='EXPORT')
    tris = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
    print(f'DONE rocket.glb size={os.path.getsize(out)} tris≈{tris}')


if __name__ == '__main__':
    main()
