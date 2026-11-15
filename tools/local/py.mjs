#!/usr/bin/env node
/**
 * Системный Python для скриптов, которым НЕ нужен bpy (текстуры, медиа, аудит).
 * Кросс-платформенно: Windows — `py -3`, Linux/macOS — `python3`.
 *
 *   npm run py:check
 *   node tools/local/py.mjs --script frontend/models-src/coin/gen_coin_textures.py
 *   node tools/local/py.mjs --script tools/media/cutout-chromakey.py -- in.png out.png
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../..');

export function pythonArgv(env = {}) {
  const exe = process.env.VAULT_PYTHON || env.VAULT_PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
  return { exe, prefix: exe === 'py' ? ['-3'] : [] };
}
export function loadEnv(root = ROOT) {
  const out = {};
  const p = resolve(root, '.env');
  if (!existsSync(p)) return out;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

export function main(argv = process.argv.slice(2)) {
  const env = loadEnv();
  const { exe, prefix } = pythonArgv(env);
  if (argv.includes('--check')) {
    const p = spawnSync(exe, [...prefix, '-c', 'import PIL, numpy; print("Pillow+numpy OK")'], { encoding: 'utf8', shell: false });
    const out = `${p.stdout || ''}${p.stderr || ''}`.trim();
    console.log(out || 'нет вывода');
    if ((p.status ?? 1) !== 0) { console.error('[py] установите: py -m pip install pillow numpy  (Linux: python3 -m pip ...)'); return 1; }
    return 0;
  }
  const i = argv.indexOf('--script');
  if (i < 0 || !argv[i + 1]) { console.error('нужно --script <путь> [-- <аргументы>]'); return 1; }
  const script = resolve(ROOT, argv[i + 1]);
  if (!existsSync(script)) { console.error(`[py] нет скрипта ${script}`); return 1; }
  const rest = argv.includes('--') ? argv.slice(argv.indexOf('--') + 1) : [];
  const p = spawnSync(exe, [...prefix, script, ...rest], { cwd: ROOT, encoding: 'utf8', shell: false, timeout: 900000, maxBuffer: 32 * 1024 * 1024 });
  process.stdout.write(p.stdout || '');
  process.stderr.write(p.stderr || '');
  return p.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
