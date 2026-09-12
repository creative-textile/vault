import { useEffect, useState } from 'react';

/**
 * Летящий раунд ракеты — одно общее состояние на приложение.
 *
 * Раунд принадлежит серверу (`startRocketRound` тикает каждые 50 мс и сам гасит
 * раунд через `processCrash`), поэтому уход с экрана `/rocket` полёт не
 * останавливает. Но забрать выигрыш можно только командой `cashout` с `round_id`,
 * а кнопку раньше рисовал лишь экран ракеты: уведи игрока в мини-игру сейфа в
 * середине полёта — ставка сгорела бы без шанса.
 *
 * Поэтому состояние раунда вынесено сюда, и `RocketFlightBadge` рисует живой
 * множитель и кнопку «ЗАБРАТЬ» на любом экране. Сокет один на приложение и из
 * комнаты раунда он не выходит, так что тики продолжают приходить и после
 * размонтирования `Rocket.tsx`.
 */
export interface RocketFlight {
  roundId: number;
  /** Множитель, на котором раунд упадёт (клиент знает его с момента запуска). */
  crashAt: number;
  startedAt: number;
  /** Последний множитель из серверного тика. */
  multiplier: number;
}

let flight: RocketFlight | null = null;
const listeners = new Set<(f: RocketFlight | null) => void>();

function emit() {
  const current = flight;
  listeners.forEach(l => { try { l(current); } catch { /* подписчик не должен ронять полёт */ } });
}

export function setFlight(roundId: number, crashAt: number) {
  flight = { roundId, crashAt, startedAt: Date.now(), multiplier: 1 };
  emit();
}

export function setFlightMultiplier(multiplier: number) {
  if (!flight || !Number.isFinite(multiplier)) return;
  flight = { ...flight, multiplier };
  emit();
}

export function clearFlight() {
  if (!flight) return;
  flight = null;
  emit();
}

export function getFlight(): RocketFlight | null {
  return flight;
}

/**
 * Сммонтирован ли сейчас экран `/rocket`.
 *
 * Определяет, кто обрабатывает `cashout_result` и `crash`: сам экран (со своей
 * анимацией, попапом вклада в сейф и историей) или плавающий бейдж. Проверять
 * это по текущему пути нельзя — в момент перехода путь уже новый, а обработчик
 * события ещё старый, и результат кэшаута потерялся бы между двумя экранами.
 */
let rocketScreenActive = false;
export function setRocketScreenActive(active: boolean) { rocketScreenActive = active; }
export function isRocketScreenActive(): boolean { return rocketScreenActive; }

/**
 * Только факт полёта, без множителя: перерисовывает компонент лишь в моменты
 * старта и окончания раунда, а не 20 раз в секунду. Нужно экранам, которым
 * достаточно знать, что внизу появится бейдж (например, сделать запас
 * прокрутки, чтобы бейдж не перекрыл барабаны мини-игры взлома).
 */
export function useHasRocketFlight(): boolean {
  const [has, setHas] = useState<boolean>(!!flight);
  useEffect(() => {
    const listener = (next: RocketFlight | null) => setHas(!!next);
    listeners.add(listener);
    listener(flight);
    return () => { listeners.delete(listener); };
  }, []);
  return has;
}

/** Подписка из компонентов. Использует только бейдж — тики идут 20 раз в секунду. */
export function useRocketFlight(): RocketFlight | null {
  const [state, setState] = useState<RocketFlight | null>(flight);
  useEffect(() => {
    const listener = (next: RocketFlight | null) => setState(next);
    listeners.add(listener);
    listener(flight); // между рендером и подпиской раунд мог стартовать или закончиться
    return () => { listeners.delete(listener); };
  }, []);
  return state;
}
