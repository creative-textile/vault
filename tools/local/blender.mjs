#!/usr/bin/env node
/**
 * Нативный Blender вместо pip-модуля bpy и X11-стабов песочницы.
 *
 *   npm run blender:check                       # версия + смоук (GLB + CPU-рендер)
 *   node tools/local/blender.mjs --script frontend/models-src/coin/build_coin.py
 *   node tools/local/blender.mjs --script <путь> -- out.glb
 *
 * Версия сверяется с tools/modeling/blender-version.json. На машине с 6 ГБ RAM
 * и HD 620/940MX принудительно --gpu-backend opengl, потоков 2, рендер CPU.
 * Код возврата Python-скрипта пробрасывается (--python-exit-code 1).
 */
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../..');

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
export const blenderExe = (env = loadEnv()) => process.env.BLENDER_EXE || env.BLENDER_EXE || 'blender';

export function parseVersion(text) {
  const m = String(text).match(/Blender\s+(\d+\.\d+(?:\.\d+)?)/i);
  return m ? m[1] : null;
}

export function versionDecision(found, pinned, fallbackLts, allowLts) {
  const major = (v) => v.split('.').slice(0, 2).join('.');
  if (!found) return { ok: false, reason: 'версию прочитать не удалось (blender --version)' };
  if (major(found) === major(pinned)) return { ok: true, reason: `совпадает с закреплённой ${pinned}` };
  if (allowLts && major(found) === major(fallbackLts)) return { ok: true, reason: `разрешён запасной LTS ${fallbackLts}` };
  return { ok: false, reason: `нужна ${pinned} (или --allow-lts для ${fallbackLts}), найдена ${found}` };
}

export function main(argv = process.argv.slice(2)) {
  const cfg = JSON.parse(readFileSync(resolve(ROOT, 'tools/modeling/blender-version.json'), 'utf8'));
  const env = loadEnv();
  const exe = blenderExe(env);
  const v = spawnSync(exe, ['--version'], { encoding: 'utf8', shell: false, timeout: 60000 });
  const found = parseVersion(`${v.stdout || ''}${v.stderr || ''}`);
  const decision = versionDecision(found, cfg.pinned, cfg.fallbackLts, argv.includes('--allow-lts'));
  console.log(`[blender] ${exe} → ${found || '?'}; ${decision.reason}`);
  if (!decision.ok) return 1;

  const script = argv.includes('--script') ? argv[argv.indexOf('--script') + 1] : null;
  const rest = argv.includes('--') ? argv.slice(argv.indexOf('--') + 1) : [];
  const target = script || resolve(ROOT, 'tools/modeling/smoke.py');
  if (!existsSync(resolve(ROOT, target))) { console.error(`[blender] нет скрипта ${target}`); return 1; }

  const args = [...cfg.args, '--python', resolve(ROOT, target)];
  if (rest.length) args.push('--', ...rest);
  const p = spawnSync(exe, args, {
    cwd: ROOT, encoding: 'utf8', shell: false, timeout: 900000, maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, VAULT_SMOKE_DIR: resolve(ROOT, '.state/blender') },
  });
  const out = `${p.stdout || ''}${p.stderr || ''}`;
  const facts = out.match(/VAULT_SMOKE\s+(\{.*\})/);
  if (facts) console.log(`[blender] смоук: ${facts[1]}`);
  if ((p.status ?? 1) !== 0) {
    console.error(out.slice(-2500));
    console.error(`[blender] rc=${p.status ?? 1}`);
    return 1;
  }
  console.log(`[blender] готово: ${target} (rc=0)`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
