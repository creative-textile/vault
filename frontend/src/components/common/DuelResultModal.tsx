import { useEffect, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useNotifications } from '../../stores/notifications';
import { useHasRocketFlight } from '../../utils/rocketFlight';
import { onNotificationEvent } from '../../utils/socketEvents';

/**
 * Очередь результатов дуэлей — модальное окно.
 *
 * Дуэль решается на сервере в момент, когда соперник принимает вызов, и
 * создатель комнаты в это время может быть где угодно: на другой вкладке, в
 * другом экране или вообще не в приложении. Поэтому:
 *
 *  - источник очереди — НЕПРОЧИТАННЫЕ уведомления `duel_result` из БД
 *    (user_notifications), а не localStorage вкладки: закрыл приложение,
 *    зашёл через три дня — окно появилось;
 *  - сервер досоздаёт такие уведомления при каждом запросе списка
 *    (ensureDuelResultNotifications), так что потерянное в момент accept
 *    уведомление всё равно догонит игрока;
 *  - дуэлей может быть несколько (максимум 3 открытых вызова), поэтому окно
 *    показывает очередь по одной: закрыл или посмотрел одну — всплывает
 *    следующая, со счётчиком «2 из 3»;
 *  - две кнопки: «смотреть реплей» ведёт на /duel/:id, «закрыть» гасит
 *    уведомление в БД, и оно больше не появляется ни на этом устройстве,
 *    ни на любом другом.
 *
 * Окно не показывается там, где оно отнимет у игрока деньги или время:
 * в мини-игре взлома сейфа (тикает окно, оверлей = потерянный вклад), на
 * экране ракеты и во время летящей ракеты (нужен доступ к кнопке «ЗАБРАТЬ»),
 * а также на самом реплее — следующая дуэль всплывёт после возврата.
 */
export default function DuelResultModal() {
  const { notifications, fetchNotifications, markDuelAsRead } = useNotifications();
  const nav = useNavigate();
  const loc = useLocation();
  const rocketFlying = useHasRocketFlight();

  // Основной триггер — socket-событие `notification`: список перечитывается
  // сразу, и окно всплывает в тот же момент, когда соперник принял вызов.
  // Опрос раз в 20 с — страховка на случай оборвавшегося соединения.
  useEffect(() => {
    fetchNotifications();
    const iv = setInterval(fetchNotifications, 20_000);
    const off = onNotificationEvent(d => {
      if (d?.type === 'duel_result') fetchNotifications();
    });
    return () => { clearInterval(iv); off(); };
  }, [fetchNotifications]);

  // Дуэли, которые игрок в этой сессии уже закрыл или посмотрел. Страховка на
  // случай, если запрос «прочитано» до сервера не дошёл: опрос вернул бы
  // уведомление, и закрытое окно всплыло бы снова.
  const dismissed = useRef(new Set<number>());

  /** Непросмотренные результаты дуэлей: старые первыми, по одной на дуэль. */
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

  const current = queue[0];

  const onReplay = /^\/duel\/\d+$/.test(loc.pathname);
  const blocked = rocketFlying
    || loc.pathname.startsWith('/safe/crack')
    || loc.pathname.startsWith('/rocket')
    || onReplay;

  if (!current || blocked) return null;

  const duelId = Number(current.data.duel_id);
  const amount = Number(current.data.amount) || 0;
  const prize = Number(current.data.prize) || Math.round(amount * 2 * 0.9 * 100) / 100;
  const won = !!current.data.i_won;
  const coin = current.data.result === 'heads' ? 'ОРЁЛ' : current.data.result === 'tails' ? 'РЕШКА' : null;
  const opponent = current.data.opponent_name || null;
  const finishedAt = current.data.finished_at
    ? new Date(current.data.finished_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })
    : null;
  const rest = queue.length - 1;

  /** «Смотреть реплей»: гасим уведомление и ведём на страницу дуэли. */
  const watch = () => {
    dismissed.current.add(duelId);
    markDuelAsRead(duelId);
    nav(`/duel/${duelId}`);
  };

  /** «Закрыть»: уведомление отмечено прочитанным в БД — больше не появится. */
  const close = () => {
    dismissed.current.add(duelId);
    markDuelAsRead(duelId);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)',
      zIndex: 2500, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20
    }}>
      <div style={{
        background: '#12122a', borderRadius: 16, padding: 24, maxWidth: 380, width: '100%',
        border: `2px solid ${won ? '#ffd700' : '#8888aa'}`, textAlign: 'center'
      }}>
        <div style={{ fontSize: 44, marginBottom: 4 }}>⚔️</div>

        {queue.length > 1 && (
          <div className="text-dim" style={{ fontSize: 12, marginBottom: 6 }}>
            Уведомление 1 из {queue.length}
          </div>
        )}

        <div style={{ fontSize: 20, fontWeight: 900, marginBottom: 8 }}>
          ДУЭЛЬ НА ${amount.toFixed(2)} СОСТОЯЛАСЬ
        </div>

        <div className="text-dim" style={{ fontSize: 14, marginBottom: 12 }}>
          {current.message || (opponent ? `Соперник: ${opponent}` : 'Результат уже известен')}
        </div>

        <div style={{
          fontSize: 22, fontWeight: 900, marginBottom: 6,
          color: won ? '#22c55e' : '#ef4444'
        }}>
          {won ? `🏆 ПОБЕДА  +$${(prize - amount).toFixed(2)}` : `❌ ПОРАЖЕНИЕ  −$${amount.toFixed(2)}`}
        </div>

        <div className="text-dim" style={{ fontSize: 12, marginBottom: 16 }}>
          {coin ? `🪙 выпал${coin === 'РЕШКА' ? 'а' : ''} ${coin.toLowerCase()}` : '🪙 монета брошена'}
          {finishedAt ? ` · ${finishedAt} МСК` : ''}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-secondary" onClick={close} style={{ flex: 1 }}>
            ✖ ЗАКРЫТЬ
          </button>
          <button className="btn" onClick={watch} style={{ flex: 2 }}>
            ▶ СМОТРЕТЬ РЕПЛЕЙ
          </button>
        </div>

        <div className="text-dim" style={{ fontSize: 11, marginTop: 10 }}>
          «Закрыть» — уведомление больше не появится.
          {rest > 0 ? ` Ждут просмотра: ещё ${rest}.` : ''}
        </div>
      </div>
    </div>
  );
}
