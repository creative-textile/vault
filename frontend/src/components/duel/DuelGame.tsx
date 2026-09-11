import { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import Header from '../layout/Header';
import DuelScene from '../../three/duel/DuelScene';
import { duelApi, safeApi } from '../../api/client';
import { useAuth } from '../../stores/auth';
import SafeDepositPrompt from '../common/SafeDepositPrompt';

type DuelPhase = 'flipping' | 'result';

export default function DuelGame() {
  const { id } = useParams();
  const loc = useLocation();
  const nav = useNavigate();
  const { user, refreshUser, showToast } = useAuth();

  const [phase, setPhase] = useState<DuelPhase>('flipping');
  const [result, setResult] = useState<'heads' | 'tails' | null>(null);
  const [traj, setTraj] = useState<any>(null);
  const [prize, setPrize] = useState(0);
  const [amount, setAmount] = useState(0);
  const [won, setWon] = useState(false);
  const [showSafe, setShowSafe] = useState(false);
  const [autoDeposited, setAutoDeposited] = useState(0);
  const [loadErr, setLoadErr] = useState<string | null>(null);
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
          setTimeout(() => nav('/duel'), 1500);
          return;
        }
        // ВСЕГДА подтягиваем актуальные данные дуэли с сервера, чтобы не было -$0.00
        try {
          const d = await duelApi.get(duelId);
          if (d) res = d;
        } catch {}
        if (!mounted) return;
        if (!res || !res.id) {
          setLoadErr('Дуэль не найдена');
          setTimeout(() => nav('/duel'), 1500);
          return;
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

        const seenId = res.id || duelId;
        const duelKey = `duel_seen_${seenId}`;
        localStorage.setItem(duelKey, '1');
        localStorage.removeItem(`duel_dismissed_${seenId}`);
        sessionStorage.removeItem(`duel_pending_${seenId}`);

        setTimeout(async () => {
          if (!mounted) return;
          setPhase('result');
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
                } catch {}
              }
            }
          }
        }, 2800);
      } catch (e: any) {
        if (!mounted) return;
        setLoadErr(e?.message || 'Ошибка загрузки дуэли');
        setTimeout(() => nav('/duel'), 1500);
      }
    })();
    return () => { mounted = false; };
  }, [id, loc.state, nav, refreshUser]);

  const rematch = async (mult = 1) => {
    if (!id) return;
    try {
      const newAmt = Math.round(amount * mult * 100) / 100;
      await duelApi.create(newAmt);
      nav('/duel');
    } catch {
      nav('/duel');
    }
  };

  const goHome = () => {
    if (id) localStorage.setItem(`duel_seen_${id}`, '1');
    nav('/');
  };
  const goBack = () => {
    if (id) localStorage.setItem(`duel_seen_${id}`, '1');
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
      <DuelScene phase={phase as any} result={result} trajectory={traj} />

      <div style={{padding:'8px 0', display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:14}}>
        <span className="text-dim">Баланс:</span>
        <span className="text-accent" style={{fontWeight:700, fontSize:18}}>${(user?.balance || 0).toFixed(2)}</span>
      </div>

      {phase === 'result' && (
        <>
          <div className={`result-text ${won ? 'win' : 'lose'}`}>
            {won ? '🏆 ВЫ ПОБЕДИЛИ!' : '❌ ВЫ ПРОИГРАЛИ'}
          </div>
          <div className="text-center" style={{fontSize:22}}>🪙 {result === 'heads' ? 'ОРЁЛ' : 'РЕШКА'}</div>
          <div className={`result-text ${won ? 'win' : 'lose'}`}>
            {won ? `+$${profit.toFixed(2)}` : `-$${amount.toFixed(2)}`}
          </div>
          {autoDeposited > 0 && (
            <div className="text-center text-green" style={{fontSize:14, marginTop:-8, marginBottom:8}}>
              🔒 ${autoDeposited.toFixed(2)} автоматически переведено в Сейф
            </div>
          )}

          <div className="btn-row">
            <button className="btn" onClick={() => rematch(1)}>⚔️ РЕВАНШ ${amount}</button>
            <button className="btn btn-secondary" onClick={() => rematch(2)}>⚔️ ×2</button>
          </div>
          <button className="btn btn-secondary" onClick={goBack}>↩️ К ЛОББИ</button>
          <button className="btn btn-secondary mt" onClick={goHome}>🏠 НА ГЛАВНУЮ</button>
          {won && profit >= 1 && (user?.auto_safe_percent || 0) === 0 && (
            <button className="btn mt" style={{background:'#a855f7', color:'#fff'}} onClick={() => setShowSafe(true)}>
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
