#!/usr/bin/env python3
"""
Self-test for tools/media (needs Pillow: run via `tools/media/setup.sh --check`).

Ported from narthex scripts/smoke-chromakey-guide.mts (functional part), plus
checks for the two fixes in this copy (--mode flood, --no-despill). Exit code 0 = all green.
"""
import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
CUT = os.path.join(HERE, "cutout-chromakey.py")
TMP = tempfile.mkdtemp(prefix="synapse_media_test_")
failures = 0


def check(name, cond, detail=""):
    global failures
    if cond:
        print(f"✓ {name}")
    else:
        failures += 1
        print(f"✗ {name}" + (f" — {detail}" if detail else ""))


def run(script, *args):
    return subprocess.run([sys.executable, script, *args], capture_output=True, text=True)


def probe(name, pts):
    px = Image.open(os.path.join(TMP, name)).convert("RGBA").load()
    return [px[x, y] for x, y in pts]


def t(name):
    return os.path.join(TMP, name)


# fixture 1: #00FF00 background; figure with TEAL details (the «Каркас» lesson);
# an inner pure-green cavity (legal hole)
img = Image.new("RGBA", (100, 100), (0, 255, 0, 255))
d = ImageDraw.Draw(img)
d.rectangle([25, 25, 75, 75], fill=(90, 30, 30, 255))            # body
d.ellipse([40, 40, 60, 60], fill=(40, 200, 170, 255))            # teal inset (b >= 75% g)
d.line([(30, 30), (70, 70)], fill=(30, 190, 160, 255), width=3)  # teal "vein"
d.rectangle([62, 30, 68, 36], fill=(0, 255, 0, 255))             # inner green cavity (window)
img.save(t("src.png"))

r = run(CUT, t("src.png"), t("auto.png"), "--mode", "auto", "--no-crop")
check("auto: exit 0", r.returncode == 0, r.stderr[-300:])
res = probe("auto.png", [(5, 5), (30, 60), (50, 50), (50, 49), (65, 33)])
check("auto: green corner removed", res[0][3] == 0, f"corner={res[0]}")
check("auto: figure body opaque", res[1][3] == 255, f"body={res[1]}")
check("auto: TEAL inset survives", res[2][3] == 255, f"teal={res[2]}")
check("auto: teal vein survives", res[3][3] == 255, f"vein={res[3]}")
check("auto: inner pure-green cavity removed", res[4][3] == 0, f"hole={res[4]}")

# fix 1: flood = outer background only, inner cavity stays
r = run(CUT, t("src.png"), t("flood.png"), "--mode", "flood", "--no-crop")
res = probe("flood.png", [(5, 5), (30, 60), (65, 33)])
check("flood: outer background removed (was a no-op in narthex copy)", res[0][3] == 0, f"corner={res[0]}")
check("flood: body opaque", res[1][3] == 255, f"body={res[1]}")
check("flood: inner cavity kept", res[2][3] == 255, f"hole={res[2]}")

# color mode: global strict key, teal still survives
r = run(CUT, t("src.png"), t("color.png"), "--mode", "color", "--no-crop")
res = probe("color.png", [(5, 5), (50, 50), (65, 33)])
check("color: background + cavity removed, teal kept",
      res[0][3] == 0 and res[2][3] == 0 and res[1][3] == 255, f"{res}")

# crop: tight bbox with 2px padding around the 51x51 body
r = run(CUT, t("src.png"), t("crop.png"), "--mode", "auto")
size = Image.open(t("crop.png")).size
check("crop: trimmed to body + 2px", size == (55, 55), f"size={size}")

# fix 2: --no-despill keeps semi-green edge pixels untouched
edge = Image.new("RGBA", (40, 40), (0, 255, 0, 255))
ImageDraw.Draw(edge).rectangle([10, 10, 29, 29], fill=(120, 170, 100, 255))  # greenish but below key
edge.save(t("edge.png"))
run(CUT, t("edge.png"), t("edge_ds.png"), "--no-crop")
run(CUT, t("edge.png"), t("edge_nods.png"), "--no-crop", "--no-despill")
a = probe("edge_ds.png", [(20, 20)])[0]
b = probe("edge_nods.png", [(20, 20)])[0]
check("despill on by default (semi-green softened)", a != (120, 170, 100, 255), f"{a}")
check("--no-despill leaves pixel untouched", b == (120, 170, 100, 255), f"{b}")

# fixture 2: icon damaged by an old cutout — teal transparent, colour preserved
img = Image.new("RGBA", (100, 100), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rectangle([25, 25, 75, 75], fill=(90, 30, 30, 255))
d.ellipse([40, 40, 60, 60], fill=(40, 200, 170, 255))
px = img.load()
for y in range(40, 61):
    for x in range(40, 61):
        r_, g_, b_, a_ = px[x, y]
        if a_:
            px[x, y] = (r_, g_, b_, 0)
for y in range(78, 86):
    for x in range(78, 86):
        px[x, y] = (0, 255, 0, 0)
img.save(t("damaged.png"))
r = run(CUT, "--heal", t("damaged.png"), t("healed.png"))
h = probe("healed.png", [(50, 50), (30, 30), (80, 80), (5, 5)])
check("heal: eaten teal is opaque again", h[0][3] == 255 and h[0][1] == 200, f"{h[0]}")
check("heal: body kept", h[1][3] == 255, f"{h[1]}")
check("heal: legal green window untouched", h[2][3] == 0, f"{h[2]}")
check("heal: outside untouched", h[3][3] == 0, f"{h[3]}")
check("heal: prints statistics", "восстановлено пикселей" in r.stdout, r.stdout.strip()[:120])

shutil.rmtree(TMP, ignore_errors=True)
print("\nmedia tools: all green" if failures == 0 else f"\n{failures} checks failed")
sys.exit(1 if failures else 0)
