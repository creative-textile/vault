"""Смоук нативного Blender: куб → GLB → CPU-рендер 640×360 → JSON с фактами.

Запускается через `npm run blender:check` (tools/local/blender.mjs), а не через
pip-модуль bpy. Проверяет ровно то, что нужно пайплайну: импорт bpy, экспорт
GLB, headless-рендер Cycles на CPU и версию движка.
"""
import json
import os
import sys

import bpy


def main():
    out_dir = os.environ.get("VAULT_SMOKE_DIR", os.path.join(os.getcwd(), ".state", "blender"))
    os.makedirs(out_dir, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)

    bpy.ops.mesh.primitive_cube_add(size=2.0)
    cube = bpy.context.active_object
    mat = bpy.data.materials.new("smoke")
    mat.diffuse_color = (0.2, 0.8, 0.7, 1.0)
    cube.data.materials.append(mat)

    glb = os.path.join(out_dir, "smoke.glb")
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", export_yup=True,
                              export_cameras=False, export_lights=False)

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 8
    scene.render.resolution_x = 640
    scene.render.resolution_y = 360
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    png = os.path.join(out_dir, "smoke.png")
    scene.render.filepath = png
    bpy.ops.object.camera_add(location=(4.0, -6.0, 3.0))
    bpy.ops.render.render(write_still=True)

    facts = {
        "blender": bpy.app.version_string,
        "background": bpy.app.background,
        "python": sys.version.split()[0],
        "engine": scene.render.engine,
        "glb_bytes": os.path.getsize(glb) if os.path.exists(glb) else 0,
        "png_bytes": os.path.getsize(png) if os.path.exists(png) else 0,
    }
    if facts["glb_bytes"] < 100 or facts["png_bytes"] < 100:
        print(json.dumps(facts, ensure_ascii=False), flush=True)
        raise SystemExit("смоук не дал GLB/PNG")
    print("VAULT_SMOKE " + json.dumps(facts, ensure_ascii=False), flush=True)


main()
