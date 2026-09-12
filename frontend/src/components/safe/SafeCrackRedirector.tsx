import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { safeApi } from '../../api/client';
import { useAuth } from '../../stores/auth';
import { onSafeEvent } from '../../utils/socketEvents';
import { tabStore, crackVisitedKey } from '../../utils/tabStore';
import { isGameLocked, onGameLockChange } from '../../utils/gameLock';

/**
 * Глобальный переход в мини-игру взлома.
 *
 * Игрока, который внёс вклад в сейф, уводит на `/safe/crack` **с любого экрана**
 * — из главного меню, из `/rocket`, из `/duel`, из профиля: вклад сделан, окно
 * взлома короткое (по умолчанию 60 с), и искать кнопку «СОБРАТЬ КОД» в этот
 * момент нельзя. Раньше переход жил в `Safe.tsx` и срабатывал, только если игрок
 * уже стоял на `/safe`.
 *
 * Три предохранителя, чтобы ничего не сломать:
 *  1. **Замок партии** (`gameLock`) — не уводим, пока идёт критический участок:
 *     старт ракеты (раунд создан, тики ещё не запущены) или бросок монеты в
 *     дуэли с показом результата. Как только участок отпущен — уходим, если окно
 *     ещё открыто. Сам полёт ракеты не блокирует переход: он длится до минуты,
 *     а забрать выигрыш можно из бейджа `RocketFlightBadge` на любом экране.
 *  2. **Один раз на раунд на вкладку** (`sessionStorage`, ключ
 *     `vault:safe-crack-visited:<id>`) — игрока не выдёргивает повторно, если он
 *     сам вышел из мини-игры вносить вклад в следующий сейф.
 *  3. **Только видимая вкладка** — в фоне `requestAnimationFrame` остановлен, а
 *     серверные секунды идут: открыв игру «в никуда», игрок потерял бы вклад.
 *     Вернулся во вкладку — переход сработает в этот момент.
 *
 * Переход делается `push`, а не `replace`: кнопка «назад» возвращает игрока
 * туда, откуда его забрали (в партию ракеты, в лобби дуэли).
 */

/** Меньше четырёх секунд до конца окна — открывать мини-игру уже бессмысленно. */
const MIN_REMAINING_MS = 4000;
/** Страховочный опрос, если socket-событие не дошло (переподключение, сон телефона). */
const SAFETY_POLL_MS = 10000;

export default function SafeCrackRedirector() {
  const { user, showToast } = useAuth();
  // Зависим от id, а не от объекта user: он меняется на каждое обновление
  // баланса (socket balance_updated), и consider пересоздавался бы — а с ним
  // перезапускались бы все триггеры и лишний раз дёргали /api/safe/current
  const userId = user?.id ?? null;
  const nav = useNavigate();
  const loc = useLocation();

  const pathRef = useRef(loc.pathname);
  useEffect(() => { pathRef.current = loc.pathname; }, [loc.pathname]);

  const checkingRef = useRef(false);
  const toastedForRef = useRef<number | null>(null);
  const [waitingFor, setWaitingFor] = useState<number | null>(null);
  const [locked, setLocked] = useState(() => isGameLocked());

  useEffect(() => onGameLockChange(() => setLocked(isGameLocked())), []);

  const go = useCallback((safeId: number) => {
    if (pathRef.current.startsWith('/safe/crack')) return;
    const key = crackVisitedKey(safeId);
    if (tabStore.get(key)) return;
    tabStore.set(key, '1');
    nav('/safe/crack');
  }, [nav]);

  const consider = useCallback(async () => {
    if (!userId || checkingRef.current) return;
    if (pathRef.current.startsWith('/safe/crack')) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

    checkingRef.current = true;
    let waiting: number | null = null;
    try {
      const r: any = await safeApi.current();
      const safe = r?.safe;
      const deposit = r?.my_deposit;
      // Взлом не идёт — нечего открывать
      if (!safe || safe.status !== 'cracking') return;
      // Игрок не участвует в этом раунде или уже сдал результат
      if (!deposit || (deposit.crack_time_ms ?? null) != null) return;
      // Окно почти закрыто: за оставшиеся секунды код всё равно не собрать
      if (Number(safe.crack_remaining_ms ?? 0) < MIN_REMAINING_MS) return;
      // В этом раунде игрока уже открывали (он мог выйти сам)
      if (tabStore.get(crackVisitedKey(safe.id))) return;
      // Идёт партия — подождём её окончания
      if (isGameLocked()) { waiting = safe.id; return; }
      go(safe.id);
    } catch {
      // Нет связи или токен протух — не переходим, попробуем на следующем тике
    } finally {
      checkingRef.current = false;
      setWaitingFor(waiting);
      if (waiting != null && toastedForRef.current !== waiting) {
        toastedForRef.current = waiting;
        showToast('🔒 Взлом сейфа начался — мини-игра откроется, как только закончится партия');
      }
    }
  }, [userId, go, showToast]);

  // Главный триггер: сервер сообщил, что взлом начался
  useEffect(() => onSafeEvent(({ type }) => {
    if (type === 'safe_crack_started') consider();
  }), [consider]);

  // Открыли приложение, перешли между экранами — проверяем текущее состояние
  useEffect(() => { consider(); }, [consider, loc.pathname]);

  // Вернулись во вкладку — если взлом ещё идёт, открываем мини-игру сейчас
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') consider(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [consider]);

  // Знаем время взлома наперёд — просыпаемся ровно к нему, а не опрашиваем впустую
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    safeApi.current().then((r: any) => {
      if (cancelled) return;
      const ms = Number(r?.collecting_safe?.time_to_crack_ms ?? r?.safe?.time_to_crack_ms ?? 0);
      if (ms > 0 && ms < 24 * 3600 * 1000) timer = setTimeout(consider, ms + 300);
    }).catch(() => {});
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [userId, consider]);

  // Страховка на случай потерянного socket-события
  useEffect(() => {
    const iv = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') consider();
    }, SAFETY_POLL_MS);
    return () => clearInterval(iv);
  }, [consider]);

  // Партия закончилась — сразу проверяем, не пора ли в мини-игру
  useEffect(() => {
    if (waitingFor == null) return;
    if (!locked) consider();
  }, [waitingFor, locked, consider]);

  return null;
}
