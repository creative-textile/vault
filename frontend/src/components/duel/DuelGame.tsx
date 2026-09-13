import { useEffect, useState, useRef } from 'react';
import MoneyBreakdown from '../common/MoneyBreakdown';
import { releaseBalance } from '../../utils/balanceHold';
import { hasFreshDuelResults } from '../../stores/notifications';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import Header from '../layout/Header';
import DuelScene from '../../three/duel/DuelScene';
import { duelApi, safeApi } from '../../api/client';
import { useAuth } from '../../stores/auth';
import SafeDepositPrompt from '../common/SafeDepositPrompt';
import { isSafePromptMuted } from '../../utils/safePrompt';
import { useNotifications } from '../../stores/notifications';
import { tabStore, duelSeenKey } from '../../utils/tabStore';
import { sfx } from '../../audio';

type DuelPhase = 'flipping' | 'result';

/** Крупная победа: выигрыш удвоил ставку или больше (порог как в ракете). */
function bigWin(prize: number, amount: number): boolean {
  const p = Number(prize) || 0;
  const a = Number(amount) || 0;
  return p - a >= Math.max(1, a);
}

export default function DuelGame() {
  const { id } = useParams();
  const loc = useLocation();
  const nav = useNavigate();
  const { user, refreshUser, showToast } = useAuth();
  const { markDuelAsRead } = useNotifications();
  // Остались ли непросмотренные свежие результаты других дуэлей. Баланс —
  // цифра суммарная: показав её сейчас, выдали бы исход тех дуэлей, которые
  // ещё ждут своей очереди в модальном окне. Подписка на стор уведомлений
  // выше даёт пересчёт при каждом изменении списка.
  const otherPending = hasFreshDuelResults(Number(id));

  const [phase, setPhase] = useState<DuelPhase>('flipping');
  const [result, setResult] = useState<'heads' | 'tails' | null>(null);
  const [traj, setTraj] = useState<any>(null);
  const [prize, setPrize] = useState(0);
  const [amount, setAmount] = useState(0);
  const [won, setWon] = useState(false);
  const [showSafe, setShowSafe] = useState(false);
  const [autoDeposited, setAutoDeposited] = useState(0);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  /** Если это повтор сыгранной дуэли — подпись с датой, чтобы игрок понимал контекст. */
  const [replayOf, setReplayOf] = useState<string | null>(null);
  const userRef = useRef(user);
  useEffect(() => { userRef.current = user; }, [user]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        let res: any = (loc.state as any)?.result;
        const duelId = id ? parseInt(id) : res?.id;
        if (!mounted) return () => {};
        if (!duelId) {
          setLoadErr('Дуэль не найдена');
          return;
        }
        
        // Флаг «анимацию уже смотрели» ставит ТОЛЬКО этот экран (ниже).
        // Вызывающая сторона его не проставляет: иначе повтор дуэли открывался
        // бы сразу на результате, без броска монеты, — а смысл реплея в броске.
        // Флаг свой для вкладки (tabStore → sessionStorage). В localStorage его
        // видел соседний аккаунт в другой вкладке того же браузера — и повтор
        // дуэли открывался у него сразу на результате, без броска монеты.
        const seenKey = duelSeenKey(duelId);
        const alreadySeen = tabStore.get(seenKey) === '1';
        
        // ВСЕГДА подтягиваем актуальные данные дуэли с сервера, чтобы не было -$0.00
        try {
          const d = await duelApi.get(duelId);
          if (d) res = d;
        } catch {}
        if (!mounted) return;
        if (!res || !res.id) {
          setLoadErr('Дуэль не найдена');
          return;
        }

        // Несыгранная дуэль: результата нет, и выдумывать «орёл/решка» нельзя
        if (res.status && res.status !== 'finished') {
          setLoadErr(res.status === 'waiting'
            ? 'Дуэль ещё не состоялась — ждём соперника'
            : 'Дуэль отменена');
          return;
        }
        
        // Если уже просмотрено, сразу показываем результат без анимации
        if (alreadySeen) {
          setPhase('result');
        } else {
          setPhase('flipping');
          // Подброс и скрещивание клинков: дуэль началась
          sfx.sword();
          sfx.coinFlip();
        }
        
        setResult(res.result || 'heads');
        const defaultTraj = { rotation_speed: 8, height: 2.5, bounces: 2, final_angle: res.i_won ? 0 : 180 };
        setTraj(res.coin_trajectory && typeof res.coin_trajectory === 'object'
          ? { ...defaultTraj, ...res.coin_trajectory }
          : defaultTraj);
        const amt = Number(res.amount) || 0;
        const prz = Number(res.prize) || Math.round(amt * 2 * 0.9 * 100) / 100;
        setAmount(amt);
        setPrize(prz);
        const iWon = !!res.i_won;
        setWon(iWon);

        // Повтор: либо анимацию уже смотрели в этом браузере, либо дуэль
        // сыграна давно (игрок пришёл из уведомления спустя часы или дни)
        const finishedAt = res.finished_at ? new Date(res.finished_at) : null;
        if (alreadySeen || (finishedAt && Date.now() - finishedAt.getTime() > 60_000)) {
          if (finishedAt) {
            setReplayOf(finishedAt.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }));
          }
        }

        const seenId = res.id || duelId;
        tabStore.set(seenKey, '1');

        // Результат просмотрен — гасим уведомления по этой дуэли,
        // иначе бейдж непрочитанных висит, даже когда игрок всё увидел
        markDuelAsRead(Number(seenId));

        // Если анимация не была просмотрена, запускаем её
        if (!alreadySeen) {
          setTimeout(async () => {
            if (!mounted) return;
            setPhase('result');
            // Исход: победа звучит иначе, чем поражение, и дублируется
            // вибрацией — в Telegram WebView звук часто выключен
            if (iWon) sfx.win(bigWin(prz, amt));
            else { sfx.lose(); sfx.haptic('error'); }
            // Исход этой дуэли показан — баланс можно обновить, но только если
            // непросмотренных свежих результатов больше нет: цифра суммарная, и
            // по ней игрок понял бы исход остальных дуэлей из списка
            if (!hasFreshDuelResults(Number(seenId))) releaseBalance();
            await refreshUser().catch(() => {});
            if (iWon && prz - amt >= 1) {
              const autoPct = userRef.current?.auto_safe_percent || 0;
              if (autoPct > 0) {
                const toDeposit = Math.round((prz - amt) * (autoPct / 100) * 100) / 100;
                if (toDeposit >= 1) {
                  try {
                    await safeApi.deposit(toDeposit);
                    if (mounted) setAutoDeposited(toDeposit);
                    await refreshUser();
                  } catch (e: any) {
                    // Автовклад больше не блокируется фазой взлома (деньги уходят
                    // в собирающий сейф), но молча терять ошибку тоже не стоит
                    console.warn('[safe] автовклад не прошёл:', e?.message || e);
                  }
                }
              } else if (!isSafePromptMuted() && mounted) {
                setShowSafe(true);
              }
            }
          }, 2800);
        } else {
          // Если уже просмотрено, просто обновляем баланс (опять же — только
          // когда других непросмотренных результатов не осталось)
          if (!hasFreshDuelResults(Number(seenId))) releaseBalance();
          await refreshUser().catch(() => {});
        }
      } catch (e: any) {
        // Анимации не будет — цифры не держим (кроме случая, когда в списке
        // остались другие непросмотренные результаты)
        if (!hasFreshDuelResults(Number(id))) releaseBalance();
        if (!mounted) return;
        setLoadErr(e?.message || 'Ошибка загрузки дуэли');
      }
    })();
    return () => {
      mounted = false;
      // Ушли с экрана: баланс не должен остаться замороженным навсегда, но и
      // выдавать исход других непросмотренных дуэлей он не обязан
      if (!hasFreshDuelResults(Number(id))) releaseBalance();
    };
  }, [id, loc.state, nav, refreshUser, markDuelAsRead]);

  const rematch = async (mult = 1) => {
    if (!id) return;
    sfx.sword();
    try {
      await duelApi.rematch(Number(id),mult);
      showToast('Адресный реванш отправлен сопернику');
      nav('/duel');
    } catch {
      nav('/duel');
    }
  };

  const goHome = () => {
    if (id) tabStore.set(duelSeenKey(id), '1');
    nav('/');
  };
  const goBack = () => {
    if (id) tabStore.set(duelSeenKey(id), '1');
    nav('/duel');
  };

  if (loadErr) {
    return (
      <>
        <Header title="⚔️ Дуэль" />
        <div className="text-center mt text-red">{loadErr}</div>
        <button className="btn mt" onClick={() => nav('/')}>🏠 НА ГЛАВНУЮ</button>
      </>
    );
  }

  const profit = prize - amount;

  return (
    <>
      <Header title="⚔️ Дуэль" />
      {/* onFinish срабатывает в момент касания пола (не по таймеру экрана),
          поэтому звон монеты совпадает с картинкой даже на 120 Гц */}
      <DuelScene phase={phase as any} result={result} trajectory={traj} onFinish={() => sfx.coinLand()} />

      {phase === 'result' && (
        <>
          {/* Победа — блок .bigwin (вращающийся луч, сумма золотым градиентом):
              это момент, ради которого игрок пришёл, и он должен выглядеть
              дорого. Поражение остаётся строгим .result-text.lose — «дорого»
              оформленный проигрыш читался бы как издевательство. */}
          {won ? (
            <div className="bigwin">
              <div className="bigwin__label">🏆 вы победили · {result === 'heads' ? 'ОРЁЛ' : 'РЕШКА'}</div>
              <div className="bigwin__amount">+${profit.toFixed(2)}</div>
              <div className="text-dim" style={{ fontSize: 13 }}>банк ${prize.toFixed(2)} · ставка ${amount.toFixed(2)}</div>
            </div>
          ) : (
            <>
              <div className="result-text lose">❌ ВЫ ПРОИГРАЛИ</div>
              <div className="text-center" style={{ fontSize: 20 }}>
                🪙 {result === 'heads' ? 'ОРЁЛ' : 'РЕШКА'}
              </div>
              <div className="result-text lose">-${amount.toFixed(2)}</div>
            </>
          )}
          {replayOf && (
            <div className="text-dim text-center" style={{fontSize:12, marginBottom:6}}>
              📼 Повтор дуэли от {replayOf} МСК
            </div>
          )}
          {autoDeposited > 0 && (
            <div className="text-center text-green" style={{fontSize:14, marginTop:-8, marginBottom:8}}>
              🔒 ${autoDeposited.toFixed(2)} автоматически переведено в Сейф
            </div>
          )}

          {/* Баланс — только вместе с итогом. Деньги сервер двигает в момент
              принятия вызова, поэтому во время броска монеты цифра уже новая:
              она появлялась раньше надписи «ВЫ ПОБЕДИЛИ» и путала игрока. */}
          <div style={{padding:'8px 0', display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:14}}>
            <span className="text-dim">Баланс:</span>
            {otherPending ? (
              <span className="text-dim" style={{fontSize:12, textAlign:'right', maxWidth:'62%'}}>
                обновится после остальных дуэлей
              </span>
            ) : (
              <span className="text-accent" style={{fontWeight:700, fontSize:18}}>${(user?.balance || 0).toFixed(2)}</span>
            )}
          </div>
          {/* Куда делись деньги, если их не видно в балансе: сейф, вклад, другие дуэли */}
          <MoneyBreakdown />

          <div className="btn-row">
            <button className="btn" onClick={() => rematch(1)}>⚔️ РЕВАНШ ${amount}</button>
            <button className="btn btn-secondary" onClick={() => rematch(2)}>⚔️ ×2</button>
          </div>
          <button className="btn btn-secondary" onClick={() => {
            const url=`${location.origin}/replay/duel/${id}?player=${encodeURIComponent('@'+(user?.username||'user'))}`;
            if(navigator.share) navigator.share({title:'Повтор дуэли VAULT',url}); else navigator.clipboard?.writeText(url).then(()=>showToast('Ссылка скопирована'));
          }}>📤 ПОДЕЛИТЬСЯ РЕПЛЕЕМ</button>
          <button className="btn btn-secondary mt" onClick={goBack}>↩️ К ЛОББИ</button>
          <button className="btn btn-secondary mt" onClick={goHome}>🏠 НА ГЛАВНУЮ</button>
          {won && profit >= 1 && (user?.auto_safe_percent || 0) === 0 && (
            <button className="btn mt" style={{background:'var(--violet)', color:'var(--text)'}} onClick={() => setShowSafe(true)}>
              🔒 ВЛОЖИТЬ ВЫИГРЫШ В СЕЙФ
            </button>
          )}
        </>
      )}

      {showSafe && won && profit >= 1 && (
        <SafeDepositPrompt
          profit={profit}
          onClose={() => setShowSafe(false)}
          onDeposited={() => { setShowSafe(false); nav('/safe'); }}
        />
      )}
    </>
  );
}
