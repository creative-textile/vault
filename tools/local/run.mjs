#!/usr/bin/env node
/**
 * Локальный оркестратор: карточка из Git → бесплатные гейты → лимит бюджета →
 * один вызов OpenRouter → структурированный вердикт → журнал расходов → доска.
 *
 * Заменяет ScriptCat без браузера, Notion, Drive и маркеров CF_*:
 *   • задание — JSON карточек в tasks/, статусы там же;
 *   • результат — JSON по схеме (никакого «маркер в последней строке»);
 *   • повтор — тот же call_id, двойного списания нет;
 *   • неясность — status=need_master, а не тихий дефолт;
 *   • доказательство — два РАЗНЫХ локальных инструмента с rc и SHA.
 *
 *   node tools/local/run.mjs --card tasks/F1/V-1-1-K1.json --dry-run
 *   node tools/local/run.mjs --card tasks/F1/V-1-1-K1.json
 *   node tools/local/run.mjs --batch --role auditor
 *   node tools/local/run.mjs --collect <batch-id>
 *
 * Коды: 0 ок; 1 ошибка ввода/конфигурации; 2 бюджет/контекст; 3 сеть/API;
 * 4 вердикт не принят (нужен Мастер). Сеть и ключ нужны только в боевом режиме.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONFIG, LEDGER, appendRecords, defaultPhase, normalizeRecord, readConfig, readLedger, summarize,
} from './budget.mjs';
import { buildPack, listCards, loadConfig } from './context-pack.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../..');
const sha = (s) => createHash('sha256').update(String(s)).digest('hex');
const short = (s) => sha(s).slice(0, 16);

export const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['submitted', 'need_master'] },
    summary: { type: 'string' },
    changed_files: { type: 'array', items: { type: 'string' } },
    commands: {
      type: 'array',
      items: {
        type: 'object',
        properties: { cmd: { type: 'string' }, rc: { type: 'integer' }, sha: { type: 'string' } },
        required: ['cmd', 'rc'], additionalProperties: false,
      },
    },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        properties: { tool: { type: 'string' }, result_sha: { type: 'string' } },
        required: ['tool', 'result_sha'], additionalProperties: false,
      },
    },
    reason: { type: 'string' },
  },
  required: ['status', 'summary', 'changed_files', 'commands', 'evidence', 'reason'],
  additionalProperties: false,
};

/** Простой .env без зависимостей; переменные процесса имеют приоритет. */
export function loadEnv(root = ROOT) {
  const out = {};
  const p = resolve(root, '.env');
  if (existsSync(p)) {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return out;
}
export const envValue = (key, env) => process.env[key] || env?.[key] || '';

/** Сопоставление пути с шаблоном зоны: точное совпадение, префикс папки, * и **. */
export function matchPath(file, pattern) {
  if (pattern.endsWith('/')) return file.startsWith(pattern);
  if (pattern.startsWith('*.')) return file.endsWith(pattern.slice(1));
  if (pattern.includes('**')) {
    const re = new RegExp('^' + pattern.split('**').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
    return re.test(file);
  }
  return file === pattern || file.startsWith(pattern.replace(/\/$/, '') + '/');
}

/**
 * Пути, имеющие отношение к карточке: её zone + только те строки диффа,
 * которые в эту zone попадают. Глобальный `git diff` в миграционном коммите
 * содержит .env.example и CI — без фильтра любая карточка ложно уходила бы на
 * дорогую модель «деньги/доступы».
 */
export function relevantPaths(card, changedPaths = []) {
  const zones = (card.zone || []).map((z) => String(z).replace(/\\/g, '/'));
  const norm = (f) => String(f).replace(/\\/g, '/').replace(/^\.\//, '');
  const inZone = changedPaths.map(norm).filter((f) => zones.some((z) => matchPath(f, z)));
  return [...new Set([...zones, ...inZone])];
}

/** Выбор модели по путям карточки: Argon ≤4 за фазу, Flash там, где решает скрипт. */
export function resolveModel(card, { cfg, ledger = [], changedPaths = [], env = process.env } = {}) {
  const models = cfg.models;
  const criticalHit = cfg.routing.criticalPaths.some((p) => changedPaths.some((f) => matchPath(f, p)));
  if (criticalHit) {
    const criticalId = envValue(models.critical.env, env) || models.critical.alias;
    const used = ledger.filter((r) => r.phase === card.phase &&
      (r.model_key === 'critical' || (criticalId && r.model === criticalId))).length;
    if (used >= (models.critical.maxPerPhase || 4)) {
      throw Object.assign(new Error(`лимит Argon (${models.critical.maxPerPhase}) исчерпан в фазе ${card.phase}`), { code: 2 });
    }
    return { key: 'critical', ...models.critical, reason: `деньги/доступы/миграции: ${changedPaths.filter((f) => cfg.routing.criticalPaths.some((p) => matchPath(f, p))).join(', ')}` };
  }
  const scriptOnly = (card.oracle || []).length > 0 && (card.oracle || []).every((o) => o.cmd);
  const norm = (p) => p.replace(/\/\*\*.*$/, '/').replace(/\*\*.*$/, '').replace(/\/$/, '');
  const mechanical = (card.zone || []).length > 0 && (card.zone || []).every((z) =>
    cfg.routing.scriptDecidable.some((p) => {
      const a = norm(z), b = norm(p);
      return a === b || a.startsWith(b + '/') || (p.startsWith('*.') && z.endsWith(p.slice(1)));
    }));
  if (card.role === 'executor' && scriptOnly && mechanical) {
    return { key: 'flash', ...models.flash, reason: 'оракул полностью скриптовый, зона механическая' };
  }
  const key = card.model || 'executor';
  if (!models[key]) throw new Error(`неизвестная модель карточки: ${key}`);
  return { key, ...models[key], reason: 'по карточке' };
}

/** argv без оболочки: @py/@node/@root разворачиваются кросс-платформенно. */
export function expandArgv(argv, { root = ROOT, env = {} } = {}) {
  const py = envValue('VAULT_PYTHON', env) || (process.platform === 'win32' ? 'py' : 'python3');
  const pyArgs = process.platform === 'win32' && py === 'py' ? ['-3'] : [];
  const out = [];
  for (const a of argv) {
    if (a === '@py') out.push(py, ...pyArgs);
    else if (a === '@node') out.push(process.execPath);
    else out.push(a === '@root' ? root : a.replace('@root/', root + '/'));
  }
  return out;
}

/** Бесплатные локальные гейты до платного вызова. Проверки из карточки, не из манифеста. */
export function runGates(card, { root = ROOT, env = {} } = {}) {
  const results = [];
  for (const raw of card.gates || []) {
    const argv = Array.isArray(raw) ? raw : String(raw).split(/\s+/);
    const full = expandArgv(argv, { root, env });
    const proc = spawnSync(full[0], full.slice(1), { cwd: root, encoding: 'utf8', shell: false, timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
    const output = `${proc.stdout || ''}${proc.stderr || ''}`;
    results.push({
      cmd: argv.join(' '), rc: proc.status ?? 1, sha: short(output),
      signal: proc.signal || null, error: proc.error?.message || null,
      tail: output.slice(-400),
    });
    if ((proc.status ?? 1) !== 0) break;
  }
  return results;
}

export function changedPaths(root = ROOT) {
  const p = spawnSync('git', ['diff', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' });
  return (p.status === 0 ? p.stdout : '').split('\n').filter(Boolean);
}

function buildBody({ card, model, system, user, cfg }) {
  return {
    model: model.id,
    session_id: `${card.phase}/${card.id}`.slice(0, 256),
    temperature: cfg.temperature,
    max_tokens: cfg.maxOutputTokens,
    response_format: { type: 'json_schema', json_schema: { name: 'vault_card_result', strict: true, schema: RESULT_SCHEMA } },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };
}

function parseResult(content) {
  const text = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const r = JSON.parse(text);
  for (const k of RESULT_SCHEMA.required) if (!(k in r)) throw new Error(`нет поля ${k}`);
  if (!['submitted', 'need_master'].includes(r.status)) throw new Error(`недопустимый status: ${r.status}`);
  return r;
}

/** Два независимых замера: разные инструменты, у каждого свой SHA результата. */
function validateEvidence(r) {
  const tools = new Set((r.evidence || []).map((e) => e.tool));
  const shas = new Set((r.evidence || []).map((e) => e.result_sha));
  return tools.size >= 2 && shas.size >= 2 && (r.evidence || []).every((e) => /^[a-f0-9]{16,64}$/.test(e.result_sha));
}

function writeVerdict(card, { result, model, costUsd, tokens, gates, reason, root = ROOT }) {
  const dir = resolve(root, 'verdicts');
  mkdirSync(dir, { recursive: true });
  const verdict = {
    schema: 1, card: card.id, phase: card.phase, role: card.role,
    model: model.key, status: result.status, summary: result.summary, reason,
    cost_usd: costUsd, context_tokens: tokens,
    gates: gates.map((g) => ({ cmd: g.cmd, rc: g.rc, sha: g.sha })),
    changed_files: result.changed_files, commands: result.commands, evidence: result.evidence,
  };
  writeFileSync(resolve(dir, `${card.id}.json`), JSON.stringify(verdict, null, 2) + '\n', 'utf8');
  return verdict;
}

function updateCard(path, card, status) {
  writeFileSync(path, JSON.stringify({ ...card, status }, null, 2) + '\n', 'utf8');
}

/** Записать факт списания. Даже при сломанном ответе деньги уже потрачены. */
function recordCost({ raw, card, model, attempt, mode, root = ROOT }) {
  const rec = normalizeRecord({
    raw,
    meta: { phase: card.phase, card: card.id, role: card.role, model: model.id, model_key: model.key, mode },
    callId: `${card.id}/${card.role}/${attempt}`,
  });
  const { added } = appendRecords([rec], resolve(root, 'costs/ledger.jsonl'));
  return rec.cost_usd;
}

function attempts(ledger, card) {
  return ledger.filter((r) => r.card === card.id).length + 1;
}

async function api(path, { method = 'GET', body, key }) {
  const cfg = loadConfig();
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'X-Title': 'vault-local-dev',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 400) }; }
  if (!res.ok) throw Object.assign(new Error(`OpenRouter ${res.status}: ${json.error?.message || json.raw || 'без тела'}`), { code: 3 });
  return json;
}

async function runOne({ cardPath, dryRun, root = ROOT }) {
  const cfg = loadConfig();
  const budgetCfg = readConfig(resolve(root, 'costs/budget.json'));
  const env = loadEnv(root);
  const cardFile = resolve(root, cardPath);
  const card = JSON.parse(readFileSync(cardFile, 'utf8'));
  if (card.kind !== 'card') throw new Error(`это не карточка: ${cardPath}`);
  if (!['draft', 'ready', 'rework'].includes(card.status)) throw new Error(`статус ${card.status}: выдача запрещена`);

  const ledger = readLedger(resolve(root, 'costs/ledger.jsonl'));
  const diff = changedPaths(root);
  const relevant = relevantPaths(card, diff);
  const model = resolveModel(card, { cfg, ledger, changedPaths: relevant, env });
  model.id = envValue(model.env, env);
  const pack = buildPack(card, { root, cfg, write: !dryRun });
  const budget = summarize(ledger, { phase: card.phase || defaultPhase(root), cfg: budgetCfg, add: model.estimateUsd || 0 });
  if (budget.level === 'over') throw Object.assign(new Error(`бюджет фазы исчерпан: ${budget.projected_usd}/${budget.limit_usd} USD`), { code: 2 });

  const gates = dryRun ? [] : runGates(card, { root, env });
  const red = gates.find((g) => g.rc !== 0);
  if (red) throw Object.assign(new Error(`локальный гейт красный до платного вызова: ${red.cmd} rc=${red.rc}\n${red.tail}`), { code: 1 });

  const plan = {
    card: card.id, phase: card.phase, role: card.role, model: model.key, model_id: model.id || '(не задан)',
    model_reason: model.reason, mode: model.mode, estimate_usd: model.estimateUsd,
    budget: { spent: budget.spent_usd, projected: budget.projected_usd, limit: budget.limit_usd, level: budget.level },
    context_tokens: pack.tokens, system_hash: pack.systemHash,
    session_id: `${card.phase}/${card.id}`.slice(0, 256),
    gates: gates.map((g) => ({ cmd: g.cmd, rc: g.rc, sha: g.sha })),
    changed_paths: relevant.length,
  };
  if (dryRun) { console.log(JSON.stringify({ dry_run: true, ...plan }, null, 2)); return 0; }

  const key = envValue('OPENROUTER_API_KEY', env);
  if (!key) throw Object.assign(new Error('нет OPENROUTER_API_KEY (локальный .env)'), { code: 1 });
  if (!model.id) throw Object.assign(new Error(`нет ${model.env} — точный slug модели из openrouter.ai/models`), { code: 1 });

  const body = buildBody({ card, model, system: pack.system, user: pack.user, cfg });
  const attempt = attempts(ledger, card);
  let raw, result, reason = '';
  try {
    raw = await api('/chat/completions', { method: 'POST', body, key });
    result = parseResult(raw.choices?.[0]?.message?.content);
    if (result.status === 'submitted' && !validateEvidence(result)) {
      reason = 'нужны два независимых локальных замера (разные tool, разные result_sha)';
      result.status = 'need_master';
    }
  } catch (err) {
    reason = `ответ не разобран: ${err.message}`;
    result = { status: 'need_master', summary: 'Вызов оплачен, структурированного вердикта нет.', changed_files: [], commands: [], evidence: [], reason };
    if (err.code === 3) err.code = 3;
    if (!raw) throw err; // сетевая ошибка до ответа: денег нет, журнал не пишем
  }
  const costUsd = recordCost({ raw, card, model, attempt, mode: 'sync', root });
  const verdict = writeVerdict(card, { result, model, costUsd, tokens: pack.tokens, gates, reason, root });
  updateCard(cardFile, card, result.status === 'submitted' ? 'submitted' : 'blocked');
  console.log(JSON.stringify({ verdict: verdict.status, card: card.id, model: model.key, cost_usd: costUsd, reason }, null, 2));
  return result.status === 'submitted' ? 0 : 4;
}

async function submitBatch({ role, root = ROOT }) {
  const cfg = loadConfig();
  const env = loadEnv(root);
  const key = envValue('OPENROUTER_API_KEY', env);
  if (!key) throw Object.assign(new Error('нет OPENROUTER_API_KEY'), { code: 1 });
  const cards = listCards(root).filter(({ card }) => card.status === 'ready' && (role ? card.role === role : cfg.routing.batchRoles.includes(card.role)));
  if (!cards.length) { console.log('[batch] нет готовых карточек для батча'); return 0; }
  const ledger = readLedger(resolve(root, 'costs/ledger.jsonl'));
  const budgetCfg = readConfig(resolve(root, 'costs/budget.json'));
  const diff = changedPaths(root);
  const modelFor = (card) => resolveModel(card, { cfg, ledger, changedPaths: relevantPaths(card, diff), env });
  const first = modelFor(cards[0].card);
  const modelId = envValue(first.env, env);
  if (!modelId) throw Object.assign(new Error(`нет ${first.env}`), { code: 1 });
  const requests = [];
  const meta = [];
  for (const { path, card } of cards) {
    const m = modelFor(card);
    if (m.key !== first.key) throw Object.assign(new Error(`батч = одна модель: ${card.id} просит ${m.key}, батч ${first.key}`), { code: 1 });
    const pack = buildPack(card, { root, cfg });
    const gates = runGates(card, { root, env });
    const red = gates.find((g) => g.rc !== 0);
    if (red) throw Object.assign(new Error(`${card.id}: красный гейт ${red.cmd}`), { code: 1 });
    const budget = summarize(readLedger(resolve(root, 'costs/ledger.jsonl')), { phase: card.phase, cfg: budgetCfg, add: (m.estimateUsd || 0) / 2 });
    if (budget.level === 'over') throw Object.assign(new Error('батч выйдет за лимит фазы'), { code: 2 });
    const customId = `${card.id}/${card.role}`;
    requests.push({ custom_id: customId, body: buildBody({ card, model: { id: modelId }, system: pack.system, user: pack.user, cfg }) });
    meta.push({ custom_id: customId, card_path: path, card: card.id, phase: card.phase, role: card.role, gates, tokens: pack.tokens });
  }
  const res = await api('/batches', { method: 'POST', key, body: { endpoint: '/v1/chat/completions', model: modelId, requests } });
  const id = res.id;
  if (!id) throw Object.assign(new Error(`батч не принят: ${JSON.stringify(res).slice(0, 300)}`), { code: 3 });
  const dir = resolve(root, '.state/batch');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, `${id}.json`), JSON.stringify({ id, model: modelId, model_key: first.key, meta }, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ batch_id: id, status: res.status, requests: requests.length, model: first.key, note: 'результаты: run.mjs --collect <id>' }, null, 2));
  return 0;
}

async function collectBatch({ id, root = ROOT }) {
  const cfg = loadConfig();
  const env = loadEnv(root);
  const key = envValue('OPENROUTER_API_KEY', env);
  const statePath = resolve(root, '.state/batch', `${id}.json`);
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  const res = await api(`/batches/${id}`, { key });
  if (res.status !== 'completed') {
    console.log(JSON.stringify({ batch_id: id, status: res.status, request_counts: res.request_counts || null }, null, 2));
    return 0;
  }
  const byId = new Map((res.results || []).map((r) => [r.custom_id, r]));
  const ledger = readLedger(resolve(root, 'costs/ledger.jsonl'));
  const out = [];
  for (const m of state.meta) {
    const entry = byId.get(m.custom_id);
    if (!entry) { out.push({ card: m.card, status: 'missing' }); continue; }
    const raw = entry.response || entry;
    let result, reason = '';
    try {
      result = parseResult(raw.choices?.[0]?.message?.content);
      if (result.status === 'submitted' && !validateEvidence(result)) {
        reason = 'нужны два независимых замера'; result.status = 'need_master';
      }
    } catch (err) {
      result = { status: 'need_master', summary: 'Ответ батча не разобран.', changed_files: [], commands: [], evidence: [], reason: err.message };
      reason = err.message;
    }
    const cardFile = resolve(root, m.card_path);
    const card = JSON.parse(readFileSync(cardFile, 'utf8'));
    const model = { key: state.model_key, id: state.model };
    const costUsd = recordCost({ raw, card, model, attempt: attempts(ledger, card), mode: 'batch', root });
    writeVerdict(card, { result, model, costUsd, tokens: m.tokens, gates: m.gates, reason, root });
    updateCard(cardFile, card, result.status === 'submitted' ? 'submitted' : 'blocked');
    out.push({ card: card.id, status: result.status, cost_usd: costUsd, reason });
  }
  console.log(JSON.stringify({ batch_id: id, request_counts: res.request_counts || null, results: out }, null, 2));
  return 0;
}

export function main(argv = process.argv.slice(2)) {
  const val = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const flag = (n) => argv.includes(`--${n}`);
  const promise = (async () => {
    if (flag('collect')) return collectBatch({ id: val('collect') });
    if (flag('batch')) return submitBatch({ role: val('role') });
    const cardPath = val('card');
    if (!cardPath) { console.error('нужно --card <путь> | --batch --role <роль> | --collect <id>'); return 1; }
    return runOne({ cardPath, dryRun: flag('dry-run') });
  })();
  return promise;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }).catch((err) => {
    console.error(`[run] ${err.message}`);
    process.exitCode = err.code || 1;
  });
}
