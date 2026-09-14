import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getSocket } from '../../api/socket';
import { safeApi } from '../../api/client';
import { useAuth } from '../../stores/auth';
import Icon from '../ui/Icon';
import {
  useRocketFlight, getFlight, setFlightMultiplier, clearFlight, isRocketScreenActive
} from '../../utils/rocketFlight';

/**
 * Летящая ракета на любом экране.
 *
 * Игрока может выдернуть в мини-игру взлома сейфа прямо в середине полёта (полёт
 * длится до минуты — дольше окна взлома, ждать его окончания нельзя). Раунд при
 * этом тикает и гасится на сервере, но команда `cashout` уходила только с экрана
 * `/rocket`: без этого бейджа ставка сгорела бы без шанса забрать выигрыш.
 *
 * Сокет в приложении один, из комнаты раунда он не выходит, поэтому тики и
 * `cashout_result` приходят и после размонтирования `Rocket.tsx`. На самом
 * `/rocket` бейдж не показывается: экран восстанавливает раунд по
 * `getFlight()` и рисует свой интерфейс с кнопкой «ЗАБРАТЬ».
 */
export default function RocketFlightBadge() {
  const flight = useRocketFlight();
  const loc = useLocation();
  const { user, refreshUser, showToast } = useAuth();
  const [cashing, setCashing] = useState(false);

  // `cashout_result` и `crash` приходят друг за другом (сервер шлёт `crash` в
  // комнату раунда и после успешного кэшаута) — не показываем «упала» следом за «забрал»
  const cashedAtRef = useRef(0);
  const autoPctRef = useRef(0);
  useEffect(() => { autoPctRef.current = Number(user?.auto_safe_percent) || 0; }, [user?.auto_safe_percent]);

  useEffect(() => {
    const sock = getSocket();

    const onTick = (data: any) => {
      if (typeof data?.multiplier === 'number') setFlightMultiplier(data.multiplier);
    };

    const onCrash = () => {
      const f = getFlight();
      clearFlight();
      if (!f) return;
      if (Date.now() - cashedAtRef.current < 2000) return; // это не падение, а конец раунда после кэшаута
      if (isRocketScreenActive()) return; // там свой экран «РАКЕТА УПАЛА»
      showToast(`Ракета упала на x${(f.multiplier || 1).toFixed(2)} — ставка сгорела`);
    };

    const onCashout = async (res: any) => {
      cashedAtRef.current = Date.now();
      const wasHere = !!getFlight();
      clearFlight();
      if (isRocketScreenActive()) return; // там результат обрабатывает экран ракеты
      if (!wasHere) return;
      if (res?.result !== 'win') {
        // Сервер ответил too_late: раунд уже упал, забрать не успели
        if (res?.result === 'too_late') showToast('Ракета упала — забрать выигрыш не успели');
        return;
      }

      const profit = Number(res.profit) || 0;
      await refreshUser().catch(() => {});
      showToast(`Забрал на x${res.cashout_at}: ${profit >= 0 ? '+' : '−'}$${Math.abs(profit).toFixed(2)}`);

      // Автовклад в сейф работает так же, как на экране ракеты: иначе игрок,
      // забравший выигрыш из бейджа, молча лишился бы этой настройки
      const autoPct = autoPctRef.current;
      if (autoPct > 0 && profit >= 1) {
        const amt = Math.round(profit * (autoPct / 100) * 100) / 100;
        if (amt >= 1) {
          try {
            await safeApi.deposit(amt);
            showToast(`$${amt.toFixed(2)} автоматически внесено в Сейф`);
            await refreshUser().catch(() => {});
          } catch (e: any) {
            console.warn('[safe] автовклад не прошёл:', e?.message || e);
          }
        }
      }
    };

    sock.on('tick', onTick);
    sock.on('crash', onCrash);
    sock.on('cashout_result', onCashout);
    return () => {
      sock.off('tick', onTick);
      sock.off('crash', onCrash);
      sock.off('cashout_result', onCashout);
    };
  }, [refreshUser, showToast]);

  const cashout = useCallback(() => {
    const f = getFlight();
    if (!f || cashing) return;
    setCashing(true);
    getSocket().emit('cashout', { round_id: f.roundId });
    // Кнопку разблокируем даже если ответ не придёт (обрыв связи)
    setTimeout(() => setCashing(false), 1200);
  }, [cashing]);

  if (!flight) return null;
  if (loc.pathname.startsWith('/rocket')) return null;

  const mult = flight.multiplier || 1;
  return (
    <div
      style={{
        position: 'fixed', left: '50%', transform: 'translateX(-50%)',
        bottom: 'calc(14px + env(safe-area-inset-bottom, 0px))', zIndex: 900,
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
        background: 'rgba(10,10,26,0.96)', border: '1px solid rgba(255,215,0,0.45)',
        borderRadius: 14, boxShadow: '0 6px 20px rgba(0,0,0,0.55)', maxWidth: '94vw'
      }}
    >
      <span className="flight-badge__mult">
        <Icon name="rocket" size={16} strokeWidth={2} /> x{mult.toFixed(2)}
      </span>
      <span className="flight-badge__hint">в полёте</span>
      <button className="btn btn-green btn-small" onClick={cashout} disabled={cashing}>
        {cashing ? '…' : 'Забрать'}
      </button>
    </div>
  );
}
