/**
 * Пробы обвязки: конфиг моделей, версии Blender, системный Python и
 * фиксированный список проверок preflight. Всё офлайн.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const blender = await import('../blender.mjs');
const py = await import('../py.mjs');
const pre = await import('../preflight.mjs');
// Читаем JSON обычным способом: CI ставит Node 20, где синтаксис import
// attributes зависит от минорной версии.
const models = JSON.parse(readFileSync(resolve(pre.ROOT, 'tools/local/models.json'), 'utf8'));

test('models.json: маршрутизация и цены согласованы', () => {
  assert.equal(models.provider, 'openrouter');
  assert.equal(models.contextLimitTokens, 12000);
  assert.ok(existsSync(resolve(pre.ROOT, models.systemPrefix)));
  for (const [key, m] of Object.entries(models.models)) {
    assert.match(m.env, /^VAULT_MODEL_/, key);
    assert.ok(Number.isFinite(m.estimateUsd) && m.estimateUsd >= 0, key);
    assert.ok(['sync', 'batch'].includes(m.mode), key);
    if (models.routing.batchRoles.includes(key)) assert.equal(m.mode, 'batch', key);
  }
  assert.equal(models.models.critical.maxPerPhase, 4);
  assert.ok(models.routing.criticalPaths.includes('backend/src/services/ton.ts'));
  assert.ok(models.routing.scriptDecidable.includes('tools/local/'));
  for (const r of models.routing.batchRoles) assert.ok(models.models[r], `нет модели для батч-роли ${r}`);
});

test('Blender: версия читается, пин 5.3 и запасной LTS', () => {
  assert.equal(blender.parseVersion('Blender 5.3.0 (build 2026-11-10)\n'), '5.3.0');
  assert.equal(blender.parseVersion('мусор'), null);
  assert.equal(blender.versionDecision('5.3.2', '5.3.0', '5.2.4', false).ok, true);
  assert.equal(blender.versionDecision('4.5.3', '5.3.0', '5.2.4', true).ok, false);
  assert.equal(blender.versionDecision('5.2.4', '5.3.0', '5.2.4', true).ok, true);
  assert.equal(blender.versionDecision(null, '5.3.0', '5.2.4', true).ok, false);
  const cfg = JSON.parse(readFileSync(resolve(pre.ROOT, 'tools/modeling/blender-version.json'), 'utf8'));
  assert.equal(cfg.pinned, '5.3.0');
  assert.equal(cfg.fallbackLts, '5.2.4');
  assert.match(cfg.download.url, /blender-5\.3\.0-windows-x64\.zip$/);
  assert.match(cfg.download.sha256, /^[a-f0-9]{64}$/);
  assert.match(cfg.download.ltsFallbackUrl, /5\.2\.4-windows-x64\.zip$/);
  assert.ok(cfg.args.includes('--gpu-backend'));
  assert.ok(cfg.args.includes('opengl'));
});

test('BLENDER_EXE и VAULT_PYTHON читаются из окружения', (t) => {
  const savedB = process.env.BLENDER_EXE, savedP = process.env.VAULT_PYTHON;
  t.after(() => {
    if (savedB === undefined) delete process.env.BLENDER_EXE; else process.env.BLENDER_EXE = savedB;
    if (savedP === undefined) delete process.env.VAULT_PYTHON; else process.env.VAULT_PYTHON = savedP;
  });
  delete process.env.BLENDER_EXE;
  delete process.env.VAULT_PYTHON;
  assert.equal(blender.blenderExe({ BLENDER_EXE: 'C:/tools/blender.exe' }), 'C:/tools/blender.exe');
  assert.equal(blender.blenderExe({}), 'blender');
  assert.equal(typeof blender.loadEnv(pre.ROOT), 'object');
  assert.deepEqual(py.pythonArgv({ VAULT_PYTHON: 'py' }), { exe: 'py', prefix: ['-3'] });
  assert.equal(py.pythonArgv({}).exe, process.platform === 'win32' ? 'py' : 'python3');
});

test('.env парсится одинаково всеми обёртками', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'vault-dotenv-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, '.env'), '# комментарий\nVAULT_PHASE=F1\nBLENDER_EXE="C:/b/blender.exe"\n');
  assert.equal(blender.loadEnv(dir).BLENDER_EXE, 'C:/b/blender.exe');
  assert.equal(py.loadEnv(dir).VAULT_PHASE, 'F1');
});

test('системный Python запускает скрипт и сообщает об отсутствии файла', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'vault-py-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = join(dir, 'ok.py');
  writeFileSync(script, 'print("py-ok")\n');
  assert.equal(py.main(['--script', script]), 0);
  assert.equal(py.main(['--script', join(dir, 'нет.py')]), 1);
});

test('preflight: список проверок зашит в коде и run пробрасывает rc', () => {
  assert.deepEqual(pre.CHECKS.map((c) => c.id), ['local-tests', 'board', 'context-packs', 'budget', 'git-diff']);
  const argv = pre.CHECKS[0].argv();
  assert.equal(argv[1], '--test');
  assert.ok(argv.slice(2).some((f) => f.endsWith('budget.test.mjs')));
  assert.ok(pre.PRODUCT_CHECKS.every((c) => Array.isArray(c.argv)));
  assert.ok(pre.PRODUCT_CHECKS.some((c) => c.id === 'models:audit' && c.argv.includes('tools/modeling/audit_glb.py')));
  assert.match(pre.KNOWN_PRODUCT_DEBT['models:audit'], /вне бюджета 3D/);
  assert.equal(pre.run([process.execPath, '-e', 'process.exit(0)'], pre.ROOT).rc, 0);
  assert.equal(pre.run([process.execPath, '-e', 'process.exit(7)'], pre.ROOT).rc, 7);
});

test('D-126: контур без Docker зафиксирован в CI, ADR и документации', () => {
  const read = (rel) => readFileSync(resolve(pre.ROOT, rel), 'utf8');
  const ci = read('.github/workflows/ci.yml');
  assert.ok(!/docker build|docker compose config/.test(ci), 'в CI не должно быть сборки образов');
  assert.ok(ci.includes('local-tools'));
  const adr = read('decisions/D-126.md');
  for (const s of ['Vercel', 'Render', 'Supabase', 'GitHub', 'Docker', 'Godot', 'PR']) assert.ok(adr.includes(s), `ADR не упоминает ${s}`);
  const deploy = read('docs/DEPLOY-FREE.md');
  for (const s of ['Vercel', 'Render', 'Supabase', 'GitHub', 'supabase start']) assert.ok(deploy.includes(s), `DEPLOY-FREE не упоминает ${s}`);
  const toolbox = read('docs/TOOLBOX.md');
  assert.match(toolbox, /winget install --id GitHub\.cli/);
  assert.match(toolbox, /render\.cli/);
  assert.match(toolbox, /Godot/);
  const env = read('.env.example');
  assert.match(env, /Vercel \(фронт\)/);
  const oracle = read('scripts/go-live-check.mjs');
  assert.ok(oracle.includes('docs/DEPLOY-FREE.md') && !oracle.includes("'docker-compose.yml'"));
});
