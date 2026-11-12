/**
 * 👁 ГЛАЗА АГЕНТА — кадры 3D-сцен в PNG, без GPU и без ручного участия.
 *
 * Зачем: агент «не видит» анимацию. Логи и числа проверяют математику, но не
 * проверяют, что на экране действительно что-то нарисовалось: чёрный кадр,
 * спрятавшаяся камера, лопнувший материал — по числам всё «в порядке».
 *
 * Решение: настоящий Chromium снимает страницу `/scenes.html` в N моментов
 * времени. Кадры складываются в `frames/` и уезжают артефактом CI. Агент
 * скачивает артефакт и СМОТРИТ файлы — то есть видит то же, что игрок.
 *
 * Где это работает: только там, где есть Chromium (CI на ubuntu-latest).
 * В песочнице агента браузера нет (закрыты deb-репозитории и CDN браузеров),
 * поэтому скрипт по умолчанию мягко выходит с кодом 0 и не ломает `npm test`.
 *
 * Запуск:  node tests/eyes/frames.mjs            # 12 кадров
 *          node tests/eyes/frames.mjs --frames 30 --zoom 2
 * Переменные: SCENES_URL — адрес превью (по умолчанию vite preview :4173).
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const num = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : def;
};
const FRAMES = num('frames', 12);       // сколько кадров снять
const SPAN_MS = num('span', 6000);      // на каком отрезке анимации
const ZOOM = num('zoom', 1);            // 2 = крупнее (детали материалов)
const OUT = process.env.FRAMES_DIR || 'frames';
const PORT = num('port', 4173);
const URL = process.env.SCENES_URL || `http://127.0.0.1:${PORT}/scenes.html`;
const OWN_SERVER = !process.env.SCENES_URL;

/** Путь к Chromium: сначала playwright, потом env, потом системный. */
async function findChrome(pw) {
  try {
    const p = pw.chromium.executablePath();
    if (p && existsSync(p)) return p;
  } catch { /* playwright не знает — пойдём дальше */ }
  for (const c of [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)) {
    if (existsSync(c)) return c;
  }
  return null;
}

/** Поднимаем `vite preview` и ждём, пока порт начнёт отвечать. */
async function startServer() {
  const child = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const log = [];
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push(String(d)));

  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`preview завершился: ${log.join('').slice(-400)}`);
    try {
      const res = await fetch(URL, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return child;
    } catch { /* ещё не поднялся */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill('SIGKILL');
  throw new Error(`preview не поднялся за 60 с: ${log.join('').slice(-400)}`);
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  let pw;
  try {
    pw = await import('playwright');
  } catch {
    try { pw = await import('playwright-core'); } catch { pw = null; }
  }
  if (!pw) {
    console.log('[eyes] playwright не установлен — кадры пропущены (это не ошибка)');
    return 0;
  }
  const { chromium } = pw;
  const execPath = await findChrome(pw);
  if (!execPath) {
    console.log('[eyes] Chromium не найден — кадры пропущены (это не ошибка)');
    return 0;
  }
  console.log('[eyes] Chromium:', execPath);

  let server = null;
  try {
    if (OWN_SERVER) {
      server = await startServer();
      console.log('[eyes] preview поднят на', URL);
    }
  } catch (e) {
    console.log('[eyes] сервер не поднялся —', e.message);
    return 1;
  }

  const browser = await chromium.launch({
    executablePath: execPath,
    args: [
      '--no-sandbox',
      // Без GPU WebGL рисует программный растеризатор SwiftShader.
      // Без этих флагов Chromium в CI отдаёт «WebGL not supported» и кадры пустые.
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-dev-shm-usage'
    ]
  });
  const page = await browser.newPage({
    viewport: { width: 900, height: 900 },
    deviceScaleFactor: 1
  });

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });

  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  // Ждём первый настоящий кадр: три.js ставит на канвас размеры после init.
  await page.waitForTimeout(1500);

  const webgl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    return gl ? gl.getParameter(gl.VERSION) : 'НЕТ';
  });
  console.log('[eyes] WebGL:', webgl);

  const interval = SPAN_MS / FRAMES;
  for (let i = 0; i < FRAMES; i++) {
    if (i > 0) await page.waitForTimeout(interval);
    const name = `frame-${String(i).padStart(3, '0')}.png`;
    await page.screenshot({
      path: path.join(OUT, name),
      clip: ZOOM > 1
        ? { x: 0, y: 0, width: 900 / ZOOM, height: 900 / ZOOM }
        : undefined
    });
  }
  await browser.close();
  if (server) server.kill('SIGKILL');

  await writeFile(
    path.join(OUT, 'report.json'),
    JSON.stringify({ url: URL, frames: FRAMES, spanMs: SPAN_MS, webgl, errors }, null, 2)
  );
  if (errors.length) {
    console.log(`[eyes] ошибки страницы (${errors.length}):`);
    for (const e of errors.slice(0, 5)) console.log('  -', e);
  }
  console.log(`[eyes] снято ${FRAMES} кадров в ${OUT}/`);
  // Пустой WebGL — это провал сборки: сцены не нарисуются у игрока тоже.
  return webgl === 'НЕТ' ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error('[eyes] сбой:', e?.message || e);
  process.exit(1);
});
