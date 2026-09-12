/**
 * «Удержание» баланса: несколько секунд не показывать изменения цифр.
 *
 * Деньги в дуэли сервер двигает в момент принятия вызова — ДО броска монеты.
 * Если баланс обновить сразу, исход виден без анимации: цифра выросла на приз —
 * значит выиграл, уменьшилась на ставку — значит проиграл. Поэтому:
 *
 *  - игрок нажал «Принять» в лобби → баланс на удержании (иначе цифра в лобби
 *    и в шапке успевала измениться до перехода на экран дуэли);
 *  - соперник принял ваш вызов (пришло уведомление `duel_result`) → то же:
 *    экран дуэли ещё не открыт, а баланс на главной уже выдавал исход;
 *  - отпускается в момент показа результата (`DuelGame`) или когда игрок закрыл
 *    уведомление, не смотря реплей (`DuelResultModal`).
 *
 * Удержание короткое и с автоотпусканием: если что-то пошло не так (игрок
 * закрыл вкладку посреди анимации, ошибка загрузки), цифры не останутся
 * устаревшими навсегда.
 */

const AUTO_RELEASE_MS = 90_000;

let held = false;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

export function holdBalance() {
  held = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => releaseBalance(), AUTO_RELEASE_MS);
}

export function releaseBalance() {
  const wasHeld = held;
  held = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  // Слушатели (App) подтягивают свежий профиль: за время удержания баланс мог
  // измениться не только дуэлью, а сокет-события мы в это время пропускали
  if (wasHeld) listeners.forEach(fn => { try { fn(); } catch { /* не критично */ } });
}

export function isBalanceHeld(): boolean {
  return held;
}

/** Подписка на момент отпускания (возвращает функцию отписки). */
export function onBalanceReleased(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
