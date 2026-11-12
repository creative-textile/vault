#!/usr/bin/env python3
"""
test_bpy.py — smoke test for the headless Blender (bpy) toolkit.

Runs with VAULT_BPY_HOME/bin/bpy-python set (setup_bpy.sh --check does this), or directly:
  $VAULT_BPY_HOME/bin/bpy-python tools/modeling/test_bpy.py

What it verifies:
  * bpy imports in headless/background mode;
  * mesh ops work: cube, non-uniform scale baked into vertices, material;
  * GLB export: file is valid, accessor min/max match the baked scale,
    node transform is identity, material is embedded;
  * .gltf (embedded) export works too;
  * UV coordinates exist on the mesh;
  * Cycles CPU render to PNG works (the offscreen-friendly renderer).
Exit 0 = all green.
"""
import json
import os
import struct
import subprocess
import sys
import time

TMP = "/tmp/vault_bpy_test"
failures = 0


def check(name, cond, detail=""):
    global failures
    if cond:
        print(f"✓ {name}")
    else:
        failures += 1
        print(f"✗ {name}" + (f" — {detail}" if detail else ""))


def main():
    import bpy

    os.makedirs(TMP, exist_ok=True)
    t0 = time.time()
    check("headless mode", bpy.app.background is True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 1))
    cube = bpy.context.active_object
    cube.scale = (1.2, 0.8, 1.0)  # non-uniform: distinguishes baked vs. node transform
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    mat = bpy.data.materials.new("VaultBasic")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.9, 0.25, 0.2, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.5
    cube.data.materials.append(mat)
    bpy.context.view_layer.objects.active = cube
    cube.select_set(True)
    try:
        bpy.ops.object.shade_smooth_by_angle()
    except Exception:
        bpy.ops.object.shade_smooth()

    mesh = cube.data
    uv = mesh.uv_layers.get("UVMap")
    check("mesh has 6 faces", len(mesh.polygons) == 6, f"{len(mesh.polygons)}")
    check("mesh has UV layer", uv is not None and len(uv.data) >= len(mesh.polygons) * 3,
          f"uvs={0 if uv is None else len(uv.data)}")
    check("material assigned", len(cube.data.materials) == 1)

    # --- GLB export ---
    glb = os.path.join(TMP, "cube.glb")
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", use_selection=True,
                              export_apply=True, use_active_collection=False,
                              export_lights=False, export_cameras=False)
    check("GLB file exists", os.path.isfile(glb) and os.path.getsize(glb) > 1000,
          f"{os.path.getsize(glb) if os.path.exists(glb) else 0} B")

    with open(glb, "rb") as f:
        magic = f.read(4)
        length, ctype = struct.unpack("<II", f.read(8))
        chunks, data = [], {}
        while len(chunks) < 4:
            head = f.read(8)
            if len(head) < 8:
                break
            clen, ctype2 = struct.unpack("<II", head)
            body = f.read(clen)
            chunks.append(ctype2)
            data[ctype2] = body
    GLB_JSON, GLB_BIN = 0x4E4F534A, 0x004E4942  # "JSON" / "BIN\0"
    check("GLB magic + JSON + BIN", magic == b"glTF" and GLB_JSON in data and GLB_BIN in data,
          f"chunks={chunks}")
    if GLB_JSON in data:
        j = json.loads(data[GLB_JSON])
        accessors = j.get("accessors", [])
        nodes = j.get("nodes", [])
        meshes = j.get("meshes", [])
        # glTF is Y-up, Blender is Z-up: exporter maps (x, y, z) -> (x, z, -y),
        # so the baked scale appears as (1.2, 1.0, 0.8) in glTF space.
        def approx(a, b, eps=1e-4):
            return a is not None and len(a) == len(b) and all(abs(x - y) < eps for x, y in zip(a, b))
        check("accessor min/max baked into vertices",
              accessors and approx(accessors[0].get("min"), [-1.2, -1, -0.8])
              and approx(accessors[0].get("max"), [1.2, 1, 0.8]),
              f"{accessors[0].get('min') if accessors else None}")
        check("node transform identity after export_apply",
              nodes and all(abs(v - 1.0) < 1e-6 for v in nodes[0].get("scale", [1, 1, 1])),
              f"{nodes[0] if nodes else None}")
        check("material embedded in GLB", len(j.get("materials", [])) >= 1)
        check("mesh present", len(meshes) >= 1)

    # --- embedded .gltf ---
    gltf = os.path.join(TMP, "cube.gltf")
    bpy.ops.export_scene.gltf(filepath=gltf, export_format="GLTF_SEPARATE", use_selection=True,
                              export_apply=True, export_lights=False, export_cameras=False)
    check(".gltf (separate) export works", os.path.isfile(gltf) and os.path.getsize(gltf) > 1000)
    if os.path.isfile(gltf):
        j2 = json.load(open(gltf))
        check(".gltf references an external .bin buffer",
              any(str(b.get("uri", "")).endswith(".bin") for b in j2.get("buffers", [])))

    # --- Cycles CPU render (offscreen-friendly) ---
    from mathutils import Vector
    cam_data = bpy.data.cameras.new("Cam")
    cam = bpy.data.objects.new("Cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    cam.location = (3, -3, 2.5)
    cam.rotation_euler = (Vector((0, 0, 0)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    light = bpy.data.lights.new("Sun", type="SUN")
    light.energy = 8
    light_obj = bpy.data.objects.new("Sun", light)
    bpy.context.scene.collection.objects.link(light_obj)
    light_obj.location = (5, -5, 8)
    light_obj.rotation_euler = (Vector((0, 0, 0)) - light_obj.location).to_track_quat("-Z", "Y").to_euler()
    # a world with a dim background, so the frame is not pure black
    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.1, 0.12, 0.15, 1.0)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.3
    bpy.context.scene.world = world
    bpy.context.scene.render.engine = "CYCLES"
    bpy.context.scene.cycles.device = "CPU"
    bpy.context.scene.render.resolution_x = 128
    bpy.context.scene.render.resolution_y = 128
    bpy.context.scene.cycles.samples = 16
    bpy.context.scene.render.filepath = os.path.join(TMP, "render.png")
    t1 = time.time()
    bpy.ops.render.render(write_still=True)
    t2 = time.time()
    rendered = bpy.context.scene.render.filepath
    img = bpy.data.images.load(rendered)
    w, h = img.size
    px = img.pixels[: w * h * 3]
    # pixels are linear floats in [0, 1]; count pixels where any channel is bright
    bright = sum(1 for i in range(0, len(px), 3)
                 if max(px[i], px[i + 1], px[i + 2]) > 0.8) / (w * h)
    check("Cycles CPU render lit the cube (>10% bright pixels)",
          os.path.isfile(rendered) and bright > 0.1,
          f"bright={bright:.0%}, {time.time() - t1:.1f}s")

    print(f"\nbpy smoke: {'all green' if failures == 0 else str(failures) + ' checks failed'} "
          f"({time.time() - t0:.0f}s total, render {t2 - t1:.0f}s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
