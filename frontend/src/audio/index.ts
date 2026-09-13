/**
 * Публичный API звука: компоненты зовут `sfx.crash()`, а не работают с
 * AudioContext напрямую. Здесь же — единая точка, где звук и тактильный отклик
 * Telegram включаются парой (в Mini App вибрация даёт половину ощущения).
 */
import { audio } from './engine';

export type SfxName =
  | 'tap' | 'tapSoft' | 'chip' | 'key' | 'error' | 'confirm' | 'notify' | 'money'
  | 'betPlace' | 'ignite' | 'tickBlip' | 'cashout' | 'crash'
  | 'coinFlip' | 'coinLand' | 'sword'
  | 'drumTap' | 'drumLock' | 'drumMiss' | 'countdown' | 'vaultOpen' | 'deposit' | 'refund'
  | 'win' | 'bigWin' | 'lose' | 'neutral' | 'jackpot' | 'transition';

/**
 * Громкие события игры дублируются вибрацией: в Telegram WebView звук часто
 * выключен (беззвучный режим iOS), и только тактильность сообщает о выигрыше.
 */
export const sfx = {
  /* интерфейс */
  tap: () => { audio.haptic('light'); audio.tap(); },
  tapSoft: () => audio.tapSoft(),
  chip: () => audio.chip(),
  key: () => audio.key(),
  error: () => audio.error(),
  confirm: () => audio.confirm(),
  notify: () => audio.notify(),
  money: () => audio.money(),
  transition: () => audio.transition(),

  /* ракета */
  betPlace: () => audio.betPlace(),
  ignite: () => audio.ignite(),
  engineStart: () => audio.engineStart(),
  engineUpdate: (mult: number) => audio.engineUpdate(mult),
  engineStop: () => audio.engineStop(),
  /** Тики множителя: движок сам решает, когда пора щёлкнуть (см. tickTracker). */
  tickBlip: (mult: number) => audio.tickBlip(mult),
  cashout: (mult?: number) => audio.cashout(mult),
  crash: () => audio.crash(),

  /* дуэль */
  coinFlip: () => audio.coinFlip(),
  coinLand: () => audio.coinLand(),
  sword: () => audio.sword(),

  /* сейф */
  drumsStart: () => audio.drumsStart(),
  drumsStop: () => audio.drumsStop(),
  drumTap: () => audio.drumTap(),
  drumLock: (i?: number) => audio.drumLock(i),
  drumMiss: () => audio.drumMiss(),
  countdown: (step: number) => audio.countdown(step),
  vaultOpen: () => audio.vaultOpen(),
  deposit: () => audio.deposit(),
  refund: () => audio.refund(),

  /* итоги */
  win: (big = false) => audio.win(big),
  bigWin: () => audio.win(true),
  lose: () => audio.lose(),
  neutral: () => audio.neutral(),
  jackpot: () => audio.jackpot(),

  /* служебное */
  haptic: (s: 'light' | 'medium' | 'heavy' | 'success' | 'error' | 'warning' = 'light') => audio.haptic(s),
  unlock: () => audio.unlock(),
  stopAll: () => audio.stopAllLoops(),
  get settings() { return audio.settings; },
  setMuted: (m: boolean) => audio.setMuted(m),
  setVolume: (v: number) => audio.setVolume(v),
  setHaptics: (on: boolean) => audio.setHaptics(on)
};

/**
 * Тиканье множителя в ракете: сервер шлёт тики 30 раз в секунду, и щёлкать на
 * каждый — значит превратить звук в пулемёт. Реальные crash-игры щёлкают
 * с интервалом, который укорачивается вместе с множителем (напряжение растёт).
 *
 *   1.00–1.50 → каждые 700 мс
 *   1.50–3.00 → каждые 420 мс
 *   3.00–10.0 → каждые 210 мс
 *   > 10      → каждые 120 мс
 */
export function createTickTracker() {
  let last = 0;
  return (multiplier: number, now = performance.now()) => {
    const interval =
      multiplier < 1.5 ? 700 :
      multiplier < 3 ? 420 :
      multiplier < 10 ? 210 : 120;
    if (now - last < interval) return false;
    last = now;
    sfx.tickBlip(multiplier);
    return true;
  };
}

export { audio };
export type { AudioSettings } from './engine';
