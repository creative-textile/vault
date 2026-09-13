/**
 * Линт кастомных GLSL-шейдеров.
 *
 * Зачем: ошибка компиляции шейдера НЕ видна ни в tsc, ни в сборке — она
 * происходит в рантайме на GPU. В наших сценах она означала бы, что
 * `createStageSafe` вернул null и игрок не увидел 3D ВООБЩЕ: вся визуальная
 * переделка молча не произошла, а в консоли только лог драйвера.
 *
 * Проверяем то, что ломается чаще всего и что видно статически:
 *  1. varying объявлен во фрагментном шейдере, но не в вершинном → compile error;
 *  2. varying объявлен в вершинном, но не во фрагментном → compile error
 *     (несовпадение наборов недопустимо в GLSL ES);
 *  3. uniform используется в шейдере, но не передан в `uniforms: {...}` → чёрный
 *     кадр без ошибки (самый обидный случай);
 *  4. attribute используется в вершинном шейдере, но не добавлен в геометрию →
 *     compile error или мусор в данных;
 *  5. в вершинном шейдере для THREE.Points не задан gl_PointSize → точки в 1 px.
 *
 * Запуск: npm run test:shaders
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'src/three');

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { passed++; return; }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

/** Все ShaderMaterial-блоки: пары вершинного/фрагментного шейдеров + uniforms. */
function extractShaders(file) {
  const src = readFileSync(file, 'utf8');
  const found = [];
  const re = /new THREE\.ShaderMaterial\(\{/g;
  let m;
  while ((m = re.exec(src))) {
    // Берём окно до закрывающей скобки конструктора — грубо, но достаточно:
    // в наших файлах один ShaderMaterial не вкладывается в другой
    const chunk = src.slice(m.index, m.index + 4000);
    const grab = (key) => {
      const r = new RegExp(`${key}:\\s*(?:/\\* glsl \\*/)?\`([\\s\\S]*?)\``).exec(chunk);
      return r ? r[1] : null;
    };
    const vert = grab('vertexShader');
    const frag = grab('fragmentShader');
    if (!vert && !frag) continue;
    const uniformsBlock = /uniforms:\s*\{([\s\S]*?)\}\s*,\s*vertexShader/.exec(chunk);
    const uniformsSrc = uniformsBlock ? uniformsBlock[1] : '';
    // Геометрия рядом: ищем setAttribute('name'...) во всём файле
    found.push({ file, vert, frag, uniformsSrc, src, offset: m.index });
  }
  return found;
}

const declRe = (kind) => new RegExp(`${kind}\\s+(?:lowp |mediump |highp )?(\\w+)\\s+(\\w+)`, 'g');
const usedRe = (name) => new RegExp(`\\b${name}\\b`, 'g');

function decls(glsl, kind) {
  const out = new Map();
  let m;
  const re = declRe(kind);
  while ((m = re.exec(glsl))) out.set(m[2], m[1]);
  return out;
}

/** Имена, которые three.js подставляет сам (их объявлять нельзя и не нужно). */
const BUILTIN = new Set([
  'position', 'normal', 'uv', 'uv1', 'uv2', 'color', 'modelMatrix', 'modelViewMatrix',
  'projectionMatrix', 'viewMatrix', 'normalMatrix', 'cameraPosition', 'isOrthographic',
  'gl_Position', 'gl_PointSize', 'gl_FragColor', 'gl_PointCoord', 'gl_FragCoord'
]);

const files = walk(SRC);
let shaderCount = 0;

for (const file of files) {
  const rel = file.replace(ROOT, '');
  for (const sh of extractShaders(file)) {
    shaderCount++;
    const tag = `${rel}@${sh.src.slice(0, sh.offset).split('\n').length}`;

    if (sh.vert && sh.frag) {
      const vVar = decls(sh.vert, 'varying');
      const fVar = decls(sh.frag, 'varying');

      for (const [name, type] of fVar) {
        check(`${tag}: varying ${name} объявлен в вершинном шейдере`, vVar.has(name));
        if (vVar.has(name)) {
          check(`${tag}: varying ${name} одного типа в обоих шейдерах`,
            vVar.get(name) === type, `${vVar.get(name)} vs ${type}`);
        }
      }
      for (const name of vVar.keys()) {
        check(`${tag}: varying ${name} объявлен и во фрагментном шейдере`, fVar.has(name));
      }
    }

    // Uniform'ы: используются в шейдере → должны быть в uniforms: {...}
    for (const [glsl, which] of [[sh.vert, 'vertex'], [sh.frag, 'fragment']]) {
      if (!glsl) continue;
      for (const [name] of decls(glsl, 'uniform')) {
        const used = new RegExp(`\\b${name}\\b`).test(glsl.replace(
          new RegExp(`uniform\\s+\\w+\\s+${name}\\s*;`), ''));
        if (!used) continue;
        check(`${tag}: uniform ${name} (${which}) передан в uniforms`,
          new RegExp(`\\b${name}\\s*:`).test(sh.uniformsSrc),
          `в uniforms: { ${sh.uniformsSrc.replace(/\s+/g, ' ').trim().slice(0, 90)} }`);
      }
      // Атрибуты: объявлены в шейдере → должны быть в геометрии файла
      if (which === 'vertex') {
        for (const [name] of decls(glsl, 'attribute')) {
          check(`${tag}: attribute ${name} добавлен в геометрию`,
            new RegExp(`setAttribute\\(\\s*['"]${name}['"]`).test(sh.src));
          check(`${tag}: attribute ${name} не конфликтует с built-in`, !BUILTIN.has(name));
        }
      }
    }

    // Точки обязаны задавать размер, иначе частицы превратятся в 1 px
    if (sh.vert && /gl_PointCoord/.test(sh.frag || '') || /new THREE\.Points\(/.test(sh.src)) {
      if (sh.vert && usedRe('gl_PointCoord').test(sh.frag || '')) {
        check(`${tag}: gl_PointSize задан для Points`, /gl_PointSize\s*=/.test(sh.vert));
      }
    }
  }
}

check('в сценах вообще есть кастомные шейдеры (иначе линт ослеп)', shaderCount >= 3,
  `найдено ${shaderCount}`);

if (failures.length) {
  console.error(`\n❌ shader-lint: ${failures.length} из ${passed + failures.length} проверок провалено`);
  for (const f of failures.slice(0, 40)) console.error(`   • ${f}`);
  process.exit(1);
}
console.log(`✅ shader-lint: ${passed} проверок в ${shaderCount} шейдерах (varying/uniform/attribute/gl_PointSize)`);
