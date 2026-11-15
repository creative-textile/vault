#!/usr/bin/env node
/**
 * Кросс-платформенный запуск проб локального контура.
 *
 * `node --test tools/local/tests/*.test.mjs` ломается в cmd.exe: оболочка
 * Windows не раскрывает `*`, и Node получает литерал пути. Поэтому список
 * файлов собирается здесь, а preflight.mjs делает то же самое независимо —
 * коммит не может подменить собственную проверку.
 */
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const files = readdirSync(resolve(HERE, 'tests'))
  .filter((f) => f.endsWith('.test.mjs')).sort()
  .map((f) => `tools/local/tests/${f}`);

if (!files.length) {
  console.error('[test:local] нет файлов *.test.mjs');
  process.exitCode = 1;
} else {
  const p = spawnSync(process.execPath, ['--test', ...files], { cwd: ROOT, stdio: 'inherit' });
  process.exitCode = p.status ?? 1;
}
