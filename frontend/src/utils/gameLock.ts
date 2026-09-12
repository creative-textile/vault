/**
 * «Занято партией» — короткий критический участок, во время которого игрока
 * нельзя уводить на другой экран, иначе партия сломается.
 *
 * Что сюда входит:
 *  - `rocket-start` — от нажатия «ЗАПУСТИТЬ» до ухода `rocket:launch`. Раунд уже
 *    создан в БД и ставка списана, но серверные тики ещё не стартовали: уведи
 *    игрока в этот момент — раунд зависнет навсегда (тик запускается клиентом).
 *  - `duel-flip` — бросок монеты (2.8 с) и первые полторы секунды результата.
 *    Исход к этому моменту уже посчитан сервером и деньги переведены, но человек
 *    должен увидеть, выиграл он или проиграл.
 *
 * Что сюда НЕ входит: сам полёт ракеты. При кривой `exp(0.075·t)` полёт до x10
 * длится ~31 с, до x50 — ~52 с, то есть дольше окна взлома сейфа (60 с). Ждать
 * его окончания — значит гарантированно лишить игрока вклада в сейфе, поэтому
 * игрока уводят сразу, а забрать выигрыш он может из любой точки приложения:
 * раунд тикает и гасится на сервере, а кнопка «ЗАБРАТЬ» живёт в RocketFlightBadge.
 *
 * Держателей может быть несколько (Set по ключу), повторный `acquire` с тем же
 * ключом идемпотентен, `release` чужого ключа ничего не ломает.
 */
type Listener = () => void;

const holders = new Set<string>();
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach(l => { try { l(); } catch { /* подписчик не должен ронять игру */ } });
}

/** Занять участок. Возвращает функцию, которая его освобождает. */
export function acquireGameLock(key: string): () => void {
  holders.add(key);
  emit();
  return () => releaseGameLock(key);
}

export function releaseGameLock(key: string) {
  if (holders.delete(key)) emit();
}

export function isGameLocked(): boolean {
  return holders.size > 0;
}

export function gameLockHolders(): string[] {
  return Array.from(holders);
}

export function onGameLockChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
