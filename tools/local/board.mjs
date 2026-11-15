#!/usr/bin/env node
/**
 * Доска из Git: статический HTML без сервиса, аккаунта и внешних ресурсов.
 * Источники: JSON карточек в tasks/, ADR в decisions/, вердикты, costs/ledger.jsonl.
 *
 *   node tools/local/board.mjs            # пересобрать docs/board/index.html
 *   node tools/local/board.mjs --check    # CI: свежая ли доска (exit 2 если нет)
 *
 * Вывод детерминирован: сортировка по id, без времени генерации в разметке —
 * иначе --check всегда красный. Открывается через file://.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../..');
export const OUT = resolve(ROOT, 'docs/board/index.html');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '$' + Number(n || 0).toFixed(4);

function jsonFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (extname(p) === '.json') out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}
/** Испорченный JSON — ошибка сборки, а не пропущенная строка доски. */
const readJson = (p) => {
  try { return JSON.parse(readFileSync(p, 'utf8')); }
  catch (err) { throw new Error(`не читается JSON ${p}: ${err.message}`); }
};

export function collect(root = ROOT) {
  const cards = jsonFiles(resolve(root, 'tasks')).map(readJson).filter((x) => x && x.kind === 'card');
  const missions = jsonFiles(resolve(root, 'tasks')).map(readJson).filter((x) => x && x.kind === 'mission');
  const verdicts = jsonFiles(resolve(root, 'verdicts')).map(readJson).filter(Boolean);
  const decisions = [];
  const decDir = resolve(root, 'decisions');
  if (existsSync(decDir)) {
    for (const f of readdirSync(decDir).filter((f) => f.endsWith('.md')).sort()) {
      const text = readFileSync(join(decDir, f), 'utf8');
      const title = (text.match(/^#\s+(.+)$/m) || [, f])[1];
      decisions.push({ id: f.replace(/\.md$/, ''), title });
    }
  }
  const ledgerPath = resolve(root, 'costs/ledger.jsonl');
  const ledger = existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean)
    .map((l, i) => {
      try { return JSON.parse(l); }
      catch (err) { throw new Error(`журнал расходов повреждён, строка ${i + 1}: ${err.message}`); }
    }) : [];
  const cfg = readJson(resolve(root, 'costs/budget.json')) || { phaseLimitUsd: 15, planBaselineUsd: 13.46 };
  return { cards: cards.sort((a, b) => a.id.localeCompare(b.id)), missions, verdicts, decisions, ledger, cfg };
}

export function render(data) {
  const { cards, missions, verdicts, decisions, ledger, cfg } = data;
  const byPhase = new Map();
  for (const r of ledger) {
    const p = r.phase || '—';
    const cur = byPhase.get(p) || { spent: 0, calls: 0, cached: 0, prompt: 0 };
    cur.spent += r.cost_usd || 0; cur.calls += 1;
    cur.cached += r.cached_tokens || 0; cur.prompt += r.prompt_tokens || 0;
    byPhase.set(p, cur);
  }
  const byCard = new Map();
  for (const r of ledger) byCard.set(r.card, (byCard.get(r.card) || 0) + (r.cost_usd || 0));
  const vByCard = new Map(verdicts.map((v) => [v.card, v]));
  const badges = { draft: '⚪', ready: '🟢', running: '🔵', submitted: '🟡', accepted: '✅', rework: '🔁', blocked: '⛔', active: '▶️', done: '✅' };

  const phaseRows = [...byPhase.entries()].sort().map(([p, s]) => `<tr><td>${esc(p)}</td><td>${money(s.spent)}</td><td>${money(cfg.phaseLimitUsd)}</td><td>${money(Math.max(0, cfg.phaseLimitUsd - s.spent))}</td><td>${s.calls}</td><td>${s.prompt ? (100 * s.cached / s.prompt).toFixed(1) : '0.0'}%</td></tr>`).join('');
  const cardRows = cards.map((c) => {
    const v = vByCard.get(c.id);
    const gates = (c.gates || []).length;
    return `<tr data-status="${esc(c.status)}"><td><code>${esc(c.id)}</code></td><td>${esc(c.title)}</td><td>${badges[c.status] || '•'} ${esc(c.status)}</td><td>${esc(c.role)} / ${esc(c.model)}</td><td>${esc(c.mode)}</td><td>${gates}</td><td>${money(byCard.get(c.id) || 0)}</td><td>${v ? esc(v.status) : '—'}</td></tr>`;
  }).join('');
  const decRows = decisions.map((d) => `<li><code>${esc(d.id)}</code> — ${esc(d.title)}</li>`).join('');
  const vRows = [...verdicts].sort((a, b) => a.card.localeCompare(b.card)).map((v) => `<li><code>${esc(v.card)}</code> — ${esc(v.status)} · ${esc(v.model)} · ${money(v.cost_usd)} · ${v.evidence?.length || 0} замера</li>`).join('');

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vault · доска</title>
<style>
:root{color-scheme:dark;--bg:#080b14;--card:#111827;--line:#243049;--txt:#e6edf7;--mut:#8ea0bd;--acc:#5eead4}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:1200px;margin:0 auto;padding:28px 20px 60px}h1{font-size:24px;margin:0 0 4px}h2{font-size:17px;margin:32px 0 10px;color:var(--acc)}
p.sub{color:var(--mut);margin:0 0 24px}section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:12px 0;overflow:auto}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}th{color:var(--mut);font-weight:600}
code{color:var(--acc)}ul{margin:0;padding-left:20px}li{margin:4px 0}.legend{color:var(--mut);font-size:12px}
tr[data-status="blocked"]{opacity:.72}tr[data-status="accepted"] td:first-child{color:var(--acc)}
</style></head><body><main>
<h1>🏛️ Vault · доска</h1>
<p class="sub">Генерируется из Git: <code>tasks/</code> · <code>decisions/</code> · <code>verdicts/</code> · <code>costs/ledger.jsonl</code>. Команда: <code>npm run board</code>. Данных вне репозитория нет.</p>
<section><h2>Фазы и деньги</h2><table><thead><tr><th>Фаза</th><th>Потрачено</th><th>Лимит</th><th>Остаток</th><th>Вызовов</th><th>Кэш input</th></tr></thead><tbody>${phaseRows || '<tr><td colspan="6">Вызовов пока нет — журнал пуст</td></tr>'}</tbody></table>
<p class="legend">План фазы ${money(cfg.planBaselineUsd)}, жёсткий лимит ${money(cfg.phaseLimitUsd)}. Факт — только из <code>usage.cost</code>.</p></section>
<section><h2>Миссии</h2><ul>${missions.map((m) => `<li><code>${esc(m.id)}</code> — ${esc(m.title)} (${badges[m.status] || '•'} ${esc(m.status)})</li>`).join('') || '<li>нет</li>'}</ul></section>
<section><h2>Карточки (${cards.length})</h2><table><thead><tr><th>ID</th><th>Название</th><th>Статус</th><th>Роль / модель</th><th>Режим</th><th>Гейтов</th><th>Факт</th><th>Вердикт</th></tr></thead><tbody>${cardRows || '<tr><td colspan="8">нет</td></tr>'}</tbody></table>
<p class="legend">🟢 ready · 🔵 running · 🟡 submitted · ✅ accepted · 🔁 rework · ⛔ blocked (нужен Мастер)</p></section>
<section><h2>Решения (ADR)</h2><ul>${decRows || '<li>нет</li>'}</ul></section>
<section><h2>Вердикты</h2><ul>${vRows || '<li>Пока нет — первая карточка ещё не прогонялась через API</li>'}</ul></section>
</main></body></html>
`;
}

export function main(argv = process.argv.slice(2), { root = ROOT, out = OUT } = {}) {
  const data = collect(root);
  const html = render(data);
  if (argv.includes('--check')) {
    const current = existsSync(out) ? readFileSync(out, 'utf8') : '';
    if (current !== html) {
      console.error('[board] доска устарела: запустите npm run board и закоммитьте docs/board/index.html');
      return 2;
    }
    console.log('[board] доска свежая');
    return 0;
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html, 'utf8');
  console.log(`[board] готово: ${out} (карточек ${data.cards.length}, решений ${data.decisions.length}, вердиктов ${data.verdicts.length})`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
