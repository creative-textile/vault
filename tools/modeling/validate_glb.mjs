#!/usr/bin/env node
/**
 * ✅ ПРОВЕРКА GLB — модель реально разбирается GLTFLoader'ом three.js.
 *
 * Зачем отдельно от audit_glb.py: аудит читает JSON-структуру и говорит
 * «вес/треугольники в бюджете», но НЕ говорит, загрузится ли модель в браузере.
 * Уже поймано: ужатая в WebP модель проходила аудит, а GLTFLoader падал с
 * «WebP required by asset but unsupported» — то есть у игрока был бы
 * процедурный fallback вместо красивого сейфа.
 *
 * Коды: 0 — модель разбирается; 1 — не разбирается; 2 — файл не открыть.
 */
import fs from 'node:fs';

// В Node нет DOM: подкладываем минимум, чтобы GLTFLoader дошёл до разбора
// структуры. Текстуры не декодируются — проверяем геометрию и клипы.
globalThis.self = globalThis;
class FakeImage { set src(v) { setTimeout(() => this.onload?.(), 0); } }
globalThis.Image = FakeImage;
globalThis.URL.createObjectURL = () => 'blob:validate';
// Заглушка не декодирует картинки — three.js ругается на каждую текстуру.
// Это шум самой заглушки, а не дефект модели: гасим его.
const realWarn = console.warn;
console.warn = (...a) => {
  if (String(a[0]).includes("Couldn't load texture")) return;
  realWarn(...a);
};

// three лежит во frontend/node_modules — импортируем по абсолютному пути,
// чтобы валидатор работал из любой папки (в т.ч. из CI и из песочницы агента).
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const threePath = path.resolve('frontend/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
let GLTFLoader;
try {
  ({ GLTFLoader } = await import(pathToFileURL(threePath).href));
} catch {
  console.error('нет three: выполните npm install в frontend/');
  process.exit(2);
}

const file = process.argv[2];
if (!file) { console.error('укажите .glb'); process.exit(2); }

let buf;
try { buf = fs.readFileSync(file); } catch (e) { console.error('не открыть:', e.message); process.exit(2); }

const warnings = [];
const loader = new GLTFLoader();
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

loader.parse(ab, '', (gltf) => {
  let meshes = 0, tris = 0;
  gltf.scene.traverse((o) => {
    if (o.isMesh) {
      meshes++;
      const g = o.geometry;
      tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
  });
  console.log(`OK ${file}: мешей ${meshes}, треугольников ${Math.round(tris)}, клипы [${gltf.animations.map((a) => a.name).join(', ')}]`);
  if (warnings.length) { console.log('предупреждения:'); warnings.forEach((w) => console.log('  -', w)); }
  process.exit(0);
}, (e) => {
  console.error(`ОШИБКА ${file}: ${e?.message || e}`);
  process.exit(1);
});
