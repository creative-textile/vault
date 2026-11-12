#!/usr/bin/env node
/**
 * 🗜 УЖИМАЛКА GLB — приводит модель в бюджет Vault, не ломая её.
 *
 * Зачем: процедурные модели из Blender выходят с «честными» текстурами
 * 1024×1024 PNG. Игроку это стоит мегабайт трафика и 18 МБ VRAM на телефоне —
 * при том что на экране сейф размером с палец.
 *
 * Что делает (всё обратимо на уровне исходника — файл пишется рядом):
 *   1. dedup   — одинаковые материалы и текстуры в один экземпляр;
 *   2. prune   — выбрасывает неиспользуемые узлы и пустые группы;
 *   3. weld    — сваривает совпадающие вершины (минус ~2% треугольников);
 *   4. resample— прореживает лишние ключи анимации;
 *   5. textureCompress — уменьшает сторону текстуры и переводит в JPEG.
 *
 * ПОЧЕМУ JPEG, А НЕ WebP: three.js подключает EXT_texture_webp только если
 * браузер умеет WebP, и GLTFLoader падает с «WebP required by asset but
 * unsupported» там, где его нет. JPEG читается везде. Проверено разбором
 * модели через GLTFLoader (см. tools/modeling/validate_glb.mjs).
 *
 * Использование:
 *   node tools/modeling/shrink_glb.mjs frontend/public/models/safe.glb
 *   node tools/modeling/shrink_glb.mjs <файл> --out /tmp/safe.glb --size 512 --quality 88
 *   node tools/modeling/shrink_glb.mjs <файл> --in-place     # заменить оригинал
 *
 * После ужима ОБЯЗАТЕЛЬНО:
 *   python3 tools/modeling/audit_glb.py <файл>          # бюджет
 *   node tools/modeling/validate_glb.mjs <файл>         # модель разбирается
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, resample, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import path from 'node:path';
import { statSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const src = args.find((a) => !a.startsWith('--') && /\.glb$/i.test(a));
if (!src) {
  console.error('укажите .glb: node tools/modeling/shrink_glb.mjs <файл> [--size 512] [--quality 88] [--in-place]');
  process.exit(2);
}
const SIZE = Number(flag('size', 512));
const QUALITY = Number(flag('quality', 88));
const inPlace = args.includes('--in-place');
const out = inPlace ? src : flag('out', src.replace(/\.glb$/i, '.shrunk.glb'));

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const before = statSync(src).size;

await doc.transform(
  dedup(),
  prune(),
  weld(),
  resample(),
  textureCompress({ encoder: sharp, targetFormat: 'jpeg', quality: QUALITY, resize: [SIZE, SIZE] })
);
await io.write(out, doc);

const after = statSync(out).size;
const pct = ((1 - after / before) * 100).toFixed(1);
console.log(`${path.basename(src)}: ${(before / 1024).toFixed(0)} КБ → ${(after / 1024).toFixed(0)} КБ (−${pct}%)`);
console.log(`записано: ${out}`);
console.log('проверьте: python3 tools/modeling/audit_glb.py ' + out);
console.log('           node tools/modeling/validate_glb.mjs ' + out);
