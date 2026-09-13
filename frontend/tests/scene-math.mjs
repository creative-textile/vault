/**
 * Тест математики 3D-анимаций (без WebGL, без React — только чистые функции).
 *
 * Зачем: от этих чисел зависит то, что игрок ВИДИТ как исход. Если бросок
 * монеты закончится не на той грани, которую сервер положил в `duels.result`,
 * игрок увидит «орёл» при серверной «решке» — это спор на деньги, а не
 * косметика. Поэтому формулы вынесены в `src/three/duel/flipMath.ts` и
 * проверяются здесь на каждом прогоне CI (`npm run test:scene`).
 *
 * Запуск: npm test  (esbuild собирает бандл в node_modules/.cache и запускает
 * его обычным node — работает на Node 20, который стоит в CI и в Dockerfile).
 */
import {
  FLIP_MS,
  normalizeTrajectory,
  totalRotation,
  faceAtRotation,
  sampleFlip
} from '../src/three/duel/flipMath.ts';
import {
  digitAt,
  drumPosition,
  drumAngle,
  angleForDigit,
  digitAtAngle,
  speedOf,
  normalizeCode,
  drumPlateTransform,
  SLOT,
  DEFAULT_SPEEDS
} from '../src/three/safe/drumMath.ts';
import * as THREE from 'three';

let passed = 0;
const failures = [];

function check(name, cond, detail = '') {
  if (cond) { passed++; return; }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

function near(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

/* ═════════════════════════ 1. ГРАНЬ МОНЕТЫ ═══════════════════════════════ */

// Ориентация граней: rotX ≡ 0 (mod 2π) → ОРЁЛ, rotX ≡ π (mod 2π) → РЕШКА
check('face: 0 → heads', faceAtRotation(0) === 'heads');
check('face: 2π → heads', faceAtRotation(Math.PI * 2) === 'heads');
check('face: 4π → heads', faceAtRotation(Math.PI * 4) === 'heads');
check('face: π → tails', faceAtRotation(Math.PI) === 'tails');
check('face: 3π → tails', faceAtRotation(Math.PI * 3) === 'tails');
check('face: −π → tails', faceAtRotation(-Math.PI) === 'tails');
check('face: −2π → heads', faceAtRotation(-Math.PI * 2) === 'heads');

// Серверная траектория (backend/src/utils/coinToss.ts генерирует именно такие)
const SERVER_TRAJS = [
  { rotation_speed: 8, height: 2.5, bounces: 2, final_angle: 0 },
  { rotation_speed: 8, height: 2.5, bounces: 2, final_angle: 180 },
  { rotation_speed: 6, height: 3.2, bounces: 1, final_angle: 42 },
  { rotation_speed: 12, height: 1.8, bounces: 3, final_angle: -90 },
  { rotation_speed: 3, height: 4.0, bounces: 0, final_angle: 720 }
];

// ГЛАВНОЕ: при p = 1 игрок видит ровно ту грань, что вернул сервер
for (const traj of SERVER_TRAJS) {
  for (const result of ['heads', 'tails']) {
    const f = sampleFlip(1, traj, result);
    check(
      `final face ${result} (rot=${traj.rotation_speed}, bounces=${traj.bounces})`,
      faceAtRotation(f.rotX) === result,
      `rotX=${f.rotX.toFixed(4)} → ${faceAtRotation(f.rotX)}`
    );
    check(`final face ${result}: бросок завершён`, f.done === true);
    check(`final face ${result}: монета на полу`, near(f.y, 0, 1e-12), `y=${f.y}`);
  }
}

// Полный оборот 2π·k возвращает ту же грань, +π переворачивает
for (const traj of SERVER_TRAJS) {
  const heads = totalRotation(traj, 'heads');
  const tails = totalRotation(traj, 'tails');
  check('totalRotation: решка = орёл + π', near(tails - heads, Math.PI, 1e-12));
  check('totalRotation: орёл кратен 2π', near(heads % (Math.PI * 2), 0, 1e-9));
  check('totalRotation: минимум два оборота', heads >= Math.PI * 4 - 1e-9);
}

/* ═════════════════════ 2. ТРАЕКТОРИЯ ПОЛЁТА ══════════════════════════════ */

for (const traj of SERVER_TRAJS) {
  const t = normalizeTrajectory(traj);
  let maxY = 0;
  let prevRotX = -Infinity;
  let monotonic = true;
  let allFinite = true;
  let nonNegative = true;
  const STEPS = 600;
  for (let i = 0; i <= STEPS; i++) {
    const p = i / STEPS;
    const f = sampleFlip(p, traj, 'heads');
    if (!Number.isFinite(f.y) || !Number.isFinite(f.rotX) || !Number.isFinite(f.rotZ)) allFinite = false;
    if (f.y < -1e-12) nonNegative = false;
    if (f.rotX < prevRotX - 1e-12) monotonic = false;
    prevRotX = f.rotX;
    maxY = Math.max(maxY, f.y);
  }
  const tag = `traj(rot=${traj.rotation_speed},h=${traj.height},b=${traj.bounces})`;
  check(`${tag}: все значения конечны`, allFinite);
  check(`${tag}: высота не уходит под пол`, nonNegative);
  check(`${tag}: вращение монотонно (без отмотки назад)`, monotonic);
  check(`${tag}: старт на полу`, near(sampleFlip(0, traj, 'heads').y, 0, 1e-12));
  // Пик основной дуги — ровно в её середине: 4·h·0.5·0.5 = h
  check(`${tag}: пик ≈ height`, near(maxY, t.height, t.height * 1e-6), `maxY=${maxY.toFixed(4)} h=${t.height}`);
}

// Отскоки затухают: ищем настоящие локальные максимумы (y[i-1] < y[i] > y[i+1])
{
  const traj = { rotation_speed: 8, height: 2.5, bounces: 3, final_angle: 0 };
  const N = 4000;
  const ys = [];
  for (let i = 0; i <= N; i++) ys.push(sampleFlip(i / N, traj, 'heads').y);
  const peaks = [];
  for (let i = 1; i < ys.length - 1; i++) {
    if (ys[i] > ys[i - 1] && ys[i] >= ys[i + 1]) peaks.push(ys[i]);
  }
  let decreasing = peaks.length >= 2;
  for (let i = 1; i < peaks.length; i++) if (peaks[i] >= peaks[i - 1]) decreasing = false;
  check('отскоки затухают', decreasing, `пики: ${peaks.map(v => v.toFixed(3)).join(', ')}`);
  check('пик основной дуги + заявленное число отскоков', peaks.length === 1 + 3,
    `получено ${peaks.length}: ${peaks.map(v => v.toFixed(3)).join(', ')}`);
  check('первый пик — основная дуга', near(peaks[0], traj.height, traj.height * 1e-6));
  check('последний отскок почти незаметен', peaks[peaks.length - 1] < traj.height * 0.05,
    peaks[peaks.length - 1].toFixed(4));
}

/* ═══════════════════ 3. УСТОЙЧИВОСТЬ К МУСОРУ В JSONB ═══════════════════ */

// coin_trajectory — JSONB из БД: может прийти чем угодно
const GARBAGE = [
  null, undefined, {},
  { rotation_speed: -5, height: -3, bounces: -2, final_angle: -1e9 },
  { rotation_speed: 1e9, height: 1e9, bounces: 1e9, final_angle: NaN },
  { rotation_speed: '8', height: '2.5', bounces: '2', final_angle: '0' },
  { rotation_speed: null, height: undefined, bounces: NaN, final_angle: Infinity }
];
for (const g of GARBAGE) {
  const t = normalizeTrajectory(g);
  const ok = Number.isFinite(t.rotation_speed) && Number.isFinite(t.height)
    && Number.isFinite(t.bounces) && Number.isFinite(t.final_angle)
    && t.rotation_speed >= 1 && t.height >= 0.4 && t.bounces >= 0 && t.bounces <= 3;
  check(`normalizeTrajectory(${JSON.stringify(g) ?? String(g)}) в допуске`, ok, JSON.stringify(t));

  for (const p of [0, 0.13, 0.5, 0.72, 0.9, 1, NaN, -1, 2]) {
    const f = sampleFlip(p, g, Math.random() < 0.5 ? 'heads' : 'tails');
    const finite = Number.isFinite(f.y) && Number.isFinite(f.rotX) && Number.isFinite(f.rotZ);
    check(`sampleFlip(p=${p}) конечен при мусорной траектории`, finite && f.y >= 0, JSON.stringify(f));
  }
}

// p вне [0,1] не должен ломать кадр (пропуск кадра, фоновая вкладка)
check('p = NaN обрабатывается как 0', sampleFlip(NaN, SERVER_TRAJS[0], 'heads').rotX === 0);
check('p = 2 обрабатывается как 1', sampleFlip(2, SERVER_TRAJS[0], 'heads').done === true);
check('p = −1 обрабатывается как 0', sampleFlip(-1, SERVER_TRAJS[0], 'heads').y === 0);

/* ══════════════════ 4. ДЕТЕРМИНИЗМ (ДЛЯ РЕПЛЕЯ ДУЭЛИ) ══════════════════ */

// /replay/duel/:id обязан показать бросок один в один — одинаковый p даёт
// одинаковый кадр, без накопления ошибки и без обращения к Math.random()
{
  const traj = SERVER_TRAJS[0];
  let same = true;
  for (let i = 0; i <= 300; i++) {
    const p = i / 300;
    const a = sampleFlip(p, traj, 'tails');
    const b = sampleFlip(p, traj, 'tails');
    if (a.y !== b.y || a.rotX !== b.rotX || a.rotZ !== b.rotZ) same = false;
  }
  check('бросок детерминирован (реплей совпадает)', same);
}

/* ══════════════════ 5. ДЛИТЕЛЬНОСТЬ СОВПАДАЕТ С ЭКРАНОМ ═════════════════ */

// DuelGame переключает фазу на 'result' ровно через 2800 мс. Если анимация
// длиннее — монета ещё в воздухе, когда появились цифры исхода.
check('FLIP_MS = 2800 (окно DuelGame)', FLIP_MS === 2800, String(FLIP_MS));
{
  // Бросок должен завершиться не позже окна экрана
  const doneAt = FLIP_MS; // p = 1 достигается ровно в FLIP_MS
  check('бросок укладывается в окно экрана', doneAt <= 2800);
}

/* ════════════════ 6. БАРАБАНЫ СЕЙФА: СИНХРОН 3D И DOM ══════════════════ */

// Цифра на 3D-барабане обязана совпадать с цифрой в DOM (SafeCrack.tsx) в ЛЮБОЙ
// момент времени: тап засчитывается по DOM, а игрок смотрит на картинку.
check('drum: барабан стоит при speed = 0', digitAt(5000, 0) === 0);
check('drum: старт с нуля', digitAt(0, 6) === 0);

const SPEEDS = [0.5, 1, 1.45, 1.55, 1.72, 1.9, 2, 3, 6, 9, 12];
for (const speed of SPEEDS) {
  let mismatch = -1;
  let outOfRange = false;
  // Одна цифра видна 1000/(speed·1.3) мс; берём шаг в 20 раз мельче
  const stepMs = Math.max(0.25, 1000 / (speed * 1.3) / 20);
  for (let ms = 0; ms <= 60_000; ms += stepMs) {
    const dom = digitAt(ms, speed);
    const three = digitAtAngle(drumAngle(drumPosition(ms, speed)));
    if (!(dom >= 0 && dom <= 9 && Number.isInteger(dom))) outOfRange = true;
    if (dom !== three) { mismatch = ms; break; }
  }
  check(`drum: 3D = DOM при speed ${speed}`, mismatch < 0, `расхождение на ${mismatch} мс`);
  check(`drum: цифра в диапазоне при speed ${speed}`, !outOfRange);
}

// Все десять цифр реально показываются за оборот (нет «мёртвых» плашек)
for (const speed of [1.55, 1.9, 3]) {
  const period = 10 / (speed * 0.0013);
  const seen = new Set();
  for (let ms = 0; ms < period; ms += 0.5) seen.add(digitAt(ms, speed));
  check(`drum: за оборот видны все 10 цифр (speed ${speed})`, seen.size === 10, `увидели ${seen.size}`);
}

// Остановка барабана: угол для цифры d показывает ровно d
for (let d = 0; d <= 9; d++) {
  check(`drum: angleForDigit(${d}) показывает ${d}`, digitAtAngle(angleForDigit(d)) === d);
}
// Угол периодичен с шагом 2π — полный оборот возвращает ту же цифру
check('drum: оборот на 2π ничего не меняет', digitAtAngle(angleForDigit(7) + Math.PI * 2) === 7);
check('drum: шаг плашки = 2π/10', near(SLOT, Math.PI / 5, 1e-12));
check('drum: соседние цифры различимы', digitAtAngle(angleForDigit(3) + SLOT) === 4);

// Скорости и код из ответа сервера (может прийти null/мусор)
check('drum: speedOf(null) → запасная', speedOf(null, 0) === DEFAULT_SPEEDS[0]);
check('drum: speedOf([]) → запасная', speedOf([], 2) === DEFAULT_SPEEDS[2]);
check('drum: speedOf([-1]) → запасная', speedOf([-1, -1, -1], 1) === DEFAULT_SPEEDS[1]);
check('drum: speedOf([0]) → запасная (ноль крутить не может)', speedOf([0, 0, 0], 0) === DEFAULT_SPEEDS[0]);
check('drum: speedOf(NaN) → запасная', speedOf([NaN, NaN, NaN], 0) === DEFAULT_SPEEDS[0]);
check('drum: speedOf(валидные) → свои', speedOf([2.5, 3.5, 4.5], 1) === 3.5);
check('drum: normalizeCode(null) → null', normalizeCode(null) === null);
check('drum: normalizeCode([1,2]) → null (нужно ровно три)', normalizeCode([1, 2]) === null);
check('drum: normalizeCode([1,2,3,4]) → null', normalizeCode([1, 2, 3, 4]) === null);
check('drum: normalizeCode([7,0,9])', JSON.stringify(normalizeCode([7, 0, 9])) === '[7,0,9]');
check('drum: normalizeCode([-5,99,2.7]) зажимает в 0..9', JSON.stringify(normalizeCode([-5, 99, 2.7])) === '[0,9,2]');

/* ══════════ 7. ГЕОМЕТРИЯ БАРАБАНА: настоящие THREE.Object3D ══════════════ */

// Формулы выше проверяют абстрактные углы. Но знак в расстановке плашек мог
// разойтись с формулой — и тогда 3D показывало бы соседнюю цифру при полностью
// зелёных тестах углов. Здесь барабан собирается так же, как в сцене
// (SafeCrackScene), проворачивается настоящей матрицей, и мы смотрим, какая
// плашка оказалась повёрнута нормалью к камере (+Z).
function buildDrum(radius) {
  const group = new THREE.Group();
  const plates = [];
  for (let d = 0; d < 10; d++) {
    const place = drumPlateTransform(d, radius);
    const plate = new THREE.Object3D();
    plate.position.set(...place.position);
    plate.rotation.x = place.rotationX;
    plate.userData.digit = d;
    group.add(plate);
    plates.push(plate);
  }
  return { group, plates };
}

/** Нормаль плашки в мировых координатах после поворота барабана. */
function plateNormal(group, plate) {
  group.updateMatrixWorld(true);
  const n = new THREE.Vector3(0, 0, 1);           // плоскость смотрит вдоль +Z
  n.transformDirection(plate.matrixWorld);
  return n;
}

/** Какая цифра смотрит в камеру: максимум проекции нормали на +Z. */
function digitFacingCamera(group, plates) {
  let best = -2, digit = -1;
  for (const p of plates) {
    const z = plateNormal(group, p).z;
    if (z > best) { best = z; digit = p.userData.digit; }
  }
  return { digit, facing: best };
}

for (const radius of [0.33, 1]) {
  const { group, plates } = buildDrum(radius);

  // Остановка на каждой цифре: в камеру должна смотреть именно она
  for (let d = 0; d <= 9; d++) {
    group.rotation.x = angleForDigit(d);
    const { digit, facing } = digitFacingCamera(group, plates);
    check(`geom: барабан R=${radius} на angleForDigit(${d}) показывает ${d}`,
      digit === d, `увидели ${digit}`);
    check(`geom: плашка ${d} почти точно в камеру (R=${radius})`,
      facing > 0.995, `cos = ${facing.toFixed(4)}`);
  }

  // Прокрутка в реальном времени: геометрия = DOM на каждом шаге
  for (const speed of [1.55, 1.9, 3]) {
    let mismatch = -1;
    for (let ms = 0; ms <= 40_000; ms += 7) {
      group.rotation.x = drumAngle(drumPosition(ms, speed));
      const { digit } = digitFacingCamera(group, plates);
      if (digit !== digitAt(ms, speed)) { mismatch = ms; break; }
    }
    check(`geom: 3D-барабан = DOM при speed ${speed} (R=${radius})`,
      mismatch < 0, `расхождение на ${mismatch} мс`);
  }

  // Плашки не наезжают друг на друга: расстояние между соседями ≈ хорда шага
  group.rotation.x = 0;
  group.updateMatrixWorld(true);
  const p0 = plates[0].getWorldPosition(new THREE.Vector3());
  const p1 = plates[1].getWorldPosition(new THREE.Vector3());
  const chord = 2 * radius * Math.sin(SLOT / 2);
  check(`geom: шаг плашек = хорде 2R·sin(π/10) (R=${radius})`,
    near(p0.distanceTo(p1), chord, 1e-9),
    `${p0.distanceTo(p1).toFixed(6)} vs ${chord.toFixed(6)}`);
  // Все плашки на поверхности барабана
  const onSurface = plates.every((pl) => near(pl.position.length(), radius, 1e-9));
  check(`geom: все плашки на радиусе R=${radius}`, onSurface);
}

// Направление прокрутки: следующая цифра приходит СВЕРХУ (уезжают вниз)
{
  const { group, plates } = buildDrum(0.33);
  group.rotation.x = angleForDigit(4);
  const n4 = plateNormal(group, plates[4]);
  const pos5 = plates[5].getWorldPosition(new THREE.Vector3());
  check('geom: следующая цифра (5) выше текущей (4) — приходит сверху',
    pos5.y > 0, `y = ${pos5.y.toFixed(4)}`);
  check('geom: текущая цифра смотрит в камеру', n4.z > 0.995, `z = ${n4.z.toFixed(4)}`);
  // Поворот на +SLOT приводит в камеру пятёрку
  group.rotation.x = angleForDigit(4) + SLOT;
  check('geom: поворот на +SLOT показывает следующую цифру',
    digitFacingCamera(group, plates).digit === 5);
}

/* ═══════════════════════════ ИТОГ ═══════════════════════════════════════ */

if (failures.length) {
  console.error(`\n❌ scene-math: ${failures.length} из ${passed + failures.length} проверок провалено`);
  for (const f of failures.slice(0, 40)) console.error(`   • ${f}`);
  if (failures.length > 40) console.error(`   … и ещё ${failures.length - 40}`);
  process.exit(1);
}
console.log(`✅ scene-math: ${passed} проверок пройдено (грань монеты, траектория, мусор в JSONB, детерминизм, барабаны)`);
