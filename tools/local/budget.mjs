#!/usr/bin/env node
/**
 * Локальный учёт расходов на API и жёсткий гейт бюджета фазы.
 *
 * Зачем: в Arena ИИ был условно бесплатным, контроль расходов отсутствовал.
 * При работе через OpenRouter каждый вызов возвращает `usage` с фактической
 * стоимостью, кэшированными токенами и разбивкой цены — дополнительный запрос
 * не нужен. Этот инструмент складывает эти `usage` в append-only JSONL в Git и
 * НЕ даёт оркестратору выдать карточку, если фаза вышла за лимит.
 *
 * Документация OpenRouter:
 *   https://openrouter.ai/docs/cookbook/administration/usage-accounting
 *   https://openrouter.ai/docs/guides/features/batch-api
 *   https://openrouter.ai/docs/guides/best-practices/prompt-caching
 *
 * Команды:
 *   node tools/local/budget.mjs record --file <response.json> --phase F1 --card V-1-1-K1 \
 *       --role executor --model <id> [--mode sync|batch] [--call-id <id>] [--all]
 *   node tools/local/budget.mjs record --phase F1 --kind topup_fee --cost 0.55 --call-id deposit-1
 *   node tools/local/budget.mjs check  --phase F1 [--add 0.38] [--json]
 *   node tools/local/budget.mjs report --phase F1 [--json]
 *
 * Коды возврата: 0 — ок; 1 — ошибка ввода; 2 — бюджет исчерпан (или будет
 * исчерпан с учётом `--add`); 3 — повреждён конфиг/журнал; 4 — конфликт
 * повторной записи (тот же call_id, другая цена).
 *
 * Переменные для тестов/переноса: VAULT_LEDGER, VAULT_BUDGET_CONFIG.
 * Секретов, сети и зависимостей нет: только Node >= 20 и стандартная библиотека.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
export const LEDGER = process.env.VAULT_LEDGER || resolve(ROOT, 'costs/ledger.jsonl');
export const CONFIG = process.env.VAULT_BUDGET_CONFIG || resolve(ROOT, 'costs/budget.json');

const num = (...values) => values.find((v) => typeof v === 'number' && Number.isFinite(v)) ?? 0;
const get = (obj, ...path) => path.reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
const round = (n, digits = 6) => Number(Number(n).toFixed(digits));

/** Найти объект usage в ответе Chat Completions / Responses / batch-результата. */
export function findUsage(input) {
  if (!input || typeof input !== 'object') return null;
  if (input.usage && typeof input.usage === 'object') return input.usage;
  for (const key of ['response', 'result', 'body', 'data']) {
    const found = findUsage(input[key]);
    if (found) return found;
  }
  return null;
}

/** Разобрать usage в плоскую запись. Поддерживает обе формы полей OpenRouter. */
export function parseUsage(input) {
  const u = findUsage(input) || (input && typeof input === 'object' ? input : null);
  if (!u) throw new Error('в ответе нет объекта usage');
  const prompt = num(u.prompt_tokens, u.input_tokens);
  const completion = num(u.completion_tokens, u.output_tokens);
  const parsed = {
    cost_usd: num(u.cost),
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: num(u.total_tokens, prompt + completion),
    cached_tokens: num(get(u, 'prompt_tokens_details', 'cached_tokens'), get(u, 'input_tokens_details', 'cached_tokens')),
    cache_write_tokens: num(get(u, 'prompt_tokens_details', 'cache_write_tokens'), get(u, 'input_tokens_details', 'cache_write_tokens')),
    reasoning_tokens: num(get(u, 'completion_tokens_details', 'reasoning_tokens'), get(u, 'output_tokens_details', 'reasoning_tokens')),
    upstream_inference_cost: num(get(u, 'cost_details', 'upstream_inference_cost')),
  };
  if (!Number.isFinite(parsed.cost_usd)) throw new Error('usage.cost не число');
  return parsed;
}

/** Развернуть ответ/массив ответов batch'а в список пар (сырой ответ, call_id). */
export function expandResponses(input) {
  const list = Array.isArray(input?.results) ? input.results
    : Array.isArray(input?.data?.results) ? input.data.results
      : Array.isArray(input) ? input : [input];
  return list.map((item, i) => ({
    raw: item,
    inferredId: item?.custom_id || item?.id || (item?.response?.id) || (item?.result?.id) || `batch-${i + 1}`,
  }));
}

function stableId(raw, meta) {
  return 'sha256:' + createHash('sha256')
    .update(JSON.stringify({ raw, phase: meta.phase, card: meta.card, role: meta.role }))
    .digest('hex').slice(0, 16);
}

/**
 * Собрать нормализованную запись журнала. `cost` из CLI перекрывает usage.cost
 * только когда usage отсутствует (или явно равен 0 при --cost > 0).
 */
export function normalizeRecord({ raw, meta, costOverride, callId }) {
  const fromUsage = raw ? parseUsage(raw) : null;
  let cost = fromUsage ? fromUsage.cost_usd : 0;
  if (typeof costOverride === 'number' && (!cost || !raw)) cost = costOverride;
  if (!Number.isFinite(cost) || cost < 0) throw new Error('стоимость должна быть неотрицательным числом');
  const phase = meta.phase;
  if (!phase) throw new Error('нужна фаза: --phase F1');
  if (!meta.card && meta.kind !== 'topup_fee') throw new Error('нужна карточка: --card <id>');
  return {
    v: 1,
    ts: meta.ts || new Date().toISOString(),
    kind: meta.kind || 'api_call',
    phase,
    card: meta.card || null,
    role: meta.role || null,
    model: meta.model || null,
    model_key: meta.model_key || null,
    mode: meta.mode || 'sync',
    call_id: callId || stableId(raw, meta),
    cost_usd: round(cost),
    prompt_tokens: fromUsage?.prompt_tokens ?? 0,
    completion_tokens: fromUsage?.completion_tokens ?? 0,
    total_tokens: fromUsage?.total_tokens ?? 0,
    cached_tokens: fromUsage?.cached_tokens ?? 0,
    cache_write_tokens: fromUsage?.cache_write_tokens ?? 0,
    reasoning_tokens: fromUsage?.reasoning_tokens ?? 0,
    upstream_inference_cost: fromUsage?.upstream_inference_cost ?? 0,
    source: fromUsage ? 'openrouter.usage' : 'manual',
  };
}

/** Прочитать append-only журнал. Повреждённая строка — ошибка, а не «пропустить». */
export function readLedger(file = LEDGER) {
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  return text.split('\n').filter((line) => line.trim() !== '').map((line, i) => {
    try {
      const rec = JSON.parse(line);
      if (typeof rec.cost_usd !== 'number' || !Number.isFinite(rec.cost_usd) || rec.cost_usd < 0) {
        throw new Error('cost_usd не число');
      }
      return rec;
    } catch (err) {
      throw new Error(`журнал повреждён, строка ${i + 1}: ${err.message}`);
    }
  });
}

/** Дозаписать записи с защитой от повторов: тот же call_id + та же цена = no-op. */
export function appendRecords(records, file = LEDGER) {
  const existing = readLedger(file);
  const byId = new Map(existing.map((rec) => [rec.call_id, rec]));
  const added = [];
  for (const rec of records) {
    const prev = byId.get(rec.call_id);
    if (prev) {
      if (prev.cost_usd !== rec.cost_usd) {
        throw Object.assign(new Error(`конфликт call_id ${rec.call_id}: было ${prev.cost_usd}, пришло ${rec.cost_usd}`), { code: 4 });
      }
      continue; // идемпотентный повтор
    }
    byId.set(rec.call_id, rec);
    added.push(rec);
  }
  if (added.length) {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, added.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  }
  return { added, duplicates: records.length - added.length };
}

/**
 * Фаза по умолчанию: аргумент → переменная окружения → локальный .env.
 * Читается только VAULT_PHASE, без секретов и без внешних зависимостей
 * (кросс-платформенно: npm-скрипты на Windows не умеют ${VAR}).
 */
export function defaultPhase(root = ROOT) {
  if (process.env.VAULT_PHASE) return process.env.VAULT_PHASE;
  const envFile = resolve(root, '.env');
  if (!existsSync(envFile)) return null;
  const line = readFileSync(envFile, 'utf8').split('\n')
    .find((l) => /^\s*VAULT_PHASE\s*=/.test(l) && !/^\s*#/.test(l));
  return line ? line.split('=')[1].trim().replace(/^["']|["']$/g, '') || null : null;
}

export function readConfig(file = CONFIG) {
  if (!existsSync(file)) throw new Error(`нет конфига бюджета: ${file}`);
  const cfg = JSON.parse(readFileSync(file, 'utf8'));
  if (!(cfg.phaseLimitUsd > 0)) throw new Error('phaseLimitUsd должен быть положительным числом');
  cfg.warnAt = cfg.warnAt || [0.8, 0.95];
  return cfg;
}

export function summarize(records, { phase, cfg, add = 0 } = {}) {
  const inPhase = (rec) => !phase || rec.phase === phase;
  const rows = records.filter(inPhase);
  const spent = round(rows.reduce((sum, r) => sum + r.cost_usd, 0));
  const fee = round(rows.filter((r) => r.kind === 'topup_fee').reduce((sum, r) => sum + r.cost_usd, 0));
  const tokens = rows.reduce((acc, r) => ({
    prompt: acc.prompt + (r.prompt_tokens || 0),
    completion: acc.completion + (r.completion_tokens || 0),
    cached: acc.cached + (r.cached_tokens || 0),
  }), { prompt: 0, completion: 0, cached: 0 });
  const by = (key) => [...rows.reduce((map, r) => {
    const k = String(r[key] ?? '—');
    const cur = map.get(k) || { calls: 0, cost_usd: 0 };
    cur.calls += 1; cur.cost_usd += r.cost_usd;
    map.set(k, cur);
    return map;
  }, new Map())].map(([name, val]) => ({ [key]: name, calls: val.calls, cost_usd: round(val.cost_usd) }))
    .sort((a, b) => b.cost_usd - a.cost_usd);
  const limit = cfg?.phaseLimitUsd ?? 0;
  const projected = round(spent + (Number(add) || 0));
  const ratio = limit ? projected / limit : 0;
  const level = limit && projected >= limit ? 'over'
    : ratio >= (cfg?.warnAt?.[1] ?? 0.95) ? 'critical'
      : ratio >= (cfg?.warnAt?.[0] ?? 0.8) ? 'warn' : 'ok';
  return {
    phase: phase || 'все', calls: rows.length, spent_usd: spent, topup_fee_usd: fee,
    projected_usd: projected, limit_usd: limit, remaining_usd: round(Math.max(0, limit - projected)),
    ratio: round(ratio, 4), level,
    tokens, cached_share: tokens.prompt ? round(tokens.cached / tokens.prompt, 4) : 0,
    by_role: by('role'), by_model: by('model'), by_mode: by('mode'), by_card: by('card'),
    baseline_usd: cfg?.planBaselineUsd ?? null,
  };
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

function readInput(args) {
  if (args.file) return JSON.parse(readFileSync(resolve(args.file), 'utf8'));
  if (args.stdin) return JSON.parse(readFileSync(0, 'utf8'));
  return null;
}

function usage() {
  console.log(` budget — учёт расходов API и лимит фазы
  record --file <resp.json> --phase F1 --card <id> --role <роль> --model <id> [--mode sync|batch] [--call-id <id>] [--all]
  record --phase F1 --kind topup_fee --cost <usd> --call-id <id>
  record --phase F1 --card <id> --cost <usd> --call-id <id>       # без файла ответа
  check  [--phase F1] [--add <usd>] [--json]                        # exit 2 при превышении
  report [--phase F1] [--json]
  Файлы: VAULT_LEDGER=${LEDGER}, VAULT_BUDGET_CONFIG=${CONFIG}`);
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  if (!cmd || args.help || cmd === 'help') { usage(); return 0; }
  let cfg;
  try { cfg = readConfig(); } catch (err) { console.error(`[budget] ${err.message}`); return 3; }

  if (cmd === 'record') {
    let records;
    try {
      const input = readInput(args);
      const meta = {
        phase: args.phase || defaultPhase() || null,
        card: args.card || null, role: args.role || null, model: args.model || null,
        mode: args.mode || 'sync', kind: args.kind || 'api_call',
      };
      const costOverride = args.cost === undefined ? undefined : Number(args.cost);
      if (costOverride !== undefined && !Number.isFinite(costOverride)) throw new Error('--cost не число');
      const items = input ? (args.all ? expandResponses(input) : [{ raw: input, inferredId: args['call-id'] }]) : [{ raw: null, inferredId: args['call-id'] }];
      if (items.length > 1 && args['call-id']) throw new Error('с --all нельзя задавать один --call-id: используйте custom_id в batch');
      records = items.map(({ raw, inferredId }) => normalizeRecord({
        raw, meta, costOverride, callId: args['call-id'] || inferredId,
      }));
    } catch (err) { console.error(`[budget] запись не принята: ${err.message}`); return 1; }
    try {
      const { added, duplicates } = appendRecords(records);
      console.log(`[budget] записано ${added.length}, повторов ${duplicates}, сумма ${round(added.reduce((s, r) => s + r.cost_usd, 0))} USD`);
    } catch (err) { console.error(`[budget] ${err.message}`); return err.code || 3; }
    return 0;
  }

  if (cmd === 'check' || cmd === 'report') {
    let sum;
    try { sum = summarize(readLedger(), { phase: args.phase || defaultPhase() || null, cfg, add: cmd === 'check' ? Number(args.add || 0) : 0 }); }
    catch (err) { console.error(`[budget] ${err.message}`); return 3; }
    if (args.json) console.log(JSON.stringify(sum, null, 2));
    else if (cmd === 'check') {
      console.log(`[budget] фаза ${sum.phase}: ${sum.projected_usd} / ${sum.limit_usd} USD (${sum.calls} вызовов), остаток ${sum.remaining_usd}, уровень ${sum.level}`);
      if (sum.baseline_usd) console.log(`[budget] план фазы: ${sum.baseline_usd} USD; факт ${sum.spent_usd} USD`);
    } else {
      const table = (title, rows) => {
        console.log(`\n ${title}`);
        for (const r of rows) console.log(`   ${String(Object.values(r)[0]).padEnd(34)} ${String(r.calls).padStart(4)} вызов.  $${r.cost_usd.toFixed(4)}`);
      };
      console.log(` Фаза ${sum.phase}: $${sum.spent_usd} из $${sum.limit_usd} (уровень ${sum.level}), вызовов ${sum.calls}`);
      console.log(` Токены: input ${sum.tokens.prompt}, cached ${sum.tokens.cached} (${(sum.cached_share * 100).toFixed(1)}%), output ${sum.tokens.completion}`);
      console.log(` Комиссия пополнения: $${sum.topup_fee_usd}; план: $${sum.baseline_usd ?? '—'}; остаток $${sum.remaining_usd}`);
      table('По роли', sum.by_role); table('По модели', sum.by_model); table('По режиму', sum.by_mode);
      console.log(`\n Топ карточек`);
      for (const r of sum.by_card.slice(0, 8)) console.log(`   ${String(r.card).padEnd(34)} ${String(r.calls).padStart(4)} вызов.  $${r.cost_usd.toFixed(4)}`);
    }
    if (cmd === 'check' && sum.level === 'over') {
      console.error('[budget] СТОП: лимит фазы исчерпан. Выдача карточки запрещена.');
      return 2;
    }
    if (cmd === 'check' && sum.level !== 'ok') console.warn(`[budget] внимание: ${sum.level}`);
    return 0;
  }

  console.error(`[budget] неизвестная команда: ${cmd}`);
  usage();
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
