/**
 * Пробы контекст-паков: кэшируемый system-prefix, жёсткий лимит токенов,
 * только явно перечисленные scope-файлы. Сеть, ключи и зависимости не нужны.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const m = await import('../context-pack.mjs');
const cfg = m.loadConfig();

test('оценка токенов консервативна и монотонна', () => {
  assert.equal(m.estimateTokens(''), 0);
  assert.ok(m.estimateTokens('Привет мир') > m.estimateTokens('hello world'));
  assert.ok(m.estimateTokens('a'.repeat(360)) >= 100);
});

test('все карточки Ф1 собираются в пак без записи на диск', () => {
  const cards = m.listCards();
  assert.equal(cards.length, 8, `найдено карточек: ${cards.map((c) => c.card.id).join(', ')}`);
  const hashes = new Set();
  for (const { card } of cards) {
    const pack = m.buildPack(card, { cfg, write: false });
    hashes.add(pack.systemHash);
    assert.equal(pack.system, readFileSync(resolve(m.ROOT, cfg.systemPrefix), 'utf8'));
    assert.ok(pack.tokens > 0 && pack.tokens <= cfg.contextLimitTokens, `${card.id}: ${pack.tokens}`);
    assert.ok(pack.sections.some((s) => s.name === 'Формат ответа'));
    assert.ok(pack.user.includes(card.id));
    assert.ok(!pack.user.includes('#### ARCHITECTURE.md'), 'большой документ не должен попадать в пак');
  }
  assert.equal(hashes.size, 1, 'system-prefix обязан быть байт-в-байт одинаковым для кэша');
  assert.equal([...hashes][0], createHash('sha256').update(readFileSync(resolve(m.ROOT, cfg.systemPrefix), 'utf8')).digest('hex').slice(0, 16));
});

test('превышение лимита — явная ошибка с разбивкой по секциям, а не тихая обрезка', () => {
  const card = m.listCards().find((c) => c.card.id === 'LOCAL-0-K1').card;
  assert.throws(() => m.buildPack(card, { cfg: { ...cfg, contextLimitTokens: 10 }, write: false }), (err) => {
    assert.equal(err.code, 2);
    assert.match(err.message, /Уменьши contextFiles\/decisions, не поднимай лимит/);
    assert.ok(err.sections.length >= 3);
    return true;
  });
});

test('битая ссылка на scope-файл или ADR не превращается в пустой промпт', () => {
  const card = m.listCards().find((c) => c.card.id === 'LOCAL-0-K1').card;
  assert.throws(() => m.buildPack({ ...card, contextFiles: ['нет/такого.md'] }, { cfg, write: false }), /contextFiles: нет файла/);
  assert.throws(() => m.buildPack({ ...card, decisions: ['D-НЕТ'] }, { cfg, write: false }), /решение не найдено/);
});

test('CLI --check проходит по всем карточкам и не пишет .state', () => {
  const p = spawnSync(process.execPath, ['tools/local/context-pack.mjs', '--check', '--no-write'], {
    cwd: m.ROOT, encoding: 'utf8',
  });
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /карточек 8, лимит 12000 токенов, ошибок 0/);
});
