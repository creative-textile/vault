"""PBR-материалы направления C+A (docs/art-direction.md §4).

Палитра:
  металл корпуса  #8A8F98 -> #3A3F47, metalness 0.9, roughness 0.35
  золото         #E8B44A,           metalness 1.0, roughness 0.25
  красный        #D6453D,           painted,     roughness 0.6
  хром           #C4C9DC,           metalness 1.0, roughness 0.24

Ограничения бюджета (budget.json): <= 4 материала на модель, текстуры <= 1024 px.
transmission не используется (мобильный рендер, инвариант ТЗ).
"""
import os

import bpy


def load_image(path, srgb):
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
    return img


def make_material(name, base_rgba, metallic, roughness,
                  map_img=None, orm_img=None, normal_img=None):
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
    return mat


def build_safe_materials(tex_dir):
    """4 материала сейфа: сталь (текстуры), золото (текстуры), хром, красный."""
    mats = {}
    mats['steel'] = make_material(
        'safe_steel', (0.045, 0.052, 0.098, 1.0), 0.9, 0.35,
        map_img=load_image(os.path.join(tex_dir, 'steel_map.png'), True),
        orm_img=load_image(os.path.join(tex_dir, 'steel_orm.png'), False))
    mats['gold'] = make_material(
        'safe_gold', (0.927, 0.564, 0.055, 1.0), 1.0, 0.25,
        map_img=load_image(os.path.join(tex_dir, 'gold_map.png'), True),
        orm_img=load_image(os.path.join(tex_dir, 'gold_orm.png'), False))
    mats['chrome'] = make_material(
        'safe_chrome', (0.74, 0.78, 0.88, 1.0), 1.0, 0.24)
    mats['red'] = make_material(
        'safe_red', (0.88, 0.12, 0.10, 1.0), 0.0, 0.45)
    return mats
