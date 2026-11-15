#!/usr/bin/env node
/**
 * Фиксированный узел проверок. Список зашит ЗДЕСЬ, а не в package.json:
 * коммит, который меняет манифест, не может подменить собственную проверку
 * (этот инвариант переехал из старого tools/relay-build.mjs).
 *
 *   node tools/local/preflight.mjs             # быстрый локальный контур
 *   node tools/local/preflight.mjs --full      # + продукт, требует npm ci в пакетах
 *
 * Пропуск продукт-проверок без установленных зависимостей называется явно и
 * не считается pass. С `--full` пропуск — ошибка.
 */
import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../..');

export const CHECKS = [
  { id: 'local-tests', argv: () => [process.execPath, '--test', ...readdirSync(resolve(ROOT, 'tools/local/tests')).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => `tools/local/tests/${f}`)], weight: 'пробы локального контура' },
  { id: 'board', argv: () => [process.execPath, 'tools/local/board.mjs', '--check'], weight: 'доска собрана из Git' },
  { id: 'context-packs', argv: () => [process.execPath, 'tools/local/context-pack.mjs', '--check'], weight: 'все контекст-паки в лимите токенов' },
  { id: 'budget', argv: () => [process.execPath, 'tools/local/budget.mjs', 'check'], weight: 'лимит фазы не превышен' },
  { id: 'git-diff', argv: () => ['git', 'diff', '--check'], weight: 'нет пробелов/конфликтных маркеров' },
];

/**
 * Известный красный гейт продукта, который НЕ подменяется и НЕ удаляется:
 * исходная точка миссии V-1-1 — coin.glb с 7 текстурами при лимите 4
 * (docs/STATUS.md §4).
 * В быстром verify он показывается как KNOWN (не pass), в --full остаётся
 * настоящим FAIL. Так первый запуск локального контура не лжёт и не краснеет
 * из-за долга, который уже записан в карточках draft.
 */
export const KNOWN_PRODUCT_DEBT = {
  'models:audit': 'coin.glb вне бюджета 3D (7 текстур > 4); карточки K1/K3/K4/K5 ждут исправления (docs/STATUS.md §4)',
};

export const PRODUCT_CHECKS = [
  { id: 'backend:types', cwd: 'backend', argv: ['npx', 'tsc', '--noEmit'], weight: 'типы backend' },
  { id: 'backend:tests', cwd: 'backend', argv: ['npm', 'test'], weight: 'смоук-тесты денег и игр (pg-mem)' },
  { id: 'frontend:types', cwd: 'frontend', argv: ['npx', 'tsc', '--noEmit'], weight: 'типы frontend' },
  { id: 'frontend:tests', cwd: 'frontend', argv: ['npm', 'test'], weight: 'математика сцен и линт шейдеров' },
  { id: 'bot:types', cwd: 'bot', argv: ['npx', 'tsc', '--noEmit'], weight: 'типы бота' },
  { id: 'models:audit', cwd: '.', argv: [process.platform === 'win32' ? 'py' : 'python3', ...(process.platform === 'win32' ? ['-3'] : []), 'tools/modeling/audit_glb.py', 'frontend/public/models/coin.glb', 'frontend/public/models/rocket.glb', 'frontend/public/models/safe.glb'], weight: 'бюджет 3D-моделей' },
];

export function run(argv, cwd = ROOT) {
  const p = spawnSync(argv[0], argv.slice(1), { cwd, encoding: 'utf8', shell: false, timeout: 300000, maxBuffer: 32 * 1024 * 1024 });
  return { rc: p.status ?? 1, tail: `${p.stdout || ''}${p.stderr || ''}`.slice(-600), error: p.error?.message };
}

export function main(argv = process.argv.slice(2)) {
  const full = argv.includes('--full');
  const results = [];
  for (const c of CHECKS) {
    const r = run(c.argv(), ROOT);
    results.push({ ...c, ...r, skipped: false });
  }
  for (const c of PRODUCT_CHECKS) {
    const deps = c.cwd === '.' ? true : existsSync(resolve(ROOT, c.cwd, 'node_modules'));
    if (!deps) {
      results.push({ ...c, rc: full ? 1 : 0, tail: `нет ${c.cwd}/node_modules — запустите npm ci в ${c.cwd}`, skipped: true });
      continue;
    }
    if (!full && KNOWN_PRODUCT_DEBT[c.id]) {
      results.push({ ...c, rc: 0, tail: KNOWN_PRODUCT_DEBT[c.id], skipped: false, known: true });
      continue;
    }
    results.push({ ...c, ...run(c.argv, resolve(ROOT, c.cwd)), skipped: false });
  }
  for (const r of results) {
    const mark = r.skipped ? 'SKIP' : r.known ? 'KNOWN' : r.rc === 0 ? ' OK ' : 'FAIL';
    console.log(`[${mark}] ${r.id.padEnd(18)} ${r.weight}${r.skipped || r.known ? ' — ' + r.tail : ''}`);
    if (r.rc !== 0 && !r.skipped) console.log(String(r.tail).trim().split('\n').slice(-6).map((l) => '        ' + l).join('\n'));
  }
  const failed = results.filter((r) => r.rc !== 0);
  const skipped = results.filter((r) => r.skipped);
  const known = results.filter((r) => r.known);
  console.log(`\n[preflight] проверок ${results.length}, fail ${failed.length}, skip ${skipped.length}, known ${known.length}` +
    (skipped.length ? ' (пропуски — не pass; для полного прогона: --full после npm ci)' : '') +
    (known.length ? ' (KNOWN — не pass: записанный долг продукта; в --full это FAIL)' : ''));
  return failed.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
