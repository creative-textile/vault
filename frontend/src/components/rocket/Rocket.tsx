import { useEffect, useRef, useState, useCallback } from 'react';
import Header from '../layout/Header';
import RocketScene from '../../three/rocket/RocketScene';
import { rocketApi, safeApi, publicConfig } from '../../api/client';
import { useAuth } from '../../stores/auth';
import { getSocket } from '../../api/socket';
import SafeDepositPrompt from '../common/SafeDepositPrompt';

type Phase = 'betting' | 'flying' | 'win' | 'lose';

interface HistoryItem {
  round_id: number;
  player: string;
  bet: number;
  cashout_at: number | null;
  crash_at: number;
  profit: number;
}

const CHIPS_DEFAULTS = [1, 5, 10, 25, 50, 100];

export default function Rocket() {
  const { user, refreshUser, showToast } = useAuth();
  const [phase, setPhase] = useState<Phase>('betting');
  const [bet, setBet] = useState('10');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [maxBet, setMaxBet] = useState(100);
  const [multiplier, setMultiplier] = useState(1.0);
  const [crashAt, setCrashAt] = useState(1.0);
  const [cashoutMult, setCashoutMult] = useState(0);
  const [roundId, setRoundId] = useState<number | null>(null);
  const [profit, setProfit] = useState(0);
  const [showSafePrompt, setShowSafePrompt] = useState(false);
  const [sceneKey, setSceneKey] = useState(0); // форсируем ремаунт сцены
  const launchTimeRef = useRef(0);
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);
  const [minBet, setMinBet] = useState(1);

  useEffect(() => {
    publicConfig().then(c => setMinBet(c.min_bet || 1)).catch(()=>{});
  }, []);

  const resetRound = useCallback(() => {
    setPhase('betting');
    setMultiplier(1.0);
    setCashoutMult(0);
    setRoundId(null);
    setProfit(0);
    setCrashAt(1.0);
    setSceneKey(k => k + 1); // перерисовать Three.js сцену
  }, []);

  useEffect(() => {
    rocketApi.history(20).then(setHistory).catch(() => {});
    rocketApi.bankroll().then(() => {}).catch(() => {});
  }, []);

  // WebSocket события
  useEffect(() => {
    const sock = getSocket();

    const onTick = (data: any) => setMultiplier(data.multiplier);

    const onCrashEvt = (_data: any) => {
      // Если во время полёта не было кэшаута — проигрыш
      setPhase(p => {
        if (p === 'flying') {
          refreshUser();
          rocketApi.history(20).then(setHistory);
          return 'lose';
        }
        return p;
      });
    };

    const onCashoutResult = async (res: any) => {
      if (res?.result === 'win') {
        setCashoutMult(res.cashout_at);
        setCrashAt(res.crash_at);
        setProfit(res.profit);
        setPhase('win');
        await refreshUser();
        rocketApi.history(20).then(setHistory);
        // Если настроен автовклад — вносим автоматически без попапа
        const autoPct = (userRef.current?.auto_safe_percent) || 0;
        if (autoPct > 0 && res.profit >= 1) {
          const amt = Math.round(res.profit * (autoPct / 100) * 100) / 100;
          if (amt >= 1) {
            try {
              await safeApi.deposit(amt);
              showToast(`🔒 $${amt.toFixed(2)} автоматически в Сейф`);
              refreshUser();
            } catch (e: any) {
              console.warn('[safe] автовклад не прошёл:', e?.message || e);
            }
          }
        } else {
          setShowSafePrompt(true);
        }
      }
    };

    sock.on('tick', onTick);
    sock.on('crash', onCrashEvt);
    sock.on('cashout_result', onCashoutResult);

    return () => {
      sock.off('tick', onTick);
      sock.off('crash', onCrashEvt);
      sock.off('cashout_result', onCashoutResult);
    };
  }, [refreshUser]);

  const start = async () => {
    const b = parseFloat(bet);
    if (!b || b < minBet) return showToast(`Мин. ставка $${minBet}`);
    if (b > (user?.balance || 0) - (user?.frozen_balance || 0)) return showToast('Недостаточно средств');
    try {
      const res = await rocketApi.start(b);
      setRoundId(res.round_id);
      setMaxBet(res.max_bet);
      setCrashAt(res.crash_at);
      setMultiplier(1.0);
      setPhase('flying');
      launchTimeRef.current = Date.now();
      const sock = getSocket();
      sock.emit('rocket:join', res.round_id);
      setSceneKey(k => k + 1);
      setTimeout(() => sock.emit('rocket:launch', { round_id: res.round_id }), 100);
    } catch (e: any) {
      showToast(e.message);
    }
  };

  const cashout = () => {
    if (phase !== 'flying' || !roundId) return;
    const sock = getSocket();
    sock.emit('cashout', { round_id: roundId });
  };

  const multColor =
    multiplier < 1.5 ? 'mult-green' :
    multiplier < 3 ? 'mult-yellow' :
    multiplier < 5 ? 'mult-orange' : 'mult-red';

  const scenePhase = phase === 'win' ? 'cashed' : phase === 'lose' ? 'crashed' : phase === 'flying' ? 'flying' : 'idle';
  const betNum = parseFloat(bet) || 0;

  return (
    <>
      <Header title="🚀 Ракета" />

      <RocketScene key={sceneKey} phase={scenePhase as any} multiplier={multiplier} />

      <div style={{padding:'12px 0', display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:14}}>
        <span className="text-dim">Баланс:</span>
        <span className="text-accent" style={{fontWeight:700, fontSize:18}}>${(user?.balance || 0).toFixed(2)}</span>
      </div>

      {phase === 'betting' && (
        <>
          <div className="card">
            <div className="card-title">Ставка</div>
            <input type="number" className="input" value={bet} onChange={e => setBet(e.target.value)} min={1} />
            <div className="bet-chips">
              {CHIPS_DEFAULTS.filter(x => x >= minBet).slice(0,6).map(c => (
                <div key={c} className="chip" onClick={() => setBet(String(c))}>${c}</div>
              ))}
            </div>
            <div className="text-dim text-center" style={{fontSize:13}}>Макс: ${maxBet} · Мин: ${minBet}</div>
          </div>
          <button className="btn btn-big btn-green btn-pulse" onClick={start}>🚀 ЗАПУСТИТЬ</button>
        </>
      )}

      {phase === 'flying' && (
        <>
          <div className={`mult text-center ${multColor}`}>x {multiplier.toFixed(2)} ↑</div>
          <div className="text-center" style={{fontSize:16, color:'#8888aa'}}>
            Ставка: ${betNum.toFixed(2)}
          </div>
          <div className="text-center" style={{fontSize:24, fontWeight:900, color:'#ffd700', margin:'8px 0'}}>
            Выигрыш: ${(betNum * multiplier).toFixed(2)}
          </div>
          <button className="btn btn-big btn-green btn-pulse" onClick={cashout}>
            💰 ЗАБРАТЬ ${(betNum * multiplier).toFixed(2)}
          </button>
        </>
      )}

      {phase === 'win' && (
        <>
          <div className="result-text win">✅ ЗАБРАЛИ!</div>
          <div className="text-center" style={{fontSize:20}}>
            Забрали на <span className="text-green">x{cashoutMult.toFixed(2)}</span>
          </div>
          <div className="text-center text-dim">Взрыв на x{crashAt.toFixed(2)}</div>
          <div className="result-text win">+${profit.toFixed(2)}</div>
          <button className="btn btn-big btn-green" onClick={resetRound}>🚀 ИГРАТЬ СНОВА</button>
        </>
      )}

      {phase === 'lose' && (
        <>
          <div className="result-text lose">💥 ВЗРЫВ!</div>
          <div className="text-center" style={{fontSize:24}}>Взрыв на x{crashAt.toFixed(2)}</div>
          <div className="result-text lose">-${betNum.toFixed(2)}</div>
          <button className="btn btn-big btn-danger" onClick={resetRound}>🚀 ИГРАТЬ СНОВА</button>
        </>
      )}

      {/* История */}
      <div className="card mt">
        <div className="card-title">📜 Последние раунды</div>
        <div className="scroll-list" style={{maxHeight:220, overflowY:'auto'}}>
          {history.slice(0, 15).map(h => (
            <div key={h.round_id} className="history-item" style={{fontSize:13}}>
              <span className="text-dim">#{h.round_id} {h.player}</span>
              <span>
                ${h.bet.toFixed(0)}
                {h.cashout_at
                  ? <> → <span className="text-green">x{h.cashout_at.toFixed(2)}</span> 💥<span className="text-red">x{h.crash_at.toFixed(2)}</span></>
                  : <> 💥<span className="text-red">x{h.crash_at.toFixed(2)}</span></>
                }
              </span>
            </div>
          ))}
        </div>
      </div>

      {showSafePrompt && phase === 'win' && profit >= 1 && (
        <SafeDepositPrompt
          profit={profit}
          onClose={() => setShowSafePrompt(false)}
          onDeposited={() => setShowSafePrompt(false)}
        />
      )}
    </>
  );
}
