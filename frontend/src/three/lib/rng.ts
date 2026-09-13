/**
 * Детерминированный ГПСЧ для 3D-сцен.
 *
 * Звёзды, обломки, искры и пыль должны быть одинаковыми у всех игроков и при
 * повторе (replay_seed приходит с сервера), иначе реплей выглядел бы другим
 * раундом. Тот же алгоритм, что и раньше (FNV-1a + LCG), вынесен в общий модуль.
 */
export function createRng(seed: string | number) {
  let hash = 2166136261;
  const str = String(seed);
  for (let i = 0; i < str.length; i++) hash = Math.imul(hash ^ str.charCodeAt(i), 16777619);
  if (hash === 0) hash = 2166136261;

  /** Следующее значение [0, 1). */
  const rand = (): number => {
    hash = (Math.imul(hash, 1664525) + 1013904223) >>> 0;
    return hash / 0x100000000;
  };

  return {
    rand,
    /** [min, max) */
    range: (min: number, max: number): number => min + rand() * (max - min),
    /** Целое [min, max] */
    int: (min: number, max: number): number => Math.floor(min + rand() * (max - min + 1)),
    /** ±amplitude */
    spread: (amplitude: number): number => (rand() - 0.5) * 2 * amplitude,
    /** Случайная точка на сфере радиуса r */
    onSphere: (r: number): [number, number, number] => {
      const u = rand() * 2 - 1;
      const t = rand() * Math.PI * 2;
      const s = Math.sqrt(Math.max(0, 1 - u * u));
      return [r * s * Math.cos(t), r * u, r * s * Math.sin(t)];
    }
  };
}

export type Rng = ReturnType<typeof createRng>;

/** Плавный шум 1D (для дрожания пламени, мерцания света): сумма синусоид. */
export function fbm1(x: number): number {
  return (
    Math.sin(x * 1.0) * 0.5 +
    Math.sin(x * 2.31 + 1.7) * 0.28 +
    Math.sin(x * 4.77 + 3.1) * 0.15 +
    Math.sin(x * 9.13 + 5.3) * 0.07
  );
}

/** Ease-out cubic: объекты «влетают» и мягко останавливаются. */
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
/** Ease-in-out: для плавных перелётов камеры. */
export const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
/** Перелёт с отскоком (пружина) — для приземлений и появления объектов. */
export const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
