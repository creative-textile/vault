import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../layout/Header';
import SafeCrackScene from '../../three/safe/SafeCrackScene';
import { safeApi, publicConfig } from '../../api/client';
import { useAuth } from '../../stores/auth';
import { onSafeEvent } from '../../utils/socketEvents';

function fmt(n: number) { return (Number(n) || 0).toFixed(2); }

function timeToStr(ms: number) {
  if (ms <= 0) return '0:00:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

const CHIPS_DEFAULTS = [10, 50, 100, 250, 500, 1000];

export default function Safe() {
  const { user, refreshUser, showToast } = useAuth();
  const nav = useNavigate();
  // Активный сейф: тот, который сейчас взламывают / уже разыгран / собирается
  const [safe, setSafe] = useState<any>(null);
  const [myDeposit, setMyDeposit] = useState<any>(null);
  // Сейф, который принимает вклады прямо сейчас. Во время взлома и после
  // розыгрыша это сейф следующего дня — сбор не останавливается.
  const [collect, setCollect] = useState<any>(null);
  const [collectDeposit, setCollectDeposit] = useState<any>(null);
  const [amount, setAmount] = useState('100');
  const [results, setResults] = useState<any[]>([]);
  const [timeToCrack, setTimeToCrack] = useState(0);
  const [collectTimeToCrack, setCollectTimeToCrack] = useState(0);
  const [safeMinBank, setSafeMinBank] = useState(25);
  const [minBet, setMinBet] = useState(1);
  // Дедлайны держим в ref: объект Date в зависимостях эффекта пересоздавался
  // на каждом опросе и запускал эффект заново — отсюда бесконечные запросы /api/safe/current
  const crackAtRef = useRef<number | null>(null);
  const collectAtRef = useRef<number | null>(null);

  useEffect(() => {
    publicConfig().then(c => {
      setSafeMinBank(c.safe_min_bank || 25);
      setMinBet(c.min_bet || 1);
    }).catch(()=>{});
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await safeApi.current();
      setSafe(r.safe);
      setMyDeposit(r.my_deposit);
      // Если сервер не отдал отдельный сейф для сбора — это тот же активный
      setCollect(r.collecting_safe || r.safe);
      setCollectDeposit(r.my_collecting_deposit !== undefined ? r.my_collecting_deposit : r.my_deposit);

      setTimeToCrack(r.safe?.time_to_crack_ms || 0);
      if (r.safe?.status === 'cracking' && r.safe?.crack_remaining_ms != null) {
        // во время взлома таймер показывает остаток окна взлома
        crackAtRef.current = Date.now() + r.safe.crack_remaining_ms;
      } else if (r.safe?.crack_at) {
        crackAtRef.current = new Date(r.safe.crack_at).getTime();
      }
      const collectMs = r.collecting_safe?.time_to_crack_ms;
      setCollectTimeToCrack(collectMs != null ? collectMs : (r.safe?.time_to_crack_ms || 0));
      collectAtRef.current = collectMs != null ? Date.now() + collectMs : crackAtRef.current;

      // Результаты имеют смысл только после розыгрыша (во время взлома призов ещё нет)
      if (r.safe?.status === 'finished') {
        const res = await safeApi.results(r.safe.id);
        setResults(res.results);
      } else {
        setResults([]);
      }
    } catch {}
  }, []);

  useEffect(() => {
    load();
    // Локальный тикер обратного отсчёта (без запросов к серверу)
    const iv = setInterval(() => {
      if (crackAtRef.current) setTimeToCrack(Math.max(0, crackAtRef.current - Date.now()));
      else setTimeToCrack(t => Math.max(0, t - 1000));
      if (collectAtRef.current) setCollectTimeToCrack(Math.max(0, collectAtRef.current - Date.now()));
      else setCollectTimeToCrack(t => Math.max(0, t - 1000));
    }, 1000);
    // Контрольный опрос + мгновенная реакция на socket-события сейфа
    const iv2 = setInterval(load, 5000);
    const off = onSafeEvent(() => load());
    return () => { clearInterval(iv); clearInterval(iv2); off(); };
  }, [load]);

  // На мини-игру отправляем только участника, который ещё не сдал результат.
  // Раньше уходили все и всегда: после «К результатам» страница взлома открывалась
  // заново и перезапускала отсчёт — получался бесконечный взлом.
  const submittedMs = myDeposit?.crack_time_ms ?? null;
  useEffect(() => {
    if (safe?.status === 'cracking' && myDeposit && submittedMs == null) {
      // replace: редирект не должен добавлять запись в историю,
      // иначе кнопка «назад» будет вечно ходить /safe ↔ /safe/crack
      nav('/safe/crack', { replace: true });
    }
  }, [safe?.status, myDeposit, submittedMs, nav]);

  const deposit = async () => {
    const a = parseFloat(amount);
    if (!a || a < minBet) return showToast(`Минимум $${minBet}`);
    // нет верхнего лимита на депозит в сейф
    try {
      const r: any = await safeApi.deposit(a);
      const target = r?.safe_id ?? collect?.id;
      showToast(`✅ $${a.toFixed(2)} внесено в СЕЙФ #${target}`);
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

  // Сбор идёт на другой сейф (активный сейчас взламывают или уже разыгран)
  const collectingOther = !!collect && collect.status === 'collecting' && collect.id !== safe.id;
  const collectingSelf = !!collect && collect.status === 'collecting' && collect.id === safe.id;

  // Итог игрока в разыгранном сейфе: приз берём с сервера, а не считаем «×1.5»
  const prize = Number(myDeposit?.prize || 0);
  const myTime = myDeposit?.crack_time_ms ?? null;
  const myPlace = results.length && user ? results.findIndex(r => r.user_id === user.id) + 1 : 0;

  const depositForm = (
    <>
      <div className="card-title">{collectDeposit ? 'Добавить ещё' : 'Внести'}</div>
      <input type="number" className="input" value={amount} onChange={e => setAmount(e.target.value)} min={1} />
      <div className="bet-chips">
        {CHIPS_DEFAULTS.filter(x => x >= minBet).map(c => <div key={c} className="chip" onClick={() => setAmount(String(c))}>${c}</div>)}
      </div>
      <button className="btn btn-big btn-green" onClick={deposit}>
        💰 {collectDeposit ? 'ДОБАВИТЬ' : 'ВНЕСТИ'} ${(parseFloat(amount)||0).toFixed(0)}
      </button>
    </>
  );

  return (
    <>
      <Header title="🔒 Сейф" />
      <SafeCrackScene phase={safe.status === 'cracking' ? 'spinning' : safe.status === 'finished' ? 'result' : 'idle'} code={safe.code} drumSpeeds={safe.drum_speeds} />

      <div style={{padding:'8px 0', display:'flex', justifyContent:'space-between', alignItems:'center', fontSize:14}}>
        <span className="text-dim">Баланс:</span>
        <span className="text-accent" style={{fontWeight:700, fontSize:18}}>${((user?.balance || 0) - (user?.frozen_balance || 0)).toFixed(2)}</span>
      </div>

      {/* ── Активный сейф ─────────────────────────────────────────────── */}
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

        {safe.status === 'cracking' && (
          <div className="card" style={{margin:'12px 0', background:'rgba(255,68,68,0.08)'}}>
            {submittedMs != null ? (
              <>
                <div className="text-green" style={{fontWeight:900, fontSize:16}}>
                  ✅ Ваш результат засчитан: {(submittedMs / 1000).toFixed(2)} с
                </div>
                <div className="timer" style={{marginTop:8}}>
                  {timeToCrack > 0 ? `⏱ Ждём остальных: ${timeToStr(timeToCrack)}` : '⏳ Окно взлома закрыто — подводим итоги...'}
                </div>
                <div className="text-dim" style={{fontSize:12, marginTop:6}}>
                  Не сдали результат: {safe.pending_cracks ?? 0} из {safe.participants_count}.
                  Итоги появятся сразу, как только все закончат, либо когда окно взлома закроется.
                </div>
              </>
            ) : (
              <>
                <div className="text-red" style={{fontWeight:900, fontSize:16}}>🔥 ИДЁТ ВЗЛОМ</div>
                <div className="timer" style={{marginTop:8}}>
                  {timeToCrack > 0 ? `⏱ До конца окна: ${timeToStr(timeToCrack)}` : '⏳ Окно взлома закрыто — подводим итоги...'}
                </div>
                <div className="text-dim" style={{fontSize:12, marginTop:6}}>
                  Не сдали результат: {safe.pending_cracks ?? 0} из {safe.participants_count}.
                  Кто не успеет — «не успел», приз 0.
                </div>
                {!myDeposit && (
                  <button className="btn btn-small mt" onClick={() => nav('/safe/crack')}>👀 СМОТРЕТЬ ВЗЛОМ</button>
                )}
              </>
            )}
          </div>
        )}

        {collectingSelf && (
          <>
            <div className="timer">⏰ {timeToStr(timeToCrack)}</div>
            <div className="text-center text-dim" style={{margin:'8px 0', fontSize:13}}>Приз: ваш вклад ×1.5 · Мин. $1 · Банк для старта ${safeMinBank}</div>
          </>
        )}

        {/* Вклад в активный сейф: до розыгрыша — возможный приз, после — фактический */}
        {myDeposit && safe.status !== 'finished' && (
          <div className="card" style={{margin:'12px 0', background:'rgba(255,215,0,0.08)'}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <div>
                <div className="card-title" style={{margin:0}}>Ваш вклад: ${fmt(myDeposit.amount)}</div>
                <div className="text-accent" style={{fontWeight:700}}>Возможный приз: ${fmt(myDeposit.amount * 1.5)}</div>
              </div>
              {collectingSelf && (
                <button className="btn btn-small btn-danger" onClick={cancel}>ОТМЕНА</button>
              )}
            </div>
          </div>
        )}

        {/* Итог для игрока в разыгранном сейфе — победа / поражение выглядят по-разному */}
        {myDeposit && safe.status === 'finished' && (
          <div className="card" style={{
            margin:'12px 0',
            background: prize > 0 ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.10)',
            border: `1px solid ${prize > 0 ? '#22c55e' : '#ef4444'}`
          }}>
            <div className="card-title" style={{margin:0}}>Ваш вклад: ${fmt(myDeposit.amount)}</div>
            {prize > 0 ? (
              <>
                <div className="text-green" style={{fontWeight:900, fontSize:26, margin:'6px 0'}}>
                  🏆 ПОБЕДА: +${fmt(prize)}
                </div>
                <div className="text-dim" style={{fontSize:13}}>
                  Время {(myTime! / 1000).toFixed(2)} с
                  {myPlace > 0 ? ` · место ${myPlace} из ${results.length}` : ''}
                  {' '}· призовые зачислены на баланс
                </div>
              </>
            ) : myTime != null ? (
              <>
                <div className="text-red" style={{fontWeight:900, fontSize:22, margin:'6px 0'}}>
                  ❌ ПОРАЖЕНИЕ: приз $0.00
                </div>
                <div className="text-dim" style={{fontSize:13}}>
                  Код собран за {(myTime / 1000).toFixed(2)} с
                  {myPlace > 0 ? ` (место ${myPlace} из ${results.length})` : ''}, но призовой пул
                  ${fmt(safe.prize_pool)} разобрали игроки, сдавшие результат раньше.
                </div>
              </>
            ) : (
              <>
                <div className="text-red" style={{fontWeight:900, fontSize:22, margin:'6px 0'}}>
                  ⏱ НЕ УСПЕЛИ: приз $0.00
                </div>
                <div className="text-dim" style={{fontSize:13}}>
                  Результат не был сдан до закрытия окна взлома — техническое поражение.
                  Вклад ${fmt(myDeposit.amount)} остался в банке сейфа.
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Сбор на следующий сейф: идёт прямо сейчас, даже во время взлома ── */}
      {collectingOther && (
        <div className="card" style={{border:'1px solid rgba(255,215,0,0.35)'}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
            <div className="card-title">🔒 СЕЙФ #{collect.id} — ИДЁТ СБОР</div>
            <span className="pill pill-active">сбор</span>
          </div>
          <div className="text-dim" style={{fontSize:12, margin:'6px 0'}}>
            Следующий взлом — через {timeToStr(collectTimeToCrack)}. Вкладывайтесь уже сейчас:
            розыгрыш текущего сейфа сбор не останавливает.
          </div>
          <div style={{display:'flex', gap:16, justifyContent:'space-between', alignItems:'center', fontSize:16, margin:'8px 0'}}>
            <div>💰 <span className="text-accent" style={{fontWeight:900}}>${fmt(collect.bank)}</span></div>
            <div>👥 {collect.participants_count}</div>
            <div className="text-dim" style={{fontSize:12}}>мин. банк ${safeMinBank}</div>
          </div>

          {collectDeposit && (
            <div className="card" style={{margin:'8px 0', background:'rgba(255,215,0,0.08)'}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <div>
                  <div className="card-title" style={{margin:0}}>Ваш вклад: ${fmt(collectDeposit.amount)}</div>
                  <div className="text-accent" style={{fontWeight:700}}>Возможный приз: ${fmt(collectDeposit.amount * 1.5)}</div>
                </div>
                <button className="btn btn-small btn-danger" onClick={cancel}>ОТМЕНА</button>
              </div>
            </div>
          )}

          {depositForm}
        </div>
      )}

      {/* ── Форма вклада, когда собирается текущий сейф ────────────────── */}
      {collectingSelf && (
        <div className="card">{depositForm}</div>
      )}

      {safe.status === 'finished' && results.length > 0 && (
        <div className="card">
          <div className="card-title">🏆 Результаты</div>
          <div className="scroll-list" style={{maxHeight:280, overflowY:'auto'}}>
            {results.slice(0, 20).map((r, i) => {
              const participated = r.crack_time_ms != null && r.crack_time_ms > 0;
              const timeStr = participated ? `${(r.crack_time_ms/1000).toFixed(2)}с` : 'не успел';
              const isMe = r.user_id === user?.id;
              const prizeStr = r.prize > 0
                ? `$${fmt(r.prize)} ✅`
                : participated ? '$0 · пул разобран' : '$0 ❌';
              return (
                <div key={i} className="history-item" style={{fontSize:13, color: isMe ? '#ffd700' : r.prize > 0 ? '#22c55e' : '#8888aa'}}>
                  <span>{i+1}. {r.username} ({timeStr}){isMe ? ' · вы' : ''}</span>
                  <span>${fmt(r.amount)} → {prizeStr}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
