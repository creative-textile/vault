import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../layout/Header';
import SafeCrackScene from '../../three/safe/SafeCrackScene';
import { safeApi, publicConfig } from '../../api/client';
import { useAuth } from '../../stores/auth';

function fmt(n: number) { return n.toFixed(2); }

function timeToStr(ms: number) {
  if (ms <= 0) return '0:00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

const CHIPS_DEFAULTS = [10, 50, 250, 500, 1000];

export default function Safe() {
  const { user, refreshUser, showToast } = useAuth();
  const nav = useNavigate();
  const [safe, setSafe] = useState<any>(null);
  const [myDeposit, setMyDeposit] = useState<any>(null);
  const [amount, setAmount] = useState('100');
  const [results, setResults] = useState<any[]>([]);
  const [timeToCrack, setTimeToCrack] = useState(0);
  const [safeMinBank, setSafeMinBank] = useState(25);
  const [minBet, setMinBet] = useState(1);

  useEffect(() => {
    publicConfig().then(c => {
      setSafeMinBank(c.safe_min_bank || 5);
      setMinBet(c.min_bet || 1);
    }).catch(()=>{});
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await safeApi.current();
      setSafe(r.safe);
      setMyDeposit(r.my_deposit);
      setTimeToCrack(r.safe?.time_to_crack_ms || 0);
      if (r.safe?.status === 'finished' || r.safe?.status === 'cracking') {
        const res = await safeApi.results(r.safe.id);
        setResults(res.results);
      }
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(() => setTimeToCrack(t => Math.max(0, t - 1000)), 1000);
    const iv2 = setInterval(load, 10000);
    return () => { clearInterval(iv); clearInterval(iv2); };
  }, [load]);

  useEffect(() => {
    if (safe?.status === 'cracking') nav('/safe/crack');
  }, [safe?.status, nav]);

  const deposit = async () => {
    const a = parseFloat(amount);
    if (!a || a < minBet) return showToast(`Минимум $${minBet}`);
    // нет верхнего лимита на депозит в сейф
    try {
      await safeApi.deposit(a);
      showToast(`✅ $${a.toFixed(2)} внесено в Сейф`);
      await refreshUser();
      load();
    } catch (e: any) {
      showToast(e.message);
    }
  };

  const cancel = async () => {
    if (!confirm('Вернуть вклад? Призовой фонд будет уменьшен.')) return;
    try {
      await safeApi.cancel();
      showToast('💸 Средства возвращены');
      await refreshUser();
      load();
    } catch (e: any) {
      showToast(e.message);
    }
  };

  if (!safe) return <><Header title="🔒 Сейф" /><div className="text-center mt">Загрузка...</div></>;

  const hasDeposit = !!myDeposit;

  return (
    <>
      <Header title="🔒 Сейф" />
      <SafeCrackScene phase={safe.status === 'finished' ? 'result' : 'idle'} code={safe.code} drumSpeeds={safe.drum_speeds} />

      <div style={{padding:'8px 0', display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:14}}>
        <span className="text-dim">Баланс:</span>
        <span className="text-accent" style={{fontWeight:700, fontSize:18}}>${((user?.balance || 0) - (user?.frozen_balance || 0)).toFixed(2)}</span>
      </div>

      <div className="card">
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <div className="card-title">🔒 СЕЙФ #{safe.id}</div>
          <span className={`pill ${safe.status === 'collecting' || safe.status === 'cracking' ? 'pill-active' : ''}`}>
            {safe.status === 'collecting' ? 'сбор' : safe.status === 'cracking' ? 'ВЗЛОМ' : safe.status === 'finished' ? 'взломан' : 'отменён'}
          </span>
        </div>

        <div style={{display:'flex', justifyContent:'space-around', margin:'12px 0', fontSize:18}}>
          <div className="text-center">
            <div className="text-dim" style={{fontSize:12}}>Банк</div>
            <div className="text-accent" style={{fontWeight:900}}>${fmt(safe.bank)}</div>
            <div className="text-dim" style={{fontSize:11}}>призовой ${fmt(safe.prize_pool)}</div>
          </div>
          <div className="text-center">
            <div className="text-dim" style={{fontSize:12}}>Участников</div>
            <div style={{fontWeight:900}}>{safe.participants_count}</div>
            <div className="text-dim" style={{fontSize:11}}>мин 2 чел.</div>
          </div>
          <div className="text-center">
            <div className="text-dim" style={{fontSize:12}}>Победителей</div>
            <div className="text-green" style={{fontWeight:900}}>{safe.winners_count}</div>
          </div>
        </div>

        {safe.status === 'collecting' && (
          <>
            <div className="timer">⏰ {timeToStr(timeToCrack)}</div>
            <div className="text-center text-dim" style={{margin:'8px 0', fontSize:13}}>Приз: ваш вклад ×1.5 · Мин. $1 · Банк для старта ${safeMinBank}</div>
          </>
        )}

        {hasDeposit && (
          <div className="card" style={{margin:'12px 0', background:'rgba(255,215,0,0.08)'}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <div>
                <div className="card-title" style={{margin:0}}>Ваш вклад: ${fmt(myDeposit.amount)}</div>
                <div className="text-accent" style={{fontWeight:700}}>🏆 Приз: ${fmt(myDeposit.amount * 1.5)}</div>
              </div>
              {safe.status === 'collecting' && (
                <button className="btn btn-small btn-danger" onClick={cancel}>ОТМЕНА</button>
              )}
            </div>
          </div>
        )}
      </div>

      {safe.status === 'collecting' && (
        <div className="card">
          <div className="card-title">{hasDeposit ? 'Добавить ещё' : 'Внести'}</div>
          <input type="number" className="input" value={amount} onChange={e => setAmount(e.target.value)} min={1} />
          <div className="bet-chips">
            {CHIPS_DEFAULTS.filter(x => x >= minBet).map(c => <div key={c} className="chip" onClick={() => setAmount(String(c))}>${c}</div>)}
          </div>
          <button className="btn btn-big btn-green" onClick={deposit}>
            💰 {hasDeposit ? 'ДОБАВИТЬ' : 'ВНЕСТИ'} ${(parseFloat(amount)||0).toFixed(0)}
          </button>
        </div>
      )}

      {safe.status === 'finished' && results.length > 0 && (
        <div className="card">
          <div className="card-title">🏆 Результаты</div>
          <div className="scroll-list" style={{maxHeight:280, overflowY:'auto'}}>
            {results.slice(0, 20).map((r, i) => {
              const participated = r.crack_time_ms != null && r.crack_time_ms > 0;
              const timeStr = participated ? `${(r.crack_time_ms/1000).toFixed(2)}с` : 'не успел';
              return (
                <div key={i} className="history-item" style={{fontSize:13, color: r.user_id === user?.id ? '#ffd700' : r.prize > 0 ? '#22c55e' : '#8888aa'}}>
                  <span>{i+1}. {r.username} ({timeStr})</span>
                  <span>${fmt(r.amount)} → {r.prize > 0 ? `$${fmt(r.prize)} ✅` : '❌'}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
