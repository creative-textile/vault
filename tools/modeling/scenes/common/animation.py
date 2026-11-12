"""Анимации (клипы) для GLB-ассетов: idle / spin / open, 60 fps.

Формулы сцены (ТЗ 4.4):
  open  3.0 с — ригели уходят, штурвал прокручивается на 3π, дверь распахивается;
  idle  3.0 с — штурвал качается ±2°, ригели дрожат;
  spin  1.5 с — штурвал вращается, ригели дрожат.

Ключевые кадры берутся явно (детерминизм: повтор даёт ту же позу — oracle
«повтор даёт те же числа»). В Blender-фрейме (Z-up): ось петли = +Z, нормаль
двери = -Y, ось штурвала = -Y.
"""
import math

import bpy
from mathutils import Quaternion, Vector

FPS = 60
ACTION_MAP = {}


def clamp01(t):
    return max(0.0, min(1.0, t))


def ease_out_cubic(t):
    return 1.0 - (1.0 - t) ** 3


def ease_in_out(t):
    return 2 * t * t if t < 0.5 else 1.0 - ((-2 * t + 2) ** 2) / 2


def prep_action(obj, clip):
    ad = obj.animation_data_create()
    act = bpy.data.actions.new(clip)
    ad.action = act
    ACTION_MAP.setdefault(obj.name, {})[clip] = act
    return act


def record_open(door, wheel, bolts, frames=None):
    """open: ригели уходят -> штурвал -> дверь распахивается."""
    frames = frames or int(3.0 * FPS)
    door.rotation_mode = 'XYZ'
    prep_action(door, 'open')
    prep_action(wheel, 'open')
    for (b, _base, _d) in bolts:
        prep_action(b, 'open')
    for f in range(frames + 1):
        t = f / FPS
        bp = clamp01(t / 0.45)
        w = ease_out_cubic(clamp01((t - 0.35) / 0.9)) * math.pi * 3
        dd = ease_in_out(clamp01((t - 1.15) / 1.6))
        door.rotation_euler = (0.0, -1.12 * dd, 0.0)      # ось петли = Y
        door.location = (0.0, -0.16 * dd, 0.0)             # дверь выезжает к зрителю
        door.keyframe_insert('rotation_euler', frame=f)
        door.keyframe_insert('location', frame=f)
        wheel.rotation_mode = 'QUATERNION'
        wheel.rotation_quaternion = Quaternion((0, 1, 0), w)
        wheel.keyframe_insert('rotation_quaternion', frame=f)
        for (b, base, d) in bolts:
            b.location = base + Vector((0.0, 0.34 * bp, 0.0))   # вглубь двери (ось Y)
            b.keyframe_insert('location', frame=f)


def record_loop(clip, dur, wheel, bolts, wheel_fn, bolt_fn):
    frames = int(dur * FPS)
    prep_action(wheel, clip)
    for (b, _base, _d) in bolts:
        prep_action(b, clip)
    for f in range(frames + 1):
        t = f / FPS
        wheel.rotation_mode = 'QUATERNION'
        wheel.rotation_quaternion = Quaternion((0, -1, 0), wheel_fn(t))
        wheel.keyframe_insert('rotation_quaternion', frame=f)
        for i, (b, base, d) in enumerate(bolts):
            b.location = base + Vector((0.0, bolt_fn(t, i), 0.0))   # вдоль оси ригеля (Y)
            b.keyframe_insert('location', frame=f)


def record_idle(wheel, bolts):
    phases = [i * 0.9 for i in range(len(bolts))]
    record_loop(
        'idle', 3.0, wheel, bolts,
        lambda t: math.radians(2.0) * math.sin(2 * math.pi * t / 3.0),
        lambda t, i: 0.006 * math.sin(2 * math.pi * 2 * t / 3.0 + phases[i]))


def record_spin(wheel, bolts):
    record_loop(
        'spin', 1.5, wheel, bolts,
        lambda t: 2 * math.pi * t / 1.5,
        lambda t, i: 0.008 * math.sin(2 * math.pi * 6 * t / 1.5 + i * 1.3))


def push_nla_mapped():
    """Клипы как NLA-strips: экспорт glTF с export_nla_strips=True."""
    for obj_name, clips in ACTION_MAP.items():
        obj = bpy.data.objects[obj_name]
        ad = obj.animation_data_create()
        ad.action = None
        for clip, act in clips.items():
            track = ad.nla_tracks.new()
            track.name = clip
            strip = track.strips.new(clip, 0, act)
            strip.name = clip
