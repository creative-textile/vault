import { Server, Socket } from 'socket.io';
import { getMultiplierAt, processCashout, processCrash, claimRocketTick } from '../services/rocket';
import { query } from '../db/pool';

interface ActiveRound {
  roundId: number;
  userId: number;
  startedAt: number;
  crashAt: number;
  interval: NodeJS.Timeout;
}

const activeRounds = new Map<number, ActiveRound>();

export function registerRocketHandlers(io: Server) {
  io.on('connection', (socket: Socket) => {
    socket.on('rocket:join', (roundId: number) => {
      socket.join(String(roundId));
    });

    socket.on('cashout', async (data: { round_id: number }) => {
      const roundId = Number(data?.round_id);
      if (!Number.isInteger(roundId) || roundId <= 0) return;
      const userId = Number(socket.data.userId);
      if (!userId) return;

      const res = await query('SELECT user_id, crash_at FROM rocket_rounds WHERE id = $1', [roundId]);
      if (!res.rows.length) return socket.emit('error', { message: 'Раунд не найден' });
      // Проверить что текущий пользователь — владелец раунда
      if (Number(res.rows[0].user_id) !== userId) return socket.emit('error', { message: 'Не ваш раунд' });

      try {
        // Время полёта: локальный интервал, если раунд тикает на этом же
        // экземпляре, иначе серверный якорь из БД (`tick_started_at`).
        // Прежний код при отсутствии записи в activeRounds просто возвращался
        // без ответа — игрок нажимал «ЗАБРАТЬ» и не получал ничего, а раунд
        // продолжал лететь (на другом инстансе или после рестарта контейнера).
        const local = activeRounds.get(roundId);
        const elapsed = local ? (Date.now() - local.startedAt) / 1000 : undefined;
        const result = await processCashout(roundId, userId, elapsed);
        if (local) { clearInterval(local.interval); activeRounds.delete(roundId); }
        socket.emit('cashout_result', result);
        io.to(String(roundId)).emit('crash', {
          crash_at: result.result === 'win' ? result.crash_at : parseFloat(res.rows[0].crash_at)
        });
      } catch (e: any) {
        socket.emit('error', { message: e.message });
      }
    });

    socket.on('disconnect', () => {
      // Не останавливаем раунд — пользователь может переподключиться
    });
  });
}

/**
 * Запустить серверные тики раунда.
 *
 * Раунд сначала атомарно «занимается» в БД (`claimRocketTick`): если тики уже
 * идут на другом экземпляре backend или раунд завершён, функция вернёт null и
 * второй интервал не появится. Якорь `tick_started_at` пишется в БД, поэтому
 * кэшаут работает и на другом инстансе, а cron может дорасчитать зависшие раунды.
 */
export async function startRocketRound(io: Server, roundId: number, userId: number): Promise<number | null> {
  const claimed = await claimRocketTick(roundId, userId);
  if (!claimed) return null;
  const { crashAt, startedAt } = claimed;

  const interval = setInterval(() => {
    const elapsed = (Date.now() - startedAt) / 1000;
    const mult = getMultiplierAt(elapsed);

    io.to(String(roundId)).emit('tick', {
      multiplier: Math.round(mult * 100) / 100,
      elapsed
    });

    if (mult >= crashAt) {
      clearInterval(interval);
      activeRounds.delete(roundId);
      processCrash(roundId);
      io.to(String(roundId)).emit('crash', { crash_at: crashAt });
    }
  }, 1000 / 30); // 30 server ticks/sec; client renders/interpolates at requestAnimationFrame (60 FPS)

  activeRounds.set(roundId, { roundId, userId, startedAt, crashAt, interval });
  return startedAt;
}
