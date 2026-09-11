import { Server, Socket } from 'socket.io';
import { getMultiplierAt, processCashout, processCrash } from '../services/rocket';
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
      const roundId = data?.round_id;
      if (!roundId) return;
      const r = activeRounds.get(roundId);
      if (!r) return;

      const res = await query('SELECT user_id, crash_at FROM rocket_rounds WHERE id = $1', [roundId]);
      if (!res.rows.length) return;
      const userId = res.rows[0].user_id;
      // Проверить что текущий пользователь — владелец раунда
      if (socket.data.userId !== userId) return;

      try {
        const elapsed = (Date.now() - r.startedAt) / 1000;
        const result = await processCashout(roundId, userId, elapsed);
        clearInterval(r.interval);
        activeRounds.delete(roundId);
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

export function startRocketRound(io: Server, roundId: number, userId: number, crashAt: number) {
  const startedAt = Date.now();

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
  }, 50); // 20 FPS

  activeRounds.set(roundId, { roundId, userId, startedAt, crashAt, interval });
  return startedAt;
}
