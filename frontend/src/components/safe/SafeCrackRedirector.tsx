import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { safeApi } from '../../api/client';
import { getSocket } from '../../api/socket';
import { useAuth } from '../../stores/auth';
import { onSafeEvent } from '../../utils/socketEvents';
import { tabStore, crackVisitedKey } from '../../utils/tabStore';
import { getFlight } from '../../utils/rocketFlight';

/**
 * Глобальный переход в мини-игру взлома — с ЛЮБОГО экрана приложения.
 *
 * Вклад в сейф вносится заранее, окно взлома короткое (по умолчанию 60 с),
 * поэтому когда таймер сбора истекает, игрок должен оказаться в мини-игре, где
 * бы он ни был: в главном меню, в `/rocket`, в `/duel`, в профиле. Никаких
 * промежуточных экранов с кнопкой «СОБРАТЬ КОД» на пути быть не должно.
 *
 * Как решаем, что пора:
 *  - socket-событие `safe_crack_started` — мгновенная реакция;
 *  - опрос `/api/safe/current`: раз в 10 с в спокойное время и раз в 1.5 с,
 *    когда взлом идёт или до него меньше двух минут (адаптивный интервал —
 *    чтобы не дёргать сервер впустую, но и не потерять событие при
 *    переподключении сокета);
 *  - возврат вкладки в видимое состояние.
 *
 * Условия перехода: сейф в статусе `cracking`, у игрока есть вклад в ЭТОМ
 * раунде (`my_deposit`), результат ещё не сдан, до конца окна больше 3 с, и в
 * этой вкладке раунд ещё не открывали (`vault:safe-crack-visited:<id>` в
 * sessionStorage — иначе игрока, который сам вышел из мини-игры внести вклад в
 * следующий сейф, дёргало бы обратно бесконечно).
 *
 * Что происходит с партией, из которой выдёргиваем:
 *  - **Ракета**: останавливаем за игрока — отправляем `cashout` по активному
 *    раунду. Кэшаут на текущем множителе в любом случае возвращает ставку с
 *    прибылью, игрок ничего не теряет, а ждать конца полёта нельзя: при кривой
 *    `exp(0.075·t)` полёт до x10 длится ~31 с, до x50 ~52 с, то есть дольше
 *    всего окна взлома. Раунд тикает и гасится на сервере, сокет один на
 *    приложение, поэтому команда уходит и обрабатывается с любого экрана
 *    (результат показывает `RocketFlightBadge`).
 *  - **Дуэль**: исход и деньги посчитаны сервером ещё в `acceptDuel`, экран
 *    лишь крутит монету — анимацию можно сбивать. Результат не теряется: он в
 *    БД, в истории дуэлей и в уведомлениях.
 *  - **Остальные экраны**: серверных операций, зависящих от присутствия
 *    экрана, нет.
 *
 * Переход делается `push`, поэтому «назад» возвращает игрока туда, откуда его
 * забрали. В фоновой вкладке не переходим: там `requestAnimationFrame`
 * остановлен, а серверные секунды идут — игрок потерял бы вклад, не увидев игру.
 *
 * Каждая ветка решения пишется в консоль (`[safe-crack]`): если перехода нет,
 * по F12 сразу видно почему.
 */

/** Меньше трёх секунд до конца окна — открывать мини-игру уже бессмысленно. */
const MIN_REMAINING_MS = 3000;
/** Интервал опроса в спокойное время и за две минуты до взлома / во время него. */
const POLL_IDLE_MS = 10000;
const POLL_HOT_MS = 1500;
const HOT_WINDOW_MS = 120000;

export default function SafeCrackRedirector() {
  const { user, showToast, refreshUser } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  // Зависим от id, а не от объекта user: он меняется на каждое обновление
  // баланса, и зависимости эффекта пересоздавались бы без нужды
  const userId = user?.id ?? null;

  const pathRef = useRef(loc.pathname);
  useEffect(() => { pathRef.current = loc.pathname; }, [loc.pathname]);

  const inFlightRef = useRef(false);
  const [pollMs, setPollMs] = useState(POLL_IDLE_MS);

  const go = useCallback((safeId: number) => {
    if (pathRef.current.startsWith('/safe/crack')) return;

    const flight = getFlight();
    tabStore.set(crackVisitedKey(safeId), '1');
    nav('/safe/crack');

    // Ракету останавливаем за игрока: кэшаут на текущем множителе возвращает
    // ставку с прибылью (при x1.00 — ровно ставку), игрок ничего не теряет, а
    // ждать конца полёта нельзя — он длится дольше окна взлома. Команду шлём
    // после перехода: экран ракеты к этому моменту размонтирован, поэтому
    // результат обрабатывает бейдж (тост, баланс, автовклад) и двойной
    // обработки не происходит.
    if (flight) {
      showToast(`🚀 Останавливаем ракету на x${(flight.multiplier || 1).toFixed(2)}…`);
      setTimeout(() => getSocket().emit('cashout', { round_id: flight.roundId }), 0);
    }
    // Баланс мог измениться (кэшаут, дуэль) — подтягиваем, не дожидаясь сокета
    refreshUser().catch(() => {});
  }, [nav, showToast, refreshUser]);

  const consider = useCallback(async (reason: string) => {
    if (!userId) return;
    if (pathRef.current.startsWith('/safe/crack')) return; // уже в мини-игре
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      console.info('[safe-crack] не переходим: вкладка в фоне');
      return;
    }
    if (inFlightRef.current) return; // предыдущий запрос ещё не вернулся

    inFlightRef.current = true;
    // Если запрос завис, флаг не должен блокировать переход до конца сессии
    const watchdog = window.setTimeout(() => { inFlightRef.current = false; }, 8000);
    try {
      const r: any = await safeApi.current();
      const safe = r?.safe;
      const deposit = r?.my_deposit;

      // Следующий опрос: горячий режим во время взлома и перед ним
      const toCrack = Number(r?.collecting_safe?.time_to_crack_ms ?? r?.safe?.time_to_crack_ms ?? NaN);
      const hot = safe?.status === 'cracking' || (Number.isFinite(toCrack) && toCrack < HOT_WINDOW_MS);
      setPollMs(hot ? POLL_HOT_MS : POLL_IDLE_MS);

      if (!safe || safe.status !== 'cracking') return;
      if (tabStore.get(crackVisitedKey(safe.id))) {
        console.info(`[safe-crack] ${reason}: раунд #${safe.id} в этой вкладке уже открывали — повторно не дёргаем`);
        return;
      }
      if (!deposit) {
        console.info(`[safe-crack] ${reason}: игрок не вносил вклад в сейф #${safe.id} — переход не нужен`);
        return;
      }
      if ((deposit.crack_time_ms ?? null) != null) {
        console.info(`[safe-crack] ${reason}: результат уже сдан (${deposit.crack_time_ms} мс)`);
        return;
      }
      const left = Number(safe.crack_remaining_ms ?? 0);
      if (left < MIN_REMAINING_MS) {
        console.info(`[safe-crack] ${reason}: окно закрывается (${left} мс) — открывать мини-игру поздно`);
        return;
      }
      console.info(`[safe-crack] ${reason}: уводим игрока в мини-игру сейфа #${safe.id}, окно ${Math.round(left / 1000)} с`);
      go(safe.id);
    } catch (e: any) {
      console.warn('[safe-crack] не смогли проверить состояние сейфа:', e?.message || e);
    } finally {
      window.clearTimeout(watchdog);
      inFlightRef.current = false;
    }
  }, [userId, go]);

  // 1. Сервер сообщил о старте взлома — реагируем мгновенно
  useEffect(() => onSafeEvent(({ type }) => {
    if (type === 'safe_crack_started') consider('socket safe_crack_started');
  }), [consider]);

  // 2. Опрос + возврат во вкладку. Страховка на случай потерянного события
  useEffect(() => {
    if (!userId) return;
    consider('вход в приложение');
    const iv = window.setInterval(() => consider('опрос'), pollMs);
    const onVis = () => { if (document.visibilityState === 'visible') consider('вернулись во вкладку'); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(iv);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [userId, pollMs, consider]);

  // 3. Перешли на другой экран — проверяем, не начался ли взлом, пока мы не видели
  useEffect(() => { consider(`переход на ${loc.pathname}`); }, [loc.pathname, consider]);

  return null;
}
