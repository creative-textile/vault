import { useEffect, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useNotifications, hasFreshDuelResults, Notification } from '../../stores/notifications';
import { useAuth } from '../../stores/auth';
import { useHasRocketFlight } from '../../utils/rocketFlight';
import { onNotificationEvent } from '../../utils/socketEvents';
import { holdBalance, releaseBalance } from '../../utils/balanceHold';
import { isDuelAccepting } from '../../utils/duelTransition';

/**
 * Результаты дуэлей — ОДНО модальное окно со списком.
 *
 * Дуэль решается на сервере в момент, когда соперник принимает вызов, а
 * создатель комнаты в это время может быть где угодно: на другой вкладке, в
 * другом экране или вообще не в приложении. Поэтому:
 *
 *  - источник списка — НЕПРОЧИТАННЫЕ уведомления `duel_result` из БД
 *    (user_notifications), а не localStorage вкладки: закрыл приложение,
 *    зашёл через три дня — окно появилось;
 *  - сервер досоздаёт такие уведомления при каждом запросе списка
 *    (ensureDuelResultNotifications), так что потерянное в момент accept
 *    уведомление всё равно догонит игрока;
 *  - открытых вызовов может быть до трёх, и принять их могут почти
 *    одновременно. Окно одно: результаты выстраиваются в список, а новый
 *    дописывается в уже висящее окно (стор перечитывается по socket-событию).
 *    Отдельные окна поверх друг друга или «по одному с счётчиком» здесь не
 *    годятся — игрок не понял бы, что результатов несколько;
 *  - у каждой строки свои кнопки: «▶ УЗНАТЬ РЕЗУЛЬТАТ» ведёт на /duel/:id,
 *    «✖ ЗАКРЫТЬ» гасит уведомление в БД, и оно больше не появляется ни на
 *    этом устройстве, ни на любом другом. Есть и «ЗАКРЫТЬ ВСЕ».
 *
 * **Исход окно не раскрывает**: ни словом («победа/поражение»), ни суммой, ни
 * цветом рамки, ни тем, что выпало. Иначе бросок монеты смотреть незачем —
 * игрок узнаёт всё на экране дуэли. Здесь только факт: ставка, соперник, время.
 * Фон глухой (`#05050c`, без полупрозрачности), чтобы не просвечивал экран с
 * балансом: цифра суммарная и выдаёт исход раньше броска. Сам баланс держится
 * прежним, пока в списке есть непросмотренный свежий результат, — по той же
 * причине: посмотрев одну дуэль из трёх, игрок по изменившейся цифре понял бы
 * исход двух остальных.
 *
 * Окно не показывается там, где отнимет у игрока деньги или время: на /safe
 * целиком (вклады, история раунда) и /safe/crack (тикает окно взлома, оверлей
 * = потерянный вклад), на /rocket и пока летит ракета (нужна кнопка «ЗАБРАТЬ»),
 * а также на самом экране дуэли — список всплывёт после возврата. На этих
 * денежных экранах баланс не замораживается: там игрок ставит и пополняет, и
 * неизменяющаяся цифра мешала бы сильнее, чем теоретический спойлер.
 */
export default function DuelResultModal() {
  const { notifications, fetchNotifications, markDuelAsRead } = useNotifications();
  const { refreshUser } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const rocketFlying = useHasRocketFlight();

  // Основной триггер — socket-событие `notification`: список перечитывается
  // сразу, и новый результат дописывается в окно в тот же момент, когда
  // соперник принял вызов. Опрос раз в 20 с — страховка на случай
  // оборвавшегося соединения.
  useEffect(() => {
    fetchNotifications();
    const iv = setInterval(fetchNotifications, 20_000);
    const off = onNotificationEvent(d => {
      if (d?.type !== 'duel_result') return;
      fetchNotifications();
      // Повтор через полторы секунды: событие могло прийти, пока предыдущий
      // запрос ещё шёл (в сторе защита от параллельных загрузок), — иначе
      // строка появилась бы только через 20 с.
      setTimeout(fetchNotifications, 1500);
    });

    // Фоновая вкладка — главный сценарий потери уведомления: браузер
    // замораживает таймеры, а сокет за это время может оборваться и
    // переподключиться уже без события. Перечитываем список, как только
    // игрок вернулся во вкладку.
    const onResume = () => {
      if (document.visibilityState === 'visible') fetchNotifications();
    };
    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('focus', onResume);

    return () => {
      clearInterval(iv);
      off();
      document.removeEventListener('visibilitychange', onResume);
      window.removeEventListener('focus', onResume);
    };
  }, [fetchNotifications]);

  // Дуэли, которые игрок в этой сессии уже закрыл или посмотрел. Страховка на
  // случай, если запрос «прочитано» до сервера не дошёл: опрос вернул бы
  // уведомление, и закрытая строка всплыла бы снова.
  const dismissed = useRef(new Set<number>());

  /** Непросмотренные результаты дуэлей: старые первыми, по одной строке на дуэль. */
  const queue = useMemo(() => {
    const seen = new Set<number>();
    return notifications
      .filter(n => n.type === 'duel_result' && !n.is_read
        && Number.isFinite(Number(n.data?.duel_id))
        && !dismissed.current.has(Number(n.data.duel_id)))
      .slice()
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .filter(n => {
        const id = Number(n.data.duel_id);
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
  }, [notifications]);

  const onReplay = /^\/duel\/\d+$/.test(loc.pathname);
  // Экраны, где игрок работает с деньгами: сейф (вклады, мини-игра взлома) и
  // ракета (ставка, кэшшаут). Там замороженная цифра вреднее спойлера: пополнил
  // сейф или забрал выигрыш — а баланс не изменился.
  const moneyScreen = rocketFlying
    || loc.pathname.startsWith('/safe')
    || loc.pathname.startsWith('/rocket');
  // Окно не показывается на денежных экранах и на самом экране дуэли —
  // список всплывёт после возврата.
  const blocked = moneyScreen || onReplay || isDuelAccepting();

  // Есть ли что прятать: непросмотренный СВЕЖИЙ результат. Старые дуэли уже
  // учтены в балансе, который игрок видел, — из-за них цифры не замораживаем.
  const freshPending = useMemo(() => hasFreshDuelResults(), [notifications]);

  // Пока есть свежий непросмотренный результат — держим баланс прежним и
  // продлеваем удержание (страховка 90 с не должна отпускать цифры у открытого
  // окна или посреди броска монеты). Отпускание — только явное: посмотрел или
  // закрыл последний результат.
  useEffect(() => {
    if (moneyScreen || !freshPending) return;
    holdBalance();
    const iv = setInterval(holdBalance, 30_000);
    return () => clearInterval(iv);
  }, [moneyScreen, freshPending]);

  // На денежных экранах баланс актуальный: окно там не показывается, а исход
  // дуэли игрок узнает в окне, которое всплывёт, как только он уйдёт оттуда.
  useEffect(() => {
    if (moneyScreen) releaseBalance();
  }, [moneyScreen]);

  if (!queue.length || blocked) return null;

  /** «Узнать результат»: гасим уведомление и ведём на страницу дуэли. Баланс
      здесь не отпускаем — это сделает экран дуэли в момент показа итога, и
      только если других непросмотренных результатов не осталось. */
  const watch = (duelId: number) => {
    dismissed.current.add(duelId);
    markDuelAsRead(duelId);
    nav(`/duel/${duelId}`);
  };

  /** «Закрыть»: уведомление отмечено прочитанным в БД — больше не появится.
      Игрок отказался смотреть бросок, поэтому, если других свежих результатов
      не осталось, баланс сразу становится актуальным. */
  const closeOne = (duelId: number) => {
    dismissed.current.add(duelId);
    markDuelAsRead(duelId);
    if (!hasFreshDuelResults(duelId)) {
      releaseBalance();
      refreshUser();
    }
  };

  const closeAll = () => {
    queue.forEach(n => {
      const id = Number(n.data.duel_id);
      dismissed.current.add(id);
      markDuelAsRead(id);
    });
    releaseBalance();
    refreshUser();
  };

  return (
    <div style={{
      // Фон глухой, без полупрозрачности: под окном может быть главная с
      // балансом в 48px, а суммарная цифра выдаёт исход непросмотренных дуэлей
      position: 'fixed', inset: 0, background: '#05050c',
      zIndex: 2500, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16
    }}>
      <div style={{
        background: '#12122a', borderRadius: 16, padding: 18, maxWidth: 400, width: '100%',
        border: '2px solid #ffd700', textAlign: 'center',
        maxHeight: '88vh', display: 'flex', flexDirection: 'column'
      }}>
        <div style={{ fontSize: 34, marginBottom: 2 }}>⚔️</div>

        <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 2 }}>
          {queue.length === 1 ? 'РЕЗУЛЬТАТ ДУЭЛИ' : `РЕЗУЛЬТАТЫ ДУЭЛЕЙ · ${queue.length}`}
        </div>

        {/* Исход не показываем: ни словом, ни суммой, ни цветом — только факт
            броска. Всё остальное игрок увидит на экране дуэли. */}
        <div className="text-dim" style={{ fontSize: 11, marginBottom: 12 }}>
          🪙 Монеты брошены. Исход — в броске, а не здесь.
        </div>

        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
          {queue.map((n: Notification) => {
            const duelId = Number(n.data.duel_id);
            const amount = Number(n.data.amount) || 0;
            const opponent = n.data.opponent_name || null;
            const finishedAt = n.data.finished_at
              ? new Date(n.data.finished_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })
              : null;
            return (
              <div key={`${n.id}-${duelId}`} style={{
                background: '#0d0d20', border: '1px solid #2a2a4a',
                borderRadius: 12, padding: 12, textAlign: 'left'
              }}>
                <div style={{ fontWeight: 900, fontSize: 15, marginBottom: 4 }}>
                  ДУЭЛЬ НА ${amount.toFixed(2)} СОСТОЯЛАСЬ
                </div>
                <div className="text-dim" style={{ fontSize: 12, marginBottom: 4 }}>
                  {n.message || (opponent ? `Соперник: ${opponent}` : 'Монета брошена')}
                </div>
                <div className="text-dim" style={{ fontSize: 11, marginBottom: 10 }}>
                  🪙 монета брошена{finishedAt ? ` · ${finishedAt} МСК` : ''}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-secondary"
                    style={{ flex: 1, padding: '10px 6px', fontSize: 13 }}
                    onClick={() => closeOne(duelId)}
                  >
                    ✖ ЗАКРЫТЬ
                  </button>
                  <button
                    className="btn"
                    style={{ flex: 2, padding: '10px 6px', fontSize: 13 }}
                    onClick={() => watch(duelId)}
                  >
                    ▶ УЗНАТЬ РЕЗУЛЬТАТ
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {queue.length > 1 && (
          <button className="btn btn-secondary" style={{ marginBottom: 8 }} onClick={closeAll}>
            ✖ ЗАКРЫТЬ ВСЕ ({queue.length})
          </button>
        )}

        <div className="text-dim" style={{ fontSize: 11 }}>
          «Закрыть» — не смотреть бросок, уведомление больше не появится.
          {freshPending ? ' Баланс обновится, когда закроете или просмотрите все результаты.' : ''}
        </div>
      </div>
    </div>
  );
}
