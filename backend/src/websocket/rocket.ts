import { Server, Socket } from 'socket.io';
import { getMultiplierAt, processCashout, processCrash } from '../services/rocket';
import { query } from '../db/pool';

interface ActiveRound {
  roundId: number;
  userId: number;
  startedAt: number;
  crashAt: number;
  cashedOut: boolean;
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
        socket.emit('cashout_result', result);
        if (result.result === 'win' && result.was_beautiful) {
          // Деньги уже выплачены, но редкий красивый полёт продолжается до
          // сохранённой финальной точки — replay воспроизведёт ту же шкалу.
          r.cashedOut = true;
          r.crashAt = result.crash_at;
          io.to(String(roundId)).emit('rocket:beautiful', {
            cashout_at: result.cashout_at, crash_at: result.crash_at
          });
        } else {
          clearInterval(r.interval);
          activeRounds.delete(roundId);
          io.to(String(roundId)).emit('crash', {
            crash_at: result.result === 'win' ? result.crash_at : parseFloat(res.rows[0].crash_at), cashed_out: result.result === 'win'
          });
        }
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

  const round = { roundId, userId, startedAt, crashAt, cashedOut: false, interval: null as any as NodeJS.Timeout };
  const interval = setInterval(() => {
    const elapsed = (Date.now() - startedAt) / 1000;
    const mult = getMultiplierAt(elapsed);

    io.to(String(roundId)).emit('tick', {
      multiplier: Math.round(mult * 100) / 100,
      elapsed
    });

    if (mult >= round.crashAt) {
      clearInterval(interval);
      activeRounds.delete(roundId);
      if (!round.cashedOut) processCrash(roundId);
      io.to(String(roundId)).emit('crash', { crash_at: round.crashAt, cashed_out: round.cashedOut });
    }
  }, 1000 / 30); // 30 server ticks/sec; client renders/interpolates at requestAnimationFrame (60 FPS)

  round.interval = interval;
  activeRounds.set(roundId, round);
  return startedAt;
}
