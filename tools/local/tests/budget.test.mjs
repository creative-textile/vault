/**
 * Пробы учёта расходов. Запуск: node --test tools/local/tests/budget.test.mjs
 * Сеть, секреты и зависимости не нужны; журнал и конфиг — во временном каталоге.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'vault-budget-'));
const ledger = join(dir, 'ledger.jsonl');
const cfgPath = join(dir, 'budget.json');
writeFileSync(cfgPath, JSON.stringify({
  schema: 1, phaseLimitUsd: 1, warnAt: [0.8, 0.95], planBaselineUsd: 0.8, topUpFeePct: 5.5,
}));
process.env.VAULT_LEDGER = ledger;
process.env.VAULT_BUDGET_CONFIG = cfgPath;
const m = await import('../budget.mjs');

const chatResponse = {
  id: 'gen-chat-1',
  usage: {
    prompt_tokens: 12000, completion_tokens: 900, total_tokens: 12900, cost: 0.38,
    prompt_tokens_details: { cached_tokens: 8000, cache_write_tokens: 120 },
    completion_tokens_details: { reasoning_tokens: 100 },
    cost_details: { upstream_inference_cost: 0.38 },
  },
};
const responsesResponse = {
  id: 'gen-resp-1',
  usage: {
    input_tokens: 400, output_tokens: 20, total_tokens: 420, cost: 0.013,
    input_tokens_details: { cached_tokens: 350 },
    output_tokens_details: { reasoning_tokens: 0 },
  },
};

test('usage Chat Completions и Responses разбираются в одну форму', () => {
  const a = m.parseUsage(chatResponse);
  assert.equal(a.cost_usd, 0.38);
  assert.equal(a.prompt_tokens, 12000);
  assert.equal(a.cached_tokens, 8000);
  assert.equal(a.cache_write_tokens, 120);
  assert.equal(a.reasoning_tokens, 100);
  const b = m.parseUsage(responsesResponse);
  assert.equal(b.cost_usd, 0.013);
  assert.equal(b.prompt_tokens, 400);
  assert.equal(b.cached_tokens, 350);
  assert.equal(b.completion_tokens, 20);
});

test('batch-результаты разворачиваются и несут custom_id', () => {
  const batch = { data: { results: [
    { custom_id: 'K1/auditor', response: { usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.072 } } },
    { custom_id: 'K2/auditor', response: { usage: { input_tokens: 10, output_tokens: 2, cost: 0.072 } } },
  ] } };
  const items = m.expandResponses(batch);
  assert.equal(items.length, 2);
  assert.equal(items[0].inferredId, 'K1/auditor');
  assert.equal(items[1].inferredId, 'K2/auditor');
  assert.equal(m.parseUsage(items[0].raw).cost_usd, 0.072);
  assert.equal(m.parseUsage(items[1].raw).prompt_tokens, 10);
});

test('запись без фазы или карточки не принимается', () => {
  assert.throws(() => m.normalizeRecord({ raw: chatResponse, meta: { card: 'K1' }, callId: 'x' }), /фаза/);
  assert.throws(() => m.normalizeRecord({ raw: chatResponse, meta: { phase: 'F1' }, callId: 'x' }), /карточка/);
});

test('журнал append-only: повтор no-op, конфликт цены — ошибка', () => {
  const meta = { phase: 'F1', card: 'K1', role: 'executor', model: 'm', model_key: 'flash', mode: 'sync' };
  const rec = m.normalizeRecord({ raw: chatResponse, meta, callId: 'K1/ex1/1' });
  assert.equal(rec.model_key, 'flash'); // по нему считается лимит дорогих вызовов
  assert.deepEqual(m.appendRecords([rec], ledger).added.length, 1);
  assert.deepEqual(m.appendRecords([rec], ledger).duplicates, 1);
  assert.equal(m.readLedger(ledger).length, 1);
  const changed = { ...rec, cost_usd: 9.99 };
  assert.throws(() => m.appendRecords([changed], ledger), (err) => err.code === 4);
});

test('сумма считается по фазе, check --add ловит превышение', () => {
  const cfg = m.readConfig(cfgPath);
  const recs = [
    m.normalizeRecord({ raw: chatResponse, meta: { phase: 'F1', card: 'K1', role: 'executor' }, callId: 'a' }),
    m.normalizeRecord({ raw: responsesResponse, meta: { phase: 'F1', card: 'K2', role: 'coordinator' }, callId: 'b' }),
    m.normalizeRecord({ raw: null, meta: { phase: 'F2', card: 'K3', kind: 'topup_fee' }, costOverride: 0.55, callId: 'c' }),
  ];
  const sum = m.summarize(recs, { phase: 'F1', cfg });
  assert.equal(sum.spent_usd, 0.393);
  assert.equal(sum.calls, 2);
  assert.equal(sum.by_role[0].role, 'executor');
  assert.equal(sum.level, 'ok'); // 0.393 / 1 = 39%
  assert.equal(m.summarize(recs, { phase: 'F1', cfg, add: 0.45 }).level, 'warn'); // 0.843 / 1
  const projected = m.summarize(recs, { phase: 'F1', cfg, add: 0.7 });
  assert.equal(projected.projected_usd, 1.093);
  assert.equal(projected.level, 'over');
  assert.equal(m.summarize(recs, { phase: 'F2', cfg }).calls, 1);
});

test('CLI: record → report → check → stop', () => {
  const f = join(dir, 'resp.json');
  writeFileSync(f, JSON.stringify(chatResponse));
  assert.equal(m.main(['record', '--file', f, '--phase', 'F1', '--card', 'CLI-K1', '--role', 'executor', '--model', 'm', '--call-id', 'cli-1']), 0);
  assert.equal(m.main(['report', '--phase', 'F1', '--json']), 0);
  assert.equal(m.main(['check', '--phase', 'F1', '--add', '0.1', '--json']), 0);
  assert.equal(m.main(['check', '--phase', 'F1', '--add', '5', '--json']), 2);
  const lines = readFileSync(ledger, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2); // запись из прошлого теста + CLI
  assert.equal(JSON.parse(lines[1]).card, 'CLI-K1');
});

test('повреждённая строка журнала — ошибка, а не тихое пропускание', () => {
  const bad = join(dir, 'bad.jsonl');
  writeFileSync(bad, '{"cost_usd": 0.1}\nНЕ JSON\n');
  assert.throws(() => m.readLedger(bad), /журнал повреждён, строка 2/);
});
