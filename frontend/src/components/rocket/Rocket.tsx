import { useEffect, useRef, useState, useCallback } from 'react';
import { sfx, createTickTracker } from '../../audio';
import { Link } from 'react-router-dom';
import MoneyBreakdown from '../common/MoneyBreakdown';
import AmountChips from '../common/AmountChips';
import Icon from '../ui/Icon';
import { formatAmount } from '../../utils/betChips';
import { useAmountField } from '../../utils/useAmountField';
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

interface RocketLimits {
  min_bet: number;
  /** null — лимита нет (настройка 0% от кассы) */
  max_bet: number | null;
  max_bet_percent: number;
  // Кассы Ракеты здесь намеренно нет: сервер её больше не отдаёт. Размер кассы
  // — админская цифра, и подпись «100% кассы Ракеты ($1 837,50)» раскрывала её
  // любому игроку. Клиенту достаточно готового `max_bet`.
}

export default function Rocket() {
  const { user, refreshUser, showToast } = useAuth();
  const [phase, setPhase] = useState<Phase>('betting');

  const [history, setHistory] = useState<HistoryItem[]>([]);
  // Лимиты ставки берём с сервера: максимум — это процент от кассы Ракеты, а
  // касса меняется после каждой ставки и каждого выигрыша. Прежние `100` и
  // `minBet` из /api/config не пересчитывались, и подпись «Макс: $100» висела
  // одним значением всю сессию.
  const [limits, setLimits] = useState<RocketLimits>({ min_bet: 1, max_bet: null, max_bet_percent: 0 });
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
  const minBet = limits.min_bet || 1;
  const maxBet = limits.max_bet;

  // Ставка проверяется, списывается и считается по умолчанию из «доступно»
  // (баланс минус заморозка дуэлей): цифра баланса при висящем вызове обещала
  // больше, чем можно поставить.
  const available = Number(user?.available ?? ((user?.balance || 0) - (user?.frozen_balance || 0))) || 0;

  // Сумма по умолчанию больше не захардкожена: $10 стояли в поле при любом
  // балансе. Если $10 по карману — остаются $10, иначе подставляется средний
  // номинал тех же кнопок (25% доступного, «красивая» цифра). Работает только
  // до первого ввода игрока — набранную вручную ставку не перезаписываем.
  const [bet, setBet] = useAmountField({ available, min: minBet, max: maxBet, preferred: 10 });

  /** Подтянуть лимиты ставки. Ошибку глотаем молча: подпись не критична. */
  const refreshLimits = useCallback(() => {
    rocketApi.limits().then((r: any) => {
      setLimits({
        min_bet: Number(r.min_bet) || 1,
        max_bet: r.max_bet == null ? null : Number(r.max_bet),
        max_bet_percent: Number(r.max_bet_percent) || 0
      });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    // min_bet из /api/config — мгновенный первый кадр, пока лимиты не приехали
    publicConfig().then(c => setLimits(l => ({ ...l, min_bet: Number(c.min_bet) || 1 }))).catch(()=>{});
  }, []);

  // Касса живёт своей жизнью (другие игроки ставят и выигрывают), поэтому во
  // время приёма ставок обновляем лимиты периодически — «Макс» обязан быть
  // актуальным на момент нажатия кнопки, а не на момент открытия экрана.
  useEffect(() => {
    if (phase !== 'betting') return;
    const t = setInterval(refreshLimits, 15000);
    return () => clearInterval(t);
  }, [phase, refreshLimits]);

  const resetRound = useCallback(() => {
    setPhase('betting');
    refreshLimits();
    setMultiplier(1.0);
    setCashoutMult(0);
    setRoundId(null);
    setProfit(0);
    setGhostDone(false);
    setCrashAt(1.0);
    setSceneKey(k => k + 1); // перерисовать Three.js сцену
    sfx.transition();
  }, [refreshLimits]);

  useEffect(() => {
    rocketApi.history(20).then(setHistory).catch(() => {});
    refreshLimits();
  }, [refreshLimits]);

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
              showToast(`$${amt.toFixed(2)} автоматически внесено в Сейф`);
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
    // Лимит кассы проверяем на клиенте до запроса: сообщение «Превышен лимит»
    // из API не говорит, какой лимит сейчас действует
    if (maxBet != null && Math.round(b * 100) > Math.round(maxBet * 100)) {
      sfx.error();
      refreshLimits();
      return showToast(`Макс. ставка сейчас $${formatAmount(maxBet)}`);
    }
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
      // Сервер возвращает лимиты, посчитанные НА МОМЕНТ ставки: подпись «Макс»
      // обновляется сразу, не дожидаясь следующего опроса
      setLimits(l => ({
        ...l,
        max_bet: res.max_bet == null ? null : Number(res.max_bet),
        min_bet: Number(res.min_bet) || l.min_bet
      }));
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
      <Header title="Ракета" icon="rocket" />

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
            {/* Пилюля только слева: справа на узких экранах она наезжала на
                плашку призрака из внутреннего HUD сцены */}
            <div className="scene-hud__top">
              <span className="mult-pill mult-pill--huge">ЗАБРАНО x{cashoutMult.toFixed(2)}</span>
            </div>
            {ghostDone && (
              <div className="scene-hud__bottom">
                <span className="mult-pill mult-pill--low">взрыв x{crashAt.toFixed(2)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="avail-line">
        {/* Ставка проверяется и списывается из «доступно» (баланс минус
            заморозка дуэлей), поэтому и показываем его: цифра баланса при
            висящем вызове обещала больше, чем можно поставить */}
        <span className="avail-line__label"><Icon name="wallet" size={14} /> Доступно</span>
        <span className="avail-line__value">${formatAmount(available)}</span>
      </div>
      <MoneyBreakdown />

      {phase === 'betting' && (
        <>
          <div className="card">
            <div className="card-title"><Icon name="coins" size={16} /> Ставка</div>
            <input
              type="number" className="input input--amount" value={bet} inputMode="decimal"
              onChange={e => setBet(e.target.value)} min={minBet}
            />
            {/* Номиналы считаются от доступного баланса, а не из фиксированного списка:
                у игрока с $7 нет кнопки $100, у игрока с $50 000 есть $25 000 */}
            <AmountChips available={available} value={bet} onChange={setBet} min={minBet} max={maxBet} />
            <div className="limits-line">
              <span className="limits-line__item">
                <Icon name="arrowUpRight" size={13} />
                {maxBet == null
                  ? <>Макс: <b className="text-accent">без лимита</b></>
                  : <>Макс: <b className="text-accent">${formatAmount(maxBet)}</b></>}
              </span>
              <span className="limits-line__sep" aria-hidden="true" />
              <span className="limits-line__item">
                Мин: <b>${formatAmount(minBet)}</b>
              </span>
            </div>
            {/* Лимита может не быть вовсе (настройка «0%») — это надо обозначить
                словами, иначе «Макс: $0» читается как запрет ставки. Как именно
                лимит посчитан (процент от кассы и её размер), игроку не
                сообщаем: касса — внутренняя цифра платформы. */}
            {maxBet == null && (
              <div className="limits-hint">
                Ставка не ограничена — можно внести всю доступную сумму.
              </div>
            )}
          </div>
          <button className="btn btn-big btn-green btn-pulse" onClick={start}>
            <Icon name="rocket" size={18} strokeWidth={2} /> ЗАПУСТИТЬ
          </button>
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
            <Icon name="coins" size={19} strokeWidth={2} />
            Забрать ${formatAmount(betNum * multiplier)}
          </button>
        </>
      )}

      {phase === 'win' && (
        <>
          <div className="bigwin">
            <div className="bigwin__label">забрали на x{cashoutMult.toFixed(2)}</div>
            <div className="bigwin__amount">+${profit.toFixed(2)}</div>
            <div className="text-dim" style={{ fontSize: 13 }}>
              {ghostDone
                ? <><Icon name="burst" size={14} /> Взрыв на x{crashAt.toFixed(2)}</>
                : <><Icon name="ghost" size={14} /> Смотрим, куда долетит призрак…</>}
            </div>
          </div>
          <button className="btn btn-big btn-green" onClick={resetRound}>
            <Icon name="rocket" size={18} strokeWidth={2} /> Играть снова
          </button>
        </>
      )}

      {phase === 'lose' && (
        <>
          {/* Вспышка живёт 0.52 с и не перехватывает клики (pointer-events:none) */}
          <div className="flash-overlay" style={{ background: 'radial-gradient(circle at 50% 45%, rgba(255,59,92,.55), transparent 62%)' }} />
          <div className="result-text lose"><Icon name="burst" size={26} strokeWidth={1.8} /> Взрыв!</div>
          <div className="text-center" style={{fontSize:22}}>Взрыв на x{crashAt.toFixed(2)}</div>
          <div className="result-text lose">-${betNum.toFixed(2)}</div>
          <button className="btn btn-big btn-danger" onClick={resetRound}>
            <Icon name="rocket" size={18} strokeWidth={2} /> Играть снова
          </button>
        </>
      )}

      {/* История */}
      <div className="card mt">
        <div className="card-title"><Icon name="list" size={16} /> Последние раунды</div>
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
              <Link className="text-dim history-item__replay" state={{replayFrom:'/rocket'}} to={`/replay/rocket/${h.round_id}?player=${encodeURIComponent(h.player)}`}>
                <Icon name="replay" size={13} /> #{h.round_id} {h.player}
              </Link>
              <span>
                ${h.bet.toFixed(0)}
                {h.cashout_at
                  ? <>
                      <Icon name="arrowRight" size={12} />
                      <span className="text-green">забрал x{h.cashout_at.toFixed(2)}</span>
                      {h.round_id===roundId&&phase==='win'&&!ghostDone
                        ? <span className="text-dim"> · <Icon name="ghost" size={12} /> призрак летит…</span>
                        : <><Icon name="burst" size={12} className="text-red" /><span className="text-red">x{h.crash_at.toFixed(2)}</span></>}
                    </>
                  : <><Icon name="burst" size={12} className="text-red" /><span className="text-red">x{h.crash_at.toFixed(2)}</span></>
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
