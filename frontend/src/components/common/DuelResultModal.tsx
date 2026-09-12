import { useEffect, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useNotifications } from '../../stores/notifications';
import { useAuth } from '../../stores/auth';
import { useHasRocketFlight } from '../../utils/rocketFlight';
import { onNotificationEvent } from '../../utils/socketEvents';
import { holdBalance, releaseBalance } from '../../utils/balanceHold';

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
 *  - две кнопки: «▶ УЗНАТЬ РЕЗУЛЬТАТ» ведёт на /duel/:id, «✖ ЗАКРЫТЬ» гасит
 *    уведомление в БД, и оно больше не появляется ни на этом устройстве,
 *    ни на любом другом.
 *
 * **Исход окно не раскрывает**: ни словом («победа/поражение»), ни суммой, ни
 * цветом рамки, ни тем, что выпало. Иначе бросок монеты смотреть незачем —
 * игрок узнаёт всё на экране дуэли. Здесь только факт: ставка, соперник, время.
 * Фон полностью непрозрачный, чтобы не просвечивал экран с балансом (цифра до
 * броска тоже выдаёт исход), а сам баланс держится старым (см. balanceHold).
 *
 * Окно не показывается там, где оно отнимет у игрока деньги или время:
 * на /safe (вклады, история раунда) и /safe/crack (тикает окно взлома), на
 * экране ракеты и во время летящей ракеты (нужен доступ к кнопке «ЗАБРАТЬ»),
 * а также на самом реплее — следующая дуэль всплывёт после возврата.
 */
export default function DuelResultModal() {
  const { notifications, fetchNotifications, markDuelAsRead } = useNotifications();
  const { refreshUser } = useAuth();
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
      if (d?.type !== 'duel_result') return;
      fetchNotifications();
      // Повтор через полторы секунды: событие могло прийти, пока предыдущий
      // запрос ещё шёл (в сторе защита от параллельных загрузок), — иначе
      // окно появилось бы только через 20 с.
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
  // Экраны, где окно показывать нельзя: сейф (сбор вкладов и мини-игра взлома —
  // там тикает окно и оверлей стоит игроку вклада), ракета (нужна кнопка
  // «ЗАБРАТЬ») и сам экран дуэли (следующая всплывёт после возврата).
  const blocked = rocketFlying
    || loc.pathname.startsWith('/safe')
    || loc.pathname.startsWith('/rocket')
    || onReplay;

  // Пока окно заблокировано, игрок не может ни посмотреть результат, ни закрыть
  // уведомление — продлеваем удержание баланса, иначе страховка по времени
  // вернула бы на экран свежие цифры посреди игры, а они исход и выдают.
  useEffect(() => {
    if (!queue.length || !blocked) return;
    holdBalance();
    const iv = setInterval(holdBalance, 30_000);
    return () => clearInterval(iv);
  }, [queue.length, blocked]);

  if (!current || blocked) return null;

  const duelId = Number(current.data.duel_id);
  const amount = Number(current.data.amount) || 0;
  const opponent = current.data.opponent_name || null;
  const finishedAt = current.data.finished_at
    ? new Date(current.data.finished_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })
    : null;
  const rest = queue.length - 1;

  /** «Узнать результат»: гасим уведомление и ведём на страницу дуэли. */
  const watch = () => {
    dismissed.current.add(duelId);
    markDuelAsRead(duelId);
    nav(`/duel/${duelId}`);
  };

  /** «Закрыть»: уведомление отмечено прочитанным в БД — больше не появится. */
  const close = () => {
    dismissed.current.add(duelId);
    markDuelAsRead(duelId);
    // Игрок отказался смотреть бросок — анимации не будет, значит баланс больше
    // нечего прятать: отпускаем удержание и показываем настоящие цифры
    releaseBalance();
    refreshUser();
  };

  return (
    <div style={{
      // Фон глухой, без полупрозрачности: под окном может быть главная с
      // крупным балансом, а цифра до броска монеты выдаёт исход
      position: 'fixed', inset: 0, background: '#05050c',
      zIndex: 2500, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 20
    }}>
      <div style={{
        background: '#12122a', borderRadius: 16, padding: 24, maxWidth: 380, width: '100%',
        border: '2px solid #ffd700', textAlign: 'center'
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
          {current.message || (opponent ? `Соперник: ${opponent}` : 'Монета брошена')}
        </div>

        {/* Исход не показываем: ни словом, ни суммой, ни цветом — только факт
            броска и его время. Всё остальное игрок увидит на экране дуэли. */}
        <div className="text-dim" style={{ fontSize: 12, marginBottom: 16 }}>
          🪙 монета брошена{finishedAt ? ` · ${finishedAt} МСК` : ''}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-secondary" onClick={close} style={{ flex: 1 }}>
            ✖ ЗАКРЫТЬ
          </button>
          <button className="btn" onClick={watch} style={{ flex: 2 }}>
            ▶ УЗНАТЬ РЕЗУЛЬТАТ
          </button>
        </div>

        <div className="text-dim" style={{ fontSize: 11, marginTop: 10 }}>
          «Закрыть» — не смотреть бросок, уведомление больше не появится.
          {rest > 0 ? ` Ждут просмотра: ещё ${rest}.` : ''}
        </div>
      </div>
    </div>
  );
}
