// Валидация GLB без DOM: GLTFLoader требует Image/document — подкладываем заглушки.
// Нужна только проверка СТРУКТУРЫ (меши, клипы), текстуры не декодируем.
globalThis.self = globalThis;
class FakeImage { set src(v) { setTimeout(()=>this.onload?.(),0); } }
globalThis.Image = FakeImage;
globalThis.URL.createObjectURL = () => 'blob:fake';

import fs from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const buf = fs.readFileSync(process.argv[2]);
const loader = new GLTFLoader();
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
loader.parse(ab, '', (gltf) => {
  let meshes = 0, tris = 0;
  gltf.scene.traverse(o => {
    if (o.isMesh) { meshes++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; }
  });
  console.log(`OK: meshes ${meshes}, triangles ${Math.round(tris)}, clips [${gltf.animations.map(a=>a.name).join(',')}]`);
  process.exit(0);
}, (e) => { console.log('ОШИБКА:', e?.message || e); process.exit(1); });
