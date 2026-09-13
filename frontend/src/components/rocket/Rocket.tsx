import { useEffect, useRef, useState, useCallback } from 'react';
import { sfx, createTickTracker } from '../../audio';
import { Link } from 'react-router-dom';
import MoneyBreakdown from '../common/MoneyBreakdown';
import Header from '../layout/Header';
import RocketScene from '../../three/rocket/RocketScene';
import { rocketApi, safeApi, publicConfig } from '../../api/client';
import { useAuth } from '../../stores/auth';
import { getSocket } from '../../api/socket';
import SafeDepositPrompt from '../common/SafeDepositPrompt';
import { isSafePromptMuted } from '../../utils/safePrompt';
import {
  setFlight, setFlightMultiplier, clearFlight, getFlight, setRocketScreenActive
} from '../../utils/rocketFlight';

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
  const [ghostDone, setGhostDone] = useState(false);
  const [showSafePrompt, setShowSafePrompt] = useState(false);
  const [sceneKey, setSceneKey] = useState(0); // форсируем ремаунт сцены
  const [replaySeed,setReplaySeed]=useState('vault-rocket');
  const launchTimeRef = useRef(0);
  const renderedMultiplierRef = useRef(1);
  const targetTickRef = useRef({multiplier:1,receivedAt:performance.now()});
  /**
   * Звук множителя: сервер шлёт тики 30 раз в секунду, а кадр рисуется 60 раз,
   * поэтому щёлкать на каждый — значит превратить звук в пулемёт. Трекер сам
   * держит интервал (700 мс на x1.0 → 120 мс на x10+): напряжение растёт.
   */
  const tickRef = useRef(createTickTracker());
  /** Высота двигателя обновляется 10 раз в секунду — чаще незаметно, но дороже. */
  const engineRef = useRef(0);
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
    setGhostDone(false);
    setCrashAt(1.0);
    setSceneKey(k => k + 1); // перерисовать Three.js сцену
    sfx.transition();
  }, []);

  useEffect(() => {
    rocketApi.history(20).then(setHistory).catch(() => {});
    rocketApi.bankroll().then(() => {}).catch(() => {});
  }, []);

  // WebSocket события
  useEffect(() => {
    const sock = getSocket();

    const onTick = (data: any) => {
      targetTickRef.current={multiplier:Number(data.multiplier),receivedAt:performance.now()};
      // Дублируем в общий стор: бейдж «ЗАБРАТЬ» рисует этот же множитель,
      // если игрока увели с экрана ракеты во время полёта
      setFlightMultiplier(data.multiplier);
    };

    const onCrashEvt = (data: any) => {
      // Точка взрыва приходит ТОЛЬКО здесь — вместе с фактом взрыва. До этого
      // момента клиент её не знает (и не может знать: сервер не отдаёт crash_at
      // в ответе /start, иначе выигрыш забирался бы «всегда вовремя»).
      if (Number.isFinite(Number(data?.crash_at))) setCrashAt(Number(data.crash_at));
      // Раунд закончился — общий стор полёта гасим (бейдж больше не нужен)
      clearFlight();
      // Если во время полёта не было кэшаута — проигрыш
      setPhase(p => {
        if (p === 'flying') {
          // Двигатель глушим ДО взрыва: иначе вой накладывается на удар
          sfx.engineStop();
          sfx.crash();
          sfx.haptic('heavy');
          refreshUser();
          rocketApi.history(20).then(setHistory);
          return 'lose';
        }
        // Забрали до взрыва — двигатель всё равно пора глушить
        sfx.engineStop();
        return p;
      });
    };

    const onCashoutResult = async (res: any) => {
      clearFlight();
      if (res?.result === 'win') {
        const mult = Number(res.cashout_at) || 1;
        const prof = Number(res.profit) || 0;
        sfx.engineStop();
        sfx.cashout(mult);
        // Крупный выигрыш звучит иначе: порог как в истории раундов (x10+)
        sfx.win(mult >= 10 || prof >= 100);
        setCashoutMult(res.cashout_at);
        setCrashAt(res.crash_at);
        setProfit(res.profit);
        setGhostDone(false);
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
              sfx.deposit();
              showToast(`🔒 $${amt.toFixed(2)} автоматически в Сейф`);
              refreshUser();
            } catch (e: any) {
              console.warn('[safe] автовклад не прошёл:', e?.message || e);
            }
          }
        } else {
          if (!isSafePromptMuted()) setShowSafePrompt(true);
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

  // Socket даёт authoritative checkpoints 30 FPS; requestAnimationFrame
  // интерполирует между ними с той же серверной кривой для плавных 60 FPS.
  useEffect(()=>{
    if(phase!=='flying') return;
    // Зажигание и запуск двигателя: один раз на вход в полёт
    sfx.engineStart();
    let frame=0;
    const render=()=>{
      const t=targetTickRef.current;
      const projected=t.multiplier*Math.exp(0.075*Math.min(100,performance.now()-t.receivedAt)/1000);
      renderedMultiplierRef.current += (projected-renderedMultiplierRef.current)*0.45;
      const m = renderedMultiplierRef.current;
      setMultiplier(m);
      // Высота и тембр двигателя растут вместе с множителем
      const now = performance.now();
      if (now - engineRef.current > 100) { engineRef.current = now; sfx.engineUpdate(m); }
      tickRef.current(m, now);
      frame=requestAnimationFrame(render);
    };
    frame=requestAnimationFrame(render);
    return()=>cancelAnimationFrame(frame);
  },[phase]);

  const start = async () => {
    const b = parseFloat(bet);
    if (!b || b < minBet) { sfx.error(); return showToast(`Мин. ставка $${minBet}`); }
    if (Math.round(b * 100) > Math.round(((user?.balance || 0) - (user?.frozen_balance || 0)) * 100)) {
      sfx.error();
      return showToast('Недостаточно средств');
    }
    try {
      const res = await rocketApi.start(b);
      // Фишка встала на стол, затем поджиг — за 100 мс до rocket:launch
      sfx.betPlace();
      tickRef.current = createTickTracker();
      setRoundId(res.round_id);
      setMaxBet(res.max_bet);
      // crash_at сервер больше не присылает: множитель падения станет известен
      // только из события `crash` / `cashout_result`
      setCrashAt(1.0);
      setReplaySeed(res.replay_seed || `rocket-${res.round_id}`);
      setMultiplier(1.0);
      renderedMultiplierRef.current=1;
      targetTickRef.current={multiplier:1,receivedAt:performance.now()};
      setPhase('flying');
      launchTimeRef.current = Date.now();
      // Полёт принадлежит серверу (тики и падение идут без клиента), поэтому
      // состояние раунда отдаём в общий стор — кнопка «ЗАБРАТЬ» сможет
      // появиться на любом экране, куда игрока выдернут
      setFlight(res.round_id);
      const sock = getSocket();
      sock.emit('rocket:join', res.round_id);
      setSceneKey(k => k + 1);
      // Таймер переживает размонтирование экрана: если игрока в эти 100 мс
      // выдернут во взлом сейфа, rocket:launch всё равно уйдёт и раунд
      // стартует на сервере (иначе ставка зависла бы без тиков)
      setTimeout(() => { sfx.ignite(); sock.emit('rocket:launch', { round_id: res.round_id }); }, 100);
    } catch (e: any) {
      sfx.error();
      showToast(e.message);
    }
  };

  // Кто обрабатывает события раунда: пока экран смонтирован — он сам,
  // после ухода — плавающий бейдж (см. isRocketScreenActive)
  useEffect(() => {
    setRocketScreenActive(true);
    return () => setRocketScreenActive(false);
  }, []);

  // Вернулись на экран во время полёта (могли выдернуть во взлом сейфа):
  // сервер продолжает тикать, поэтому восстанавливаем раунд — иначе игрок
  // увидел бы форму ставки и не смог забрать выигрыш
  useEffect(() => {
    const f = getFlight();
    if (!f) return;
    setRoundId(f.roundId);
    // Во время полёта точка взрыва клиенту неизвестна (придёт с событием crash)
    setCrashAt(typeof f.crashAt === 'number' ? f.crashAt : 1.0);
    setMultiplier(f.multiplier || 1.0);
    setPhase('flying');
    getSocket().emit('rocket:join', f.roundId);
  }, []);

  const cashout = () => {
    if (phase !== 'flying' || !roundId) return;
    sfx.tap();
    sfx.haptic('medium');
    const sock = getSocket();
    sock.emit('cashout', { round_id: roundId });
  };

  /**
   * Пороги пилюли множителя (совпадают с .mult-pill--* в app.css):
   * до x1.5 — красный (почти не отыграл ставку), до x3 — золотой,
   * до x10 — зелёный, выше — золотой градиент.
   */
  const pillTier = (m: number): 'low' | 'mid' | 'high' | 'huge' =>
    m < 1.5 ? 'low' : m < 3 ? 'mid' : m < 10 ? 'high' : 'huge';

  const multColor =
    multiplier < 1.5 ? 'mult-green' :
    multiplier < 3 ? 'mult-yellow' :
    multiplier < 5 ? 'mult-orange' : 'mult-red';

  const scenePhase = phase === 'win' ? 'cashed' : phase === 'lose' ? 'crashed' : phase === 'flying' ? 'flying' : 'idle';
  const betNum = parseFloat(bet) || 0;

  return (
    <>
      <Header title="🚀 Ракета" />

      {/* Сцена и HUD — один позиционированный блок: цифры множителя лежат
          поверх 3D (.scene-hud → position:absolute, inset:0), а не под картинкой.
          Именно так их видит игрок в настоящих crash-играх. */}
      <div style={{ position: 'relative' }}>
        <RocketScene key={sceneKey} phase={scenePhase as any} multiplier={multiplier} cashoutAt={cashoutMult} crashAt={crashAt} onGhostFinished={()=>setGhostDone(true)} seed={replaySeed} />
        {phase === 'flying' && (
          <div className="scene-hud">
            <div className="scene-hud__top">
              <span className={`mult-pill mult-pill--${pillTier(multiplier)}`}>
                x{multiplier.toFixed(2)}
              </span>
              <span className="mult-pill">ставка ${betNum.toFixed(2)}</span>
            </div>
            <div className="scene-hud__bottom">
              <span className="mult-pill mult-pill--high">
                выигрыш ${(betNum * multiplier).toFixed(2)}
              </span>
              {cashoutMult > 0 && (
                <span className="mult-pill mult-pill--huge">забрал x{cashoutMult.toFixed(2)}</span>
              )}
            </div>
          </div>
        )}
        {phase === 'win' && (
          <div className="scene-hud">
            <div className="scene-hud__top">
              <span className="mult-pill mult-pill--huge">ЗАБРАНО x{cashoutMult.toFixed(2)}</span>
              {!ghostDone && <span className="mult-pill">👻 призрак летит…</span>}
            </div>
            {ghostDone && (
              <div className="scene-hud__bottom">
                <span className="mult-pill mult-pill--low">взрыв x{crashAt.toFixed(2)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{padding:'12px 0', display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:14}}>
        {/* Ставка проверяется и списывается из «доступно» (баланс минус
            заморозка дуэлей), поэтому и показываем его: цифра баланса при
            висящем вызове обещала больше, чем можно поставить */}
        <span className="text-dim">Доступно:</span>
        <span className="text-accent" style={{fontWeight:700, fontSize:18}}>${((user?.balance || 0) - (user?.frozen_balance || 0)).toFixed(2)}</span>
      </div>
      <MoneyBreakdown />

      {phase === 'betting' && (
        <>
          <div className="card">
            <div className="card-title">Ставка</div>
            <input type="number" className="input" value={bet} onChange={e => setBet(e.target.value)} min={1} />
            <div className="bet-chips">
              {CHIPS_DEFAULTS.filter(x => x >= minBet).slice(0,6).map(c => (
                <div key={c} className="chip" onClick={() => { sfx.chip(); setBet(String(c)); }}>${c}</div>
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
          <div className="text-center" style={{fontSize:16, color:'var(--text-dim)'}}>
            Ставка: ${betNum.toFixed(2)}
          </div>
          <div className="text-center" style={{fontSize:24, fontWeight:900, color:'var(--gold)', margin:'8px 0'}}>
            Выигрыш: ${(betNum * multiplier).toFixed(2)}
          </div>
          <button className="btn btn-big btn-green btn-pulse" onClick={cashout}>
            💰 ЗАБРАТЬ ${(betNum * multiplier).toFixed(2)}
          </button>
        </>
      )}

      {phase === 'win' && (
        <>
          <div className="bigwin">
            <div className="bigwin__label">забрали на x{cashoutMult.toFixed(2)}</div>
            <div className="bigwin__amount">+${profit.toFixed(2)}</div>
            <div className="text-dim" style={{ fontSize: 13 }}>
              {ghostDone ? `💥 Взрыв на x${crashAt.toFixed(2)}` : '👻 Смотрим, куда долетит призрак…'}
            </div>
          </div>
          <button className="btn btn-big btn-green" onClick={resetRound}>🚀 ИГРАТЬ СНОВА</button>
        </>
      )}

      {phase === 'lose' && (
        <>
          {/* Вспышка живёт 0.52 с и не перехватывает клики (pointer-events:none) */}
          <div className="flash-overlay" style={{ background: 'radial-gradient(circle at 50% 45%, rgba(255,59,92,.55), transparent 62%)' }} />
          <div className="result-text lose">💥 ВЗРЫВ!</div>
          <div className="text-center" style={{fontSize:24}}>Взрыв на x{crashAt.toFixed(2)}</div>
          <div className="result-text lose">-${betNum.toFixed(2)}</div>
          <button className="btn btn-big btn-danger" onClick={resetRound}>🚀 ИГРАТЬ СНОВА</button>
        </>
      )}

      {/* История */}
      <div className="card mt">
        <div className="card-title">📜 Последние раунды</div>
        {/* Полоса множителей: первым делом игрок смотрит, на чём падало раньше.
            Цвет пилюли = уровень падения (красное — рано, золото — высоко). */}
        <div className="mult-strip">
          {history.slice(0, 15).map(h => (
            <Link
              key={`pill-${h.round_id}`}
              to={`/replay/rocket/${h.round_id}?player=${encodeURIComponent(h.player)}`}
              state={{ replayFrom: '/rocket' }}
              className={`mult-pill mult-pill--${pillTier(h.crash_at || 1)}`}
              title={`#${h.round_id} · ${h.player}`}
            >
              x{(h.crash_at || 1).toFixed(2)}
            </Link>
          ))}
        </div>
        <div className="scroll-list" style={{maxHeight:220, overflowY:'auto'}}>
          {history.slice(0, 15).map(h => (
            <div key={h.round_id} className="history-item" style={{fontSize:13}}>
              <Link className="text-dim" state={{replayFrom:'/rocket'}} to={`/replay/rocket/${h.round_id}?player=${encodeURIComponent(h.player)}`}>📼 #{h.round_id} {h.player}</Link>
              <span>
                ${h.bet.toFixed(0)}
                {h.cashout_at
                  ? <> → <span className="text-green">забрал x{h.cashout_at.toFixed(2)}</span>{h.round_id===roundId&&phase==='win'&&!ghostDone?<> · <span className="text-dim">👻 призрак летит…</span></>:<> 💥<span className="text-red">x{h.crash_at.toFixed(2)}</span></>}</>
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
