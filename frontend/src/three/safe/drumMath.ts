/**
 * Математика барабанов сейфа — чистые функции, общие для DOM и для 3D.
 *
 * Почему это вынесено в отдельный модуль: цифру кода игрок видит В ДВУХ МЕСТАХ
 * одновременно — на 3D-барабане сцены и в DOM-списке под ним. Тап засчитывается
 * по DOM-цифре. Если 3D покажет другую, игрок нажмёт «на семёрку», увидит
 * семёрку на картинке, а сервер засчитает промах по четвёрке. Поэтому и DOM
 * (SafeCrack.tsx), и сцена (SafeCrackScene.tsx) считают положение барабана
 * отсюда, а тест `tests/scene-math.mjs` проверяет формулы в CI.
 *
 * Формула скорости историческая и менять её нельзя: сервер генерирует
 * `drum_speeds` в тех же единицах (backend/src/services/safeService.ts), и у
 * всех игроков в один день барабаны идут синхронно по общему якорю времени.
 */

/** Запасные скорости — те же, что генерирует сервер. */
export const DEFAULT_SPEEDS = [1.55, 1.72, 1.9];

/**
 * Виртуальное положение барабана в «цифрах»: сколько цифр прокрутилось
 * с момента старта. Одна цифра видна `1000 / (speed × 1.3)` мс, то есть при
 * 1.55–1.90 это 385–500 мс — обычный игрок попадает примерно в 80% попыток.
 */
export function drumPosition(ms: number, speed: number): number {
  const m = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  const s = Number.isFinite(speed) ? Math.max(0, speed) : 0;
  return m * s * 0.0013;
}

/** Цифра, которую показывает барабан со скоростью `speed` спустя `ms` миллисекунд. */
export function digitAt(ms: number, speed: number): number {
  const v = drumPosition(ms, speed);
  if (v === 0) return 0;
  // floor от остатка: 0..9, причём цифра d видна всё время, пока v ∈ [d, d+1)
  const d = Math.floor(v % 10);
  return d < 0 ? 0 : d;
}

/** Скорость барабана i с откатом на запасную (сервер может прислать null/мусор). */
export function speedOf(speeds: number[] | null | undefined, i: number): number {
  const s = Array.isArray(speeds) ? Number(speeds[i]) : NaN;
  if (Number.isFinite(s) && s > 0) return s;
  return DEFAULT_SPEEDS[i] ?? DEFAULT_SPEEDS[0];
}

/**
 * Угол поворота барабана (радианы, вокруг его оси) для положения `v`.
 *
 * Плашки с цифрами стоят с шагом `SLOT = 2π/10`. Плашка `d` смотрит точно в
 * камеру при v = d + 0.5, то есть занимает всё окно v ∈ [d, d+1) — ровно как
 * `digitAt` показывает её всё это время. Без сдвига на полшага картинка
 * опережала бы DOM на полцифры: игрок тапал бы по одному, а видел другое.
 *
 * Знак «+» подобран так, чтобы цифры уходили ВНИЗ, а следующая приходила
 * сверху — как в настоящем слот-барабане.
 */
export const SLOT = (Math.PI * 2) / 10;

export function drumAngle(v: number): number {
  return (v - 0.5) * SLOT;
}

/**
 * Угол, при котором плашка цифры `d` стоит ровно по центру окна.
 *
 * `drumAngle` уже содержит сдвиг на полшага, поэтому здесь его второй раз
 * добавлять нельзя: (d + 0.5)·SLOT дал бы d + 1, и остановленный барабан
 * показывал бы соседнюю цифру. Середина окна v = d + 0.5 → угол d·SLOT.
 */
export function angleForDigit(d: number): number {
  const digit = Number.isFinite(d) ? Math.min(9, Math.max(0, Math.floor(d))) : 0;
  return digit * SLOT;
}

/**
 * Какой цифре соответствует угол. Обратная к `drumAngle` — используется
 * тестом, чтобы проверить «3D показывает то же, что DOM» без рендеринга.
 */
export function digitAtAngle(angle: number): number {
  const v = angle / SLOT + 0.5;
  let d = Math.floor(v % 10);
  if (d < 0) d += 10;
  return d;
}

/**
 * Где стоит плашка цифры `i` на барабане радиуса `radius`.
 *
 * Ось барабана — X, поэтому плашки раскладываются в плоскости YZ. Угол отсчёта
 * выбран так, чтобы нулевая плашка смотрела ровно в камеру (+Z) при нулевом
 * повороте барабана, а увеличение номера шло против часовой (цифры уезжают
 * вниз, следующая приходит сверху — как в настоящем слот-барабане).
 *
 * `rotationX` — поворот плоскости вокруг X: плоскость по умолчанию смотрит
 * вдоль +Z, а её нормаль должна стать радиальной (0, cos θ, sin θ).
 *
 * Функция общая для сцены и для теста `tests/scene-math.mjs`: тест проворачивает
 * настоящую THREE.Object3D и проверяет, что при `angleForDigit(d)` в камеру
 * смотрит именно плашка `d`. Без этого проверка была бы только над абстрактными
 * углами, а знак в расстановке плашек мог разойтись с формулой.
 */
export function drumPlateTransform(i: number, radius: number): {
  position: [number, number, number];
  rotationX: number;
} {
  const idx = Number.isFinite(i) ? ((Math.floor(i) % 10) + 10) % 10 : 0;
  const r = Number.isFinite(radius) && radius > 0 ? radius : 1;
  const theta = Math.PI / 2 - idx * SLOT;
  return {
    position: [0, Math.cos(theta) * r, Math.sin(theta) * r],
    rotationX: theta - Math.PI / 2
  };
}

/** Код сейфа из ответа сервера: ровно три цифры 0..9, иначе null. */
export function normalizeCode(code: unknown): [number, number, number] | null {
  if (!Array.isArray(code) || code.length !== 3) return null;
  const out = code.map((c) => {
    const n = Math.floor(Number(c));
    return Number.isFinite(n) ? Math.min(9, Math.max(0, n)) : 0;
  });
  return [out[0], out[1], out[2]];
}
