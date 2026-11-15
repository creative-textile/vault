/**
 * Пробы доски: детерминированный HTML из Git, экранирование, --check,
 * отказ молча проглотить испорченный JSON. Всё во временном каталоге.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const m = await import('../board.mjs');

function makeRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'vault-board-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const d of ['tasks/F1', 'decisions', 'verdicts', 'costs', 'docs/board']) mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, 'tasks/F1/mission.json'), JSON.stringify({ kind: 'mission', id: 'V-1-1', title: 'Миссия', status: 'active' }));
  writeFileSync(join(root, 'tasks/F1/LOCAL-0-K1.json'), JSON.stringify({
    kind: 'card', id: 'LOCAL-0-K1', phase: 'F1', title: 'Смоук', status: 'ready', role: 'executor', model: 'flash', mode: 'sync', gates: [['node', 'x']],
  }));
  writeFileSync(join(root, 'decisions/D-125.md'), '# D-125 · Локальный Git/API-контур\n\nРешение.\n');
  writeFileSync(join(root, 'costs/budget.json'), JSON.stringify({ phaseLimitUsd: 15, planBaselineUsd: 13.46 }));
  writeFileSync(join(root, 'costs/ledger.jsonl'), '');
  return root;
}

test('collect читает карточки, миссии, ADR и деньги', (t) => {
  const root = makeRoot(t);
  const data = m.collect(root);
  assert.equal(data.cards.length, 1);
  assert.equal(data.missions[0].id, 'V-1-1');
  assert.equal(data.decisions[0].id, 'D-125');
  assert.match(data.decisions[0].title, /Локальный Git\/API-контур/);
  assert.equal(data.cfg.phaseLimitUsd, 15);
  assert.deepEqual(data.ledger, []);
});

test('render детерминирован, экранирует ввод и не мутирует данные', (t) => {
  const root = makeRoot(t);
  const data = m.collect(root);
  data.cards[0].title = '<script>alert("x")</script>';
  const before = JSON.stringify(data.verdicts);
  const a = m.render(data);
  const b = m.render(data);
  assert.equal(a, b);
  assert.equal(JSON.stringify(data.verdicts), before);
  assert.ok(!a.includes('<script>alert'));
  assert.ok(a.includes('&lt;script&gt;'));
  assert.ok(a.includes('LOCAL-0-K1'));
  assert.ok(a.includes('D-125'));
  assert.ok(!/(?:src|href)=["']https?:\/\//.test(a), 'доска не тянет внешние ресурсы');
  assert.ok(a.includes('Вызовов пока нет'));
});

test('main: сборка → --check зелёный → правка карточки → --check красный', (t) => {
  const root = makeRoot(t);
  const out = join(root, 'docs/board/index.html');
  assert.equal(m.main([], { root, out }), 0);
  const html = readFileSync(out, 'utf8');
  assert.equal(html, m.render(m.collect(root)));
  assert.equal(m.main(['--check'], { root, out }), 0);
  const p = join(root, 'tasks/F1/LOCAL-0-K1.json');
  writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, 'utf8')), status: 'submitted' }));
  assert.equal(m.main(['--check'], { root, out }), 2, 'устаревшая доска не должна считаться свежей');
  assert.equal(m.main([], { root, out }), 0);
  assert.equal(m.main(['--check'], { root, out }), 0);
});

test('испорченный ledger или карточка — явная ошибка сборки', (t) => {
  const root = makeRoot(t);
  writeFileSync(join(root, 'costs/ledger.jsonl'), 'НЕ JSON\n');
  assert.throws(() => m.collect(root), /журнал расходов повреждён, строка 1/);
  writeFileSync(join(root, 'costs/ledger.jsonl'), '');
  writeFileSync(join(root, 'tasks/F1/broken.json'), '{');
  assert.throws(() => m.collect(root), /не читается JSON/);
});
