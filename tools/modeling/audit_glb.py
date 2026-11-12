#!/usr/bin/env python3
"""
audit_glb.py — измеряет GLB-файл и сверяет с бюджетом Vault.

Зачем: «модели очень плохие» и «игры тормозят» — это не ощущения, а числа.
Скрипт читает GLB без Blender и без numpy (только стандартная библиотека),
достаёт треугольники, материалы, текстуры, VRAM-оценку и анимации, и говорит
«в бюджете» или «вот где перебор». Работает в любой песочнице:

  python3 tools/modeling/audit_glb.py frontend/public/models/*.glb
  python3 tools/modeling/audit_glb.py --json frontend/public/models/rocket.glb
  python3 tools/modeling/audit_glb.py --budget tools/modeling/budget.json <файл>

Коды: 0 — всё в бюджете; 1 — есть превышения; 2 — файл не читается.
"""
import json
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_BUDGET = HERE / "budget.json"

# PNG: ширина и высота лежат в IHDR — первых 8 байт после сигнатуры.
PNG_SIG = b"\x89PNG\r\n\x1a\n"


def png_size(blob):
    if blob[:8] != PNG_SIG or blob[12:16] != b"IHDR":
        return None
    return struct.unpack(">II", blob[16:24])



def jpeg_size(blob):
    """Размер JPEG из маркера SOF — нужен, чтобы VRAM считался и для JPEG/WebP.

    Почему это важно: раньше VRAM оценивалась только для PNG, а для JPEG
    молча возвращала 0. После сжатия модели в JPEG аудит показывал «VRAM ≈ 0 Б»
    — то есть ЛОЖНОЕ «всё хорошо», хотя текстура 1024×1024 занимает 5.3 МБ.
    """
    if len(blob) < 4 or blob[0:2] != b"\xff\xd8":
        return None
    i = 2
    while i < len(blob) - 9:
        if blob[i] != 0xFF:
            i += 1
            continue
        marker = blob[i + 1]
        # SOF0..SOF15, кроме DHT(C4), JPG(C8), DAC(CC)
        if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
            h = int.from_bytes(blob[i + 5:i + 7], "big")
            w = int.from_bytes(blob[i + 7:i + 9], "big")
            return (w, h) if w and h else None
        seg_len = int.from_bytes(blob[i + 2:i + 4], "big")
        i += 2 + seg_len
    return None

def read_glb(path):
    """Возвращает (json-чанк, bin-начало, bin-длина)."""
    data = path.read_bytes()
    magic, version, total = struct.unpack("<III", data[:12])
    if magic != 0x46546C67:
        raise ValueError("не GLB: неверная сигнатура")
    if version != 2:
        raise ValueError(f"GLB версии {version}, поддерживается 2")
    offset = 12
    js, bin_off = None, None
    while offset < total:
        chunk_len, chunk_type = struct.unpack("<II", data[offset:offset + 8])
        body = offset + 8
        if chunk_type == 0x4E4F534A:  # JSON
            js = json.loads(data[body:body + chunk_len].decode("utf-8"))
        elif chunk_type == 0x004E4942:  # BIN
            bin_off = body
        offset = body + chunk_len
    if js is None:
        raise ValueError("в GLB нет JSON-чанка")
    return data, js, bin_off


def measure(path):
    data, js, bin_off = read_glb(path)

    tris = 0
    prims = 0
    skinned = 0
    for mesh in js.get("meshes", []):
        for prim in mesh.get("primitives", []):
            prims += 1
            if "JOINTS_0" in prim.get("attributes", {}):
                skinned += 1
            idx = prim.get("indices")
            if idx is not None:
                tris += js["accessors"][idx]["count"] / 3
            else:
                # Без индексов треугольники считаются по позициям.
                pos = prim.get("attributes", {}).get("POSITION")
                if pos is not None:
                    tris += js["accessors"][pos]["count"] / 3

    textures = []
    vram = 0
    tex_bytes = 0
    for img in js.get("images", []):
        view = js["bufferViews"][img["bufferView"]]
        start = (bin_off or 0) + view.get("byteOffset", 0)
        blob = data[start:start + view["byteLength"]]
        tex_bytes += len(blob)
        mime = img.get("mimeType") or ""
        if mime == "image/png":
            size = png_size(blob)
        elif mime in ("image/jpeg", "image/jpg"):
            size = jpeg_size(blob)
        else:
            size = None
        if size:
            w, h = size
            # RGBA8 + мип-цепочка 4/3 — так текстура живёт в VRAM.
            vram += int(w * h * 4 * 4 / 3)
            textures.append({"w": w, "h": h, "bytes": len(blob)})
        else:
            # Неизвестный формат: VRAM не посчитать. Молчать нельзя — иначе
            # аудит покажет «VRAM 0» и пропустит перегрузку памяти.
            textures.append({"w": None, "h": None, "bytes": len(blob), "unknownFormat": mime or "?"})

    anims = [
        {"name": a.get("name") or "", "channels": len(a.get("channels", []))}
        for a in js.get("animations", [])
    ]

    return {
        "file": path.name,
        "bytes": len(data),
        "triangles": int(round(tris)),
        "primitives": prims,
        "skinnedPrimitives": skinned,
        "materials": len(js.get("materials", [])),
        "textures": len(textures),
        "textureBytes": tex_bytes,
        "textureSizes": textures,
        "vramBytes": vram,
        "animations": anims,
        "extensionsUsed": js.get("extensionsUsed", []),
        "nodes": len(js.get("nodes", [])),
    }


def check(model, budget):
    per = budget["perModel"]
    problems = []

    def over(key, label, limit, value, unit=""):
        if value > limit:
            problems.append(f"{label}: {value}{unit} > {limit}{unit}")

    over("triangles", "треугольники", per["triangles"], model["triangles"])
    over("bytes", "вес файла", per["bytes"], model["bytes"], " Б")
    over("textureBytes", "вес текстур", per["textureBytes"], model["textureBytes"], " Б")
    over("vramBytes", "VRAM текстур", per["vramBytes"], model["vramBytes"], " Б")
    over("textures", "текстур", per["textures"], model["textures"])
    over("materials", "материалов", per["materials"], model["materials"])
    over("primitives", "primitive-групп", per["primitives"], model["primitives"])

    for tex in model["textureSizes"]:
        if tex["w"] and max(tex["w"], tex["h"]) > per["textureMaxSide"]:
            problems.append(
                f"текстура {tex['w']}x{tex['h']} > {per['textureMaxSide']}px"
            )

    for ext in model["extensionsUsed"]:
        if ext in budget.get("forbiddenExtensions", []):
            problems.append(f"запрещённое расширение {ext}")

    return problems


def human(n):
    if n >= 1 << 20:
        return f"{n / (1 << 20):.1f} МиБ"
    if n >= 1 << 10:
        return f"{n / (1 << 10):.0f} КиБ"
    return f"{n} Б"


def main(argv):
    as_json = "--json" in argv
    budget_path = DEFAULT_BUDGET
    if "--budget" in argv:
        budget_path = Path(argv[argv.index("--budget") + 1])
    files = [Path(a) for a in argv[1:] if not a.startswith("--") and a != str(budget_path)]
    if not files:
        print(__doc__.strip())
        return 2

    budget = json.loads(budget_path.read_text(encoding="utf-8"))
    report, failed = [], 0
    for path in files:
        try:
            model = measure(path)
        except Exception as exc:  # noqa: BLE001 — сообщение важнее типа
            print(f"✗ {path}: {exc}", file=sys.stderr)
            return 2
        problems = check(model, budget)
        failed += 1 if problems else 0
        report.append({"model": model, "problems": problems})
        if not as_json:
            print(f"\n{path.name}")
            print(f"  треугольники {model['triangles']:,} · primitive {model['primitives']}"
                  f" · материалы {model['materials']} · текстуры {model['textures']}")
            print(f"  вес {human(model['bytes'])} · текстуры {human(model['textureBytes'])}"
                  f" · VRAM ≈ {human(model['vramBytes'])}")
            if model["animations"]:
                clips = ", ".join(f"{a['name']}({a['channels']})" for a in model["animations"])
                print(f"  клипы: {clips}")
            if model["skinnedPrimitives"]:
                print(f"  скиннинг: {model['skinnedPrimitives']} primitive")
            print("  " + ("✓ в бюджете" if not problems else "✗ превышения:"))
            for p in problems:
                print(f"    - {p}")

    if as_json:
        print(json.dumps({"ok": failed == 0, "models": report}, ensure_ascii=False, indent=2))
    else:
        total = sum(m["model"]["bytes"] for m in report)
        print(f"\nфайлов {len(report)} · суммарно {human(total)} · вне бюджета {failed}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
