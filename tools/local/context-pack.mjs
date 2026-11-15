#!/usr/bin/env node
/**
 * Контекст-пак карточки: единственное, что попадает в платный промпт.
 *
 * Зачем: в старом контуре задание упиралось в 7500 ЗНАКОВ чата Arena и поэтому
 * резалось/паузилось. При API считают токены и деньги. Большие документы
 * (ARCHITECTURE.md 168 КБ, README.md 62 КБ, бывший DECISIONS.md 550 КБ) в пак
 * не попадают НИКОГДА: только system-prefix (docs/PROCESS.md, одинаковый для
 * всех карточек → кэш провайдера) + явно перечисленные scope-файлы + нарезки
 * ADR. Превышение лимита — явная ошибка с разбивкой по секциям, а не тихая
 * обрезка (тот же инвариант, что D-034, но в токенах).
 *
 *   node tools/local/context-pack.mjs --card tasks/F1/V-1-1-K1.json --json
 *   node tools/local/context-pack.mjs --check        # все карточки сразу (CI)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../..');
export const TASKS = resolve(ROOT, 'tasks');
export const STATE = resolve(ROOT, '.state/context');

/** Консервативная оценка: кириллица токенизируется дороже латиницы. */
export function estimateTokens(text) {
  if (!text) return 0;
  const cyr = (text.match(/[\u0400-\u04FF]/g) || []).length;
  const latin = text.length - cyr;
  return Math.ceil(cyr / 1.8 + latin / 3.6);
}

export function loadConfig() {
  return JSON.parse(readFileSync(resolve(HERE, 'models.json'), 'utf8'));
}

export function listCards(root = ROOT) {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (extname(p) === '.json') {
        const data = JSON.parse(readFileSync(p, 'utf8'));
        if (data.kind === 'card') out.push({ path: p, card: data });
      }
    }
  };
  walk(resolve(root, 'tasks'));
  return out.sort((a, b) => a.card.id.localeCompare(b.card.id));
}

const cap = (text, maxBytes, label) => {
  if (text.length * 2 <= maxBytes) return text;
  return text.slice(0, Math.floor(maxBytes / 2)) + `\n… [${label}: файл обрезан по лимиту ${maxBytes} байт; откройте точечно]`;
};

/**
 * Собрать пак. Возвращает { system, user, tokens, sections, systemHash }.
 * system — байт-в-байт одинаков для всех карточек (обязательное условие кэша).
 */
export function buildPack(card, { root = ROOT, cfg = loadConfig(), write = true } = {}) {
  const sections = [];
  const add = (name, text) => {
    if (!text) return;
    sections.push({ name, chars: text.length, tokens: estimateTokens(text) });
    return `### ${name}\n${text}`;
  };

  const systemPath = resolve(root, cfg.systemPrefix);
  if (!existsSync(systemPath)) throw new Error(`нет system-prefix: ${cfg.systemPrefix}`);
  const system = readFileSync(systemPath, 'utf8');
  const systemHash = createHash('sha256').update(system).digest('hex').slice(0, 16);

  const parts = [];
  parts.push(add('Карточка', '```json\n' + JSON.stringify({
    id: card.id, phase: card.phase, mission: card.mission, title: card.title,
    role: card.role, model: card.model, mode: card.mode, zone: card.zone,
    oracle: card.oracle, invariants: card.invariants, acceptance: card.acceptance,
    dependsOn: card.dependsOn, status: card.status,
  }, null, 2) + '\n```'));

  const fileParts = [];
  for (const rel of card.contextFiles || []) {
    const p = resolve(root, rel);
    if (!existsSync(p)) throw new Error(`contextFiles: нет файла ${rel}`);
    const raw = readFileSync(p, 'utf8');
    if (raw.length * 2 > 200000) {
      throw new Error(`contextFiles: ${rel} слишком большой (${raw.length} симв.) — нарежьте его и укажите секцию`);
    }
    fileParts.push(`#### ${rel}\n${cap(raw, 24000, rel)}`);
  }
  if (fileParts.length) parts.push(add('Файлы scope', fileParts.join('\n\n')));

  const adrParts = [];
  for (const id of card.decisions || []) {
    const p = resolve(root, 'decisions', `${id}.md`);
    if (!existsSync(p)) throw new Error(`решение не найдено: decisions/${id}.md`);
    adrParts.push(`#### ${id}\n${cap(readFileSync(p, 'utf8'), 8000, id)}`);
  }
  if (adrParts.length) parts.push(add('Решения (нарезки ADR)', adrParts.join('\n\n')));

  parts.push(add('Формат ответа', [
    'Верни строго JSON по схеме: status (submitted|need_master), summary,',
    'changed_files[], commands[{cmd,rc,sha}], evidence[{tool,result_sha}], reason.',
    'Два независимых замера = два РАЗНЫХ локальных инструмента с rc и SHA;',
    '«модель перепроверила себя» evidence не считается. Маркеров и свободного',
    'текста вне JSON не пиши. Неясность → status=need_master с причиной.',
  ].join('\n')));

  const user = parts.filter(Boolean).join('\n\n');
  const tokens = estimateTokens(system) + estimateTokens(user);
  if (tokens > cfg.contextLimitTokens) {
    const top = [...sections].sort((a, b) => b.tokens - a.tokens).slice(0, 5)
      .map((s) => `${s.name}: ${s.tokens}`).join(', ');
    throw Object.assign(new Error(
      `контекст-пак ${card.id}: ${tokens} > ${cfg.contextLimitTokens} токенов. Топ секций: ${top}. ` +
      `Уменьши contextFiles/decisions, не поднимай лимит.`,
    ), { code: 2, sections });
  }

  if (write) {
    mkdirSync(resolve(root, '.state/context'), { recursive: true });
    writeFileSync(resolve(root, '.state/context', `${card.id}.md`),
      `# SYSTEM (хеш ${systemHash})\n\n${system}\n\n---\n\n# USER\n\n${user}\n`, 'utf8');
  }
  return { system, user, tokens, sections, systemHash, systemTokens: estimateTokens(system) };
}

export function main(argv = process.argv.slice(2)) {
  const args = argv;
  const flag = (n) => args.includes(`--${n}`);
  const val = (n, def) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : def; };
  const cfg = loadConfig();
  const cards = flag('check') ? listCards(ROOT) : [{ path: val('card'), card: JSON.parse(readFileSync(resolve(ROOT, val('card')), 'utf8')) }];
  const results = [];
  let failed = false;
  for (const { path, card } of cards) {
    try {
      const pack = buildPack(card, { cfg, write: !flag('no-write') });
      results.push({ card: card.id, tokens: pack.tokens, systemTokens: pack.systemTokens, systemHash: pack.systemHash, sections: pack.sections });
    } catch (err) {
      failed = true;
      results.push({ card: card.id, error: err.message, sections: err.sections || [] });
    }
  }
  if (flag('json') || flag('check')) console.log(JSON.stringify(results, null, 2));
  else {
    for (const r of results) {
      console.log(r.error ? `[pack] ${r.card}: ОШИБКА ${r.error}` : `[pack] ${r.card}: ~${r.tokens} токенов (system ${r.systemTokens}, кэш ${r.systemHash})`);
    }
  }
  if (flag('check')) console.log(`[pack] карточек ${results.length}, лимит ${cfg.contextLimitTokens} токенов, ошибок ${results.filter((r) => r.error).length}`);
  return failed ? 2 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
