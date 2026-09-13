/**
 * Математика броска монеты — чистые функции, без Three.js и без React.
 *
 * Вынесено из сцены намеренно: от этих чисел зависит, увидит ли игрок ТУ грань,
 * которую сервер положил в `duels.result`. Ошибка здесь — не «кривая анимация»,
 * а показ чужого исхода (и спор на деньги). Чистые функции проверяются тестом
 * `tests/scene-math.mjs` на каждой сборке в CI.
 *
 * Все значения считаются от нормированного прогресса p ∈ [0, 1], поэтому
 * анимация не зависит от частоты кадров: прежняя версия прибавляла
 * `flipProgress += 0.015` каждый кадр и на 120 Гц прокручивала бросок вдвое
 * быстрее, чем на 60 Гц.
 */

export interface FlipTrajectory {
  /** Полных оборотов за бросок (сервер генерирует ~8). */
  rotation_speed: number;
  /** Высота основной дуги в единицах сцены. */
  height: number;
  /** Сколько отскоков после основной дуги (0–3). */
  bounces: number;
  /** Наклон вокруг своей оси в градусах — на грань не влияет. */
  final_angle: number;
}

export interface FlipSample {
  /** Высота над положением покоя (≥ 0). */
  y: number;
  /** Вращение вокруг X: определяет, какая грань смотрит в камеру. */
  rotX: number;
  /** Наклон вокруг Z (декоративный). */
  rotZ: number;
  /** Касание пола в этом кадре (для пыли, звука и вибрации). */
  impact: boolean;
  /** Бросок завершён. */
  done: boolean;
}

/** Окно броска на экране DuelGame (setTimeout 2800 мс). */
export const FLIP_MS = 2800;

/** Доля длительности, которую занимает основная дуга (остальное — отскоки). */
const MAIN_SHARE = 0.72;

/** Относительная высота каждого отскока от основной дуги. */
const HOP_SHARES = [0.2, 0.08, 0.03];

/** Защита от мусора в `coin_trajectory` (JSONB из БД может быть любым). */
export function normalizeTrajectory(t: Partial<FlipTrajectory> | null | undefined): FlipTrajectory {
  const num = (v: unknown, fallback: number, min: number, max: number): number => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };
  return {
    rotation_speed: num(t?.rotation_speed, 8, 1, 40),
    height: num(t?.height, 2.5, 0.4, 12),
    bounces: Math.round(num(t?.bounces, 2, 0, 3)),
    final_angle: num(t?.final_angle, 0, -360, 360)
  };
}

/**
 * Полный угол поворота за бросок.
 *
 * Грань монеты периодична с периодом 2π, поэтому любое целое число оборотов
 * возвращает ту же сторону, а +π переворачивает её. Отсюда:
 *   ОРЁЛ  (heads) → 2π·k
 *   РЕШКА (tails) → 2π·k + π
 * k берём из траектории, но не меньше двух оборотов — иначе бросок выглядит
 * как поворот картонки, а не как подброшенная монета.
 */
export function totalRotation(traj: FlipTrajectory, result: 'heads' | 'tails' | null | undefined): number {
  const spins = Math.max(2, Math.round(traj.rotation_speed));
  return Math.PI * 2 * spins + (result === 'tails' ? Math.PI : 0);
}

/**
 * Какая грань должна смотреть в камеру при данном угле вокруг X.
 * 0 (mod 2π) — ОРЁЛ, π (mod 2π) — РЕШКА. Используется тестом и сценой,
 * чтобы «ожидаемая сторона» вычислялась одним и тем же кодом.
 */
export function faceAtRotation(rotX: number): 'heads' | 'tails' {
  const twoPi = Math.PI * 2;
  // Приводим угол к [0, 2π)
  let a = rotX % twoPi;
  if (a < 0) a += twoPi;
  // Близко к π → решка; иначе орёл (включая 0 и 2π)
  return Math.abs(a - Math.PI) < Math.PI / 2 ? 'tails' : 'heads';
}

/** Замедление к концу броска: монета теряет угловой момент. */
function easeRotation(p: number): number {
  return 1 - Math.pow(1 - p, 3.1);
}

/**
 * Состояние броска в точке прогресса p ∈ [0, 1].
 * Детерминировано: одинаковые p и траектория дают одинаковый кадр — это и
 * позволяет реплею (`/replay/duel/:id`) показать бросок один в один.
 */
export function sampleFlip(
  p: number,
  rawTraj: Partial<FlipTrajectory> | null | undefined,
  result: 'heads' | 'tails' | null | undefined,
  prevImpact = false
): FlipSample {
  const t = normalizeTrajectory(rawTraj);
  const q = Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0;

  const total = totalRotation(t, result);
  const rotX = total * easeRotation(q);
  const rotZ = (t.final_angle * Math.PI) / 180 + q * Math.PI * 1.5;

  // Высота: основная парабола, затем затухающие отскоки
  let y = 0;
  let impact = false;
  if (q >= 1) {
    y = 0;
  } else if (q < MAIN_SHARE) {
    const u = q / MAIN_SHARE;
    y = 4 * t.height * u * (1 - u);
  } else {
    const hops = Math.max(1, t.bounces);
    const rest = (q - MAIN_SHARE) / (1 - MAIN_SHARE);
    const idx = Math.min(hops - 1, Math.floor(rest * hops));
    const local = rest * hops - idx;
    const share = HOP_SHARES[Math.min(HOP_SHARES.length - 1, idx)];
    y = 4 * t.height * share * local * (1 - local);
    // Касание пола в начале каждого отскока, кроме первого (там уже была дуга)
    if (local < 0.06 && idx > 0) impact = true;
    if (local > 0.94) impact = true;
  }

  // Касание фиксируем один раз: без этого пыль и звук срабатывали бы
  // на каждом кадре в окрестности нуля высоты
  const impactOnce = impact && !prevImpact;

  return { y: Math.max(0, y), rotX, rotZ, impact: impactOnce, done: q >= 1 };
}
