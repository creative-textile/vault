#!/usr/bin/env python3
"""
cutout-chromakey.py

Источник: Creative36711/synapse, tools/media/cutout-chromakey.py → narthex c842670.
Перенесено в Vault без изменений логики. Отличия копии synapse:
  * --mode flood в Pillow-ветке реально вырезает внешний фон (в оригинале не делал ничего);
  * добавлен --no-despill (в оригинале despill нельзя было выключить).

Утилита удаления хромакея (ярко-зелёного фона #00FF00) для спрайтов, эмблем и боевых фигурок,
плюс «лечилка» иконок, уже изуродованных старыми вырезками.

ВАЖНО ПРО БИРЮЗУ (урок реальной кампании): старые версии принимали бирюзовые детали
(вены, звуковые кольца, патину) за зелёный фон и делали их прозрачными. Теперь ключ строгий:
пиксель считается фоном, только если КАНАЛ ЯРЧАЙШЕ ЗЕЛЁНЫЙ (green > 140), зелёный доминирует
над остальными перекрытием больше порога, И это не циан/бирюза (blue < 75% от green).
Пиксели с синей составляющей, близкой к зелёной, — не фон и не вырезаются ни в одном режиме
(отключается флагом --allow-cyan для съёмки на бирюзовом фоне).

Использование:
  python3 cutout-chromakey.py input.png output.png [опции]
  python3 cutout-chromakey.py --heal сломанная.png починенная.png

Опции:
  --mode {auto, color, flood, points}
      auto    - (по умолчанию) строгий ключ с краёв + зачистка внутренних замкнутых зелёных
                полостей (отверстия шестерёнок/ручек, буквы A/O/P/D/B) + despill ореола.
      color   - глобальный ключ по всей картинке (тем же СТРОГИМ зелёным предикатом; для
                логотипов без зелёных деталей; бирюзу всё равно не съедает).
      flood   - только внешний контур заливкой от краёв кадра.
      points  - зачистка полостей по координатам X,Y (через запятую или пробел).
  --tol <int>
      Минимальное доминирование зелёного канала (по умолчанию 70 — строго; для тусклого
      хромакея снижайте до 40-50, защита бирюзы всё равно держится).
  --allow-cyan
      Разрешить вырезать бирюзу/циан — только если фон снят именно в бирюзе.
  --despill
      Подавление паразитного зелёного ореола на кромках (по умолчанию включено в auto/color).
  --points "X1,Y1 X2,Y2 ..."
      Координаты внутренних полостей для точечного удаления.
  --heal
      Режим лечилки: НИЧЕГО не вырезает. Пиксели внутри фигуры (не связанные с внешним фоном),
      ставшие прозрачными, но чей сохранившийся цвет — не чистый ключевой зелёный, снова
      становятся непрозрачными. Цвет под прозрачностью вырезки сохраняется, поэтому
      восстановление точное. Чисто зелёные внутренние полости (окна/отверстия) не трогаются.
  --crop / --no-crop
      Обрезка пустых прозрачных краёв (в heal-режиме отключена: геометрия не меняется).
  --max-size <int>
      Максимальная длина большей стороны (например, 256 для фигурок боя, 512 для спрайтов).
"""

import sys
import os
import argparse
import subprocess


def green_key(r, g, b, tol, allow_cyan=False):
    """Строгий зелёный ключ: бирюза/циан не пройдёт (b близко к g)."""
    if g <= 140:
        return False
    if (g - max(r, b)) <= tol:
        return False
    if not allow_cyan and b >= g * 0.75:
        return False
    return True


def semi_green(r, g, b, tol, allow_cyan=False):
    """Полупрозрачный зелёный ореол с кромки — мягче, но всё ещё не бирюза."""
    if g <= 100:
        return False
    if (g - max(r, b)) <= max(12, tol // 4):
        return False
    if not allow_cyan and b >= g * 0.75:
        return False
    return True


def run_imagemagick(input_path, output_path, mode, tol, points_list, crop=True, max_size=None):
    """Fallback через ImageMagick convert, если PIL/Pillow не установлен (без --heal)."""
    fuzz = f"{int(min(tol, 40) * 100 / 255)}%"
    cmd = ["convert", input_path, "-fuzz", fuzz]
    if mode == "color" or mode == "auto":
        cmd += ["-transparent", "#00FF00"]
    elif mode == "flood":
        cmd += ["-fill", "none", "-draw", "matte 0,0 floodfill"]
    elif mode == "points" and points_list:
        cmd += ["-fill", "none"]
        for x, y in points_list:
            cmd += ["-draw", f"matte {x},{y} floodfill"]

    if crop:
        cmd += ["-trim", "+repage"]
    if max_size and max_size > 0:
        cmd += ["-resize", f"{max_size}x{max_size}>"]

    cmd.append(output_path)
    return subprocess.run(cmd, check=True)


def process_with_pillow(input_path, output_path, mode="auto", tol=70, despill=True,
                        points_list=None, crop=True, max_size=None, allow_cyan=False):
    from PIL import Image
    from collections import deque

    img = Image.open(input_path).convert("RGBA")
    w, h = img.size
    px = img.load()

    def key(r, g, b):
        return green_key(r, g, b, tol, allow_cyan)

    def semi(r, g, b):
        return semi_green(r, g, b, tol, allow_cyan)

    if mode == "color":
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                if a == 0:
                    continue
                diff = g - max(r, b)
                if key(r, g, b):
                    px[x, y] = (r, min(g, max(r, b)), b, 0)
                elif despill and semi(r, g, b):
                    k = min(1.0, (diff - 15) / max(1, tol - 15))
                    new_a = int(a * max(0.0, 1.0 - k))
                    new_g = min(g, max(r, b) + 4)
                    px[x, y] = (r, new_g, b, new_a)

    elif mode in ("auto", "flood"):
        visited = set()
        queue = deque()

        for x in range(w):
            for y in (0, h - 1):
                r, g, b, a = px[x, y]
                if key(r, g, b) or a == 0:
                    queue.append((x, y))
                    visited.add((x, y))
        for y in range(h):
            for x in (0, w - 1):
                if (x, y) not in visited:
                    r, g, b, a = px[x, y]
                    if key(r, g, b) or a == 0:
                        queue.append((x, y))
                        visited.add((x, y))

        while queue:
            cx, cy = queue.popleft()
            r, g, b, a = px[cx, cy]
            px[cx, cy] = (r, min(g, max(r, b)), b, 0)

            for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                nx, ny = cx + dx, cy + dy
                if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in visited:
                    nr, ng, nb, na = px[nx, ny]
                    if key(nr, ng, nb):
                        visited.add((nx, ny))
                        queue.append((nx, ny))

        # внутренние замкнутые полости чистого ключа (острова, не связанные с краем);
        # в режиме flood полости не трогаются — только внешний контур
        for y in range(h if mode == "auto" else 0):
            for x in range(w):
                if (x, y) not in visited:
                    r, g, b, a = px[x, y]
                    if a > 0 and key(r, g, b):
                        island_q = deque([(x, y)])
                        visited.add((x, y))
                        while island_q:
                            ix, iy = island_q.popleft()
                            ir, ig, ib, ia = px[ix, iy]
                            px[ix, iy] = (ir, min(ig, max(ir, ib)), ib, 0)
                            for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                                nx, ny = ix + dx, iy + dy
                                if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in visited:
                                    nr, ng, nb, na = px[nx, ny]
                                    if key(nr, ng, nb):
                                        visited.add((nx, ny))
                                        island_q.append((nx, ny))

        if despill:
            for y in range(h):
                for x in range(w):
                    r, g, b, a = px[x, y]
                    if a > 0 and semi(r, g, b) and not key(r, g, b):  # flood: полости не трогаем
                        diff = g - max(r, b)
                        k = min(1.0, (diff - 12) / max(1, tol - 12))
                        new_a = int(a * max(0.0, 1.0 - k * 0.7))
                        new_g = min(g, max(r, b) + 3)
                        px[x, y] = (r, new_g, b, new_a)

    elif mode == "points" and points_list:
        visited = set()
        queue = deque(points_list)
        for pt in points_list:
            visited.add(pt)

        while queue:
            cx, cy = queue.popleft()
            r, g, b, a = px[cx, cy]
            px[cx, cy] = (r, min(g, max(r, b)), b, 0)
            for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                nx, ny = cx + dx, cy + dy
                if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in visited:
                    nr, ng, nb, na = px[nx, ny]
                    if key(nr, ng, nb):
                        visited.add((nx, ny))
                        queue.append((nx, ny))

    if crop:
        bbox = img.getbbox()
        if bbox:
            pad = 2
            box = (max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(w, bbox[2] + pad), min(h, bbox[3] + pad))
            img = img.crop(box)

    if max_size and max_size > 0:
        resample_filter = getattr(Image, 'Resampling', Image).LANCZOS
        img.thumbnail((max_size, max_size), resample_filter)

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    img.save(output_path, "PNG", optimize=True)


def heal_with_pillow(input_path, output_path, tol=70, allow_cyan=False):
    """Лечит прозрачные «дыры» внутри фигуры: alpha 0/низкая, не связана с внешним фоном,
    цвет не чистый ключевой зелёный → alpha = 255. Чисто зелёные внутренние полости
    (легальные окна/отверстия) остаются прозрачными."""
    from PIL import Image
    from collections import deque

    img = Image.open(input_path).convert("RGBA")
    w, h = img.size
    px = img.load()

    # внешний фон = прозрачная область, связанная с краем кадра
    outside = set()
    queue = deque()
    for x in range(w):
        for y in (0, h - 1):
            if px[x, y][3] < 20:
                outside.add((x, y))
                queue.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if (x, y) not in outside and px[x, y][3] < 20:
                outside.add((x, y))
                queue.append((x, y))
    while queue:
        cx, cy = queue.popleft()
        for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            nx, ny = cx + dx, cy + dy
            if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in outside and px[nx, ny][3] < 20:
                outside.add((nx, ny))
                queue.append((nx, ny))

    tapered = set()

    def near_outside(x, y):
        # кольцо в 2 пикселя вокруг внешнего фона не лечим: там антиалиас кромки
        for dx in (-2, -1, 0, 1, 2):
            for dy in (-2, -1, 0, 1, 2):
                if (x + dx, y + dy) in outside:
                    return True
        return False

    fixed = 0
    left_key = 0
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a >= 250 or (x, y) in outside or near_outside(x, y):
                continue
            if green_key(r, g, b, tol, allow_cyan):
                left_key += 1  # внутренняя чисто зелёная полость — легальное отверстие
                continue
            px[x, y] = (r, g, b, 255)
            fixed += 1

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    img.save(output_path, "PNG", optimize=True)
    print(f"✓ heal: {output_path} — восстановлено пикселей: {fixed}; "
          f"внутренних чисто зелёных полостей оставлено: {left_key}")


def main():
    parser = argparse.ArgumentParser(description="Вырезка хромакея (#00FF00) строгим ключом + лечилка дыр")
    parser.add_argument("input", help="Путь к исходному файлу (.png/.jpg)")
    parser.add_argument("output", help="Путь к результирующему PNG")
    parser.add_argument("--mode", choices=["auto", "color", "flood", "points"], default="auto",
                        help="Режим вырезки (по умолчанию auto)")
    parser.add_argument("--tol", type=int, default=70,
                        help="Порог доминирования зелёного (по умолчанию 70 — строго; тусклый фон: 40-50)")
    parser.add_argument("--allow-cyan", action="store_true", default=False,
                        help="Разрешить вырезать бирюзу/циан (только для фона в бирюзе)")
    parser.add_argument("--despill", dest="despill", action="store_true", default=True,
                        help="Подавление зелёного ореола (по умолчанию включено)")
    parser.add_argument("--no-despill", dest="despill", action="store_false",
                        help="Не трогать полупрозрачную зелёную кромку")
    parser.add_argument("--points", type=str, default="", help="Координаты полостей 'X1,Y1 X2,Y2'")
    parser.add_argument("--heal", action="store_true", default=False,
                        help="Лечилка: вернуть непрозрачность пикселям внутри фигуры (ничего не вырезает)")
    parser.add_argument("--crop", dest="crop", action="store_true", default=True,
                        help="Обрезать пустые поля (по умолчанию включено; в heal всегда выключено)")
    parser.add_argument("--no-crop", dest="crop", action="store_false")
    parser.add_argument("--max-size", type=int, default=None, help="Максимальный размер стороны (downscale)")

    args = parser.parse_args()

    pts = []
    if args.points:
        raw_pts = args.points.replace(";", " ").replace(",", " ").split()
        for i in range(0, len(raw_pts), 2):
            if i + 1 < len(raw_pts):
                pts.append((int(raw_pts[i]), int(raw_pts[i + 1])))

    try:
        import PIL  # noqa: F401
        if args.heal:
            heal_with_pillow(args.input, args.output, tol=args.tol, allow_cyan=args.allow_cyan)
        else:
            process_with_pillow(args.input, args.output, mode=args.mode, tol=args.tol,
                                despill=args.despill, points_list=pts, crop=args.crop,
                                max_size=args.max_size, allow_cyan=args.allow_cyan)
            print(f"✓ Успешно обработано через Pillow: {args.output} (режим {args.mode}, crop={args.crop})")
    except ImportError:
        if args.heal:
            print("✗ --heal требует Pillow (ImageMagick-fallback лечилки не умеет).", file=sys.stderr)
            sys.exit(2)
        print("Pillow не найден, используется ImageMagick fallback...")
        run_imagemagick(args.input, args.output, mode=args.mode, tol=args.tol,
                        points_list=pts, crop=args.crop, max_size=args.max_size)
        print(f"✓ Успешно обработано через ImageMagick: {args.output} (режим {args.mode}, crop={args.crop})")


if __name__ == "__main__":
    main()
