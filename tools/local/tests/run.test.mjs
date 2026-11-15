/**
 * Пробы оркестратора offline: роутинг моделей, зоны, гейты, сухой прогон.
 * Ни одного сетевого вызова и ни одной записи в costs/ledger.jsonl.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const m = await import('../run.mjs');
const cp = await import('../context-pack.mjs');
const cfg = cp.loadConfig();
const card = (over = {}) => JSON.parse(readFileSync(resolve(m.ROOT, 'tasks/F1/LOCAL-0-K1.json'), 'utf8'));
const LOCAL = card();

test('matchPath: точное совпадение, папка, расширение и **', () => {
  assert.equal(m.matchPath('.env.example', '.env.example'), true);
  assert.equal(m.matchPath('.github/workflows/ci.yml', '.github/workflows/'), true);
  assert.equal(m.matchPath('docs/board/index.html', 'docs/board/'), true);
  assert.equal(m.matchPath('docs/board/index.html', 'docs/board'), true);
  assert.equal(m.matchPath('AGENTS.md', '*.md'), true);
  assert.equal(m.matchPath('AGENTS.txt', '*.md'), false);
  assert.equal(m.matchPath('tools/local/run.mjs', 'tools/local/**'), true);
  assert.equal(m.matchPath('tools/other/run.mjs', 'tools/local/**'), false);
  assert.equal(m.matchPath('backend/src/services/ton.ts', 'backend/src/services/ton.ts'), true);
});

test('чужой дифф не отправляет карточку на дорогую модель', () => {
  const diff = ['.env.example', '.github/workflows/ci.yml', 'backend/src/services/ton.ts', 'tools/local/run.mjs', 'docs/board/index.html'];
  const relevant = m.relevantPaths(LOCAL, diff);
  assert.ok(relevant.includes('tools/local/run.mjs'));
  assert.ok(relevant.includes('docs/board/index.html'));
  assert.ok(!relevant.includes('.env.example'));
  assert.ok(!relevant.includes('backend/src/services/ton.ts'));
  assert.equal(m.resolveModel(LOCAL, { cfg, ledger: [], changedPaths: relevant }).key, 'flash');
  // до фильтрации глобальный дифф ложно давал critical на каждой карточке
  assert.equal(m.resolveModel(LOCAL, { cfg, ledger: [], changedPaths: diff }).key, 'critical');
});

test('критические пути → Argon, лимит 4 за фазу считается по model_key', () => {
  const money = { ...LOCAL, zone: ['backend/src/services/ton.ts'] };
  const paths = m.relevantPaths(money, []);
  const chosen = m.resolveModel(money, { cfg, ledger: [], changedPaths: paths, env: {} });
  assert.equal(chosen.key, 'critical');
  assert.match(chosen.reason, /деньги\/доступы\/миграции/);
  const ledger = Array.from({ length: 4 }, (_, i) => ({ phase: 'F1', model_key: 'critical', call_id: `c${i}` }));
  assert.throws(() => m.resolveModel(money, { cfg, ledger, changedPaths: paths, env: {} }), (err) => err.code === 2 && /лимит Argon/.test(err.message));
  assert.equal(m.resolveModel(money, { cfg, ledger: ledger.slice(0, 3), changedPaths: paths, env: {} }).key, 'critical');
});

test('Flash только когда оракул целиком скриптовый и зона механическая', () => {
  const mechanical = { ...LOCAL, oracle: [{ cmd: 'node x', expect: 0 }] };
  assert.equal(m.resolveModel(mechanical, { cfg, changedPaths: m.relevantPaths(mechanical, []), env: {} }).key, 'flash');
  const human = { ...mechanical, oracle: [{ cmd: 'node x' }, { text: 'посмотреть глазами' }] };
  assert.equal(m.resolveModel(human, { cfg, changedPaths: m.relevantPaths(human, []), env: {} }).key, 'flash'); // model: flash в карточке
  const product = { ...human, model: 'executor', zone: ['backend/src/games/**'] };
  assert.equal(m.resolveModel(product, { cfg, changedPaths: m.relevantPaths(product, []), env: {} }).key, 'executor');
});

test('expandArgv разворачивает @py/@node/@root без оболочки', () => {
  const out = m.expandArgv(['@py', '@node', '@root', '@root/tasks/F1/mission.json', 'ok'], { root: '/work/vault', env: {} });
  assert.equal(out[out.length - 1], 'ok');
  assert.ok(out.includes(process.execPath));
  assert.ok(out.includes('/work/vault'));
  assert.ok(out.includes('/work/vault/tasks/F1/mission.json'));
  assert.ok(out.includes('python3') || out.includes('py'));
});

test('loadEnv читает локальный .env, комментарии и кавычки игнорирует', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'vault-env-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, '.env'), '# комментарий\nVAULT_PHASE="F1"\nOPENROUTER_API_KEY=sk-test\n EMPTY= \n');
  const env = m.loadEnv(dir);
  assert.equal(env.VAULT_PHASE, 'F1');
  assert.equal(env.OPENROUTER_API_KEY, 'sk-test');
  assert.equal(m.envValue('VAULT_PHASE', env), 'F1');
});

test('гейты дают rc и SHA и останавливаются на первом красном', () => {
  const gates = m.runGates({
    gates: [
      ['@node', '-e', 'process.stdout.write("первый замер")'],
      ['@node', '-e', 'console.error("красный"); process.exit(3)'],
      ['@node', '-e', 'process.stdout.write("не должен выполниться")'],
    ],
  }, { root: m.ROOT, env: {} });
  assert.equal(gates.length, 2, 'после красного гейта остальные не запускаются');
  assert.equal(gates[0].rc, 0);
  assert.match(gates[0].sha, /^[a-f0-9]{16}$/);
  assert.equal(gates[1].rc, 3);
  assert.notEqual(gates[0].sha, gates[1].sha);
  assert.match(gates[1].tail, /красный/);
});

test('схема ответа строгая: только JSON, без свободных полей', () => {
  assert.equal(m.RESULT_SCHEMA.additionalProperties, false);
  assert.deepEqual(m.RESULT_SCHEMA.properties.status.enum, ['submitted', 'need_master']);
  for (const k of ['status', 'summary', 'changed_files', 'commands', 'evidence', 'reason']) {
    assert.ok(m.RESULT_SCHEMA.required.includes(k));
  }
});

test('CLI --dry-run не делает платного вызова и печатает план', () => {
  const p = spawnSync(process.execPath, ['tools/local/run.mjs', '--card', 'tasks/F1/LOCAL-0-K1.json', '--dry-run'], {
    cwd: m.ROOT, encoding: 'utf8', env: { ...process.env, OPENROUTER_API_KEY: '' },
  });
  assert.equal(p.status, 0, p.stderr);
  const plan = JSON.parse(p.stdout);
  assert.equal(plan.dry_run, true);
  assert.equal(plan.card, 'LOCAL-0-K1');
  assert.equal(plan.model, 'flash');
  assert.ok(plan.context_tokens > 0 && plan.context_tokens <= cfg.contextLimitTokens);
  assert.equal(plan.budget.limit, 15);
  assert.notEqual(plan.budget.level, 'over');
  assert.deepEqual(plan.gates, [], 'сухой прогон не запускает локальные гейты');
});
