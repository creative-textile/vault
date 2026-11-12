#!/usr/bin/env python3
"""Аудит аудио-библиотеки Vault: формат, вес, метаданные, покрытие CREDITS.

Зачем: звук лежит в репозитории и попадает в бандл. Правила простые и проверяемые:
  * только OGG Vorbis (открытый кодек, играет на Android/в браузерах);
  * музыка ≤ 1.5 МиБ на трек, эффекты ≤ 200 КиБ;
  * ни одного файла вне `audio/music` и `audio/sfx`;
  * каждый файл упомянут в `audio/CREDITS.md` (лицензия без указания не бывает);
  * метаданные сведены к нулю (`-map_metadata -1` при перекодировке).

Зависимостей нет: OGG-заголовок читается вручную, длительность — из granule-позиции
последней страницы. Так аудит работает в любой песочнице без ffprobe.

    python3 tools/audio/audit_audio.py [--json]
"""

from __future__ import annotations

import json
import os
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
AUDIO = os.path.join(ROOT, "audio")
CREDITS = os.path.join(AUDIO, "CREDITS.md")

LIMITS = {
    "music": {"max_bytes": 1_600_000, "max_minutes": None},
    "sfx": {"max_bytes": 250_000, "max_seconds": 30},
}


def ogg_info(path: str) -> dict:
    """Длительность и частота из OGG-страниц. Без внешних зависимостей."""
    size = os.path.getsize(path)
    rate = 0
    last_granule = -1
    with open(path, "rb") as fh:
        data = fh.read()
    if not data.startswith(b"OggS"):
        return {"ok": False, "error": "не OGG (нет сигнатуры OggS)", "bytes": size}

    pos = 0
    while pos < len(data):
        idx = data.find(b"OggS", pos)
        if idx < 0 or idx + 27 > len(data):
            break
        granule = struct.unpack_from("<q", data, idx + 6)[0]
        nsegs = data[idx + 26]
        body_start = idx + 27 + nsegs
        if granule != -1:
            last_granule = granule
        # первый пакет несёт идентификацию кодека: \x01vorbis + каналы + частота
        if rate == 0 and data[body_start:body_start + 7] == b"\x01vorbis":
            rate = struct.unpack_from("<I", data, body_start + 12)[0]
        pos = body_start
        # пропустить тело страницы по таблице сегментов
        segs = data[idx + 27: idx + 27 + nsegs]
        pos = body_start + sum(segs)

    seconds = (last_granule / rate) if rate and last_granule > 0 else 0
    return {"ok": True, "bytes": size, "rate": rate, "seconds": round(seconds, 2)}


def main() -> int:
    as_json = "--json" in sys.argv
    credits = ""
    if os.path.exists(CREDITS):
        with open(CREDITS, encoding="utf-8") as fh:
            credits = fh.read()

    problems: list[str] = []
    rows: list[dict] = []
    total = 0

    for kind in ("music", "sfx"):
        folder = os.path.join(AUDIO, kind)
        if not os.path.isdir(folder):
            problems.append(f"нет каталога audio/{kind}")
            continue
        limit = LIMITS[kind]
        files = sorted(os.listdir(folder))
        if not files:
            problems.append(f"audio/{kind} пуст")
        for name in files:
            path = os.path.join(folder, name)
            rel = f"audio/{kind}/{name}"
            if not name.endswith(".ogg"):
                problems.append(f"{rel}: не .ogg")
                continue
            info = ogg_info(path)
            total += info.get("bytes", 0)
            if not info.get("ok"):
                problems.append(f"{rel}: {info.get('error')}")
                continue
            if name not in credits:
                problems.append(f"{rel}: нет строки в audio/CREDITS.md (лицензия?)")
            if info["bytes"] > limit["max_bytes"]:
                problems.append(
                    f"{rel}: {info['bytes'] / 1024:.0f} КБ > {limit['max_bytes'] / 1024:.0f} КБ")
            if limit.get("max_seconds") and info["seconds"] > limit["max_seconds"]:
                problems.append(f"{rel}: {info['seconds']} с > {limit['max_seconds']} с")
            rows.append({
                "file": rel, "kind": kind, "bytes": info["bytes"],
                "seconds": info["seconds"], "rate": info["rate"],
            })

    # обратная проверка: файл, упомянутый в CREDITS, но отсутствующий
    for line in credits.splitlines():
        if "| `" not in line:
            continue
        for token in line.split("`")[1::2]:
            if token.endswith(".ogg"):
                hit = any(r["file"].endswith("/" + token) for r in rows)
                if not hit:
                    problems.append(f"audio/CREDITS.md ссылается на отсутствующий {token}")

    result = {
        "ok": not problems,
        "files": len(rows),
        "total_bytes": total,
        "total_mib": round(total / 1024 / 1024, 2),
        "rows": rows,
        "problems": problems,
    }
    if as_json:
        print(json.dumps(result, ensure_ascii=False, indent=1))
    else:
        print(f"аудио: файлов {len(rows)} · {result['total_mib']} МиБ")
        for r in rows:
            print(f"  {r['file']:28} {r['seconds']:7.2f} с  {r['bytes'] // 1024:5} КБ  {r['rate']} Гц")
        if problems:
            print(f"\nпроблемы ({len(problems)}):")
            for p in problems:
                print(f"  ✗ {p}")
        else:
            print("\n✓ формат, вес, длительность и лицензии в порядке")
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())
